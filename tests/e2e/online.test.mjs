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
    // fixed names (#35) so every text that carries one is deterministic; they are kept in
    // localStorage, so the guest's later navigation into the room still uses "Bo"
    await A.ev("Prefs.set({ name: 'Alex' })");
    await B.goto(server.url);
    await B.ev("Prefs.set({ name: 'Bo' })");
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
    // each side shows its own name and the other's on the seat cards (#35)
    const cardName = (X, k) => X.ev(`document.querySelector('#lp-${k} .lp-name').textContent`);
    await A.waitFor("document.querySelector('#lp-1 .lp-name').textContent === 'Bo'", { what: "host sees the guest's name" });
    assert.equal(await cardName(A, 0), "Alex");
    await B.waitFor("document.querySelector('#lp-0 .lp-name').textContent === 'Alex'", { what: "guest sees the host's name" });
    assert.equal(await cardName(B, 1), "Bo");
    assert.equal(await A.ev("document.querySelector('#lp-0 .lp-you').textContent"), "(you)");
});

test("a new name in the preferences reaches the others (#35)", { skip: !ONLINE }, async () => {
    // the guest renames itself through the form field in the Profile section
    await B.click("#prefs-btn");
    await B.click("#prefs-nav-profile");
    await B.set("pref-name", "  Robin the very long name  ");
    assert.equal(await B.ev("Prefs.get().name"), "Robin the very l", "trimmed and cut to 16 characters");
    await B.click("#btn-prefs-done");
    await A.waitFor("document.querySelector('#lp-1 .lp-name').textContent === 'Robin the very l'", { what: "host sees the new name" });
    assert.equal(await B.ev("document.querySelector('#lp-1 .lp-name').textContent"), "Robin the very l", "and so does the guest itself");
    // the host renames itself: everybody follows through the roster
    await A.ev("Prefs.set({ name: 'Kim' })");
    await B.waitFor("document.querySelector('#lp-0 .lp-name').textContent === 'Kim'", { what: "guest sees the host's new name" });
    // back to the names the rest of this file expects
    await A.ev("Prefs.set({ name: 'Alex' })");
    await B.ev("Prefs.set({ name: 'Bo' })");
    await A.waitFor("document.querySelector('#lp-1 .lp-name').textContent === 'Bo'", { what: "names restored on the host" });
    await B.waitFor("document.querySelector('#lp-0 .lp-name').textContent === 'Alex'", { what: "names restored on the guest" });
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
    assert.equal(await A.text("p0-name"), "Alex"); assert.equal(await A.text("p1-name"), "Bo", "the HUD cards carry the names (#35)");
    assert.equal(await B.text("p0-name"), "Alex"); assert.equal(await B.text("p1-name"), "Bo");
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
    // the float glows in the sender's colour, so you can see who sent it (#33)
    assert.equal(await B.ev("document.querySelector('#react-layer .react-float').style.getPropertyValue('--react-color')"), "var(--c0)", "the host's seat colour");
    const filter = await B.ev("getComputedStyle(document.querySelector('#react-layer .react-float')).filter");
    assert.match(filter, /drop-shadow\(.*\).*drop-shadow\(/, `dark shadow plus the coloured glow (${filter})`);
    // my own reaction glows in my own seat's colour
    await B.click("#react-toggle");
    await B.click('#react-bar button[data-e="👏"]');
    await B.waitFor("[...document.querySelectorAll('#react-layer .react-float')].some(f => !f.classList.contains('theirs'))", { what: "own reaction" });
    assert.equal(await B.ev("[...document.querySelectorAll('#react-layer .react-float')].find(f => !f.classList.contains('theirs')).style.getPropertyValue('--react-color')"), "var(--c1)", "the guest's own seat colour");
    await B.click("#react-toggle");
});

test("chat lines relay both ways in the sender's colour, text only, into the game log", { skip: !ONLINE }, async () => {
    await A.set("chat-input", "hi <b>there</b>");
    await A.click("#chat-send");
    assert.equal(await A.ev("document.getElementById('chat-input').value"), "", "input cleared after sending");
    assert.equal(await A.ev("document.querySelector('#log .chat').textContent"), "Alex: hi <b>there</b>", "my own line at once");
    await B.waitFor("document.querySelector('#log .chat') && document.querySelector('#log .chat').textContent === 'Alex: hi <b>there</b>'", { what: "guest sees the host's line" });
    assert.equal(await B.ev("document.querySelector('#log .chat').className"), "chat p0");
    assert.equal(await B.ev("document.querySelectorAll('#log .chat b').length"), 1, "only the name is bold");
    assert.equal(await B.ev("document.getElementById('lobby-chat')"), null, "the lobby has no chat any more (#15)");
    await B.ev("document.getElementById('chat-input').value = 'yo'; document.getElementById('chat-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); true");
    await A.waitFor("[...document.querySelectorAll('#log .chat')].some(l => l.textContent === 'Bo: yo' && l.classList.contains('p1'))", { what: "host sees the guest's line in the second seat's colour" });
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

test("premove (#37): the guest clicks while the host is to move, it is played the moment the turn comes; a cell the host takes is dropped", { skip: !ONLINE }, async () => {
    await B.move(32);                                                    // now the host is to move
    // one page eval so the click and what it produced are read in the same moment
    const set = JSON.parse(await B.ev(`(() => {
        document.querySelectorAll('#board > .stone')[10].click();
        return JSON.stringify({ pre: Match.premove, cls: document.querySelectorAll('#board > .stone')[10].className, hint: document.getElementById('turn-hint').textContent, moves: FiveGame.state.history.length });
    })()`));
    assert.equal(set.pre, 10, "the click on the host's turn is remembered");
    assert.match(set.cls, /\bpremove\b/, "the cell is marked");
    assert.match(set.hint, /premove set$/);
    assert.equal(set.moves, 4, "nothing played yet");
    await A.move(11);
    await B.waitFor("FiveGame.state.history.length === 6 && Match.premove === -1", { what: "the guest's premove followed the host's move" });
    await A.waitFor("FiveGame.state.history.length === 6", { what: "the host received the premove" });
    assert.equal(JSON.stringify((await A.state()).history.slice(-3)), "[32,11,10]");
    assert.equal((await B.ev("document.querySelectorAll('#board > .stone')[10].className")).includes("premove"), false, "the marker is gone once it was played");
    // premove on a cell the host then takes: dropped, nothing is sent
    assert.equal(await B.ev("(() => { document.querySelectorAll('#board > .stone')[12].click(); return Match.premove; })()"), 12);
    await A.move(12);
    await B.waitFor("FiveGame.state.history.length === 7 && Match.premove === -1 && FiveGame.state.current === 1", { what: "illegal premove dropped, guest still to move" });
    await sleep(300);
    assert.equal((await A.state()).history.length, 7, "the host got no extra move");
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

test("replay after the game (#38): both sides look at the same move", { skip: !ONLINE }, async () => {
    // play the running game out: whoever is to move clicks a legal cell (deterministic)
    for (let m = 0; m < 120; m++) {
        const st = await A.state();
        if (st.over) break;
        const [P, O] = st.current === 0 ? [A, B] : [B, A];
        const i = await P.ev(`(() => { const s = ChainGame.state; const legal = []; s.cells.forEach((c, k) => { if (c.owner === -1 || c.owner === s.current) legal.push(k); }); return legal[${m} % legal.length]; })()`);
        await P.move(i);
        await O.waitFor(`ChainGame.state.history.length === ${st.history.length + 1} && !ChainGame.state.busy`, { timeout: 30000, what: "the move arrived" });
    }
    await A.waitFor("ChainGame.state.over", { what: "host sees the end" });
    await B.waitFor("ChainGame.state.over", { what: "guest sees the end" });
    const total = (await A.state()).history.length;
    await A.click("#overlay-look");
    assert.equal(await A.text("replay-pos"), `Move ${total} / ${total}`);
    await A.click("#replay-first");
    await B.waitFor("ChainGame.previewPly === 0 && !document.getElementById('replay-bar').hidden", { what: "guest follows to the first position" });
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true, "the guest's result overlay steps aside");
    assert.equal(await B.text("replay-pos"), `Move 0 / ${total}`);
    assert.equal(await B.ev("document.querySelectorAll('#board > .cell.taken').length"), 0, "the guest shows the empty board too");
    await B.click("#replay-next");                      // and the other way round
    await A.waitFor("ChainGame.previewPly === 1", { what: "host follows the guest" });
    assert.equal(await A.text("replay-pos"), `Move 1 / ${total}`);
    await A.click("#replay-last");
    await B.waitFor("ChainGame.previewPly === null", { what: "guest back at the result" });
    assert.equal(await B.ev(`ChainGame.state.over && ChainGame.state.history.length === ${total}`), true, "the finished game itself never changed");

    /* Play / Pause is synced too (#43): one side presses Play and both walk to the end on
       their own timer; a Pause on either side stops both at the same move. */
    for (let k = 0; k < 3; k++) await A.click("#replay-prev");            // three moves before the end
    await B.waitFor(`ChainGame.previewPly === ${total - 3}`, { what: "guest at the same move" });
    await A.click("#replay-play");
    assert.equal(await A.text("replay-play"), "❚❚", "the button offers Pause while it plays");
    await B.waitFor("document.getElementById('replay-play').textContent === '❚❚'", { timeout: 20000, what: "the guest plays along" });
    await A.waitFor("ChainGame.previewPly === null", { timeout: 20000, what: "the host reached the last move" });
    await B.waitFor("ChainGame.previewPly === null", { timeout: 20000, what: "the guest reached it too" });
    assert.equal(await A.text("replay-play"), "▶▶", "reaching the end stops it");
    assert.equal(await B.text("replay-play"), "▶▶");

    // Play again from the end starts over; Pause on the guest stops both at its move
    await A.click("#replay-play");
    await B.waitFor("ChainGame.previewPly !== null && ChainGame.previewPly > 0", { timeout: 20000, what: "the guest started over too" });
    await B.click("#replay-play");
    const stopped = await B.ev("ChainGame.previewPly");
    assert.equal(await B.text("replay-play"), "▶▶", "Pause on the guest");
    await A.waitFor(`ChainGame.previewPly === ${stopped} && document.getElementById('replay-play').textContent === '▶▶'`, { what: "the host stops at the same move" });
    await A.click("#replay-last");
    await B.waitFor("ChainGame.previewPly === null", { what: "both back at the result" });
    // every device keeps its own copy of the game in its replays (#42)
    for (const P of [A, B]) {
        const saved = JSON.parse(await P.ev("Replays.store.list({ game: 'chain' }).then(JSON.stringify)"));
        assert.ok(saved.some((r) => r.moves === total && r.mode === "online"), "the online game is in the replays list");
    }
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
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

test("hide the room code (#19): bullets in the lobby and the HUD, nothing in the URL, share and copy still carry it, a refresh keeps it hidden, the preference hides new rooms", { skip: !ONLINE }, async () => {
    await A.click("#btn-menu"); await sleep(300);                                        // both back to the lobby
    await B.waitFor("document.querySelector('.screen:not([hidden])').id === 'screen-lobby'", { what: "host in lobby" });
    assert.equal(await A.text("lobby-code"), code);
    assert.equal(await A.ev("document.querySelector('#btn-hide-code .gear-icon').dataset.icon"), "eye");
    await A.click("#btn-hide-code");
    assert.equal(await A.ev("document.getElementById('hide-code-ask').hidden"), false, "the first time asks whether new rooms should start hidden");
    assert.equal(await A.text("lobby-code"), code, "nothing hidden until the question is answered");
    await A.click("#btn-hide-once");
    assert.equal(await A.ev("Prefs.get().hideCode"), false, "'Just this room' leaves the preference alone");
    assert.equal(await A.ev("Prefs.get().hideCodeAsked"), true, "and the question is not asked again");
    assert.equal(await A.text("lobby-code"), "•••••");
    assert.equal(await A.ev("document.querySelector('#btn-hide-code .gear-icon').dataset.icon"), "eye-off");
    assert.equal(await A.text("hide-code-label"), "Show the room code");
    assert.equal(await A.text("net-code"), "Room •••••", "the HUD net box hides it too");
    assert.equal(await A.ev("location.search"), "", "the code left the address bar");
    assert.equal(await A.ev("Net.code"), code, "the room itself is unchanged");
    assert.ok((await A.ev("Room.roomLink(Net.code)")).endsWith(`?room=${code}`), "the share link still carries the code");
    await A.ev("navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; true");
    await A.click("#btn-copy-code");
    await A.waitFor(`window.__copied === ${JSON.stringify(code)}`, { what: "copy code copies the real code" });
    assert.equal(await B.text("lobby-code"), code, "only my own view hides it");
    // a refresh of the bare page rejoins the room from the session and keeps the code hidden
    await A.goto(server.url);
    await A.waitFor("Net.connected", { timeout: 40000, what: "rejoined without ?room= in the URL" });
    assert.equal(await A.screen(), "screen-lobby");
    assert.equal(await A.text("lobby-code"), "•••••");
    assert.equal(await A.ev("location.search"), "");
    await A.waitFor("document.getElementById('lp-0').textContent.includes('(you)')", { what: "seat 0 restored" });
    await A.click("#btn-hide-code");                                                  // show again
    assert.equal(await A.text("lobby-code"), code);
    assert.equal(await A.ev("location.search"), `?room=${code}`, "the address bar carries the code again");
    // the preference: new rooms start hidden
    await A.click("#prefs-btn"); await A.check("pref-hide-code", true); await A.click("#btn-prefs-done");
    await A.click("#btn-lobby-back");
    const second = await createRoom(A);
    assert.notEqual(second, code);
    assert.equal(await A.text("lobby-code"), "•••••");
    assert.equal(await A.ev("location.search"), "");
    await A.click("#prefs-btn"); await A.check("pref-hide-code", false); await A.click("#btn-prefs-done");
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
});

test("keep my IP always private (#30): the next room is created with relay-only ICE; the friend still connects, through the relay", { skip: !ONLINE }, async () => {
    await A.click("#prefs-btn"); await A.check("pref-private-ip", true); await A.click("#btn-prefs-done");
    assert.equal(await A.ev("Prefs.get().privateIp"), true);
    assert.equal(await A.ev("Net.iceInfo.relayOnly"), false, "the room I am in was created before: unchanged");
    await A.click("#btn-lobby-back");
    const third = await createRoom(A);
    assert.equal(await A.ev("Net.iceInfo.relayOnly"), true);
    assert.equal(await A.ev("Net.peer.options.config.iceTransportPolicy"), "relay", "the RTCPeerConnection only offers relay candidates");
    const turn = await A.ev("Net.iceInfo.turn");
    if (!turn) { console.log("no TURN server in the ICE list right now: connection check skipped"); assert.equal(await A.ev("Net.status"), "waiting"); }
    else {
        await B.goto(`${server.url}?room=${third}`);
        await B.waitFor("Net.connected", { timeout: 60000, what: "guest connected through the relay" });
        await A.waitFor("Net.connected", { timeout: 60000, what: "host connected" });
        const local = await A.waitFor(`(async () => {
            const c = [...Object.values(Net.peer.connections)].flat()[0]; if (!c || !c.peerConnection) return null;
            const st = await c.peerConnection.getStats(); let out = null;
            st.forEach((r) => { if (r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded"))) { const l = st.get(r.localCandidateId); if (l) out = l.candidateType; } });
            return out; })()`, { timeout: 20000, what: "selected candidate pair known" });
        assert.equal(local, "relay", "the host's side of the connection is a relay candidate: its IP stays with the TURN server");
        assert.equal(await B.ev("Net.iceInfo.relayOnly"), false, "only my own preference relays my side");
        // developer info (#31): the route per connection shows in the panel
        await A.click("#prefs-btn"); await A.check("pref-developer", true); await A.click("#btn-prefs-done");
        // (the expression is evaluated in the page, so the regex escapes are doubled here; in the
        // lobby Match.names is empty, so a connection reads "c1 seat 1:" without a colour name)
        await A.waitFor("/connected as host · broker open\\n  ice: relay only \\(IP private\\) · turn yes/.test(document.getElementById('dev-panel').textContent) && /c\\d+ seat 1[^:]*: open · pong \\d+ ms ago\\n    route relay → \\w+ \\(\\w+\\) · rtt [\\d?]+ ms/.test(document.getElementById('dev-panel').textContent)", { timeout: 20000, what: "route in the dev panel" });
        await A.click("#prefs-btn"); await A.check("pref-developer", false); await A.click("#btn-prefs-done");
        await B.click("#btn-lobby-back");
    }
    await A.click("#prefs-btn"); await A.check("pref-private-ip", false); await A.click("#btn-prefs-done");
    await A.click("#btn-lobby-back");
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
});
