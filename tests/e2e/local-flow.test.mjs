import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await server?.close(); });

test("title screen: sections, join panel toggle, look control", async () => {
    assert.equal(await B.screen(), "screen-menu");
    assert.equal(await B.ev("document.getElementById('join-panel').hidden"), true);
    await B.click("#btn-join-open");
    assert.equal(await B.ev("document.getElementById('join-panel').hidden"), false);
    assert.equal(await B.ev("document.activeElement.id"), "join-code");
    await B.click("#btn-join");                       // empty code -> toast, stays on menu
    assert.equal(await B.screen(), "screen-menu");
    assert.equal(await B.ev("document.getElementById('toast').hidden"), false);
    await B.click("#btn-join-open");
    assert.equal(await B.ev("document.querySelectorAll('.skin-seg button').length"), 3, "the Look control lives in the preferences only");
});

test("local lobby: game picker, settings summary, start", async () => {
    await B.click("#btn-local");
    assert.equal(await B.screen(), "screen-lobby");
    assert.equal(await B.text("lobby-kind"), "Local game");
    assert.equal(await B.ev("document.getElementById('lobby-players').hidden"), true);
    await B.selectGame("chain");
    await B.click("#btn-settings");
    await B.set("set-size", 4); await B.set("set-speed", 350);
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /^4 × 4/);
    await B.click("#btn-start");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.text("sign-title"), "CHAIN REACT");
    assert.equal(await B.ev("document.querySelectorAll('#board > .cell').length"), 16);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('#p-0 .stat-bar')).display"), "block", "desktop keeps the cells bar");
    assert.equal(await B.ev("getComputedStyle(document.querySelector('#p-0 .win-bar')).display"), "block", "and adds the win chance");
});

test("chain react: play to the end, overlay, look at board, rematch alternates starter", async () => {
    const r = await B.randomGame();
    assert.equal(r.over, true);
    assert.ok(r.winner === 0 || r.winner === 1);
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    assert.match(await B.text("overlay-title"), /wins!$/);
    assert.equal(await B.ev("document.querySelectorAll('.cell.last .last-marker').length"), 1);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.cell.last .last-marker')).display"), "none", "marker hidden after game over");
    await B.click("#overlay-look");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true);
    assert.equal(await B.ev("document.getElementById('result-fab').hidden"), false);
    await B.click("#result-fab");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    await B.click("#overlay-again");
    const st = await B.state();
    assert.equal(st.history.length, 0);
    assert.equal(st.current, 1, "second local game: the other player starts");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true);
});

test("back to room, switch to five wins with 6 in a row, scripted win with jumping line", async () => {
    await B.click("#btn-menu");
    assert.equal(await B.screen(), "screen-lobby");
    await B.selectGame("five");
    assert.match(await B.text("settings-summary"), /^11 × 11 · 5 in a row/, "five starts at its 11 × 11 default (#16)");
    await B.click("#btn-settings");
    await B.set("set-winlen", 6); await B.set("set-size", 7);
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /7 × 7 · 6 in a row/);
    await B.click("#btn-start");
    assert.equal(await B.ev("document.getElementById('board').className"), "five turn-p0", "game 3: p0 starts again (alternating)");
    // p0 (starts) plays row 0, p1 plays row 5 -> p0 wins on the 6th stone
    for (const i of [0, 35, 1, 36, 2, 37, 3, 38, 4, 39, 5]) await B.move(i);
    const st = await B.state();
    assert.equal(st.over, true); assert.equal(st.winner, 0); assert.equal(st.winLine.length, 6);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.stone.win')).animationName") !== "none" || await B.ev("getComputedStyle(document.querySelector('.stone.win'), '::after').animationName"), "stone-jump");
    assert.match(await B.text("overlay-sub"), /6 in a row/);
    assert.ok((await B.ev("document.getElementById('board').classList.contains('over')")));
});

test("change game from the overlay returns to the lobby; leave returns to menu", async () => {
    await B.click("#overlay-menu");
    assert.equal(await B.screen(), "screen-lobby");
    await B.click("#btn-lobby-back");
    assert.equal(await B.screen(), "screen-menu");
    assert.deepEqual(B.errors, [], "no page errors");
    assert.deepEqual(B.failedRequests, [], "no failed requests");
});

test("install button: hidden until the browser offers to install, then prompts", async () => {
    // headless Chrome on localhost may offer the install prompt itself; start from "not offered"
    await B.ev("document.getElementById('btn-install').hidden = true; true");
    await B.ev(`(() => {
        window.__prompted = 0;
        const e = new Event("beforeinstallprompt", { cancelable: true });
        e.prompt = () => { window.__prompted++; return Promise.resolve(); };
        window.dispatchEvent(e);
        return true;
    })()`);
    assert.equal(await B.ev("document.getElementById('btn-install').hidden"), false, "offered: button visible");
    assert.match(await B.text("btn-install"), /Add to home screen/);
    await B.click("#btn-install");
    assert.equal(await B.ev("window.__prompted"), 1, "the browser prompt was shown");
    assert.equal(await B.ev("document.getElementById('btn-install').hidden"), true, "hidden after prompting");
    assert.equal(await B.ev("document.querySelector('link[rel=manifest]').getAttribute('href')"), "manifest.json");
});

