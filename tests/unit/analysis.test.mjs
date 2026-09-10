/* Replay analysis (#43): the pure part. Everything the panel shows is computed by
   Analysis.analyse, which takes its estimator and its bot from the caller — so these tests
   inject fakes and stay instant and deterministic. The panel itself is covered by
   tests/e2e/replays.test.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom } from "./dom.mjs";

const CONFIG = { game: "five", n: 5, winLen: 4, players: 2, startPlayer: 0 };
const HISTORY = [0, 5, 1, 6];                       // four moves, nobody wins yet
const docOf = (extra = {}) => ({ game: "five", config: { ...CONFIG, ...(extra.config || {}) }, history: extra.history || HISTORY, outs: [], players: ["Ann", "Ben"] });

// a position as a short string, so a fake estimator / bot can look it up
const keyOf = (s) => s.cells.map((c) => (c < 0 ? "." : c)).join("");

/* One scenario used by several tests:
   ply 0  Ann plays 0    the bot agrees                       perfect
   ply 1  Ben plays 5    the bot wanted 20, which was far better   blunder
   ply 2  Ann plays 1    the bot wanted 21, but 1 is as good       perfect (tolerance)
   ply 3  Ben plays 6    the bot agrees                        perfect                     */
function scenario(w) {
    const A = w.eval("Analysis"); const Rules = w.eval("Rules");
    const rules = Rules.of("five");
    const doc = docOf();
    const pos = A.positionsOf({ game: doc.game, config: doc.config, history: doc.history, outs: [] });
    const after = (state, i) => { const s = JSON.parse(JSON.stringify(state)); Rules.step(rules, s, i); return s; };
    const values = new Map([
        [keyOf(pos[0]), 0.5],
        [keyOf(pos[1]), 0.6],
        [keyOf(pos[2]), 0.55],
        [keyOf(pos[3]), 0.65],
        [keyOf(pos[4]), 0.3],
        [keyOf(after(pos[1], 20)), 0.2],            // Ben's best move: much better for Ben
        [keyOf(after(pos[2], 21)), 0.66],           // Ann's alternative: one point better than 1
    ]);
    const plan = new Map([
        [keyOf(pos[0]), 0], [keyOf(pos[1]), 20], [keyOf(pos[2]), 21], [keyOf(pos[3]), 6],
    ]);
    const estimator = { at: (s) => (values.has(keyOf(s)) ? values.get(keyOf(s)) : 0.5) };
    const bot = { id: "fake", version: 1, nodes: 100, move: (s) => plan.get(keyOf(s)) };
    return { A, doc, estimator, bot };
}

test("every ply gets a win chance, a best move and a verdict", async () => {
    const w = loadDom();
    const { A, doc, estimator, bot } = scenario(w);
    const res = await A.analyse(doc, { estimator, bot, nodes: 50 });

    assert.equal(res.players, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(res.chances)), [0.5, 0.6, 0.55, 0.65, 0.3], "one win chance per position, the last one included");
    assert.equal(res.moves.length, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(res.moves.map((m) => [m.ply, m.player, m.played, m.best]))),
        [[0, 0, 0, 0], [1, 1, 5, 20], [2, 0, 1, 21], [3, 1, 6, 6]]);

    // the bot's own move loses nothing; a move as good as the bot's counts as perfect too
    assert.equal(res.moves[0].perfect, true);
    assert.equal(res.moves[0].loss, 0);
    assert.equal(res.moves[2].perfect, true, "1 point behind the best move is inside the tolerance");
    assert.ok(res.moves[2].loss > 0 && res.moves[2].loss <= A.TOLERANCE);
    assert.equal(res.moves[3].perfect, true);

    // the blunder: 80 % for Ben after the best move, 45 % after the move he played
    assert.equal(res.moves[1].perfect, false);
    assert.ok(Math.abs(res.moves[1].loss - 35) < 1e-6, "the loss is measured against the bot's move");
    assert.equal(A.verdict(res.moves[1]).cls, "an-blunder");
    assert.match(A.verdict(res.moves[1]).text, /Blunder: 35 % lost, best was 20/);
    assert.equal(A.verdict(res.moves[0]).text, "Perfect move");
    assert.equal(res.partial, false);
    assert.equal(res.bot.id, "fake");
    w.close();
});

