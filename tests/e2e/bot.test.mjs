/* Offline "Play against a bot": pick a bot in the modal, play a game where the bot moves
   on its own, rematch, back to the menu. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, sleep } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await server?.close(); });

const myTurn = () => B.waitFor("!ChainGame.state.busy && !FiveGame.state.busy && (document.body.classList.contains('game-five') ? FiveGame : ChainGame).state.current === 0 || (document.body.classList.contains('game-five') ? FiveGame : ChainGame).state.over", { timeout: 20000, what: "my turn or game over" });

test("bot lobby: opponent row, picking a game opens the bot picker with score and difficulty", async () => {
    await B.click("#btn-bot");
    assert.equal(await B.screen(), "screen-lobby");
    assert.equal(await B.text("lobby-kind"), "Against a bot");
    assert.equal(await B.ev("document.getElementById('btn-opponent').hidden"), false);
    await B.selectGame("five");
    assert.equal(await B.ev("document.getElementById('bot-modal').hidden"), false, "picking a game asks for the bot");
    assert.equal(await B.text("bot-modal-game"), "Five Wins");
    assert.equal(await B.ev("document.querySelectorAll('.bot-option').length"), 1);
    assert.match(await B.ev("document.querySelector('.bot-option .bot-score').textContent"), /\d+(\.\d+)? %vs Random/, "benchmark score baked in");
    assert.equal(await B.ev("document.getElementById('bot-difficulty-row').hidden"), true, "single difficulty: no control");
    await B.click("#btn-bot-done");
    assert.equal(await B.ev("document.getElementById('bot-modal').hidden"), true);
    assert.match(await B.text("opponent-summary"), /^Random · [\d.]+ % vs Random( · [\d.]+ % puzzles)?$/);
});

test("five wins against Random: the bot moves by itself, HUD shows its name, game ends", async () => {
    await B.click("#btn-settings"); await B.set("set-size", 6); await B.set("set-winlen", 4); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.text("p1-name"), "Random");
    assert.equal(await B.text("p0-name"), "Cyan");
    // I take the top row cell by cell; the bot answers; 4 in a row wins unless the bot blocks by luck
    for (let k = 0; k < 20; k++) {
        await myTurn();
        const st = await B.state();
        if (st.over) break;
        const free = st.cells.map((c, i) => (c === -1 ? i : -1)).filter((i) => i >= 0);
        await B.cell(free[0]);
        await B.idle();
    }
    const st = await B.state();
    assert.ok(st.movesBy[1] > 0, "the bot made moves");
    assert.equal(await B.ev("document.querySelectorAll('.stone.locked').length > 0 || FiveGame.state.over"), true);
    for (let k = 0; k < 40 && !(await B.state()).over; k++) { await myTurn(); const s = await B.state(); if (s.over) break; const free = s.cells.map((c, i) => (c === -1 ? i : -1)).filter((i) => i >= 0); await B.cell(free[Math.floor(free.length / 2)]); await B.idle(); }
    assert.equal((await B.state()).over, true);
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
