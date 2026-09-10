/* Isolation: the pure rules in a bare VM context (no DOM) and the engine + view in jsdom.
   A move is one integer, `to * cells + removed`, so everything the framework does with a
   history (sync, session, record, replay, the replay bar) keeps working unchanged. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadDom, hooks } from "./dom.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const FILES = ["client/lib/util.js", "client/games/rules.js", "client/games/isolation-rules.js"];
function loadRules() {
    const ctx = vm.createContext({ document: undefined });
    for (const f of FILES) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
    return vm.runInContext("({ Rules, IsolationRules })", ctx);
}
const J = (a) => JSON.stringify(a);

/* ---------------- the pure rules, no DOM ---------------- */
function pure(config = {}) {
    const { Rules, IsolationRules } = loadRules();
    const cfg = { n: 7, players: 2, ...config };
    return { Rules, R: IsolationRules, s: Rules.create(cfg, IsolationRules) };
}
function step(Rules, R, s, m) {
    assert.equal(R.isLegal(s, m, s.current), true, `move ${m} legal for ${s.current}`);
    return Rules.step(R, s, m);
}
const enc = (s, to, removed) => to * s.cells.length + removed;

test("no DOM needed: the rules load in a bare context and register themselves", () => {
    const { Rules, IsolationRules } = loadRules();
    assert.ok(Rules && IsolationRules);
    assert.equal(Rules.of("isolation"), IsolationRules);
});

test("start positions: top, bottom, left, right edge, in seat order", () => {
    const two = pure({ n: 7, players: 2 });
    assert.equal(J(two.s.pawns), J([3, 45]), "middle of the top and of the bottom edge");
    assert.equal(two.s.cells[3], 0);
    assert.equal(two.s.cells[45], 1);
    const three = pure({ n: 7, players: 3 });
    assert.equal(J(three.s.pawns), J([3, 45, 21]), "the left edge is added");
    const four = pure({ n: 6, players: 4 });
    assert.equal(J(four.s.pawns), J([3, 33, 18, 23]), "and the right edge");
    assert.equal(four.s.cells.filter((c) => c === -1).length, 32, "every other tile is free");
});

test("a move is a step to a neighbour plus a broken tile, encoded as one integer", () => {
    const { Rules, R, s } = pure({ n: 5 });
    assert.equal(s.pawns[0], 2);
    const to = 8, removed = 20;                                   // step down-right, break a far tile
    const m = enc(s, to, removed);
    assert.equal(R.isLegal(s, m, 0), true);
    step(Rules, R, s, m);
    assert.equal(s.cells[2], -1, "the tile left behind stays");
    assert.equal(s.cells[8], 0, "the pawn moved");
    assert.equal(s.pawns[0], 8);
    assert.equal(s.cells[20], -2, "the broken tile is a hole");
    assert.equal(s.current, 1);
    assert.equal(J(s.history), J([m]), "history is a plain integer array");
    assert.equal(s.movesBy[0], 1);
});

test("legal and illegal: only free neighbours, only free tiles, and the tile just left", () => {
    const { R, s } = pure({ n: 5 });
    const from = s.pawns[0];                                      // 2
    assert.equal(R.isLegal(s, enc(s, 12, 0), 0), false, "two tiles away is not a step");
    assert.equal(R.isLegal(s, enc(s, from, 0), 0), false, "staying is not a step");
    assert.equal(R.isLegal(s, enc(s, 7, 22), 0), false, "the other pawn's tile cannot be broken");
    assert.equal(R.isLegal(s, enc(s, 7, 7), 0), false, "you cannot break the tile you step onto");
    assert.equal(R.isLegal(s, enc(s, 7, from), 0), true, "the tile you leave may be broken");
    assert.equal(R.isLegal(s, enc(s, 22, 0), 0), false, "not your pawn's neighbour");
    assert.equal(R.isLegal(s, -1, 0), false);
    assert.equal(R.isLegal(s, 99999, 0), false);
    // every legal move is a step × a breakable tile
    const moves = R.legalMoves(s, 0);
    assert.equal(moves.length, R.steps(s, 0).length * (s.cells.filter((c) => c === -1).length - 1 + 1));
    assert.ok(moves.every((m) => R.isLegal(s, m, 0)));
    assert.equal(new Set(moves).size, moves.length, "no duplicates");
});

