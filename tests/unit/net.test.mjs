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

test("keep my IP private (#30): the peer config demands relay candidates only; TURN entries are recognised", () => {
    const w = loadDom(); const N = w.eval("Net");
    const servers = [{ urls: "stun:stun.l.google.com:19302" }, { urls: ["turn:a.example.com:80", "turns:a.example.com:443"], username: "u", credential: "c" }];
    assert.equal(JSON.stringify(N.peerConfig(servers, false)), JSON.stringify({ iceServers: servers, iceTransportPolicy: "all" }));
    assert.equal(N.peerConfig(servers, true).iceTransportPolicy, "relay");
    assert.equal(N.isTurn(servers[0]), false); assert.equal(N.isTurn(servers[1]), true); assert.equal(N.isTurn({}), false);
    assert.equal(JSON.stringify(N.iceInfo), JSON.stringify({ relayOnly: false, turn: false, servers: 0 }), "nothing created yet");
    w.close();
});
