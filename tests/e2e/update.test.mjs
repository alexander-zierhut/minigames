/* New version detection (#40) in a real browser: the dev page never polls, a newer
   version.json shows the notice on the title screen only, and an idle title screen
   reloads by itself. The version document comes from a data: URL, so no file has to be
   written next to index.html. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
const NEWER = 'data:application/json,{"version":"zzz 2999-01-01"}';

before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await server?.close(); });

test("the unbundled dev page never asks for version.json", async () => {
    assert.equal(await B.ev("Update.current"), "dev");
    assert.equal(await B.ev("Update.available"), false);
    assert.equal(await B.ev("document.getElementById('update-notice').hidden"), true);
    assert.ok(!B.requests.some((u) => /version\.json/.test(u)), `no version.json request (${B.requests.filter((u) => /version/.test(u))})`);
});

test("a newer version shows the notice, but only on the title screen", async () => {
    // count the reloads instead of doing them, and keep the automatic one far away for now
    await B.ev(`window.__reloads = 0; Update.AUTO_MS = 600000; Update.init({ url: ${JSON.stringify(NEWER)}, current: "old 2026-09-10", reload: () => { window.__reloads++; }, onTitle: () => document.querySelector('.screen:not([hidden])').id === 'screen-menu' })`);
    await B.ev("Update.check()");                     // init polls by itself; this only makes the wait short
    await B.waitFor("Update.available", { timeout: 8000, what: "the new version is noticed" });
    assert.equal(await B.ev("Update.latest"), "zzz 2999-01-01");
    assert.equal(await B.ev("document.getElementById('update-notice').hidden"), false, "notice on the title screen");
    // in the lobby it is gone (a game or a lobby is never interrupted)
    await B.click("#btn-local");
    assert.equal(await B.screen(), "screen-lobby");
    assert.equal(await B.ev("document.getElementById('update-notice').hidden"), true, "no notice in the lobby");
    await B.click("#btn-lobby-back");
    assert.equal(await B.screen(), "screen-menu");
    assert.equal(await B.ev("document.getElementById('update-notice').hidden"), false, "back on the title screen");
});

test("an idle title screen reloads itself once", async () => {
    await B.ev("Update.AUTO_MS = 400; Update.screenChanged(); true");
    await B.waitFor("window.__reloads === 1", { timeout: 8000, what: "automatic reload" });
    await B.ev("Update.screenChanged(); true");
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await B.ev("window.__reloads"), 1, "never a second time");
    assert.deepEqual(B.errors, [], "no page exceptions");
});

test("the title screen with the notice still fits a 360x780 phone", async () => {
    await B.emulate(360, 780);
    await B.ev("Update.AUTO_MS = 600000; Update.screenChanged(); true");   // keep the notice up while measuring
    assert.equal(await B.ev("document.getElementById('update-notice').hidden"), false);
    const s = await B.noScroll();
    assert.ok(s.x && s.y && s.screen, `no scrolling with the notice ${JSON.stringify(s)}`);
    assert.ok(await B.ev("(() => { const c = document.querySelector('#screen-menu .menu-card'); return c.scrollHeight <= c.clientHeight + 1; })()"), "the menu card itself does not scroll");
    const btn = JSON.parse(await B.ev("(() => { const r = document.getElementById('btn-update-reload').getBoundingClientRect(); return JSON.stringify({ left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) }); })()"));
    assert.ok(btn.left >= 0 && btn.right <= 360 && btn.bottom <= 780, `Reload button inside the viewport ${JSON.stringify(btn)}`);
    await B.screenshot("update-notice-mobile.png");
});
