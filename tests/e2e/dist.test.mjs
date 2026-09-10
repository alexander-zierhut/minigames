/* The built bundle must behave like the source: hashed assets, preloader, a playable game. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, launchBrowser, ROOT, sleep } from "./harness.mjs";

let server, B, dist;
before(async () => {
    dist = mkdtempSync(join(tmpdir(), "minigames-e2e-dist-"));
    execFileSync("node", [join(ROOT, "build.mjs")], { env: { ...process.env, DIST_DIR: dist }, stdio: "pipe" });
    server = await startServer(dist + "/");
    B = await launchBrowser();
});
after(async () => { await B?.close(); await server?.close(); rmSync(dist, { recursive: true, force: true }); });

test("built site loads only hashed assets, preloads textures, plays", async () => {
    await B.goto(server.url);
    const urls = B.requests.filter((u) => u.startsWith(server.url));
    assert.ok(urls.some((u) => /\/assets\/app\.[0-9a-f]{10}\.js$/.test(u)), "hashed bundle requested");
    assert.ok(urls.some((u) => /\/assets\/main\.[0-9a-f]{10}\.css$/.test(u)), "hashed css requested");
    assert.ok(!urls.some((u) => u.includes("/client/")), "nothing from client/ requested");
    const pngs = urls.filter((u) => u.includes("/assets/textures/") && u.endsWith(".png"));   // the manifest's icons are fetched too, unhashed by design
    assert.ok(pngs.length >= 10, `textures preloaded before any click (${pngs.length})`);
    assert.ok(pngs.every((u) => /\.[0-9a-f]{10}\.png$/.test(u)), "textures are hashed");
    assert.equal(await B.ev("document.getElementById('loader').hidden"), true);
    await B.selectSkin("mc");
    await B.click("#btn-local"); await B.selectGame("chain");
    await B.click("#btn-settings"); await B.set("set-size", 3); await B.set("set-speed", 350); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    await B.ev("window.dispatchEvent(new PointerEvent('pointerdown')); true");   // unlock audio: the mc set fetches its sound files
    const r = await B.randomGame();
    assert.equal(r.over, true);
    for (let k = 0; k < 100 && !B.requests.some((u) => u.endsWith(".ogg")); k++) await sleep(100);
    const oggs = B.requests.filter((u) => u.endsWith(".ogg"));
    assert.ok(oggs.length >= 8, `sound files fetched from the built site (${oggs.length})`);
    assert.ok(oggs.every((u) => /\/assets\/sounds\/[a-z0-9_]+\.[0-9a-f]{10}\.ogg$/.test(u)), "sounds are hashed");
    assert.ok(!B.requests.some((u) => u.includes("/client/")), "still nothing from client/");
    assert.deepEqual(B.errors, []);
    assert.deepEqual(B.failedRequests, []);
    await B.selectSkin("classic");
});
