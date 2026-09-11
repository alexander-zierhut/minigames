/* Dots and Boxes puzzle solver: the fast engine proved against a plain brute force, a few
   hand-made positions, and the integrity of puzzles.json (replays legally, not over, legal
   best moves, ≥ 100, unique ids, every puzzle re-solves to the same answer).
   node --test tests/puzzles/boxes/solver.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { loadPuzzles, positionOf } from "../../../scripts/puzzles/runner.mjs";
import { Board, solveExhaustive, solveBrute, tables, symmetries, canonical, dotsOf, edgeOf } from "../../../scripts/puzzles/boxes/solver.mjs";

const H = loadHeadless();
const { Rules, BoxesRules, Bots } = H;
const J = (a) => JSON.stringify(a);

// a board with exactly these lines drawn (scores are given, not derived: the solver only
// needs the difference for the side to move)
function boardOf(n, drawn, mine = 0, theirs = 0) {
    const b = new Board(n);
    for (const e of drawn) b.make(e);
    b.mine = mine; b.theirs = theirs;
    return b;
}
const state = (n, history) => { const s = Rules.create({ n, players: 2 }, "boxes"); for (const i of history) Rules.step(BoxesRules, s, i); return s; };

test("line numbering and symmetries: the solver's tables match the rules, the 8 maps permute the lines", () => {
    for (const n of [2, 3, 4, 5]) {
        const t = tables(n);
        assert.equal(t.E, BoxesRules.edgeCount(n));
        for (let b = 0; b < t.B; b++) assert.equal(J(t.boxEdges[b]), J(BoxesRules.edgesOf(n, b)), `n=${n} box ${b}`);
        for (let e = 0; e < t.E; e++) assert.equal(J(t.edgeBoxes[e]), J(BoxesRules.boxesOf(n, e)), `n=${n} line ${e}`);
        for (const map of symmetries(n)) {
            assert.equal(new Set(map).size, t.E, "a permutation of every line");
            for (let e = 0; e < t.E; e++) { const [a, c] = dotsOf(n, map[e]); assert.equal(edgeOf(n, a, c), map[e]); }
        }
        // the same position under a symmetry has the same fingerprint
        const drawn = new Uint8Array(t.E);
        for (let e = 0; e < t.E; e += 3) drawn[e] = 1;
        const rotated = new Uint8Array(t.E);
        for (let e = 0; e < t.E; e++) rotated[symmetries(n)[1][e]] = drawn[e];
        assert.equal(canonical(drawn, n), canonical(rotated, n), `n=${n}: a rotated position is the same position`);
    }
});

test("the fast engine equals a plain brute force (no table, no pruning, no forced captures)", () => {
    // brute force is O(k!), so only positions with few undrawn lines
    const rng = Bots.rng(4242);
    let checked = 0;
    for (const n of [2, 3]) {
        const E = BoxesRules.edgeCount(n);
        for (let g = 0; g < 40; g++) {
            const drawn = [];
            const pool = Array.from({ length: E }, (_, i) => i);
            const keep = E - (7 + Math.floor(rng() * 3));                 // 7 to 9 undrawn lines
            for (let k = 0; k < keep; k++) drawn.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
            const mine = Math.floor(rng() * 3), theirs = Math.floor(rng() * 3);
            const fast = solveExhaustive(boardOf(n, drawn, mine, theirs));
            const slow = solveBrute(boardOf(n, drawn, mine, theirs));
            assert.ok(fast.net === slow.net, `n=${n} game ${g}: value ${fast.net} vs ${slow.net}`);
            assert.equal(J(fast.best.slice().sort((a, b) => a - b)), J(slow.best), `n=${n} game ${g}: every optimal line`);
            assert.equal(fast.value, slow.value);
            checked++;
        }
    }
    assert.ok(checked >= 80, `${checked} positions compared`);
});

test("a free box is always taken: closing it costs the tempo nothing", () => {
    // 2 × 2: lines 0, 2 and 6 drawn, so box 0 only needs line 7, and line 7's other box is empty
    const b = boardOf(2, [0, 2, 6]);
    assert.equal(b.captures(7), 1);
    assert.equal(b.isFreeCapture(7), true);
    const r = solveExhaustive(b);
    assert.equal(J(r.best), "[7]");
    for (const e of b.free()) if (e !== 7) assert.ok(r.moveValues[e] < r.net, `line ${e} is worse than taking the box`);
});

test("the whole 2 × 2 board: the first player wins it 3 boxes to 1", () => {
    const empty = boardOf(2, []);
    const r = solveExhaustive(empty);
    assert.equal(r.net, 2, "the mover ends two boxes ahead");
    assert.equal(r.value, "win");
    assert.equal(r.depth, 12, "twelve lines, all of them searched");
});

test("the whole 3 × 3 board: the second player wins it 6 boxes to 3 (a full exhaustive solve)", () => {
    const r = solveExhaustive(boardOf(3, []), { maxNodes: 40_000_000 });
    assert.equal(r.value, "loss", "whoever starts a 3 × 3 board loses with perfect play");
    assert.equal(r.net, -3, "the mover ends three boxes behind");
});

test("double-dealing: the solver declines boxes when control is worth more", () => {
    const data = loadPuzzles("boxes");
    const declines = data.puzzles.filter((p) => p.tags.includes("double-deal"));
    assert.ok(declines.length >= 5, `${declines.length} declining puzzles in the set`);
    for (const p of declines) {
        const s = positionOf(H, p);
        const b = Board.fromState(s);
        assert.ok(b.free().some((e) => b.captures(e) > 0), `${p.id}: a box is on the table`);
        for (const best of p.best) assert.equal(b.captures(best), 0, `${p.id}: the best line ${best} does not take it`);
        const r = solveExhaustive(b);
        const taking = Math.max(...b.free().filter((e) => b.captures(e) > 0).map((e) => r.moveValues[e]));
        assert.ok(r.net > taking, `${p.id}: declining (${r.net}) beats taking (${taking})`);
    }
});

test("puzzles.json: ≥ 100 puzzles, unique ids, every position replays, every best line is legal and proven", () => {
    const data = loadPuzzles("boxes");
    assert.equal(data.game, "boxes");
    assert.ok(data.puzzles.length >= 100, `${data.puzzles.length} puzzles`);
    assert.equal(new Set(data.puzzles.map((p) => p.id)).size, data.puzzles.length, "unique ids");
    const tags = new Set();
    const seen = new Set();
    for (const p of data.puzzles) {
        const s = positionOf(H, p);
        assert.ok(["win", "draw", "loss"].includes(p.value), `${p.id}: value`);
        assert.equal(p.depth, BoxesRules.legalMoves(s).length, `${p.id}: depth = undrawn lines`);
        assert.ok(p.depth >= 6, `${p.id}: not a trivial position`);
        assert.ok(p.best.length < p.depth, `${p.id}: a mistake is possible`);
        const b = Board.fromState(s);
        const key = `${s.n}:${canonical(b.drawn, s.n)}:${b.mine - b.theirs}`;
        assert.ok(!seen.has(key), `${p.id}: not a duplicate under the board symmetries`);
        seen.add(key);
        for (const t of p.tags || []) tags.add(t);
    }
    assert.ok(tags.size >= 4, `tag variety (${[...tags].join(", ")})`);
});

test("puzzles.json: every puzzle re-solves to the very same value and the very same optimal lines", () => {
    const data = loadPuzzles("boxes");
    for (const p of data.puzzles) {
        const s = positionOf(H, p);
        const r = solveExhaustive(Board.fromState(s), { maxNodes: 40_000_000 });
        assert.equal(r.value, p.value, `${p.id}: value`);
        assert.equal(J(r.best.slice().sort((a, b) => a - b)), J(p.best), `${p.id}: optimal lines`);
    }
});

test("three or four players: the solver is a two-player tool and the rules still rotate without it", () => {
    const s = state(2, []);
    assert.equal(s.players, 2);
    const three = Rules.create({ n: 2, players: 3 }, "boxes");
    assert.equal(J(three.scores), "[0,0,0]");
    Rules.step(BoxesRules, three, 0);
    assert.equal(three.current, 1, "the turn rotates over three seats");
});
