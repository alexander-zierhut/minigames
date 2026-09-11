/* The framework side of a game: the pure game loop (Rules.step / eliminate / apply /
   replay) against the engine, the generic HUD built from the view's model, the settings
   rows generated from the game definitions, the game record, Match and Session. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks } from "./dom.mjs";

test("Rules.replay (Games.positionAt) rebuilds any ply of a record exactly like the engine played it", async () => {
    const w = loadDom(); const Rules = w.eval("Rules"); const Games = w.eval("Games");
    const G = w.eval("ChainGame");
    const { h } = hooks();
    const config = { game: "chain", n: 4, speed: 1, players: 3, startPlayer: 0 };
    G.newGame(config, h);
    for (const i of [0, 15, 5, 0, 15, 5]) assert.equal(await G.play(i), true);
    G.eliminate(2, "Out of time!");
    await G.play(1);
    const rec = G.record();
    assert.equal(rec.game, "chain"); assert.equal(rec.config.players, 3); assert.equal(rec.history.length, 7); assert.equal(rec.outs.length, 1);
    assert.equal(rec.over, false); assert.equal(rec.winner, null);
    const full = Games.positionAt(rec);
    assert.equal(JSON.stringify(full.cells), JSON.stringify(G.state.cells));
    assert.equal(full.current, G.state.current); assert.equal(JSON.stringify(full.out), JSON.stringify(G.state.out));
    // an earlier ply, and the elimination is applied at the history length it happened
    const early = Rules.replay(rec, 3);
    assert.equal(early.history.length, 3); assert.equal(early.out[2], false); assert.equal(early.current, 0);
    const atOut = Rules.replay(rec, 6);
    assert.equal(atOut.out[2], true, "seat 2 went out after move 6"); assert.equal(atOut.current, 0, "it was seat 2's turn: passes on");
    // step() resolves a move instantly and returns the result when the game ends
    const s = Rules.create({ game: "five", n: 5, winLen: 3 });
    assert.equal(Rules.step("five", s, 0), null); Rules.step("five", s, 10); Rules.step("five", s, 1); Rules.step("five", s, 11);
    const r = Rules.step("five", s, 2);
    assert.equal(r.winner, 0); assert.equal(s.over, true); assert.equal(s.finishWhy, r.why);
    assert.throws(() => Rules.step("five", s, 3), /illegal/);
    // apply() stops at an illegal move and reports how far it got
    const t = Rules.create({ game: "five", n: 5, winLen: 4 });
    assert.equal(Rules.apply("five", t, [0, 0, 1]), 1, "the second 0 is illegal: one move applied");
    w.close();
});

test("HUD: player stat rows and the game box come from the view's model (chain has a box, five has none)", async () => {
    const w = loadDom(); const d = w.document;
    const C = w.eval("ChainGame"); const F = w.eval("FiveGame");
    const { h } = hooks();
    C.newGame({ game: "chain", n: 4, speed: 1, startPlayer: 0 }, h);
    assert.equal(d.getElementById("sign-title").textContent, "CHAIN REACT");
    assert.equal(d.body.classList.contains("game-chain"), true);
    assert.equal(d.querySelectorAll("#p0-stats .stat").length, 2);
    assert.equal(d.querySelector("#p0-stats .stat span").textContent, "Cells");
    assert.equal(d.getElementById("game-box").hidden, false);
    assert.equal(d.querySelectorAll("#game-box .stat").length, 3);
    assert.equal(d.getElementById("game-stat-2").textContent, "0");
    await C.play(0); await C.play(15); await C.play(0);                  // corner explodes
    assert.equal(d.getElementById("game-stat-0").textContent, "1", "current chain");
    assert.equal(d.getElementById("game-stat-2").textContent, "1", "explosions total");
    assert.equal(d.getElementById("mini-line2").textContent, "chain 1 / best 1");
    assert.equal(d.querySelectorAll("#mini-line2 b").length, 2, "values in bold");
    F.newGame({ game: "five", n: 5, winLen: 4, startPlayer: 0 }, h);
    assert.equal(d.getElementById("sign-title").textContent, "FIVE WINS");
    assert.equal(d.body.classList.contains("game-five"), true); assert.equal(d.body.classList.contains("game-chain"), false);
    assert.equal(d.getElementById("game-box").hidden, true);
    assert.equal(d.querySelector("#p1-stats .stat span").textContent, "Stones");
    assert.equal(d.getElementById("mini-line2").textContent, "best row 0 · 0");
    w.close();
});

test("settings rows are generated from the game definitions and read into the config", () => {
    const w = loadDom(); const d = w.document; const S = w.eval("Settings");
    S.init({});
    assert.equal(JSON.stringify(S.fields), JSON.stringify(["speed", "chainLen", "winLen", "yavalath"]), "every field of every game, in registration order");
    for (const id of ["row-speed", "row-chainlen", "row-chainlen-custom", "row-winlen", "set-speed", "set-chainlen", "set-chainlen-custom", "set-winlen"]) assert.ok(d.getElementById(id), id);
    // every control is a dropdown (2026-09-11), and a preset carries its own Custom row
    for (const id of ["set-speed", "set-chainlen", "set-winlen", "set-yavalath", "set-size", "set-timer"]) assert.equal(d.getElementById(id).tagName, "SELECT", id);
    assert.equal(d.querySelectorAll(".settings input[type=checkbox]").length, 0, "no checkboxes any more");
    assert.equal(d.getElementById("set-speed").value, "750");
    assert.equal(d.getElementById("set-chainlen").value, "off", "the chain rule starts off");
    assert.equal(d.getElementById("row-chainlen-custom").hidden, true, "and its custom row is closed");
    S.selectGame("chain");
    assert.equal(d.getElementById("row-winlen").hidden, true); assert.equal(d.getElementById("row-speed").hidden, false);
    S.selectGame("five");
    assert.equal(d.getElementById("row-winlen").hidden, false); assert.equal(d.getElementById("row-chainlen").hidden, true);
    // one control, two config keys: Off, a value from the list, or Custom (clamped).
    // A custom row belongs to its setting, so ask chain's about it while chain is picked.
    const pick = (id, v) => { d.getElementById(id).value = v; d.getElementById(id).dispatchEvent(new w.Event("change")); };
    S.selectGame("chain");
    pick("set-chainlen", "20");
    assert.equal(S.read().chainRule, true); assert.equal(S.read().chainLen, 20);
    pick("set-chainlen", "custom");
    assert.equal(d.getElementById("row-chainlen-custom").hidden, false, "Custom opens its row");
    pick("set-chainlen-custom", "200");
    assert.equal(d.getElementById("set-chainlen-custom").value, "99", "clamped on change");
    S.selectGame("five");
    const cfg = S.read();
    assert.equal(cfg.game, "five"); assert.equal(cfg.winLen, 5); assert.equal(cfg.speed, 750); assert.equal(cfg.chainRule, true); assert.equal(cfg.chainLen, 99);
    S.write({ game: "chain", speed: 350, chainRule: false, chainLen: 20, winLen: 6 });    // the friend's settings
    assert.equal(d.getElementById("set-speed").value, "350");
    assert.equal(d.getElementById("set-chainlen").value, "off", "their chain rule is off");
    assert.equal(S.read().winLen, 6);
    assert.equal(S.summary({ game: "chain", n: 5, players: 2, timer: 0, chainRule: true, chainLen: 20 }), "5 × 5 · no timer · 20-chain wins");
    w.close();
});

test("Match: seats per mode, a bot seat that moves by itself, deferred work until the engine is idle, record()", async () => {
    const w = loadDom(); const M = w.eval("Match"); const S = w.eval("Settings"); const O = w.eval("Opponent");
    S.init({}); O.init({});
    w.sessionStorage.setItem("chainreact.botseed", "7");
    M.reset("local");
    M.start({ game: "five", n: 5, winLen: 4, players: 3, timer: 0 }, 1);
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["local", "local", "local"]));
    assert.equal(M.state.current, 0); assert.equal(M.running, true);
    M.start({ game: "five", n: 5, winLen: 4, players: 3, timer: 0 }, 2);
    assert.equal(M.state.current, 1, "seat 1 starts game 2");
    const rec = M.record();
    assert.equal(rec.gameNo, 2); assert.equal(rec.history.length, 0); assert.equal(rec.clocks.length, 3);
    // against a bot: seat 1 is the bot and answers after THINK_MS
    M.reset("bot");
    M.start({ game: "five", n: 6, winLen: 4, players: 2, timer: 0 }, 1);
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["local", "bot"]));
    assert.equal(M.names[1], "Bot", "the bot seat is simply called Bot (#21)");
    await M.engine.play(0);
    await new Promise((r) => setTimeout(r, M.THINK_MS + 400));
    assert.equal(M.state.history.length, 2, "the bot moved");
    // whenIdle runs at once when idle, later when the engine animates
    let ran = 0;
    M.whenIdle(() => ran++);
    assert.equal(ran, 1);
    M.reset("local");
    M.start({ game: "chain", n: 4, speed: 30, players: 2, timer: 0 }, 1);
    await M.engine.play(0); await M.engine.play(15);
    const p = M.engine.play(0);                                  // explodes: busy for a moment
    M.whenIdle(() => ran++, "k"); M.whenIdle(() => ran++, "k"); // same key: replaced, not queued twice
    assert.equal(ran, 1);
    await p;
    assert.equal(ran, 2);
    M.stop();
    assert.equal(M.running, false);
    w.close();
});

test("a room's bot (#36): part of the config, run by the transport host, a plain remote seat for everybody else", async () => {
    const w = loadDom(); const M = w.eval("Match"); const S = w.eval("Settings"); const O = w.eval("Opponent"); const Bots = w.eval("Bots");
    S.init({}); O.init({});
    w.sessionStorage.setItem("chainreact.botseed", "7");
    // the settings carry it, so it travels with `lobby` / `start` / `state`
    S.setMode("online");
    assert.equal(S.read().bot, null, "a room starts without a bot");
    const pick = O.current("five", S.read());
    S.setBot(pick);
    assert.equal(JSON.stringify(S.read().bot), JSON.stringify({ id: pick.id, difficulty: pick.difficulty, seat: 1 }), "always the seat opposite the human");
    assert.equal(S.summary().includes("×"), true, "the summary itself is unchanged");
    S.write({ ...S.read(), bot: null });
    assert.equal(S.bot, null, "a mirrored config without a bot clears it");
    S.setBot({ id: "no-such-bot", difficulty: "easy" });
    assert.equal(S.bot, null, "an unknown bot id is ignored");
    S.setBot(pick);
    S.setMode("local");
    assert.equal(S.bot, null, "a room's bot never follows into offline play");
    S.setMode("online"); S.setBot(pick);
    // the host runs the seat…
    const cfg = { game: "five", n: 6, winLen: 4, players: 2, timer: 0, bot: S.read().bot };
    M.init({ hostsBot: () => true });
    M.reset("online", 0);
    M.start(cfg, 1);
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["local", "bot"]));
    assert.equal(M.names[1], "Bot");
    assert.equal(M.bot.def.id, pick.id);
    let relayed = [];
    M.init({ hostsBot: () => true, onLocalMove: (i) => relayed.push(i) });
    await M.engine.play(0);
    await new Promise((r) => setTimeout(r, M.THINK_MS + 400));
    assert.equal(M.state.history.length, 2, "the bot moved on the host");
    assert.equal(relayed.length, 1, "and its move is offered to the room like my own");
    // …everybody else sees a remote seat that is called "Bot"
    M.init({ hostsBot: () => false, onLocalMove: () => {} });
    M.reset("online", 0);
    M.start(cfg, 1);
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["local", "remote"]));
    assert.equal(M.names[1], "Bot", "the name is the same everywhere");
    assert.equal(M.bot, null, "no bot instance where it is not run");
    // a takeover mid-game hands the seat to the new host
    M.init({ hostsBot: () => true, onLocalMove: () => {} });
    M.refreshSeats();
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["local", "bot"]));
    assert.ok(M.bot && Bots.get(M.bot.def.id), "the new host built the instance");
    M.stop(); M.reset("local"); M.init({ hostsBot: () => false });
    S.setMode("local");
    w.close();
});

test("names (#35): Match asks the table, a bot seat is Bot, a room seat nobody is in is Player k", () => {
    const w = loadDom(); const M = w.eval("Match"); const S = w.eval("Settings"); const O = w.eval("Opponent");
    const P = w.eval("Prefs"); const R = w.eval("Room");
    S.init({}); O.init({});
    P.set({ name: "Robin" });
    // the table takes its names from the handler app.js gives it (offline: this device's seats)
    M.init({ names: () => P.seatNames() });
    M.reset("local");
    M.start({ game: "five", n: 5, winLen: 4, players: 3, timer: 0 }, 1);
    assert.equal(JSON.stringify(M.names.slice(0, 3)), JSON.stringify(P.seatNames(3)));
    assert.equal(w.document.getElementById("p0-name").textContent, "Robin", "the HUD card shows my name");
    assert.equal(w.document.getElementById("p1-name").textContent, P.seatNames(2)[1]);
    M.reset("bot");
    M.start({ game: "five", n: 6, winLen: 4, players: 2, timer: 0 }, 1);
    assert.equal(M.names[0], "Robin"); assert.equal(M.names[1], "Bot", "the bot seat keeps its own name (#21)");
    // online: my own seat is my preference, a seat we have never seen anybody in is "Player k"
    M.reset("online", 1);
    assert.equal(JSON.stringify(R.names()), JSON.stringify(["Player 1", "Robin"]));
    P.set({ name: "Sam" });
    assert.equal(JSON.stringify(R.names()), JSON.stringify(["Player 1", "Sam"]), "renaming shows at once on my own seat");
    M.reset("local");
    w.close();
});

test("Session: save / load / clear on sessionStorage, fail-safe", () => {
    const w = loadDom(); const Sess = w.eval("Session");
    assert.equal(Sess.load(), null);
    Sess.save({ code: "ABCDE", me: 1, history: [1, 2] });
    assert.equal(JSON.stringify(Sess.load()), JSON.stringify({ code: "ABCDE", me: 1, history: [1, 2] }));
    Sess.clear();
    assert.equal(Sess.load(), null);
    w.close();
});

test("picker (#28): a game declares how many players it takes; others are grayed out and the selection moves off them", () => {
    const w = loadDom(); const d = w.document; const S = w.eval("Settings"); const Games = w.eval("Games");
    assert.equal(JSON.stringify(Games.get("chain").players), JSON.stringify({ min: 2, max: 4 }), "default: two to four");
    // a two-player-only game registered before the picker is built
    Games.register({ key: "duo", title: "Duo", tagline: "t", desc: "d", preview: ".........", players: { min: 2, max: 2 }, size: { min: 3, max: 9, default: 5 }, rules: w.eval("FiveRules"), view: w.eval("FiveView") });
    S.init({});
    assert.equal(d.querySelector('.game-card[data-game="duo"] .game-players').textContent, "2 players");
    assert.equal(d.querySelector('.game-card[data-game="five"] .game-players').textContent, "2 to 4 players");
    S.selectGame("duo");
    assert.equal(S.game, "duo");
    d.querySelector('#set-players button[data-players="3"]').click();
    const duo = d.querySelector('.game-card[data-game="duo"]');
    assert.ok(duo.classList.contains("unsupported")); assert.equal(duo.disabled, true);
    assert.equal(S.supports("duo"), false); assert.equal(S.supports("chain"), true);
    assert.equal(S.game, "chain", "the selection moved to the first game that takes three");
    assert.equal(S.read().players, 3);
    S.selectGame("duo");
    assert.equal(S.game, "chain", "cannot select a grayed-out game");
    d.querySelector('#set-players button[data-players="2"]').click();
    assert.equal(duo.classList.contains("unsupported"), false); assert.equal(duo.disabled, false);
    S.setMode("bot");
    assert.equal(d.getElementById("row-players").hidden, true, "against a bot the control is hidden (always two)");
    w.close();
});

test("spectators only watch (#29): Settings.setLocked disables the picker, the players control and every settings input; Room.accepts refuses player-only messages from seat -1", () => {
    const w = loadDom(); const d = w.document; const S = w.eval("Settings"); const R = w.eval("Room");
    S.init({});
    S.setLocked(true);
    assert.equal(S.locked, true);
    assert.ok(d.body.classList.contains("settings-locked"));
    assert.ok([...d.querySelectorAll(".game-card")].every((c) => c.disabled), "every card disabled");
    assert.ok([...d.querySelectorAll("#set-players button")].every((b) => b.disabled));
    assert.ok([...d.querySelectorAll("#settings-modal input, #settings-modal select")].every((el) => el.disabled));
    assert.equal(d.getElementById("settings-locked-hint").hidden, false);
    S.write({ game: "five", players: 3, n: 9, winLen: 6 });                 // the players' settings still mirror in
    assert.equal(S.read().players, 3); assert.equal(S.read().winLen, 6); assert.equal(S.game, "five");
    S.setLocked(false);
    assert.ok([...d.querySelectorAll(".game-card")].every((c) => !c.disabled));
    assert.ok([...d.querySelectorAll("#set-players button")].every((b) => !b.disabled));
    assert.equal(d.getElementById("set-size").disabled, false);
    assert.equal(d.getElementById("set-chainlen").disabled, false, "and every control is usable again");
    assert.equal(d.getElementById("settings-locked-hint").hidden, true);
    for (const t of R.PLAYERS_ONLY) { assert.equal(R.accepts({ t }, -1), false, t); assert.equal(R.accepts({ t }, 0), true); }
    for (const t of ["chat", "react", "hello", "leave", "sync"]) assert.equal(R.accepts({ t }, -1), true, t);
    w.close();
});

test("picker previews: Games.previewClass turns the nine characters into cell classes, and every game's preview is nine of them", () => {
    const w = loadDom(); const Games = w.eval("Games"); const d = w.document;
    w.eval("Settings").init({});                       // builds the picker cards
    assert.equal(Games.previewClass("."), "");
    assert.equal(Games.previewClass("0"), "p0");
    assert.equal(Games.previewClass("3"), "p3");
    assert.equal(Games.previewClass("#"), "hole", "a broken tile (Isolation)");
    assert.equal(Games.previewClass("a"), "p0 n1"); assert.equal(Games.previewClass("c"), "p0 n3", "three pieces of player 0 (Chain React)");
    assert.equal(Games.previewClass("B"), "p1 n2", "two pieces of player 1");
    for (const key of Games.keys()) {
        const p = Games.get(key).preview;
        assert.equal(p.length, 9, `${key}: nine characters`);
        assert.ok([...p].every((ch) => /^[.#0-3a-cA-C]$/.test(ch)), `${key}: only known characters`);
        assert.equal(d.querySelectorAll(`#game-picker .game-card[data-game="${key}"] .game-preview i`).length, 9, `${key}: nine tiles on the card`);
    }
    assert.equal(d.querySelectorAll('#game-picker .game-card[data-game="isolation"] .game-preview i.hole').length, 3, "Isolation shows three broken tiles");
    assert.equal(d.querySelectorAll('#game-picker .game-card[data-game="chain"] .game-preview i.n3').length, 1, "Chain React shows one full cell");
    // the one tile builder: a game's tile, its small variant, and the empty board for an unknown key
    const tile = Games.previewTile("isolation");
    assert.equal(tile.className, "game-preview isolation"); assert.equal(tile.querySelectorAll("i.hole").length, 3);
    assert.equal(Games.previewTile("five", { small: true }).className, "game-preview tiny five");
    const blank = Games.previewTile("all", { small: true });
    assert.equal(blank.className, "game-preview tiny"); assert.equal(blank.querySelectorAll("i").length, 9); assert.equal(blank.querySelectorAll("i[class]:not([class=''])").length, 0);
    w.close();
});
