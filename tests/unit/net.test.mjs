import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom } from "./dom.mjs";

test("room codes: 5 chars, unambiguous alphabet, normalisation", () => {
    const w = loadDom(); const N = w.eval("Net");
    for (let k = 0; k < 50; k++) {
        const c = N.randomCode();
        assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/, c);
    }
    assert.equal(N.normalizeCode(" ab-c1o "), "ABC10");
    assert.equal(N.normalizeCode("il0o"), "1100");
    assert.equal(N.normalizeCode("abcdefgh"), "ABCDE", "cut to 5");
    assert.equal(N.normalizeCode(null), "");
    assert.equal(N.status, "idle");
    assert.equal(N.connected, false);
    assert.equal(N.send({ t: "x" }), false, "send without a connection is a no-op");
});
