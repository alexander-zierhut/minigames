import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.ev("Prefs.set({ name: 'Alex' })"); });
after(async () => { await B?.close(); await server?.close(); });

async function startChain() {
    if (await B.screen() !== "screen-lobby") { if (await B.screen() === "screen-game") await B.click("#btn-menu"); else await B.click("#btn-local"); }
    await B.selectGame("chain"); await B.click("#btn-settings"); await B.setting("size", 4); await B.set("set-speed", 350); await B.click("#btn-settings-done");
    await B.click("#btn-start");
}

test("classic: dots, turn outline, static last marker", async () => {
    await B.selectSkin("classic");
    await startChain();
    assert.equal(await B.text("p0-name"), "Alex", "the name is mine, not the look's (#35)");
    assert.ok(await B.ev("document.getElementById('board').classList.contains('turn-p0')"));
    assert.equal(await B.ev("getComputedStyle(document.getElementById('board')).outlineColor"), "rgb(53, 213, 229)");
    await B.move(5);
    await new Promise((r) => setTimeout(r, 400));   // outline colour transitions for .25s
    assert.equal(await B.ev("getComputedStyle(document.getElementById('board')).outlineColor"), "rgb(255, 166, 43)", "outline switches to the other colour");
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.cell.last .last-marker')).animationName"), "none");
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.tile.lamp'), '::after').backgroundImage"), "none", "no textures in classic");
});

test("Blocks board: textures on the board, classic UI, the names do not change with the look", async () => {
    const before = [await B.text("p0-name"), await B.text("p1-name")];
    await B.selectSkin("mcboard");
    assert.deepEqual([await B.text("p0-name"), await B.text("p1-name")], before, "switching the look leaves the names alone (#35)");
    assert.equal(await B.text("p0-name"), "Alex");
    assert.match(await B.ev("getComputedStyle(document.querySelector('.tile.glass')).backgroundImage"), /textures\/glass_white/);
    assert.match(await B.ev("getComputedStyle(document.querySelector('.cell.p0 .center')).backgroundImage"), /diamond_block/);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.btn')).borderRadius"), "10px", "UI stays classic");
});

test("Minecraft: full UI restyle, no rounded corners, unified dark panels", async () => {
    await B.selectSkin("mc");
    assert.ok(await B.ev("document.body.classList.contains('skin-mc')"));
    assert.equal(await B.ev("getComputedStyle(document.getElementById('btn-restart')).borderRadius"), "0px");
    assert.match(await B.ev("getComputedStyle(document.getElementById('hut')).backgroundImage"), /planks_big_oak/);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.turn-name')).color"), "rgb(255, 255, 255)");
    await B.click("#btn-menu");
    assert.match(await B.ev("getComputedStyle(document.querySelector('.menu-card')).backgroundImage"), /planks_big_oak/);
});

test("five wins on MC: quartz tiles, red last marker, hover keeps the texture", async () => {
    await B.selectGame("five"); await B.click("#btn-settings"); await B.setting("size", 9); await B.setting("winlen", 5); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.match(await B.ev("getComputedStyle(document.querySelector('.stone')).backgroundImage"), /quartz_block_side/);
    await B.move(40);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.stone.last .last-marker')).borderTopColor"), "rgb(255, 45, 45)");
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.stone')).transitionProperty"), "filter", "no background transition (hover flicker)");
    await B.click("#btn-menu");
    await B.selectSkin("classic");
    assert.deepEqual(B.errors, []);
});