test("the score per seat combines accuracy and the win chance given away", async () => {
    const w = loadDom();
    const { A, doc, estimator, bot } = scenario(w);
    const res = await A.analyse(doc, { estimator, bot, nodes: 50 });
    const [ann, ben] = res.scores;

    assert.equal(ann.moves, 2); assert.equal(ann.perfect, 2);
    assert.equal(ann.blunders, 0); assert.equal(ann.mistakes, 0);
    assert.equal(ann.score, 100, "two perfect moves, nothing given away");

    assert.equal(ben.moves, 2); assert.equal(ben.perfect, 1);
    assert.equal(ben.blunders, 1); assert.equal(ben.mistakes, 0);
    // accuracy 0.5, average loss 17.5 -> 100 * (0.6 * 0.5 + 0.4 * (1 - 17.5 / 50)) = 56
    assert.equal(ben.score, 56);

    // …and the formula itself, on hand-made rows
    const rows = [
        { player: 0, perfect: true, loss: 0 }, { player: 0, perfect: false, loss: 25 },
        { player: 0, perfect: false, loss: 15 }, { player: 0, perfect: true, loss: 2 },
    ];
    const [s] = A.scores(rows, 1);
    assert.equal(s.moves, 4); assert.equal(s.perfect, 2);
    assert.equal(s.blunders, 1, "25 points is a blunder");
    assert.equal(s.mistakes, 1, "15 points is a mistake");
    assert.equal(s.avgLoss, 10.5);
    assert.equal(s.score, Math.round(100 * (0.6 * 0.5 + 0.4 * (1 - 10.5 / 50))));
    w.close();
});

test("progress is reported for every step and ends at the total", async () => {
    const w = loadDom();
    const { A, doc, estimator, bot } = scenario(w);
    const seen = [];
    await A.analyse(doc, { estimator, bot, onProgress: (d, t) => seen.push([d, t]) });
    assert.equal(seen.length, 10, "5 positions + 4 moves + the final report");
    assert.deepEqual(seen[0], [1, 9]);
    assert.deepEqual(seen[seen.length - 1], [9, 9], "it ends at 100 %");
    for (let k = 1; k < seen.length; k++) assert.ok(seen[k][0] >= seen[k - 1][0], "progress never goes backwards");
    w.close();
});

test("a cancelled run returns nothing", async () => {
    const w = loadDom();
    const { A, doc, estimator, bot } = scenario(w);
    let calls = 0;
    const res = await A.analyse(doc, { estimator, bot, cancelled: () => ++calls > 2 });
    assert.equal(res, null);
    w.close();
});

test("three players: no win chance, but still the best move per ply", async () => {
    const w = loadDom();
    const A = w.eval("Analysis");
    const doc = docOf({ config: { players: 3 }, history: [0, 5, 10, 1] });
    const played = doc.history;
    // the bot agrees with move 0 and move 2, and wanted something else in between
    const bot = { id: "fake", version: 1, nodes: 100, move: (s) => (s.history.length % 2 === 0 ? played[s.history.length] : 20 + s.history.length) };
    const res = await A.analyse(doc, { estimator: null, bot });

    assert.equal(res.chances, null, "no estimator with more than two players");
    assert.equal(res.moves.length, 4);
    assert.equal(JSON.stringify(res.moves.map((m) => m.player)), "[0,1,2,0]");
    assert.equal(JSON.stringify(res.moves.map((m) => m.loss)), "[null,null,null,null]");
    assert.equal(JSON.stringify(res.moves.map((m) => m.perfect)), "[true,false,true,false]");
    assert.equal(res.scores.length, 3);
    assert.equal(res.scores[0].score, 50, "one of two moves was the bot's: accuracy alone");
    assert.equal(res.scores[0].avgLoss, null);
    assert.equal(A.verdict(res.moves[1]).text, "Best was 21", "without a win chance there is nothing to lose");
    w.close();
});

