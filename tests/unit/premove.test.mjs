/* Premoves (#37): clicking a cell while the friend or the bot is to move remembers it and
   plays it the moment the turn comes. Only with one local seat (online / against a bot). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, wait } from "./dom.mjs";

const CFG = { game: "five", n: 5, winLen: 4, players: 2, timer: 0 };
const cellClass = (w, i) => w.document.querySelectorAll("#board > .stone")[i].className;
const click = (w, i) => w.document.querySelectorAll("#board > .stone")[i].click();
const idle = async (M) => { for (let k = 0; k < 200 && M.state.busy; k++) await wait(10); };

test("online seat: a click on the friend's turn sets, switches and takes back the premove", () => {
    const w = loadDom(); const M = w.eval("Match");
    M.reset("online", 0);
    M.start(CFG, 2);                                          // game 2: seat 1 (the friend) starts
    assert.equal(M.state.current, 1);
    assert.equal(M.premove, -1);
    click(w, 5);
    assert.equal(M.premove, 5, "a click while the friend is to move is remembered");
    assert.equal(M.state.history.length, 0, "nothing is played yet");
    assert.match(cellClass(w, 5), /\bpremove\b/, "the cell is marked");
    assert.match(w.document.getElementById("turn-hint").textContent, /premove set$/);
    click(w, 5);
    assert.equal(M.premove, -1, "the same cell takes it back");
    assert.doesNotMatch(cellClass(w, 5), /\bpremove\b/);
    assert.doesNotMatch(w.document.getElementById("turn-hint").textContent, /premove/);
    click(w, 5); click(w, 7);
    assert.equal(M.premove, 7, "another cell moves it");
    assert.doesNotMatch(cellClass(w, 5), /\bpremove\b/);
    assert.match(cellClass(w, 7), /\bpremove\b/);
    w.eval("Clock.setup(0)"); w.close();
});

test("the premove is played through the normal path as soon as the turn comes, and dropped when it went illegal", async () => {
    const w = loadDom(); const M = w.eval("Match");
    w.eval("window.__sent = []; Match.init({ onLocalMove: (i) => window.__sent.push(i) });");
    M.reset("online", 0);
    M.start(CFG, 2);
    click(w, 7);
    await M.engine.play(3);                                   // the friend's move arrives
    await idle(M);
    assert.equal(JSON.stringify(M.state.history), JSON.stringify([3, 7]), "the premove followed at once");
    assert.equal(M.premove, -1);
    assert.equal(JSON.stringify(w.eval("window.__sent")), JSON.stringify([7]), "sent to the room like a click");
    assert.doesNotMatch(cellClass(w, 7), /\bpremove\b/);
    // the friend takes the cell I premoved: it is dropped, nothing is played
    click(w, 12);
    assert.equal(M.premove, 12);
    await M.engine.play(12);
    await idle(M);
    assert.equal(JSON.stringify(M.state.history), JSON.stringify([3, 7, 12]), "illegal premove dropped");
    assert.equal(M.premove, -1);
    assert.equal(JSON.stringify(w.eval("window.__sent")), JSON.stringify([7]), "nothing was sent");
    assert.equal(M.state.current, 0, "still my move");
    w.eval("Clock.setup(0)"); w.close();
});

test("no premoves on one device or as a spectator; a new game, back to the room and the end of a game clear it", async () => {
    const w = loadDom(); const M = w.eval("Match");
    // local multiplayer: every seat is this device, a click is always a move
    M.reset("local");
    M.start(CFG, 1);
    click(w, 4);
    await idle(M);
    assert.equal(M.premove, -1, "local multiplayer never premoves");
    assert.equal(M.state.history.length, 1, "the click was the move");
    click(w, 8);
    await idle(M);
    assert.equal(M.premove, -1);
    assert.equal(M.state.history.length, 2, "the next seat plays on the same device");
    // spectator: no seat, no premove
    M.reset("online", -1, true);
    M.start(CFG, 1);
    click(w, 4);
    assert.equal(M.premove, -1, "spectators only watch");
    // a new game, stop and the end of a game clear it
    M.reset("online", 0);
    M.start(CFG, 2);
    click(w, 6);
    assert.equal(M.premove, 6);
    M.start(CFG, 4);
    assert.equal(M.premove, -1, "a new game starts without a premove");
    click(w, 6);
    M.stop();
    assert.equal(M.premove, -1, "back to the room drops it");
    M.start(CFG, 2);
    click(w, 6);
    M.engine.finish(1, "Out of time!");
    assert.equal(M.premove, -1, "the game is over");
    assert.doesNotMatch(cellClass(w, 6), /\bpremove\b/);
    w.eval("Clock.setup(0)"); w.close();
});

test("against a bot: the premove set while it thinks is played right after its move", async () => {
    const w = loadDom(); const M = w.eval("Match"); const S = w.eval("Settings"); const O = w.eval("Opponent");
    S.init({}); O.init({});
    w.sessionStorage.setItem("chainreact.botseed", "7");
    M.reset("bot");
    M.start({ ...CFG, n: 6 }, 1);
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["local", "bot"]));
    await M.engine.play(0);                                   // my move, now the bot thinks
    assert.equal(M.state.current, 1);
    const free = M.state.cells.map((c, i) => (c === -1 ? i : -1)).filter((i) => i > 0);
    const mine = free[free.length - 1];                        // the far corner: the bot won't take it
    click(w, mine);
    assert.equal(M.premove, mine);
    for (let k = 0; k < 60 && M.state.history.length < 3; k++) await wait(50);
    assert.equal(M.state.history.length, 3, "the bot moved and my premove followed");
    assert.equal(M.state.history[2], mine);
    assert.equal(M.premove, -1);
    w.eval("Clock.setup(0)"); w.close();
});
