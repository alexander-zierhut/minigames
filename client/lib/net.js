/* PeerJS transport for one room with two friends.
   Both share a room code. Whoever claims the room's peer id first is the host, the
   other connects to that id as guest — so "create room" and "type the same code" are
   the same path. One reliable DataConnection carries JSON messages; a ping watchdog
   detects silent drops and the guest redials. If the host stays gone the guest claims
   the room id itself (roles can swap; player seats are the app's business, not the
   transport's). The app layer re-syncs the game after every (re)connect.

   Growing to 4 players: the host would keep a list of connections (attach() per guest,
   send() broadcasts, incoming guest messages are relayed to the others). The API
   (open/send/leave/retryNow + handlers) is already shaped so app.js needs no change. */

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
    let iceCache = null;        // { at, promise }

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
            peer = new Peer(id, { debug: 0, config: { iceServers: servers } });
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
    let conn = null;
    let code = null;
    let role = null;            // "host" | "guest"
    let handlers = {};          // onStatus(status, detail), onRole(role), onOpen(role), onClose(reason), onMessage(msg),
                                // preferHost (bool), metadata() -> object sent with each dial (my seat)
    let status = "idle";        // idle | connecting | waiting | connected | reconnecting | signaling | error
    let wantConnection = false;
    let openGen = 0;            // increments per open(); async peer creation checks it
    let everConnected = false;  // had a data connection at least once in this room
    let hostClaimTries = 0;
    let dialAttempts = 0;
    let hostMissing = 0;        // consecutive dials that found no host at the broker
    let roomFull = false;       // the host turned us away; keep the message while retrying quietly
    let channelFailures = 0;    // dials whose data channel never opened (NAT trouble, not an absent host)
    let lastPong = 0;
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

    const isOpen = () => !!(conn && conn.open);

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

    function claimHost() {
        role = "host";
        setStatus("connecting", "Opening room…");
        createPeer(PREFIX + code, (peer) => {
        bindPeer(peer, claimHost);
        peer.on("open", () => {
            if (isOpen()) setStatus("connected", "Connected");
            else setStatus("waiting", everConnected ? "Waiting for your friend to come back…" : "Waiting for your friend…");
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

    function dial() {
        if (!wantConnection || !peer || peer.destroyed || isOpen()) return;
        dialAttempts++;
        if (roomFull) { /* keep "room is full" on screen while we quietly try again */ }
        else if (channelFailures >= 3) setStatus("error", NO_PATH_TEXT);   // host is there, channel never opens
        else if (everConnected) setStatus("reconnecting", dialAttempts > 1 ? `Reconnecting to your friend… (try ${dialAttempts})` : "Reconnecting to your friend…");
        else setStatus("connecting", dialAttempts > 1 ? "Your friend isn't in the room yet. Waiting…" : "Looking for the room…");
        const metadata = handlers.metadata ? handlers.metadata() : {};   // e.g. my seat, for the host's full-room check
        const c = peer.connect(PREFIX + code, { reliable: true, metadata });
        // The host answers the open channel with welcome (or full). Listen from the start:
        // under load the first message can be delivered before our own "open" event, and the
        // host's pings count as a welcome too. Attach once the channel is open and welcomed.
        let opened = false, welcomed = false, settled = false;
        const settle = () => { if (opened && welcomed && !settled) { settled = true; c.removeListener("data", first); attach(c); } };
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

    // a guest connected. With a friend already connected, a newcomer is turned away — unless
    // it is that friend coming back on a fresh connection (same seat: page refresh) before
    // the old one was noticed as dead; then the stale connection is dropped.
    function accept(c) {
        if (isOpen()) {
            const seat = c.metadata && c.metadata.seat;
            const same = seat >= 0 && conn.metadata && conn.metadata.seat === seat;
            const silent = Date.now() - lastPong > PING_EVERY * 2;     // the old connection stopped answering
            if (!same && !silent) {
                try { c.send({ t: "full" }); } catch (e) {}
                setTimeout(() => { try { c.close(); } catch (e) {} }, 300);
                return;
            }
            const stale = conn;
            conn = null;
            try { stale.close(); } catch (e) {}
        }
        try { c.send({ t: "welcome" }); } catch (e) {}      // the guest attaches only after this
        attach(c);
    }

    function attach(c) {
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
            if (handlers.onMessage) handlers.onMessage(msg);
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
        if (handlers.onOpen) handlers.onOpen(role);
    }

    // the host already has a friend. Not final: the "friend" may be our own stale connection
    // that the host hasn't noticed as dead yet, so keep trying quietly behind the message.
    function onFull() {
        if (!wantConnection) return;
        roomFull = true;
        setStatus("error", "This room is full — two players are already in it.");
        after("retry", 5000, dial);
    }

    function onLost(reason) {
        if (!wantConnection) return;
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = null;
        clearTimer("ping");
        clearTimer("retry");
        setStatus("reconnecting", reason === "timeout"
            ? "No answer from your friend (tab in background or offline?). Reconnecting…"
            : "Connection to your friend was lost. Reconnecting…");
        if (handlers.onClose) handlers.onClose(reason);
        if (role === "guest") after("retry", 800, dial);   // the host just waits for the guest to dial again
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

    // true when the message went out; false without an open connection
    function send(obj) {
        if (!isOpen()) return false;
        try { conn.send(obj); return true; } catch (e) { return false; }
    }

    function leave() {
        wantConnection = false;
        everConnected = false;
        for (const name of Object.keys(timers)) clearTimer(name);
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = null;
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
        open, send, leave, retryNow, randomCode, normalizeCode,
        get code() { return code; },
        get role() { return role; },
        get status() { return status; },
        get connected() { return isOpen(); },
    };
})();
