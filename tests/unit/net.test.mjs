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

test("spectators dial a peer id of their own (#29): a separate code, never derived from the room code", () => {
    const w = loadDom(); const N = w.eval("Net");
    assert.equal(N.PREFIX, "chainreact-v1-");
    assert.equal(N.SPEC_PREFIX, "chainreact-v1-s-", "the spectator peer is a second id, not the room's");
    const codes = new Set();
    for (let k = 0; k < 200; k++) codes.add(N.randomCode());
    assert.ok(codes.size > 190, "spectator codes come from the same random pool as room codes");
    // no room code can ever produce a spectator id, and no spectator code a room id
    for (const room of ["ABCDE", "22222", "ZZZZZ"]) {
        assert.notEqual(N.PREFIX + room, N.SPEC_PREFIX + room);
        assert.ok(!(N.SPEC_PREFIX + room).startsWith(N.PREFIX + room), "the spectator id is not the room id with a suffix");
    }
    assert.equal(N.watching, false, "not watching until a room is opened as a spectator");
    assert.equal(N.hostSpectators("ABCDE"), undefined, "hostSpectators without a room is a no-op");
    assert.equal(JSON.stringify(N.peers), "[]", "no connections, so nothing is tagged as a spectator");
    w.close();
});

test("the room protocol never puts the room code into a message (#29)", () => {
    const w = loadDom(); const R = w.eval("Room");
    // the room code lives in Net only; every Room export that produces text for others is
    // either the players' own link or carries the spectator code
    assert.equal(typeof R.spectateLink, "function");
    assert.equal(R.watching, false);
    assert.equal(R.spec, null, "a fresh page has no spectator code yet");
    assert.equal(R.codeText(), "…", "no room, no code");
    w.close();
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

test("the broker turning us away is told apart from a hiccup (a rate limit in front of the public broker)", () => {
    const w = loadDom(); const Net = w.eval("Net");
    // nothing happened yet: no such claim, and the dev panel's snapshot carries the flag
    assert.equal(Net.refused, false);
    assert.equal(Net.transport.refused, false, "the developer panel sees it too");
    w.close();
});
