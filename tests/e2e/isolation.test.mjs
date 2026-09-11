/* Isolation end to end: pick the game, the two-step click (including taking it back), a
   whole seeded game to a trap, the overlay and the replay bar, three players on one device
   with a seat that gets trapped, and the bot playing by itself. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await server?.close(); });

const slabs = "#board > .slab";
const click = (i) => B.ev(`document.querySelectorAll('${slabs}')[${i}].click(); true`);
const cls = (i) => B.ev(`document.querySelectorAll('${slabs}')[${i}].className`);
const steps = () => B.ev("JSON.stringify(IsolationRules.steps(IsolationGame.state, IsolationGame.state.current))").then(JSON.parse);

/* one two-step move: step onto `to`, break `removed`, wait for the animation */
async function play(to, removed) {
    await click(to);
    await click(removed);
    await B.idle();
}

/* a seeded random game played the way a person plays it: two clicks per move */
async function randomGame(seed = 4242, maxMoves = 300) {
    return JSON.parse(await B.ev(`(async () => {
        const G = IsolationGame, R = IsolationRules, rnd = Bots.rng(${seed});
        const slabs = () => document.querySelectorAll('${slabs}');
        let m = 0;
        while (!G.state.over && m < ${maxMoves}) {
            const s = G.state, p = s.current, size = s.cells.length;
            const legal = R.legalMoves(s, p);
            const pick = legal[Math.floor(rnd() * legal.length)];
            slabs()[Math.floor(pick / size)].click();
            slabs()[pick % size].click();
            m++;
            await new Promise(r => { const t = setInterval(() => { if (!G.state.busy) { clearInterval(t); r(); } }, 25); });
        }
        return JSON.stringify({ over: G.state.over, moves: m, winner: G.state.winner, why: G.state.finishWhy });
    })()`));
}

test("the lobby lists Isolation and starts it with the default 7 × 7 board", async () => {
    await B.click("#btn-local");
    assert.equal(await B.screen(), "screen-lobby");
    assert.match(await B.ev(`document.querySelector('.game-card[data-game="isolation"]').textContent`), /Isolation/);
    await B.selectGame("isolation");
    assert.equal(await B.text("menu-tagline"), "", "no tagline under the picker (an empty line)");
    assert.match(await B.text("settings-summary"), /^7 × 7 · no timer$/);
    assert.equal(await B.ev("[...document.querySelectorAll('#game-settings .row')].every(r => r.hidden)"), true, "no game rows of its own");
    await B.click("#btn-settings");
    await B.setting("size", 6);
    await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.text("sign-title"), "ISOLATION");
    assert.equal(await B.ev(`document.querySelectorAll('${slabs}').length`), 36);
    assert.equal(await B.ev(`document.querySelectorAll('${slabs}.taken').length`), 2, "one pawn per seat");
    const st = await B.state();
    assert.equal(JSON.stringify(st.pawns), "[3,33]", "top and bottom edge");
    assert.match(await B.text("p0-stat-1"), /^\d$/, "free moves in the HUD");
});

test("the two-step click: pick a step, pick a tile to break, take it back, play it", async () => {
    const [to] = await steps();
    assert.ok((await cls(to)).includes("can-place"), "the steps are highlighted");
    await click(to);
    assert.ok((await cls(to)).includes("pending"), "the first click marks the step");
    assert.equal(await B.ev("IsolationView.pending"), to);
    assert.equal((await B.state()).history.length, 0, "nothing is played yet");
    // now the breakable tiles are the highlighted ones, and a hole is not among them
    const breakable = await B.ev(`[...document.querySelectorAll('${slabs}')].filter(e => e.classList.contains('can-place')).length`);
    assert.ok(breakable > 20, `every free tile can be broken (${breakable})`);
    await click(to);
    assert.equal(await B.ev("IsolationView.pending"), -1, "clicking it again takes the choice back");
    assert.ok(!(await cls(0)).includes("pending"));
    assert.equal(await B.ev(`[...document.querySelectorAll('${slabs}')].filter(e => e.classList.contains('can-place')).length`), (await steps()).length, "back to the steps");
    // a tile the pawn cannot reach does nothing on the first click
    const far = await B.ev("IsolationGame.state.cells.findIndex((c, i) => c === -1 && !IsolationRules.steps(IsolationGame.state, 0).includes(i))");
    await click(far);
    assert.equal(await B.ev("IsolationView.pending"), -1);
    // the real move
    await play(to, far);
    const st = await B.state();
    assert.equal(st.history.length, 1);
    assert.equal(st.cells[far], -2, "the broken tile is a hole");
    assert.equal(st.pawns[0], to);
    assert.equal(st.current, 1);
    assert.ok((await cls(far)).includes("hole"));
    assert.ok((await cls(to)).includes("last"), "the marker sits on the tile stepped onto");
    assert.equal(await B.ev(`document.querySelectorAll('${slabs}.last').length`), 1);
});

