/* Replays (#42) in a real browser: a played game lands in IndexedDB, the title screen's
   Replays list shows it, it can be watched with the replay bar, saved as a file and opened
   from one, and deleted again. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, ROOT, ONLINE } from "./harness.mjs";

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

test("the analysis judges every move, scores both seats and marks the bot's move (#43)", async () => {
    await B.click("#replay-list .replay-item button[data-act='watch']");
    // the list reads the document out of IndexedDB before it opens the viewer
    await B.waitFor("Match.mode === 'replay'", { what: "the replay viewer" });
    assert.equal(await B.ev("document.getElementById('replay-panel').hidden"), false, "the panel comes up with the replay bar");
    assert.equal(await B.ev("document.getElementById('btn-play-from-here').hidden"), false, "a two-player replay can be played on");
    // it starts by itself and reports its progress, then shows the result
    await B.waitFor("Analysis.result || Analysis.busy", { what: "the analysis starts by itself" });
    await B.waitFor("Analysis.result", { timeout: 90000, what: "the analysis finishes" });
    assert.equal(await B.ev("document.getElementById('analysis-progress').hidden"), true, "the progress bar goes away when it is done");
    const res = JSON.parse(await B.ev("JSON.stringify(Analysis.result)"));
    assert.equal(res.chances.length, 8, "a win chance for the empty board and after every move");
    assert.equal(res.moves.length, 7);
    assert.ok(res.bot && res.bot.id, "the game's own bot did the judging");
    assert.equal(res.scores.length, 2);
    for (const s of res.scores) assert.ok(s.score >= 0 && s.score <= 100, `score in range: ${s.score}`);

    // the panel talks about the move that led to the shown position
    const seat0 = await B.text("p0-name");
    await B.click("#replay-next");
    assert.match(await B.text("an-verdict"), new RegExp(`^Move 1 · ${seat0} · `));
    assert.match(await B.text("an-chance"), new RegExp(`${seat0} \\d+ % → \\d+ %`));
    assert.match(await B.text("an-scores"), new RegExp(seat0));
    assert.match(await B.text("an-scores"), /best/);
    assert.equal(await B.ev("document.querySelectorAll('#an-graph svg polyline').length"), 2, "one win-chance line per player");

    // a move the bot would not have played is marked on the board
    const bad = res.moves.find((m) => m.perfect === false && m.best !== null);
    assert.ok(bad, "the bot disagrees with at least one move of this game");
    await B.ev(`document.getElementById('replay-first').click(); true`);
    for (let k = 0; k <= bad.ply; k++) await B.click("#replay-next");
    assert.equal(await B.ev("Match.marked"), bad.best, "the bot's move is marked");
    assert.equal(await B.ev("document.querySelectorAll('#board > .best-move').length"), 1);
    assert.match(await B.text("an-verdict"), /Best was|Blunder|Mistake/);

    // the graph jumps to a move, Play walks to the end and stops there
    await B.ev("(() => { const g = document.getElementById('an-graph'); const r = g.getBoundingClientRect(); g.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, bubbles: true })); return true; })()");
    assert.match(await B.text("replay-pos"), /^Move [34] \/ 7$/, "the middle of the graph is the middle of the game");
    await B.click("#replay-play");
    assert.equal(await B.text("replay-play"), "❚❚", "…and the button offers Pause while it runs");
    await B.waitFor("FiveGame.previewPly === null", { timeout: 20000, what: "Play walks to the last move" });
    await B.waitFor("document.getElementById('replay-play').textContent === '▶▶'", { what: "it stops at the end" });

    await B.screenshot("replay-analysis.png");
    await B.click("#btn-menu");
    assert.equal(await B.ev("document.getElementById('replay-panel').hidden"), true, "the panel goes with the bar");
    assert.equal(await B.screen(), "screen-replays");
    assert.deepEqual(B.errors, [], "no exceptions while analysing");
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

test("phone 360×780: the analysis panel fits above the bar, collapsed until it is opened (#43)", async () => {
    await B.click("#replay-list .replay-item button[data-act='watch']");
    await B.waitFor("Match.mode === 'replay'", { what: "the replay viewer" });
    assert.equal(await B.ev("document.getElementById('replay-panel').classList.contains('collapsed')"), true, "phones start with the head row only");
    await B.waitFor("Analysis.result", { timeout: 90000, what: "the analysis finishes" });
    await B.click("#replay-next");
    assert.match(await B.text("an-verdict"), /Move 1 · /);
    let fit = await B.noScroll();
    assert.equal(fit.y, true, "the game screen never scrolls the page");
    assert.equal(fit.x, true);
    const boxes = JSON.parse(await B.ev(`JSON.stringify({
        panel: document.getElementById('replay-panel').getBoundingClientRect().toJSON(),
        bar: document.getElementById('replay-bar').getBoundingClientRect().toJSON(),
        hut: document.getElementById('hut').getBoundingClientRect().toJSON() })`));
    assert.ok(boxes.panel.bottom <= boxes.bar.top + 1, "the panel sits above the bar");
    assert.ok(boxes.bar.bottom <= boxes.hut.top + 1, "…and the bar above the HUD");
    assert.ok(boxes.panel.top >= 0 && boxes.panel.right <= 360, "the whole panel is on the screen");
    await B.screenshot("mobile-replay-analysis.png");

    // the graph and the scores come on demand
    await B.click("#an-toggle");
    assert.equal(await B.ev("document.getElementById('an-graph').hidden"), false);
    assert.ok(await B.ev("document.getElementById('an-scores').children.length >= 2"), "one row per seat");
    fit = await B.noScroll();
    assert.equal(fit.y, true, "the open panel does not scroll the page either");
    assert.ok(await B.ev("document.getElementById('replay-panel').getBoundingClientRect().top >= 0"), "and still fits");
    await B.screenshot("mobile-replay-analysis-open.png");
    assert.deepEqual(B.errors, [], "no exceptions on a phone");
    await B.click("#btn-menu");
});

test("Play from here: the replay continues in a room against the bot, viewers can watch (#43)", { skip: !ONLINE }, async () => {
    await B.emulate(1000, 800);
    await B.click("#replay-list .replay-item button[data-act='watch']");
    await B.waitFor("Match.mode === 'replay'", { what: "the replay viewer" });
    for (let k = 0; k < 3; k++) await B.click("#replay-next");
    assert.equal(await B.text("replay-pos"), "Move 3 / 7");

    await B.click("#btn-play-from-here");
    await B.waitFor("Net.role === 'host' && Match.mode === 'online'", { timeout: 40000, what: "the room is up" });
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.ev("Match.me"), 1, "the human takes the seat that is to move");
    assert.equal(await B.ev("Settings.bot.seat"), 0, "…and the bot sits on the other one");
    assert.equal(await B.ev("JSON.stringify(Match.seats.map(s => s.kind))"), JSON.stringify(["bot", "local"]));
    assert.equal(await B.ev("JSON.stringify(FiveGame.state.history)"), "[0,5,1]", "the game starts from the shown position");
    assert.equal((await B.state()).current, 1, "and it is my move");
    assert.equal(await B.text("p0-name"), "Bot");

    await B.move(10);
    await B.waitFor("FiveGame.state.history.length === 5 && !FiveGame.state.busy", { timeout: 40000, what: "the bot answers" });
    assert.equal((await B.state()).current, 1, "back to me");

    // the spectate link still works: a viewer sees the same position
    const link = await B.ev("Room.spectateLink()");
    assert.match(link, /watch=[A-Z0-9]{4,5}/);
    const V = await launchBrowser();
    try {
        await V.goto(link);
        await V.waitFor("Net.connected", { timeout: 60000, what: "the viewer connected" });
        await V.waitFor("FiveGame.state.history.length >= 5", { timeout: 60000, what: "the viewer sees the position" });
        assert.equal(await V.ev("Match.spectator"), true);
        assert.equal(await V.ev("JSON.stringify(FiveGame.state.history.slice(0, 3))"), "[0,5,1]", "the moves from the replay are there too");
        assert.deepEqual(V.errors, []);
    } finally { await V.close(); }
    assert.deepEqual(B.errors, []);
});
