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
    let handlers = {};          // onStatus(status, detail), onRole(role), onOpen(role), onClose(reason), onMessage(msg), preferHost
    let status = "idle";        // idle | connecting | waiting | connected | reconnecting | signaling | error
    let wantConnection = false;
    let everConnected = false;  // had a data connection at least once in this room
    let hostClaimTries = 0;
    let dialAttempts = 0;
    let hostMissing = 0;        // consecutive dials that found no host at the broker
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
        peer = new Peer(PREFIX + code, { debug: 0 });
        bindPeer(peer, claimHost);
        peer.on("open", () => {
            if (isOpen()) setStatus("connected", "Connected");
            else setStatus("waiting", everConnected ? "Waiting for your friend to come back…" : "Waiting for your friend…");
            if (handlers.onRole) handlers.onRole("host");
        });
        peer.on("connection", (c) => {
            if (isOpen()) { c.on("open", () => c.close()); return; }        // room is full
            if (c.open) attach(c);                                           // the data channel opens after the event
            else c.on("open", () => attach(c));
        });
        peer.on("error", (err) => {
            if (err.type !== "unavailable-id") { handleError(err); return; }
            // somebody already owns this code -> we are the guest. After a page refresh the
            // old id may linger at the broker for a moment, so a former host retries first.
            dropPeer();
            if (handlers.preferHost && hostClaimTries++ < 4) after("retry", 1200, claimHost);
            else joinAsGuest();
        });
    }

    function joinAsGuest() {
        role = "guest";
        setStatus("connecting", "Joining room…");
        peer = new Peer({ debug: 0 });
        bindPeer(peer, joinAsGuest);
        peer.on("open", () => {
            if (handlers.onRole) handlers.onRole("guest");
            if (isOpen()) setStatus("connected", "Connected");
            else dial();
        });
        peer.on("error", handleError);
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
        if (everConnected) setStatus("reconnecting", dialAttempts > 1 ? `Reconnecting to your friend… (try ${dialAttempts})` : "Reconnecting to your friend…");
        else setStatus("connecting", dialAttempts > 1 ? "Your friend isn't in the room yet. Waiting…" : "Looking for the room…");
        const c = peer.connect(PREFIX + code, { reliable: true });
        let opened = false;
        c.on("open", () => { opened = true; attach(c); });
        c.on("error", () => {});
        after("retry", 4000, () => {                     // host not there yet: try again
            if (!opened && wantConnection) { try { c.close(); } catch (e) {} dial(); }
        });
    }

    function attach(c) {
        conn = c;
        everConnected = true;
        dialAttempts = 0;
        hostMissing = 0;
        lastPong = Date.now();
        clearTimer("retry");
        c.on("data", (msg) => {
            if (!msg || typeof msg !== "object") return;
            if (msg.t === "ping") { send({ t: "pong" }); return; }
            if (msg.t === "pong") { lastPong = Date.now(); return; }
            if (handlers.onMessage) handlers.onMessage(msg);
        });
        c.on("close", () => onLost("closed"));
        c.on("error", () => onLost("error"));
        clearTimer("ping");
        timers.ping = setInterval(() => {
            if (!isOpen()) return;
            send({ t: "ping" });
            if (Date.now() - lastPong > PING_TIMEOUT) onLost("timeout");
        }, PING_EVERY);
        setStatus("connected", "Connected");
        if (handlers.onOpen) handlers.onOpen(role);
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
            setStatus("error", ERROR_TEXT.webrtc);
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
