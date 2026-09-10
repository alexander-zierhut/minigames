/* PeerJS transport for one room with up to four friends (and spectators).
   Everybody shares a room code. Whoever claims the room's peer id first is the host,
   the others connect to that id as guests — so "create room" and "type the same code"
   are the same path. The host keeps one reliable DataConnection per guest: send()
   broadcasts, sendTo()/sendExcept() address one guest, and the app relays what a guest
   says to the others. A ping watchdog per connection detects silent drops; a guest
   redials. If the host stays gone a guest claims the room id itself (roles can swap;
   player seats are the app's business, not the transport's — the app tags every
   connection with a seat via setSeat so a refreshed guest replaces its stale
   connection). The app layer re-syncs the game after every (re)connect. */

"use strict";

const Net = (() => {
    const PREFIX = "chainreact-v1-";
    const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const PING_EVERY = 3000, PING_TIMEOUT = 12000;
    // ICE servers for the WebRTC connection. STUN alone fails when both players are on
    // mobile data (carrier-grade NAT), so the ICE list (STUN + TURN relay) is fetched from
    // the owner's Metered account the way Metered intends for browser apps (credential-
    // scoped API key; free plan 0.5 GB/month; WebRTC relays only when there is no direct
    // path). The endpoint is stored reversed + base64 so crawlers grepping for
    // "turn:" or the key parameter don't pick it up — it is not a secret, just not a free gift.
    // If the request fails (offline, quota gone) STUN-only still works on Wi‑Fi.
    const STUN_ONLY = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
    const RELAY_SRC = "NTMwMzQzN2RhYjQzMTMyMzEyMGQ0ZjVhNzQ5YzBhMzNlZDhiPXllS2lwYT9zbGFpdG5lZGVyYy9ucnV0LzF2L2lwYS9ldmlsLmRlcmV0ZW0ucmVwbHpsYS8vOnNwdHRo";
    const relayUrl = () => atob(RELAY_SRC).split("").reverse().join("");
    const RELAY_CACHE_MS = 20 * 60 * 1000;
    const NO_PATH_TEXT = "Your networks block a direct connection (both on mobile data?). Try Wi‑Fi on one side.";
    const NO_RELAY_TEXT = "No relay server is available right now, so a private connection is not possible. Turn off \"Keep my IP always private\" to play anyway.";
    let iceCache = null;        // { at, promise }
    let iceInfo = { relayOnly: false, turn: false, servers: 0 };   // what the current peer was created with (dev panel, tests)
    const isTurn = (s) => [].concat(s && s.urls || []).some((u) => /^turns?:/i.test(u));
    // the RTCPeerConnection config: with relayOnly (#30, "Keep my IP always private") only relay
    // candidates are offered, so the others (and a streamer's viewers) never see this device's IP
    function peerConfig(servers, relayOnly) {
        return { iceServers: servers, iceTransportPolicy: relayOnly ? "relay" : "all" };
    }

    function iceServers() {
        if (iceCache && Date.now() - iceCache.at < RELAY_CACHE_MS) return iceCache.promise;
        const request = typeof fetch === "function"
            ? fetch(relayUrl()).then((r) => (r.ok ? r.json() : Promise.reject(new Error("relay " + r.status))))
            : Promise.reject(new Error("no fetch"));
        const cap = new Promise((_, reject) => setTimeout(() => reject(new Error("relay timeout")), 4000));
        const promise = Promise.race([request, cap])
            .then((list) => (Array.isArray(list) && list.length ? list : Promise.reject(new Error("relay empty"))))
            .catch(() => { iceCache = null; return STUN_ONLY; });     // try again on the next open
        iceCache = { at: Date.now(), promise };
        return promise;
    }
    // create the Peer once the ICE servers are known; ignored if the room was left meanwhile
    function createPeer(id, setup) {
        const gen = openGen;
        iceServers().then((servers) => {
            if (gen !== openGen || !wantConnection) return;
            const relayOnly = !!(typeof handlers.relayOnly === "function" ? handlers.relayOnly() : handlers.relayOnly);
            iceInfo = { relayOnly, turn: servers.some(isTurn), servers: servers.length };
            peer = new Peer(id, { debug: 0, config: peerConfig(servers, relayOnly) });
            setup(peer);
        });
    }
    const ERROR_TEXT = {
        "browser-incompatible": "This browser can't do peer-to-peer connections (WebRTC).",
        "network": "Can't reach the room server. Check your internet connection…",
        "server-error": "The room server had an error. Retrying…",
        "socket-error": "Lost the room server. Retrying…",
        "socket-closed": "Lost the room server. Retrying…",
        "ssl-unavailable": "The room server needs HTTPS.",
        "webrtc": "The direct connection failed. Your networks may be blocking it.",
        "disconnected": "Disconnected from the room server. Retrying…",
    };
    const BROKER_ERRORS = ["network", "server-error", "socket-error", "socket-closed", "disconnected"];

    let peer = null;
    let conn = null;            // guest: the connection to the host
    let conns = [];             // host: one entry per guest { c, id, seat, meta, lastPong }
    let nextId = 1;
    let code = null;
    let role = null;            // "host" | "guest"
    let handlers = {};          // onStatus(status, detail), onRole(role), onOpen(role, id), onClose(reason, id),
                                // onMessage(msg, id), preferHost (bool), metadata() -> object sent with each dial
                                // (my seat), admit(meta, peers) -> may a newcomer (no known seat) join? (host),
                                // relayOnly() -> force every connection through the TURN relay (#30)
    let status = "idle";        // idle | connecting | waiting | connected | reconnecting | signaling | error
    let wantConnection = false;
    let openGen = 0;            // increments per open(); async peer creation checks it
    let everConnected = false;  // had a data connection at least once in this room
    let hostClaimTries = 0;
    let dialAttempts = 0;
    let hostMissing = 0;        // consecutive dials that found no host at the broker
    let roomFull = false;       // the host turned us away; keep the message while retrying quietly
    let channelFailures = 0;    // dials whose data channel never opened (NAT trouble, not an absent host)
    let lastPong = 0;           // guest: last pong from the host
    const timers = { ping: null, retry: null, signaling: null };

    function randomCode(len = 5) {
        const arr = new Uint32Array(len);
        crypto.getRandomValues(arr);
        return [...arr].map((v) => ALPHABET[v % ALPHABET.length]).join("");
    }

    // upper-case, letters/digits only, O→0 and I/L→1 (they don't exist in the alphabet)
    function normalizeCode(s) {
        return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").slice(0, 5);
    }

    const openConns = () => conns.filter((x) => x.c.open);
    const isOpen = () => (role === "host" ? openConns().length > 0 : !!(conn && conn.open));
    const isSilent = (x) => Date.now() - x.lastPong > PING_EVERY * 2;    // stopped answering pings

    function setStatus(s, detail) {
        status = s;
        if (handlers.onStatus) handlers.onStatus(s, detail || "");
    }

    function clearTimer(name) {
        if (timers[name]) { clearTimeout(timers[name]); clearInterval(timers[name]); timers[name] = null; }
    }
    function after(name, ms, fn) { clearTimer(name); timers[name] = setTimeout(fn, ms); }

    /* ---------- open a room: try to be host, otherwise join as guest ---------- */
    function open(roomCode, h, preferredRole) {
        leave();
        handlers = h || {};
        code = normalizeCode(roomCode) || randomCode();
        wantConnection = true;
        openGen++;
        hostClaimTries = 0;
        if (preferredRole === "guest") joinAsGuest();
        else claimHost();
        return code;
    }

    // peer events shared by host and guest; reopen() re-creates the peer after the broker
    // dropped it for good. Events of a peer we already replaced are ignored (destroy()
    // emits "close" synchronously).
    function bindPeer(p, reopen) {
        const current = () => wantConnection && p === peer;
        p.on("disconnected", () => { if (current()) onSignalingLost(); });
        p.on("close", () => { if (current() && !isOpen()) after("retry", 1500, reopen); });
    }
    function dropPeer() {
        const old = peer;
        peer = null;
        if (old) { try { old.destroy(); } catch (e) {} }
    }

    const waitingText = () => (everConnected ? "Waiting for your friend to come back…" : "Waiting for your friend…");

    function claimHost() {
        role = "host";
        setStatus("connecting", "Opening room…");
        createPeer(PREFIX + code, (peer) => {
        bindPeer(peer, claimHost);
        peer.on("open", () => {
            if (isOpen()) setStatus("connected", "Connected");
            else setStatus("waiting", waitingText());
            if (handlers.onRole) handlers.onRole("host");
        });
        peer.on("connection", (c) => {
            if (c.open) accept(c);                                           // the data channel opens after the event
            else c.on("open", () => accept(c));
        });
        peer.on("error", (err) => {
            if (err.type !== "unavailable-id") { handleError(err); return; }
            // somebody already owns this code -> we are the guest. After a page refresh the
            // old id may linger at the broker for a moment, so a former host retries first.
            dropPeer();
            if (handlers.preferHost && !everConnected && hostClaimTries++ < 4) after("retry", 1200, claimHost);
            else joinAsGuest();          // everConnected: our friend took the id over while our tab slept
        });
        });
    }

    function joinAsGuest() {
        role = "guest";
        setStatus("connecting", "Joining room…");
        createPeer(undefined, (peer) => {
        bindPeer(peer, joinAsGuest);
        peer.on("open", () => {
            if (handlers.onRole) handlers.onRole("guest");
            if (isOpen()) setStatus("connected", "Connected");
            else dial();
        });
        peer.on("error", handleError);
        });
    }

    // the socket to the PeerJS broker dropped (tab suspended, network hiccup). An
    // established game connection keeps working without it; only the lobby cares.
    function onSignalingLost() {
        if (!isOpen()) {
            setStatus("signaling", everConnected
                ? "Lost the room server. Reconnecting…"
                : "Lost the room server. Reconnecting so your friend can join…");
        }
        after("signaling", 800, () => {
            if (!wantConnection || !peer || peer.destroyed) return;
            if (peer.disconnected) peer.reconnect();
            after("signaling", 6000, () => { if (peer && peer.disconnected && wantConnection) onSignalingLost(); });
        });
    }

    /* ---------- guest: dial the host ---------- */
    function dial() {
        if (!wantConnection || !peer || peer.destroyed || isOpen()) return;
        dialAttempts++;
        if (roomFull) { /* keep "room is full" on screen while we quietly try again */ }
        else if (iceInfo.relayOnly && !iceInfo.turn) setStatus("error", NO_RELAY_TEXT);   // relay demanded, none to be had
        else if (channelFailures >= 3) setStatus("error", NO_PATH_TEXT);   // host is there, channel never opens
        else if (everConnected) setStatus("reconnecting", dialAttempts > 1 ? `Reconnecting to your friend… (try ${dialAttempts})` : "Reconnecting to your friend…");
        else setStatus("connecting", dialAttempts > 1 ? "Your friend isn't in the room yet. Waiting…" : "Looking for the room…");
        const metadata = handlers.metadata ? handlers.metadata() : {};   // e.g. my seat, for the host's full-room check
        const c = peer.connect(PREFIX + code, { reliable: true, metadata });
        // The host answers the open channel with welcome (or full). Listen from the start:
        // under load the first message can be delivered before our own "open" event, and the
        // host's pings count as a welcome too. Attach once the channel is open and welcomed.
        let opened = false, welcomed = false, settled = false;
        const settle = () => { if (opened && welcomed && !settled) { settled = true; c.removeListener("data", first); attachGuest(c); } };
        const first = (msg) => {
            if (settled || !msg || typeof msg !== "object") return;
            if (msg.t === "welcome" || msg.t === "ping") { welcomed = true; settle(); }
            else if (msg.t === "full") { settled = true; c.removeListener("data", first); try { c.close(); } catch (e) {} onFull(); }
        };
        c.on("data", first);
        c.on("open", () => { opened = true; settle(); });
        c.on("error", () => {});
        after("retry", 8000, () => {                     // no usable channel in time: try again
            if (!settled && wantConnection) { channelFailures++; try { c.close(); } catch (e) {} dial(); }
        });
    }

    function attachGuest(c) {
        conn = c;
        everConnected = true;
        dialAttempts = 0;
        hostMissing = 0;
        roomFull = false;
        channelFailures = 0;
        lastPong = Date.now();
        clearTimer("retry");
        c.on("data", (msg) => {
            if (!msg || typeof msg !== "object" || conn !== c) return;
            if (msg.t === "ping") { send({ t: "pong" }); return; }
            if (msg.t === "pong") { lastPong = Date.now(); return; }
            if (msg.t === "welcome") return;
            if (handlers.onMessage) handlers.onMessage(msg, "host");
        });
        c.on("close", () => { if (conn === c) onLost("closed"); });      // a replaced connection must not count
        c.on("error", () => { if (conn === c) onLost("error"); });
        clearTimer("ping");
        timers.ping = setInterval(() => {
            if (!isOpen()) return;
            send({ t: "ping" });
            if (Date.now() - lastPong > PING_TIMEOUT) onLost("timeout");
        }, PING_EVERY);
        setStatus("connected", "Connected");
        if (handlers.onOpen) handlers.onOpen(role, "host");
    }

    // the host already has everyone it can take. Not final: the "friend" may be our own
    // stale connection that the host hasn't noticed as dead yet, so keep trying quietly.
    function onFull() {
        if (!wantConnection) return;
        roomFull = true;
        setStatus("error", "This room is full. Every seat is taken.");   // only if the app refuses newcomers (it doesn't: spectators)
        after("retry", 5000, dial);
    }

    // the guest lost the host
    function onLost(reason) {
        if (!wantConnection) return;
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = null;
        clearTimer("ping");
        clearTimer("retry");
        setStatus("reconnecting", reason === "timeout"
            ? "No answer from your friend (tab in background or offline?). Reconnecting…"
            : "Connection to your friend was lost. Reconnecting…");
        if (handlers.onClose) handlers.onClose(reason, "host");
        after("retry", 800, dial);
    }

    /* ---------- host: one connection per guest ---------- */
    // A guest connected. The same peer dialling again (its first dial stalled and it gave
    // up after 8 s, see dial) or a guest that comes back on a fresh connection with the
    // seat it held (page refresh) replaces its stale connection — newest wins, so one
    // person is never two connections (a spectator counted twice on a slow CI box). A
    // newcomer is asked of the app (admit) — when every seat is taken it is turned away,
    // unless an existing connection has stopped answering pings (> 6 s): that stale one
    // is dropped in its favour.
    function accept(c) {
        const meta = c.metadata || {};
        const seat = Number.isInteger(meta.seat) && meta.seat >= 0 ? meta.seat : -1;
        const same = conns.find((x) => x.c.peer === c.peer) || (seat >= 0 ? conns.find((x) => x.seat === seat) : null);
        if (same) dropConn(same, "replaced");
        else if (handlers.admit && !handlers.admit(meta, peers())) {
            const silent = conns.find(isSilent);
            if (!silent) {
                try { c.send({ t: "full" }); } catch (e) {}
                setTimeout(() => { try { c.close(); } catch (e) {} }, 300);
                return;
            }
            dropConn(silent, "replaced");
        }
        try { c.send({ t: "welcome" }); } catch (e) {}      // the guest attaches only after this
        attachHost(c, seat, meta);
    }

    function attachHost(c, seat, meta) {
        const entry = { c, id: "c" + nextId++, seat, meta, lastPong: Date.now() };
        conns.push(entry);
        everConnected = true;
        clearTimer("retry");
        c.on("data", (msg) => {
            if (!msg || typeof msg !== "object" || !conns.includes(entry)) return;
            if (msg.t === "ping") { try { c.send({ t: "pong" }); } catch (e) {} return; }
            if (msg.t === "pong") { entry.lastPong = Date.now(); return; }
            if (msg.t === "welcome") return;
            if (handlers.onMessage) handlers.onMessage(msg, entry.id);
        });
        c.on("close", () => { if (conns.includes(entry)) onGuestLost(entry, "closed"); });   // a replaced connection must not count
        c.on("error", () => { if (conns.includes(entry)) onGuestLost(entry, "error"); });
        if (!timers.ping) {
            timers.ping = setInterval(() => {
                for (const x of conns.slice()) {
                    if (!x.c.open) continue;
                    try { x.c.send({ t: "ping" }); } catch (e) {}
                    if (Date.now() - x.lastPong > PING_TIMEOUT) onGuestLost(x, "timeout");
                }
            }, PING_EVERY);
        }
        setStatus("connected", "Connected");
        if (handlers.onOpen) handlers.onOpen(role, entry.id);
    }

    function dropConn(entry, reason) {
        conns = conns.filter((x) => x !== entry);
        try { entry.c.close(); } catch (e) {}
        if (reason !== "replaced" && handlers.onClose) handlers.onClose(reason, entry.id);
    }

    // a guest's connection dropped; the others keep playing, the host waits for it to redial
    function onGuestLost(entry, reason) {
        if (!wantConnection) return;
        dropConn(entry, reason);
        if (openConns().length === 0) {
            clearTimer("ping");
            setStatus("reconnecting", reason === "timeout"
                ? "No answer from your friend (tab in background or offline?). Reconnecting…"
                : "Connection to your friend was lost. Reconnecting…");
        } else setStatus("connected", "Connected");
    }

    function handleError(err) {
        if (!wantConnection) return;
        const type = err && err.type;
        if (type === "peer-unavailable") {
            if (role !== "guest") return;
            channelFailures = 0;                          // the host isn't even registered: not a NAT problem
            // the host isn't registered at the broker (left, tabbed out, or not there yet).
            // After a couple of tries we take over the room id ourselves, so the room lives on
            // as long as anyone is in it and a friend who left can come back by the same link.
            if (++hostMissing >= 2) { hostMissing = 0; dropPeer(); claimHost(); return; }
            setStatus(everConnected ? "reconnecting" : "connecting", everConnected
                ? "Your friend seems to be away. Waiting for them to come back…"
                : "Nobody is in this room yet. Waiting for your friend…");
            after("retry", 2500, dial);
            return;
        }
        if (BROKER_ERRORS.includes(type)) {
            if (!isOpen()) setStatus("signaling", ERROR_TEXT[type]);
            after("retry", 2500, () => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); });
            return;
        }
        if (type === "webrtc") {
            channelFailures++;
            setStatus("error", channelFailures >= 3 ? NO_PATH_TEXT : ERROR_TEXT.webrtc);
            if (role === "guest") after("retry", 4000, dial);
            return;
        }
        setStatus("error", ERROR_TEXT[type] || (err && err.message) || String(err));
    }

    /* ---------- sending ---------- */
    // guest: to the host; host: to every guest. true when it went out to at least one side
    function send(obj) {
        if (role === "host") {
            let sent = false;
            for (const x of openConns()) { try { x.c.send(obj); sent = true; } catch (e) {} }
            return sent;
        }
        if (!isOpen()) return false;
        try { conn.send(obj); return true; } catch (e) { return false; }
    }
    // host only: one guest / everyone but one guest (relay)
    function sendTo(id, obj) {
        const x = conns.find((e) => e.id === id && e.c.open);
        if (!x) return false;
        try { x.c.send(obj); return true; } catch (e) { return false; }
    }
    function sendExcept(id, obj) {
        let sent = false;
        for (const x of openConns()) { if (x.id === id) continue; try { x.c.send(obj); sent = true; } catch (e) {} }
        return sent;
    }
    // host: the guests as the app sees them
    const peers = () => conns.map((x) => ({ id: x.id, seat: x.seat, meta: x.meta, open: !!x.c.open, silent: isSilent(x) }));

    // the WebRTC route of one DataConnection (dev panel, #31): the selected candidate pair
    async function routeOf(c) {
        const pc = c && c.peerConnection;
        if (!pc || typeof pc.getStats !== "function") return null;
        const stats = await pc.getStats();
        let pair = null;
        stats.forEach((r) => { if (r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded"))) pair = r; });
        if (!pair) return null;
        const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
        return {
            local: local && local.candidateType, remote: remote && remote.candidateType, protocol: (local && local.protocol) || pair.protocol,
            rttMs: pair.currentRoundTripTime !== undefined ? Math.round(pair.currentRoundTripTime * 1000) : null,
            sent: pair.bytesSent || 0, recv: pair.bytesReceived || 0,
        };
    }
    // every connection with its route (host: one per guest; guest: the host), for the dev panel
    async function stats() {
        const now = Date.now();
        if (role === "guest") return conn ? [{ id: "host", seat: -1, open: !!conn.open, silent: now - lastPong > PING_EVERY * 2, pongAge: now - lastPong, pair: await routeOf(conn) }] : [];
        return Promise.all(conns.map(async (x) => ({ id: x.id, seat: x.seat, open: !!x.c.open, silent: isSilent(x), pongAge: now - x.lastPong, pair: await routeOf(x.c) })));
    }
    // host: remember which seat a connection holds (assigned by the app's handshake)
    function setSeat(id, seat) {
        const x = conns.find((e) => e.id === id);
        if (x) x.seat = seat;
    }
    // host: merge something the app learned about a connection into its meta (e.g. its
    // name, #35 — the dial's metadata already carries seat / spectate / name)
    function setMeta(id, patch) {
        const x = conns.find((e) => e.id === id);
        if (x) x.meta = { ...(x.meta || {}), ...(patch || {}) };
    }

    function leave() {
        wantConnection = false;
        everConnected = false;
        for (const name of Object.keys(timers)) clearTimer(name);
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = null;
        for (const x of conns) { try { x.c.close(); } catch (e) {} }
        conns = [];
        roomFull = false;
        dropPeer();
        role = null;
        setStatus("idle", "");
    }

    // called when the tab becomes visible / the network is back
    function retryNow() {
        if (!wantConnection || !peer) return;
        if (peer.destroyed) { (role === "host" ? claimHost : joinAsGuest)(); return; }
        if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
        if (role === "guest" && !isOpen()) dial();
    }

    return {
        open, send, sendTo, sendExcept, leave, retryNow, randomCode, normalizeCode, setSeat, setMeta, peerConfig, isTurn, stats,
        get iceInfo() { return { ...iceInfo }; },
        // the transport's inner state for the dev panel (#31)
        get transport() { return { broker: !peer ? "none" : peer.destroyed ? "destroyed" : peer.disconnected ? "disconnected" : peer.open ? "open" : "opening", dialAttempts, channelFailures, everConnected }; },
        get code() { return code; },
        get role() { return role; },
        get status() { return status; },
        get connected() { return isOpen(); },
        get peers() { return peers(); },
        get peer() { return peer; },                  // test hook (online-edge: a duplicate dial from the same peer)
    };
})();
