import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.click("#btn-local"); });
after(async () => { await B?.close(); await server?.close(); });

test("board size clamps per game; five's minimum follows the win length", async () => {
    await B.selectGame("chain"); await B.click("#btn-settings");
    assert.equal(await B.set("set-size", 30), "12");
    assert.equal(await B.set("set-size", 1), "3");
    assert.equal(await B.text("size-hint"), "(3–12)");
    assert.equal(await B.ev("document.getElementById('row-winlen').hidden"), true);
    assert.equal(await B.ev("document.getElementById('row-speed').hidden"), false);
    await B.click("#btn-settings-done");
    await B.selectGame("five"); await B.click("#btn-settings");
    assert.equal(await B.ev("document.getElementById('set-size').value"), "11", "five's fresh default is 11 × 11 (#16)");
    assert.equal(await B.ev("document.getElementById('row-winlen').hidden"), false);
    assert.equal(await B.ev("document.getElementById('row-speed').hidden"), true);
    assert.equal(await B.ev("document.getElementById('row-chainrule').hidden"), true);
    await B.set("set-winlen", 8);
    assert.equal(await B.set("set-size", 5), "8", "board can't be smaller than the win length");
    assert.equal(await B.text("size-hint"), "(8–25)");
    assert.equal(await B.set("set-winlen", 99), "25");
    await B.set("set-winlen", 5); await B.set("set-size", 11);
    await B.click("#btn-settings-done");
});

test("timer custom row and chain rule toggle", async () => {
    await B.selectGame("chain"); await B.click("#btn-settings");
    await B.set("set-timer", "custom");
    assert.equal(await B.ev("document.getElementById('row-timer-custom').hidden"), false);
    await B.set("set-timer-custom", 2);
    await B.check("set-chainrule", true);
    assert.equal(await B.ev("document.getElementById('set-chainlen').disabled"), false);
    await B.set("set-chainlen", 20);
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /2 min timer · 20-chain wins/);
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
    await B.set("set-timer", 0); await B.click("#btn-settings-done");
    await B.selectSkin("classic");
});

test("timer: only the current player's clock runs and it pauses during animations", async () => {
    await B.selectGame("chain");
    await B.click("#btn-settings"); await B.set("set-timer", 60); await B.set("set-size", 4); await B.set("set-speed", 1100); await B.click("#btn-settings-done");
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
