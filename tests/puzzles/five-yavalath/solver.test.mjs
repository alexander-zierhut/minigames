/* Five Wins with the Yavalath rule (winLen wins, winLen - 1 loses): the solver's proofs on
   hand-made positions, and the integrity of puzzles.json (replays legally, not over, legal
   best moves, ≥ 100, unique ids, every puzzle re-solves to the same answer).
   node --test tests/puzzles/five-yavalath/solver.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { solve, solveExhaustive, proveWin, Board } from "../../../scripts/puzzles/five/solver.mjs";

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
    const s = replay({ n, winLen, yavalath: true }, history);
    assert.equal(s.over, false, "hand-made position must not be over");
    return s;
}
const J = (a) => JSON.stringify(a);

/* ---------- the board knows the rule ---------- */
test("Board: run / suicidal / hasSafe match the rules (7×7, 4 wins, 3 loses)", () => {
    // X 1,2 and 4 in row 3 (cells 22, 23, 25), O 3,1 and 3,2 in column 3 (cells 10, 17)
    const s = position(7, 4, [[1, 3], [2, 3], [0, 6]], [[3, 1], [3, 2], [6, 6]]);
    const b = Board.fromState(s);
    assert.equal(b.yav, true);
    assert.equal(b.run(24, 0), 3, "filling the gap gives X three in a row");
    assert.equal(b.run(24, 1), 3, "…and O three in the column");
    assert.equal(b.suicidal(24, 0), true);
    assert.equal(b.suicidal(24, 1), true);
    assert.equal(b.suicidal(21, 0), true, "extending 22,23 to the left makes three as well");
    assert.equal(b.suicidal(25, 0), false, "the far stone leaves a gap: only one in a row");
    assert.equal(b.hasSafe(0), true);
    assert.equal(b.safeMoves([21, 24, 25], 0).length, 1);
    // a board without the rule never calls anything suicidal
    const plain = new Board(s.n, s.winLen, s.cells, s.current, false);
    assert.equal(plain.suicidal(24, 0), false);
    assert.equal(J(plain.safeMoves([21, 24, 25], 0)), J([21, 24, 25]));
});

/* ---------- proofs on hand-made positions ---------- */
test("win-in-1: completing winLen still wins, even next to a row of winLen - 1", () => {
    // X 0,1 and 3 in the top row: 2 completes the four; 21 would only make three for O
    const s = position(7, 4, [[0, 0], [1, 0], [3, 0]], [[0, 3], [2, 3], [0, 5]]);
    const r = solve(s, { exhaustiveNodes: 0 });
    assert.equal(r.value, "win"); assert.equal(r.depth, 1); assert.equal(J(r.best), J([2]));
});

test("the winning idea: build the four so that the only block makes the opponent three", () => {
    // X 1,3 and 2,3 in row 3; O 3,1 and 3,2 in column 3. X 4,3 makes X X _ X: O has to take
    // the gap (3,3) and that is O's third stone in the column.
    const s = position(7, 4, [[1, 3], [2, 3], [0, 6]], [[3, 1], [3, 2], [6, 6]]);
    const r = proveWin(Board.fromState(s));
    assert.equal(r.value, "win"); assert.equal(r.depth, 3); assert.equal(J(r.best), J([25]));
    // and that is exactly the mechanism: after 25 the only completion cell is 24, which loses for O
    const after = replay({ n: 7, winLen: 4, yavalath: true }, [...s.history, 25]);
    const b = Board.fromState(after);
    assert.equal(after.current, 1);
    assert.equal(J(b.threats(0)), J([24]));
    assert.equal(b.suicidal(24, 1), true);
    // taking the gap really does end the game against O
    const blocked = replay({ n: 7, winLen: 4, yavalath: true }, [...after.history, 24]);
    assert.equal(blocked.over, true); assert.equal(blocked.winner, 0);
    assert.match(blocked.finishWhy, /3 in a row loses/);
});

test("no safe move at all is a loss on the spot (3×3, 3 wins, 2 loses)", () => {
    const s = replay({ n: 3, winLen: 3, yavalath: true }, [0, 4, 8]);          // O owns the centre, X the corners
    assert.equal(s.over, false); assert.equal(s.current, 1);
    const b = Board.fromState(s);
    assert.equal(b.hasSafe(1), false, "every empty cell touches O's centre stone");
    const r = solveExhaustive(b);
    assert.equal(r.value, "loss"); assert.equal(r.depth, 1);
    assert.equal(J(r.best), J([1, 2, 3, 5, 6, 7]), "every move loses, so all of them are 'best'");
    for (const v of Object.values(r.moveValues)) assert.equal(v, "loss");
});