test("trapped when your turn comes: with two players the other one wins", () => {
    /* 3×3: pawns start at 1 (top middle) and 7 (bottom middle). Break p1 into a corner. */
    const { Rules, R, s } = pure({ n: 3 });
    assert.equal(J(s.pawns), J([1, 7]));
    step(Rules, R, s, enc(s, 0, 4));           // p0: (0,0), break the centre
    step(Rules, R, s, enc(s, 6, 8));           // p1: (0,2), break (2,2)
    step(Rules, R, s, enc(s, 3, 2));           // p0: (0,1), break (2,0)
    // p1 at 6 can only reach 3 (taken by p0) and 7 → p0 breaks 7 next
    step(Rules, R, s, enc(s, 7, 5));           // p1: (1,2), break (2,1)
    // now p0 at 3 steps to 6 and breaks 7: p1 at 7? no, p1 is at 7 → break 6? …
    assert.equal(s.over, false);
    // p0 steps to 0 and breaks 4? already a hole. Simply confirm the trap rule directly:
    const t = Rules.create({ n: 3, players: 2 }, R);
    t.cells.fill(-1);
    t.pawns = [4, 0];                          // p0 centre, p1 corner
    t.cells[4] = 0; t.cells[0] = 1;
    for (const h of [1, 2, 5, 6, 7, 8]) t.cells[h] = -2;   // only 0, 3, 4 are left
    t.current = 0;
    assert.equal(R.mobility(t, 1), 1, "p1 can only step to 3");
    const kill = enc(t, 3, 0);                 // p0 steps onto 3 and breaks 0? no: 0 holds p1
    assert.equal(R.isLegal(t, kill, 0), false, "a tile with a pawn on it cannot be broken");
    const kill2 = enc(t, 3, 4);                // p0 steps onto 3 and breaks the tile it left
    assert.equal(R.isLegal(t, kill2, 0), true);
    const r = Rules.step(R, t, kill2);
    assert.equal(t.over, true);
    assert.equal(t.winner, 0);
    assert.equal(r.why, "Trapped!");
    assert.equal(J(t.trapped), J([false, true]), "the trap is an elimination inside the rules");
});

test("three players: a trapped seat is out, the rest play on, the last one wins", () => {
    const { Rules, R } = pure({ n: 5, players: 3 });
    const s = Rules.create({ n: 5, players: 3 }, R);
    s.cells.fill(-2);                                      // start from a bare board
    const open = [0, 1, 5, 6, 12, 18, 24, 23, 17];
    for (const c of open) s.cells[c] = -1;
    s.pawns = [0, 12, 24];
    s.cells[0] = 0; s.cells[12] = 1; s.cells[24] = 2;
    s.current = 1;
    // p1 steps to 6 and breaks 1: p2's neighbours are 18, 23 → still fine; p0 can reach 1? broken
    assert.equal(R.mobility(s, 0), 3, "p0 can reach 1, 5 and 6");
    Rules.step(R, s, enc(s, 6, 1));
    assert.equal(s.over, false);
    assert.equal(s.current, 2, "p0 is not out yet, but it is p2's turn");
    Rules.step(R, s, enc(s, 18, 5));                       // p2 steps to 18 and breaks 5
    assert.equal(J(s.trapped), J([true, false, false]), "p0 has no free neighbour when its turn comes");
    assert.equal(s.current, 1, "p0 is skipped");
    assert.equal(s.over, false, "two are left");
    assert.equal(R.legalMoves(s, 0).length, 0, "an out seat has no moves");
    assert.equal(R.isLegal(s, enc(s, 1, 5), 0), false);
});

test("estimate: even at the start, low for the pawn with no room", () => {
    const { Rules, R } = pure({ n: 7 });
    const s = Rules.create({ n: 7, players: 2 }, R);
    const even = R.estimate(s);
    assert.ok(even > 0.4 && even < 0.65, `roughly even at the start (${even})`);
    const t = Rules.create({ n: 5, players: 2 }, R);
    t.cells.fill(-1);
    t.pawns = [0, 24];
    t.cells[0] = 0; t.cells[24] = 1;
    for (const h of [1, 5, 6]) t.cells[h] = -2;            // p0 is walled in
    t.current = 0;
    assert.equal(R.mobility(t, 0), 0);
    assert.equal(R.estimate(t), 0, "no move left when it is my turn");
    assert.ok(R.territory(t)[1] > R.territory(t)[0], "and no ground either");
});

