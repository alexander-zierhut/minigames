/* Three and four players: rotation, eliminations outside the rules (flag falls) in the
   pure rules and in the engine (replay with `outs` == live play), HUD cards, settings row. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadDom, hooks } from "./dom.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
function loadRules() {
    const ctx = vm.createContext({ document: undefined });
    for (const f of ["client/lib/util.js", "client/games/rules.js", "client/games/chain-rules.js", "client/games/five-rules.js"]) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
    return vm.runInContext("({ Rules, ChainRules, FiveRules })", ctx);
}
function move(R, s, i) {
    const me = s.current;
    assert.equal(R.isLegal(s, i, me), true, `move ${i} legal for ${me}`);
    R.place(s, i, me); R.settle(s, me);
    const r = R.conclude(s, me);
    if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
    return r;
}

test("rules: out players are skipped by pass, remaining() lists the rest, the last one standing wins", () => {
    const { Rules, ChainRules, FiveRules } = loadRules();
    const s = Rules.base({ n: 5, players: 4 });
    assert.equal(JSON.stringify(s.out), "[false,false,false,false]");
    s.out[1] = true;
    Rules.pass(s); assert.equal(s.current, 2, "seat 1 is out: 0 → 2");
    Rules.pass(s); assert.equal(s.current, 3);
    Rules.pass(s); assert.equal(s.current, 0); assert.equal(s.round, 2);
    assert.equal(JSON.stringify(Rules.remaining(s)), "[0,2,3]");
    assert.equal(JSON.stringify(Rules.remaining(s, [true, true, false, true])), "[0,3]", "the game's own alive list narrows it further");
    // five with three players: rotation 0 1 2, then two are out → the third wins on the next conclude
    const f = FiveRules.create({ n: 5, winLen: 4, players: 3 }, Rules.base({ n: 5, winLen: 4, players: 3 }));
    move(FiveRules, f, 0); move(FiveRules, f, 1); move(FiveRules, f, 2);
    assert.equal(f.current, 0); assert.equal(f.round, 2);
    f.out[1] = true; f.out[2] = true;
    const r = move(FiveRules, f, 5);
    assert.equal(r.winner, 0); assert.match(r.why, /Everyone else is out/);
    // chain with three players: an out player's cells don't keep it alive
    const c = ChainRules.create({ n: 3, players: 3 }, Rules.base({ n: 3, players: 3 }));
    move(ChainRules, c, 0); move(ChainRules, c, 4); move(ChainRules, c, 8);
    c.out[2] = true;                                            // seat 2 flagged; it still owns cell 8
    move(ChainRules, c, 0);                                     // p0's corner explodes into 1 and 3; p1 is still there
    assert.equal(c.over, false);
    assert.equal(c.current, 1, "rotation skips the out seat");
    c.out[1] = true; Rules.pass(c);                             // p1 flagged on its turn: the turn moves on
    assert.equal(c.current, 0);
    const win = move(ChainRules, c, 3);
    assert.equal(win.winner, 0, "everyone else out (even with cells on the board): p0 wins");
});

function fresh(w, key, config) {
    const G = w.eval(key);
    const { h, calls } = hooks();
    G.newGame({ timer: 0, startPlayer: 0, ...config }, h);
    return { G, calls };
}

test("engine: eliminate() mid-game with three players — turn passes, HUD/log follow, replay with outs matches", async () => {
    const w = loadDom(); const d = w.document;
    const cfg = { game: "five", n: 6, winLen: 4, players: 3 };
    const { G, calls } = fresh(w, "FiveGame", cfg);
    assert.equal(d.querySelectorAll("#players .player").length, 3, "one card per seat");
    assert.equal(d.getElementById("p0-win-row").hidden, true, "win chance only for two players");
    assert.equal(d.getElementById("p2-name").textContent, "Lime");
    await G.play(0); await G.play(1);                            // seat 2 to move
    assert.equal(G.state.current, 2);
    assert.equal(G.eliminate(2, "Out of time!"), true);
    assert.equal(G.state.out[2], true);
    assert.equal(G.state.current, 0, "it was seat 2's turn: passes to seat 0");
    assert.equal(JSON.stringify(G.state.outs), JSON.stringify([{ p: 2, at: 2, why: "Out of time!" }]));
    assert.equal(calls.turns[calls.turns.length - 1], 0, "onTurn told the app");
    assert.match(d.getElementById("log").textContent, /Lime is out\. Out of time!/);
    assert.equal(G.eliminate(2, "again"), false, "already out");
    await G.play(6); await G.play(7);                            // 0, 1 — seat 2 skipped
    assert.equal(G.state.current, 0);
    assert.equal(G.state.over, false);
    // the same game rebuilt from history + outs (refresh / sync) is identical
    const w2 = loadDom();
    const { G: R } = fresh(w2, "FiveGame", cfg);
    R.replay(G.state.history.slice(), G.state.outs.slice());
    assert.equal(R.hash(), G.hash(), "replay with outs == live play");
    assert.equal(R.state.current, 0); assert.equal(R.state.out[2], true);
    // a second flag fall leaves one player: the game ends for them
    G.eliminate(1, "Out of time!");
    assert.equal(G.state.over, true); assert.equal(G.state.winner, 0);
    assert.equal(d.getElementById("overlay-title").textContent, "Cyan wins!");
    assert.match(d.getElementById("overlay-sub").textContent, /Out of time!/);
    w.close(); w2.close();
});

test("engine: with two players a flag fall ends the game (no 'is out' line); a missed flag fall arrives via replay([], outs)", () => {
    const w = loadDom(); const d = w.document;
    const { G, calls } = fresh(w, "ChainGame", { game: "chain", n: 4, speed: 1, players: 2 });
    G.eliminate(0, "Out of time!");
    assert.equal(G.state.over, true); assert.equal(G.state.winner, 1);
    assert.equal(calls.finish.why, "Out of time!");
    assert.equal(d.getElementById("overlay-title").textContent, "Amber wins!");
    assert.doesNotMatch(d.getElementById("log").textContent, /is out/);
    const w2 = loadDom();
    const { G: H } = fresh(w2, "FiveGame", { game: "five", n: 5, winLen: 4, players: 3 });
    H.replay([0, 1], [{ p: 1, at: 2, why: "Out of time!" }]);
    assert.equal(H.state.out[1], true);
    assert.equal(H.state.current, 2, "seat 1 was out before its turn came: 0 → 2");
    H.replay([], [{ p: 2, at: 2, why: "Out of time!" }]);
    assert.equal(H.state.over, true); assert.equal(H.state.winner, 0);
    w.close(); w2.close();
});

test("settings: players 2/3/4 in the config and summary; against a bot it is always 2", () => {
    const w = loadDom(); const d = w.document; const S = w.eval("Settings");
    S.init({});
    assert.equal(S.read().players, 2);
    d.querySelector('#set-players button[data-players="3"]').click();      // the lobby's control (#28)
    assert.equal(S.read().players, 3);
    assert.equal(d.querySelector("#set-players button.selected").dataset.players, "3");
    assert.match(S.summary(), /· 3 players ·/);
    assert.equal(JSON.parse(w.localStorage.getItem("chainreact.settings")).players, 3, "persisted");
    S.write({ game: "five", players: 4, n: 9 });                 // the friend's settings (silent, not persisted)
    assert.equal(S.read().players, 4);
    assert.equal(d.querySelector("#set-players button.selected").dataset.players, "4", "the control follows");
    S.setMode("bot");
    assert.equal(d.getElementById("row-players").hidden, true);
    assert.equal(S.read().players, 2, "a bot game is two players");
    assert.doesNotMatch(S.summary(), /players/);
    S.setMode("online");
    assert.equal(d.getElementById("row-players").hidden, false);
    assert.equal(S.read().players, 4);
    w.close();
});
