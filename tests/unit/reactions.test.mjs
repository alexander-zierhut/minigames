/* Emoji reactions: the float duration follows the recent reaction rate (#17) — a lone
   reaction floats slowly, spam keeps the fast fall; own and received reactions count
   alike. The clock is mocked, so nothing here depends on real time. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom } from "./dom.mjs";

function setup() {
    const w = loadDom(); const d = w.document;
    const R = w.eval("Reactions"), Bus = w.eval("Bus");
    const animations = [], sent = [], events = [];
    w.Element.prototype.animate = function (frames, options) { animations.push({ el: this, options }); return { finished: Promise.resolve(), onfinish: null, cancel() {} }; };
    let now = 0;
    w.Date.now = () => now;
    R.init({ onSend: (e) => sent.push(e) });
    Bus.on("reaction", (e) => events.push(e));
    const click = (e) => d.querySelector(`#react-bar .react-list button[data-e="${e}"]`).click();
    return { w, d, R, animations, sent, events, click, at: (t) => { now = t; } };
}

test("durationFor: 0 recent → slow 4 s, 1 → medium, ≥ 2 → fast 1.9 s", () => {
    const { w, R } = setup();
    assert.equal(R.SLOW_MS, 4000); assert.equal(R.FAST_MS, 1900); assert.equal(R.RATE_WINDOW, 3000);
    assert.ok(R.MEDIUM_MS > R.FAST_MS && R.MEDIUM_MS < R.SLOW_MS);
    assert.equal(R.durationFor(0), R.SLOW_MS);
    assert.equal(R.durationFor(1), R.MEDIUM_MS);
    assert.equal(R.durationFor(2), R.FAST_MS);
    assert.equal(R.durationFor(7), R.FAST_MS);
    assert.equal(R.durationFor(-1), R.SLOW_MS);
    w.close();
});

test("a lone reaction floats slowly, a burst falls fast, own and received count together, the window forgets after 3 s", () => {
    const { w, d, R, animations, sent, events, click, at } = setup();
    at(1000); R.receive("🔥", "#ffa62b");
    assert.equal(animations.length, 1);
    assert.equal(animations[0].options.duration, R.SLOW_MS, "first reaction in a while: slow");
    assert.ok(animations[0].el.classList.contains("theirs"));
    assert.equal(animations[0].el.style.getPropertyValue("--their-color"), "#ffa62b");
    at(1500); click("🔥");
    assert.equal(sent.length, 1, "own reaction sent");
    assert.equal(animations[1].options.duration, R.MEDIUM_MS, "one shown in the last 3 s: medium");
    assert.equal(animations[1].el.classList.contains("theirs"), false);
    at(2000); R.receive("😂");
    assert.equal(animations[2].options.duration, R.FAST_MS, "two shown in the last 3 s: fast");
    at(2300); click("GG");
    assert.equal(animations[3].options.duration, R.FAST_MS, "spam stays fast");
    assert.ok(animations[3].el.classList.contains("chip"));
    at(4900); R.receive("👏");                          // 1000 and 1500 have dropped out, 2000 and 2300 remain
    assert.equal(animations[4].options.duration, R.FAST_MS);
    assert.equal(R.recent(4900), 3, "the three inside the window (incl. the one just shown)");
    assert.equal(R.recent(5300), 1, "2000 and 2300 are out now, only 4900 remains");
    at(9000); click("😂");
    assert.equal(animations[5].options.duration, R.SLOW_MS, "quiet again: slow");
    assert.equal(R.recent(9000), 1);
    assert.equal(d.getElementById("react-layer").children.length, 6);
    assert.equal(events.length, 6);
    assert.equal(events[0].theirs, true); assert.equal(events[1].theirs, false); assert.equal(events[1].emoji, "🔥");
    w.close();
});

test("rate limits still apply: one own reaction per 120 ms, one received per 100 ms, unknown values ignored", () => {
    const { w, R, animations, sent, click, at } = setup();
    at(1000); click("🔥"); click("🔥");
    assert.equal(sent.length, 1); assert.equal(animations.length, 1);
    at(1130); click("🔥");
    assert.equal(sent.length, 2);
    at(1200); R.receive("💀"); R.receive("💀");
    assert.equal(animations.length, 3);
    at(1300); R.receive("<script>");
    assert.equal(animations.length, 3, "only values from the button set");
    w.close();
});
