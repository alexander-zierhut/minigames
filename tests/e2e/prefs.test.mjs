/* The ⚙ preferences button: on every screen, opens the per-device modal (look + sound),
   keeps the look controls in sync, persists across a reload, never collides with the
   reaction toggle or the board on a phone. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B, M;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await M?.close(); await server?.close(); });

const visible = (X) => X.ev("(() => { const e = document.getElementById('prefs-btn'); const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.top >= 0 && r.left >= 0; })()");

test("the button is there on title, lobby and game; the modal opens and closes", async () => {
    assert.equal(await visible(B), true, "title");
    await B.click("#prefs-btn");
    assert.equal(await B.ev("document.getElementById('prefs-modal').hidden"), false);
    assert.equal(await B.text("pref-volume-val"), "30 %", "quiet default");
    await B.click("#btn-prefs-done");
    assert.equal(await B.ev("document.getElementById('prefs-modal').hidden"), true);
    await B.click("#btn-local");
    assert.equal(await visible(B), true, "lobby");
    await B.selectGame("chain"); await B.click("#btn-settings"); await B.set("set-size", 4); await B.set("set-speed", 350); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await visible(B), true, "game");
    await B.click("#prefs-btn");
    assert.equal(await B.ev("document.getElementById('prefs-modal').hidden"), false);
    // backdrop click closes
    await B.ev("document.getElementById('prefs-modal').click(); true");
    assert.equal(await B.ev("document.getElementById('prefs-modal').hidden"), true);
});

test("look chosen in the modal is applied and mirrored by the other look controls", async () => {
    await B.click("#prefs-btn");
    await B.click('#prefs-modal .skin-seg button[data-skin="mc"]');
    assert.ok(await B.ev("document.body.classList.contains('skin-mc')"));
    assert.equal(await B.ev("[...document.querySelectorAll('.skin-seg button.selected')].every(b => b.dataset.skin === 'mc')"), true, "every look control agrees");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('prefs-btn')).borderRadius"), "0px", "button follows the Minecraft skin");
    await B.click('#prefs-modal .skin-seg button[data-skin="classic"]');
    assert.equal(await B.ev("getComputedStyle(document.getElementById('prefs-btn')).borderRadius"), "50%");
    await B.click("#btn-prefs-done");
});

test("volume, sound set and category toggles persist across a reload; never in the room settings", async () => {
    await B.click("#prefs-btn");
    await B.set("pref-volume", 60);
    await B.set("pref-soundset", "mc");
    await B.check("pref-snd-turn", false);
    assert.equal(await B.text("pref-volume-val"), "60 %");
    await B.click("#btn-prefs-done");
    assert.equal(await B.ev("'volume' in Settings.read() || 'soundSet' in Settings.read()"), false, "prefs are not game settings");
    await B.goto(server.url);
    assert.equal(await B.ev("Prefs.get().volume"), 60);
    assert.equal(await B.ev("Prefs.get().soundSet"), "mc");
    assert.equal(await B.ev("Prefs.get().sounds.turn"), false);
    await B.click("#prefs-btn");
    assert.equal(await B.ev("document.getElementById('pref-volume').value"), "60");
    assert.equal(await B.ev("document.getElementById('pref-snd-turn').checked"), false);
    await B.set("pref-volume", 30); await B.set("pref-soundset", "auto"); await B.check("pref-snd-turn", true);
    await B.click("#btn-prefs-done");
    assert.deepEqual(B.errors, []);
});

test("phone: the button stays clear of the cards, the board and the reaction toggle", async () => {
    M = await launchBrowser({ width: 360, height: 780, mobile: true });
    await M.goto(server.url);
    const btn = JSON.parse(await M.ev("JSON.stringify(document.getElementById('prefs-btn').getBoundingClientRect())"));
    const card = JSON.parse(await M.ev("JSON.stringify(document.querySelector('#screen-menu .menu-card').getBoundingClientRect())"));
    assert.ok(card.top >= btn.bottom, `title card starts below the button (${card.top} >= ${btn.bottom})`);
    await M.click("#btn-local");
    const lobby = JSON.parse(await M.ev("JSON.stringify(document.querySelector('#screen-lobby .menu-card').getBoundingClientRect())"));
    assert.ok(lobby.top >= btn.bottom, "lobby card starts below the button");
    assert.ok((await M.noScroll()).screen, "lobby still does not scroll");
    await M.selectGame("chain"); await M.click("#btn-settings"); await M.set("set-size", 6); await M.set("set-speed", 350); await M.click("#btn-settings-done");
    await M.click("#btn-start");
    const board = JSON.parse(await M.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    const react = JSON.parse(await M.ev("JSON.stringify(document.getElementById('react-toggle').getBoundingClientRect())"));
    assert.ok(board.top >= btn.bottom && board.top >= react.bottom, `board below both corner buttons (${board.top})`);
    assert.ok(btn.right < react.left, "corner buttons do not overlap");
    await M.emulate(780, 360);                                 // landscape phone: still clear of the corners
    await M.waitFor("document.getElementById('board').getBoundingClientRect().width < 320", { what: "board refitted" });
    const b2 = JSON.parse(await M.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    assert.ok(b2.top >= 50 || b2.left >= 52, `landscape: board clear of the ⚙ (${b2.left},${b2.top})`);
    const s = await M.noScroll();
    assert.ok(s.x && s.y && s.screen, `no scroll in landscape ${JSON.stringify(s)}`);
    assert.deepEqual(M.errors, []);
});