test("an exhaustive solve of a small board is a proven value (4×4, 3 wins, 2 loses)", () => {
    const s = replay({ n: 4, winLen: 3, yavalath: true }, [0]);
    const r = solveExhaustive(Board.fromState(s));
    assert.equal(r.value, "loss"); assert.equal(r.depth, 6);
    assert.ok(r.best.length > 1 && r.best.every((m) => FiveRules.isLegal(s, m, s.current)));
    assert.equal(proveWin(Board.fromState(s)).value, "unknown", "the threat search never claims a draw or loss");
});

test("without the rule the same positions are harmless", () => {
    // three in a row is nothing special in Five Wins: no loss, and the block is just a block
    const yav = position(7, 4, [[1, 3], [2, 3], [0, 6]], [[3, 1], [3, 2], [6, 6]]);
    const plain = replay({ n: 7, winLen: 4 }, yav.history);
    const r = proveWin(Board.fromState(plain));
    assert.notEqual(J(r.best), J([25]), "the Yavalath trap is not a win under the plain rules");
});

/* ---------- puzzles.json ---------- */
const DOC = JSON.parse(readFileSync(new URL("./puzzles.json", import.meta.url), "utf8"));

test("puzzles.json: format, ≥ 100 puzzles, unique sequential ids, required tags present", () => {
    assert.equal(DOC.game, "five");
    assert.equal(DOC.variant, "yavalath");
    assert.match(DOC.generated, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof DOC.solver, "string");
    assert.ok(DOC.puzzles.length >= 100, `${DOC.puzzles.length} puzzles`);
    assert.equal(new Set(DOC.puzzles.map((p) => p.id)).size, DOC.puzzles.length, "ids unique");
    DOC.puzzles.forEach((p, k) => assert.equal(p.id, `five-yav-${String(k + 1).padStart(4, "0")}`));
    for (const p of DOC.puzzles) { assert.equal(p.config.yavalath, true); assert.equal(p.config.winLen, 4); }
    const tags = new Set(DOC.puzzles.flatMap((p) => p.tags));
    for (const t of ["win-in-1", "forced-three", "avoid-three", "win-in-2", "endgame-exhaustive", "draw"]) assert.ok(tags.has(t), `tag ${t} present`);
    const sizes = new Set(DOC.puzzles.map((p) => p.config.n));
    for (const n of [6, 7, 8, 9]) assert.ok(sizes.has(n), `board ${n} present`);
    assert.ok(DOC.puzzles.some((p) => p.toMove === 0) && DOC.puzzles.some((p) => p.toMove === 1), "both colours to move");
});

test("puzzles.json: every puzzle replays legally, is not over, toMove matches, best moves are legal and never lose at once", () => {
    for (const p of DOC.puzzles) {
        const s = replay(p.config, p.history);
        assert.equal(s.over, false, `${p.id} not over`);
        assert.equal(s.current, p.toMove, `${p.id} toMove`);
        assert.ok(["win", "draw"].includes(p.value), `${p.id} value`);
        assert.ok(p.best.length >= 1, `${p.id} best non-empty`);
        assert.ok(p.best.length < FiveRules.legalMoves(s).length, `${p.id} not every move is best`);
        assert.equal(J(p.best), J([...p.best].sort((a, b) => a - b)), `${p.id} best sorted`);
        const b = Board.fromState(s);
        for (const i of p.best) {
            assert.equal(FiveRules.isLegal(s, i, s.current), true, `${p.id} best move ${i} legal`);
            assert.equal(b.suicidal(i, s.current), false, `${p.id} best move ${i} does not make winLen - 1`);
        }
        if (p.value === "win") assert.ok(Number.isInteger(p.depth) && p.depth >= 1, `${p.id} ply depth`);
        else assert.equal(p.depth, "exhaustive");
        if (p.tags.includes("win-in-1")) for (const i of p.best) { const t = replay(p.config, [...p.history, i]); assert.equal(t.winner, p.toMove, `${p.id}: ${i} wins now`); }
        if (p.tags.includes("avoid-three")) assert.ok(FiveRules.legalMoves(s).some((i) => b.suicidal(i, s.current)), `${p.id}: a losing move exists`);
    }
});

test("puzzles.json: re-solving every puzzle reproduces value, depth and best", () => {
    for (const p of DOC.puzzles) {
        const r = solve(replay(p.config, p.history), { exhaustiveNodes: 1_000_000 });
        assert.equal(r.value, p.value, `${p.id} value`);
        assert.equal(r.depth, p.depth, `${p.id} depth`);
        assert.equal(J(r.best), J(p.best), `${p.id} best`);
    }
});
