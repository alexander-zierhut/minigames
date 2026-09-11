import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, M;
before(async () => { server = await startServer(); M = await launchBrowser({ width: 360, height: 780, mobile: true }); await M.goto(server.url); });
after(async () => { await M?.close(); await server?.close(); });

async function assertNoScroll(label) {
    const s = await M.noScroll();
    assert.ok(s.x && s.y && s.screen, `${label}: no scrolling ${JSON.stringify(s)}`);
}

test("title screen and join panel fit a 360x780 phone", async () => {
    await assertNoScroll("menu");
    await M.click("#btn-join-open");
    await assertNoScroll("menu+join");
    const right = await M.ev("document.getElementById('btn-join').getBoundingClientRect().right");
    assert.ok(right <= 360, `join button inside the viewport (${right})`);
    await M.click("#btn-join-open");
    // the foot (#43): Learn and Replays side by side, same size, one line, no icons
    const foot = JSON.parse(await M.ev("JSON.stringify(['btn-learn', 'btn-replays'].map(id => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return { text: e.textContent, top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }))"));
    assert.equal(foot[0].top, foot[1].top, "Learn and Replays share a row");
    assert.equal(foot[0].w, foot[1].w, "same width");
    assert.equal(foot[0].h, foot[1].h, "same height");
    assert.deepEqual([foot[0].text, foot[1].text, await M.text("btn-changelog")], ["Learn to play", "Replays", "Changelog"], "no icons in the foot");
});

test("lobby (local) and settings modal fit", async () => {
    await M.click("#btn-local");
    await assertNoScroll("lobby");
    await M.click("#btn-settings");
    const s = await M.ev("JSON.stringify({sc: document.querySelector('.settings-card').scrollHeight <= document.querySelector('.settings-card').clientHeight + 1, rows: [...document.querySelectorAll('.settings .row:not([hidden]) > :last-child')].map(e => Math.round(e.getBoundingClientRect().right))})");
    const j = JSON.parse(s);
    assert.ok(j.sc, "settings card does not scroll");
    assert.ok(j.rows.every((r) => r === j.rows[0] && r <= 360), `controls aligned and inside (${j.rows})`);
    await M.click("#btn-settings-done");
});

