/* The ⚙ preferences button: on every screen, opens the per-device modal (look + sound),
   keeps the look controls in sync, persists across a reload, never collides with the
   reaction toggle or the board on a phone. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, sleep } from "./harness.mjs";

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
    await B.selectGame("chain"); await B.click("#btn-settings"); await B.setting("size", 4); await B.set("set-speed", 350); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await visible(B), true, "game");
    await B.click("#prefs-btn");
    assert.equal(await B.ev("document.getElementById('prefs-modal').hidden"), false);
    // backdrop click closes
    await B.ev("document.getElementById('prefs-modal').click(); true");
    assert.equal(await B.ev("document.getElementById('prefs-modal').hidden"), true);
});

test("desktop: the section menu and the open section show side by side (#32)", async () => {
    await B.click("#prefs-btn");
    const box = (sel) => B.ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`).then(JSON.parse);
    assert.equal(await B.ev("Prefs.section"), "profile", "a section is open right away, nothing needs two taps");
    const nav = await box("#prefs-nav"), pane = await box('.prefs-section[data-section="profile"]');
    assert.ok(nav.width > 0 && pane.width > 0, "both panes visible");
    assert.ok(nav.right <= pane.left + 1, `the menu is the left column (${nav.right} <= ${pane.left})`);
    assert.equal(await B.ev("getComputedStyle(document.getElementById('btn-prefs-back')).display"), "none", "no Back button with both panes");
    assert.equal(await B.text("prefs-sum-sound"), "30 % · Follow the look", "the row shows the section's state");
    await B.click("#prefs-nav-streaming");
    assert.equal(await B.ev("Prefs.section"), "streaming");
    assert.equal(await B.ev("document.querySelector('.prefs-section[data-section=\"profile\"]').hidden"), true);
    assert.ok(await B.ev("document.getElementById('prefs-nav-streaming').classList.contains('selected')"), "the open section is highlighted");
    await B.check("pref-hide-code", true);
    assert.equal(await B.text("prefs-sum-streaming"), "partly on");
    await B.check("pref-hide-code", false);
    await B.click("#pref-creator-mode");
    assert.equal(await B.text("prefs-sum-streaming"), "on", "content creator mode turns every option of the section on");
    assert.equal(await B.ev("document.getElementById('pref-hide-code').checked && document.getElementById('pref-private-ip').checked && document.getElementById('pref-mute-spectators').checked"), true);
    assert.equal(await B.text("pref-creator-mode"), "Turn off content creator mode");
    await B.click("#pref-creator-mode");
    assert.equal(await B.text("prefs-sum-streaming"), "Best for streaming");
    await B.click("#prefs-nav-look");
    await B.click("#btn-prefs-done");
});

test("look chosen in the modal is applied and mirrored by the other look controls", async () => {
    await B.click("#prefs-btn");
    await B.click('#prefs-modal .skin-seg button[data-skin="mc"]');
    assert.ok(await B.ev("document.body.classList.contains('skin-mc')"));
    assert.equal(await B.ev("[...document.querySelectorAll('.skin-seg button.selected')].every(b => b.dataset.skin === 'mc')"), true, "every look control agrees");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('prefs-btn')).borderRadius"), "0px", "button follows the Minecraft skin");
    await B.click('#prefs-modal .skin-seg button[data-skin="classic"]');
    assert.equal(await B.ev("getComputedStyle(document.getElementById('prefs-btn')).borderRadius"), "20px");
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

test("profile (#35): a name is drawn on the first visit, a new one survives a reload and reaches the board", async () => {
    assert.equal(await B.ev("Prefs.DEFAULT_NAMES.includes(Prefs.get().name)"), true, "the first visit drew one of the default names");
    await B.click("#prefs-btn");
    await B.click("#prefs-nav-profile");
    assert.equal(await B.ev("document.getElementById('pref-name').value"), await B.ev("Prefs.get().name"), "the field shows the current name");
    assert.equal(await B.ev("document.getElementById('menu-name').value"), await B.ev("Prefs.get().name"), "the title screen's greeting shows it too");
    assert.equal(await B.ev("document.getElementById('pref-name').maxLength"), 16);
    await B.set("pref-name", "  Robin  ");
    assert.equal(await B.ev("Prefs.get().name"), "Robin", "trimmed on the way in");
    assert.equal(await B.text("prefs-sum-profile"), "Robin", "the menu row shows the name");
    await B.click("#btn-prefs-done");
    await B.goto(server.url);
    assert.equal(await B.ev("Prefs.get().name"), "Robin", "kept across a reload");
    await B.click("#prefs-btn");
    assert.equal(await B.ev("document.getElementById('pref-name').value"), "Robin");
    assert.equal(await B.ev("document.getElementById('menu-name').value"), "Robin", "the greeting follows");
    await B.set("menu-name", " Sam ");
    assert.equal(await B.ev("Prefs.get().name"), "Sam", "the greeting's field writes the same preference");
    assert.equal(await B.ev("document.getElementById('pref-name').value"), "Sam");
    // wide letters are cut by width, narrow ones only by the count, and the name fits its field
    await B.set("menu-name", "A".repeat(16));
    const wide = await B.ev("Prefs.get().name");
    assert.ok(wide.length < 16 && /^A+$/.test(wide), `a name of wide letters is cut shorter (${wide.length})`);
    assert.ok(await B.ev("document.getElementById('menu-name').scrollWidth <= document.getElementById('menu-name').clientWidth + 1"), "and fits the greeting's field");
    await B.set("menu-name", "i".repeat(16));
    assert.equal(await B.ev("Prefs.get().name"), "i".repeat(16), "narrow letters keep all sixteen");
    await B.set("menu-name", "Robin");
    assert.equal(await B.text("prefs-sum-profile"), "Robin");
    await B.click("#btn-prefs-done");
    // on this device seat 0 is me and the others take the first default names that are not mine
    await B.click("#btn-local"); await B.selectGame("five");
    await B.click("#btn-settings"); await B.setting("size", 5); await B.setting("winlen", 4); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    const seats = JSON.parse(await B.ev("JSON.stringify(Prefs.seatNames(2))"));
    assert.equal(seats[0], "Robin");
    assert.equal(await B.text("p0-name"), "Robin"); assert.equal(await B.text("p1-name"), seats[1]);
    assert.match(await B.ev("document.getElementById('log').textContent"), /New game\. Robin starts\./);
    await B.click("#btn-menu"); await B.click("#btn-lobby-back");
    assert.equal(await B.screen(), "screen-menu");
    assert.deepEqual(B.errors, []);
});

test("sounds: locked until a gesture, cues follow the game, mute silences, nothing throws in any set", async () => {
    await B.click("#btn-local"); await B.selectGame("chain");
    await B.click("#btn-settings"); await B.setting("size", 4); await B.set("set-speed", 350); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.ev("Sound.unlocked"), false, "no audio before the first gesture");
    await B.move(5);
    assert.equal(await B.ev("Sound.log.length"), 1, "the cue is remembered even while audio is still locked");
    await B.ev("window.dispatchEvent(new PointerEvent('pointerdown')); true");   // the browser's autoplay rule: a gesture first
    assert.equal(await B.ev("Sound.unlocked"), true);
    assert.equal(await B.ev("Sound.set"), "classic");
    await B.ev("Sound.play('turn'); true");
    // corner cell 0 explodes on the second piece: place → fuse → blast
    await B.move(0); await B.move(5); await B.move(0);
    const names = await B.ev("JSON.stringify(Sound.log.map(l => l.name))");
    assert.match(names, /"place","prime","explode"/, `chain cues in order (${names})`);
    // the Minecraft set decodes real files; the classic set synthesizes — neither throws
    await B.click("#prefs-btn"); await B.set("pref-soundset", "mc"); await B.click("#btn-prefs-done");
    assert.equal(await B.ev("Sound.set"), "mc");
    await B.move(6);                                          // an empty cell (1 and 4 were taken by the blast)
    for (let k = 0; k < 100 && !B.requests.some((u) => u.endsWith(".ogg")); k++) await sleep(100);
    assert.ok(B.requests.some((u) => u.endsWith(".ogg")), "sound files are fetched once the Minecraft set is used");
    assert.equal(await B.ev("Sound.log[Sound.log.length - 1].set"), "mc");
    await B.click("#prefs-btn"); await B.set("pref-volume", 0); await B.click("#btn-prefs-done");
    const before = await B.ev("Sound.log.length");
    await B.move(2);
    assert.equal(await B.ev("Sound.log.length"), before, "volume 0 plays nothing");
    await B.click("#prefs-btn"); await B.set("pref-volume", 30); await B.set("pref-soundset", "auto"); await B.click("#btn-prefs-done");
    await B.click("#btn-menu");
    assert.deepEqual(B.errors, []);
    assert.deepEqual(B.failedRequests, []);
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
    await M.selectGame("chain"); await M.click("#btn-settings"); await M.setting("size", 6); await M.set("set-speed", 350); await M.click("#btn-settings-done");
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

test("feedback button opens a prefilled GitHub issue for the current screen", async () => {
    await B.ev("window.__opened = null; window.open = (u) => { window.__opened = u; return null; }; true");
    await B.click("#prefs-btn");
    await B.click("#pref-feedback");
    const url = await B.ev("window.__opened");
    assert.ok(url && url.startsWith("https://github.com/alexander-zierhut/minigames/issues/new?title="));
    assert.ok(decodeURIComponent(url).includes("Screen: "), "context prefilled");
    await B.click("#btn-prefs-done");
});

test("phone in a game: the ⚙ button is actually tappable and lines up with the reaction toggle (#7, #13)", async () => {
    const M = await launchBrowser({ width: 360, height: 780, mobile: true });
    try {
        await M.goto(server.url);
        await M.click("#btn-local"); await M.selectGame("chain");
        await M.click("#btn-settings"); await M.setting("size", 4); await M.set("set-speed", 350); await M.click("#btn-settings-done");
        await M.click("#btn-start");
        const r = JSON.parse(await M.ev("JSON.stringify({ g: document.getElementById('prefs-btn').getBoundingClientRect(), t: document.getElementById('react-toggle').getBoundingClientRect() })"));
        assert.ok(Math.abs(r.g.top - r.t.top) <= 1, `⚙ and 😜 share the top edge (${r.g.top} vs ${r.t.top})`);
        const hit = await M.ev(`document.elementFromPoint(${(r.g.left + r.g.right) / 2}, ${(r.g.top + r.g.bottom) / 2})?.id`);
        assert.equal(hit, "prefs-btn", "nothing covers the ⚙ button");
        assert.match(await M.text("prefs-btn"), /Settings & Feedback/, "the full label on a phone too (#43)");
        // the open emoji list drops below the toggle, never left across the ⚙ button (#43)
        await M.click("#react-toggle");
        const list = JSON.parse(await M.ev("JSON.stringify(document.querySelector('#react-bar .react-list').getBoundingClientRect())"));
        assert.ok(list.top >= r.t.bottom, `the list opens under the toggle (${list.top} >= ${r.t.bottom})`);
        assert.ok(list.top >= r.g.bottom && list.right <= 360, `the list clears the ⚙ button (${JSON.stringify(list)})`);
        const stillHit = await M.ev(`document.elementFromPoint(${(r.g.left + r.g.right) / 2}, ${(r.g.top + r.g.bottom) / 2})?.id`);
        assert.equal(stillHit, "prefs-btn", "the open list does not cover the ⚙ button");
        await M.click("#react-toggle");
        await M.click("#prefs-btn");
        assert.equal(await M.ev("document.getElementById('prefs-modal').hidden"), false, "the preferences open during a game");
        await M.click("#btn-prefs-done");
        assert.equal(await M.ev("getComputedStyle(document.getElementById('screen-game')).userSelect"), "none", "no text selection in the game");
    } finally { await M.close(); }
});

test("phone: the modal opens on the section menu, a row opens its section, Back returns, nothing scrolls (#32)", async () => {
    const P = await launchBrowser({ width: 360, height: 780, mobile: true });
    try {
        await P.goto(server.url);
        await P.click("#prefs-btn");
        assert.equal(await P.ev("Prefs.section"), null, "the menu first");
        assert.equal(await P.ev("getComputedStyle(document.getElementById('prefs-nav')).display !== 'none'"), true);
        assert.equal(await P.ev("getComputedStyle(document.getElementById('prefs-panes')).display"), "none", "no panel yet");
        assert.equal(await P.text("prefs-sum-look"), "Classic");
        assert.equal(await P.text("prefs-sum-streaming"), "Best for streaming");
        const modalFits = () => P.ev("(() => { const c = document.getElementById('prefs-card'); return c.scrollHeight <= c.clientHeight + 1; })()");
        assert.equal(await modalFits(), true, "the menu fits without scrolling");
        await P.screenshot("prefs-phone-menu.png");
        // every section: one tap opens it, it fits the 360×780 phone, Back returns to the menu
        for (const key of ["profile", "look", "sound", "streaming", "developer", "feedback"]) {
            await P.click("#prefs-nav-" + key);
            assert.equal(await P.ev("Prefs.section"), key);
            assert.equal(await P.ev("getComputedStyle(document.getElementById('prefs-nav')).display"), "none", key + ": the menu steps aside");
            assert.equal(await P.ev(`document.querySelector('.prefs-section[data-section="${key}"]').getBoundingClientRect().width > 0`), true, key + " visible");
            assert.equal(await modalFits(), true, key + " fits without scrolling");
            const s = await P.noScroll();
            assert.ok(s.x && s.y, `${key}: the page does not scroll ${JSON.stringify(s)}`);
            if (key === "sound") await P.screenshot("prefs-phone-sound.png");
            await P.click("#btn-prefs-back");
            assert.equal(await P.ev("Prefs.section"), null, key + ": Back returns to the menu");
        }
        // Done closes from inside a section too, and the row summaries follow a change
        await P.click("#prefs-nav-sound");
        await P.set("pref-volume", 70);
        await P.click("#btn-prefs-done");
        assert.equal(await P.ev("document.getElementById('prefs-modal').hidden"), true);
        await P.click("#prefs-btn");
        assert.equal(await P.ev("Prefs.section"), null, "reopening starts at the menu again");
        assert.equal(await P.text("prefs-sum-sound"), "70 % · Follow the look");
        await P.click("#btn-prefs-done");
        assert.deepEqual(P.errors, []);
    } finally { await P.close(); }
});

