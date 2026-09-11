/* The rules modules are pure: they run in a bare VM context without any DOM.
   This is also what a future bot would drive (legalMoves + place/settle/conclude). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../../", import.meta.url).pathname;
const FILES = ["client/lib/util.js", "client/games/rules.js", "client/games/chain-rules.js", "client/games/five-rules.js", "client/games/boxes-rules.js"];

function loadRules() {
    const ctx = vm.createContext({ document: undefined });
    for (const f of FILES) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
    return vm.runInContext("({ Rules, ChainRules, FiveRules, BoxesRules })", ctx);   // top-level consts are not context properties
}
const chain = (config) => { const { Rules, ChainRules } = loadRules(); return { R: ChainRules, s: ChainRules.create(config, Rules.base(config)) }; };
const five = (config) => { const { Rules, FiveRules } = loadRules(); return { R: FiveRules, s: FiveRules.create(config, Rules.base(config)) }; };
const boxes = (config) => { const { Rules, BoxesRules } = loadRules(); return { Rules, R: BoxesRules, s: BoxesRules.create(config, Rules.base(config)) }; };
function move(R, s, i) {
    const me = s.current;
    assert.equal(R.isLegal(s, i, me), true, `move ${i} legal for ${me}`);
    R.place(s, i, me);
    R.settle(s, me);
    const r = R.conclude(s, me);
    if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
    return r;
}

test("no DOM needed: Util/Rules/ChainRules/FiveRules/BoxesRules load in a bare context", () => {
    const { Rules, ChainRules, FiveRules, BoxesRules } = loadRules();
    assert.ok(Rules && ChainRules && FiveRules && BoxesRules);
    assert.equal(typeof ChainRules.legalMoves, "function");
    assert.equal(typeof BoxesRules.legalMoves, "function");
});

test("Rules.base + pass: rotation and rounds for 2 and 3 players", () => {
    const { Rules } = loadRules();
    const s = Rules.base({ n: 3, players: 3, startPlayer: 1 });
    assert.equal(JSON.stringify(s.movesBy), "[0,0,0]");
    Rules.pass(s); assert.equal(s.current, 2); assert.equal(s.round, 1);
    Rules.pass(s); assert.equal(s.current, 0); assert.equal(s.round, 2, "wrapping starts a new round");
    Rules.pass(s, [true, false, true]); assert.equal(s.current, 2, "eliminated player skipped");
    const t = Rules.base({ n: 3 });
    assert.equal(t.players, 2);
    Rules.pass(t); assert.equal(t.current, 1); Rules.pass(t); assert.equal(t.current, 0); assert.equal(t.round, 2);
});

test("chain: legalMoves, place, settle and conclude agree with the engine tests", () => {
    const { R, s } = chain({ n: 3 });
    assert.equal(R.legalMoves(s, 0).length, 9);
    move(R, s, 0); move(R, s, 8); move(R, s, 0);              // corner explodes into 1 and 3
    assert.equal(s.cells[0].count, 0); assert.equal(s.cells[1].owner, 0); assert.equal(s.cells[3].owner, 0);
    assert.equal(R.legalMoves(s, 1).length, 9 - 2, "p1 may not play on p0's two cells");
    assert.equal(s.current, 1); assert.equal(s.chainBest, 1); assert.equal(s.explosions, 1);
});

test("chain with 3 players: a player who lost every cell is skipped, last owner wins", () => {
    const { R, s } = chain({ n: 3, players: 3 });
    move(R, s, 8); move(R, s, 1); move(R, s, 4);              // p0 corner, p1 edge, p2 centre
    move(R, s, 8);                                            // p0 corner explodes: takes 5 (p1's? no: 5,7) -> 5 and 7
    assert.equal(s.current, 1, "rotation continues");
    move(R, s, 1); move(R, s, 4); move(R, s, 8);              // p0's corner explodes again: 5 and 7 grow
    assert.equal(s.over, false);
    // p1 (edge cell 1, cap 3) has 2 pieces; p1 explodes on its next move into 0, 2, 4 and converts p2's centre
    move(R, s, 1);
    assert.equal(s.cells[4].owner, 1, "centre converted by p1");
    const alive = R.tally(s).map((t, p) => t.cells > 0 || s.movesBy[p] === 0);
    assert.equal(alive[2], false, "p2 owns nothing after having moved");
    assert.equal(s.current, 0, "p2 is skipped: after p1 comes p0");
});

test("chain: chain rule wins at the configured length (instant path)", () => {
    const { R, s } = chain({ n: 3, chainRule: true, chainLen: 2 });
    for (const i of [0, 1, 3, 1, 6, 8]) move(R, s, i);
    const r = move(R, s, 0);
    assert.equal(r.winner, 0); assert.match(r.why, /Chain reaction of 2/);
});

test("five: lineThrough, bestRow, win, draw and legalMoves", () => {
    const { R, s } = five({ n: 5, winLen: 4 });
    for (const i of [0, 5, 1, 6, 2, 7]) move(R, s, i);
    assert.equal(R.bestRow(s, 0), 3); assert.equal(R.lineThrough(s, 6).len, 3);
    assert.equal(R.legalMoves(s).length, 25 - 6);
    const r = move(R, s, 3);
    assert.equal(r.winner, 0); assert.equal(JSON.stringify(s.winLine.sort()), "[0,1,2,3]");
    const d = five({ n: 3, winLen: 3 });
    for (const i of [1, 0, 2, 5, 3, 6, 4, 7]) move(d.R, d.s, i);   // the last window (row 2) stays open until the last stone
    const full = move(d.R, d.s, 8);
    assert.equal(full.winner, -1, "full board is a draw"); assert.match(full.why, /full/i);
});

// 9×9 / 5 stones that block every window of 5 for both colours while 36 cells stay empty:
// rows 2, 4, 6 in every column (colours alternating along rows, columns and diagonals)
// plus columns 2, 4, 6 in the other rows (a, b, a per row). Returned as [cell, colour].
function deadNine() {
    const n = 9, stones = [];
    for (const y of [2, 4, 6]) for (let x = 0; x < n; x++) stones.push([y * n + x, (x + y / 2 + 1) % 2]);
    [0, 1, 3, 5, 7, 8].forEach((y, k) => { const a = k % 2; for (const x of [2, 4, 6]) stones.push([y * n + x, x === 4 ? 1 - a : a]); });
    return stones;
}
// a legal move order: player 0 first, alternating
function interleave(stones) {
    const p0 = stones.filter((s) => s[1] === 0).map((s) => s[0]), p1 = stones.filter((s) => s[1] === 1).map((s) => s[0]);
    assert.ok(p0.length === p1.length || p0.length === p1.length + 1, `playable counts (${p0.length}/${p1.length})`);
    const seq = [];
    for (let k = 0; k < p0.length; k++) { seq.push(p0[k]); if (k < p1.length) seq.push(p1[k]); }
    return seq;
}

test("five: draw as soon as no line can be completed any more (#18)", () => {
    // 3×3: after 8 stones every window of 3 holds both colours → draw with a cell still empty
    const d = five({ n: 3, winLen: 3 });
    for (const i of [0, 1, 2, 4, 3, 5, 7]) assert.equal(move(d.R, d.s, i), null);
    const r = move(d.R, d.s, 6);
    assert.equal(r.winner, -1); assert.match(r.why, /No line can be completed/);
    assert.equal(d.s.history.length, 8);
    assert.equal(d.R.canWin(d.s, 0), false); assert.equal(d.R.canWin(d.s, 1), false);
    // 9×9 / 5: 45 stones block every window of 5 for both colours; ≥ 36 cells stay empty
    const n = 9, stones = deadNine();
    assert.equal(stones.length, 45);
    const seq = interleave(stones);
    const g = five({ n, winLen: 5 });
    let res = null;
    for (const i of seq) { res = move(g.R, g.s, i); if (res) break; }
    assert.ok(res && res.winner === -1, "draw"); assert.match(res.why, /No line can be completed/);
    assert.ok(g.s.cells.filter((c) => c === -1).length >= 36, `many empties left (${g.s.history.length} stones)`);
    assert.equal(g.R.canWin(g.s, 0), false); assert.equal(g.R.canWin(g.s, 1), false);
    // one stone less at (0,2): column 0 (rows 0–4) still has a window for Amber, who owns
    // (0,4) → the game goes on to the last stone, Cyan has no window left
    const h = five({ n, winLen: 5 });
    for (const i of interleave(stones.filter((s) => s[0] !== 2 * n))) assert.equal(move(h.R, h.s, i), null, `move ${i} keeps the game going`);
    assert.equal(h.s.history.length, 44);
    assert.equal(h.R.canWin(h.s, 1), true, "Amber can still fill column 0 (rows 0–4)");
    assert.equal(h.R.canWin(h.s, 0), false, "Cyan has no window left");
});

/* ---------- Dots and Boxes (boxes) ---------- */
test("boxes: line numbering round-trips, a box knows its four lines and a line its one or two boxes", () => {
    const { R } = boxes({ n: 3 });
    for (const n of [2, 3, 4, 5, 10]) {
        assert.equal(R.edgeCount(n), 2 * n * (n + 1), `n=${n}: 2n(n+1) lines`);
        assert.equal(R.hCount(n), n * (n + 1), "half of them horizontal");
        const seen = new Set();
        for (let b = 0; b < n * n; b++) {
            const es = R.edgesOf(n, b);
            assert.equal(es.length, 4);
            for (const e of es) { assert.ok(e >= 0 && e < R.edgeCount(n)); assert.ok(R.boxesOf(n, e).includes(b), `line ${e} knows box ${b}`); seen.add(e); }
        }
        assert.equal(seen.size, R.edgeCount(n), "every line belongs to a box");
        for (let e = 0; e < R.edgeCount(n); e++) {
            const bs = R.boxesOf(n, e);
            assert.ok(bs.length === 1 || bs.length === 2, `line ${e} touches one or two boxes`);
            for (const b of bs) assert.ok(R.edgesOf(n, b).includes(e));
        }
        // the rim lines are exactly the ones with a single box: 4n of them
        let rim = 0;
        for (let e = 0; e < R.edgeCount(n); e++) if (R.boxesOf(n, e).length === 1) rim++;
        assert.equal(rim, 4 * n, `n=${n}: 4n rim lines`);
    }
});