// what an online room shows (share row, seat cards, spectator line) with four seats, without the broker
async function showRoomLobby() {
    await M.ev("document.getElementById('lobby-code').textContent = 'ABCDE'; document.getElementById('lobby-share').hidden = false; document.getElementById('group-players').hidden = false; document.getElementById('lobby-players').hidden = false; document.getElementById('lobby-spectators').textContent = '2 spectators watching'; (() => { const w = document.getElementById('btn-watch'); w.hidden = false; document.getElementById('lp-0').appendChild(w); const b = document.getElementById('btn-room-bot'); b.hidden = false; document.getElementById('lp-1').appendChild(b); document.querySelector('.lobby-head-row').appendChild(document.getElementById('row-players')); document.getElementById('group-count').hidden = true; document.getElementById('row-seats-label').hidden = false; })(); true");
}
test("online-shaped lobby with four seats: one Invite button beside the code, the share actions in a modal, the seat controls on the cards, every skin", async () => {
    await M.players(4);
    for (const skin of ["classic", "mcboard", "mc"]) {
        await M.selectSkin(skin);                 // re-renders the lobby (builds the four seat cards)
        await showRoomLobby();
        assert.equal(await M.ev("document.querySelectorAll('.lobby-player').length"), 4);
        // the head: one Invite button under the code; the share actions sit in the Invite modal, each with a word on it
        const inv = JSON.parse(await M.ev("JSON.stringify((() => { const r = document.getElementById('btn-invite').getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; })())"));
        assert.ok(inv.left >= 16 && inv.right <= 344, `${skin}: Invite inside the card (${JSON.stringify(inv)})`);
        const codeRect = JSON.parse(await M.ev("JSON.stringify(document.getElementById('lobby-code').getBoundingClientRect())"));
        assert.ok(inv.left >= codeRect.right && inv.top < codeRect.bottom && inv.right > codeRect.top, `${skin}: Invite beside the room code, to its right (${JSON.stringify(inv)} vs ${Math.round(codeRect.right)})`);
        assert.equal(await M.ev("document.querySelectorAll('#lobby-share .btn').length"), 1, `${skin}: the head holds one button`);
        await M.click("#btn-invite");
        const rows = JSON.parse(await M.ev("JSON.stringify(['btn-share', 'btn-copy-code', 'btn-share-spectate', 'btn-hide-code'].map(id => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return { text: e.querySelector('b').textContent, top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; }))"));
        assert.deepEqual(rows.map((r) => r.text), ["Share link", "Copy room code", "Copy a link for spectators", "Hide the room code"], `${skin}: every share action carries a word`);
        const shownRows = rows.filter((r) => r.right > r.left);          // the hide-code row only shows in a real room
        assert.ok(shownRows.length >= 3 && shownRows.every((r, i) => i === 0 || r.top > shownRows[i - 1].top), `${skin}: the rows are stacked (${JSON.stringify(shownRows)})`);
        assert.ok(shownRows.every((r) => r.left >= 16 && r.right <= 344), `${skin}: rows inside the modal`);
        await M.click("#btn-invite-done");
        assert.equal(await M.ev("document.getElementById('invite-modal').hidden"), true);
        await showRoomLobby();                    // opening Invite re-rendered the (offline) lobby: force the room shape again
        assert.equal(await M.ev("document.getElementById('lobby-chat')"), null, "no lobby chat");
        // the head carries the room and the seat count side by side, then the seat cards, then the game
        assert.ok(await M.ev("document.querySelector('.lobby-head-row').contains(document.getElementById('row-players'))"), "the seat count sits on the head's line");
        assert.ok(await M.ev("document.getElementById('group-players').contains(document.getElementById('row-seats-label'))"), "the Players heading belongs to the seat cards");
        assert.ok(await M.ev("document.getElementById('group-players').contains(document.getElementById('lobby-players'))"), "the seat cards follow it");
        assert.equal(await M.ev("[...document.querySelectorAll('#screen-lobby .lobby-group')].filter(g => parseFloat(getComputedStyle(g).borderTopWidth) > 0).length"), 0, "no hairlines in the lobby any more");
        assert.ok(await M.ev("document.getElementById('group-game').contains(document.getElementById('game-picker')) && document.getElementById('group-game').contains(document.getElementById('btn-settings'))"), "picker and settings in one group");
        // seat names are never cut off (the status wraps inside the card instead)
        assert.ok(await M.ev("[...document.querySelectorAll('.lobby-player .lp-name')].every(e => e.scrollWidth <= e.clientWidth + 1)"), `${skin}: seat names fit`);
        // the seat controls (#39) sit inside the seat cards they act on, and the spectator count in the Players heading
        const swap = JSON.parse(await M.ev("JSON.stringify(['btn-watch', 'btn-room-bot', 'lp-0', 'lp-1', 'lobby-spectators', 'row-players'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) }; }))"));
        assert.ok(swap[0].top >= swap[2].top && swap[0].bottom <= swap[2].bottom + 1, `${skin}: Watch instead inside my seat card (${JSON.stringify(swap)})`);
        assert.ok(swap[1].top >= swap[3].top && swap[1].bottom <= swap[3].bottom + 1, `${skin}: Add a bot inside the empty seat card`);
        assert.ok(swap.slice(0, 2).every((b) => b.left >= 16 && b.right <= 344), `${skin}: seat controls inside the card (${JSON.stringify(swap)})`);
        assert.ok(swap[4].top >= swap[5].top && swap[4].bottom <= swap[5].bottom + 1, `${skin}: the spectator count sits in the Players heading`);
        // four seats plus every seat control is taller than a 360×780 phone: the page scrolls
        // (owner's rule: a page scroll over a scroll inside the card), the card never does
        const fit = await M.noScroll();
        assert.ok(fit.x && fit.y, `${skin}: never sideways, never the document ${JSON.stringify(fit)}`);
        assert.ok(await M.ev("(() => { const c = document.querySelector('#screen-lobby .menu-card'); return c.scrollHeight <= c.clientHeight + 1; })()"), `${skin}: nothing scrolls inside the card`);
        await M.ev("(() => { const s = document.getElementById('screen-lobby'); s.scrollTop = s.scrollHeight; return true; })()");
        assert.ok(await M.ev("document.getElementById('btn-start').getBoundingClientRect().bottom <= innerHeight + 1"), `${skin}: Start reachable by scrolling the screen`);
        await M.ev("(() => { document.getElementById('screen-lobby').scrollTop = 0; return true; })()");
        await M.screenshot(`mobile-lobby-${skin}.png`);
    }
    await M.selectSkin("classic");
    await M.players(2);
});

