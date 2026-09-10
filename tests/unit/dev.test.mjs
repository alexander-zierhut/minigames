/* Developer info panel (#31): the pure formatter, enabling through the preference, the
   bot's report / node count and the win-chance stage info that feed it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks, wait } from "./dom.mjs";

test("format(): network with routes per connection, performance, bot and win chance; offline and empty states", () => {
    const w = loadDom(); const D = w.eval("Dev");
    const text = D.format({
        names: ["Cyan", "Amber"],
        net: { online: true, status: "connected", role: "host", broker: "open", everConnected: true, relayOnly: true, turn: true, servers: 5, dialAttempts: 0, channelFailures: 0,
            peers: [{ id: "c1", seat: 1, open: true, silent: false, pongAge: 812, pair: { local: "relay", remote: "srflx", protocol: "udp", rttMs: 41, sent: 2048, recv: 1500000 } }, { id: "c2", seat: -1, open: true, silent: true, pongAge: 7000, pair: null }] },
        perf: { fps: 60, frameMax: 17, heapMb: 23, cells: 16, boardPx: 640, lastMoveMs: 412.4 },
        bot: { id: "creeper-chain", difficulty: "hard", budget: 30000, move: 5, ms: 88.2, nodes: 29876, depth: 6, value: 123.4 },
        win: { bot: "creeper-chain", stage: 2, stages: 3, nodes: 12000, ms: 35, value: 0.62 },
    });
    for (const part of ["NETWORK", "connected as host · broker open", "relay only (IP private) · turn yes · 5 servers", "c1 seat 1 Amber: open · pong 812 ms ago",
        "route relay → srflx (udp) · rtt 41 ms · ↑ 2.0 KB ↓ 1.4 MB", "c2 spectator: open · silent", "route not known yet",
        "PERFORMANCE", "60 fps · worst frame 17 ms · heap 23 MB", "board 640 px · 16 cells · last move 412 ms",
        "BOT", "creeper-chain · hard · budget 30 000 nodes", "last: cell 5 · 29 876 nodes · depth 6 · value 123 · 88 ms",
        "win chance: creeper-chain stage 2/3 · 12 000 nodes · 35 ms · p0 62 %"]) assert.ok(text.includes(part), `${part}\n---\n${text}`);
    assert.ok(!/undefined|NaN/.test(text));
    const off = D.format({ net: { online: false }, perf: {}, bot: null, win: null });
    assert.ok(off.includes("  offline") && off.includes("no bot at the table") && off.includes("? fps"), off);
    assert.ok(!/undefined|NaN/.test(off));
    const guest = D.format({ net: { online: true, status: "reconnecting", role: "guest", broker: "open", everConnected: true, peers: [] }, perf: {}, bot: { id: "x", difficulty: "easy", budget: 2000 }, win: null });
    assert.ok(guest.includes("no connection") && guest.includes("no move yet"), guest);
    w.close();
});

test("enable(): the panel shows and refreshes; the preference switches it; snapshot() works offline", async () => {
    const w = loadDom(); const d = w.document; const D = w.eval("Dev"); const P = w.eval("Prefs");
    D.init();
    assert.equal(d.getElementById("dev-panel").hidden, true);
    assert.equal(P.get().developer, false, "off by default");
    D.enable(true);
    assert.equal(D.enabled, true);
    assert.equal(d.getElementById("dev-panel").hidden, false);
    assert.ok(d.body.classList.contains("dev"));
    await wait(30);
    assert.match(d.getElementById("dev-panel").textContent, /NETWORK\n  offline/);
    const snap = await D.snapshot();
    assert.equal(snap.net.online, false); assert.equal(snap.bot, null);
    D.enable(false);
    assert.equal(d.getElementById("dev-panel").hidden, true);
    assert.equal(d.body.classList.contains("dev"), false);
    P.init({ onChange: (p) => D.enable(p.developer) });
    d.getElementById("pref-developer").checked = true;
    d.getElementById("pref-developer").dispatchEvent(new w.Event("change"));
    assert.equal(P.get().developer, true); assert.equal(D.enabled, true);
    D.enable(false);
    w.close();
});

test("the bot reports its search (nodes, depth, value) and the win chance its stage; Match.botInfo carries the last move", async () => {
    const w = loadDom(); const M = w.eval("Match"); const S = w.eval("Settings"); const O = w.eval("Opponent"); const B = w.eval("Bots"); const W = w.eval("WinChance");
    S.init({}); O.init({});
    const bot = B.create("creeper-chain", { me: 1, difficulty: "normal", seed: 3, players: 2 });
    const s = w.eval("Rules").create({ game: "chain", n: 4, players: 2 });
    await bot.move(s);
    assert.ok(bot.tools.lastDeadline.nodes() > 0, "the deadline counted nodes");
    assert.ok(bot.tools.last && bot.tools.last.depth >= 1, "Creeper reported its depth");
    const sensei = B.create("sensei-five", { me: 1, difficulty: "normal", seed: 3, players: 2 });
    const f = w.eval("Rules").create({ game: "five", n: 7, winLen: 4, players: 2 });
    w.eval("Rules").step("five", f, 24);
    await sensei.move(f);
    assert.ok(sensei.tools.last && sensei.tools.last.depth >= 1, "Sensei reported its depth");
    w.sessionStorage.setItem("chainreact.botseed", "7");
    M.reset("bot");
    M.start({ game: "five", n: 6, winLen: 4, players: 2, timer: 0 }, 1);
    assert.equal(M.botInfo.id, "sensei-five"); assert.equal(M.botInfo.budget, 10000); assert.equal(M.botInfo.move, undefined);
    await M.engine.play(0);
    await wait(M.THINK_MS + 400);
    assert.equal(M.state.history.length, 2);
    assert.ok(M.botInfo.move >= 0 && M.botInfo.ms >= 0 && M.botInfo.nodes >= 0, JSON.stringify(M.botInfo));
    assert.ok(W.info && W.info.bot === "sensei-five" && W.info.stage >= 1 && W.info.nodes > 0, JSON.stringify(W.info));
    M.reset("local");
    assert.equal(M.botInfo, null);
    w.close();
});
