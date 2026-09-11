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
    // the row's button reads the record from IndexedDB first, so the viewer opens a moment later
    await B.waitFor("document.querySelector('.screen:not([hidden])')?.id === 'screen-game'", { what: "the replay viewer" });
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
    await B.waitFor("window.__dl !== null", { what: "the download" });    // the record is read from IndexedDB first
    const name = await B.ev("window.__dl && window.__dl.name");
    assert.match(name, /^five-\d{4}-\d{2}-\d{2}-\d{4}\.minigames\.replay$/);
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
    // the filter is a dropdown with the games' preview tiles (#43): open it, pick a row
    const pick = async (key) => {
        await B.click("#replay-filter-button");
        assert.equal(await B.ev("document.getElementById('replay-filter').classList.contains('open')"), true, "the menu opened");
        await B.click(`#replay-filter .dd-option[data-filter='${key}']`);
        assert.equal(await B.ev("document.getElementById('replay-filter').classList.contains('open')"), false, "picking closes it");
    };
    assert.equal(await B.ev("document.querySelectorAll('#replay-filter .dd-option').length"), await B.ev("Games.keys().length + 1"), "All games plus one row per game");
    assert.deepEqual(JSON.parse(await B.ev("JSON.stringify([...document.querySelectorAll('#replay-filter .dd-option')].map(o => o.dataset.filter))")),
        JSON.parse(await B.ev("JSON.stringify(['all', ...Games.keys()])")), "All games first, then every registered game");
    assert.equal(await B.ev("document.querySelector('#replay-filter .dd-button .dd-label').textContent"), "All games");
    assert.ok(await B.ev("[...document.querySelectorAll('#replay-filter .dd-option')].every(o => o.querySelector('.game-preview.tiny i'))"), "every row shows a preview tile");
    await pick("chain");
    assert.equal(await entries(), 1);
    assert.equal(await B.ev("document.querySelector('#replay-filter .dd-button .dd-label').textContent"), "Chain React", "the button says what is picked");
    assert.ok(await B.ev("document.querySelector('#replay-filter .dd-button .game-preview').classList.contains('chain')"), "with that game's tile");
    assert.match(await firstSub(), /Robin vs Sam/);
    await pick("five");
    assert.equal(await entries(), 1);
    assert.match(await B.ev("document.querySelector('#replay-list .replay-title').textContent"), /^Five Wins/);
    // a click next to the open menu closes it again
    await B.click("#replay-filter-button");
    await B.click("#replays-hint");
    assert.equal(await B.ev("document.getElementById('replay-filter').classList.contains('open')"), false, "a click outside closes the menu");
    await pick("all");
    assert.equal(await entries(), 2);

    // bot or not: both games so far were played by two people, so "Bot" finds nothing; a
    // bot game saved for this step shows up there (the list is re-read from IndexedDB on
    // every change, so wait for the row count)
    const untilEntries = (n) => B.waitFor(`document.querySelectorAll('#replay-list .replay-item').length === ${n}`, { what: `${n} replay rows` });
    await B.click("#replay-kind button[data-kind='bot']");
    await untilEntries(0);
    assert.match(await B.text("replays-hint"), /No replay matches/);
    await B.ev(`(async () => { const d = await (await fetch("tests/replays/v1-five.json")).json(); await Replays.store.save(d); return true; })()`);
    await B.click("#replay-kind button[data-kind='bot']");
    await untilEntries(1);
    assert.match(await firstSub(), /vs Bot/, "the game against the bot");
    await B.ev(`(async () => { const d = await (await fetch("tests/replays/v1-five.json")).json(); await Replays.store.remove(Replays.idFor(d)); return true; })()`);
    await B.click("#replay-kind button[data-kind='nobot']");
    await untilEntries(2);
    assert.ok(await B.ev("document.querySelector('#replay-kind button[data-kind=\"nobot\"]').classList.contains('selected')"), "the picked kind is highlighted");
    await B.click("#replay-kind button[data-kind='all']");
    await untilEntries(2);
    // search by a player's name, case-insensitive, part of the name is enough
    await B.set("replay-search", "sa");
    await untilEntries(1);
    assert.match(await firstSub(), /Robin vs Sam/);
    await B.set("replay-search", "nobody");
    await untilEntries(0);
    assert.match(await B.text("replays-hint"), /No replay matches/);
    await B.set("replay-search", "");
    await untilEntries(2);
    assert.equal(await B.text("replays-hint"), "");

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