test("boxes: closing a box keeps the turn, everything else passes it", () => {
    const { R, s } = boxes({ n: 2 });
    assert.equal(s.cells.length, 12); assert.equal(s.boxes.length, 4);
    assert.equal(JSON.stringify(s.scores), "[0,0]");
    // box 0 = lines 0, 2, 6, 7
    move(R, s, 0); assert.equal(s.current, 1);
    move(R, s, 2); assert.equal(s.current, 0);
    move(R, s, 6); assert.equal(s.current, 1);
    assert.equal(R.sides(s, 0), 3);
    assert.equal(R.captures(s, 7), 1);
    move(R, s, 7);
    assert.equal(s.boxes[0], 1, "the box belongs to the mover");
    assert.equal(JSON.stringify(s.scores), "[0,1]");
    assert.equal(s.current, 1, "and the mover goes again");
    assert.equal(s.again, true);
    assert.equal(JSON.stringify(s.lastBoxes), "[0]");
});

test("boxes: one line can close two boxes at once", () => {
    const { R, s } = boxes({ n: 2 });
    // boxes 0 and 1 share line 7; give both three sides, then draw 7
    for (const i of [0, 2, 6, 1, 3, 8]) move(R, s, i);
    assert.equal(R.sides(s, 0), 3); assert.equal(R.sides(s, 1), 3);
    assert.equal(R.captures(s, 7), 2);
    move(R, s, 7);
    assert.equal(JSON.stringify(s.lastBoxes), "[0,1]");
    assert.equal(s.scores[s.current], 2, "both boxes to the mover, who goes again");
});

