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

test("chat lines relay both ways in the sender's colour, text only, into the game log", { skip: !ONLINE }, async () => {
    await A.set("chat-input", "hi <b>there</b>");
    await A.click("#chat-send");
    assert.equal(await A.ev("document.getElementById('chat-input').value"), "", "input cleared after sending");
    assert.equal(await A.ev("document.querySelector('#log .chat').textContent"), "Cyan: hi <b>there</b>", "my own line at once");
    await B.waitFor("document.querySelector('#log .chat') && document.querySelector('#log .chat').textContent === 'Cyan: hi <b>there</b>'", { what: "guest sees the host's line" });
    assert.equal(await B.ev("document.querySelector('#log .chat').className"), "chat p0");
    assert.equal(await B.ev("document.querySelectorAll('#log .chat b').length"), 1, "only the name is bold");
    assert.equal(await B.ev("document.getElementById('lobby-chat')"), null, "the lobby has no chat any more (#15)");
    await B.ev("document.getElementById('chat-input').value = 'yo'; document.getElementById('chat-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); true");
    await A.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Amber: yo' && l.classList.contains('p1'))", { what: "host sees the guest's line in amber" });
    assert.equal(await B.ev("Sound.log.filter(l => l.name === 'chat').length"), 1, "the guest heard the host's line, not its own");
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

test("rematch handshake", { skip: !ONLINE }, async () => {
    await A.click("#btn-restart");
    await B.waitFor("document.getElementById('overlay-again').textContent === 'Accept rematch'", { what: "guest sees rematch request" });
    await B.click("#btn-restart");
    await A.waitFor("ChainGame.state.history.length === 0 && !ChainGame.state.over", { what: "host in rematch" });
    await B.waitFor("ChainGame.state.history.length === 0", { what: "guest in rematch" });
    assert.equal((await A.state()).current, 0, "game 3: host starts again");
    await A.move(0);
    await B.waitFor("ChainGame.state.history.length === 1", { what: "guest got host move" });
});

test("host refreshes mid-game: reclaims the room, guest reconnects, game continues", { skip: !ONLINE }, async () => {
    await A.goto(`${server.url}?room=${code}`);
    await A.waitFor("Net.connected", { timeout: 40000, what: "host reconnected" });
    assert.equal(await A.ev("Net.role"), "host");
    await A.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.history.length === 1", { what: "host board restored" });
    assert.equal(await A.ev("document.getElementById('p0-you').hidden"), false, "host keeps seat 0");
    await B.waitFor("Net.connected", { what: "guest sees host again" });
    await sleep(300);
    await B.move(15);                                   // guest's turn (seat 1)
    await A.waitFor("ChainGame.state.history.length === 2", { what: "host got move after its refresh" });
});

test("guest leaves the room and comes back by link: same seat, board restored", { skip: !ONLINE }, async () => {
    await B.click("#btn-menu"); await sleep(300);       // guest to lobby (takes the host along)
    await A.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "host in lobby" });
    await B.click("#btn-lobby-back");                   // guest leaves the room
    await A.waitFor("document.getElementById('lobby-status').textContent.includes('left')", { timeout: 10000, what: "host informed" });
    assert.equal(await B.screen(), "screen-menu");
    assert.equal(await A.ev("document.getElementById('btn-start').disabled"), true, "host can't start without the friend");
    await B.goto(`${server.url}?room=${code}`);
    await B.waitFor("Net.connected", { timeout: 40000, what: "guest back" });
    await A.waitFor("Net.connected", { what: "host sees guest" });
    await B.waitFor("!document.getElementById('lp-1').classList.contains('absent') && document.getElementById('lp-1').textContent.includes('(you)')", { what: "guest has seat 1 again" });
    await A.click("#btn-start");
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "guest in game 4" });
    assert.equal((await B.state()).current, 1, "game 4: guest (seat 1) starts");
    await B.move(0);
    await A.waitFor("ChainGame.state.history.length === 1", { what: "host got move" });
});

test("host leaves; the guest takes over the room; the host returns by link as guest with its old seat", { skip: !ONLINE }, async () => {
    await A.click("#btn-menu"); await sleep(300);
    await A.click("#btn-lobby-back");                   // host leaves the room for good
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "guest in lobby" });
    await B.waitFor("Net.role === 'host' && Net.status === 'waiting'", { timeout: 40000, what: "guest took over hosting" });
    assert.equal(await B.ev("document.getElementById('lp-1').textContent.includes('(you)')"), true, "guest keeps seat 1 as host");
    await A.goto(`${server.url}?room=${code}`);
    await A.waitFor("Net.connected", { timeout: 40000, what: "former host joined as guest" });
    assert.equal(await A.ev("Net.role"), "guest");
    await A.waitFor("document.getElementById('lp-0').textContent.includes('(you)')", { what: "former host gets seat 0 back" });
    await B.waitFor("Net.connected", { what: "new host sees the friend" });
    await sleep(300);
    await A.click("#btn-start");                        // guest asks the new host to start
    await A.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "game started by the new host" });
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "new host in game" });
    assert.equal((await A.state()).current, 0, "game 5 in this room: seat 0 starts");
    await A.move(5);
    await B.waitFor("ChainGame.state.history.length === 1", { what: "new host got the move" });
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
});
