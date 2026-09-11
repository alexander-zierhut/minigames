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

test("registry: 5–25 cells, default 11 × 11 (#16), the win length is the minimum", () => {
    const { w } = fresh();
    const def = w.eval("Games.get('five')");
    assert.equal(def.size.min, 5); assert.equal(def.size.max, 25); assert.equal(def.size.default, 11);
    assert.equal(def.minSize({ winLen: 7 }), 7); assert.equal(def.minSize({ winLen: 3 }), 5);
});

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
    // 3×3, winLen 3: row 2 stays open for Amber until Cyan's last stone fills the board
    const { G, calls } = fresh({ n: 3, winLen: 3 });
    G.replay([1, 0, 2, 5, 3, 6, 4, 7, 8]);
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, -1);
    assert.equal(G.state.history.length, 9);
    assert.match(calls.finish.why, /full/i);
});

test("draw as soon as no line can be completed any more, with empty cells left (#18)", () => {
    // 5x5, winLen 5, a known draw pattern (no 5 in any line): every window holds both
    // colours long before the board is full
    const { w, G, calls } = fresh({ n: 5, winLen: 5 });
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
    assert.match(calls.finish.why, /No line can be completed any more/);
    assert.ok(G.state.history.length < 25, `ended with ${25 - G.state.history.length} empty cells`);
    assert.equal(w.document.getElementById("overlay-title").textContent, "Draw!");
    assert.match(w.document.getElementById("overlay-sub").textContent, /No line can be completed any more/);
    assert.equal(w.document.getElementById("turn-name").textContent, "Draw");
    assert.ok(w.document.getElementById("board").classList.contains("over"));
    // the animated path ends the same way at the same move
    const live = fresh({ n: 5, winLen: 5 });
    return (async () => {
        for (const i of seq) { if (live.G.state.over) break; assert.equal(await live.G.play(i), true); }
        assert.equal(live.G.state.history.length, G.state.history.length);
        assert.equal(live.G.state.winner, -1);
        assert.equal(live.calls.finish.why, calls.finish.why);
        assert.equal(live.G.hash(), G.hash(), "replay == play");
    })();
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
    assert.equal(d.getElementById("p0-stat-1").textContent, "3", "best row");
    assert.equal(d.getElementById("p1-stat-0").textContent, "2", "stones");
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
    assert.ok(Math.abs(pct(0) - 50) <= 10 && pct(0) + pct(1) === 100, `roughly even at the start (${pct(0)})`);
    await playAll(G, [0, 40, 1, 41, 2, 50, 3]);       // p0 four in a row vs p1 two
    assert.ok(pct(0) >= 0 && pct(0) <= 100 && pct(0) + pct(1) === 100, `a percentage pair (${pct(0)})`);   // a calibrated evaluator decides how much a blockable four is worth
    G.finish(-1, "The board is full.");
    assert.equal(pct(0), 50); assert.equal(pct(1), 50);
});

test("Yavalath rule: one less than winLen in a row loses; with two players the other one wins", async () => {
    const { G, calls } = fresh({ n: 7, winLen: 4, yavalath: true });
    assert.equal(G.state.yavalath, true); assert.equal(JSON.stringify(G.state.dead), "[false,false]");
    await playAll(G, [0, 7, 1, 8, 2]);                         // p0 makes three in a row: loses
    assert.equal(G.state.over, true); assert.equal(G.state.winner, 1);
    assert.match(calls.finish.why, /3 in a row loses/);
    assert.equal(JSON.stringify([...G.state.winLine].sort((a, b) => a - b)), "[0,1,2]", "the losing line is marked");
    // a stone that makes four wins even though it also makes a three somewhere else
    const g2 = fresh({ n: 7, winLen: 4, yavalath: true });
    await playAll(g2.G, [0, 21, 1, 22, 3, 28, 2]);             // 0 1 _ 3 then 2 completes four
    assert.equal(g2.G.state.winner, 0); assert.match(g2.calls.finish.why, /4 in a row/);
    // two in a row is nothing (winLen 4: only exactly three loses)
    const g3 = fresh({ n: 7, winLen: 4, yavalath: true });
    await playAll(g3.G, [0, 21, 1]);
    assert.equal(g3.G.state.over, false);
    // without the rule three is harmless
    const g4 = fresh({ n: 7, winLen: 4 });
    await playAll(g4.G, [0, 7, 1, 8, 2]);
    assert.equal(g4.G.state.over, false);
});

