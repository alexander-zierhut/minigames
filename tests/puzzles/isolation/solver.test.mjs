/* Isolation puzzle solver: proofs on hand-made positions, and the integrity of
   puzzles.json (replays legally, not over, legal best moves, ≥ 100, unique ids, every
   puzzle re-solves to the same answer).
   node --test tests/puzzles/isolation/solver.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { solve, solveExhaustive, Board, trapsNow, separated, canonical } from "../../../scripts/puzzles/isolation/solver.mjs";

const { Rules, IsolationRules } = loadHeadless();
const DOC = JSON.parse(readFileSync(new URL("./puzzles.json", import.meta.url), "utf8"));
const J = (a) => JSON.stringify(a);

const mk = (config) => Rules.create({ players: 2, ...config }, "isolation");
function replay(config, history) {
    const s = mk(config);
    for (const m of history) {
        assert.equal(s.over, false, "history continues after the end");
        assert.equal(IsolationRules.isLegal(s, m, s.current), true, `history move ${m} legal for ${s.current}`);
        Rules.step(IsolationRules, s, m);
    }
    return s;
}
/* a hand-made position: the pawns and the broken tiles as [x, y] */
function position(n, pawn0, pawn1, holes, turn = 0) {
    const s = mk({ n });
    const at = ([x, y]) => y * n + x;
    s.cells.fill(IsolationRules.FREE);
    s.pawns = [at(pawn0), at(pawn1)];
    s.cells[s.pawns[0]] = 0;
    s.cells[s.pawns[1]] = 1;
    for (const h of holes) s.cells[at(h)] = IsolationRules.HOLE;
    s.current = turn;
    return s;
}
const clone = (s) => JSON.parse(JSON.stringify(s));
const move = (s, [tx, ty], [rx, ry]) => (ty * s.n + tx) * s.cells.length + (ry * s.n + rx);
function after(s, m) {
    const t = clone(s);
    Rules.step(IsolationRules, t, m);
    return t;
}

/* 3×3: p1 in the corner with only (0,1) and (1,1) left, p0 next to it.
   Stepping to (1,1) and breaking (0,1) traps p1 on the spot. */
const TRAP3 = () => position(3, [2, 2], [0, 0], [[1, 0], [2, 0], [2, 1], [0, 2]], 0);

test("the trap: stepping into the last free neighbour and breaking the other one wins now", () => {
    const s = TRAP3();
    const kill = move(s, [1, 1], [0, 1]);
    const t = after(s, kill);
    assert.equal(t.over, true);
    assert.equal(t.winner, 0);
    assert.match(t.finishWhy, /Trapped/);
    const r = solve(s);
    assert.equal(r.value, "win");
    assert.ok(r.best.includes(kill), "the trap is a best move");
    assert.equal(r.moveValues[kill], "win");
    assert.equal(r.method, "exhaustive");
});

test("trapsNow lists exactly the moves that end the game at once, and they are all best", () => {
    const s = TRAP3();
    const b = Board.fromState(s);
    const now = trapsNow(b);
    assert.equal(J(now), J([move(s, [1, 1], [0, 1])]), "only one move traps right away");
    for (const m of now) assert.equal(after(s, m).over, true, `${m} ends the game`);
    const r = solveExhaustive(Board.fromState(s));
    for (const m of now) assert.ok(r.best.includes(m), `${m} is a best move`);
    // and every move outside `best` really loses
    for (const m of IsolationRules.legalMoves(s, 0)) {
        if (!r.best.includes(m)) assert.equal(r.moveValues[m], "loss", `${m} loses`);
    }
});

test("a small pocket loses the race: the value is a loss whatever the pawn tries", () => {
    // p0 is walled into a 4-tile corner, p1 owns the rest of the 5×5 board
    const s = position(5, [0, 0], [4, 4], [[2, 0], [2, 1], [2, 2], [0, 2], [1, 2]], 0);
    assert.equal(separated(Board.fromState(s)), true, "the pawns are cut off from each other");
    const r = solve(s, { maxNodes: 400000 });
    assert.equal(r.value, "loss");
    assert.equal(r.best.length, 0, "a lost position has no winning move");
    for (const m of IsolationRules.legalMoves(s, 0)) assert.equal(r.moveValues[m], "loss");
});

test("separated boards: the same wall is a loss for the small side and a win for the big one", () => {
    const holes = [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]];   // a full wall down column 1
    const small = position(5, [0, 0], [4, 4], holes, 0);
    const big = position(5, [0, 0], [4, 4], holes, 1);
    assert.equal(separated(Board.fromState(small)), true);
    assert.equal(solve(small, { maxNodes: 400000 }).value, "loss", "5 tiles against 15");
    assert.equal(solve(big, { maxNodes: 400000 }).value, "win");
});