test("an Isolation replay is analysed too: the graph, and the marker on the tile a move steps onto (#43)", async () => {
    await B.upload("#replay-file", ROOT + "tests/replays/v1-isolation.json");
    await B.waitFor("Match.mode === 'replay'", { what: "the isolation replay opens" });
    assert.equal(await B.text("sign-title"), "ISOLATION");
    assert.equal(await B.text("replay-pos"), "Move 0 / 9");
    await B.waitFor("Analysis.result", { timeout: 120000, what: "the analysis finishes" });
    const res = JSON.parse(await B.ev("JSON.stringify(Analysis.result)"));
    assert.equal(res.chances.length, 10, "a win chance for the start and after every move");
    assert.equal(res.bot.id, "warden-isolation", "the game's own bot judged it");
    assert.equal(await B.ev("document.querySelectorAll('#an-graph svg polyline').length"), 2, "one win-chance line per player");
    /* A move the bot would have played differently: its answer is an encoded move
       (`to * cells + removed`), and the marker has to land on the tile that move steps
       onto, never on the move id, which is far off the board. */
    const bad = res.moves.find((m) => m.perfect === false && m.best !== null);
    assert.ok(bad, "the bot disagrees with at least one move of this game");
    await B.click("#replay-first");
    for (let k = 0; k <= bad.ply; k++) await B.click("#replay-next");
    const cells = await B.ev("IsolationGame.state.cells.length");
    const want = await B.ev(`IsolationRules.cellOf(IsolationGame.state, ${bad.best})`);
    assert.ok(want >= 0 && want < cells, "the marked tile is on the board");
    assert.equal(await B.ev("Match.marked"), want, "the bot's step is marked on its destination tile");
    assert.equal(await B.ev("document.querySelectorAll('#board > .slab.best-move').length"), 1);
    assert.match(await B.text("an-verdict"), /Best was|Blunder|Mistake/);
    await B.screenshot("replay-analysis-isolation.png");
    await B.click("#btn-menu");
    // leave the list the way this test found it
    await B.ev("Replays.store.clear()");
    await B.click("#btn-replays-back");
    await B.click("#btn-replays");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 0", { what: "an empty list again" });
    assert.deepEqual(B.errors, [], "no exceptions while analysing Isolation");
});

test("pages of ten, the count of found replays and the date range", async () => {
    // twelve games, saved the way the app saves them, one per day in September 2026
    await B.ev(`(async () => {
        const base = await (await fetch("tests/replays/v1-five.json")).json();
        for (let k = 0; k < 12; k++) {
            await Replays.store.save({ ...base, players: ["Player " + k, "Guest " + k],
                meta: { ...base.meta, playedAt: new Date(2026, 8, 1 + k, 12, 0).toISOString() } });
        }
        return true;
    })()`);
    await B.click("#btn-replays-back");
    await B.click("#btn-replays");
    const rows = (n) => B.waitFor(`document.querySelectorAll('#replay-list .replay-item').length === ${n}`, { what: `${n} rows` });
    await rows(10);
    assert.equal(await B.text("replay-count"), "12 replays");
    assert.ok(await B.ev("[...document.querySelectorAll('#replay-list .replay-item')].every(r => r.querySelector('.game-preview.tiny.five i'))"), "every row carries its game's tile");
    assert.equal(await B.ev("document.getElementById('replay-pager').hidden"), false, "more than one page: the pager shows");
    assert.equal(await B.text("replay-page"), "Page 1 of 2");
    assert.equal(await B.ev("document.getElementById('replay-page-prev').disabled"), true);
    assert.match(await firstSub(), /Player 11 vs Guest 11/, "newest first");
    await B.click("#replay-page-next");
    await rows(2);
    assert.equal(await B.text("replay-page"), "Page 2 of 2");
    assert.equal(await B.ev("document.getElementById('replay-page-next').disabled"), true);
    assert.match(await firstSub(), /Player 1 vs Guest 1/);
    await B.click("#replay-page-prev");
    await rows(10);
    // a search says how many were found of all, and goes back to the first page
    await B.set("replay-search", "Player 1");
    await rows(3);                                                    // Player 1, 10, 11
    assert.equal(await B.text("replay-count"), "3 of 12 replays");
    assert.equal(await B.ev("document.getElementById('replay-pager').hidden"), true, "one page: no pager");
    await B.set("replay-search", "");
    await rows(10);
    // the date range is inclusive on both ends, in local days
    await B.set("replay-from", "2026-09-03");
    await B.set("replay-to", "2026-09-06");
    await rows(4);
    assert.equal(await B.text("replay-count"), "4 of 12 replays");
    assert.match(await firstSub(), /Player 5 vs Guest 5/);
    await B.set("replay-to", "");
    await rows(10);
    assert.equal(await B.text("replay-count"), "10 of 12 replays");
    await B.set("replay-from", "2026-12-01");
    await rows(0);
    assert.match(await B.text("replays-hint"), /No replay matches/);
    assert.equal(await B.ev("document.getElementById('replays-hint').hidden"), false);
    await B.set("replay-from", "");
    await rows(10);
    assert.equal(await B.text("replay-count"), "12 replays");
    assert.deepEqual(B.errors, [], "no exceptions while filtering");
});

test("phone 360×780: the page scrolls through a long list, nothing scrolls inside the card", async () => {
    await B.emulate(360, 780);
    await B.click("#btn-replays-back");
    await B.click("#btn-replays");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 10", { what: "a page of ten" });
    const fit = await B.noScroll();
    assert.equal(fit.x, true, "never sideways");
    assert.ok(await B.ev("document.getElementById('replay-list').scrollHeight <= document.getElementById('replay-list').clientHeight + 1"), "the list is shown whole, no box inside the card scrolls");
    assert.ok(await B.ev("document.getElementById('btn-replay-upload').getBoundingClientRect().top < 200"), "Open a replay file sits at the top");
    // the screen carries the list: scroll it down and Back comes into view
    await B.ev("(() => { const s = document.getElementById('screen-replays'); s.scrollTop = s.scrollHeight; return true; })()");
    assert.ok(await B.ev("document.getElementById('btn-replays-back').getBoundingClientRect().bottom <= innerHeight + 1"), "Back is reachable by scrolling the page");
    await B.ev("(() => { document.getElementById('screen-replays').scrollTop = 0; return true; })()");
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
