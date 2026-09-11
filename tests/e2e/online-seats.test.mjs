/* Swapping seat and spectator role in the lobby (#39), three browsers through the real
   PeerJS broker: A hosts on seat 0, B sits on seat 1, C joined with the room code while
   both seats were taken and watches. A steps back to watching, C takes the free seat and
   plays a game against B while A watches; back in the lobby the roles swap again, and a
   refresh keeps whatever role everybody has. Needs internet; SKIP_ONLINE=1 skips. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, bothConnected, sleep, ONLINE } from "./harness.mjs";

let server, A, B, C, code;
const inGame = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "in game" });
const inLobby = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "in lobby" });
const seat = (X, s) => X.waitFor(`Match.me === ${s}`, { what: `seat ${s}` });
const history = (X, n) => X.waitFor(`ChainGame.state.history.length === ${n}`, { what: `history ${n}` });

before(async () => {
    if (!ONLINE) return;
    server = await startServer();
    A = await launchBrowser();
    B = await launchBrowser();
    C = await launchBrowser();
    await A.goto(server.url);
    await A.selectSkin("classic");
});
after(async () => { await A?.close(); await B?.close(); await C?.close(); await server?.close(); });

test("three in a two-seat room: the third watches", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    await joinRoom(B, server.url, code);
    await bothConnected(A, B);
    await A.selectGame("chain"); await A.players(2);
    await A.click("#btn-settings"); await A.setting("size", 4); await A.set("set-speed", 350); await A.setting("timer", 0); await A.click("#btn-settings-done");
    await joinRoom(C, server.url, code);
    await seat(C, -1);
    await A.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "one watching" });
    assert.equal(await C.ev("document.getElementById('btn-take-seat').hidden"), false, "the spectator is offered a seat");
    assert.equal(await C.ev("document.getElementById('btn-take-seat').disabled"), true, "but every seat is taken");
    assert.equal(await C.ev("document.getElementById('btn-watch').hidden"), true, "and it is not sitting anywhere");
    assert.equal(await A.ev("document.getElementById('btn-watch').hidden"), false, "a player may step back");
    assert.equal(await A.ev("document.getElementById('btn-take-seat').hidden"), true);
});

test("the host steps back to watching: its seat is free, its lobby is a spectator's", { skip: !ONLINE }, async () => {
    await A.click("#btn-watch");
    await seat(A, -1);
    assert.equal(await A.ev("Match.spectator"), true);
    assert.equal(await A.text("btn-start"), "Spectating");
    assert.equal(await A.ev("Settings.locked"), true, "a spectator's lobby is read-only (#29)");
    assert.equal(await A.ev("location.search"), `?room=${code}&spectate=1`, "the URL remembers it for a refresh");
    await B.waitFor("document.getElementById('lp-0').classList.contains('absent')", { what: "seat 0 empty for the friend" });
    await B.waitFor("document.getElementById('lobby-spectators').textContent === '2 spectators watching'", { what: "two watching" });
    assert.match(await B.text("btn-start"), /Waiting for your friend/);
    await C.waitFor("!document.getElementById('btn-take-seat').disabled", { what: "the seat is offered to the spectator" });
});

test("the room-code spectator takes the free seat and plays the game", { skip: !ONLINE }, async () => {
    await C.click("#btn-take-seat");
    await seat(C, 0);
    assert.equal(await C.ev("Match.spectator"), false);
    assert.equal(await C.ev("Settings.locked"), false, "a player may change the settings again");
    assert.equal(await C.ev("location.search"), `?room=${code}`, "no spectate flag any more");
    await B.waitFor("document.getElementById('lp-0').textContent.includes('connected')", { what: "seat 0 taken again" });
    await A.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "only the host watches now" });
    await B.waitFor("Room.allHere()", { what: "both players here" });
    await B.click("#btn-start");                                    // the guest asks the host (which is watching, but still runs the room)
    await inGame(A); await inGame(B); await inGame(C);
    const first = (await B.state()).current;
    await (first === 0 ? C : B).move(5);
    await history(A, 1); await history(B, 1); await history(C, 1);
    await (first === 0 ? B : C).move(0);
    await history(A, 2); await history(C, 2); await history(B, 2);
    assert.equal(await A.text("turn-hint"), "spectating", "the former host really is watching");
    assert.equal(await A.ev("document.querySelectorAll('#board .cell.can-place').length"), 0);
});

test("back in the room the roles swap again: the guest watches, the former host sits down", { skip: !ONLINE }, async () => {
    await C.click("#btn-menu");                                     // back to the room
    await inLobby(A); await inLobby(B); await inLobby(C);
    await B.click("#btn-watch");
    await seat(B, -1);
    await A.waitFor("!document.getElementById('btn-take-seat').disabled", { what: "seat 1 free" });
    await A.click("#btn-take-seat");
    await seat(A, 1);
    assert.equal(await A.ev("Match.spectator"), false);
    await C.waitFor("document.getElementById('lp-1').textContent.includes('connected')", { what: "seat 1 taken by the former host" });
    await C.waitFor("Room.allHere()", { what: "both seats filled" });
    assert.equal(await B.text("btn-start"), "Spectating");
    assert.equal(await C.text("btn-start"), "Start game (asks the host)");
    // growing the room does not hand a seat back to somebody who chose to watch (#39)
    await A.players(3);
    await B.waitFor("document.querySelectorAll('.lobby-player').length === 3", { what: "three seats" });
    await sleep(800);
    assert.equal(await B.ev("Match.me"), -1, "the voluntary spectator stays seatless until it asks");
    await A.players(2);
    await B.waitFor("document.querySelectorAll('.lobby-player').length === 2", { what: "back to two seats" });
});

test("a refresh keeps the new roles and nothing is broken", { skip: !ONLINE }, async () => {
    await A.goto(`${server.url}?room=${code}`);
    await A.waitFor("Net.connected", { timeout: 40000, what: "player back" });
    await seat(A, 1);
    await B.goto(`${server.url}?room=${code}&spectate=1`);
    await B.waitFor("Net.connected", { timeout: 40000, what: "spectator back" });
    await seat(B, -1);
    assert.equal(await B.ev("Match.spectator"), true);
    await C.waitFor("Room.allHere() && Net.connected", { timeout: 40000, what: "the room is whole again" });
    for (const X of [A, B, C]) assert.equal(await X.ev("Net.connected"), true);
    await C.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { timeout: 30000, what: "one watching" });
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []); assert.deepEqual(C.errors, []);
});
