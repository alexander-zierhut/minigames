/* App layer: title screen, room lobby (shared game + settings), local & online play,
   rematch, switching games inside one room, reconnect sync, reactions. */

"use strict";

(() => {
    const $ = (id) => document.getElementById(id);
    const SKINS = {
        classic: { names: ["Cyan", "Amber"], cls: "" },
        mcboard: { names: ["Diamond", "Gold"], cls: "skin-mcboard" },   // classic UI, Minecraft board
        mc: { names: ["Diamond", "Gold"], cls: "skin-mc" },
    };
    const GAMES = {
        chain: {
            title: "Chain React",
            tagline: "Fill a cell, it explodes into its neighbours. Take the whole board.",
            engine: ChainGame, sizeMin: 3, sizeMax: 12, defaultSize: 6, hasSpeed: true, hasChainRule: true, hasWinLen: false,
        },
        five: {
            title: "Five Wins",
            tagline: "Place a stone anywhere, no gravity. First to get five in a row wins.",
            engine: FiveGame, sizeMin: 5, sizeMax: 25, defaultSize: 9, hasSpeed: false, hasChainRule: false, hasWinLen: true,
        },
    };
    let Game = ChainGame;   // active engine, switched in startGame
    let selectedGame = "chain";

    const app = {
        mode: "local",          // "local" | "online"
        phase: "menu",          // "menu" | "lobby" | "game"
        myPlayer: -1,           // online: 0 = host, 1 = guest
        config: null,           // config of the running / last game
        gameNo: 0,              // increments per game in this room (local too)
        rematchMine: false,
        rematchTheirs: false,
        incoming: [],           // queued opponent moves while we animate
        pendingSync: null,
        opponentPresent: false,
        opponentLeft: false,
        skin: "classic",
        applyingRemote: false,  // true while writing the friend's settings into the form
    };

    /* ================= settings (shared in the lobby) ================= */
    const SETTINGS_KEY = "chainreact.settings";
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const sizeFor = {};        // remembered board size per game

    function readSettings() {
        const g = GAMES[selectedGame];
        const timerSel = $("set-timer").value;
        const timer = timerSel === "custom" ? Math.round(parseFloat($("set-timer-custom").value || "3") * 60) : parseInt(timerSel, 10);
        const winLen = clamp(parseInt($("set-winlen").value, 10) || 5, 3, 25);
        const nMin = g.hasWinLen ? Math.max(g.sizeMin, winLen) : g.sizeMin;
        return {
            game: selectedGame,
            n: clamp(parseInt($("set-size").value, 10) || g.defaultSize, nMin, g.sizeMax),
            winLen,
            speed: parseInt($("set-speed").value, 10),
            timer: Math.max(0, timer || 0),
            timerSel, timerCustom: $("set-timer-custom").value,
            chainRule: $("set-chain").checked,
            chainLen: Math.max(5, parseInt($("set-chain-len").value, 10) || 15),
        };
    }
    // write a settings object into the form (used for localStorage restore and the friend's changes)
    function writeSettings(s) {
        if (!s) return;
        app.applyingRemote = true;
        if (s.game && GAMES[s.game]) selectedGame = s.game;
        if (s.n) sizeFor[selectedGame] = s.n;
        if (s.winLen) $("set-winlen").value = String(s.winLen);
        if (s.speed) $("set-speed").value = String(s.speed);
        if (s.timerSel) $("set-timer").value = s.timerSel;
        if (s.timerCustom) $("set-timer-custom").value = s.timerCustom;
        $("set-chain").checked = !!s.chainRule;
        if (s.chainLen) $("set-chain-len").value = String(s.chainLen);
        selectGame(selectedGame, false);
        app.applyingRemote = false;
    }
    function saveSettings() {
        sizeFor[selectedGame] = parseInt($("set-size").value, 10);
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), sizeFor })); } catch (e) {}
    }
    function loadSettings() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch (e) {}
        if (!s) return;
        if (s.sizeFor) Object.assign(sizeFor, s.sizeFor);
        writeSettings(s);
    }
    function fillSizes() {
        const g = GAMES[selectedGame];
        const inp = $("set-size");
        const winLen = clamp(parseInt($("set-winlen").value, 10) || 5, 3, 25);
        const nMin = g.hasWinLen ? Math.max(g.sizeMin, winLen) : g.sizeMin;
        inp.min = String(nMin); inp.max = String(g.sizeMax);
        inp.value = String(clamp(sizeFor[selectedGame] || g.defaultSize, nMin, g.sizeMax));
        $("size-hint").textContent = `(${nMin}–${g.sizeMax})`;
    }
    // clamp typed values once the field loses focus (typing "1" on the way to "12" must not snap)
    function clampInputs() {
        const g = GAMES[selectedGame];
        const wl = $("set-winlen");
        if (wl.value !== "") wl.value = String(clamp(parseInt(wl.value, 10) || 5, 3, 25));
        const nMin = g.hasWinLen ? Math.max(g.sizeMin, parseInt(wl.value, 10) || 5) : g.sizeMin;
        const inp = $("set-size");
        inp.min = String(nMin);
        if (inp.value !== "") inp.value = String(clamp(parseInt(inp.value, 10) || g.defaultSize, nMin, g.sizeMax));
        $("size-hint").textContent = `(${nMin}–${g.sizeMax})`;
        settingsChanged();
    }
    function selectGame(key, announce = true) {
        selectedGame = GAMES[key] ? key : "chain";
        const g = GAMES[selectedGame];
        document.querySelectorAll(".game-card").forEach((c) => c.classList.toggle("selected", c.dataset.game === selectedGame));
        $("menu-tagline").textContent = g.tagline;
        $("row-speed").hidden = !g.hasSpeed;
        $("row-chain").hidden = !g.hasChainRule;
        $("row-winlen").hidden = !g.hasWinLen;
        fillSizes();
        if (announce) settingsChanged();
        else { renderSummary(); }
    }
    function syncSettingsUi() {
        $("row-timer-custom").hidden = $("set-timer").value !== "custom";
        $("set-chain-len").disabled = !$("set-chain").checked;
        settingsChanged();
    }
    // any local change: persist, refresh summary, tell the friend
    function settingsChanged() {
        saveSettings();
        renderSummary();
        if (!app.applyingRemote && app.mode === "online") Net.send({ t: "lobby", s: readSettings() });
    }
    function renderSummary() {
        const cfg = readSettings();
        const parts = [`${cfg.n} × ${cfg.n}`];
        if (cfg.game === "five") parts.push(`${cfg.winLen} in a row`);
        parts.push(cfg.timer > 0 ? `${Math.round(cfg.timer / 60 * 10) / 10} min timer` : "no timer");
        if (cfg.game === "chain" && cfg.chainRule) parts.push(`${cfg.chainLen}-chain wins`);
        $("settings-summary").textContent = parts.join(" · ");
    }

    /* ================= skin (per device) ================= */
    const SKIN_KEY = "chainreact.skin";
    function applySkin(skin) {
        if (!SKINS[skin]) skin = "classic";
        document.body.classList.remove("skin-mc", "skin-mcboard");
        if (SKINS[skin].cls) document.body.classList.add(SKINS[skin].cls);
        app.skin = skin;
        document.querySelectorAll(".skin-seg button").forEach((b) => b.classList.toggle("selected", b.dataset.skin === skin));
    }
    function loadSkin() {
        let k = "classic";
        try { k = localStorage.getItem(SKIN_KEY) || "classic"; } catch (e) {}
        applySkin(k);
    }
    function setSkin(k) {
        applySkin(k);
        try { localStorage.setItem(SKIN_KEY, app.skin); } catch (e) {}
        Game.render();
        renderLobby();
    }
    function names() { return SKINS[app.skin || "classic"].names; }

    /* ================= screens ================= */
    function show(name) {
        for (const s of ["menu", "lobby", "game"]) $("screen-" + s).hidden = s !== name;
        app.phase = name;
        if (name === "game") requestAnimationFrame(() => { fitBoard(); requestAnimationFrame(fitBoard); });
        if (name === "lobby") renderLobby();
    }
    function fitBoard() {
        const wrap = $("board-wrap");
        if (!wrap) return;
        const size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight)) - 10; // room for the turn outline
        if (size > 0) document.documentElement.style.setProperty("--board", size + "px");
        requestAnimationFrame(placeReactionLayer);
    }
    // reactions fall next to the board, never over it: right of it when there is room
    // (desktop), otherwise in the free strip above (or below) the full-width board (phones)
    function placeReactionLayer() {
        const r = $("board").getBoundingClientRect();
        const layer = $("react-layer");
        if (r.width === 0) return;
        const W = 60;
        const spaceRight = window.innerWidth - r.right;
        if (spaceRight >= W + 6) {
            layer.style.left = Math.round(r.right + 4) + "px";
            layer.style.top = Math.round(r.top) + "px";
            layer.style.height = Math.round(r.height) + "px";
            return;
        }
        const above = r.top - 56;                           // below the reaction toggle
        const below = ($("hut").getBoundingClientRect().top) - r.bottom;
        layer.style.left = Math.round(window.innerWidth - W - 8) + "px";
        if (above >= 70 || above >= below) {
            layer.style.top = "56px";
            layer.style.height = Math.max(40, Math.round(above - 4)) + "px";
        } else {
            layer.style.top = Math.round(r.bottom + 4) + "px";
            layer.style.height = Math.max(40, Math.round(below - 8)) + "px";
        }
    }
    let toastTimer = null;
    function toast(msg) {
        const el = $("toast");
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
    }

    /* ================= lobby ================= */
    function renderLobby() {
        const online = app.mode === "online";
        const n = names();
        $("lobby-kind").textContent = online ? "Room" : "Local game";
        $("lobby-code").textContent = online ? (Net.code || "…") : "Same device";
        $("lobby-share").hidden = !online;
        $("lobby-players").hidden = !online;
        for (let k = 0; k < 2; k++) {
            $(`lp-${k}`).querySelector(".lp-name").textContent = n[k] + (online && app.myPlayer === k ? " (you)" : "");
            const present = online && (app.myPlayer === k || Net.connected);
            $(`lp-${k}`).classList.toggle("absent", online && !present);
            $(`lp-${k}-status`).textContent = !online ? "" : app.myPlayer === k ? "ready" : (Net.connected ? "connected" : "not here yet");
        }
        const start = $("btn-start");
        if (!online) {
            start.disabled = false;
            start.textContent = "Start game";
            $("lobby-status").textContent = "";
        } else if (!Net.connected) {
            start.disabled = true;
            start.textContent = "Waiting for your friend…";
        } else {
            start.disabled = false;
            start.textContent = app.myPlayer === 0 ? "Start game" : "Start game (asks the host)";
        }
        $("btn-lobby-back").textContent = online ? "Leave room" : "Back";
    }

    function openLocalLobby() {
        Net.leave();
        app.mode = "local";
        app.myPlayer = -1;
        app.gameNo = 0;
        app.config = null;
        clearSession();
        show("lobby");
    }

    function roomLink(code) {
        const url = new URL(location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("room", code);
        return url.toString();
    }

    function enterRoom(code, preferHost) {
        app.mode = "online";
        app.gameNo = 0;
        app.config = null;
        app.opponentPresent = false;
        app.opponentLeft = false;
        Clock.stop();
        show("lobby");
        $("lobby-code").textContent = "…";
        const finalCode = Net.open(code, {
            preferHost,
            onStatus: (s, detail) => {
                if (app.phase === "lobby") { $("lobby-status").textContent = detail || ""; renderLobby(); }
                renderNetBox();
                if (app.phase === "game") renderBanner(s, detail);
            },
            onRole: (role) => {
                app.myPlayer = role === "host" ? 0 : 1;
                renderLobby();
                saveSession();
            },
            onOpen: onPeerOpen,
            onClose: () => { Clock.pause(); renderNetBox(); renderLobby(); },
            onMessage: onMessage,
        }, preferHost === false ? "guest" : undefined);
        $("lobby-code").textContent = finalCode;
        const url = new URL(location.href);
        url.searchParams.set("room", finalCode);
        history.replaceState(null, "", url.toString());
        renderLobby();
    }

    function leaveRoom() {
        if (app.mode === "online") {
            const sent = Net.send({ t: "leave" });
            if (sent) setTimeout(Net.leave, 250); else Net.leave();
        }
        app.config = null;
        app.mode = "local";
        clearSession();
        Clock.stop();
        const url = new URL(location.href);
        url.searchParams.delete("room");
        history.replaceState(null, "", url.toString());
        $("net-banner").hidden = true;
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        show("menu");
    }

    /* ================= game lifecycle ================= */
    const hooks = {
        get names() { return names(); },
        mayPlay: (p) => app.mode === "local" || (p === app.myPlayer && Net.connected),
        turnHint: (p) => app.mode === "local" ? "to move" : (p === app.myPlayer ? "your move" : "waiting for opponent…"),
        onCellClick: (i) => {
            const st = Game.state;
            if (st.busy || st.over) return;
            if (!hooks.mayPlay(st.current)) return;
            if (!Game.isLegal(i, st.current)) return;
            if (app.mode === "online") Net.send({ t: "move", i, n: st.history.length, g: app.gameNo });
            Game.play(i);
        },
        onMoveApplied: () => saveSession(),
        onTurn: (p) => {
            Clock.setActive(p);
            if (app.mode === "local" || Net.connected) Clock.resume();
            processIncoming();
        },
        onBusy: (busy) => {
            if (busy) Clock.pause();
            else {
                if (app.mode === "local" || Net.connected) Clock.resume();
                if (app.pendingSync) { const s = app.pendingSync; app.pendingSync = null; applySync(s); }
                processIncoming();
            }
        },
        onFinish: () => {
            Clock.stop();
            saveSession();
            $("overlay-again").textContent = "Rematch";
            $("overlay-again").disabled = false;
        },
    };

    function onFlag(p) {
        if (Game.state.over) return;
        if (app.mode === "online") {
            if (p !== app.myPlayer) return; // the opponent's device decides about its own clock
            Net.send({ t: "timeout", p, g: app.gameNo });
        }
        Game.finish(1 - p, "Out of time!");
    }

    function startPlayerFor(gameNo) { return (gameNo + 1) % 2; } // host starts game 1, then alternate

    function startGame(cfg, startPlayer) {
        app.config = cfg;
        const g = GAMES[cfg.game || "chain"];
        Game = g.engine;
        document.body.classList.toggle("game-five", cfg.game === "five");
        document.body.classList.toggle("game-chain", cfg.game !== "five");
        $("sign-title").textContent = g.title.toUpperCase();
        $("result-fab").textContent = "Show result";
        $("result-fab").hidden = true;
        $("overlay").hidden = true;
        app.rematchMine = app.rematchTheirs = false;
        app.incoming = [];
        app.pendingSync = null;
        Clock.setup(cfg.timer, onFlag);
        Game.newGame({ ...cfg, startPlayer }, hooks);
        renderNetBox();
        show("game");
        saveSession();
    }

    // Start pressed in the lobby
    function startFromLobby() {
        const cfg = readSettings();
        if (app.mode === "local") {
            app.gameNo++;
            startGame(cfg, startPlayerFor(app.gameNo));
            return;
        }
        if (!Net.connected) return;
        if (app.myPlayer === 0) hostStart(cfg);
        else { Net.send({ t: "start-request" }); toast("Asked the host to start"); }
    }
    function hostStart(cfg) {
        app.gameNo++;
        Net.send({ t: "start", config: cfg, g: app.gameNo });
        startGame(cfg, startPlayerFor(app.gameNo));
        Game.log(`Game ${app.gameNo}: ${GAMES[cfg.game].title}.`, "x");
    }

    // rematch = same config, next game number (online: both must press)
    function requestRematch() {
        if (app.mode === "local") { app.gameNo++; startGame(app.config, startPlayerFor(app.gameNo)); return; }
        app.rematchMine = true;
        Net.send({ t: "rematch", g: app.gameNo + 1 });
        if (app.rematchTheirs) beginRematch(app.gameNo + 1);
        else { $("overlay-again").textContent = "Waiting for opponent…"; $("overlay-again").disabled = true; toast("Rematch requested"); }
    }
    function beginRematch(nextGameNo) {
        app.gameNo = nextGameNo;
        startGame(app.config, startPlayerFor(app.gameNo));
        Game.log("Rematch!", "x");
        sendSync();
    }

    // back to the room lobby to pick another game / settings (either player may do it)
    function backToLobby(announce) {
        if (announce && app.mode === "online") Net.send({ t: "tolobby" });
        Clock.stop();
        if (!Game.state.over && Game.state.history.length) Game.state.over = true; // abandon a running game
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        $("net-banner").hidden = true;
        show("lobby");
        saveSession();
    }

    /* ================= online: protocol ================= */
    function onPeerOpen(role) {
        app.opponentPresent = true;
        app.opponentLeft = false;
        renderNetBox();
        renderLobby();
        $("net-banner").hidden = true;
        if (role === "host") sendState();        // host is the source of truth for phase + settings
        if (app.phase === "game") sendSync();
        if (app.phase === "game" && !Game.state.over) Clock.resume();
    }

    function sendState() {
        Net.send({
            t: "state",
            phase: app.phase === "game" ? "game" : "lobby",
            settings: readSettings(),
            config: app.config,
            g: app.gameNo,
        });
    }

    function sendSync() {
        if (!app.config || app.phase !== "game") return;
        Net.send({ t: "sync", g: app.gameNo, history: Game.state.history.slice(), clocks: Clock.snapshot() });
    }

    function onMessage(msg) {
        switch (msg.t) {
            case "state": {                     // from the host on (re)connect
                if (app.myPlayer !== 1) return;
                writeSettings(msg.settings);
                if (msg.phase === "game" && msg.config) {
                    if (app.phase !== "game" || msg.g !== app.gameNo) {
                        app.gameNo = msg.g;
                        startGame(msg.config, startPlayerFor(app.gameNo));
                        Game.log("Connected to host.", "x");
                    }
                    sendSync();
                } else {
                    app.gameNo = msg.g || app.gameNo;
                    if (app.phase !== "lobby") backToLobby(false);
                    renderLobby();
                }
                break;
            }
            case "lobby":                       // friend changed game / settings
                writeSettings(msg.s);
                if (app.phase === "lobby") toast("Settings updated by your friend");
                break;
            case "start-request":               // guest asked the host to start
                if (app.myPlayer === 0 && app.phase === "lobby" && Net.connected) hostStart(readSettings());
                break;
            case "start":                       // host started a game
                if (app.myPlayer !== 0 && msg.g > app.gameNo) {
                    app.gameNo = msg.g;
                    startGame(msg.config, startPlayerFor(app.gameNo));
                    Game.log(`Game ${app.gameNo}: ${GAMES[msg.config.game].title}.`, "x");
                }
                break;
            case "tolobby":
                if (app.phase === "game") { toast("Your friend went back to the room"); backToLobby(false); }
                break;
            case "sync":
                if (msg.g !== app.gameNo || app.phase !== "game") return;
                if (Game.state.busy) app.pendingSync = msg; else applySync(msg);
                break;
            case "move":
                if (msg.g !== app.gameNo || app.phase !== "game") return;
                app.incoming.push(msg);
                processIncoming();
                break;
            case "timeout":
                if (msg.g !== app.gameNo || Game.state.over) return;
                Game.finish(1 - msg.p, "Out of time!");
                break;
            case "rematch":
                app.rematchTheirs = true;
                if (app.rematchMine) beginRematch(msg.g);
                else {
                    toast("Opponent wants a rematch");
                    $("overlay-again").textContent = "Accept rematch";
                    $("overlay-again").disabled = false;
                    $("result-fab").textContent = "Rematch requested!";
                }
                break;
            case "react": {
                const now = Date.now();
                if (!ALLOWED_REACTIONS.has(msg.e) || now - lastTheirReact < 100) return;
                lastTheirReact = now;
                floatReaction(msg.e, true);
                break;
            }
            case "leave":
                app.opponentPresent = false;
                app.opponentLeft = true;
                Clock.pause();
                renderNetBox();
                renderLobby();
                if (app.phase === "game") renderBanner("reconnecting");
                else $("lobby-status").textContent = "Your friend left the room.";
                break;
        }
    }

    function processIncoming() {
        const st = Game.state;
        if (app.phase !== "game" || st.busy || st.over) return;
        while (app.incoming.length) {
            const m = app.incoming[0];
            if (m.n < st.history.length) { app.incoming.shift(); continue; }
            if (m.n > st.history.length) { sendSync(); return; }
            app.incoming.shift();
            if (st.current !== 1 - app.myPlayer || !Game.isLegal(m.i, st.current)) { sendSync(); return; }
            Game.play(m.i);
            return;
        }
    }

    function applySync(msg) {
        const mine = Game.state.history;
        const theirs = msg.history || [];
        const common = Math.min(mine.length, theirs.length);
        for (let k = 0; k < common; k++) if (mine[k] !== theirs[k]) { Game.log("Move history differs, keeping the longer one.", "x"); break; }
        if (theirs.length > mine.length) {
            Game.replay(theirs.slice(mine.length));
            if (msg.clocks) Clock.restore(msg.clocks);
            saveSession();
        } else if (mine.length > theirs.length) {
            sendSync();
        }
        if (!Game.state.over) { Clock.setActive(Game.state.current); if (Net.connected) Clock.resume(); }
        Game.render();
        processIncoming();
    }

    /* ================= net UI ================= */
    function renderNetBox() {
        const box = $("net-box");
        box.hidden = app.mode !== "online";
        if (app.mode !== "online") return;
        const s = Net.status;
        $("net-dot").className = "net-dot " + s;
        $("net-text").textContent = ({ connected: "Connected", waiting: "Waiting for friend", reconnecting: "Reconnecting…", connecting: "Connecting…", signaling: "Room server reconnecting…", error: "Connection error" })[s] || s;
        $("net-code").textContent = Net.code ? "Room " + Net.code : "";
        $("p0-you").hidden = app.myPlayer !== 0;
        $("p1-you").hidden = app.myPlayer !== 1;
        Game.render();
    }

    function renderBanner(status, detail) {
        const banner = $("net-banner");
        if (status === "connected" || status === "idle") { banner.hidden = true; return; }
        if (status === "signaling" && Net.connected) { banner.hidden = true; return; }
        $("net-banner-text").textContent = app.opponentLeft
            ? "Your friend left the room. The game resumes if they come back."
            : detail || "Reconnecting…";
        $("btn-net-retry").hidden = !(status === "reconnecting" || status === "error" || status === "signaling");
        banner.hidden = false;
    }

    /* ================= emoji reactions ================= */
    let lastReact = 0;
    let lastTheirReact = 0;
    const ALLOWED_REACTIONS = new Set([...document.querySelectorAll("#react-bar .react-list button")].map((b) => b.dataset.e));
    function floatReaction(e, theirs) {
        const layer = $("react-layer");
        while (layer.children.length > 14) layer.firstChild.remove();
        const el = document.createElement("div");
        const isChip = e.length <= 3 && /^[A-Z]+$/.test(e);
        el.className = "react-float" + (isChip ? " chip" : "") + (theirs ? " theirs" : "");
        el.textContent = e;
        if (theirs) el.style.setProperty("--their-color", app.myPlayer === 0 ? "var(--c1)" : "var(--c0)");
        layer.appendChild(el);
        const drift = -(14 + Math.random() * 12);           // start a bit right, end a bit left
        const wob = (Math.random() - 0.5) * 30;
        const fall = Math.max(30, $("react-layer").clientHeight - 24);
        // falls down from the corner: pop in, tumble, fade out
        el.animate([
            { transform: `translate(calc(-50% + 12px), 0) scale(.6) rotate(0deg)`, opacity: 0 },
            { transform: `translate(calc(-50% + 8px), ${Math.round(fall * 0.15)}px) scale(1.15) rotate(${wob * 0.3}deg)`, opacity: 1, offset: 0.15 },
            { transform: `translate(calc(-50% + ${drift * 0.6}px), ${Math.round(fall * 0.6)}px) scale(1) rotate(${wob}deg)`, opacity: .85, offset: 0.6 },
            { transform: `translate(calc(-50% + ${drift}px), ${fall}px) scale(.9) rotate(${-wob * 0.5}deg)`, opacity: 0 },
        ], { duration: 1900, easing: "cubic-bezier(.2,.6,.3,1)", fill: "forwards" }).onfinish = () => el.remove();
    }
    function sendReaction(e) {
        const now = Date.now();
        if (now - lastReact < 120) return;          // ~8 per second is plenty of spam
        lastReact = now;
        floatReaction(e, false);
        if (app.mode === "online") Net.send({ t: "react", e });
    }

    /* ================= session (survive a page refresh) ================= */
    const SESSION_KEY = "chainreact.session";
    function saveSession() {
        if (app.mode !== "online") return;
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                code: Net.code, myPlayer: app.myPlayer, gameNo: app.gameNo, phase: app.phase,
                config: app.config, history: app.phase === "game" ? Game.state.history.slice() : [], clocks: Clock.snapshot(),
            }));
        } catch (e) {}
    }
    function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
    function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }

    /* ================= wiring ================= */
    // title screen
    $("btn-create").addEventListener("click", () => enterRoom(Net.randomCode(), true));
    $("btn-join-open").addEventListener("click", () => {
        const panel = $("join-panel");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) $("join-code").focus();
    });
    $("btn-join").addEventListener("click", () => {
        const code = Net.normalizeCode($("join-code").value);
        if (code.length < 4) { toast("Enter the 5-letter room code"); $("join-code").focus(); return; }
        enterRoom(code, false);
    });
    $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });
    $("join-code").addEventListener("input", () => { $("join-code").value = Net.normalizeCode($("join-code").value); });
    $("btn-local").addEventListener("click", openLocalLobby);
    document.querySelectorAll(".skin-seg button").forEach((b) => b.addEventListener("click", () => setSkin(b.dataset.skin)));

    // lobby
    $("btn-share").addEventListener("click", async () => {
        const link = roomLink(Net.code);
        const title = GAMES[selectedGame].title;
        if (navigator.share) {
            try { await navigator.share({ title: "ALZlper's Minigames", text: `Play ${title} with me!`, url: link }); return; } catch (e) { /* cancelled */ }
        }
        try { await navigator.clipboard.writeText(link); toast("Link copied"); }
        catch (e) { prompt("Copy this link:", link); }
    });
    $("btn-copy-code").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(Net.code); toast("Code copied"); }
        catch (e) { prompt("Room code:", Net.code); }
    });
    $("btn-lobby-back").addEventListener("click", leaveRoom);
    $("btn-start").addEventListener("click", startFromLobby);
    document.querySelectorAll(".game-card").forEach((c) => c.addEventListener("click", () => selectGame(c.dataset.game)));
    $("btn-settings").addEventListener("click", () => { $("settings-modal").hidden = false; });
    $("btn-settings-done").addEventListener("click", () => { clampInputs(); $("settings-modal").hidden = true; });
    $("settings-modal").addEventListener("click", (e) => { if (e.target === $("settings-modal")) { clampInputs(); $("settings-modal").hidden = true; } });
    for (const id of ["set-speed", "set-timer", "set-timer-custom", "set-chain", "set-chain-len"]) {
        $(id).addEventListener("change", syncSettingsUi);
        $(id).addEventListener("input", syncSettingsUi);
    }
    for (const id of ["set-size", "set-winlen"]) $(id).addEventListener("change", clampInputs);

    // in game
    $("gear").addEventListener("click", () => $("hut").classList.toggle("show-controls"));
    $("btn-restart").addEventListener("click", () => { if (!Game.state.busy) requestRematch(); });
    $("btn-menu").addEventListener("click", () => backToLobby(true));
    $("overlay-again").addEventListener("click", requestRematch);
    $("overlay-look").addEventListener("click", () => { $("overlay").hidden = true; $("result-fab").hidden = false; });
    $("result-fab").addEventListener("click", () => { $("result-fab").hidden = true; $("overlay").hidden = false; });
    $("overlay-menu").addEventListener("click", () => backToLobby(true));
    $("btn-net-retry").addEventListener("click", () => Net.retryNow());
    $("btn-net-leave").addEventListener("click", leaveRoom);
    document.querySelectorAll("#react-bar .react-list button").forEach((b) => b.addEventListener("click", () => sendReaction(b.dataset.e)));
    $("react-toggle").addEventListener("click", () => $("react-bar").classList.toggle("collapsed"));

    window.addEventListener("resize", fitBoard);
    new ResizeObserver(fitBoard).observe($("hut"));
    window.addEventListener("beforeunload", () => { if (app.mode === "online") saveSession(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && app.mode === "online") Net.retryNow(); });
    window.addEventListener("online", () => { if (app.mode === "online") Net.retryNow(); });

    /* ================= texture preload (first visit) ================= */
    // Browsers only fetch CSS background images once an element uses them, so the
    // Minecraft textures would pop in on the first click. Collect every image url from
    // the stylesheet and fetch them up front, with a small progress bar if it takes a moment.
    function preloadTextures() {
        const urls = new Set();
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }
            const base = sheet.href || location.href;
            for (const rule of rules) {
                for (const m of (rule.cssText || "").matchAll(/url\(["']?([^"')]+\.(?:png|jpg|webp|gif))["']?\)/g)) {
                    try { urls.add(new URL(m[1], base).href); } catch (e) {}
                }
            }
        }
        const list = [...urls];
        if (list.length === 0) return Promise.resolve();
        const loader = $("loader"), fill = $("loader-fill"), text = $("loader-text");
        let done = 0;
        const showTimer = setTimeout(() => { loader.hidden = false; }, 120); // no flash when everything is cached
        const update = () => {
            const pct = Math.round(done / list.length * 100);
            fill.style.width = pct + "%";
            text.textContent = `Loading textures… ${done}/${list.length}`;
        };
        update();
        const one = (u) => new Promise((res) => {
            const img = new Image();
            img.onload = img.onerror = () => { done++; update(); res(); };
            img.src = u;
        });
        const all = Promise.all(list.map(one));
        const timeout = new Promise((res) => setTimeout(res, 6000)); // never block the game on a slow image
        return Promise.race([all, timeout]).then(() => { clearTimeout(showTimer); loader.hidden = true; });
    }

    /* ================= boot ================= */
    preloadTextures();
    loadSkin();
    loadSettings();
    selectGame(selectedGame, false);

    const params = new URLSearchParams(location.search);
    const roomFromUrl = Net.normalizeCode(params.get("room"));
    const session = loadSession();
    if (roomFromUrl && session && session.code === roomFromUrl) {
        // page refresh inside a room: rebuild, then re-sync with the friend
        enterRoom(roomFromUrl, session.myPlayer === 0);
        app.myPlayer = session.myPlayer;
        app.gameNo = session.gameNo || 0;
        if (session.phase === "game" && session.config) {
            startGame(session.config, startPlayerFor(app.gameNo));
            Game.replay(session.history || []);
            Clock.restore(session.clocks);
            Clock.pause();
            Game.log("Rejoining room " + roomFromUrl + "…", "x");
        }
    } else if (roomFromUrl) {
        enterRoom(roomFromUrl, false);
    } else {
        show("menu");
    }
})();
