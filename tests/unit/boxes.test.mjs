/* Dots and Boxes through the engine: the board the view builds, closing a box and going
   again, the end, the HUD model and that replay equals play. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks } from "./dom.mjs";

function fresh(config = {}) {
    const w = loadDom();
    const G = w.eval("BoxesGame");
    const { h, calls } = hooks();
    G.newGame({ game: "boxes", n: 2, players: 2, timer: 0, ...config, startPlayer: 0 }, h);
    return { w, G, calls, d: w.document };
}
async function playAll(G, seq) { for (const i of seq) assert.equal(await G.play(i), true, `line ${i} legal`); }
// 2 × 2 lines: h(r,c) = r*2+c (0…5), v(r,c) = 6 + r*3 + c (6…11)
const BOX0 = [0, 2, 6, 7];

test("registry: 2 to 10 boxes per side, default 5, the shared board size row and its summary", () => {
    const { w } = fresh();
    const def = w.eval("Games.get('boxes')");
    assert.equal(def.size.min, 2); assert.equal(def.size.max, 10); assert.equal(def.size.default, 5);
    assert.equal(JSON.stringify(def.size.presets), "[3,4,5,6,8]", "the sizes its dropdown offers");
    assert.equal(def.sizeLabel, undefined, "no label of its own any more: every game says Board size (2026-09-11)");
    assert.equal(def.title, "Dots and Boxes");
    assert.equal(JSON.stringify(def.players), '{"min":2,"max":4}');
    assert.equal(JSON.stringify(def.settings), "[]", "no rows of its own: the board size is the only setting");
    assert.equal(JSON.stringify(def.describeRules({ n: 5 })), '["25 boxes"]');
    const S = w.eval("Settings");
    S.init({});
    S.selectGame("boxes");
    assert.equal(w.document.getElementById("size-label").textContent, "Board size");
    assert.equal(w.document.getElementById("set-size").tagName, "SELECT", "a dropdown of the sizes this game offers");
    assert.match(S.summary(), /^5 × 5 · 25 boxes · no timer$/);
    assert.equal(S.read().game, "boxes");
    assert.equal(w.document.getElementById("size-hint").textContent, "(2–10)");
    w.close();
});

test("the board: dots, boxes and one clickable line per cell, in line order", () => {
    const { w, G, d } = fresh({ n: 3 });
    assert.equal(G.state.cells.length, 24, "2n(n+1) lines");
    assert.equal(G.state.boxes.length, 9);
    assert.equal(d.querySelectorAll("#board > .edge").length, 24);
    assert.equal(d.querySelectorAll("#board > .box").length, 9);
    assert.equal(d.querySelectorAll("#board > .dot").length, 16, "(n+1)² dots");
    assert.equal(d.getElementById("board").className, "boxes turn-p0");
    assert.ok(d.body.classList.contains("game-boxes"));
    assert.equal(d.getElementById("sign-title").textContent, "DOTS AND BOXES");
    // horizontal lines come first and every line carries a last-move marker
    const edges = d.querySelectorAll("#board > .edge");
    assert.equal(edges[0].classList.contains("h"), true);
    assert.equal(edges[23].classList.contains("v"), true);
    assert.equal(d.querySelectorAll("#board > .edge > .last-marker").length, 24);
    // clicking line 5 asks the engine for line 5
    const seen = [];
    const G2 = w.eval("BoxesGame");
    G2.newGame({ game: "boxes", n: 3, players: 2, timer: 0, startPlayer: 0 }, hooks({ onCellClick: (i) => seen.push(i) }).h);
    w.document.querySelectorAll("#board > .edge")[5].dispatchEvent(new w.Event("click"));
    assert.equal(JSON.stringify(seen), "[5]");
    w.close();
});

test("closing a box wins it and gives another turn; the turn box stays on the same player", async () => {
    const { w, G, d } = fresh();
    await playAll(G, BOX0.slice(0, 3));                       // p0, p1, p0 -> p1 to move, box 0 has three sides
    assert.equal(G.state.current, 1);
    assert.equal(d.getElementById("turn-box").className, "turn-box p1");
    await G.play(7);
    assert.equal(G.state.boxes[0], 1);
    assert.equal(JSON.stringify(G.state.scores), "[0,1]");
    assert.equal(G.state.current, 1, "the same player draws again");
    assert.equal(d.getElementById("turn-box").className, "turn-box p1");
    assert.ok(d.getElementById("board").classList.contains("turn-p1"));
    assert.ok(d.querySelectorAll("#board > .box")[0].classList.contains("taken"));
    assert.ok(d.querySelectorAll("#board > .box")[0].classList.contains("p1"));
    assert.equal(d.querySelectorAll("#board > .edge.last").length, 1, "the newest line is marked");
    assert.equal(d.getElementById("p1-stat-0").textContent, "1", "boxes");
    assert.equal(d.getElementById("p1-pct").textContent, "1 / 4");
    assert.equal(d.getElementById("mini-line2").textContent, "boxes 0 · 1");
    w.close();
});

test("one line can close two boxes at once", async () => {
    const { w, G, d } = fresh();
    await playAll(G, [0, 2, 6, 1, 3, 8]);                     // boxes 0 and 1 both need line 7
    const me = G.state.current;
    await G.play(7);
    assert.equal(G.state.scores[me], 2);
    assert.equal(JSON.stringify(G.state.lastBoxes), "[0,1]");
    assert.equal(G.state.current, me);
    assert.equal(d.getElementById(`p${me}-stat-0`).textContent, "2");
    w.close();
});

test("the game runs until the last line: most boxes wins, equal boxes is a draw", () => {
    const { w, G, calls, d } = fresh();
    G.replay([0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 7, 10]);
    assert.equal(G.state.over, true);
    assert.equal(G.state.history.length, 12);
    assert.equal(G.state.scores[0] + G.state.scores[1], 4);
    if (G.state.winner < 0) {
        assert.equal(calls.finish.why, "Tied!");
        assert.equal(d.getElementById("overlay-title").textContent, "Draw!");
        assert.equal(d.getElementById("turn-name").textContent, "Draw");
        assert.equal(d.getElementById("turn-hint").textContent, "same number of boxes");
    } else {
        assert.match(calls.finish.why, /^\d+ boxe?s?!$/);
        assert.match(d.getElementById("overlay-title").textContent, /wins!$/);
    }
    assert.match(d.getElementById("overlay-sub").textContent, /\d+ of 4 boxes$/);
    assert.ok(d.getElementById("board").classList.contains("over"));
    w.close();
});

test("a clear winner: three boxes of four", () => {
    const { w, G, calls } = fresh();
    // p0 takes boxes 0 and 1, p1 the rest of the rim, p0 finishes 2 and 3
    G.replay([0, 2, 6, 4, 9, 10, 1, 3, 8, 5, 11, 7]);
    assert.equal(G.state.over, true);
    assert.equal(G.state.scores[0] + G.state.scores[1], 4);
    assert.ok(calls.finish, "the game finished");
    if (G.state.winner >= 0) assert.equal(calls.finish.why, `${G.state.scores[G.state.winner]} boxes!`);
    w.close();
});

test("replay equals play, and the record rebuilds the very same position", async () => {
    const seq = [0, 2, 6, 7, 1, 3, 8];
    const a = fresh(); await playAll(a.G, seq);
    const b = fresh(); b.G.replay(seq);
    assert.equal(JSON.stringify(b.G.state.cells), JSON.stringify(a.G.state.cells));
    assert.equal(JSON.stringify(b.G.state.boxes), JSON.stringify(a.G.state.boxes));
    assert.equal(JSON.stringify(b.G.state.scores), JSON.stringify(a.G.state.scores));
    assert.equal(b.G.state.current, a.G.state.current);
    assert.equal(b.G.hash(), a.G.hash(), "the same fingerprint, so two clients agree");
    // and Rules.replay of the record (what a reconnect and the replay bar use)
    const R = a.w.eval("Rules").replay(a.G.record());
    assert.equal(JSON.stringify(R.boxes), JSON.stringify(a.G.state.boxes));
    assert.equal(JSON.stringify(R.scores), JSON.stringify(a.G.state.scores));
    assert.equal(R.current, a.G.state.current);
    a.w.close(); b.w.close();
});

test("the replay bar's preview shows an earlier position without touching the live game (#38)", () => {
    const { w, G, d } = fresh();
    G.replay([0, 2, 6, 7, 1]);
    const live = G.hash();
    G.preview(3);
    assert.equal(G.previewPly, 3);
    assert.equal(d.querySelectorAll("#board > .box.taken").length, 0, "the box is not closed yet at ply 3");
    assert.equal(d.querySelectorAll("#board > .edge.taken").length, 3);
    assert.equal(G.hash(), live, "the live game is untouched");
    G.preview(null);
    assert.equal(G.previewPly, null);
    assert.equal(d.querySelectorAll("#board > .box.taken").length, 1);
    w.close();
});

test("HUD: boxes and lines per seat, the game box, the phone line", async () => {
    const { w, G, d } = fresh({ n: 3 });
    await playAll(G, [0, 3, 12]);
    assert.equal(d.getElementById("p0-stat-0").textContent, "0", "boxes");
    assert.equal(d.getElementById("p0-stat-1").textContent, "2", "lines drawn");
    assert.equal(d.getElementById("p1-stat-1").textContent, "1");
    assert.equal(d.getElementById("p0-pct").textContent, "0 / 9");
    assert.equal(d.getElementById("game-box").hidden, false);
    assert.equal(d.getElementById("game-stat-0").textContent, "9", "boxes left");
    assert.equal(d.getElementById("game-stat-1").textContent, "1", "one box on the table");
    assert.ok(d.getElementById("game-box").classList.contains("hot"));
    assert.match(d.getElementById("round-label").textContent, /^Move 4$/);
    w.close();
});

test("three on one device: the rotation skips nobody and each seat gets a card", async () => {
    const { w, G, d } = fresh({ n: 2, players: 3 });
    assert.equal(d.querySelectorAll("#players .player").length, 3);
    assert.equal(d.getElementById("p0-win-row").hidden, true, "no win chance with three players");
    await playAll(G, [0, 1, 4]);
    assert.equal(G.state.current, 0);
    await playAll(G, [2, 6]);
    assert.equal(G.state.current, 2);
    await G.play(7);                                          // closes box 0 for seat 2
    assert.equal(G.state.boxes[0], 2);
    assert.equal(G.state.current, 2, "the seat that closed it goes again");
    assert.equal(JSON.stringify(G.state.scores), "[0,0,1]");
    w.close();
});

test("win chance: two seats get a bar, and a solved endgame is allowed to say 100 %", async () => {
    const { w, G, d } = fresh();
    assert.equal(d.getElementById("p0-win-row").hidden, false);
    const pct = (k) => parseInt(d.getElementById(`p${k}-win-pct`).textContent, 10);
    assert.ok(pct(0) >= 0 && pct(0) <= 100 && pct(0) + pct(1) === 100, `a percentage pair (${pct(0)})`);
    assert.equal(w.eval("Bots.estimator('boxes', {}).bot"), "fencer-boxes", "the game's bot provides it");
    G.finish(0, "3 boxes!");
    assert.equal(pct(0), 100); assert.equal(pct(1), 0);
    w.close();
});

test("a closed box tells the sound module, and the turn event only fires when the turn really passes", async () => {
    const { w, G } = fresh();
    const Bus = w.eval("Bus");
    const seen = [];
    Bus.on("boxes:capture", (d) => seen.push(["capture", d.player, JSON.stringify(d.boxes)]));
    Bus.on("game:turn", (d) => seen.push(["turn", d.player]));
    await G.play(0);
    assert.equal(JSON.stringify(seen), '[["turn",1]]', "a plain line passes the turn");
    seen.length = 0;
    await G.play(2); await G.play(6);
    seen.length = 0;
    await G.play(7);                                          // p1 closes box 0 and goes again
    assert.equal(JSON.stringify(seen), '[["capture",1,"[0]"]]', "a closed box, and no turn event");
    assert.equal(JSON.stringify(w.eval("Sound.map('boxes:capture', {}, ['local', 'bot'])")), '{"name":"place","rate":1.5,"gain":1.1}');
    w.close();
});
