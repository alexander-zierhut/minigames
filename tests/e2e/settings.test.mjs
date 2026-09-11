import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.click("#btn-local"); });
after(async () => { await B?.close(); await server?.close(); });

test("board size clamps per game; five's minimum follows the win length", async () => {
    await B.selectGame("chain"); await B.click("#btn-settings");
    assert.equal(await B.setting("size", 30), "12");
    assert.equal(await B.setting("size", 1), "3", "a custom size below the minimum clamps");
    assert.equal(await B.text("size-hint"), "(3–12)");
    assert.equal(await B.ev("document.getElementById('row-winlen').hidden"), true);
    assert.equal(await B.ev("document.getElementById('row-speed').hidden"), false);
    await B.click("#btn-settings-done");
    await B.selectGame("five"); await B.click("#btn-settings");
    assert.equal(await B.ev("Settings.read().n"), 11, "five's fresh default is 11 × 11 (#16)");
    assert.equal(await B.ev("document.getElementById('row-winlen').hidden"), false);
    assert.equal(await B.ev("document.getElementById('row-speed').hidden"), true);
    assert.equal(await B.ev("document.getElementById('row-chainlen').hidden"), true, "chain's own rows are gone");
    await B.setting("winlen", 8);
    assert.equal(await B.setting("size", 5), "8", "board can't be smaller than the win length");
    assert.ok(await B.ev("[...document.getElementById('set-size').options].every(o => o.value === 'custom' || +o.value >= 8)"), "and the list only offers sizes that fit");
    assert.equal(await B.text("size-hint"), "(8–25)");
    assert.equal(await B.setting("winlen", 99), "25");
    await B.setting("winlen", 5); await B.setting("size", 11);
    // the Yavalath rule: one less than the win length loses; shown in the summary
    assert.equal(await B.ev("document.getElementById('row-yavalath').hidden"), false);
    // the row is named after what it does and follows the win length
    assert.equal(await B.ev("document.querySelector('#row-yavalath .row-label').textContent"), "Lose when 4 in a row", "5 in a row to win: 4 loses");
    await B.setting("winlen", 6);
    assert.equal(await B.ev("document.querySelector('#row-yavalath .row-label').textContent"), "Lose when 5 in a row", "the label follows the win length");
    await B.setting("winlen", 5);
    await B.setting("yavalath", true);
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /5 in a row · no timer · 4 in a row loses$/);
    await B.click("#btn-settings"); await B.setting("yavalath", false); await B.click("#btn-settings-done");
    assert.doesNotMatch(await B.text("settings-summary"), /loses/);
});

test("Yavalath rule in a local game: three in a row loses, the other player wins", async () => {
    await B.selectGame("five"); await B.click("#btn-settings");
    await B.setting("size", 6); await B.setting("winlen", 4); await B.setting("yavalath", true); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    const start = (await B.state()).current;
    for (const i of [0, 6, 1, 7, 2]) await B.move(i);          // the starter makes three: it loses
    const st = await B.state();
    assert.equal(st.over, true); assert.equal(st.winner, 1 - start);
    assert.match(await B.text("overlay-sub"), /3 in a row loses/);
    assert.equal(await B.ev("document.querySelectorAll('.stone.win').length"), 3, "the losing line is highlighted");
    await B.click("#overlay-menu");
    await B.click("#btn-settings"); await B.setting("yavalath", false); await B.setting("winlen", 5); await B.setting("size", 11); await B.click("#btn-settings-done");
});

test("every setting is a dropdown: presets, Off and a Custom row that only shows when it is picked", async () => {
    await B.selectGame("chain"); await B.click("#btn-settings");
    // no checkbox and no bare number field anywhere in the modal (2026-09-11)
    assert.equal(await B.ev("document.querySelectorAll('.settings input[type=checkbox]').length"), 0, "no checkboxes");
    assert.ok(await B.ev("[...document.querySelectorAll('.settings .row:not([hidden]) > *:last-child')].every(e => e.tagName === 'SELECT' || e.closest('.row-custom'))"), "every visible row is a dropdown or a custom number");
    // the timer: a preset, then a custom value that opens its row
    await B.setting("timer", 120);
    assert.equal(await B.ev("document.getElementById('set-timer').value"), "custom", "2 minutes is not offered, so Custom is picked");
    assert.equal(await B.ev("document.getElementById('row-timer-custom').hidden"), false, "and its row shows");
    // the chain rule is one dropdown: Off, or how many explosions win
    assert.equal(await B.ev("document.getElementById('set-chainlen').value"), "off", "off by default");
    assert.equal(await B.ev("document.getElementById('row-chainlen-custom').hidden"), true);
    await B.setting("chainlen", 20);
    assert.equal(await B.ev("JSON.stringify([Settings.read().chainRule, Settings.read().chainLen])"), "[true,20]", "one control, both config keys");
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /2 min timer · 20-chain wins/);
    // a value the list does not offer goes through Custom and still reaches the config
    await B.click("#btn-settings");
    await B.setting("chainlen", 42);
    assert.equal(await B.ev("document.getElementById('set-chainlen').value"), "custom");
    assert.equal(await B.ev("document.getElementById('row-chainlen-custom').hidden"), false);
    assert.equal(await B.ev("Settings.read().chainLen"), 42);
    await B.setting("chainlen", false);                      // Off again, and the custom row hides
    assert.equal(await B.ev("Settings.read().chainRule"), false);
    assert.equal(await B.ev("document.getElementById('row-chainlen-custom').hidden"), true);
    await B.setting("timer", 120);
    await B.setting("chainlen", 20);
    await B.click("#btn-settings-done");
});

