import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, wait } from "./dom.mjs";

test("disabled clock hides itself and never flags", async () => {
    const w = loadDom(); const C = w.eval("Clock");
    let flagged = null;
    C.setup(0, (p) => { flagged = p; });
    assert.equal(C.isEnabled(), false);
    assert.equal(w.document.getElementById("clock-0").hidden, true);
    C.setActive(0); C.resume(); await wait(150);
    assert.equal(flagged, null);
    w.close();
});

test("only the active clock runs, pause stops it, flag fires at zero", async () => {
    const w = loadDom(); const C = w.eval("Clock");
    let flagged = null;
    C.setup(0.5, (p) => { flagged = p; });          // 500 ms each
    assert.equal(JSON.stringify(C.snapshot()), "[500,500]");
    C.setActive(1); C.resume();
    await wait(250);
    C.pause();
    const [a, b] = C.snapshot();
    assert.equal(a, 500, "inactive clock untouched");
    assert.ok(b < 480 && b > 0, `active clock ran (${b})`);      // generous: a loaded CI runner may delay ticks
    await wait(150);
    assert.equal(C.snapshot()[1], b, "paused clock does not move");
    C.resume();
    await wait(900);
    assert.equal(flagged, 1, "player 1 flagged");
    assert.equal(C.snapshot()[1], 0);
    C.setup(0, () => {});   // clears the interval so the process can exit
    w.close();
});

test("restore + render text", () => {
    const w = loadDom(); const C = w.eval("Clock");
    C.setup(180, () => {});
    C.restore([65000, 9500]);
    assert.equal(w.document.getElementById("clock-0").textContent, "1:05");
    assert.match(w.document.getElementById("clock-1").textContent, /^0:10\.\d$/, "tenths under 10 s");
    assert.ok(w.document.getElementById("clock-1").classList.contains("low"));
    C.setup(0, () => {});
    w.close();
});
