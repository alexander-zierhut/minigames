/* Five Wins puzzle solver: proofs on hand-made positions, and the integrity of
   puzzles.json (replays legally, not over, legal best moves, ≥ 100, unique ids, a sample
   re-solves to the same answer).   node --test tests/puzzles/five/solver.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { solve, solveExhaustive, proveWin, Board, symmetries, canonical } from "../../../scripts/puzzles/five/solver.mjs";

const { Rules, FiveRules } = loadHeadless();
const mk = (config) => FiveRules.create(config, Rules.base(config));
function play(s, i) {
    const p = s.current;
    assert.equal(FiveRules.isLegal(s, i, p), true, `move ${i} legal for ${p}`);
    FiveRules.place(s, i, p); FiveRules.settle(s, p);
    const r = FiveRules.conclude(s, p);
    if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
}
function replay(config, history) { const s = mk(config); for (const i of history) play(s, i); return s; }
// a position from [x, y] stone lists (p0 moved first: equal counts → p0 to move, else p1)
function position(n, winLen, p0, p1) {
    assert.ok(p0.length === p1.length || p0.length === p1.length + 1, "stone counts must be playable");
    const history = [];
    for (let k = 0; k < p0.length; k++) { history.push(p0[k][1] * n + p0[k][0]); if (k < p1.length) history.push(p1[k][1] * n + p1[k][0]); }
    const s = replay({ n, winLen }, history);
    assert.equal(s.over, false, "hand-made position must not be over");
    return s;
}
const J = (a) => JSON.stringify(a);

test("win-in-1: completes the row (and takes it over blocking the opponent's four)", () => {
    const s = position(5, 4, [[0, 0], [1, 0], [2, 0]], [[0, 2], [1, 2], [2, 2]]);    // X to move, both have threes
    const r = solve(s);
    assert.equal(r.value, "win"); assert.equal(r.depth, 1); assert.equal(J(r.best), "[3]");
    const e = solveExhaustive(s);                                            // both engines agree
    assert.equal(e.value, "win"); assert.equal(e.depth, 1); assert.equal(J(e.best), "[3]");
    assert.equal(e.moveValues[13], "draw", "blocking instead of winning only draws");
});

test("must-block: the only non-losing move fills the opponent's completion cell", () => {
    const s = position(5, 4, [[4, 0], [4, 4], [0, 4]], [[0, 2], [1, 2], [2, 2]]);    // X to move, O threatens (3,2)
    const r = solve(s);
    assert.equal(J(r.best), "[13]");
    assert.notEqual(r.value, "unknown");
    assert.equal(r.method, "exhaustive");
    for (const [m, v] of Object.entries(r.moveValues)) if (m !== "13") assert.equal(v, "loss", `move ${m} loses`);
});

test("two completion cells of the opponent cannot both be blocked: proven loss", () => {
    const s = position(5, 4, [[4, 0], [4, 4], [0, 4]], [[1, 2], [2, 2], [3, 2]]);    // O threatens (0,2) and (4,2)
    const r = solveExhaustive(s);
    assert.equal(r.value, "loss"); assert.equal(r.depth, 2);
    assert.equal(proveWin(s).value, "unknown", "the threat search never claims a draw or loss");
});

test("win-in-2: the move that creates two completion cells at once, and only that move", () => {
    // X: (1,2),(2,2) in row 2 (O blocks (0,2)) and (3,4),(3,5) in column 3. X at (3,2) threatens
    // (4,2) in the row and the gap (3,3) in the column at the same time; every other move
    // makes at most one threat, which O simply blocks.
    const s = position(6, 4, [[1, 2], [2, 2], [3, 4], [3, 5]], [[0, 2], [4, 5], [5, 0], [0, 5]]);
    const r = solve(s);
    assert.equal(r.method, "threat");
    assert.equal(r.value, "win"); assert.equal(r.depth, 3); assert.equal(J(r.best), "[15]");
});

test("win-in-3 on 9×9: a four that forces a block, then an open four (threat search proof)", () => {
    // O has the four-three shape; X has the same number of stones plus one, so O is to move
    const s = position(9, 5, [[1, 4], [3, 3], [5, 3], [7, 7], [8, 0], [0, 0]], [[2, 4], [3, 4], [4, 4], [4, 5], [4, 6]]);
    assert.equal(s.current, 1);
    const r = solve(s);
    assert.equal(r.method, "threat");
    assert.equal(r.value, "win");
    assert.ok(r.depth === 3 || r.depth === 5, "forced within five plies");
    assert.ok(r.best.length >= 1 && r.best.every((i) => s.cells[i] === -1));
});

test("forced draw on a 3×3 winLen-3 board: O must take an edge, every corner loses", () => {
    const s = position(3, 3, [[0, 0], [2, 2]], [[1, 1]]);                     // tic-tac-toe, O to move
    const r = solve(s);
    assert.equal(r.method, "exhaustive");
    assert.equal(r.value, "draw"); assert.equal(r.depth, "exhaustive");
    assert.equal(J(r.best), "[1,3,5,7]");
    for (const m of [2, 6]) assert.equal(r.moveValues[m], "loss");
});

test("returns ALL optimal moves: an open three has two winning extensions", () => {
    const s = position(7, 5, [[2, 3], [3, 3], [4, 3]], [[0, 0], [6, 0], [0, 6]]);   // X to move
    const r = solve(s);
    assert.equal(r.value, "win"); assert.equal(r.depth, 3);
    assert.equal(J(r.best), "[22,26]", "both (1,3) and (5,3) make an open four");
});

test("symmetric positions give symmetric answers (all 8 symmetries, both engines)", () => {
    const base = { n: 5, winLen: 4, history: [6, 0, 7, 1, 12, 20, 18, 24] };         // some tactical 5×5 position
    const s0 = replay(base, base.history);
    const r0 = solveExhaustive(s0);
    assert.notEqual(r0.value, "unknown");
    for (const map of symmetries(5)) {
        const s = replay(base, base.history.map((i) => map[i]));
        const r = solveExhaustive(s);
        assert.equal(r.value, r0.value); assert.equal(r.depth, r0.depth);
        assert.equal(J(r.best), J(r0.best.map((i) => map[i]).sort((a, b) => a - b)));
        assert.equal(canonical(s.cells, 5), canonical(s0.cells, 5));
    }
});

test("exhaustive and threat search agree on every won small position of a random game", () => {
    const rng = (() => { let a = 12345; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; })();
    let checked = 0;
    for (let g = 0; g < 4; g++) {
        const s = mk({ n: 5, winLen: 4 });
        while (!s.over) {
            if (s.history.length >= 6) {
                const t = proveWin(s), e = solveExhaustive(s, { maxNodes: 400_000, classify: false });
                if (e.value === "win" && e.depth <= 5) { assert.equal(t.value, "win"); assert.equal(t.depth, e.depth); assert.equal(J(t.best), J(e.best)); checked++; }
                if (t.value === "win" && e.value !== "unknown") { assert.equal(e.value, "win"); assert.equal(e.depth, t.depth); }
            }
            const legal = FiveRules.legalMoves(s);
            play(s, legal[Math.floor(rng() * legal.length)]);
        }
    }
    assert.ok(checked >= 3, `compared ${checked} won positions`);
});

/* ---------- puzzles.json ---------- */
const DOC = JSON.parse(readFileSync(new URL("./puzzles.json", import.meta.url), "utf8"));