/* ---------------- the engine and the view (jsdom) ---------------- */
function fresh(config = {}) {
    const w = loadDom();
    const G = w.eval("IsolationGame");
    const { h, calls } = hooks({ onCellClick: (i) => G.play(i) });
    G.newGame({ game: "isolation", n: 5, timer: 0, ...config, startPlayer: 0 }, h);
    return { w, G, calls, R: w.eval("IsolationRules") };
}
const code = (G, to, removed) => to * G.state.cells.length + removed;

test("registry: 5–12 tiles, default 7, two to four players, no premove", () => {
    const { w } = fresh();
    const def = w.eval("Games.get('isolation')");
    assert.equal(def.size.min, 5); assert.equal(def.size.max, 12); assert.equal(def.size.default, 7);
    assert.equal(def.players.min, 2); assert.equal(def.players.max, 4);
    assert.equal(def.premove, false, "a two-click move cannot be premoved");
    assert.equal(J(def.settings), "[]", "board size and players are the only settings");
    w.close();
});

test("the board: one tile per cell with a pawn and a last-move marker", () => {
    const { w, G } = fresh();
    const d = w.document;
    assert.equal(d.querySelectorAll("#board > .slab").length, 25);
    assert.ok(d.getElementById("board").classList.contains("isolation"));
    assert.ok(d.body.classList.contains("game-isolation"));
    assert.equal(d.querySelectorAll("#board > .slab > .pawn").length, 25);
    assert.equal(d.querySelectorAll("#board > .slab.taken").length, 2, "two pawns on the board");
    assert.ok(d.querySelectorAll("#board > .slab")[G.state.pawns[0]].classList.contains("p0"));
    assert.ok(d.querySelectorAll("#board > .slab")[G.state.pawns[1]].classList.contains("p1"));
    w.close();
});

test("can-place marks the tiles the pawn may step onto, not every free tile", () => {
    const { w, G, R } = fresh();
    const d = w.document;
    const marked = [...d.querySelectorAll("#board > .slab")].map((e, i) => (e.classList.contains("can-place") ? i : -1)).filter((i) => i >= 0);
    assert.equal(J(marked), J(R.steps(G.state, 0)), "exactly the steps of the pawn to move");
    w.close();
});

test("the two-step click: pick a tile, pick a tile to break, and take it back", async () => {
    const { w, G, R } = fresh();
    const d = w.document;
    const V = w.eval("IsolationView");
    const slabs = () => d.querySelectorAll("#board > .slab");
    const to = R.steps(G.state, 0)[0];
    slabs()[to].click();
    assert.equal(V.pending, to, "the first click picks the step");
    assert.ok(slabs()[to].classList.contains("pending"));
    assert.equal(G.state.history.length, 0, "nothing is played yet");
    slabs()[to].click();
    assert.equal(V.pending, -1, "clicking it again takes it back");
    // an illegal first click does nothing
    const far = G.state.cells.findIndex((c, i) => c === -1 && !R.steps(G.state, 0).includes(i));
    slabs()[far].click();
    assert.equal(V.pending, -1, "a tile the pawn cannot step onto is ignored");
    assert.ok(!slabs()[far].classList.contains("can-place"), "taking the choice back restores the board");
    // now the real move
    slabs()[to].click();
    const breakable = [...slabs()].map((e, i) => i).find((i) => i !== to && G.state.cells[i] === -1);
    slabs()[breakable].click();
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(V.pending, -1);
    assert.equal(J(G.state.history), J([code(G, to, breakable)]));
    assert.equal(G.state.cells[breakable], -2);
    assert.ok(slabs()[breakable].classList.contains("hole"));
    assert.equal(G.state.current, 1);
    w.close();
});

test("the last-move marker sits on the tile the pawn stepped onto", async () => {
    const { w, G, R } = fresh();
    const d = w.document;
    const to = R.steps(G.state, 0)[0];
    const breakable = G.state.cells.findIndex((c, i) => c === -1 && i !== to);
    assert.equal(await G.play(code(G, to, breakable)), true);
    const slabs = [...d.querySelectorAll("#board > .slab")];
    assert.equal(slabs.findIndex((e) => e.classList.contains("last")), to, "the destination, not the encoded move");
    assert.equal(slabs.filter((e) => e.classList.contains("last")).length, 1);
    w.close();
});