test("boxes: the game ends when every line is drawn, most boxes wins, equal is a draw", () => {
    const { R, s } = boxes({ n: 2 });
    let result = null;
    for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 7, 10]) { result = move(R, s, i); if (result) break; }
    assert.ok(result, "the last line ends it");
    assert.equal(s.history.length, 12);
    assert.equal(s.scores[0] + s.scores[1], 4);
    if (s.scores[0] === s.scores[1]) { assert.equal(result.winner, -1); assert.equal(result.why, "Tied!"); }
    else { assert.equal(result.winner, s.scores[0] > s.scores[1] ? 0 : 1); assert.match(result.why, /^\d+ boxe?s?!$/); }
});

test("boxes: safe lines, capturing lines and the chain a capture hangs off", () => {
    const { R, s } = boxes({ n: 3 });
    assert.equal(R.safeMoves(s).length, s.cells.length, "on an empty board every line is safe");
    assert.equal(R.capturingMoves(s).length, 0);
    // box 0 (lines 0, 3, 12, 13) gets two sides, so its other two lines stop being safe
    move(R, s, 0); move(R, s, 12);
    assert.equal(R.sides(s, 0), 2);
    assert.ok(!R.safeMoves(s).includes(3) && !R.safeMoves(s).includes(13), "a third side hands the box over");
    move(R, s, 3);                                     // hands box 0 over
    assert.equal(R.captures(s, 13), 1);
    assert.equal(R.isFreeCapture(s, 13), true, "nothing hangs off it");
    assert.equal(JSON.stringify(R.chainFrom(s, 0).boxes), "[0]");
});

