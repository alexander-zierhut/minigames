/* Bot framework: registry validation, seeded randomness, the toolset, headless playouts,
   and a conformance suite every registered bot must pass (this is what makes "the bot
   works" a checked fact rather than a hope). Runs without a DOM. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../scripts/headless.mjs";

const H = loadHeadless();
const { Bots, Rules } = H;
const CONFIGS = { chain: { n: 5, chainRule: false }, five: { n: 7, winLen: 5 } };
// rule variants every bot that claims to play them must survive too (same conformance)
const VARIANTS = { five: [{ name: "yavalath", config: { n: 7, winLen: 4, yavalath: true } }] };

test("registry: every bot has valid metadata; bad definitions are rejected", () => {
    assert.ok(Bots.list().length >= 2);
    for (const b of Bots.list()) {
        assert.match(b.id, /^[a-z0-9-]+$/);
        assert.ok(Rules.of(b.game), `${b.id}: game ${b.game} has rules`);
        assert.ok(b.difficulties.length >= 1);
        assert.equal(typeof b.create, "function");
    }
    assert.ok(Bots.forGame("chain").some((b) => b.id === "random-chain") && Bots.forGame("chain").every((b) => b.game === "chain"));
    // one bot per game (#21): the Random bots are baselines (benchmark opponent, fallback), never the opponent
    assert.equal(Bots.get("random-chain").baseline, true); assert.equal(Bots.get("random-five").baseline, true);
    assert.equal(Bots.botFor("chain").id, "creeper-chain"); assert.equal(Bots.botFor("five").id, "sensei-five");
    assert.equal(Bots.botFor("nope"), null);
    assert.throws(() => Bots.validate({ id: "xx-bot", name: "X", game: "chain", baseline: "yes", difficulties: [{ id: "n", label: "N" }], create() {} }), /baseline/);
    for (const bad of [{}, { id: "x", name: "X", game: "chain", difficulties: [], create() {} }, { id: "Bad Id", name: "X", game: "chain", difficulties: [{ id: "n", label: "N" }], create() {} }]) {
        assert.throws(() => Bots.validate(bad), /Bots\.register/);
    }
    assert.throws(() => Bots.create("nope"), /unknown bot/);
});

test("rng: same seed same sequence, different seeds differ, values in [0,1)", () => {
    const a = Bots.rng(42), b = Bots.rng(42), c = Bots.rng(43);
    const sa = Array.from({ length: 20 }, a), sb = Array.from({ length: 20 }, b), sc = Array.from({ length: 20 }, c);
    assert.equal(JSON.stringify(sa), JSON.stringify(sb));
    assert.notEqual(JSON.stringify(sa), JSON.stringify(sc));
    assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test("tools: apply works on a copy, outcome/legalMoves/opponents/deadline", async () => {
    const t = Bots.tools("five", { me: 1, seed: 7 });
    const s0 = Rules.of("five").create({ n: 5, winLen: 3 }, Rules.base({ n: 5 }));
    const s1 = t.apply(s0, 12);
    assert.equal(s0.cells[12], -1, "original untouched");
    assert.equal(s1.cells[12], 0); assert.equal(s1.current, 1);
    assert.throws(() => t.apply(s1, 12), /illegal/);
    assert.equal(JSON.stringify(t.outcome(s1)), '{"over":false,"winner":null}');
    assert.equal(t.legalMoves(s1).length, 24);
    assert.equal(JSON.stringify(t.opponents()), "[0]");
    const won = t.apply(t.apply(t.apply(t.apply(s1, 20), 13), 21), 14);   // p0: 12 13 14 in a row
    assert.equal(JSON.stringify(t.outcome(won)), '{"over":true,"winner":0}');
    const d = t.deadline(50); assert.equal(d.expired(), false); assert.ok(d.left() <= 50);
    assert.equal(t.pick([]), undefined);
    assert.equal(JSON.stringify(t.shuffle([1, 2, 3]).sort()), "[1,2,3]");
});

test("playout: function seats, illegal move detection, max moves", async () => {
    const first = (state) => Rules.of("five").legalMoves(state)[0];
    const r = await Bots.playout("five", { n: 3, winLen: 3 }, [first, first]);
    assert.equal(r.over, true); assert.equal(r.winner, 0, "filling row by row: p0 wins the first row");
    await assert.rejects(Bots.playout("five", { n: 3, winLen: 3 }, [() => 99, first]), /illegal/);
    const capped = await Bots.playout("chain", { n: 3 }, [(s) => s.history.length % 2 ? 8 : 0, (s) => 8], { maxMoves: 1 });
    assert.equal(capped.over, false); assert.equal(capped.moves, 1);
});

/* ---------- conformance: every registered bot, every difficulty ----------
   Runs with a node budget (no wall clock) so searching bots are deterministic here. */
