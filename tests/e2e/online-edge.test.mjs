/* The annoying edge cases of joining and rejoining a room, through the real PeerJS
   broker. Needs internet; SKIP_ONLINE=1 skips. Each test builds its own situation. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, createRoom, joinRoom, bothConnected, sleep, ONLINE } from "./harness.mjs";

let server, A, B, C, code;
const inGame = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game'", { what: "in game" });
const inLobby = (X) => X.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "in lobby" });
const you = (X, k) => X.ev(`document.getElementById('lp-${k}').textContent.includes('(you)') || (!document.getElementById('p${k}-you').hidden && !document.getElementById('screen-game').hidden)`);

before(async () => {
    if (!ONLINE) return;
    server = await startServer();
    A = await launchBrowser();
    B = await launchBrowser({ width: 390, height: 844, mobile: true });
    await A.goto(server.url);
});
after(async () => { await A?.close(); await B?.close(); await C?.close(); await server?.close(); });

test("a third person finds every seat taken and becomes a spectator; the two players stay connected", { skip: !ONLINE }, async () => {
    code = await createRoom(A);
    await joinRoom(B, server.url, code);
    await bothConnected(A, B);
    C = await launchBrowser();
    await C.goto(`${server.url}?room=${code}`);
    await C.waitFor("Net.connected && document.getElementById('btn-start').textContent === 'Spectating'", { timeout: 40000, what: "third person told it is spectating" });
    assert.equal(await C.ev("document.getElementById('btn-start').disabled"), true);
    await A.waitFor("document.getElementById('lobby-spectators').textContent === '1 spectator watching'", { what: "host counts the spectator" });
    assert.equal(await A.ev("Net.connected"), true, "host still connected to the first guest");
    assert.equal(await B.ev("Net.connected"), true);
    assert.equal(await A.text("lp-1-status"), "connected");
    await C.click("#btn-lobby-back");
    await A.waitFor("document.getElementById('lobby-spectators').textContent === ''", { timeout: 20000, what: "spectator left" });
    await C.close(); C = null;
});

test("both refresh in the lobby: seats and roles come back, start still works", { skip: !ONLINE }, async () => {
    await B.goto(`${server.url}?room=${code}`);
    await A.goto(`${server.url}?room=${code}`);
    await bothConnected(A, B);
    await A.waitFor("document.getElementById('lp-0').textContent.includes('(you)')", { what: "host seat 0" });
    await B.waitFor("document.getElementById('lp-1').textContent.includes('(you)')", { what: "guest seat 1" });
    assert.equal(await A.ev("Net.role"), "host");
    await A.selectGame("chain"); await A.click("#btn-settings"); await A.set("set-size", 4); await A.set("set-speed", 350); await A.click("#btn-settings-done");
    await B.waitFor("document.getElementById('set-size').value === '4'", { what: "settings mirrored after refresh" });
    await B.click("#btn-start");
    await inGame(A); await inGame(B);
    assert.equal((await A.state()).current, 0);
});

test("guest closes the tab mid-game without a goodbye; the host waits; the guest returns by link", { skip: !ONLINE }, async () => {
    await A.move(5);
    await B.waitFor("ChainGame.state.history.length === 1", { what: "guest got move" });
    await B.blank();                                       // tab gone, no leave message
    await A.waitFor("!document.getElementById('net-banner').hidden", { timeout: 30000, what: "host notices (ping timeout)" });
    assert.equal(await A.ev("Clock.isEnabled()"), false);
    await B.goto(`${server.url}?room=${code}`);           // new tab: no session, fresh join
    await B.waitFor("Net.connected", { timeout: 40000, what: "guest back" });
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.history.length === 1", { what: "guest board restored from the host" });
    assert.equal(await B.ev("document.getElementById('p1-you').hidden"), false, "guest has seat 1 again");
    await A.waitFor("document.getElementById('net-banner').hidden", { what: "host banner gone" });
    await B.move(0);
    await A.waitFor("ChainGame.state.history.length === 2", { what: "host got the move" });
});

// seeded pseudo-random for deterministic "play it out" loops (mulberry32, same as Bots.rng)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("rematch asked while the friend was away is not lost", { skip: !ONLINE }, async () => {
    // finish the game: play it out with seeded random legal moves on both sides
    const rnd = rng(77);
    for (;;) {
        const st = await A.state();
        if (st.over) break;
        const X = st.current === 0 ? A : B;
        const legal = st.cells.map((c, i) => (c.owner === -1 || c.owner === st.current ? i : -1)).filter((i) => i >= 0);
        const n = st.history.length;
        await X.move(legal[Math.floor(rnd() * legal.length)]);
        const other = X === A ? B : A;
        await other.waitFor(`ChainGame.state.history.length > ${n} || ChainGame.state.over`, { what: "move relayed" });
        await other.idle();
    }
    await B.waitFor("ChainGame.state.over", { what: "guest sees the end" });
    await B.blank();                                       // guest gone
    await A.waitFor("!Net.connected", { timeout: 30000, what: "host sees the guest gone" });
    await A.click("#overlay-again");                      // rematch request goes nowhere (yet)
    assert.equal(await A.text("overlay-again"), "Waiting for opponent…");
    await B.goto(`${server.url}?room=${code}`);
    await B.waitFor("Net.connected && document.querySelector('.screen:not([hidden])').id === 'screen-game' && ChainGame.state.over", { timeout: 40000, what: "guest back on the finished game" });
    await B.waitFor("document.getElementById('overlay-again').textContent === 'Accept rematch'", { what: "guest learns about the pending rematch" });
    await B.click("#overlay-again");
    await A.waitFor("ChainGame.state.history.length === 0 && !ChainGame.state.over", { what: "host in rematch" });
    await B.waitFor("ChainGame.state.history.length === 0 && !ChainGame.state.over", { what: "guest in rematch" });
    assert.equal((await A.state()).current, (await B.state()).current, "same starter on both sides");
});

test("host's tab dies mid-game, the guest goes back to the room, the host returns: nobody is pulled back into the game", { skip: !ONLINE }, async () => {
    await A.blank();                                       // host gone without goodbye (session kept in the tab)
    await B.waitFor("!Net.connected", { timeout: 30000, what: "guest notices" });
    await B.click("#btn-menu");                            // guest: back to the room (tolobby goes nowhere)
    await inLobby(B);
    await A.goto(`${server.url}?room=${code}`);            // host returns with its session (still "in game")
    await A.waitFor("Net.connected", { timeout: 40000, what: "host back" });
    await B.waitFor("Net.connected", { timeout: 40000, what: "guest connected" });
    await inLobby(A);                                      // the newer intent (lobby) wins, whoever hosts now
    await sleep(500);
    assert.equal(await B.screen(), "screen-lobby", "guest stays in the lobby");
    assert.equal(await A.screen(), "screen-lobby");
});

test("boards drifted apart: the guest is rebuilt from the host and play continues", { skip: !ONLINE }, async () => {
    await A.selectGame("chain"); await A.click("#btn-settings"); await A.set("set-size", 4); await A.set("set-speed", 350); await A.click("#btn-settings-done");
    const host = (await A.ev("Net.role")) === "host" ? A : B, guest = host === A ? B : A;
    await host.click("#btn-start");
    await inGame(A); await inGame(B); await sleep(300);
    const first = (await A.state()).current;
    const seat = async (X) => (await X.ev("document.getElementById('p0-you').hidden")) ? 1 : 0;
    const mover = (await seat(A)) === first ? A : B, other = mover === A ? B : A;
    await mover.move(5);
    await other.waitFor("ChainGame.state.history.length === 1", { what: "move relayed" });
    // corrupt the guest's board behind the app's back, then let the guest move
    await guest.ev("ChainGame.state.cells[10].count = 1; ChainGame.state.cells[10].owner = 0; true");
    const guestSeat = await seat(guest);
    if ((await guest.state()).current !== guestSeat) { await host.move(0); await guest.waitFor("ChainGame.state.history.length === 2", { what: "host move" }); }
    const n = (await guest.state()).history.length;
    await guest.move(15);
    await host.waitFor(`ChainGame.state.history.length === ${n + 1}`, { timeout: 20000, what: "host applied the move after the re-sync" });
    await guest.waitFor("[...document.querySelectorAll('#log div')].some(d => d.textContent.includes('Re-synced'))", { what: "guest rebuilt" });
    await sleep(500);
    assert.equal(await guest.ev("ChainGame.hash()"), await host.ev("ChainGame.hash()"), "boards identical again");
    assert.equal((await guest.state()).cells[10].count, 0, "corruption gone");
});

test("boards keep differing: both go back to the room instead of playing two games", { skip: !ONLINE }, async () => {
    const host = (await A.ev("Net.role")) === "host" ? A : B, guest = host === A ? B : A;
    await guest.ev("ChainGame.hash = () => 1; true");    // the guest's fingerprint can never match
    const seat = async (X) => (await X.ev("document.getElementById('p0-you').hidden")) ? 1 : 0;
    if ((await guest.state()).current !== (await seat(guest))) { const n = (await guest.state()).history.length; await host.move(1); await guest.waitFor(`ChainGame.state.history.length === ${n + 1}`, { what: "host move" }); }
    await guest.move(14);
    await inLobby(guest); await inLobby(host);
    assert.equal(await guest.ev("document.getElementById('toast').textContent"), "Game out of sync. Back to the room.");
    await guest.goto(`${server.url}?room=${code}`);        // fresh script state for the next test
    await guest.waitFor("Net.connected", { timeout: 40000, what: "guest back" });
});

test("both type the same new code at the same time: exactly one host, two different seats", { skip: !ONLINE }, async () => {
    await A.goto(server.url); await B.goto(server.url);
    const fresh = await A.ev("Net.randomCode()");
    for (const X of [A, B]) { await X.click("#btn-join-open"); await X.set("join-code", fresh); }
    await Promise.all([A.click("#btn-join"), B.click("#btn-join")]);
    await bothConnected(A, B);
    const roles = [await A.ev("Net.role"), await B.ev("Net.role")].sort();
    assert.deepEqual(roles, ["guest", "host"]);
    const seats = await Promise.all([A, B].map((X) => X.ev("[0,1].find(k => document.getElementById('lp-' + k).textContent.includes('(you)'))")));
    assert.deepEqual(seats.sort(), [0, 1]);
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
});
