/* Three and four people on one device: the players setting, lobby summary, HUD cards,
   turn rotation and the alternating starter, Chain React elimination, all skins. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.click("#btn-local"); });
after(async () => { await B?.close(); await server?.close(); });

test("four on one device: settings row, summary, four HUD cards, rotation, no win chance", async () => {
    await B.selectGame("five");
    await B.click("#btn-settings");
    assert.equal(await B.ev("document.getElementById('row-players').hidden"), false);
    await B.set("set-players", 4); await B.set("set-size", 7); await B.set("set-winlen", 4);
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /^7 × 7 · 4 players · 4 in a row/);
    await B.click("#btn-start");
    assert.equal(await B.ev("document.querySelectorAll('#players .player').length"), 4);
    assert.equal(await B.ev("document.getElementById('p0-win-row').hidden"), true, "win chance only for two players");
    assert.equal(await B.text("p2-name"), "Lime"); assert.equal(await B.text("p3-name"), "Rose");
    for (const i of [0, 1, 2, 3, 7]) await B.move(i);
    const st = await B.state();
    assert.equal(st.current, 1); assert.equal(JSON.stringify(st.movesBy), "[2,1,1,1]");
    assert.ok(await B.ev("document.getElementById('board').classList.contains('turn-p1')"));
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.stone.p3')).display"), "block");
    // seat 0 completes a diagonal of four while the others fill a row each
    for (const i of [8, 9, 10, 14, 15, 16, 17, 21]) await B.move(i);
    assert.equal((await B.state()).winner, 0);
    assert.match(await B.text("overlay-title"), /Cyan wins!/);
    await B.click("#overlay-again");
    assert.equal((await B.state()).current, 1, "game 2: the next seat starts");
    await B.click("#btn-menu");
});

test("three on one device in Chain React: elimination by the rules, MC skin blocks for seats 2 and 3", async () => {
    await B.selectGame("chain");
    await B.click("#btn-settings"); await B.set("set-players", 3); await B.set("set-size", 3); await B.set("set-speed", 350); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal((await B.state()).players, 3);
    assert.equal(await B.ev("document.querySelectorAll('#players .player').length"), 3);
    await B.selectSkin("mc");
    const start = (await B.state()).current;                    // game 3 in this lobby: seat 2 starts
    const s = (k) => (start + k) % 3;
    await B.move(8); await B.move(1); await B.move(4);          // s0 corner, s1 edge, s2 centre
    assert.match(await B.ev("getComputedStyle(document.querySelector('.cell.p2 .center')).backgroundImage"), /emerald_block/);
    await B.move(8); await B.move(1); await B.move(4); await B.move(8);   // s0's corner explodes twice
    await B.move(1);                                            // s1's edge explodes and converts s2's centre
    const st = await B.state();
    assert.equal(st.cells[4].owner, s(1));
    assert.equal(st.current, s(0), "s2 owns nothing after having moved: skipped");
    assert.equal(await B.text("turn-name"), ["Diamond", "Gold", "Emerald"][s(0)]);
    await B.selectSkin("classic");
    await B.click("#btn-menu");
    await B.click("#btn-settings"); await B.set("set-players", 2); await B.click("#btn-settings-done");
    assert.deepEqual(B.errors, []);
});

test("against a bot the players row is hidden and the game is two players", async () => {
    await B.click("#btn-lobby-back");
    await B.click("#btn-bot");
    await B.click("#btn-settings");
    assert.equal(await B.ev("document.getElementById('row-players').hidden"), true);
    await B.click("#btn-settings-done");
    assert.equal(await B.ev("Settings.read().players"), 2);
    await B.click("#btn-lobby-back");
});
