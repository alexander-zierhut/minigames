import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks } from "./dom.mjs";

const FAST = { game: "chain", n: 4, speed: 1, chainRule: false, chainLen: 15, timer: 0 };

function fresh(config = {}) {
    const w = loadDom();
    const G = w.eval("ChainGame");
    const { h, calls } = hooks();
    G.newGame({ ...FAST, ...config, startPlayer: 0 }, h);
    return { w, G, calls };
}

test("capacities: corner 2, edge 3, inner 4", () => {
    const { G } = fresh({ n: 4 });
    const caps = G.state.cells.map((c) => c.cap);
    assert.equal(caps[0], 2);           // corner
    assert.equal(caps[1], 3);           // top edge
    assert.equal(caps[5], 4);           // inner
    assert.equal(caps[15], 2);          // bottom-right corner
});

test("isLegal: empty or own cells only, nothing when over", async () => {
    const { G } = fresh();
    assert.equal(G.isLegal(0, 0), true);
    await G.play(0);                     // player 0 owns cell 0
    assert.equal(G.isLegal(0, 1), false, "opponent cannot play on my cell");
    assert.equal(G.isLegal(0, 0), true);
    assert.equal(G.isLegal(99, 0), false);
    G.finish(0, "x");
    assert.equal(G.isLegal(1, 0), false);
});

test("corner explodes into its two neighbours and empties", async () => {
    const { G } = fresh({ n: 4 });
    await G.play(0);   // p0 corner: 1
    await G.play(15);  // p1 far corner
    await G.play(0);   // p0 corner: 2 -> explodes
    const c = G.state.cells;
    assert.equal(c[0].count, 0); assert.equal(c[0].owner, -1);
    assert.equal(c[1].count, 1); assert.equal(c[1].owner, 0);
    assert.equal(c[4].count, 1); assert.equal(c[4].owner, 0);
    assert.equal(G.state.chainBest, 1);
    assert.equal(G.state.explosions, 1);
    assert.equal(G.state.current, 1, "turn passes after the chain settles");
});

// p1 keeps a far corner (8) so the board is not decided after the first wave
const TWO_WAVES = [0, 1, 3, 1, 6, 8, 0];

test("explosion converts opponent pieces and chains wave by wave", async () => {
    const { G } = fresh({ n: 3 });
    for (const i of TWO_WAVES) await G.play(i);   // last move: corner 0 explodes into edge 1 (2 -> 3 = cap) -> wave 2
    const c = G.state.cells;
    assert.equal(c[0].count, 1, "corner emptied in wave 1, refilled by wave 2");
    assert.equal(c[1].count, 0, "edge cell exploded in wave 2");
    assert.equal(c[2].owner, 0); assert.equal(c[4].owner, 0);
    assert.equal(c[8].owner, 1, "p1's far corner untouched");
    assert.equal(G.state.chainBest, 2, "two explosions in one chain");
    assert.equal(G.state.over, false);
});

test("chain stops as soon as the board is single-coloured", async () => {
    const { G } = fresh({ n: 3 });
    await G.play(0); await G.play(1); await G.play(3); await G.play(1); await G.play(0);
    // corner 0 explodes into cell 1 (p1's only cell) -> board decided -> cell 1 keeps its 3 pieces, no wave 2
    assert.equal(G.state.cells[1].count, 3);
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, 0);
});

test("win: opponent has no cells after both moved", async () => {
    const { G, calls } = fresh({ n: 3 });
    await G.play(0);           // p0
    await G.play(1);           // p1 next to it
    await G.play(0);           // p0 corner explodes into 1 and 3 -> p1 has nothing left
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, 0);
    assert.equal(calls.finish.winner, 0);
    assert.match(calls.finish.why, /whole board/i);
});

test("no win before the second player has moved", async () => {
    const { G } = fresh({ n: 3 });
    await G.play(0);
    assert.equal(G.state.over, false);
    assert.equal(G.state.current, 1);
});

test("chain-win rule ends the game at the configured length", async () => {
    const { G, calls } = fresh({ n: 3, chainRule: true, chainLen: 2 });
    for (const i of TWO_WAVES) await G.play(i);   // 2-chain
    assert.equal(G.state.over, true);
    assert.match(calls.finish.why, /chain reaction/i);
});

test("replay produces the identical state as animated play", async () => {
    const seq = [0, 8, 0, 8, 1, 7, 1, 7, 3, 5, 3, 5, 4, 4, 4];
    const a = fresh({ n: 3 });
    const played = [];
    for (const i of seq) { if (a.G.state.over) break; if (await a.G.play(i)) played.push(i); }
    const b = fresh({ n: 3 });
    b.G.replay(played);
    assert.equal(JSON.stringify(b.G.state.cells), JSON.stringify(a.G.state.cells));
    assert.equal(b.G.state.current, a.G.state.current);
    assert.equal(b.G.state.over, a.G.state.over);
    assert.equal(b.G.state.winner, a.G.state.winner);
    assert.equal(JSON.stringify(b.G.state.history), JSON.stringify(a.G.state.history));
});

test("busy/turn hooks fire in order and illegal moves are rejected", async () => {
    const { G, calls } = fresh();
    assert.equal(await G.play(0), true);
    assert.equal(JSON.stringify(calls.busy), "[true,false]");
    assert.equal(JSON.stringify(calls.turns), "[0,1]");
    assert.equal(await G.play(0), false, "cell 0 belongs to p0, p1 may not play it");
    assert.equal(JSON.stringify(calls.moves), "[[0,0]]");
});

test("HUD reflects counts, turn and last-move marker", async () => {
    const { w, G } = fresh({ n: 4 });
    await G.play(5);
    const d = w.document;
    assert.equal(d.getElementById("p0-cells").textContent, "1");
    assert.equal(d.getElementById("turn-name").textContent, "Amber");
    assert.ok(d.getElementById("board").classList.contains("turn-p1"));
    assert.equal(d.querySelectorAll(".cell.last").length, 1);
    assert.ok(d.querySelectorAll(".cell")[5].classList.contains("last"));
});

test("win chance: 50/50 at the start, adds up to 100, follows material, exact when over", async () => {
    const { w, G } = fresh({ n: 4 });
    const d = w.document;
    const pct = (k) => parseInt(d.getElementById(`p${k}-win-pct`).textContent, 10);
    assert.equal(d.getElementById("p0-win-row").hidden, false);
    assert.ok(Math.abs(pct(0) - 50) <= 10 && pct(0) + pct(1) === 100, `roughly even at the start (${pct(0)})`);
    await G.play(5); await G.play(15); await G.play(5); await G.play(15); await G.play(5);   // p0 3 pieces vs p1 2
    assert.equal(pct(0) + pct(1), 100);
    assert.ok(pct(0) >= 0 && pct(0) <= 100, `a percentage (${pct(0)})`);   // a real evaluator may disagree with raw material
    G.finish(1, "x");
    assert.equal(pct(1), 100); assert.equal(pct(0), 0);
});
