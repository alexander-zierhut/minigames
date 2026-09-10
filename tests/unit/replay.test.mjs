/* Replays after a game ended (#38): the engine's view-only preview. It shows the position
   after n moves (rebuilt with Rules.replay from the record) without touching the live
   state, the record, the hash, the Bus or the session. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks } from "./dom.mjs";

test("preview shows the position after n plies and leaves the live game alone", async () => {
    const w = loadDom(); const d = w.document;
    const F = w.eval("FiveGame"); const Rules = w.eval("Rules");
    const { h } = hooks();
    F.newGame({ game: "five", n: 5, winLen: 4, players: 2, startPlayer: 0 }, h);
    for (const i of [0, 5, 1, 6, 2, 7, 3]) await F.play(i);      // p0 wins with 4 in row 0
    assert.equal(F.state.over, true); assert.equal(F.state.winner, 0);
    const record = JSON.stringify(F.record());
    const hash = F.hash();
    const live = JSON.stringify(F.state);

    // a middle position: the board shows exactly what Rules.replay computes for that ply
    assert.equal(F.preview(3), 3);
    assert.equal(F.previewPly, 3);
    const at3 = Rules.replay(F.record(), 3);
    const stones = [...d.querySelectorAll("#board > .stone")];
    assert.equal(stones.filter((s) => s.classList.contains("taken")).length, 3);
    assert.equal(stones[0].classList.contains("p0"), true);
    assert.equal(stones[5].classList.contains("p1"), true);
    assert.equal(stones[1].classList.contains("p0"), true);
    assert.equal(stones[6].classList.contains("taken"), false, "move 4 is not on the board yet");
    assert.equal(at3.current, 1);

    // the live game is untouched: state, record, hash
    assert.equal(JSON.stringify(F.state), live, "the live state never changes");
    assert.equal(JSON.stringify(F.record()), record, "the record never changes");
    assert.equal(F.hash(), hash, "the hash never changes");
    assert.equal(F.state.history.length, 7);

    // and a preview is never playable: every cell is locked, clicks do nothing
    assert.equal(stones.every((s) => s.classList.contains("locked")), true, "every cell locked");
    assert.equal(stones.some((s) => s.classList.contains("can-place")), false);
    stones[10].click();
    assert.equal(F.state.history.length, 7, "a click on a preview places nothing");
    w.close();
});

test("preview drives the HUD and the board classes; preview(null) restores the live position", async () => {
    const w = loadDom(); const d = w.document;
    const F = w.eval("FiveGame");
    const { h } = hooks();
    F.newGame({ game: "five", n: 5, winLen: 4, players: 2, startPlayer: 0 }, h);
    for (const i of [0, 5, 1, 6, 2, 7, 3]) await F.play(i);
    const board = d.getElementById("board");
    assert.equal(board.classList.contains("over"), true);
    assert.equal(d.getElementById("round-label").textContent, "Game over");

    F.preview(2);
    assert.equal(board.classList.contains("over"), false, "an earlier position is not over");
    assert.equal(board.classList.contains("turn-p0"), true, "it is seat 0's turn there");
    assert.equal(d.getElementById("turn-name").textContent, "Cyan");
    assert.equal(d.getElementById("turn-hint").textContent, "to move", "a past position gets a neutral hint");
    assert.equal(d.getElementById("round-label").textContent, "Move 3");
    assert.equal(d.getElementById("p0-stat-0").textContent, "1", "seat 0 had one stone");
    assert.equal(d.querySelectorAll("#board > .stone.last").length, 1);
    assert.equal([...d.querySelectorAll("#board > .stone")].findIndex((s) => s.classList.contains("last")), 5, "the last move of that ply");
    assert.equal(d.querySelectorAll("#board > .stone.win").length, 0, "no winning line yet");

    // the ends of the range: 0 = empty board, the full history = live again
    assert.equal(F.preview(0), 0);
    assert.equal(d.querySelectorAll("#board > .stone.taken").length, 0);
    assert.equal(F.preview(-5), 0, "clamped to the first position");
    assert.equal(F.preview(7), null, "the full history is the live position");
    assert.equal(F.previewPly, null);
    assert.equal(F.preview(99), null, "beyond the end is the live position too");
    F.preview(3);
    assert.equal(F.preview(null), null);
    assert.equal(F.previewPly, null);
    assert.equal(board.classList.contains("over"), true, "back to the finished game");
    assert.equal(d.querySelectorAll("#board > .stone.win").length, 4);
    assert.equal(d.getElementById("round-label").textContent, "Game over");
    w.close();
});

test("a preview never emits Bus events (the win chance and the sounds stay on the result)", async () => {
    const w = loadDom();
    const C = w.eval("ChainGame"); const Bus = w.eval("Bus");
    const { h } = hooks();
    C.newGame({ game: "chain", n: 3, speed: 1, players: 2, startPlayer: 0 }, h);
    for (const i of [0, 8, 1, 7, 2]) { if (!C.state.over) await C.play(i); }
    const seen = [];
    for (const e of ["game:new", "game:position", "game:turn", "game:move", "game:finish"]) Bus.on(e, () => seen.push(e));
    C.preview(1); C.preview(2); C.preview(null);
    assert.equal(seen.length, 0, "stepping through a game is display only");
    w.close();
});

test("a new game drops the preview", async () => {
    const w = loadDom();
    const F = w.eval("FiveGame");
    const { h } = hooks();
    const cfg = { game: "five", n: 5, winLen: 4, players: 2, startPlayer: 0 };
    F.newGame(cfg, h);
    for (const i of [0, 5, 1, 6, 2, 7, 3]) await F.play(i);
    F.preview(2);
    assert.equal(F.previewPly, 2);
    F.newGame(cfg, h);
    assert.equal(F.previewPly, null);
    w.close();
});