test("HUD: moves and free moves per seat, the bar out of 8", async () => {
    const { w, G, R } = fresh({ n: 7 });
    const d = w.document;
    assert.equal(d.getElementById("p0-stat-0").textContent, "0", "moves");
    assert.equal(d.getElementById("p0-stat-1").textContent, String(R.mobility(G.state, 0)), "free moves");
    assert.equal(d.getElementById("p0-pct").textContent, `${R.mobility(G.state, 0)} / 8`);
    assert.equal(d.getElementById("round-label").textContent, "Move 1");
    const to = R.steps(G.state, 0)[0];
    const breakable = G.state.cells.findIndex((c, i) => c === -1 && i !== to);
    await G.play(code(G, to, breakable));
    assert.equal(d.getElementById("p0-stat-0").textContent, "1");
    assert.equal(d.getElementById("round-label").textContent, "Move 2");
    assert.match(d.getElementById("mini-line2").textContent, /free moves/);
    w.close();
});

test("replay matches play, the record replays and the hash agrees", async () => {
    const a = fresh({ n: 5 });
    const seq = [];
    for (let k = 0; k < 6 && !a.G.state.over; k++) {
        const s = a.G.state, p = s.current;
        const to = a.R.steps(s, p)[0];
        const breakable = s.cells.findIndex((c, i) => c === -1 && i !== to);
        const m = code(a.G, to, breakable);
        assert.equal(await a.G.play(m), true, `move ${k}`);
        seq.push(m);
    }
    const b = fresh({ n: 5 });
    b.G.replay(seq);
    assert.equal(J(b.G.state.cells), J(a.G.state.cells));
    assert.equal(J(b.G.state.pawns), J(a.G.state.pawns));
    assert.equal(b.G.state.current, a.G.state.current);
    assert.equal(b.G.hash(), a.G.hash(), "replay == play");
    // and the pure loop reaches the same position from the record
    const R = a.w.eval("Rules").replay(a.G.record());
    assert.equal(J(R.cells), J(a.G.state.cells));
    assert.equal(J(R.trapped), J(a.G.state.trapped));
    a.w.close(); b.w.close();
});

test("a trap ends the game with the overlay and the log", async () => {
    const { w, G } = fresh({ n: 3 });
    const d = w.document;
    // set the position up through the engine's own replay, then trap
    const s = G.state;
    s.cells.fill(-1);
    s.pawns = [4, 0];
    s.cells[4] = 0; s.cells[0] = 1;
    for (const h of [1, 2, 5, 6, 7, 8]) s.cells[h] = -2;
    s.current = 0;
    G.render();
    assert.equal(await G.play(code(G, 3, 4)), true);
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, 0);
    assert.equal(d.getElementById("overlay").hidden, false);
    assert.match(d.getElementById("overlay-title").textContent, /wins!/);
    assert.match(d.getElementById("overlay-sub").textContent, /Trapped!/);
    assert.match(d.getElementById("overlay-sub").textContent, /moves/);
    assert.ok(d.getElementById("board").classList.contains("over"));
    w.close();
});

test("win chance: two rows with a percentage pair", () => {
    const { w } = fresh({ n: 5 });
    const d = w.document;
    const pct = (k) => parseInt(d.getElementById(`p${k}-win-pct`).textContent, 10);
    assert.ok(pct(0) >= 0 && pct(0) <= 100 && pct(0) + pct(1) === 100, `a percentage pair (${pct(0)})`);
    assert.equal(d.getElementById("p0-win-row").hidden, false);
    w.close();
});

test("the picker card and the settings summary come from the definition", () => {
    const w = loadDom();
    const S = w.eval("Settings");
    S.init({});
    S.selectGame("isolation");
    const cfg = S.read();
    assert.equal(cfg.game, "isolation");
    assert.equal(cfg.n, 7, "the default board");
    assert.match(S.summary(), /^7 × 7 · no timer$/);
    const card = w.document.querySelector('.game-card[data-game="isolation"]');
    assert.ok(card, "a picker card exists");
    assert.match(card.textContent, /Isolation/);
    assert.equal(w.document.getElementById("game-settings").children.length > 0, true, "other games still have rows");
    assert.equal([...w.document.querySelectorAll("#game-settings .row")].every((r) => r.hidden), true, "but none of them shows for Isolation");
    w.close();
});
