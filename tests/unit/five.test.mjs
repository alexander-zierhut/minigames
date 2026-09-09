import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks } from "./dom.mjs";

function fresh(config = {}) {
    const w = loadDom();
    const G = w.eval("FiveGame");
    const { h, calls } = hooks();
    G.newGame({ game: "five", n: 9, winLen: 5, timer: 0, ...config, startPlayer: 0 }, h);
    return { w, G, calls };
}
async function playAll(G, seq) { for (const i of seq) { assert.equal(await G.play(i), true, `move ${i} legal`); } }

test("horizontal five wins with the exact line", async () => {
    const { G, calls } = fresh();
    await playAll(G, [0, 9, 1, 10, 2, 11, 3, 12, 4]);
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, 0);
    assert.equal(JSON.stringify([...G.state.winLine].sort((a, b) => a - b)), "[0,1,2,3,4]");
    assert.match(calls.finish.why, /5 in a row/);
});

test("vertical and diagonal lines win", async () => {
    let g = fresh();
    await playAll(g.G, [0, 1, 9, 2, 18, 3, 27, 4, 36]);
    assert.equal(g.G.state.winner, 0, "vertical");
    g = fresh();
    await playAll(g.G, [0, 1, 10, 2, 20, 3, 30, 4, 40]);
    assert.equal(g.G.state.winner, 0, "diagonal");
    g = fresh();
    await playAll(g.G, [8, 0, 16, 1, 24, 2, 32, 3, 40]);
    assert.equal(g.G.state.winner, 0, "anti-diagonal");
});

test("second player can win too", async () => {
    const { G } = fresh();
    await playAll(G, [40, 0, 41, 1, 42, 2, 43, 3, 50, 4]);
    assert.equal(G.state.winner, 1);
});

test("winLen 6: five in a row is not enough, six is", async () => {
    const { G } = fresh({ n: 7, winLen: 6 });
    await playAll(G, [0, 7, 1, 8, 2, 9, 3, 10, 4, 11]);
    assert.equal(G.state.over, false, "five is not a win with winLen 6");
    await G.play(5);
    assert.equal(G.state.winner, 0);
    assert.equal(G.state.winLine.length, 6);
});

test("longer than winLen also wins (fill the gap)", async () => {
    const { G } = fresh();
    await playAll(G, [0, 9, 1, 20, 3, 31, 4, 42, 5, 53]);  // p0: 0 1 _ 3 4 5, p1 scattered
    await G.play(2);
    assert.equal(G.state.winner, 0);
    assert.equal(G.state.winLine.length, 6);
});

test("occupied cells are illegal, game over blocks moves", async () => {
    const { G } = fresh();
    await G.play(40);
    assert.equal(G.isLegal(40, 1), false);
    assert.equal(await G.play(40), false);
    assert.equal(G.state.current, 1);
});

test("full board without a line is a draw", () => {
    // 5x5, winLen 5, a known draw pattern (no 5 in any line)
    const { G, calls } = fresh({ n: 5, winLen: 5 });
    const pattern = [
        0, 0, 1, 1, 0,
        1, 1, 0, 0, 1,
        0, 0, 1, 1, 0,
        1, 1, 0, 0, 1,
        0, 0, 1, 1, 0,
    ];
    const p0 = [], p1 = [];
    pattern.forEach((v, i) => (v === 0 ? p0 : p1).push(i));
    // interleave so that colours match: p0 moves first
    const seq = [];
    for (let k = 0; k < 13; k++) { seq.push(p0[k]); if (p1[k] !== undefined) seq.push(p1[k]); }
    G.replay(seq);
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, -1);
    assert.match(calls.finish.why, /full/i);
});

test("replay matches play", async () => {
    const seq = [40, 41, 31, 32, 49, 50, 22, 23, 58];
    const a = fresh(); await playAll(a.G, seq);
    const b = fresh(); b.G.replay(seq);
    assert.equal(JSON.stringify(b.G.state.cells), JSON.stringify(a.G.state.cells));
    assert.equal(b.G.state.winner, a.G.state.winner);
    assert.equal(JSON.stringify(b.G.state.winLine), JSON.stringify(a.G.state.winLine));
});

test("HUD: best row, stones, draw title", async () => {
    const { w, G } = fresh();
    await playAll(G, [0, 40, 1, 41, 2]);
    const d = w.document;
    assert.equal(d.getElementById("p0-pieces").textContent, "3", "best row");
    assert.equal(d.getElementById("p1-cells").textContent, "2", "stones");
    assert.equal(d.getElementById("p0-pct").textContent, "3 / 5");
    assert.equal(d.querySelectorAll(".stone.last").length, 1);
    G.finish(-1, "The board is full.");
    assert.equal(d.getElementById("overlay-title").textContent, "Draw!");
    assert.ok(d.getElementById("board").classList.contains("over"));
});

test("win chance: even at the start, grows with a longer row, exact on a draw", async () => {
    const { w, G } = fresh();
    const d = w.document;
    const pct = (k) => parseInt(d.getElementById(`p${k}-win-pct`).textContent, 10);
    assert.ok(Math.abs(pct(0) - 50) <= 5 && pct(0) + pct(1) === 100);
    await playAll(G, [0, 40, 1, 41, 2, 50, 3]);       // p0 four in a row vs p1 two
    assert.ok(pct(0) > 70, `p0 clearly ahead (${pct(0)})`);
    G.finish(-1, "The board is full.");
    assert.equal(pct(0), 50); assert.equal(pct(1), 50);
});