test("the solver says `unknown` instead of guessing when a position is too open", () => {
    const s = mk({ n: 8 });                            // the empty board: far beyond an exhaustive search
    const r = solve(s, { maxNodes: 3000 });
    assert.equal(r.value, "unknown");
    assert.equal(J(r.best), "[]");
    assert.equal(r.depth, 0);
});

test("dead tiles are interchangeable: breaking any of them is graded the same", () => {
    /* a wall across the middle: everything below it is free but unreachable for both pawns,
       so those tiles are pure waste moves. The solver offers only one of them; this checks
       the premise, that all of them really are the same move. */
    const s = position(5, [0, 0], [4, 0], [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]], 0);
    const b = Board.fromState(s);
    b.markReachable();
    const dead = [];
    for (let c = 0; c < b.size; c++) if (b.cell[c] === IsolationRules.FREE && b.seen[c] !== b.stamp) dead.push(c);
    assert.ok(dead.length >= 8, `${dead.length} unreachable tiles`);
    const r = solve(s, { maxNodes: 400000 });
    assert.notEqual(r.value, "unknown");
    const to = IsolationRules.steps(s, 0)[0];
    const values = new Set(dead.map((d) => r.moveValues[to * s.cells.length + d]));
    assert.equal(values.size, 1, "every waste move is worth the same");
});

test("canonical: the 8 symmetries of one position give the same form", () => {
    const n = 5;
    const s = position(n, [0, 0], [4, 4], [[1, 0], [2, 2]], 0);
    const rotated = new Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) rotated[x * n + (n - 1 - y)] = s.cells[y * n + x];
    assert.equal(canonical(s.cells, n), canonical(rotated, n));
    const other = position(n, [0, 0], [4, 4], [[1, 0]], 0);
    assert.notEqual(canonical(s.cells, n), canonical(other.cells, n));
});

test("puzzles.json: shape, replayable positions, legal best moves", () => {
    assert.equal(DOC.game, "isolation");
    assert.match(DOC.generated, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(DOC.solver.length > 40);
    assert.ok(DOC.puzzles.length >= 100, `${DOC.puzzles.length} puzzles`);
    assert.equal(new Set(DOC.puzzles.map((p) => p.id)).size, DOC.puzzles.length, "unique ids");
    const tags = new Set();
    for (const p of DOC.puzzles) {
        const s = replay(p.config, p.history);
        assert.equal(s.over, false, `${p.id} not over`);
        assert.equal(s.current, p.toMove, `${p.id} toMove`);
        assert.equal(p.value, "win", `${p.id}: only won positions have a perfect move`);
        assert.ok(p.best.length >= 1, `${p.id} best non-empty`);
        const legal = IsolationRules.legalMoves(s, s.current);
        assert.ok(p.best.length < legal.length, `${p.id} not every move is best`);
        for (const m of p.best) assert.equal(IsolationRules.isLegal(s, m, s.current), true, `${p.id} best move ${m} legal`);
        assert.equal(J(p.best), J([...p.best].sort((a, b) => a - b)), `${p.id} best sorted`);
        assert.ok(p.depth === 1 || p.depth === "exhaustive", `${p.id} depth`);
        for (const t of p.tags) tags.add(t);
        if (p.tags.includes("win-in-1")) {
            for (const m of p.best) {
                const t = after(s, m);
                assert.equal(t.over, true, `${p.id}: best move ${m} traps at once`);
                assert.equal(t.winner, p.toMove, `${p.id}: ${m} wins now`);
            }
        }
        if (p.tags.includes("separated")) assert.equal(separated(Board.fromState(s)), true, `${p.id} separated`);
        if (p.tags.includes("avoid-trap")) {
            for (const m of legal) {
                if (p.best.includes(m)) continue;
                const t = after(s, m);
                assert.equal(t.over || trapsNow(Board.fromState(t)).length > 0, true, `${p.id}: ${m} hands over an immediate trap`);
            }
        }
    }
    assert.ok(tags.size >= 3, `tag variety (${[...tags].join(", ")})`);
});

test("puzzles.json: re-solving every puzzle reproduces value, depth and best", () => {
    for (const p of DOC.puzzles) {
        const r = solve(replay(p.config, p.history), { maxNodes: 60000 });
        assert.equal(r.value, p.value, `${p.id} value`);
        assert.equal(r.depth, p.depth, `${p.id} depth`);
        assert.equal(J(r.best), J(p.best), `${p.id} best`);
    }
});