test("boxes with three players: the turn rotates, a box still gives another turn, most boxes wins", () => {
    const { Rules, R, s } = boxes({ n: 2, players: 3 });
    assert.equal(JSON.stringify(s.scores), "[0,0,0]");
    move(R, s, 0); assert.equal(s.current, 1);
    move(R, s, 1); assert.equal(s.current, 2);
    move(R, s, 4); assert.equal(s.current, 0);
    move(R, s, 2); assert.equal(s.current, 1);
    move(R, s, 6); assert.equal(s.current, 2);
    move(R, s, 7);                                     // closes box 0 for player 2
    assert.equal(s.boxes[0], 2); assert.equal(s.current, 2, "player 2 goes again");
    // an eliminated seat is skipped and cannot win
    Rules.eliminate(s, 2, "Out of time!");
    assert.equal(s.out[2], true);
    assert.notEqual(s.current, 2, "the turn moved off the eliminated seat");
    let result = null;
    for (const i of R.legalMoves(s)) { result = move(R, s, i); if (result) break; }
    assert.ok(result && result.winner !== 2, "the seat that is out cannot win");
});

test("boxes: replay of a record equals playing it move by move", () => {
    const seq = [0, 12, 3, 13, 1, 4, 14, 15, 2, 5, 16, 17, 6, 7, 8, 9, 10, 11, 18, 19, 20, 21, 22, 23];
    const a = boxes({ n: 3 });
    for (const i of seq) { if (a.s.over) break; move(a.R, a.s, i); }
    const b = boxes({ n: 3 });
    b.Rules.apply(b.R, b.s, seq);
    assert.equal(JSON.stringify(b.s.cells), JSON.stringify(a.s.cells));
    assert.equal(JSON.stringify(b.s.boxes), JSON.stringify(a.s.boxes));
    assert.equal(JSON.stringify(b.s.scores), JSON.stringify(a.s.scores));
    assert.equal(b.s.winner, a.s.winner); assert.equal(b.s.current, a.s.current);
});
