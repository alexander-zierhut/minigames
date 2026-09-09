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

test("game: compact HUD, board outline visible, reactions inside the viewport, no scroll", async () => {
    await M.selectGame("chain"); await M.click("#btn-settings"); await M.set("set-size", 6); await M.set("set-speed", 350); await M.click("#btn-settings-done");
    await M.click("#btn-start");
    await assertNoScroll("game");
    const b = JSON.parse(await M.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    assert.ok(b.left >= 4 && b.right <= 356, `board leaves room for the 4px turn outline (${b.left}..${b.right})`);
    assert.equal(await M.ev("getComputedStyle(document.getElementById('hut')).display"), "flex");
    assert.equal(await M.ev("getComputedStyle(document.querySelector('.sign')).display"), "none", "compact HUD hides the sign");
    assert.ok(await M.ev("document.getElementById('react-bar').classList.contains('collapsed')"), "reaction bar starts collapsed");
    await M.waitFor("document.getElementById('react-layer').style.top !== ''", { what: "reaction layer placed" });
    await M.click("#react-toggle");
    await M.click('#react-bar button[data-e="🔥"]');
    const layer = JSON.parse(await M.ev("JSON.stringify(document.getElementById('react-layer').getBoundingClientRect())"));
    assert.ok(layer.right <= 360 && layer.left >= 0, `reaction layer inside the viewport (${layer.left}..${layer.right})`);
    assert.ok(layer.bottom <= b.top + 1 || layer.top >= b.bottom - 1, "reactions never over the board");
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