test("a whole game ends in a trap, with the overlay and the replay bar", async () => {
    const r = await randomGame();
    assert.equal(r.over, true, `the game finishes (${r.moves} moves)`);
    assert.ok(r.winner === 0 || r.winner === 1);
    assert.match(r.why, /Trapped!/);
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    assert.match(await B.text("overlay-title"), /wins!$/);
    assert.match(await B.text("overlay-sub"), /Trapped!/);
    assert.match(await B.text("overlay-sub"), /moves/);
    assert.ok(await B.ev("document.getElementById('board').classList.contains('over')"));
    // the replay bar walks the same game, and a click in a preview plays nothing
    await B.click("#overlay-look");
    const moves = (await B.state()).history.length;
    assert.equal(await B.text("replay-pos"), `Move ${moves} / ${moves}`);
    await B.click("#replay-first");
    assert.equal(await B.ev("IsolationGame.previewPly"), 0);
    assert.equal(await B.ev(`document.querySelectorAll('${slabs}.hole').length`), 0, "no broken tiles at the start");
    assert.equal(await B.ev(`document.querySelectorAll('${slabs}.can-place').length`), 0, "a preview is never playable");
    await click(3);
    assert.equal((await B.state()).history.length, moves, "the finished game is untouched");
    await B.click("#replay-next");
    assert.equal(await B.ev(`document.querySelectorAll('${slabs}.hole').length`), 1, "one broken tile after one move");
    await B.click("#replay-last");
    assert.equal(await B.ev("IsolationGame.previewPly"), null);
    await B.click("#result-fab");
    await B.click("#overlay-again");
    const st = await B.state();
    assert.equal(st.history.length, 0);
    assert.equal(st.current, 1, "the second game starts with the other seat");
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), true);
});

test("three players on one device: a trapped seat is out and the rest play on", async () => {
    await B.click("#btn-menu");
    await B.players(3);
    await B.click("#btn-settings"); await B.setting("size", 5); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.ev("document.querySelectorAll('#players .player').length"), 3);
    const st = await B.state();
    assert.equal(st.players, 3);
    assert.equal(JSON.stringify(st.pawns), "[2,22,10]", "top, bottom and left edge");
    const r = await randomGame(7);
    assert.equal(r.over, true);
    const end = await B.state();
    assert.equal(end.trapped.filter(Boolean).length, 2, "two seats got trapped, one is left");
    assert.equal(end.trapped[end.winner], false);
    assert.match(await B.text("overlay-sub"), /Everyone else is trapped\./);
    assert.equal(await B.text(`p${end.trapped.indexOf(true)}-stat-1`), "trapped", "the HUD says who is out");
});

test("against a bot: the bot plays Isolation by itself", async () => {
    await B.click("#overlay-menu");
    await B.click("#btn-lobby-back");
    await B.click("#btn-bot");
    assert.equal(await B.text("lobby-kind"), "Against a bot");
    await B.selectGame("isolation");
    assert.match(await B.text("btn-opponent"), /Bot/);
    await B.click("#btn-settings"); await B.setting("size", 6); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.text("p1-name"), "Bot");
    const [to] = await steps();
    const far = await B.ev("IsolationGame.state.cells.findIndex((c, i) => c === -1 && !IsolationRules.steps(IsolationGame.state, 0).includes(i))");
    await play(to, far);
    await B.waitFor("IsolationGame.state.history.length >= 2 && !IsolationGame.state.busy", { timeout: 30000, what: "the bot moved" });
    const st = await B.state();
    assert.equal(st.movesBy[1], 1, "the bot answered by itself");
    assert.equal(st.current, 0, "and it is my turn again");
    assert.deepEqual(B.errors, [], "no page errors");
    assert.deepEqual(B.failedRequests, [], "no failed requests");
});
