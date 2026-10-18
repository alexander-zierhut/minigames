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
    assert.match(cellClass(w, 5), /(^|\s)premove(\s|$)/, "the cell is marked");
    assert.match(w.document.getElementById("turn-hint").textContent, /premove set$/);
    click(w, 5);
    assert.equal(M.premove, -1, "the same cell takes it back");
    assert.doesNotMatch(cellClass(w, 5), /(^|\s)premove(\s|$)/);
    assert.doesNotMatch(w.document.getElementById("turn-hint").textContent, /premove/);
    click(w, 5); click(w, 7);
    assert.equal(M.premove, 7, "another cell moves it");
    assert.doesNotMatch(cellClass(w, 5), /(^|\s)premove(\s|$)/);
    assert.match(cellClass(w, 7), /(^|\s)premove(\s|$)/);
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
    assert.doesNotMatch(cellClass(w, 7), /(^|\s)premove(\s|$)/);
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
    assert.doesNotMatch(cellClass(w, 6), /(^|\s)premove(\s|$)/);
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

test("a timed online game covers the board while the clock is paused, so nobody thinks for free", async () => {
    const w = loadDom(); const M = w.eval("Match"); const d = w.document;
    let live = true;
    w.eval("window.__live = true; Match.init({ live: () => window.__live, onLocalMove: () => {} });");
    const setLive = (on) => { live = on; w.eval(`window.__live = ${on}; true`); M.syncClock(); };
    const covered = () => d.body.classList.contains("board-covered");
    // no timer: there is nothing to gain by thinking on, so nothing is covered
    M.reset("online", 0);
    M.start({ ...CFG, timer: 0 }, 1);
    setLive(false);
    assert.equal(covered(), false, "without a clock the board stays visible");
    setLive(true);
    // with a timer: the pause hides the position and giving it back shows it again
    M.start({ ...CFG, timer: 180 }, 2);
    assert.equal(w.eval("Clock.isEnabled()"), true);
    assert.equal(covered(), false, "while the game runs");
    setLive(false);
    assert.equal(covered(), true, "the clock is paused: the board is covered");
    assert.equal(d.getElementById("board-cover").textContent.length > 0, true, "and says why");
    setLive(true);
    assert.equal(covered(), false, "everyone is back");
    // a spectator has no clock to gain and never loses the board
    setLive(false);
    M.setSeat(-1, true);
    M.syncClock();
    assert.equal(covered(), false, "a spectator keeps watching");
    // leaving the table clears it
    M.setSeat(0, false); M.syncClock();
    assert.equal(covered(), true);
    M.stop();
    assert.equal(covered(), false, "no cover without a game");
    w.eval("Clock.setup(0)"); w.close();
});

/* Every game takes premoves (#37), including the two whose move takes two clicks: the engine
   paints `can-premove` where the table lets this device premove (`hooks.mayPremove`), the view
   composes the move on it exactly like its own move, and Match marks every cell of it
   (`engine.cellsOf`). */
const has = (el, c) => el.classList.contains(c);
const marked = (w, sel) => [...w.document.querySelectorAll(sel)].map((el, i) => (has(el, "premove") ? i : -1)).filter((i) => i >= 0);

test("Triangles: a band composed with two peg clicks while the friend is to move is the premove, marked on every edge and both end pegs", async () => {
    const w = loadDom(); const M = w.eval("Match"); const R = w.eval("TrianglesRules"); const V = w.eval("TrianglesView");
    w.eval("window.__sent = []; Match.init({ onLocalMove: (i) => window.__sent.push(i) });");
    const d = w.document, bands = () => [...d.querySelectorAll("#board > .band")], pegs = () => [...d.querySelectorAll("#board > .peg")];
    M.reset("online", 0);
    M.start({ game: "triangles", n: 4, band: 3, touch: false, tokens: 21, players: 2, timer: 0 }, 2);   // the friend (seat 1) starts
    assert.equal(M.state.current, 1);
    assert.equal(bands().filter((el) => has(el, "can-premove")).length, R.geometry(4).E, "every edge lies on a band I may premove");
    assert.equal(bands().some((el) => has(el, "can-place") || has(el, "locked")), false, "nothing to place now, and nothing locked");
    assert.equal(d.getElementById("board").classList.contains("idle"), false, "the pegs take clicks");
    const mine = 573, theirs = 129;                                 // two bands that share no edge
    const [a, b] = V.clicks(M.state, mine);
    a.click();
    assert.equal(V.pending, pegs().indexOf(a), "the first peg is picked while the friend thinks");
    b.click();
    assert.equal(M.premove, mine, "the composed band is the premove");
    assert.equal(M.state.history.length, 0, "nothing played yet");
    assert.equal(JSON.stringify(marked(w, "#board > .band")), JSON.stringify(R.bandEdges(M.state, mine).sort((x, y) => x - y)), "every edge of the band is marked");
    assert.equal(JSON.stringify(M.engine.cellsOf(mine)), JSON.stringify(R.bandEdges(M.state, mine)));
    assert.equal(JSON.stringify(marked(w, "#board > .peg")), JSON.stringify([pegs().indexOf(a), pegs().indexOf(b)].sort((x, y) => x - y)), "and its two end pegs");
    assert.match(d.getElementById("turn-hint").textContent, /premove set$/);
    // the friend's band arrives: mine follows at once, through the normal path
    await M.engine.play(theirs);
    await idle(M);
    assert.equal(JSON.stringify(M.state.history), JSON.stringify([theirs, mine]), "the premove followed");
    assert.equal(JSON.stringify(w.eval("window.__sent")), JSON.stringify([mine]), "sent to the room like a click");
    assert.equal(M.premove, -1);
    assert.equal(marked(w, "#board > .band").length + marked(w, "#board > .peg").length, 0, "the marker is gone");
    // a band the friend covers completely meanwhile is dropped
    const next = R.legalMoves(M.state).find((m) => R.bandEdges(M.state, m).every((e) => M.state.cells[e] === -1));
    for (const el of V.clicks(M.state, next)) el.click();
    assert.equal(M.premove, next);
    await M.engine.play(next);                                    // the friend stretches the very same band
    await idle(M);
    assert.equal(M.state.history.length, 3, "nothing followed");
    assert.equal(M.premove, -1, "the premove went illegal and was dropped");
    assert.equal(JSON.stringify(w.eval("window.__sent")), JSON.stringify([mine]), "nothing was sent");
    assert.equal(M.state.current, 0, "still my move");
    // a peg picked while the friend thinks survives the friend's band and finishes as my move
    await M.engine.play(R.legalMoves(M.state)[0]);
    await idle(M);
    const free = R.legalMoves(M.state).find((m) => R.bandEdges(M.state, m).every((e) => M.state.cells[e] === -1));
    const [p, q] = V.clicks(M.state, free);
    p.click();
    assert.equal(V.pending, pegs().indexOf(p), "the first peg of a premove");
    const friend = R.legalMoves(M.state).find((m) => R.decode(M.state, m).a !== pegs().indexOf(p) && R.decode(M.state, m).b !== pegs().indexOf(p) && !R.bandEdges(M.state, m).some((e) => R.bandEdges(M.state, free).includes(e)));
    await M.engine.play(friend);
    await idle(M);
    assert.equal(M.state.current, 0);
    assert.equal(V.pending, pegs().indexOf(p), "still picked on my turn");
    q.click();
    await idle(M);
    assert.equal(M.state.history[M.state.history.length - 1], free, "the second click played the band");
    w.eval("Clock.setup(0)"); w.close();
});

