#!/usr/bin/env node
/* Screenshot tour for visual checks: title, bot picker, lobby, every game (with a few moves
   so the HUD, win chance and last-move marker show), result overlay — for every skin, on a
   desktop and a phone viewport. Writes PNGs to scripts/../tests/e2e/shots/ (git-ignored) or
   $E2E_SHOTS.   node scripts/screenshots.mjs [tag]   (tag prefixes the file names, e.g. "before") */
import { startServer, launchBrowser, sleep } from "../tests/e2e/harness.mjs";

const tag = process.argv[2] || "shot";
const server = await startServer();
async function tour(B, view, skins) {
    await B.goto(server.url);
    await B.screenshot(`${tag}-${view}-menu.png`);
    await B.click("#btn-bot"); await B.selectGame("chain"); await sleep(200);
    await B.screenshot(`${tag}-${view}-bot-picker.png`);
    await B.click("#btn-bot-done"); await B.click("#btn-lobby-back");
    for (const skin of skins) {
        await B.selectSkin(skin);
        if (await B.screen() === "screen-menu") await B.click("#btn-local");
        await B.selectGame("chain");
        await B.click("#btn-settings"); await B.set("set-size", 6); await B.set("set-speed", 350); await B.set("set-timer", 60); await B.click("#btn-settings-done");
        if (skin === skins[0]) await B.screenshot(`${tag}-${view}-${skin}-lobby.png`);
        await B.click("#btn-start");
        for (const i of [7, 0, 7, 1, 7, 0, 14]) await B.move(i);
        await sleep(300); await B.screenshot(`${tag}-${view}-${skin}-chain.png`);
        await B.click("#btn-menu"); await B.selectGame("five");
        await B.click("#btn-settings"); await B.set("set-size", 9); await B.set("set-winlen", 5); await B.click("#btn-settings-done");
        await B.click("#btn-start");
        for (const i of [40, 30, 41, 31, 42, 32, 43, 33]) await B.move(i);
        await sleep(300); await B.screenshot(`${tag}-${view}-${skin}-five.png`);
        await B.move(44); await sleep(400); await B.screenshot(`${tag}-${view}-${skin}-overlay.png`);
        await B.click("#overlay-menu");
        await B.selectGame("boxes");
        await B.click("#btn-settings"); await B.set("set-size", 5); await B.click("#btn-settings-done");
        await B.click("#btn-start");
        // a few lines around the top-left boxes so drawn lines, a closed box and the marker show
        for (const i of [0, 5, 30, 31, 1, 36, 6, 37]) await B.move(i);
        await sleep(300); await B.screenshot(`${tag}-${view}-${skin}-boxes.png`);
        await B.click("#btn-menu");
    }
    if (B.errors.length) console.log(view, "page errors:", B.errors);
}
const desk = await launchBrowser({ width: 1400, height: 900 });
await tour(desk, "desk", ["classic", "mcboard", "mc"]);
await desk.close();
const phone = await launchBrowser({ width: 360, height: 780, mobile: true });
await tour(phone, "phone", ["classic", "mc"]);
await phone.close();
await server.close();
console.log("done:", process.env.E2E_SHOTS || "tests/e2e/shots/");
