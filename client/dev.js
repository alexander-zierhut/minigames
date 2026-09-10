/* Developer info (#31): a small monospace panel (#dev-panel, bottom-left) for the owner
   and curious players, switched on in the preferences ("Show developer info"). It shows
   the network (status, role, relay policy, the broker socket, and per connection the
   WebRTC route: local / remote candidate types, protocol, round trip, bytes), performance
   (frames per second, worst frame, JS heap, the last move's animation time) and the bot
   (the last move's search: nodes, depth, value, time, budget) plus the win-chance
   estimator's last stage. Nothing here changes behaviour; the panel never takes taps.

   snapshot() gathers the numbers (async: WebRTC stats), format(snapshot) turns them into
   the lines shown (pure; unit-tested). Refreshed once a second while enabled. */

"use strict";

const Dev = (() => {
    const { $ } = Util;
    const EVERY_MS = 1000;
    let enabled = false;
    let timer = null;
    let raf = null;
    let frames = 0, frameMax = 0, lastFrame = 0, fps = 0, since = 0;   // frame counter (requestAnimationFrame)
    let moveStart = 0, lastMoveMs = null;                            // game:move → game:position

    /* ---------- frame meter ---------- */
    function tick(now) {
        if (!enabled) { raf = null; return; }
        if (lastFrame) frameMax = Math.max(frameMax, now - lastFrame);
        lastFrame = now;
        frames++;
        if (now - since >= 1000) { fps = Math.round(frames * 1000 / (now - since)); frames = 0; since = now; }
        raf = requestAnimationFrame(tick);
    }

    /* ---------- the numbers ---------- */
    async function snapshot() {
        const online = typeof Room !== "undefined" && Room.online;
        const net = { online, status: Net.status, role: Net.role, ...Net.iceInfo, ...Net.transport, peers: [] };
        if (online) { try { net.peers = await Net.stats(); } catch (e) { net.peers = []; } }
        const mem = typeof performance !== "undefined" && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
        const board = $("board");
        const perf = { fps, frameMax: Math.round(frameMax), heapMb: mem, cells: board ? board.children.length : 0, boardPx: board ? Math.round(board.getBoundingClientRect().width) : 0, lastMoveMs };
        frameMax = 0;
        const bot = typeof Match !== "undefined" ? Match.botInfo : null;
        const win = typeof WinChance !== "undefined" ? WinChance.info : null;
        return { net, perf, bot, win, names: typeof Match !== "undefined" && Match.running ? Match.names : [] };
    }

    const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? (b / 1024).toFixed(1) + " KB" : `${b} B`);
    const n = (v, unit = "") => (v === null || v === undefined ? "?" : `${v}${unit}`);
    const thousands = (v) => (v === null || v === undefined ? "?" : String(v).replace(/\B(?=(\d{3})+$)/g, " "));

    // the panel text from a snapshot (pure)
    function format(s) {
        const L = [];
        const net = s.net || {};
        L.push("NETWORK");
        if (!net.online) L.push("  offline");
        else {
            L.push(`  ${net.status} as ${net.role || "?"} · broker ${net.broker || "?"}${net.everConnected ? "" : " · never connected"}`);
            L.push(`  ice: ${net.relayOnly ? "relay only (IP private)" : "direct allowed"} · turn ${net.turn ? "yes" : "no"} · ${n(net.servers)} servers`);
            if (net.dialAttempts || net.channelFailures) L.push(`  dials ${n(net.dialAttempts)} · channel failures ${n(net.channelFailures)}`);
            if (!net.peers.length) L.push("  no connection");
            for (const p of net.peers) {
                const who = p.seat >= 0 ? `seat ${p.seat}${s.names && s.names[p.seat] ? " " + s.names[p.seat] : ""}` : (p.id === "host" ? "host" : "spectator");
                L.push(`  ${p.id} ${who}: ${p.open ? "open" : "closed"}${p.silent ? " · silent" : ""} · pong ${n(p.pongAge, " ms")} ago`);
                if (p.pair) L.push(`    route ${p.pair.local || "?"} → ${p.pair.remote || "?"} (${p.pair.protocol || "?"}) · rtt ${n(p.pair.rttMs, " ms")} · ↑ ${kb(p.pair.sent || 0)} ↓ ${kb(p.pair.recv || 0)}`);
                else L.push("    route not known yet");
            }
        }
        const perf = s.perf || {};
        L.push("PERFORMANCE");
        L.push(`  ${n(perf.fps)} fps · worst frame ${n(perf.frameMax, " ms")} · heap ${perf.heapMb === null || perf.heapMb === undefined ? "?" : perf.heapMb + " MB"}`);
        L.push(`  board ${n(perf.boardPx, " px")} · ${n(perf.cells)} cells · last move ${perf.lastMoveMs === null || perf.lastMoveMs === undefined ? "?" : Math.round(perf.lastMoveMs) + " ms"}`);
        L.push("BOT");
        const b = s.bot;
        if (!b) L.push("  no bot at the table");
        else {
            L.push(`  ${b.id} · ${b.difficulty} · budget ${thousands(b.budget)} nodes`);
            if (b.move === undefined || b.move === null) L.push("  no move yet");
            else L.push(`  last: cell ${b.move} · ${thousands(b.nodes)} nodes · depth ${n(b.depth)} · value ${b.value === undefined || b.value === null ? "?" : Math.round(b.value)}${b.forced ? " · " + b.forced : ""} · ${n(Math.round(b.ms || 0), " ms")}`);
        }
        const w = s.win;
        if (w && w.bot) L.push(`  win chance: ${w.bot} stage ${n(w.stage)}/${n(w.stages)} · ${thousands(w.nodes)} nodes · ${n(w.ms, " ms")} · p0 ${w.value === undefined || w.value === null ? "?" : Math.round(w.value * 100) + " %"}`);
        return L.join("\n");
    }

    async function refresh() {
        if (!enabled) return;
        const panel = $("dev-panel");
        if (!panel) return;
        try { panel.textContent = format(await snapshot()); } catch (e) { panel.textContent = "dev panel: " + (e && e.message); }
    }

    function enable(on) {
        enabled = !!on;
        const panel = $("dev-panel");
        if (panel) panel.hidden = !enabled;
        document.body.classList.toggle("dev", enabled);
        if (timer) { clearInterval(timer); timer = null; }
        if (!enabled) return;
        frames = 0; frameMax = 0; lastFrame = 0; since = typeof performance !== "undefined" ? performance.now() : 0;
        if (typeof requestAnimationFrame === "function" && !raf) raf = requestAnimationFrame(tick);
        refresh();
        timer = setInterval(refresh, EVERY_MS);
    }

    function init() {
        if (typeof Bus !== "undefined") {
            Bus.on("game:move", () => { moveStart = performance.now(); });
            Bus.on("game:position", () => { if (moveStart) { lastMoveMs = performance.now() - moveStart; moveStart = 0; } });
        }
    }

    return { init, enable, snapshot, format, refresh, get enabled() { return enabled; }, EVERY_MS };
})();