test("an illegal or missing bot answer is left out of the score", async () => {
    const w = loadDom();
    const A = w.eval("Analysis");
    const doc = docOf();
    const bot = { id: "fake", version: 1, nodes: 100, move: () => 999 };     // never on the board
    const res = await A.analyse(doc, { estimator: null, bot });
    assert.equal(JSON.stringify(res.moves.map((m) => m.best)), "[null,null,null,null]");
    assert.equal(JSON.stringify(res.moves.map((m) => m.perfect)), "[null,null,null,null]");
    assert.equal(res.scores[0].moves, 0);
    assert.equal(res.scores[0].score, null);
    assert.equal(A.verdict(res.moves[0]).text, "Not analysed");
    w.close();
});

test("the cache keeps a result and drops it when the bot or the budget changed", async () => {
    const w = loadDom();
    const A = w.eval("Analysis");
    const res = { game: "five", players: 2, nodes: 50, bot: { id: "fake", version: 2, nodes: 100 }, chances: [0.5, 0.6], moves: [], scores: [], partial: false };
    const stamp = { bot: "fake", version: 2, nodes: 50, botNodes: 100 };

    assert.equal(await A.store("game-1", res), true);
    assert.equal(JSON.stringify(await A.load("game-1", stamp)), JSON.stringify(res), "the same stamp gets the result back");
    assert.equal(await A.load("game-1", { ...stamp, version: 3 }), null, "a new bot version invalidates it");
    assert.equal(await A.load("game-1", { ...stamp, bot: "other" }), null, "another bot invalidates it");
    assert.equal(await A.load("game-1", { ...stamp, nodes: 12000 }), null, "another win-chance budget invalidates it");
    assert.equal(await A.load("game-1", { ...stamp, botNodes: 2000 }), null, "another search budget invalidates it");
    assert.equal(await A.load("nothing-here", stamp), null);

    // a run that stopped early is never cached (it would be a different game every time)
    assert.equal(await A.store("game-2", { ...res, partial: true }), false);
    assert.equal(await A.load("game-2", stamp), null);

    // …and the stamp a fresh run would use names the game's own bot
    const s = A.stampFor(docOf());
    assert.equal(s.nodes, A.NODES);
    assert.equal(typeof s.bot, "string");
    assert.ok(s.bot.length > 0, "Five Wins has a bot to analyse with");
    w.close();
});

test("Play / Pause steps to the end and starts over at the last move", () => {
    const w = loadDom();
    const R = w.eval("Replays");
    // fake timers: one pending callback at a time, fired by hand
    let pending = null, id = 0;
    const setTimer = (fn) => { pending = fn; return ++id; };
    const clearTimer = () => { pending = null; };
    const fire = () => { const fn = pending; pending = null; if (fn) fn(); };

    let ply = 0;
    const total = 4;
    const seen = [];
    const p = R.playback({ ply: () => ply, total: () => total, seek: (v) => { ply = v; seen.push(v); }, setTimer, clearTimer });

    assert.equal(p.playing, false);
    assert.equal(p.start(), true);
    assert.equal(p.playing, true);
    fire(); fire();
    assert.deepEqual(seen, [1, 2]);
    assert.equal(p.playing, true, "still playing in the middle of the game");

    p.stop();
    assert.equal(p.playing, false);
    assert.equal(pending, null, "Pause drops the timer");
    fire();
    assert.deepEqual(seen, [1, 2], "a stopped player never steps again");

    p.start();
    fire(); fire();
    assert.deepEqual(seen, [1, 2, 3, 4]);
    assert.equal(p.playing, false, "reaching the last move stops by itself");
    assert.equal(pending, null);

    // pressing Play at the end starts over from the first move
    p.start();
    assert.equal(ply, 0);
    assert.equal(p.playing, true);
    assert.equal(p.toggle(), false, "toggle pauses a running player");
    assert.equal(p.playing, false);
    w.close();
});