test("a Custom choice survives other changes and never outlives its game", async () => {
    await B.selectGame("chain"); await B.click("#btn-settings");
    // a custom board size stays picked while the rest of the form is used
    await B.setting("size", 7);
    assert.equal(await B.ev("document.getElementById('set-size').value"), "custom");
    await B.setting("chainlen", 30);
    await B.setting("timer", 60);
    assert.equal(await B.ev("document.getElementById('set-size').value"), "custom", "still custom after other changes");
    assert.equal(await B.ev("Settings.read().n"), 7);
    assert.equal(await B.ev("document.getElementById('row-size-custom').hidden"), false);
    // a custom explosion count must not linger on a game that has no such setting
    await B.setting("chainlen", 42);
    assert.equal(await B.ev("document.getElementById('row-chainlen-custom').hidden"), false);
    await B.click("#btn-settings-done"); await B.selectGame("five"); await B.click("#btn-settings");
    assert.equal(await B.ev("document.getElementById('row-chainlen').hidden"), true, "the chain row is gone");
    assert.equal(await B.ev("document.getElementById('row-chainlen-custom').hidden"), true, "and so is its custom row");
    assert.equal(await B.ev("Settings.read().n"), 11, "five brings its own remembered size");
    // back to chain: its own size and its custom explosions are as they were
    await B.click("#btn-settings-done"); await B.selectGame("chain"); await B.click("#btn-settings");
    assert.equal(await B.ev("Settings.read().n"), 7);
    assert.equal(await B.ev("Settings.read().chainLen"), 42);
    await B.setting("size", 6);                      // leave the form as the next test expects it
    await B.setting("chainlen", 20); await B.setting("timer", 120);
    await B.click("#btn-settings-done");
});

test("settings, game choice and skin survive a reload", async () => {
    await B.selectSkin("mcboard");
    await B.selectGame("five");
    await B.goto(server.url);
    assert.ok(await B.ev("document.body.classList.contains('skin-mcboard')"), "skin restored");
    await B.click("#btn-local");
    assert.equal(await B.ev("document.querySelector('.game-card.selected').dataset.game"), "five");
    await B.click("#btn-settings");
    assert.equal(await B.ev("document.getElementById('set-timer').value"), "custom");
    assert.equal(await B.ev("document.getElementById('set-timer-custom').value"), "2");
    await B.setting("timer", 0); await B.click("#btn-settings-done");
    await B.selectSkin("classic");
});

test("timer: only the current player's clock runs and it pauses during animations", async () => {
    await B.selectGame("chain");
    await B.click("#btn-settings"); await B.setting("timer", 60); await B.setting("size", 4); await B.set("set-speed", 1100); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.ev("document.getElementById('clock-0').hidden"), false);
    assert.equal(await B.text("clock-0"), "1:00");
    await new Promise((r) => setTimeout(r, 1300));
    assert.notEqual(await B.text("clock-0"), "1:00", "active clock ticks");
    assert.equal(await B.text("clock-1"), "1:00", "inactive clock does not");
    await B.move(5); // p0
    await B.move(0); // p1 corner
    await B.move(5);
    await B.cell(0); // p1 corner explodes -> long animation
    await B.waitFor("ChainGame.state.busy", { what: "animation running" });
    const during = await B.ev("Clock.snapshot()[1]");
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(await B.ev("Clock.snapshot()[1]"), during, "clock frozen while the explosion animates");
    await B.idle();
    await B.click("#btn-menu");
    assert.deepEqual(B.errors, []);
});