test("Yavalath rule with three players: the one who makes the losing line is out, the rest play on, the last one wins", async () => {
    const { G, w, calls } = fresh({ n: 7, winLen: 4, yavalath: true, players: 3 });
    await playAll(G, [0, 14, 21, 1, 15, 22, 2]);               // p0: 0 1 2 = three → out
    assert.equal(G.state.over, false);
    assert.equal(JSON.stringify(G.state.dead), "[true,false,false]");
    assert.equal(G.state.current, 1, "p0 is skipped");
    assert.equal(w.document.getElementById("p0-stat-1").textContent, "3 in a row", "HUD says why");
    await playAll(G, [30, 40]);                                 // p1 and p2 play harmless stones; p0 is skipped again
    assert.equal(G.state.current, 1);
    await playAll(G, [31, 23]);                                 // p1: 30 31; p2: 21 22 23 = three → out, p1 is the last one
    assert.equal(G.state.over, true); assert.equal(G.state.winner, 1);
    assert.equal(JSON.stringify(G.state.dead), "[true,false,true]");
    assert.match(calls.finish.why, /3 in a row loses/);
    // replay == play with the rule (deterministic elimination inside the rules)
    const R = w.eval("Rules").replay(G.record());
    assert.equal(JSON.stringify(R.dead), JSON.stringify(G.state.dead)); assert.equal(R.winner, 1);
});

test("Yavalath rule: Sensei plays it, with its own benchmark numbers and its own calibration", () => {
    const w = loadDom(); const B = w.eval("Bots"); const O = w.eval("Opponent"); const S = w.eval("Settings");
    const YAV = { yavalath: true };
    assert.equal(B.botFor("five").id, "sensei-five");
    assert.equal(B.botFor("five", { yavalath: false }).id, "sensei-five");
    assert.equal(B.botFor("five", YAV).id, "sensei-five");
    assert.equal(B.supports("sensei-five", YAV), true); assert.equal(B.supports("random-five", YAV), true);
    assert.equal(B.estimator("five", YAV).bot, "sensei-five");
    assert.equal(B.estimator("five", {}).bot, "sensei-five");
    // the rule variant has its own row in benchmark.js, and the plain game keeps the plain one
    assert.equal(B.variantOf("sensei-five", YAV), "yavalath");
    assert.equal(B.variantOf("sensei-five", {}), null);
    const plain = B.benchmarkOf("sensei-five"), variant = B.benchmarkOf("sensei-five", YAV);
    assert.equal(plain.variant, undefined); assert.equal(variant.variant, "yavalath");
    assert.equal(variant.commit, plain.commit, "the stamp comes from the base result");
    assert.ok(variant.puzzles.total >= 100 && variant.puzzles.total !== plain.puzzles.total, "its own puzzle set");
    assert.notEqual(B.calibrationOf("sensei-five", YAV).scale, B.calibrationOf("sensei-five").scale);
    S.init({}); O.init({});
    assert.equal(O.current("five", YAV).id, "sensei-five");
    assert.match(O.summary("five", YAV), new RegExp(`${variant.score} % vs Random`), "the variant's score in the lobby row");
    S.selectGame("five");
    assert.equal(S.read().yavalath, false);
    w.document.getElementById("set-yavalath").value = "on";
    w.document.getElementById("set-yavalath").dispatchEvent(new w.Event("change"));
    assert.equal(S.read().yavalath, true);
    assert.match(S.summary(), /5 in a row · no timer · 4 in a row loses$/);
    w.close();
});
