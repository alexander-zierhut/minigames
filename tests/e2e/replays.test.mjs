/* Replays (#42) in a real browser: a played game lands in IndexedDB, the title screen's
   Replays list shows it, it can be watched with the replay bar, saved as a file and opened
   from one, and deleted again. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, ROOT } from "./harness.mjs";

let server, B;
const FIVE_WIN = [0, 5, 1, 6, 2, 7, 3];          // seat 0 makes four in a row on a 5×5 board
const entries = () => B.ev("document.querySelectorAll('#replay-list .replay-item').length");
const firstSub = () => B.ev("document.querySelector('#replay-list .replay-item .replay-sub').textContent");

before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await server?.close(); });

test("a finished local game is saved and survives a reload", async () => {
    assert.equal(await B.ev("Replays.store.persistent()"), true, "Chrome keeps replays in IndexedDB");
    await B.ev("Replays.store.clear()");
    const names = await B.ev("Prefs.seatNames(2).join(' vs ')");

    await B.click("#btn-local");
    await B.selectGame("five");
    await B.click("#btn-settings");
    await B.set("set-size", 5);
    await B.set("set-winlen", 4);
    await B.click("#btn-settings-done");
    await B.click("#btn-start");
    for (const i of FIVE_WIN) await B.move(i);
    assert.equal((await B.state()).over, true);

    // back to the title, then a full reload: the replay is still there (IndexedDB, not memory)
    await B.click("#btn-menu");
    await B.click("#btn-lobby-back");
    await B.goto(server.url);
    await B.click("#btn-replays");
    assert.equal(await B.screen(), "screen-replays");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 1", { what: "the game in the list" });
    assert.match(await B.ev("document.querySelector('#replay-list .replay-title').textContent"), /^Five Wins · 5 × 5$/);
    const sub = await firstSub();
    assert.match(sub, new RegExp(names.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the names of the people who played");
    assert.match(sub, / won · 7 moves$/);
    assert.equal(await B.ev("document.getElementById('replays-hint').hidden"), true);
});

test("watching a replay: the bar starts at move 0 and steps to the end", async () => {
    await B.click("#replay-list .replay-item button[data-act='watch']");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.ev("Match.mode"), "replay");
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), false);
    assert.equal(await B.text("replay-pos"), "Move 0 / 7");
    assert.equal(await B.ev("document.querySelectorAll('#board > .stone.taken').length"), 0, "an empty board at move 0");
    assert.equal(await B.ev("document.getElementById('btn-restart').hidden"), true, "a replay has no rematch");
    assert.equal(await B.text("btn-menu"), "Back to replays");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true);
    assert.equal(await B.ev("document.querySelectorAll('#board > .stone.can-place').length"), 0, "nobody plays here");

    await B.click("#board > .stone:nth-child(13)");                   // a click changes nothing
    assert.equal(await B.ev("FiveGame.state.history.length"), 7);

    await B.click("#replay-next");
    assert.equal(await B.text("replay-pos"), "Move 1 / 7");
    assert.equal(await B.ev("document.querySelectorAll('#board > .stone.taken').length"), 1);
    await B.click("#replay-last");
    assert.equal(await B.text("replay-pos"), "Move 7 / 7");
    assert.equal(await B.ev("document.querySelectorAll('#board > .stone.taken').length"), 7);
    assert.equal(await B.ev("document.querySelectorAll('#board > .stone.win').length"), 4, "the winning line is shown");

    await B.click("#btn-menu");
    assert.equal(await B.screen(), "screen-replays");
    assert.equal(await B.ev("Match.mode"), "local");
});

test("a replay can be saved as a file, and the file is a valid replay", async () => {
    // catch the download instead of letting Chrome write it to disk
    await B.ev("window.__dl = null; HTMLAnchorElement.prototype.click = function () { window.__dl = { name: this.download, href: this.href }; };");
    await B.click("#replay-list .replay-item button[data-act='download']");
    const name = await B.ev("window.__dl && window.__dl.name");
    assert.match(name, /^five-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const text = await B.ev("fetch(window.__dl.href).then(r => r.text())");
    const doc = JSON.parse(text);
    assert.equal(doc.format, "alzlper-minigames-replay");
    assert.equal(doc.game, "five");
    assert.equal(doc.history.length, 7);
    assert.equal(await B.ev(`Replays.validate(${JSON.stringify(doc)}).ok`), true, "the saved file imports again");
});

test("a replay file is opened, watched and filtered by game", async () => {
    await B.upload("#replay-file", ROOT + "tests/replays/v1-chain.json");
    // the file says which game it is: the viewer opens straight away
    await B.waitFor("Match.mode === 'replay'", { what: "the uploaded replay opens" });
    assert.equal(await B.text("sign-title"), "CHAIN REACT");
    assert.equal(await B.text("replay-pos"), "Move 0 / 24");
    assert.equal(await B.text("p0-name"), "Robin");
    await B.click("#btn-menu");

    assert.equal(await entries(), 2, "the uploaded game joined the list");
    await B.click("#replay-filter button[data-filter='chain']");
    assert.equal(await entries(), 1);
    assert.match(await firstSub(), /Robin vs Sam/);
    await B.click("#replay-filter button[data-filter='five']");
    assert.equal(await entries(), 1);
    assert.match(await B.ev("document.querySelector('#replay-list .replay-title').textContent"), /^Five Wins/);
    await B.click("#replay-filter button[data-filter='all']");
    assert.equal(await entries(), 2);

    // the same file again does not double the list
    await B.upload("#replay-file", ROOT + "tests/replays/v1-chain.json");
    await B.waitFor("Match.mode === 'replay'", { what: "the replay opens again" });
    await B.click("#btn-menu");
    assert.equal(await entries(), 2, "the same game is one entry");
});

test("a file that is not a replay is refused with a message", async () => {
    await B.upload("#replay-file", ROOT + "tests/replays/bad-illegal-move.json");
    await B.waitFor("document.getElementById('toast').hidden === false", { what: "the refusal toast" });
    assert.match(await B.text("toast"), /rules/);
    assert.equal(await B.screen(), "screen-replays");
    assert.equal(await entries(), 2, "nothing was added");
});

test("deleting a replay removes it from the list", async () => {
    await B.click("#replay-list .replay-item button[data-act='delete']");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 1", { what: "one entry left" });
    await B.click("#replay-list .replay-item button[data-act='delete']");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 0", { what: "an empty list" });
    assert.equal(await B.ev("document.getElementById('replays-hint').hidden"), false);
    assert.match(await B.text("replays-hint"), /No replays yet/);
});

test("phone 360×780: a full list scrolls inside the card, the screen does not", async () => {
    await B.emulate(360, 780);
    // a handful of games, saved the way the app saves them
    await B.ev(`(async () => {
        const base = await (await fetch("tests/replays/v1-five.json")).json();
        for (let k = 0; k < 8; k++) {
            await Replays.store.save({ ...base, players: ["Player " + k, "Guest " + k],
                meta: { ...base.meta, playedAt: new Date(Date.UTC(2026, 8, 1 + k, 12, 0)).toISOString() } });
        }
        return true;
    })()`);
    await B.click("#btn-replays-back");
    await B.click("#btn-replays");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 8", { what: "eight entries" });
    const fit = await B.noScroll();
    assert.equal(fit.y, true, "the replays screen never scrolls the page");
    assert.equal(fit.x, true);
    assert.ok(await B.ev("document.getElementById('replay-list').scrollHeight > document.getElementById('replay-list').clientHeight"), "the list itself scrolls");
    assert.ok(await B.ev("document.getElementById('btn-replays-back').getBoundingClientRect().bottom <= innerHeight"), "Back stays reachable");
    await B.screenshot("mobile-replays.png");
    assert.deepEqual(B.errors, [], "no exceptions on the replays screen");
});
