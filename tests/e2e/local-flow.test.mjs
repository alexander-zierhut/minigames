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
    await B.setting("size", 4); await B.set("set-speed", 350);
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

    // replay bar (#38): step through the finished game, the board follows
    const moves = (await B.state()).history.length;
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), false);
    assert.equal(await B.text("replay-pos"), `Move ${moves} / ${moves}`, "starts at the final position");
    assert.equal(await B.ev("ChainGame.previewPly"), null, "the final position is the live one");
    assert.equal(await B.ev("document.getElementById('replay-next').disabled"), true, "nothing after the last move");
    await B.click("#replay-first");
    assert.equal(await B.text("replay-pos"), `Move 0 / ${moves}`);
    assert.equal(await B.ev("ChainGame.previewPly"), 0);
    assert.equal(await B.ev("document.querySelectorAll('#board > .cell.taken').length"), 0, "empty board again");
    assert.equal(await B.ev("document.querySelectorAll('#board > .cell.can-place').length"), 0, "a preview is never playable");
    assert.equal(await B.ev("document.getElementById('replay-prev').disabled"), true, "nothing before the first move");
    await B.click("#replay-next");
    assert.equal(await B.text("replay-pos"), `Move 1 / ${moves}`);
    assert.equal(await B.ev("document.querySelectorAll('#board > .cell.taken').length"), 1, "the first move only");
    const first = await B.ev("ChainGame.state.history[0]");
    assert.equal(await B.ev("[...document.querySelectorAll('#board > .cell')].findIndex(c => c.classList.contains('last'))"), first, "the last-move marker follows");
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.cell.last .last-marker')).display"), "block", "and shows again, the game is not over there");
    await B.click("#replay-prev");
    assert.equal(await B.ev("ChainGame.previewPly"), 0);
    await B.click("#replay-last");
    assert.equal(await B.ev("ChainGame.previewPly"), null, "back to the live position");
    assert.ok(await B.ev("document.getElementById('board').classList.contains('over')"));
    assert.equal(await B.text("replay-pos"), `Move ${moves} / ${moves}`);
    // clicking a cell in a preview must not play anything
    await B.click("#replay-first");
    await B.cell(0);
    assert.equal((await B.state()).history.length, moves, "the finished game is untouched");
    await B.click("#result-fab");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), true, "the result overlay closes the replay bar");
    assert.equal(await B.ev("ChainGame.previewPly"), null);
    await B.click("#overlay-again");
    const st = await B.state();
    assert.equal(st.history.length, 0);
    assert.equal(st.current, 1, "second local game: the other player starts");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true);
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), true, "a rematch hides the replay bar");
});

test("back to room, switch to five wins with 6 in a row, scripted win with jumping line", async () => {
    await B.click("#btn-menu");
    assert.equal(await B.screen(), "screen-lobby");
    await B.selectGame("five");
    assert.match(await B.text("settings-summary"), /^11 × 11 · 5 in a row/, "five starts at its 11 × 11 default (#16)");
    await B.click("#btn-settings");
    await B.setting("winlen", 6); await B.setting("size", 7);
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

test("changelog: the title screen's button loads changelog.json and links issues in a new tab", async () => {
    await B.click("#btn-changelog");
    await B.waitFor("document.querySelectorAll('#changelog-list .cl-day').length > 0", { what: "changelog loaded" });
    assert.equal(await B.ev("document.getElementById('changelog-modal').hidden"), false);
    assert.match(await B.ev("document.querySelector('#changelog-list .cl-day h2').textContent"), /^\d{4}-\d{2}-\d{2}$/, "newest day first");
    assert.ok(await B.ev("[...document.querySelectorAll('#changelog-list a.cl-ref')].every(a => a.target === '_blank' && a.href.startsWith('https://github.com/alexander-zierhut/minigames/'))"));
    await B.click("#btn-changelog-done");
    assert.equal(await B.ev("document.getElementById('changelog-modal').hidden"), true);
});