test("Isolation: a step and a broken tile picked while the friend is to move are the premove, both tiles marked", async () => {
    const w = loadDom(); const M = w.eval("Match"); const R = w.eval("IsolationRules"); const V = w.eval("IsolationView");
    w.eval("window.__sent = []; Match.init({ onLocalMove: (i) => window.__sent.push(i) });");
    const d = w.document, slabs = () => [...d.querySelectorAll("#board > .slab")];
    M.reset("online", 0);
    M.start({ game: "isolation", n: 5, players: 2, timer: 0 }, 2);   // the friend (seat 1, bottom middle) starts
    assert.equal(M.state.current, 1);
    assert.equal(JSON.stringify(M.state.pawns), JSON.stringify([2, 22]));
    const steps = slabs().map((el, i) => (has(el, "can-premove") ? i : -1)).filter((i) => i >= 0);
    assert.equal(JSON.stringify(steps), JSON.stringify(R.steps(M.state, 0).slice().sort((x, y) => x - y)), "my pawn's steps carry can-premove");
    assert.equal(slabs().some((el) => has(el, "can-premove") && has(el, "locked")), false, "a premove tile is never locked");
    assert.equal(slabs().some((el) => has(el, "can-place")), false);
    slabs()[7].click();
    assert.equal(V.pending, 7, "the step is picked while the friend thinks");
    assert.ok(has(slabs()[0], "can-premove"), "the breakable tiles light up");
    slabs()[0].click();
    const mine = R.encode(M.state, 7, 0);
    assert.equal(M.premove, mine, "step 7, break 0");
    assert.equal(JSON.stringify(M.engine.cellsOf(mine)), JSON.stringify([7, 0]));
    assert.equal(JSON.stringify(marked(w, "#board > .slab")), JSON.stringify([0, 7]), "both tiles are marked");
    assert.match(d.getElementById("turn-hint").textContent, /premove set$/);
    await M.engine.play(R.encode(M.state, 17, 24));               // the friend steps up and breaks a corner
    await idle(M);
    assert.equal(JSON.stringify(M.state.history), JSON.stringify([R.encode(M.state, 17, 24), mine]), "the premove followed");
    assert.equal(JSON.stringify(w.eval("window.__sent")), JSON.stringify([mine]));
    assert.equal(M.premove, -1);
    // a step onto the tile the friend then steps onto is dropped
    slabs()[12].click(); slabs()[1].click();
    assert.equal(M.premove, R.encode(M.state, 12, 1));
    await M.engine.play(R.encode(M.state, 12, 4));
    await idle(M);
    assert.equal(M.state.history.length, 3, "nothing followed");
    assert.equal(M.premove, -1, "dropped");
    assert.equal(M.state.current, 0, "still my move");
    assert.equal(JSON.stringify(w.eval("window.__sent")), JSON.stringify([mine]), "nothing was sent");
    w.eval("Clock.setup(0)"); w.close();
});

test("no can-premove on one device, for a spectator or in a preview", async () => {
    const w = loadDom(); const M = w.eval("Match");
    const cnt = (c) => w.document.querySelectorAll(`#board > .${c}`).length;
    M.reset("local");
    M.start({ game: "triangles", n: 4, players: 2, timer: 0 }, 2);
    assert.equal(cnt("can-premove"), 0, "every seat is this device");
    M.reset("online", -1, true);
    M.start({ game: "isolation", n: 5, players: 2, timer: 0 }, 1);
    assert.equal(cnt("can-premove"), 0, "a spectator only watches");
    M.reset("online", 0);
    M.start(CFG, 2);
    assert.ok(cnt("can-premove") > 0);
    await M.engine.play(3); await idle(M);
    await M.engine.play(4); await idle(M);
    M.engine.preview(1);
    assert.equal(cnt("can-premove"), 0, "a preview is never playable");
    assert.equal(cnt("locked"), 25);
    w.eval("Clock.setup(0)"); w.close();
});
