/* A bot in an online room (#36), three browsers through the real PeerJS broker: A waits
   alone in a two-seat room and plays a bot instead, C watches the bot game through the
   spectate link, B joins with the room code mid-game and watches, and back in the room the
   bot steps aside for B. Then A sets a bot again and refreshes mid-game: it keeps playing.
   Needs internet; SKIP_ONLINE=1 skips. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, sleep, ONLINE } from "./harness.mjs";

let server, A, B, C, code, spec;
const inGame = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "in game" });
const inLobby = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "in lobby" });
const grew = (X, n) => X.waitFor(`FiveGame.state.history.length >= ${n}`, { timeout: 30000, what: `history ${n}` });

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

test("alone in a two-seat room: 'Against a bot instead' puts a bot on the empty seat", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    spec = await A.ev("Room.spec");
    await A.selectGame("five"); await A.players(2);
    await A.click("#btn-settings"); await A.set("set-size", 6); await A.set("set-winlen", 4); await A.set("set-timer", 0); await A.click("#btn-settings-done");
    assert.match(await A.text("btn-start"), /Waiting for your friend/);
    assert.equal(await A.ev("document.getElementById('btn-room-bot').hidden"), false, "the offer is there while a seat is empty");
    assert.equal(await A.ev("document.getElementById('btn-room-bot-off').hidden"), true);
    await A.click("#btn-room-bot");
    assert.equal(await A.ev("document.getElementById('bot-modal').hidden"), false);
    await A.click('#bot-difficulty button[data-difficulty="easy"]');
    await A.click("#btn-bot-done");
    await A.waitFor("Settings.bot && Settings.bot.seat === 1", { what: "the room has a bot" });
    assert.equal(await A.ev("Settings.bot.difficulty"), "easy");
    await A.waitFor("document.querySelector('#lp-1 .lp-name').textContent === 'Bot'", { what: "the seat card says Bot" });
    assert.equal(await A.text("lp-1-status"), "ready");
    assert.equal(await A.ev("document.getElementById('btn-opponent').hidden"), false, "the level can be changed from the lobby");
    assert.match(await A.text("opponent-summary"), /^Bot · Easy · /);
    assert.equal(await A.ev("document.getElementById('btn-room-bot').hidden"), true);
    assert.equal(await A.ev("document.getElementById('btn-room-bot-off').hidden"), false, "and dropped again");
    assert.equal(await A.text("btn-start"), "Start game", "no waiting any more");
});

test("the bot plays in the room and a spectate-link viewer sees its moves and reactions", { skip: !ONLINE }, async () => {
    await C.goto(`${server.url}?watch=${spec}`);
    await C.waitFor("Net.connected", { timeout: 60000, what: "viewer connected" });
    await inLobby(C);
    await C.waitFor("document.querySelector('#lp-1 .lp-name').textContent === 'Bot'", { what: "the viewer sees the bot too" });
    await A.click("#btn-start");
    await inGame(A); await inGame(C);
    assert.equal(await C.text("p1-name"), "Bot", "the HUD calls it Bot for everybody");
    assert.equal(await A.ev("JSON.stringify(Match.seats.map(s => s.kind))"), JSON.stringify(["local", "bot"]));
    assert.equal(await C.ev("JSON.stringify(Match.seats.map(s => s.kind))"), JSON.stringify(["remote", "remote"]), "for a viewer it is a remote seat");
    await C.waitFor("[...document.querySelectorAll('#react-layer .react-float.theirs')].some(e => e.textContent === '👋')", { timeout: 15000, what: "the bot's wave reaches the viewer (#14)" });
    await A.move(0);
    await grew(A, 2);                                               // the bot answered without anybody else in the room
    await grew(C, 2);
    assert.equal(await C.ev("FiveGame.state.movesBy[1] > 0"), true, "the viewer sees the bot's moves");
});

test("a friend joins mid-game with the room code and watches; back in the room the bot steps aside", { skip: !ONLINE }, async () => {
    await joinRoom(B, server.url, code);
    await B.waitFor("Match.spectator === true", { timeout: 30000, what: "seat 1 is the bot's, so the friend watches" });
    await inGame(B);
    await B.waitFor("FiveGame.state.history.length >= 2", { timeout: 30000, what: "the friend sees the running bot game" });
    await A.click("#btn-menu");                                     // back to the room
    await inLobby(A); await inLobby(B);
    await A.waitFor("Settings.bot === null", { timeout: 20000, what: "the bot stepped aside" });
    await B.waitFor("Match.me === 1", { timeout: 20000, what: "the friend takes the freed seat" });
    assert.equal(await A.ev("document.getElementById('btn-opponent').hidden"), true, "no opponent row without a room bot");
    await A.waitFor("Room.allHere()", { what: "two players" });
    assert.equal(await A.text("btn-start"), "Start game");
    assert.equal(await A.ev("document.getElementById('btn-room-bot').hidden"), true, "no bot offer while the seat is taken");
});

test("the friend leaves, the bot comes back, and a refresh of the host keeps it playing", { skip: !ONLINE }, async () => {
    await B.click("#btn-lobby-back");
    await A.waitFor("Room.missingSeats().length === 1", { timeout: 30000, what: "seat 1 empty again" });
    await A.waitFor("!document.getElementById('btn-room-bot').hidden", { what: "the offer is back" });
    await A.click("#btn-room-bot"); await A.click("#btn-bot-done");
    await A.waitFor("Settings.bot !== null", { what: "bot again" });
    await A.click("#btn-start");
    await inGame(A);
    await A.move(7);
    await grew(A, 2);
    const before = (await A.state()).history.length;
    await A.goto(`${server.url}?room=${code}`);                     // refresh mid game
    await A.waitFor("Net.connected || Net.role === 'host'", { timeout: 40000, what: "host back" });
    await inGame(A);
    await A.waitFor(`FiveGame.state.history.length >= ${before}`, { timeout: 30000, what: "board restored" });
    assert.equal(await A.ev("Match.config.bot && Match.config.bot.seat"), 1, "the running game still has its bot");
    await A.waitFor("JSON.stringify(Match.seats.map(s => s.kind)) === JSON.stringify(['local','bot'])", { timeout: 30000, what: "the reclaimed host runs the bot again" });
    const st = await A.state();
    if (!st.over && st.current === 0) {
        const free = st.cells.map((c, i) => (c === -1 ? i : -1)).filter((i) => i >= 0);
        await A.move(free[0]);
    }
    await grew(A, before + 1);                                      // the bot keeps playing after the refresh
    assert.equal((await A.state()).movesBy[1] >= 2, true);
    await C.waitFor("Net.connected", { timeout: 60000, what: "the viewer is still with the room" });
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []); assert.deepEqual(C.errors, []);
});
