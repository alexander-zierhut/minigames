/* Spectators through the real PeerJS broker. Since #29 a room has two codes: the room code
   for players and an independent spectator code behind the 👀 link (?watch=…), which reaches
   a second peer of the host. A third browser watches a running two-player game live (locked
   board, moves arrive, chat as "Spectator"), never learns the room code, can never take a
   seat (not even by forging a hello), keeps spectating across a refresh, follows a rematch
   and finds the room again after the host handed hosting over. Needs internet; SKIP_ONLINE=1 skips. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, bothConnected, sleep, ONLINE } from "./harness.mjs";

let server, A, B, C, code, spec;
const inGame = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "in game" });
const inLobby = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "in lobby" });
const history = (X, n) => X.waitFor(`ChainGame.state.history.length === ${n}`, { what: `history ${n}` });

before(async () => {
    if (!ONLINE) return;
    server = await startServer();
    A = await launchBrowser();
    B = await launchBrowser();
    C = await launchBrowser({ width: 390, height: 844, mobile: true });
    await A.goto(server.url);
    await A.selectSkin("classic");
});
after(async () => { await A?.close(); await B?.close(); await C?.close(); await server?.close(); });

test("two players start a game; a third browser watches through the spectate link and sees every move", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    spec = await A.ev("Room.spec");
    assert.match(spec, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/, "the room has a spectator code of its own");
    assert.notEqual(spec, code, "and it is not the room code");
    await joinRoom(B, server.url, code);
    await bothConnected(A, B);
    await B.waitFor(`Room.spec === ${JSON.stringify(spec)}`, { what: "the players share the spectator code" });
    assert.ok((await A.ev("Room.spectateLink()")).endsWith(`?watch=${spec}`), "the 👀 link carries the spectator code");
    assert.ok(!(await A.ev("Room.spectateLink()")).includes(code), "and never the room code");
    await A.selectGame("chain"); await A.players(2); await A.click("#btn-settings"); await A.setting("size", 4); await A.set("set-speed", 350); await A.setting("timer", 0); await A.click("#btn-settings-done");
    await B.waitFor("Settings.read().n === 4", { what: "guest mirrors" });
    await A.click("#btn-start");
    await inGame(A); await inGame(B);
    await A.move(5);
    await history(B, 1);
    await B.move(0);
    await history(A, 2);
    await C.goto(`${server.url}?watch=${spec}`);                    // the spectate link, a code of its own
    await C.waitFor("Net.connected", { timeout: 60000, what: "spectator connected" });
    await C.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.history.length === 2", { what: "spectator sees the running game" });
    assert.equal(await C.ev("document.querySelectorAll('#board .cell.can-place').length"), 0, "every cell locked");
    assert.equal(await C.ev("document.querySelectorAll('#board .cell.locked').length"), 16);
    assert.equal(await C.text("turn-hint"), "spectating");
    assert.equal(await C.text("net-text"), "Watching");
    assert.equal(await C.ev("[0,1].every(k => document.getElementById('p' + k + '-you').hidden)"), true, "no seat");
    // nothing on this device knows the room code (#29)
    assert.equal(await C.ev("Net.code"), spec, "the viewer's transport uses the spectator code");
    assert.equal(await C.ev("location.search"), `?watch=${spec}`, "the URL remembers the role");
    assert.equal(await C.ev("Room.watching"), true);
    assert.equal(await C.ev("Room.spec"), null, "a viewer is not told the room's spectator code either: it is its own code");
    assert.equal(await C.text("net-code"), "", "no code in the HUD net box");
    assert.equal(await C.ev(`JSON.stringify([location.href, document.body.textContent, JSON.stringify(Session.load() || {}), JSON.stringify(Settings.read())]).includes(${JSON.stringify(code)})`), false, "the room code appears nowhere on the page, in the URL or in the session");
    assert.equal(await C.ev("Session.load().watch"), true, "the session remembers it watches");
    assert.equal(await A.ev("(Session.load() || {}).spec"), spec, "the players keep the spectator code in their session");
    await A.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "host counts the spectator" });
    await B.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "guest counts the spectator via the roster" });
    assert.equal(await A.ev("Net.connected && !document.getElementById('net-banner').hidden === false"), true, "players unaffected");
    await C.cell(10); await sleep(300);
    assert.equal((await C.state()).history.length, 2, "a spectator's click does nothing");
    // spectators only watch (#29): no Back to room for everyone, and the host drops what a spectator is not allowed to send
    assert.equal(await C.text("btn-menu"), "Leave room");
    assert.equal(await C.ev("document.getElementById('overlay-menu').hidden"), true, "no Change game for a spectator");
    await C.ev("Net.send({ t: 'tolobby', from: -1 }); Net.send({ t: 'move', i: 11, n: 2, g: 1, from: -1 }); true");
    await sleep(800);
    assert.equal(await A.screen(), "screen-game", "the host ignored the spectator's tolobby");
    assert.equal(await B.screen(), "screen-game");
    assert.equal((await A.state()).history.length, 2, "and its move");
    await A.move(10);
    await history(C, 3); await history(B, 3);
    await B.move(3);
    await history(C, 4); await history(A, 4);
});

test("the viewer's lobby offers only the spectate link: no code, no eye, no share or copy", { skip: !ONLINE }, async () => {
    const shown = JSON.parse(await C.ev("JSON.stringify(['btn-share', 'btn-copy-code', 'btn-share-spectate', 'btn-hide-code'].map(id => !document.getElementById(id).hidden))"));
    assert.deepEqual(shown, [false, false, true, false], "only the spectator link is offered");
    assert.equal(await C.ev("document.getElementById('invite-code').hidden"), true, "the Invite modal shows no code to a viewer");
    assert.equal(await C.text("lobby-code"), "Watching");
    assert.ok((await C.ev("Room.spectateLink()")).endsWith(`?watch=${spec}`), "a viewer can pass its own link on");
});

test("spectator chat shows as 'Spectator'; a refresh keeps spectating with the board restored", { skip: !ONLINE }, async () => {
    await C.set("chat-input", "go go"); await C.click("#chat-send");
    await A.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Spectator: go go' && l.classList.contains('x'))", { what: "host sees the spectator's line" });
    await B.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Spectator: go go')", { what: "guest sees it too" });
    // the streamer's mute: with "Hide chat and reactions from spectators" on, the host's device
    // shows neither the line nor the emoji, while the guest still gets both (the host relays them)
    await A.ev("Prefs.set({ muteSpectators: true }); true");
    const floatsBefore = await A.ev("document.querySelectorAll('#react-layer .react-float').length");
    await sleep(400);                                                     // Chat.SEND_EVERY: one line per 300 ms
    await C.set("chat-input", "psst"); await C.click("#chat-send");
    await C.click('#react-bar button[data-e="👏"]');
    await B.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Spectator: psst')", { what: "the guest sees the muted line" });
    await B.waitFor("document.querySelectorAll('#react-layer .react-float').length > 0", { what: "the guest sees the reaction" });
    await sleep(1500);
    assert.equal(await A.ev("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Spectator: psst')"), false, "the muting host never shows the line");
    assert.ok(await A.ev("document.querySelectorAll('#react-layer .react-float').length") <= floatsBefore, "nor the reaction");
    await A.ev("Prefs.set({ muteSpectators: false }); true");
    await C.goto(`${server.url}?watch=${spec}`);
    await C.waitFor("Net.connected", { timeout: 60000, what: "spectator reconnected" });
    await C.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.history.length === 4", { what: "board restored" });
    assert.equal(await C.text("turn-hint"), "spectating");
    assert.equal(await C.ev("document.querySelectorAll('#board .cell.can-place').length"), 0);
    await A.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { timeout: 30000, what: "still one spectator (stale connection replaced or timed out)" });
    await A.move(9);
    await history(C, 5);
});

test("rematch by the two players takes the spectator along; its Rematch buttons say Spectating", { skip: !ONLINE }, async () => {
    assert.equal(await C.ev("document.getElementById('btn-restart').disabled"), true);
    assert.equal(await C.text("btn-restart"), "Spectating");
    await A.click("#btn-restart");
    await B.waitFor("document.getElementById('overlay-again').textContent === 'Accept rematch'", { what: "guest sees the request" });
    assert.equal(await C.ev("document.getElementById('overlay').hidden"), true, "nothing asked of the spectator");
    await B.click("#btn-restart");
    for (const X of [A, B, C]) await X.waitFor("ChainGame.state.history.length === 0 && !ChainGame.state.over", { what: "in the rematch" });
    assert.equal((await C.state()).current, 1, "game 2: seat 1 starts");
    await B.move(15);
    await history(C, 1); await history(A, 1);
});

test("a spectate-link viewer never gets a seat: not when one is free, not by forging a hello (#29)", { skip: !ONLINE }, async () => {
    await A.click("#btn-menu");
    await inLobby(A); await inLobby(B); await inLobby(C);
    assert.equal(await C.text("btn-start"), "Spectating");
    assert.equal(await C.ev("document.getElementById('btn-start').disabled"), true);
    await A.players(3);                                             // a free seat appears: the host reseats
    await C.waitFor("document.querySelectorAll('.lobby-player').length === 3", { what: "spectator mirrors players 3" });
    await sleep(600);
    assert.equal(await C.text("btn-start"), "Spectating", "the spectator peer never receives a seat");
    assert.equal(await C.ev("Match.me"), -1);
    // a forged handshake claiming seat 1 changes nothing: the connection itself is a viewer
    await C.ev("Net.send({ t: 'hello', seat: 1, spectate: false, rev: 0, phase: 'lobby' }); true");
    await sleep(1200);
    assert.equal(await C.ev("Match.me"), -1, "still seatless");
    assert.equal(await C.ev("Match.spectator"), true);
    assert.equal(await A.text("lp-1-status"), "connected", "seat 1 still belongs to the friend");
    // #29: the spectator's lobby is read-only, and a forged settings message is refused and corrected
    assert.ok(await C.ev("[...document.querySelectorAll('.game-card')].every(c => c.disabled) && [...document.querySelectorAll('#set-players button')].every(b => b.disabled)"), "picker and players control disabled for the spectator");
    assert.equal(await C.ev("Settings.locked"), true);
    assert.equal(await B.ev("Settings.locked"), false, "players are not locked");
    await C.ev("Net.send({ t: 'lobby', s: { ...Settings.read(), players: 4, game: 'five' }, from: -1 }); true");
    await sleep(800);
    assert.equal(await A.ev("Settings.read().players"), 3, "the host kept its settings");
    assert.equal(await B.ev("Settings.read().players"), 3, "nothing was relayed to the players");
    await C.waitFor("Settings.read().players === 3 && document.querySelectorAll('.lobby-player').length === 3", { what: "the spectator was corrected back" });
    assert.equal(await A.text("lp-2-status"), "not here yet");
    assert.match(await A.text("btn-start"), /Waiting for 1 more player/);
    assert.equal(await A.text("lobby-spectators"), "1 spectator watching");
});

test("the host leaves, the guest takes over the room, and the spectate link still works", { skip: !ONLINE }, async () => {
    await A.players(2);
    await B.waitFor("document.querySelectorAll('.lobby-player').length === 2", { what: "back to two seats" });
    await A.click("#btn-lobby-back");                               // the host leaves for good
    await B.waitFor("Net.role === 'host'", { timeout: 60000, what: "guest took over hosting" });
    assert.equal(await B.ev("Room.spec"), spec, "the new host keeps the room's spectator code");
    await C.waitFor("Net.connected", { timeout: 90000, what: "spectator found the new host by the same link" });
    await C.waitFor("Room.online && Match.spectator", { what: "still watching" });
    assert.equal(await C.ev("Net.code"), spec);
    assert.equal(await C.ev("Net.role"), "guest", "a viewer never claims a room");
    await B.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { timeout: 30000, what: "the new host counts the spectator" });
    await joinRoom(A, server.url, code);                            // the room code still works for players
    await A.waitFor("document.getElementById('lp-0').textContent.includes('(you)')", { timeout: 30000, what: "former host back on seat 0" });
    await B.waitFor("Room.allHere()", { timeout: 30000, what: "both players here" });
    await B.click("#btn-start");
    await inGame(B); await inGame(A); await inGame(C);
    const first = (await B.state()).current;
    await (first === 0 ? A : B).move(5);
    await history(C, 1);
});

test("leaving drops the spectator count and clears the link from the URL", { skip: !ONLINE }, async () => {
    await C.click("#btn-menu");                                     // a spectator's HUD button leaves the room
    await B.waitFor("document.getElementById('lobby-spectators').textContent === ''", { timeout: 30000, what: "spectator gone" });
    assert.equal(await C.screen(), "screen-menu");
    assert.equal(await C.ev("location.search"), "", "watch flag cleared");
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []); assert.deepEqual(C.errors, []);
});
