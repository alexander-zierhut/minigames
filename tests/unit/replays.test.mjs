/* Replay files and the replay store (#42).

   tests/replays/ holds a sample of **every** format version (`v<version>-<game>.json`) plus
   a few files that must be refused (`bad-*.json`). When the format version is bumped:
   add `Replays.MIGRATIONS[old]`, drop a sample of the old version in there and keep the new
   one next to it — the first two tests below fail until both exist. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { loadDom, hooks } from "./dom.mjs";

const DIR = new URL("../replays/", import.meta.url).pathname;
const samples = readdirSync(DIR).filter((f) => /^v\d+-.*\.json$/.test(f)).sort();
const read = (f) => readFileSync(DIR + f, "utf8");

test("every sample file still imports, validates and plays to its recorded result", () => {
    const w = loadDom();
    const R = w.eval("Replays"); const Rules = w.eval("Rules");
    assert.ok(samples.length >= 2, "there must be samples of the replay format");
    for (const file of samples) {
        const res = R.parse(read(file));
        assert.equal(res.ok, true, `${file}: ${res.error}`);
        const doc = res.doc;
        assert.equal(doc.version, R.VERSION, `${file} was migrated to the current version`);
        const state = Rules.replay({ game: doc.game, config: doc.config, history: doc.history, outs: doc.outs });
        assert.equal(state.history.length, doc.history.length, `${file}: every move replays`);
        if (doc.result.over) {
            assert.equal(state.over, true, `${file} ends`);
            assert.equal(state.winner, doc.result.winner, `${file} ends the same way`);
            assert.equal(state.finishWhy, doc.result.why, `${file}: same reason`);
        }
    }
    w.close();
});

test("there is a sample and a migration for every format version that ever existed", () => {
    const w = loadDom();
    const R = w.eval("Replays");
    for (let v = 1; v <= R.VERSION; v++) {
        assert.ok(samples.some((f) => f.startsWith(`v${v}-`)), `tests/replays needs a sample of version ${v}`);
        if (v < R.VERSION) assert.equal(typeof R.MIGRATIONS[v], "function", `Replays.MIGRATIONS[${v}] is missing`);
    }
    assert.equal(R.MIGRATIONS[R.VERSION], undefined, "the current version needs no migration");
    w.close();
});

test("files that are not a replay of this version are refused with a reason", () => {
    const w = loadDom();
    const R = w.eval("Replays");
    const refused = (text) => {
        const res = R.parse(text);
        assert.equal(res.ok, false);
        assert.equal(typeof res.error, "string");
        assert.ok(res.error.length > 0);
        return res.error;
    };
    refused(read("bad-not-a-replay.json"));
    assert.match(refused(read("bad-future-version.json")), /newer version/);
    assert.match(refused(read("bad-illegal-move.json")), /rules/);
    refused("not json at all");
    // an old shape without a version (a "v0" file) is refused too, never guessed at
    const v0 = JSON.parse(read("v1-five.json"));
    delete v0.version;
    refused(JSON.stringify(v0));
    const unknownGame = { ...JSON.parse(read("v1-five.json")), game: "tetris" };
    assert.match(refused(JSON.stringify(unknownGame)), /does not have/);
    w.close();
});

test("a finished game becomes a replay that replays to the same position", async () => {
    const w = loadDom();
    const F = w.eval("FiveGame"); const R = w.eval("Replays"); const Rules = w.eval("Rules");
    const { h } = hooks();
    F.newGame({ game: "five", n: 5, winLen: 4, players: 2, startPlayer: 0 }, h);
    for (const i of [0, 5, 1, 6, 2, 7, 3]) await F.play(i);
    assert.equal(F.state.over, true);

    const doc = R.fromRecord({ ...F.record(), gameNo: 3 }, ["Robin", "Sam"], "local");
    assert.equal(R.validate(doc).ok, true);
    assert.equal(doc.format, R.FORMAT);
    assert.equal(doc.game, "five");
    assert.equal(JSON.stringify(doc.players), JSON.stringify(["Robin", "Sam"]));
    assert.equal(doc.result.over, true);
    assert.equal(doc.result.winner, 0);
    assert.equal(doc.meta.mode, "local");
    assert.equal(doc.meta.gameNo, 3);
    assert.ok(!isNaN(Date.parse(doc.meta.playedAt)));

    // through a file and back: the same document, the same final position
    const back = R.parse(JSON.stringify(doc));
    assert.equal(back.ok, true);
    assert.equal(JSON.stringify(back.doc), JSON.stringify(doc), "a replay survives a round trip");
    const state = Rules.replay(back.doc);
    assert.equal(JSON.stringify(state.cells), JSON.stringify(F.state.cells));
    assert.equal(state.winner, F.state.winner);
    w.close();
});

test("an unfinished game is saved as unfinished, missing names become Player k", async () => {
    const w = loadDom();
    const F = w.eval("FiveGame"); const R = w.eval("Replays");
    const { h } = hooks();
    F.newGame({ game: "five", n: 5, winLen: 4, players: 2, startPlayer: 0 }, h);
    for (const i of [0, 5, 1]) await F.play(i);
    F.abandon();
    const doc = R.fromRecord(F.record(), [], "online", { finished: false });
    assert.equal(doc.result.over, false);
    assert.equal(doc.result.winner, null);
    assert.equal(doc.result.why, "");
    assert.equal(JSON.stringify(doc.players), JSON.stringify(["Player 1", "Player 2"]));
    assert.equal(R.validate(doc).ok, true);
    assert.equal(R.summary(doc).resultText, "Unfinished");
    w.close();
});

test("file name, date and summary read like the list shows them", () => {
    const w = loadDom();
    const R = w.eval("Replays");
    const doc = JSON.parse(read("v1-five.json"));
    const d = new Date(doc.meta.playedAt);
    const pad = (v) => String(v).padStart(2, "0");
    assert.equal(R.fileName(doc), `five-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.minigames.replay`);
    assert.equal(R.EXT, ".minigames.replay");
    assert.match(R.when(doc.meta.playedAt), /2026/);
    const s = R.summary(doc);
    assert.equal(s.title, "Five Wins");
    assert.equal(s.n, 5);
    assert.equal(s.moves, 7);
    assert.equal(s.resultText, "Robin won");
    assert.equal(JSON.stringify(s.players), JSON.stringify(["Robin", "Bot"]));
    assert.equal(s.id, R.idFor(doc));
    // a draw and a three-player game read the same way
    const draw = { ...doc, result: { over: true, winner: -1, why: "The board is full." } };
    assert.equal(R.summary(draw).resultText, "Draw");
    // the bot flag: the offline bot table, or a room whose config seats a bot (Play from here)
    assert.equal(s.bot, true, "played against the bot");
    const chain = JSON.parse(read("v1-chain.json"));
    assert.equal(R.summary(chain).bot, false, "two people");
    const roomBot = { ...chain, meta: { ...chain.meta, mode: "online" }, config: { ...chain.config, bot: { id: "creeper-chain", difficulty: "normal", seat: 0 } } };
    assert.equal(R.summary(roomBot).bot, true, "a room with a bot on a seat counts as a bot game");
    // the list filters (pure): bot or not, and part of a player's name, case-insensitive
    const items = [s, R.summary(chain), R.summary(roomBot)];
    assert.equal(R.filter(items).length, 3);
    assert.equal(R.filter(items, { kind: "bot" }).length, 2);
    assert.equal(R.filter(items, { kind: "nobot" }).length, 1);
    assert.equal(R.filter(items, { search: "sam" }).length, 2);
    assert.equal(R.filter(items, { search: "  ROB " }).length, 3);
    assert.equal(R.filter(items, { kind: "nobot", search: "bot" }).length, 0);
    assert.equal(R.filter(items, { kind: "bot", search: "sam" }).length, 1);
    // by game, and by the local day it was played (inclusive, either end open)
    assert.equal(R.filter(items, { game: "five" }).length, 1);
    assert.equal(R.filter(items, { game: "chain" }).length, 2);
    assert.equal(R.filter(items, { game: "all" }).length, 3);
    const day = R.dayOf(doc.meta.playedAt);
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(R.dayOf("garbage"), "");
    const before = (d) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() - 1); return R.dayOf(x.toISOString()); };
    const after = (d) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + 1); return R.dayOf(x.toISOString()); };
    assert.equal(R.filter([s], { from: day }).length, 1, "from the same day: in");
    assert.equal(R.filter([s], { to: day }).length, 1, "to the same day: in");
    assert.equal(R.filter([s], { from: after(day) }).length, 0);
    assert.equal(R.filter([s], { to: before(day) }).length, 0);
    assert.equal(R.filter([s], { from: before(day), to: after(day) }).length, 1);
    w.close();
});

test("the store keeps replays: newest first, per game, one entry per game played", async () => {
    const w = loadDom();
    const R = w.eval("Replays");
    const chain = JSON.parse(read("v1-chain.json"));
    const five = JSON.parse(read("v1-five.json"));
    await R.store.clear();

    const idChain = await R.store.save(chain);
    const idFive = await R.store.save(five);
    assert.equal(idChain, R.idFor(chain));
    let list = await R.store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, idFive, "the newest game is first");
    assert.equal(list[1].game, "chain");

    assert.equal((await R.store.list({ game: "chain" })).length, 1);
    assert.equal((await R.store.list({ game: "five" }))[0].moves, 7);

    // the same game again (a refresh into a finished game, the same file uploaded twice)
    // keeps one entry and its first timestamp
    const again = { ...five, meta: { ...five.meta, playedAt: "2027-01-01T00:00:00.000Z" } };
    assert.equal(await R.store.save(again), idFive);
    list = await R.store.list();
    assert.equal(list.length, 2, "no duplicate for the same game");
    assert.equal(list.find((r) => r.id === idFive).playedAt, five.meta.playedAt);

    const back = await R.store.get(idFive);
    assert.equal(JSON.stringify(back), JSON.stringify(five), "what went in comes out");
    assert.equal(await R.store.get("nothing-here"), null);

    await R.store.remove(idChain);
    assert.equal((await R.store.list()).length, 1);
    await R.store.clear();
    assert.equal((await R.store.list()).length, 0);
    // jsdom has no IndexedDB: the store says so and keeps working in memory (the real
    // IndexedDB path is covered by tests/e2e/replays.test.mjs)
    assert.equal(await R.store.persistent(), false);
    w.close();
});

test("Match.watch puts a replay on the board with nobody to move", async () => {
    const w = loadDom();
    const M = w.eval("Match"); const R = w.eval("Replays"); const d = w.document;
    const doc = JSON.parse(read("v1-five.json"));
    M.init({ names: () => doc.players });
    M.watch(doc);
    assert.equal(M.mode, "replay");
    assert.equal(JSON.stringify(M.seats.map((s) => s.kind)), JSON.stringify(["watch", "watch"]));
    assert.equal(M.state.over, true);
    assert.equal(M.state.winner, 0);
    assert.equal(M.state.history.length, 7);
    assert.equal(d.getElementById("p0-name").textContent, "Robin");
    assert.equal(d.getElementById("clock-0").hidden, true, "a replay has no clock");

    // stepping works exactly as after a live game, and no click ever places anything
    assert.equal(M.engine.preview(2), 2);
    const stones = [...d.querySelectorAll("#board > .stone")];
    assert.equal(stones.every((s) => s.classList.contains("locked")), true);
    stones[12].click();
    assert.equal(M.state.history.length, 7);
    assert.equal(M.premove, -1, "a replay never takes a premove");
    M.engine.preview(null);
    assert.equal(M.engine.previewPly, null);
    w.close();
});
