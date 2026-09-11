/* A room with three players through the real PeerJS broker: host + two guests. Seats,
   lobby presence, start needs everyone, moves relayed to everyone, a guest refresh gets
   the board back, chat and reactions with the sender's colour, rematch by everyone,
   one Back to room moves all. Needs internet; SKIP_ONLINE=1 skips. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, sleep, ONLINE } from "./harness.mjs";

let server, A, B, C, code;
const inGame = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "in game" });
const inLobby = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "in lobby" });
const history = (X, n) => X.waitFor(`ChainGame.state.history.length === ${n}`, { what: `history ${n}` });
const seat = (X) => X.ev("[0,1,2,3].find(k => document.getElementById('lp-' + k) && document.getElementById('lp-' + k).textContent.includes('(you)'))");

before(async () => {
    if (!ONLINE) return;
    server = await startServer();
    A = await launchBrowser();
    B = await launchBrowser({ width: 390, height: 844, mobile: true });
    C = await launchBrowser();
    await A.goto(server.url);
    await A.selectSkin("classic");
    // fixed names (#35), kept in localStorage across the guests' navigation into the room
    await A.ev("Prefs.set({ name: 'Alex' })");
    await B.goto(server.url); await B.ev("Prefs.set({ name: 'Bo' })");
    await C.goto(server.url); await C.ev("Prefs.set({ name: 'Cy' })");
});
after(async () => { await A?.close(); await B?.close(); await C?.close(); await server?.close(); });

test("three seats: the host sets players 3, two guests join and get seats 1 and 2, start waits for everyone", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    await A.players(3);
    assert.equal(await A.ev("document.querySelectorAll('.lobby-player').length"), 3);
    assert.match(await A.text("btn-start"), /Waiting for 2 more players/);
    await joinRoom(B, server.url, code);
    await A.waitFor("document.getElementById('lp-1-status').textContent === 'connected'", { what: "host sees guest 1" });
    await B.waitFor("document.querySelectorAll('.lobby-player').length === 3 && document.querySelector('#set-players button.selected').dataset.players === '3'", { what: "guest mirrors players 3" });
    assert.equal(await seat(B), 1);
    assert.match(await A.text("btn-start"), /Waiting for 1 more player…/);
    assert.equal(await A.ev("document.getElementById('btn-start').disabled"), true);
    await joinRoom(C, server.url, code);
    await A.waitFor("document.getElementById('lp-2-status').textContent === 'connected'", { what: "host sees guest 2" });
    await B.waitFor("document.getElementById('lp-2-status').textContent === 'connected'", { what: "guest 1 sees guest 2 via the roster" });
    await C.waitFor("document.getElementById('lp-1-status').textContent === 'connected'", { what: "guest 2 sees guest 1" });
    assert.equal(await seat(C), 2);
    await A.waitFor("!document.getElementById('btn-start').disabled", { what: "host may start" });
    assert.equal(await A.text("btn-start"), "Start game");
    assert.match(await C.text("btn-start"), /asks the host/);
});

test("the last guest starts; moves by every seat reach everyone; nobody moves out of turn", { skip: !ONLINE }, async () => {
    await A.selectGame("chain"); await A.click("#btn-settings"); await A.setting("size", 4); await A.set("set-speed", 350); await A.setting("timer", 0); await A.click("#btn-settings-done");
    await C.waitFor("document.querySelector('.game-card.selected').dataset.game === 'chain' && Settings.read().n === 4", { what: "guest 2 mirrors settings" });
    await C.click("#btn-start");
    await inGame(A); await inGame(B); await inGame(C);
    await sleep(400);
    for (const X of [A, B, C]) {
        const st = await X.state();
        assert.equal(st.players, 3); assert.equal(st.current, 0, "game 1: seat 0 starts");
        assert.equal(await X.ev("document.querySelectorAll('#players .player').length"), 3);
    }
    await B.cell(5); await sleep(300);
    assert.equal((await B.state()).history.length, 0, "seat 1 cannot move on seat 0's turn");
    await A.move(5);
    await history(B, 1); await history(C, 1);
    await B.move(0);
    await history(A, 2); await history(C, 2);
    await C.move(15);
    await history(A, 3); await history(B, 3);
    for (const X of [A, B, C]) assert.equal(JSON.stringify((await X.state()).history), "[5,0,15]");
    assert.equal((await A.state()).current, 0, "rotation 0 → 1 → 2 → 0");
    assert.equal(await B.text("turn-hint"), "waiting for Alex…");
});

test("chat and reactions carry the sender's seat colour to both others", { skip: !ONLINE }, async () => {
    await C.set("chat-input", "hello from seat two"); await C.click("#chat-send");
    for (const X of [A, B]) await X.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Cy: hello from seat two' && l.classList.contains('p2'))", { what: "chat line with the sender's name and colour" });
    await B.click("#react-toggle"); await B.click('#react-bar button[data-e="GG"]');
    await C.waitFor("document.querySelector('#react-layer .react-float.theirs')", { what: "guest 2 sees guest 1's reaction" });
    assert.equal(await C.ev("document.querySelector('#react-layer .react-float.theirs').style.getPropertyValue('--their-color')"), "var(--c1)");
    await A.waitFor("document.querySelector('#react-layer .react-float.theirs')", { what: "host sees it too" });
});

test("a guest refreshes mid-game: same seat, board restored from the host, play goes on for all three", { skip: !ONLINE }, async () => {
    await B.goto(`${server.url}?room=${code}`);
    await B.waitFor("Net.connected", { timeout: 40000, what: "guest 1 reconnected" });
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.history.length === 3", { what: "guest 1 board restored" });
    assert.equal(await B.ev("document.getElementById('p1-you').hidden"), false, "guest 1 keeps seat 1");
    await A.waitFor("document.getElementById('net-banner').hidden", { what: "host's banner gone" });
    await C.waitFor("document.getElementById('net-banner').hidden", { what: "guest 2's banner gone" });
    await A.move(10);
    await history(B, 4); await history(C, 4);
    await B.move(3);
    await history(A, 5); await history(C, 5);
    await C.move(12);
    await history(A, 6); await history(B, 6);
});

test("rematch needs every seat; then one Back to room brings all three to the lobby", { skip: !ONLINE }, async () => {
    await A.click("#btn-restart");
    await B.waitFor("document.getElementById('overlay-again').textContent === 'Accept rematch'", { what: "guest 1 sees the request" });
    await C.waitFor("document.getElementById('overlay-again').textContent === 'Accept rematch'", { what: "guest 2 sees the request" });
    assert.match(await A.text("overlay-again"), /Waiting for others… \(1\/3\)/);
    await B.click("#overlay-again");
    await A.waitFor("document.getElementById('overlay-again').textContent === 'Waiting for others… (2/3)'", { what: "host counts two votes" });
    assert.equal((await C.state()).history.length, 6, "not yet: one vote missing");
    await C.click("#overlay-again");
    for (const X of [A, B, C]) await X.waitFor("ChainGame.state.history.length === 0 && !ChainGame.state.over", { what: "in the rematch" });
    for (const X of [A, B, C]) assert.equal((await X.state()).current, 1, "game 2: seat 1 starts");
    await B.move(0);
    await history(A, 1); await history(C, 1);
    await C.click("#btn-menu");
    await inLobby(A); await inLobby(B); await inLobby(C);
    assert.equal(await A.ev("document.getElementById('toast').textContent"), "Cy went back to the room");
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []); assert.deepEqual(C.errors, []);
});

test("the player count cannot drop below the people in the room (#34): 2 is disabled for everyone, a forged message is refused, leaving frees it", { skip: !ONLINE }, async () => {
    const btn = (X, n) => X.ev(`(() => { const b = document.querySelector('#set-players button[data-players="${n}"]'); return { disabled: b.disabled, title: b.title }; })()`);
    const hint = "Someone would lose their seat. They have to leave the room first.";
    for (const X of [A, B, C]) {
        await X.waitFor(`document.querySelector('#set-players button[data-players="2"]').disabled`, { what: "2 disabled while three sit in the room" });
        assert.deepEqual(await btn(X, 3), { disabled: false, title: "" });
        assert.deepEqual(await btn(X, 4), { disabled: false, title: "" });
        assert.equal((await btn(X, 2)).title, hint);
    }
    await A.click('#set-players button[data-players="2"]');            // a disabled button does nothing
    assert.equal(await A.ev("Settings.read().players"), 3);

    // a guest with a stale (or forged) view sends the count anyway: the host refuses it and corrects the sender
    await B.ev("document.getElementById('toast').textContent = ''");
    await B.ev(`Net.send({ t: "lobby", s: { ...Settings.read(), players: 2 }, from: 1 })`);
    await B.waitFor("document.getElementById('toast').textContent.startsWith('Settings updated by')", { what: "the host corrects the sender" });
    for (const X of [A, B, C]) {
        assert.equal(await X.ev("Settings.read().players"), 3, "still three seats");
        assert.equal(await X.ev("document.querySelectorAll('.lobby-player').length"), 3);
    }
    assert.equal(await C.ev("Match.me"), 2, "nobody lost their seat");
    assert.equal(await C.ev("Match.spectator"), false);

    // once somebody leaves, the count is free again
    await C.click("#btn-lobby-back");
    for (const X of [A, B]) await X.waitFor(`!document.querySelector('#set-players button[data-players="2"]').disabled`, { what: "2 selectable again" });
    await A.players(2);
    await B.waitFor("document.querySelector('#set-players button.selected').dataset.players === '2'", { what: "guest mirrors two seats" });
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []); assert.deepEqual(C.errors, []);
});
