/* Spectators through the real PeerJS broker: a third browser watches a running
   two-player game live (locked board, moves arrive, chat as "Spectator"), keeps
   spectating across a refresh, follows a rematch, and the spectate link keeps someone a
   spectator even when a seat is free. Needs internet; SKIP_ONLINE=1 skips. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, bothConnected, sleep, ONLINE } from "./harness.mjs";

let server, A, B, C, code;
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

test("two players start a game; a third browser joins the running game as a spectator and sees every move", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    await joinRoom(B, server.url, code);
    await bothConnected(A, B);
    await A.selectGame("chain"); await A.players(2); await A.click("#btn-settings"); await A.set("set-size", 4); await A.set("set-speed", 350); await A.set("set-timer", 0); await A.click("#btn-settings-done");
    await B.waitFor("document.getElementById('set-size').value === '4'", { what: "guest mirrors" });
    await A.click("#btn-start");
    await inGame(A); await inGame(B);
    await A.move(5);
    await history(B, 1);
    await B.move(0);
    await history(A, 2);
    await C.goto(`${server.url}?room=${code}`);                     // every seat is taken: watch
    await C.waitFor("Net.connected", { timeout: 40000, what: "spectator connected" });
    await C.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.history.length === 2", { what: "spectator sees the running game" });
    assert.equal(await C.ev("document.querySelectorAll('#board .cell.can-place').length"), 0, "every cell locked");
    assert.equal(await C.ev("document.querySelectorAll('#board .cell.locked').length"), 16);
    assert.equal(await C.text("turn-hint"), "spectating");
    assert.equal(await C.text("net-text"), "Spectating");
    assert.equal(await C.ev("[0,1].every(k => document.getElementById('p' + k + '-you').hidden)"), true, "no seat");
    assert.equal(await C.ev("location.search"), `?room=${code}&spectate=1`, "the URL remembers the role");
    await A.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "host counts the spectator" });
    await B.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "guest counts the spectator via the roster" });
    assert.equal(await A.ev("Net.connected && !document.getElementById('net-banner').hidden === false"), true, "players unaffected");
    await C.cell(10); await sleep(300);
    assert.equal((await C.state()).history.length, 2, "a spectator's click does nothing");
    await A.move(10);
    await history(C, 3); await history(B, 3);
    await B.move(3);
    await history(C, 4); await history(A, 4);
});

test("spectator chat shows as 'Spectator'; a refresh keeps spectating with the board restored", { skip: !ONLINE }, async () => {
    await C.set("chat-input", "go go"); await C.click("#chat-send");
    await A.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Spectator: go go' && l.classList.contains('x'))", { what: "host sees the spectator's line" });
    await B.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Spectator: go go')", { what: "guest sees it too" });
    await C.goto(`${server.url}?room=${code}&spectate=1`);
    await C.waitFor("Net.connected", { timeout: 40000, what: "spectator reconnected" });
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

test("the spectate link keeps someone a spectator even with a free seat; leaving drops the count", { skip: !ONLINE }, async () => {
    await A.click("#btn-menu");
    await inLobby(A); await inLobby(B); await inLobby(C);
    assert.equal(await C.text("btn-start"), "Spectating");
    assert.equal(await C.ev("document.getElementById('btn-start').disabled"), true);
    await A.players(3);
    await C.waitFor("document.querySelectorAll('.lobby-player').length === 3", { what: "spectator mirrors players 3" });
    await sleep(600);
    assert.equal(await C.text("btn-start"), "Spectating", "asked to spectate: no seat handed out");
    assert.equal(await A.text("lp-2-status"), "not here yet");
    assert.match(await A.text("btn-start"), /Waiting for 1 more player/);
    assert.equal(await A.text("lobby-spectators"), "1 spectator watching");
    await C.click("#btn-lobby-back");
    await A.waitFor("document.getElementById('lobby-spectators').textContent === ''", { timeout: 20000, what: "spectator gone" });
    assert.equal(await C.screen(), "screen-menu");
    assert.equal(await C.ev("location.search"), "", "spectate flag cleared");
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []); assert.deepEqual(C.errors, []);
});
