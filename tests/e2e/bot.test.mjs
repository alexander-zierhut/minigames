/* Offline "Against a bot": one bot per game (#21) in a one-step modal, a game where the bot
   moves on its own, rematch, back to the menu. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, sleep } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.ev("Prefs.set({ name: 'Alex' })"); });
after(async () => { await B?.close(); await server?.close(); });

const myTurn = () => B.waitFor("!ChainGame.state.busy && !FiveGame.state.busy && (document.body.classList.contains('game-five') ? FiveGame : ChainGame).state.current === 0 || (document.body.classList.contains('game-five') ? FiveGame : ChainGame).state.over", { timeout: 20000, what: "my turn or game over" });

test("bot lobby: sane default (middle level), the one-step modal with scores and difficulty, Cancel keeps the choice, Play changes it", async () => {
    await B.click("#btn-bot");
    assert.equal(await B.screen(), "screen-lobby");
    assert.equal(await B.text("lobby-kind"), "Against a bot");
    assert.equal(await B.ev("document.getElementById('btn-opponent').hidden"), false);
    await B.selectGame("five");
    assert.equal(await B.ev("document.getElementById('bot-modal').hidden"), true, "picking a game does not open the modal (#12)");
    assert.match(await B.text("opponent-summary"), /^Bot · Normal · 100 % vs Random · 100 % puzzles$/, "default: the game's bot at its middle level, called Bot");
    await B.click("#btn-opponent");
    assert.equal(await B.ev("document.getElementById('bot-modal').hidden"), false);
    assert.equal(await B.ev("document.querySelectorAll('.bot-option, #bot-step-list').length"), 0, "no list step any more");
    assert.equal(await B.text("bot-name"), "Bot");
    assert.match(await B.ev("document.querySelector('#bot-badges .bot-badge').textContent"), /\d+(\.\d+)? % vs Random/, "benchmark score baked in");
    assert.equal(await B.ev("document.getElementById('bot-difficulty-row').hidden"), false);
    assert.equal(await B.ev("document.querySelectorAll('#bot-difficulty button').length"), 4);
    assert.equal(await B.ev("document.querySelector('#bot-difficulty button.selected').dataset.difficulty"), "normal");
    await B.click('#bot-difficulty button[data-difficulty="easy"]');
    assert.equal(await B.text("bot-difficulty-hint"), "Easy: searches up to 2\u202f000 positions per move.");
    assert.equal(await B.ev("document.getElementById('bot-meta')"), null, "no rating boilerplate");
    await B.click("#btn-bot-cancel");
    assert.equal(await B.ev("document.getElementById('bot-modal').hidden"), true);
    assert.match(await B.text("opponent-summary"), /^Bot · Normal · /, "Cancel keeps the old level");
    await B.click("#btn-opponent");
    await B.click('#bot-difficulty button[data-difficulty="easy"]');
    await B.click("#btn-bot-done");
    assert.equal(await B.ev("document.getElementById('bot-modal').hidden"), true);
    assert.match(await B.text("opponent-summary"), /^Bot · Easy · [\d.]+ % vs Random · [\d.]+ % puzzles$/);
    assert.equal(await B.ev("JSON.parse(localStorage.getItem('chainreact.bots')).five.difficulty"), "easy", "remembered per game");
});

test("five wins against the bot (Easy): it moves by itself, the HUD calls it Bot, the game ends", async () => {
    await B.click("#btn-settings"); await B.setting("size", 6); await B.setting("winlen", 4); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.text("p1-name"), "Bot");
    assert.equal(await B.text("p0-name"), "Alex", "my own name on my seat (#35)");
    await B.waitFor("[...document.querySelectorAll('#react-layer .react-float.theirs')].some(e => e.textContent === '👋')", { timeout: 5000, what: "the bot waves at the start (#14)" });
    // I take free cells top to bottom; the bot answers; the game ends by a line or a full / dead board
    for (let k = 0; k < 60; k++) {
        await myTurn();
        const st = await B.state();
        if (st.over) break;
        const free = st.cells.map((c, i) => (c === -1 ? i : -1)).filter((i) => i >= 0);
        await B.cell(free[k % 2 === 0 ? 0 : Math.floor(free.length / 2)]);
        await B.idle();
    }
    const st = await B.state();
    assert.ok(st.movesBy[1] > 0, "the bot made moves");
    assert.equal(st.over, true);
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    // developer info (#31): the panel shows what the bot calculated for its last move
    assert.equal(await B.ev("document.getElementById('dev-panel').hidden"), true, "off by default");
    await B.click("#prefs-btn"); await B.check("pref-developer", true); await B.click("#btn-prefs-done");
    // (the expression is evaluated in the page, so the regex escapes are doubled here)
    await B.waitFor("!document.getElementById('dev-panel').hidden && /BOT\\n  sensei-five · easy · budget 2 000 nodes\\n  last: cell \\d+ · [\\d ]+ nodes · depth \\d+ · value /.test(document.getElementById('dev-panel').textContent)", { timeout: 20000, what: "bot section in the dev panel" });
    assert.match(await B.text("dev-panel"), /NETWORK\n  offline/);
    assert.match(await B.text("dev-panel"), /\d+ fps/);
    assert.equal(await B.ev("getComputedStyle(document.getElementById('dev-panel')).pointerEvents"), "none", "never in the way of a tap");
    await B.click("#prefs-btn"); await B.check("pref-developer", false); await B.click("#btn-prefs-done");
    assert.equal(await B.ev("document.getElementById('dev-panel').hidden"), true);
});

test("rematch alternates the starter; the bot opens when it starts; back to menu", async () => {
    await B.click("#overlay-again");
    await sleep(100);
    assert.equal((await B.state()).current, 1, "game 2: the bot (seat 1) starts");
    await B.waitFor("FiveGame.state.history.length === 1", { what: "bot opened the game" });
    await B.idle();
    assert.equal((await B.state()).current, 0);
    await B.click("#btn-menu");
    assert.equal(await B.screen(), "screen-lobby");
    await B.click("#btn-lobby-back");
    assert.equal(await B.screen(), "screen-menu");
    await sleep(600);                                          // a stale bot timer must not fire into the menu
    assert.deepEqual(B.errors, []);
    // both games are in the replays list (#42): the finished one and the one left half way
    await B.click("#btn-replays");
    await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length === 2", { what: "both bot games saved" });
    const subs = await B.ev("[...document.querySelectorAll('#replay-list .replay-sub')].map(e => e.textContent).join(' | ')");
    assert.match(subs, /Alex vs Bot/, "the bot seat is called Bot in the replay");
    assert.match(subs, /Unfinished/, "the game left through Back to room is kept as unfinished");
    await B.click("#btn-replays-back");
    assert.equal(await B.screen(), "screen-menu");
});

// a cell clicked while the bot is thinking: marked, announced in the turn hint and played
// the moment the bot has moved; clicking it again takes it back (#37)
const premoveWhileBotThinks = (cells) => B.ev(`(async () => {
    const wait = (test) => new Promise(r => { const t = setInterval(() => { if (test()) { clearInterval(t); r(); } }, 10); });
    const stones = () => document.querySelectorAll('#board > .stone');
    await wait(() => FiveGame.state.current === 1 && !FiveGame.state.busy);      // the bot is thinking
    for (const i of ${JSON.stringify(cells)}) stones()[i].click();
    const last = ${JSON.stringify(cells)}[${cells.length - 1}];
    return JSON.stringify({ pre: Match.premove, cls: stones()[last].className, hint: document.getElementById('turn-hint').textContent, moves: FiveGame.state.history.length });
})()`).then(JSON.parse);

test("premove (#37): a cell clicked while the bot thinks is marked and played right after the bot's move; a second click takes it back", async () => {
    await B.click("#btn-bot");
    await B.click("#btn-start");
    assert.equal((await B.state()).current, 0, "I start this game");
    await B.cell(0);                                           // my move, then the bot thinks
    const set = await premoveWhileBotThinks([35]);
    assert.equal(set.pre, 35, "the click is remembered");
    assert.match(set.cls, /\bpremove\b/, "the cell is marked");
    assert.match(set.hint, /^thinking… · premove set$/);
    assert.equal(set.moves, 1, "nothing played yet");
    await B.waitFor("FiveGame.state.history.length === 3 && Match.premove === -1", { timeout: 20000, what: "the bot moved and my premove followed" });
    assert.equal((await B.state()).history[2], 35, "my premoved cell");
    assert.equal((await B.ev("document.querySelectorAll('#board > .stone')[35].className")).includes("premove"), false);
    // the same cell twice takes the premove back: only the bot's move follows
    const back = await premoveWhileBotThinks([34, 34]);
    assert.equal(back.pre, -1, "taken back");
    assert.equal(back.cls.includes("premove"), false);
    assert.doesNotMatch(back.hint, /premove/);
    await B.waitFor("FiveGame.state.history.length === 4", { timeout: 20000, what: "the bot moved" });
    await B.idle();
    await sleep(400);
    assert.equal((await B.state()).history.length, 4, "my cancelled premove was not played");
    assert.equal((await B.state()).current, 0, "still my move");
    assert.deepEqual(B.errors, []);
});