test("game: compact HUD, board outline visible, reactions inside the viewport, no scroll", async () => {
    await M.selectGame("chain"); await M.click("#btn-settings"); await M.setting("size", 6); await M.set("set-speed", 350); await M.click("#btn-settings-done");
    await M.click("#btn-start");
    await assertNoScroll("game");
    const b = JSON.parse(await M.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    assert.ok(b.left >= 4 && b.right <= 356, `board leaves room for the 4px turn outline (${b.left}..${b.right})`);
    assert.equal(await M.ev("getComputedStyle(document.getElementById('hut')).display"), "flex");
    assert.equal(await M.ev("getComputedStyle(document.querySelector('.sign')).display"), "none", "compact HUD hides the sign");
    assert.equal(await M.ev("getComputedStyle(document.querySelector('#p-0 .stat-bar')).display"), "none", "phone: cells bar replaced by the win chance");
    assert.equal(await M.ev("getComputedStyle(document.querySelector('#p-0 .win-bar')).display"), "block");
    assert.match(await M.text("p0-win-pct"), /^\d+ % win$/);
    assert.ok(await M.ev("document.getElementById('react-bar').classList.contains('collapsed')"), "reaction bar starts collapsed");
    await M.waitFor("document.getElementById('react-layer').style.top !== ''", { what: "reaction layer placed" });
    await M.click("#react-toggle");
    // the list opens as a block under the 😜 toggle, never across the top towards the ⚙ (#43)
    const bar = JSON.parse(await M.ev("JSON.stringify({ t: document.getElementById('react-toggle').getBoundingClientRect(), l: document.querySelector('#react-bar .react-list').getBoundingClientRect(), g: document.getElementById('prefs-btn').getBoundingClientRect() })"));
    assert.ok(bar.l.top >= bar.t.bottom, `the emoji list sits under the toggle (${bar.l.top} >= ${bar.t.bottom})`);
    assert.ok(bar.l.top >= bar.g.bottom, "the emoji list clears the ⚙ button");
    await M.click('#react-bar button[data-e="🔥"]');
    const layer = JSON.parse(await M.ev("JSON.stringify(document.getElementById('react-layer').getBoundingClientRect())"));
    assert.ok(layer.right <= 360 && layer.left >= 0, `reaction layer inside the viewport (${layer.left}..${layer.right})`);
    assert.ok(layer.bottom <= b.top + 1 || layer.top >= b.bottom - 1, "reactions never over the board");
    assert.equal(await M.ev("document.querySelector('#react-layer .react-float').getAnimations()[0].effect.getTiming().duration"), 4000, "a lone reaction floats slowly (#17)");
    assert.match(await M.ev("getComputedStyle(document.querySelector('#react-layer .react-float')).filter"), /drop-shadow\(.*\).*drop-shadow\(/, "the reaction glows in the sender's colour (#33)");
    await M.move(7);
    await assertNoScroll("game after move");
});

test("result overlay stacks its buttons vertically on phones", async () => {
    await M.click("#btn-menu");
    await M.selectGame("five"); await M.click("#btn-settings"); await M.setting("size", 5); await M.setting("winlen", 5); await M.click("#btn-settings-done");
    await M.click("#btn-start");
    const start = (await M.state()).current;
    // starter fills row 0, the other row 4 (needs 5 stones -> 9 moves)
    const rowA = [0, 1, 2, 3, 4], rowB = [20, 21, 22, 23];
    const seq = []; for (let k = 0; k < 5; k++) { seq.push(rowA[k]); if (rowB[k] !== undefined) seq.push(rowB[k]); }
    for (const i of seq) await M.move(i);
    assert.equal((await M.state()).winner, start);
    const xs = JSON.parse(await M.ev("JSON.stringify([...document.querySelectorAll('.overlay-actions .btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }))"));
    assert.equal(xs.length, 3);
    assert.ok(xs[0][0] === xs[1][0] && xs[1][0] === xs[2][0], "same left edge");
    assert.ok(xs[0][1] < xs[1][1] && xs[1][1] < xs[2][1], "stacked top to bottom");
    await assertNoScroll("overlay");
    assert.deepEqual(M.errors, []);
});

test("replay bar (#38): one row above the HUD, clear of its controls, no scroll", async () => {
    await M.click("#overlay-look");
    const rect = (sel) => M.ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`).then(JSON.parse);
    const settled = "document.getElementById('replay-bar').getAnimations().length === 0";     // it slides in
    await M.waitFor(settled, { what: "replay bar in place" });
    const bar = await rect("#replay-bar");
    assert.ok(bar.left >= 0 && bar.right <= 360, `inside the viewport (${bar.left}..${bar.right})`);
    const kids = JSON.parse(await M.ev("JSON.stringify([...document.getElementById('replay-bar').children].map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }))"));
    assert.equal(kids.length, 7, "four steps, Play, the label and Show result");
    assert.ok(kids.every((t) => Math.abs(t - kids[0]) <= 1), `all in one row (${kids})`);
    assert.ok(bar.bottom <= (await rect("#hut")).top + 1, "sits above the HUD");
    await M.click("#gear");                        // the HUD controls come out: the bar moves up with it
    await M.waitFor("document.getElementById('replay-bar').getBoundingClientRect().bottom <= document.getElementById('hut').getBoundingClientRect().top + 1", { what: "bar above the taller HUD" });
    await M.waitFor(settled, { what: "replay bar in place" });
    const controls = await rect("#game-controls .btn");
    assert.ok((await rect("#replay-bar")).bottom <= controls.top, "never over the HUD's Rematch / Back to room");
    await assertNoScroll("replay bar");
    await M.screenshot("mobile-replay.png");
    await M.click("#replay-first");
    assert.match(await M.text("replay-pos"), /^Move 0 \/ \d+$/);
    assert.deepEqual(M.errors, []);
});

test("isolation: the board and the two-step highlights fit the phone, no scroll", async () => {
    await M.click("#result-fab");
    await M.click("#overlay-menu");
    await M.selectGame("isolation");
    await M.click("#btn-settings"); await M.setting("size", 7); await M.click("#btn-settings-done");
    await assertNoScroll("isolation lobby");
    await M.click("#btn-start");
    await assertNoScroll("isolation game");
    const b = JSON.parse(await M.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    assert.ok(b.left >= 4 && b.right <= 356, `board leaves room for the turn outline (${b.left}..${b.right})`);
    assert.equal(await M.ev("document.querySelectorAll('#board > .slab').length"), 49);
    assert.equal(await M.ev("document.querySelectorAll('#board > .slab.taken').length"), 2);
    assert.equal(await M.ev("getComputedStyle(document.querySelector('#p-0 .win-bar')).display"), "block");
    assert.match(await M.text("mini-line2"), /free moves/);
    // the first click of a move highlights the tiles that may be broken, still without scrolling
    const to = await M.ev("IsolationRules.steps(IsolationGame.state, IsolationGame.state.current)[0]");
    await M.ev(`document.querySelectorAll('#board > .slab')[${to}].click(); true`);
    assert.ok(await M.ev(`document.querySelectorAll('#board > .slab')[${to}].classList.contains('pending')`));
    await assertNoScroll("isolation pending");
    await M.screenshot("mobile-isolation.png");
    const far = await M.ev("IsolationGame.state.cells.findIndex((c, i) => c === -1 && i !== IsolationGame.state.pawns[0])");
    await M.ev(`document.querySelectorAll('#board > .slab')[${far}].click(); true`);
    await M.idle();
    assert.equal((await M.state()).history.length, 1);
    await assertNoScroll("isolation after a move");
    assert.deepEqual(M.errors, []);
});
