/* New version detection (#40): the pure compare, the notice on the title screen only,
   the flag surviving until the title screen shows, the automatic reload and silence on
   every kind of failure. Every test closes its window (the poll interval would keep the
   file alive) and counts reloads instead of navigating. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, wait } from "./dom.mjs";

// one jsdom page with a fake version.json answer; `body({ w, U, notice, calls, reloads })`
async function page(answer, body) {
    const w = loadDom();
    const U = w.eval("Update");
    const calls = [];
    const reloads = { n: 0 };
    w.fetch = (url, opts) => {
        calls.push({ url, opts });
        if (typeof answer === "function") return answer(url, opts);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(answer) });
    };
    const start = (opts) => U.init({ current: "old 2026-09-10", reload: () => { reloads.n++; }, ...opts });
    try {
        await body({ w, U, calls, reloads, start, notice: () => w.document.getElementById("update-notice") });
    } finally {
        U.stop();
        w.close();
    }
}

test("isNewer: any two different stamps, never dev, never empty", () => {
    const w = loadDom(); const U = w.eval("Update");
    assert.equal(U.isNewer("abc1234 2026-09-10", "def5678 2026-09-11"), true);
    assert.equal(U.isNewer("abc1234 2026-09-10", "abc1234 2026-09-10"), false, "the same build");
    assert.equal(U.isNewer("abc1234 2026-09-10", " abc1234 2026-09-10 "), false, "whitespace only");
    assert.equal(U.isNewer("dev", "abc1234 2026-09-10"), false, "the unbundled page never compares");
    assert.equal(U.isNewer("abc1234 2026-09-10", "dev"), false);
    assert.equal(U.isNewer("", "abc"), false);
    assert.equal(U.isNewer("abc", ""), false);
    assert.equal(U.isNewer(undefined, "abc"), false);
    assert.equal(U.isNewer("abc", 7), false);
    w.close();
});

test("the dev page never polls", () => page({ version: "new 2026-09-11" }, async ({ U, calls, notice, start }) => {
    start({ current: "dev", onTitle: () => true });
    assert.equal(await U.check(), false);
    assert.equal(calls.length, 0, "no request at all");
    assert.equal(notice().hidden, true);
}));

test("a newer version shows the notice on the title screen", () => page({ version: "new 2026-09-11" }, async ({ U, calls, notice, start }) => {
    start({ url: "version.json", onTitle: () => true });
    assert.equal(await U.check(), true);
    assert.equal(U.available, true);
    assert.equal(U.latest, "new 2026-09-11");
    assert.equal(notice().hidden, false, "the notice is up");
    assert.equal(calls.length, 1, "one shared request, not one per caller");
    assert.equal(calls[0].url, "version.json");
    assert.equal(calls[0].opts.cache, "no-store", "never from the cache");
}));

test("the same version keeps quiet", () => page({ version: "old 2026-09-10" }, async ({ U, notice, start }) => {
    start({ onTitle: () => true });
    assert.equal(await U.check(), false);
    assert.equal(U.available, false);
    assert.equal(notice().hidden, true);
}));

test("the flag waits: found in a game, shown when the title screen comes back", () => page({ version: "new 2026-09-11" }, async ({ U, notice, start }) => {
    let screen = "game";
    start({ onTitle: () => screen === "menu" });
    assert.equal(await U.check(), true, "a check that runs anyway still records it");
    assert.equal(U.available, true);
    assert.equal(notice().hidden, true, "never in a game");
    screen = "lobby";
    U.screenChanged();
    assert.equal(notice().hidden, true, "never in the lobby");
    screen = "menu";
    U.screenChanged();
    assert.equal(notice().hidden, false, "shown on the title screen");
    screen = "lobby";
    U.screenChanged();
    assert.equal(notice().hidden, true, "hidden again when leaving the title screen");
}));

test("the title screen reloads by itself once, and interaction postpones it", () => page({ version: "new 2026-09-11" }, async ({ w, U, notice, reloads, start }) => {
    U.AUTO_MS = 80;
    start({ onTitle: () => true });
    await U.check();
    assert.equal(notice().hidden, false);
    await wait(50);
    w.dispatchEvent(new w.Event("pointerdown"));       // a click restarts the countdown
    await wait(50);
    assert.equal(reloads.n, 0, "an interaction postpones the automatic reload");
    await wait(160);
    assert.equal(reloads.n, 1, "reloaded by itself");
    await wait(160);
    assert.equal(reloads.n, 1, "only once");
}));

test("no automatic reload away from the title screen; the button reloads at once", () => page({ version: "new 2026-09-11" }, async ({ w, U, reloads, start }) => {
    let screen = "game";
    U.AUTO_MS = 60;
    start({ onTitle: () => screen === "menu" });
    await U.check();
    await wait(160);
    assert.equal(reloads.n, 0, "a game is never interrupted");
    screen = "menu";
    U.screenChanged();
    w.document.getElementById("btn-update-reload").click();
    assert.equal(reloads.n, 1, "the Reload button");
    await wait(160);
    assert.equal(reloads.n, 1, "and the timer does not add a second one");
}));

test("every failure is silent", async () => {
    const answers = [
        () => Promise.reject(new Error("offline")),
        () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
        () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("not json")) }),
        { nothing: true },
        { version: 42 },
    ];
    for (let k = 0; k < answers.length; k++) {
        await page(answers[k], async ({ U, notice, start }) => {
            start({ onTitle: () => true });
            assert.equal(await U.check(), false, "answer " + k);
            assert.equal(U.available, false, "answer " + k);
            assert.equal(notice().hidden, true, "answer " + k);
        });
    }
    // a page without fetch at all
    await page({ version: "new 2026-09-11" }, async ({ w, U, start }) => {
        w.fetch = undefined;
        start({ onTitle: () => true });
        assert.equal(await U.check(), false);
        assert.equal(U.available, false);
    });
});