const BUDGET = { ms: Infinity, nodes: 2000 };
for (const def of Bots.list()) {
    for (const diff of def.difficulties) {
        const cfg = CONFIGS[def.game];
        const positions = diff === def.difficulties[0] ? 300 : 60;
        // the same suite for every rule variant the bot says it plays
        for (const v of (VARIANTS[def.game] || []).filter((v) => Bots.supports(def.id, v.config))) {
            test(`${def.id} (${diff.id}, ${v.name}): only legal moves in 120 random positions, deterministic per seed`, async () => {
                const rules = Rules.of(def.game);
                const scout = Bots.tools(def.game, { seed: 41 });
                const bot = Bots.create(def.id, { seed: 5, me: 1, difficulty: diff.id, budget: BUDGET });
                const twin = Bots.create(def.id, { seed: 5, me: 1, difficulty: diff.id, budget: BUDGET });
                let state = rules.create(v.config, Rules.base(v.config));
                let games = 0;
                for (let k = 0; k < 120; k++) {
                    if (state.over) { state = rules.create(v.config, Rules.base(v.config)); games++; }
                    if (state.current === 1) {
                        const i = await bot.move(scout.clone(state));
                        assert.equal(await twin.move(scout.clone(state)), i, "same seed, same move");
                        assert.ok(rules.isLegal(state, i, 1), `legal move (got ${i})`);
                        state = scout.apply(state, i);
                    } else {
                        state = scout.apply(state, scout.pick(scout.legalMoves(state)));
                    }
                }
                assert.ok(games >= 1, `${games} games finished under the variant rules`);
            });
        }
        test(`${def.id} (${diff.id}): only legal moves in ${positions} random positions, deterministic per seed`, async () => {
            const rules = Rules.of(def.game);
            const scout = Bots.tools(def.game, { seed: 99 });
            const bot = Bots.create(def.id, { seed: 5, me: 1, difficulty: diff.id, budget: BUDGET });
            const twin = Bots.create(def.id, { seed: 5, me: 1, difficulty: diff.id, budget: BUDGET });
            let state = rules.create(cfg, Rules.base(cfg));
            for (let k = 0; k < positions; k++) {
                if (state.over) state = rules.create(cfg, Rules.base(cfg));
                if (state.current === 1) {
                    const i = await bot.move(scout.clone(state));
                    assert.equal(await twin.move(scout.clone(state)), i, "same seed, same move");
                    assert.ok(rules.isLegal(state, i, 1), `legal move (got ${i})`);
                    state = scout.apply(state, i);
                } else {
                    state = scout.apply(state, scout.pick(scout.legalMoves(state)));
                }
            }
        });
        test(`${def.id} (${diff.id}): finishes full games as either colour, fast enough for a phone`, async () => {
            const t0 = Date.now();
            let moves = 0;
            const games = diff === def.difficulties[0] ? 6 : 2;
            for (let g = 0; g < games; g++) {
                const me = g % 2;
                const bot = Bots.create(def.id, { seed: 100 + g, me, difficulty: diff.id, budget: BUDGET });
                const other = Bots.create(`random-${def.game}`, { seed: 200 + g, me: 1 - me });
                const r = await Bots.playout(def.game, { ...cfg, startPlayer: g % 2 }, me === 0 ? [bot, other] : [other, bot], { maxMoves: 800 });
                assert.equal(r.over, true, `game ${g} reaches an end`);
                moves += r.moves;
            }
            const avg = (Date.now() - t0) / moves;
            assert.ok(avg < 250, `average move with a 2000-node budget under 250 ms (${avg.toFixed(1)} ms)`);
        });
    }
}
