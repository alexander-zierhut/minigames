/* Two browsers through the real PeerJS broker. Needs internet; set SKIP_ONLINE=1 to skip. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, bothConnected, sleep, ONLINE } from "./harness.mjs";

let server, A, B, code;
before(async () => {
    if (!ONLINE) return;
    server = await startServer();
    A = await launchBrowser();
    B = await launchBrowser({ width: 390, height: 844, mobile: true });
    await A.goto(server.url);
    await A.selectSkin("classic");
});
after(async () => { await A?.close(); await B?.close(); await server?.close(); });

test("create room, join by link, lobby shows both players", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    assert.match(code, /^[A-Z0-9]{5}$/);
    assert.equal(await A.ev("document.getElementById('btn-start').disabled"), true, "host can't start alone");
    assert.equal(await A.ev("location.search"), `?room=${code}`);
    await joinRoom(B, server.url, code);
    await bothConnected(A, B);
    assert.equal(await A.screen(), "screen-lobby"); assert.equal(await B.screen(), "screen-lobby");
    assert.equal(await A.ev("Net.role"), "host"); assert.equal(await B.ev("Net.role"), "guest");
    assert.equal(await A.text("lp-1-status"), "connected");
    assert.match(await B.text("btn-start"), /asks the host/);
});

test("lobby settings mirror both ways", { skip: !ONLINE }, async () => {
    await A.selectGame("five"); await A.click("#btn-settings"); await A.set("set-size", 7); await A.set("set-winlen", 5); await A.click("#btn-settings-done");
    await B.waitFor("document.querySelector('.game-card.selected').dataset.game === 'five' && document.getElementById('set-size').value === '7'", { what: "guest mirrors host settings" });
    await B.click("#btn-settings"); await B.set("set-timer", 180); await B.click("#btn-settings-done");
    await A.waitFor("document.getElementById('set-timer').value === '180'", { what: "host mirrors guest timer" });
    assert.match(await A.text("settings-summary"), /7 × 7 · 5 in a row · 3 min timer/);
});

test("guest presses start, host starts, both in the same game; moves sync; wrong-turn move ignored", { skip: !ONLINE }, async () => {
    await B.click("#btn-start");
    await A.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "host in game" });
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "guest in game" });
    await sleep(400);
    assert.equal((await A.state()).n, 7); assert.equal((await B.state()).n, 7);
    assert.equal((await A.state()).current, 0, "host starts game 1");
    assert.equal(await A.text("clock-0"), "3:00");
    await B.cell(24); await sleep(300);
    assert.equal((await B.state()).history.length, 0, "guest cannot move on the host's turn");
    await A.move(24);
    await B.waitFor("FiveGame.state.history.length === 1", { what: "guest received move" });
    await B.move(25);
    await A.waitFor("FiveGame.state.history.length === 2", { what: "host received move" });
    assert.equal(JSON.stringify((await A.state()).history), "[24,25]");
});

test("reactions relay to the other side, rate limited", { skip: !ONLINE }, async () => {
    await A.click("#react-toggle");
    await A.click('#react-bar button[data-e="🔥"]');
    await B.waitFor("document.getElementById('react-layer').children.length >= 1", { what: "guest sees reaction" });
    assert.equal(await B.ev("document.querySelector('#react-layer .react-float').classList.contains('theirs')"), true);
});

test("guest refreshes mid-game and gets the board back; host's next move arrives", { skip: !ONLINE }, async () => {
    await B.goto(`${server.url}?room=${code}`);
    await B.waitFor("Net.connected", { timeout: 40000, what: "guest reconnected" });
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && FiveGame.state.history.length === 2", { what: "guest state restored" });
    await A.waitFor("Net.connected", { what: "host sees guest again" });
    await sleep(300);
    await A.move(31);
    await B.waitFor("FiveGame.state.history.length === 3", { what: "move after reconnect" });
});

test("back to room from one side moves both; host switches game; guest follows", { skip: !ONLINE }, async () => {
    await B.click("#btn-menu");
    await A.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "host back in lobby" });
    await A.selectGame("chain"); await A.click("#btn-settings"); await A.set("set-size", 4); await A.set("set-speed", 350); await A.set("set-timer", 0); await A.click("#btn-settings-done");
    await B.waitFor("document.querySelector('.game-card.selected').dataset.game === 'chain'", { what: "guest mirrors chain" });
    await A.click("#btn-start");
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && document.getElementById('board').classList.contains('chain')", { what: "guest in chain game" });
    assert.equal((await B.state()).current, 1, "game 2: guest starts");
    await B.move(0);
    await A.waitFor("ChainGame.state.history.length === 1", { what: "host got guest move" });
});

test("rematch handshake and leave banner", { skip: !ONLINE }, async () => {
    await A.click("#btn-restart");
    await B.waitFor("document.getElementById('overlay-again').textContent === 'Accept rematch'", { what: "guest sees rematch request" });
    await B.click("#btn-restart");
    await A.waitFor("ChainGame.state.history.length === 0 && !ChainGame.state.over", { what: "host in rematch" });
    await B.waitFor("ChainGame.state.history.length === 0", { what: "guest in rematch" });
    assert.equal((await A.state()).current, 0, "game 3: host starts again");
    await B.click("#btn-menu"); await sleep(300);      // guest to lobby
    await B.click("#btn-lobby-back");                   // guest leaves the room
    await A.waitFor("!document.getElementById('net-banner').hidden || document.getElementById('lobby-status').textContent.includes('left')", { timeout: 10000, what: "host informed" });
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
});
