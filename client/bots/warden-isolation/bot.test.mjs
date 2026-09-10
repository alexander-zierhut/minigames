/* Warden (Isolation): the facts that make it a real bot. The framework conformance
   (only legal moves, determinism, speed) is in tests/unit/bots.test.mjs; this file is
   about strength. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { evaluateBot } from "../../../scripts/puzzles/runner.mjs";

const H = loadHeadless();
const { Bots, Rules, IsolationRules: R } = H;
const BUDGET = { ms: Infinity, nodes: 20000 };
const mk = (config) => Rules.create({ players: 2, ...config }, "isolation");
const bot = (opts = {}) => Bots.create("warden-isolation", { seed: 3, me: 0, difficulty: "hard", budget: BUDGET, ...opts });

/* a hand-made position: pawns and broken tiles as [x, y] */
function position(n, pawn0, pawn1, holes, turn = 0) {
    const s = mk({ n });
    const at = ([x, y]) => y * n + x;
    s.cells.fill(R.FREE);
    s.pawns = [at(pawn0), at(pawn1)];
    s.cells[s.pawns[0]] = 0;
    s.cells[s.pawns[1]] = 1;
    for (const h of holes) s.cells[at(h)] = R.HOLE;
    s.current = turn;
    return s;
}
const clone = (s) => JSON.parse(JSON.stringify(s));
function after(s, m) {
    const t = clone(s);
    Rules.step(R, t, m);
    return t;
}

test("registration: four difficulties with node budgets, an evaluator, not a baseline", () => {
    const def = Bots.get("warden-isolation");
    assert.equal(def.game, "isolation");
    assert.equal(def.baseline, undefined);
    assert.equal(def.difficulties.length, 4);
    for (const d of def.difficulties) assert.ok(Number.isInteger(d.nodes) && d.nodes >= 2000 && d.nodes <= 1000000, `${d.id} budget`);
    assert.equal(typeof def.evaluate, "function");
});

test("takes the trap when there is one", async () => {
    // p1 in the corner with only (0,1) and (1,1) left: step to (1,1), break (0,1)
    const s = position(3, [2, 2], [0, 0], [[1, 0], [2, 0], [2, 1], [0, 2]], 0);
    for (const difficulty of ["easy", "normal", "hard", "very-hard"]) {
        const b = bot({ difficulty });
        const m = await b.move(clone(s));
        const t = after(s, m);
        assert.equal(t.over, true, `${difficulty}: the game ends`);
        assert.equal(t.winner, 0, `${difficulty}: and it is a win`);
    }
});

test("never walks into an immediate trap when a safe move exists", async () => {
    /* p0 stands in a narrow corridor: one step leaves it with a single free neighbour that
       p1 can break at once, the others keep room. */
    const s = position(5, [2, 2], [4, 4], [[0, 0], [1, 0], [0, 1], [0, 3], [0, 4], [1, 4]], 0);
    const b = bot({ difficulty: "hard" });
    const m = await b.move(clone(s));
    const t = after(s, m);
    assert.equal(t.over, false);
    const trapped = R.legalMoves(t, t.current).some((r) => after(t, r).over);
    assert.equal(trapped, false, "the reply must not trap us on the spot");
});

test("beats the Random baseline by a wide margin, as either seat", async () => {
    let points = 0;
    const games = 14;
    for (let g = 0; g < games; g++) {
        const me = g % 2;
        const mine = Bots.create("warden-isolation", { seed: 40 + g, me, difficulty: "hard", budget: BUDGET });
        const other = Bots.create("random-isolation", { seed: 900 + g, me: 1 - me });
        const r = await Bots.playout("isolation", { n: 6, startPlayer: g % 2 }, me === 0 ? [mine, other] : [other, mine], { maxMoves: 200 });
        assert.equal(r.over, true, `game ${g} finishes`);
        if (r.winner === me) points++;
    }
    assert.ok(points >= games * 0.9, `wins at least 90 % against Random (${points}/${games})`);
});

test("a stronger level is never worse than a weaker one over a seeded series", async () => {
    const score = async (difficulty) => {
        let points = 0;
        for (let g = 0; g < 6; g++) {
            const me = g % 2;
            const mine = Bots.create("warden-isolation", { seed: 70 + g, me, difficulty, budget: BUDGET });
            const other = Bots.create("random-isolation", { seed: 700 + g, me: 1 - me });
            const r = await Bots.playout("isolation", { n: 6, startPlayer: g % 2 }, me === 0 ? [mine, other] : [other, mine], { maxMoves: 200 });
            if (r.winner === me) points++;
        }
        return points;
    };
    assert.ok(await score("very-hard") >= await score("easy"), "very hard is at least as good as easy");
});

test("deterministic: same seed and budget, same move", async () => {
    const s = mk({ n: 7 });
    for (const difficulty of ["easy", "very-hard"]) {
        const a = bot({ difficulty }), b = bot({ difficulty });
        assert.equal(await a.move(clone(s)), await b.move(clone(s)), `${difficulty}`);
    }
    // and a different seed only changes the level that spreads (Easy)
    const easyA = bot({ difficulty: "easy", seed: 1 }), easyB = bot({ difficulty: "easy", seed: 2 });
    const moves = [await easyA.move(clone(s)), await easyB.move(clone(s))];
    assert.ok(moves.every((m) => R.isLegal(s, m, 0)));
});

test("the puzzle set: the strong levels find nearly every proven best move", async () => {
    const easy = await evaluateBot(H, "warden-isolation", { seed: 7, difficulty: "easy", budget: BUDGET });
    const strong = await evaluateBot(H, "warden-isolation", { seed: 7, difficulty: "very-hard", budget: BUDGET });
    assert.ok(strong.total >= 100);
    assert.ok(easy.pct >= 55, `Easy well above random picking (${easy.pct} % vs ${easy.chance} %)`);
    assert.ok(strong.pct >= 90, `Very hard nearly perfect (${strong.pct} %)`);
    assert.equal(strong.byTag["win-in-1"].solved, strong.byTag["win-in-1"].total, "every immediate trap is taken");
    assert.equal(strong.byTag["avoid-trap"].solved, strong.byTag["avoid-trap"].total, "never the move that loses on the spot");
});

test("evaluate: decided positions are ±Infinity, the start is roughly even, budgets are deterministic", async () => {
    const def = Bots.get("warden-isolation");
    const tools = (nodes) => Bots.tools("isolation", { seed: 0, budget: { ms: Infinity, nodes } });
    const start = mk({ n: 7 });
    const raw = Number(await def.evaluate(start, tools(12000)));
    assert.ok(Number.isFinite(raw), "a finite score at the start");
    assert.equal(Number(await def.evaluate(start, tools(12000))), raw, "same budget, same number");
    // player 0 traps player 1: the score is decided
    const won = position(3, [2, 2], [0, 0], [[1, 0], [2, 0], [2, 1], [0, 2]], 0);
    const dead = after(won, (1 * 3 + 1) * 9 + (1 * 3 + 0));
    assert.equal(dead.over, true);
    assert.equal(Number(await def.evaluate(dead, tools(2000))), Infinity, "player 0 won");
    // and a hopeless pocket for player 0 is strongly negative
    const pocket = position(5, [0, 0], [4, 4], [[2, 0], [2, 1], [2, 2], [0, 2], [1, 2]], 0);
    assert.ok(Number(await def.evaluate(pocket, tools(12000))) < 0, "the walled-in pawn is worse off");
});
