/* Creeper (Chain React): what makes this bot good.
   - its internal rules engine is identical to ChainRules (thousands of random moves)
   - it takes a win in one and never hands the opponent a takeover (hand-made positions)
   - puzzle thresholds per level (tests/puzzles/chain, proven perfect moves), each level
     at least as good as the previous one
   - head-to-head: Very hard beats Random, Hard beats Easy
   - estimate(): 50 % at the start, confident when it should be, exact when over, cheap
   Everything runs under node budgets (ms: Infinity), so the numbers are the same on any
   machine. Thresholds sit below what the bot really reaches (see README.md). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { evaluateBot } from "../../../scripts/puzzles/runner.mjs";

const H = loadHeadless();
const { Bots, Rules } = H;
const rules = Rules.of("chain");
const ID = "creeper-chain";
const I = Bots.get(ID).internals;
const BUDGET = { ms: Infinity, nodes: 20000 };
const LEVELS = ["easy", "normal", "hard", "veryhard"];

const fresh = (cfg) => rules.create(cfg, Rules.base(cfg));
// a position from a move list (player 0 starts), via the real rules
function position(cfg, history) {
    const t = Bots.tools("chain", { seed: 1 });
    let state = fresh(cfg);
    for (const i of history) state = t.apply(state, i);
    return state;
}
const winsNow = (t, state) => t.legalMoves(state).some((i) => t.apply(state, i).over);

test("creeper-chain: internal rules equal ChainRules on 3000+ random moves (3×3…8×8, chain rule on and off)", () => {
    const t = Bots.tools("chain", { seed: 1 });
    let moves = 0;
    for (let g = 0; moves < 3500; g++) {
        const n = 3 + (g % 6);
        const cfg = { n, chainRule: g % 3 === 2, chainLen: 2 + (g % 5) };
        let state = fresh(cfg);
        let pos = I.fromState(state);
        while (!state.over && moves < 3500) {
            const i = t.pick(t.legalMoves(state));
            const real = t.apply(state, i);
            const mine = I.apply(pos, i, { chainRule: state.chainRule, chainLen: state.chainLen });
            for (let k = 0; k < n * n; k++) {
                assert.equal(mine.cnt[k], real.cells[k].count, `game ${g} move ${i}: count of cell ${k}`);
                assert.equal(mine.own[k], real.cells[k].owner, `game ${g} move ${i}: owner of cell ${k}`);
            }
            assert.equal(mine.over, real.over, `game ${g} move ${i}: over`);
            if (real.over) assert.equal(mine.winner, real.winner, `game ${g} move ${i}: winner`);
            else assert.equal(mine.mover, real.current, `game ${g} move ${i}: side to move`);
            state = real; pos = mine; moves++;
        }
    }
    assert.ok(moves >= 3500);
});

test("creeper-chain: takes a win in one at every level above Easy", async () => {
    // 3×3 after 0, 1: one more piece on the corner converts 1 and 3, player 1 owns nothing
    const state = position({ n: 3, chainRule: false }, [0, 1]);
    for (const difficulty of LEVELS.slice(1)) {
        const bot = Bots.create(ID, { me: 0, difficulty, seed: 3, budget: BUDGET });
        assert.equal(await bot.move(bot.tools.clone(state)), 0, `${difficulty} plays the winning corner`);
    }
});

test("creeper-chain: never hands the opponent an immediate takeover (every level above Easy)", async () => {
    // 4×4 after 12, 8, 9 — player 1 to move. Player 0's corner 12 is one piece from
    // exploding onto 8 and 13: putting a piece on either of them lets 12 blow and take
    // everything. 12 of 14 moves are fine, 2 lose on the spot.
    const state = position({ n: 4, chainRule: false }, [12, 8, 9]);
    const t = Bots.tools("chain", { seed: 1 });
    assert.equal(state.current, 1);
    assert.ok(!winsNow(t, state), "no immediate win for player 1");
    const losing = t.legalMoves(state).filter((i) => winsNow(t, t.apply(state, i)));
    assert.equal(JSON.stringify(losing), "[8,13]", "exactly these moves lose at once");
    for (const difficulty of LEVELS.slice(1)) {
        const bot = Bots.create(ID, { me: 1, difficulty, seed: 3, budget: BUDGET });
        const i = await bot.move(t.clone(state));
        assert.ok(!losing.includes(i), `${difficulty} avoids the takeover (played ${i})`);
    }
});

test("creeper-chain: puzzles — thresholds per level, each level at least as good as the previous", async () => {
    const results = {};
    for (const difficulty of LEVELS) results[difficulty] = await evaluateBot(H, ID, { difficulty, budget: BUDGET });
    const pct = LEVELS.map((d) => results[d].pct);
    console.log(`creeper-chain puzzles at 20 000 nodes: ${LEVELS.map((d, k) => `${d} ${results[d].solved}/${results[d].total} (${pct[k]} %)`).join(", ")}, chance ${results.easy.chance} %`);
    // measured: easy 32 %, normal 87 %, hard 95 %, veryhard 100 % (Random: 22 %, chance 23 %)
    assert.ok(results.easy.pct >= 26, `Easy above chance (${results.easy.pct} %)`);
    assert.ok(results.normal.pct >= 75, `Normal (${results.normal.pct} %)`);
    assert.ok(results.hard.pct >= 85, `Hard (${results.hard.pct} %)`);
    assert.ok(results.veryhard.pct >= 95, `Very hard (${results.veryhard.pct} %)`);
    assert.equal(results.veryhard.byTag["win-in-1"].solved, results.veryhard.byTag["win-in-1"].total, "Very hard finds every win in one");
    assert.equal(results.veryhard.byTag["avoid-loss"].solved, results.veryhard.byTag["avoid-loss"].total, "Very hard never allows the takeover");
    for (let k = 1; k < LEVELS.length; k++) assert.ok(pct[k] >= pct[k - 1], `${LEVELS[k]} (${pct[k]} %) ≥ ${LEVELS[k - 1]} (${pct[k - 1]} %)`);
});

async function series(a, b, games, cfg = { n: 6, chainRule: false }, maxMoves = 600) {
    let points = 0;
    for (let g = 0; g < games; g++) {
        const me = g % 2;
        const A = Bots.create(a.id, { seed: 100 + g, me, difficulty: a.difficulty, budget: BUDGET });
        const B = Bots.create(b.id, { seed: 300 + g, me: 1 - me, difficulty: b.difficulty, budget: BUDGET });
        const r = await Bots.playout("chain", { ...cfg, startPlayer: g % 2 }, me === 0 ? [A, B] : [B, A], { maxMoves });
        if (r.winner === me) points += 1; else if (r.winner === null) points += 0.5;
    }
    return points;
}

test("creeper-chain: Very hard beats Random in at least 90 % of 20 games on 6×6", async () => {
    const points = await series({ id: ID, difficulty: "veryhard" }, { id: "random-chain" }, 20);
    console.log(`creeper-chain Very hard vs Random: ${points}/20`);
    assert.ok(points >= 18, `${points}/20`);
});

test("creeper-chain: Hard beats Easy over 10 games", async () => {
    const points = await series({ id: ID, difficulty: "hard" }, { id: ID, difficulty: "easy" }, 10);
    console.log(`creeper-chain Hard vs Easy: ${points}/10`);
    assert.ok(points >= 7, `${points}/10`);
});

test("creeper-chain: same seed and budget give the same move; Easy varies with the seed", async () => {
    const state = position({ n: 6, chainRule: false }, [0, 35, 7, 28, 14, 21]);
    const t = Bots.tools("chain", { seed: 1 });
    const a = Bots.create(ID, { me: 0, difficulty: "veryhard", seed: 9, budget: BUDGET });
    const b = Bots.create(ID, { me: 0, difficulty: "veryhard", seed: 9, budget: BUDGET });
    assert.equal(await a.move(t.clone(state)), await b.move(t.clone(state)));
    const easy = new Set();
    for (let seed = 1; seed <= 12; seed++) easy.add(await Bots.create(ID, { me: 0, difficulty: "easy", seed, budget: BUDGET }).move(t.clone(state)));
    assert.ok(easy.size >= 2, "Easy does not always play the same move");
});

test("creeper-chain: estimate — even start, confident when winning, exact when over, cheap", () => {
    const est = Bots.get(ID).estimate;
    const cfg = { n: 6, chainRule: false };
    assert.equal(est(fresh({ n: 4, chainRule: false })), 0.5, "empty board");
    const opening = position(cfg, [0, 35]);
    assert.ok(Math.abs(est(opening) - 0.5) <= 0.05, `symmetric opening ≈ 50 % (${est(opening)})`);
    // a big material lead: player 0 owns the top three rows (two pieces each), player 1 one corner
    const winning = fresh(cfg);
    for (let i = 0; i < 18; i++) { winning.cells[i].owner = 0; winning.cells[i].count = Math.min(2, winning.cells[i].cap - 1); }
    winning.cells[35].owner = 1; winning.cells[35].count = 1;
    winning.movesBy = [12, 12]; winning.current = 1;
    const p = est(winning);
    assert.ok(p > 0.8, `player 0 clearly winning: ${p}`);
    // the mirror image (owners swapped) must be the complement
    const losing = JSON.parse(JSON.stringify(winning));
    for (const c of losing.cells) if (c.owner >= 0) c.owner = 1 - c.owner;
    losing.current = 0;
    const q = est(losing);
    assert.ok(q < 0.2, `player 1 clearly winning: ${q}`);
    assert.ok(Math.abs(p + q - 1) < 1e-9, "mirror symmetric");
    for (const [winner, want] of [[0, 1], [1, 0], [-1, 0.5]]) {
        const over = position(cfg, [0, 35]);
        over.over = true; over.winner = winner;
        assert.equal(est(over), want, `terminal, winner ${winner}`);
    }
    // timing on a busy 6×6 middlegame
    const t = Bots.tools("chain", { seed: 4 });
    let state = fresh(cfg);
    for (let k = 0; k < 30 && !state.over; k++) state = t.apply(state, t.pick(t.legalMoves(state)));
    const t0 = Date.now();
    let same = true;
    const first = est(state);
    for (let k = 0; k < 40; k++) same = same && est(state) === first;
    const avg = (Date.now() - t0) / 40;
    assert.ok(same, "deterministic");
    assert.ok(avg < 15, `average estimate ${avg.toFixed(2)} ms`);
});
