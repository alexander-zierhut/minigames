/* PeerJS transport for two friends.
   Both players share a room code. Whoever claims the room's peer id first is the host,
   the other connects as guest — so "create room" and "type the same code" are the same path.
   Handles reconnects with a ping watchdog; the app layer re-syncs the move history. */

"use strict";

const Net = (() => {
    const PREFIX = "chainreact-v1-";
    const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let peer = null;
    let conn = null;
    let code = null;
    let role = null;            // "host" | "guest"
    let handlers = {};
    let status = "idle";
    let pingTimer = null;
    let lastPong = 0;
    let retryTimer = null;
    let wantConnection = false;
    let hostClaimTries = 0;
    let everConnected = false;   // had a data connection at least once in this room

    // human-readable explanations for PeerJS error types
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

    function randomCode(len = 5) {
        let s = "";
        const arr = new Uint32Array(len);
        crypto.getRandomValues(arr);
        for (let i = 0; i < len; i++) s += ALPHABET[arr[i] % ALPHABET.length];
        return s;
    }

    function normalizeCode(s) {
        return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1").slice(0, 5);
    }

    function setStatus(s, detail) {
        status = s;
        if (handlers.onStatus) handlers.onStatus(s, detail || "");
    }

    function clearTimers() {
        if (pingTimer) clearInterval(pingTimer);
        if (retryTimer) clearTimeout(retryTimer);
        pingTimer = retryTimer = null;
    }

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

    function claimHost() {
        setStatus("connecting", "Opening room…");
        role = "host";
        peer = new Peer(PREFIX + code, { debug: 0 });
        peer.on("open", () => {
            if (conn && conn.open) setStatus("connected", "Connected");
            else setStatus("waiting", everConnected ? "Waiting for your friend to come back…" : "Waiting for your friend…");
            if (handlers.onRole) handlers.onRole("host");
        });
        peer.on("connection", (c) => {
            if (conn && conn.open) { c.on("open", () => c.close()); return; } // room is full
            if (c.open) attach(c);
            else c.on("open", () => attach(c));
        });
        peer.on("disconnected", () => {
            if (!wantConnection) return;
            onSignalingLost();
        });
        peer.on("close", () => {
            // the broker dropped our id for good (e.g. long tab suspension): claim it again
            if (!wantConnection) return;
            if (!(conn && conn.open)) retryTimer = setTimeout(claimHost, 1500);
        });
        peer.on("error", (err) => {
            if (err.type === "unavailable-id") {
                // somebody already owns this code -> we are the guest
                // (after a page refresh the old id may linger a moment: try a few times first)
                if (handlers.preferHost && hostClaimTries++ < 4) {
                    peer.destroy();
                    retryTimer = setTimeout(claimHost, 1200);
                    return;
                }
                peer.destroy();
                joinAsGuest();
                return;
            }
            handleError(err);
        });
    }

    function joinAsGuest() {
        role = "guest";
        setStatus("connecting", "Joining room…");
        peer = new Peer({ debug: 0 });
        peer.on("open", () => {
            if (handlers.onRole) handlers.onRole("guest");
            if (conn && conn.open) setStatus("connected", "Connected");
            else dial();
        });
        peer.on("disconnected", () => {
            if (!wantConnection) return;
            onSignalingLost();
        });
        peer.on("close", () => {
            if (!wantConnection) return;
            if (!(conn && conn.open)) retryTimer = setTimeout(joinAsGuest, 1500);
        });
        peer.on("error", handleError);
    }

    // the socket to the PeerJS broker dropped (tab suspended, network hiccup).
    // An established game connection keeps working without it; only the lobby cares.
    let signalingTimer = null;
    function onSignalingLost() {
        if (signalingTimer) clearTimeout(signalingTimer);
        const gameAlive = conn && conn.open;
        if (!gameAlive) {
            setStatus("signaling", everConnected
                ? "Lost the room server. Reconnecting…"
                : "Lost the room server. Reconnecting so your friend can join…");
        }
        signalingTimer = setTimeout(() => {
            if (!wantConnection || !peer || peer.destroyed) return;
            if (peer.disconnected) peer.reconnect();
            signalingTimer = setTimeout(() => { if (peer && peer.disconnected && wantConnection) onSignalingLost(); }, 6000);
        }, 800);
    }

    let dialAttempts = 0;
    function dial() {
        if (!wantConnection || !peer || peer.destroyed) return;
        if (conn && conn.open) return;
        dialAttempts++;
        if (everConnected) setStatus("reconnecting", dialAttempts > 1 ? `Reconnecting to your friend… (try ${dialAttempts})` : "Reconnecting to your friend…");
        else setStatus("connecting", dialAttempts > 1 ? "Your friend isn't in the room yet. Waiting…" : "Looking for the room…");
        const c = peer.connect(PREFIX + code, { reliable: true });
        let opened = false;
        c.on("open", () => { opened = true; attach(c); });
        c.on("error", () => {});
        // if the host isn't there yet, try again in a bit
        retryTimer = setTimeout(() => {
            if (!opened && wantConnection) { try { c.close(); } catch (e) {} dial(); }
        }, 4000);
    }

    function attach(c) {
        conn = c;
        everConnected = true;
        dialAttempts = 0;
        lastPong = Date.now();
        clearTimers();
        c.on("data", (msg) => {
            if (!msg || typeof msg !== "object") return;
            if (msg.t === "ping") { safeSend({ t: "pong" }); return; }
            if (msg.t === "pong") { lastPong = Date.now(); return; }
            if (handlers.onMessage) handlers.onMessage(msg);
        });
        c.on("close", () => onLost("closed"));
        c.on("error", () => onLost("error"));
        pingTimer = setInterval(() => {
            if (!conn || !conn.open) return;
            safeSend({ t: "ping" });
            if (Date.now() - lastPong > 12000) onLost("timeout");
        }, 3000);
        setStatus("connected", "Connected");
        if (handlers.onOpen) handlers.onOpen(role);
    }

    function onLost(reason) {
        if (!wantConnection) return;
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = null;
        clearTimers();
        setStatus("reconnecting", reason === "timeout"
            ? "No answer from your friend (tab in background or offline?). Reconnecting…"
            : "Connection to your friend was lost. Reconnecting…");
        if (handlers.onClose) handlers.onClose(reason);
        if (role === "guest") retryTimer = setTimeout(dial, 800);
        // host just waits for the guest to dial again
    }

    function handleError(err) {
        if (!wantConnection) return;
        const type = err && err.type;
        if (type === "peer-unavailable") {
            // the host isn't registered at the broker (not there yet, or tabbed out); keep trying quietly
            if (role === "guest") {
                setStatus(everConnected ? "reconnecting" : "connecting",
                    everConnected ? "Your friend seems to be away. Waiting for them to come back…" : "Nobody is in this room yet. Waiting for your friend…");
                retryTimer = setTimeout(dial, 2500);
            }
            return;
        }
        if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed" || type === "disconnected") {
            if (!(conn && conn.open)) setStatus("signaling", ERROR_TEXT[type]);
            retryTimer = setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2500);
            return;
        }
        if (type === "webrtc") {
            setStatus("error", ERROR_TEXT.webrtc);
            if (role === "guest") retryTimer = setTimeout(dial, 4000);
            return;
        }
        setStatus("error", ERROR_TEXT[type] || (err && err.message) || String(err));
    }

    function safeSend(obj) {
        if (conn && conn.open) { try { conn.send(obj); return true; } catch (e) {} }
        return false;
    }

    function send(obj) { return safeSend(obj); }

    function leave() {
        wantConnection = false;
        everConnected = false;
        if (signalingTimer) clearTimeout(signalingTimer);
        clearTimers();
        if (conn) { try { conn.close(); } catch (e) {} }
        if (peer) { try { peer.destroy(); } catch (e) {} }
        conn = peer = null;
        role = null;
        setStatus("idle", "");
    }

    function retryNow() {
        if (!wantConnection || !peer) return;
        if (peer.destroyed) { role === "host" ? claimHost() : joinAsGuest(); return; }
        if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
        if (role === "guest" && !(conn && conn.open)) { if (retryTimer) clearTimeout(retryTimer); dial(); }
    }

    return {
        open, send, leave, retryNow, randomCode, normalizeCode,
        get code() { return code; },
        get role() { return role; },
        get status() { return status; },
        get connected() { return !!(conn && conn.open); },
    };
})();
