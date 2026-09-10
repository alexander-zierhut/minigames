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
    await M.ev("document.getElementById('lobby-code').textContent = 'ABCDE'; document.getElementById('lobby-share').hidden = false; document.getElementById('lobby-players').hidden = false; document.getElementById('lobby-spectators').textContent = '2 spectators watching'; true");
}
test("online-shaped lobby with four seats: share buttons in one row under the code, no scroll, every skin (#15)", async () => {
    await M.players(4);
    for (const skin of ["classic", "mcboard", "mc"]) {
        await M.selectSkin(skin);                 // re-renders the lobby (builds the four seat cards)
        await showRoomLobby();
        assert.equal(await M.ev("document.querySelectorAll('.lobby-player').length"), 4);
        const btns = JSON.parse(await M.ev("JSON.stringify(['btn-share', 'btn-share-spectate', 'btn-copy-code'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; }))"));
        assert.ok(btns.every((b) => b.top === btns[0].top), `${skin}: share buttons on one row (${JSON.stringify(btns)})`);
        assert.ok(btns.every((b) => b.left >= 16 && b.right <= 344), `${skin}: buttons inside the card (${JSON.stringify(btns)})`);
        assert.ok(btns[0].top >= await M.ev("document.getElementById('lobby-code').getBoundingClientRect().bottom"), `${skin}: buttons under the room code`);
        assert.equal(await M.ev("document.getElementById('lobby-chat')"), null, "no lobby chat");
        await assertNoScroll(`${skin}: online lobby with four seats`);
        await M.screenshot(`mobile-lobby-${skin}.png`);
    }
    await M.selectSkin("classic");
    await M.players(2);
});

test("game: compact HUD, board outline visible, reactions inside the viewport, no scroll", async () => {
    await M.selectGame("chain"); await M.click("#btn-settings"); await M.set("set-size", 6); await M.set("set-speed", 350); await M.click("#btn-settings-done");
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
    await M.click('#react-bar button[data-e="🔥"]');
    const layer = JSON.parse(await M.ev("JSON.stringify(document.getElementById('react-layer').getBoundingClientRect())"));
    assert.ok(layer.right <= 360 && layer.left >= 0, `reaction layer inside the viewport (${layer.left}..${layer.right})`);
    assert.ok(layer.bottom <= b.top + 1 || layer.top >= b.bottom - 1, "reactions never over the board");
    assert.equal(await M.ev("document.querySelector('#react-layer .react-float').getAnimations()[0].effect.getTiming().duration"), 4000, "a lone reaction floats slowly (#17)");
    await M.move(7);
    await assertNoScroll("game after move");
});

test("result overlay stacks its buttons vertically on phones", async () => {
    await M.click("#btn-menu");
    await M.selectGame("five"); await M.click("#btn-settings"); await M.set("set-size", 5); await M.set("set-winlen", 5); await M.click("#btn-settings-done");
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
    assert.equal(kids.length, 6, "four steps, the label and Show result");
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
