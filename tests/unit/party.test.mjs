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

test("settings: a count that would take a seat away is disabled and read() lifts to it (#34)", () => {
    const w = loadDom(); const d = w.document; const S = w.eval("Settings");
    S.init({});
    const btn = (n) => d.querySelector(`#set-players button[data-players="${n}"]`);
    assert.equal(btn(2).disabled, false, "alone in the room every count is free");
    S.setPlayers(4);
    S.setMinPlayers(3);                                           // three seats are taken
    assert.equal(btn(2).disabled, true);
    assert.equal(btn(2).title, S.MIN_PLAYERS_HINT);
    assert.equal(btn(3).disabled, false); assert.equal(btn(3).title, "");
    assert.equal(btn(4).disabled, false);
    S.setPlayers(2);                                              // a stale click cannot get through either
    assert.equal(S.read().players, 3);
    S.write({ game: "five", players: 2, n: 9 });                  // nor a mirrored config
    assert.equal(S.read().players, 3, "read() lifts the count to the seats in use");
    S.setLocked(true);                                            // a spectator: the whole control stays dead (#29)
    assert.equal(btn(4).disabled, true); assert.equal(btn(4).title, "");
    S.setLocked(false);
    assert.equal(btn(4).disabled, false); assert.equal(btn(2).disabled, true);
    S.setMinPlayers(2);                                           // somebody left
    assert.equal(btn(2).disabled, false);
    assert.equal(S.read().players, 3, "the count itself stays where it was");
    w.close();
});

test("room: the host refuses a player count below the seats in use (#34)", () => {
    const w = loadDom(); const R = w.eval("Room");
    const lobby = (players) => ({ t: "lobby", s: { game: "five", players } });
    assert.equal(R.keepsSeats(lobby(3), 3), true);
    assert.equal(R.keepsSeats(lobby(4), 3), true);
    assert.equal(R.keepsSeats(lobby(2), 3), false, "two seats with three people in the room");
    assert.equal(R.keepsSeats(lobby(2), 2), true);
    assert.equal(R.keepsSeats({ t: "move", i: 3 }, 3), true, "only lobby messages carry the count");
    assert.equal(R.keepsSeats({ t: "lobby" }, 3), true, "a lobby message without settings changes nothing");
    w.close();
});

test("room: asking for a seat is the one thing a spectator may send (#39)", () => {
    const w = loadDom(); const R = w.eval("Room");
    // the host's veto (#29) covers everything that changes the game or the settings…
    for (const t of ["move", "timeout", "rematch", "tolobby", "lobby", "start-request", "review"]) {
        assert.equal(R.accepts({ t }, -1), false, t + " from a spectator");
        assert.equal(R.accepts({ t }, 1), true, t + " from a player");
    }
    // …but not the request to sit down or to step back to watching
    assert.equal(R.accepts({ t: "seat", want: 0 }, -1), true, "a spectator may ask for a seat");
    assert.equal(R.accepts({ t: "seat", want: -1 }, 1), true, "a player may ask to watch");
    assert.equal(R.accepts({ t: "chat", text: "hi" }, -1), true, "chat stays allowed");
    // connection trouble is one sentence for the banner and two words for the Start button,
    // and is never reported offline, while waiting for friends, or to a host with an empty room
    const M = w.eval("Match");
    assert.equal(R.netTrouble("reconnecting"), null, "offline nothing is wrong");
    M.reset("online", 0);
    for (const ok of ["connected", "idle", "waiting"]) assert.equal(R.netTrouble(ok), null, `${ok} is fine`);
    // a blip says nothing: only trouble that lasts is reported (the owner found it too noisy)
    assert.equal(R.netTrouble("reconnecting", 1000), null, "the first moment stays quiet");
    assert.equal(R.netTrouble("reconnecting", 4000), null, "and the next few seconds too");
    assert.equal(R.netTrouble("connected", 4500), null, "it cleared: nothing was ever said");
    assert.equal(R.netTrouble("reconnecting", 5000), null, "trouble starts again");
    assert.equal(R.netTrouble("reconnecting", 11000).short, "Reconnecting…", "after six seconds it speaks up");
    assert.ok(R.netTrouble("reconnecting", 11000).text.length > 0, "the banner gets a sentence");
    assert.equal(R.netTrouble("connecting", 30000).short, "Connecting…");
    assert.equal(R.netTrouble("error", 60000).short, "Connection problem");
    M.reset("local");
    // the streamer's mute: a spectator's chat line or reaction is not shown on this device, nothing else changes
    const P = w.eval("Prefs");
    assert.equal(R.hides({ t: "chat", text: "hi", from: -1 }), false, "heard by default");
    P.set({ muteSpectators: true });
    assert.equal(R.hides({ t: "chat", text: "hi", from: -1 }), true, "a spectator's line is hidden");
    assert.equal(R.hides({ t: "react", e: "👏", from: -1 }), true, "and its reaction");
    assert.equal(R.hides({ t: "chat", text: "hi", from: 1 }), false, "a player's line is not");
    assert.equal(R.hides({ t: "move", i: 3, from: -1 }), false, "only chat and reactions are ever hidden");
    assert.equal(R.accepts({ t: "chat", text: "hi" }, -1), true, "the host still accepts and relays it");
    P.set({ muteSpectators: false });
    // offline there are no seats to swap, so both are no-ops
    assert.equal(R.seatFree(), false);
    assert.equal(R.watchInstead(), undefined);
    assert.equal(R.takeSeat(), undefined);
    const seatButtons = ["btn-watch", "btn-take-seat"].map((id) => w.document.getElementById(id));
    assert.ok(seatButtons.every((b) => b && b.hidden), "the seat controls are online-only and start hidden");
    w.close();
});