test("puzzles.json: format, ≥ 100 puzzles, unique sequential ids, required tags present", () => {
    assert.equal(DOC.game, "five");
    assert.match(DOC.generated, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof DOC.solver, "string");
    assert.ok(DOC.puzzles.length >= 100, `${DOC.puzzles.length} puzzles`);
    const ids = new Set(DOC.puzzles.map((p) => p.id));
    assert.equal(ids.size, DOC.puzzles.length, "ids unique");
    DOC.puzzles.forEach((p, k) => assert.equal(p.id, `five-${String(k + 1).padStart(4, "0")}`));
    const tags = new Set(DOC.puzzles.flatMap((p) => p.tags));
    for (const t of ["win-in-1", "must-block", "win-in-2", "win-in-3", "draw", "endgame-exhaustive", "avoid-loss"]) assert.ok(tags.has(t), `tag ${t} present`);
    const sizes = new Set(DOC.puzzles.map((p) => `${p.config.n}/${p.config.winLen}`));
    for (const c of ["5/4", "6/4", "7/5", "9/5"]) assert.ok(sizes.has(c), `board ${c} present`);
    assert.ok(DOC.puzzles.some((p) => p.toMove === 0) && DOC.puzzles.some((p) => p.toMove === 1), "both colours to move");
});

test("puzzles.json: every puzzle replays legally, is not over, toMove matches, best moves are legal and non-empty", () => {
    for (const p of DOC.puzzles) {
        const s = replay(p.config, p.history);
        assert.equal(s.over, false, `${p.id} not over`);
        assert.equal(s.current, p.toMove, `${p.id} toMove`);
        assert.ok(["win", "draw"].includes(p.value), `${p.id} value`);
        assert.ok(p.best.length >= 1, `${p.id} best non-empty`);
        assert.ok(p.best.length < FiveRules.legalMoves(s).length, `${p.id} not every move is best`);
        for (const i of p.best) assert.equal(FiveRules.isLegal(s, i, s.current), true, `${p.id} best move ${i} legal`);
        assert.equal(J(p.best), J([...p.best].sort((a, b) => a - b)), `${p.id} best sorted`);
        if (p.value === "win") assert.ok(Number.isInteger(p.depth) && p.depth % 2 === 1, `${p.id} odd ply depth`);
        else assert.equal(p.depth, "exhaustive");
        if (p.tags.includes("win-in-1")) for (const i of p.best) { const t = replay(p.config, [...p.history, i]); assert.equal(t.winner, p.toMove, `${p.id}: ${i} wins now`); }
        if (p.tags.includes("must-block")) {
            const b = Board.fromState(s);
            assert.equal(b.threats(1 - s.current).length, 1, `${p.id}: exactly one enemy completion cell`);
            assert.equal(b.threats(s.current).length, 0, `${p.id}: no own win`);
        }
    }
});

test("puzzles.json: re-solving every puzzle reproduces value, depth and best (≈ 2 s for all)", () => {
    // the spec asks for a sample of 20; the whole set is cheap enough, so check all of it
    assert.ok(DOC.puzzles.length >= 20);
    for (const p of DOC.puzzles) {
        const r = solve(replay(p.config, p.history), { exhaustiveNodes: 1_000_000 });
        assert.equal(r.value, p.value, `${p.id} value`);
        assert.equal(r.depth, p.depth, `${p.id} depth`);
        assert.equal(J(r.best), J(p.best), `${p.id} best`);
    }
});
