/* Offline "Against a bot": one bot per game (#21) in a one-step modal, a game where the bot
   moves on its own, rematch, back to the menu. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, sleep } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
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
    await B.click("#btn-settings"); await B.set("set-size", 6); await B.set("set-winlen", 4); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.text("p1-name"), "Bot");
    assert.equal(await B.text("p0-name"), "Cyan");
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
});
