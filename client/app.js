/* App layer: title screen → room lobby → game. Local play on one device and online
   play through Net (host-authoritative room protocol), rematch and switching games
   inside one room, reconnect re-sync, page-refresh session restore, board fitting.
   Everything game-specific goes through the engine interface (see games.js). */

"use strict";

(() => {
    const { $, toast } = Util;

    /* ================= state ================= */
    const app = {
        mode: "local",          // "local" | "online"
        phase: "menu",          // "menu" | "lobby" | "game"
        me: -1,                 // my seat (player number) online; -1 = not assigned yet / local mode.
                                // Seats are sticky for the room visit; the transport role (host/guest) may swap.
        seats: [],              // per player: { kind: "local" | "remote" }  (a bot would be another kind)
        config: null,           // config of the running / last game
        gameNo: 0,              // increments per game in this room (local too)
        rematchMine: false,
        rematchTheirs: false,
        incoming: [],           // queued friend moves while we animate
        pendingSync: null,      // sync deferred while animating
        opponentLeft: false,    // the friend said goodbye (banner wording)
    };
    let Game = Games.get(Games.keys()[0]).engine;     // active engine, switched in startGame

    const online = () => app.mode === "online";
    const friendHere = () => Net.connected && !app.opponentLeft;   // a "leave" arrives before the connection drops
    const live = () => !online() || friendHere();                  // the game may run (clock, input)
    const seatIsLocal = (p) => !!app.seats[p] && app.seats[p].kind === "local";
    const otherPlayer = (p, players = 2) => (p + 1) % players;
    const makeSeats = (players) => Array.from({ length: players }, (_, p) => ({ kind: online() && p !== app.me ? "remote" : "local" }));
    const playerColor = (p) => `var(--c${p})`;
    const isHost = () => Net.role === "host";     // transport role: the host is the room's source of truth
    // take a seat (room creation, session restore, or assigned by the host in `state`)
    function setSeat(me) {
        app.me = me;
        if (app.config) app.seats = makeSeats(app.config.players || 2);
        renderNetBox();
        renderLobby();
        saveSession();
    }
    function startPlayerFor(gameNo, players = 2) { return (gameNo - 1) % players; }   // host starts game 1, then the next seat

    /* ================= screens & board fitting ================= */
    function show(name) {
        for (const s of ["menu", "lobby", "game"]) $("screen-" + s).hidden = s !== name;
        app.phase = name;
        if (name === "game") requestAnimationFrame(() => { fitBoard(); requestAnimationFrame(fitBoard); });
        if (name === "lobby") renderLobby();
    }
    // the board is a square of min(wrapper width, height) minus room for the turn outline
    function fitBoard() {
        const wrap = $("board-wrap");
        const size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight)) - 10;
        if (size > 0) document.documentElement.style.setProperty("--board", size + "px");
        requestAnimationFrame(Reactions.place);
    }

    /* ================= lobby ================= */
    function renderLobby() {
        const names = Skins.names();
        const players = Settings.read().players;
        $("lobby-kind").textContent = online() ? "Room" : "Local game";
        $("lobby-code").textContent = online() ? (Net.code || "…") : "Same device";
        $("lobby-share").hidden = !online();
        $("lobby-players").hidden = !online();
        const box = $("lobby-players");
        if (box.children.length !== players) {
            box.innerHTML = "";
            for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-lobby-player", k));
        }
        for (let k = 0; k < players; k++) {
            const mine = app.me === k;
            const present = mine || friendHere();
            $(`lp-${k}`).querySelector(".lp-name").textContent = names[k] + (online() && mine ? " (you)" : "");
            $(`lp-${k}`).classList.toggle("absent", online() && !present);
            $(`lp-${k}-status`).textContent = !online() ? "" : mine ? "ready" : (friendHere() ? "connected" : "not here yet");
        }
        const start = $("btn-start");
        if (!online()) {
            start.disabled = false;
            start.textContent = "Start game";
            $("lobby-status").textContent = "";
        } else if (!friendHere()) {
            start.disabled = true;
            start.textContent = "Waiting for your friend…";
        } else {
            start.disabled = false;
            start.textContent = isHost() ? "Start game" : "Start game (asks the host)";
        }
        $("btn-lobby-back").textContent = online() ? "Leave room" : "Back";
    }

    function openLocalLobby() {
        Net.leave();
        app.mode = "local";
        app.me = -1;
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
    function setUrlRoom(code) {
        const url = new URL(location.href);
        if (code) url.searchParams.set("room", code); else url.searchParams.delete("room");
        history.replaceState(null, "", url.toString());
    }

    // preferHost: true = I created / hosted this room, false = joining by code or link.
    // seat: my player number if I already have one (creator: 0, refresh: from the session).
    function enterRoom(code, preferHost, seat = -1) {
        app.mode = "online";
        app.me = seat;
        app.gameNo = 0;
        app.config = null;
        app.opponentLeft = false;
        Clock.stop();
        show("lobby");
        $("lobby-code").textContent = "…";
        const finalCode = Net.open(code, {
            preferHost,
            onStatus: (status, detail) => {
                if (app.phase === "lobby") { $("lobby-status").textContent = detail; renderLobby(); }
                renderNetBox();
                if (app.phase === "game") renderBanner(status, detail);
            },
            onRole: (role) => { if (role === "host" && app.me < 0) setSeat(0); renderLobby(); saveSession(); },
            onOpen: onPeerOpen,
            onClose: () => { Clock.pause(); renderNetBox(); renderLobby(); },
            onMessage,
        }, preferHost === false ? "guest" : undefined);
        $("lobby-code").textContent = finalCode;
        setUrlRoom(finalCode);
        renderLobby();
    }

    function leaveRoom() {
        if (online()) {
            const sent = Net.send({ t: "leave" });
            if (sent) setTimeout(Net.leave, 250); else Net.leave();   // let the goodbye go out first
        }
        app.config = null;
        app.mode = "local";
        clearSession();
        Clock.stop();
        setUrlRoom(null);
        $("net-banner").hidden = true;
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        show("menu");
    }

    /* ================= engine hooks ================= */
    const hooks = {
        get names() { return Skins.names(); },
        // may this device move for player p right now? (a bot seat would be handled in onTurn instead)
        mayPlay: (p) => seatIsLocal(p) && live(),
        turnHint: (p) => !online() ? "to move" : (p === app.me ? "your move" : "waiting for opponent…"),
        onCellClick: (i) => {
            const st = Game.state;
            if (st.busy || st.over || !hooks.mayPlay(st.current) || !Game.isLegal(i, st.current)) return;
            if (online()) Net.send({ t: "move", i, n: st.history.length, g: app.gameNo });
            Game.play(i);
        },
        onMoveApplied: () => saveSession(),
        onTurn: (p) => {
            Clock.setActive(p);
            if (live()) Clock.resume();
            processIncoming();
        },
        onBusy: (busy) => {
            if (busy) { Clock.pause(); return; }
            if (live()) Clock.resume();
            if (app.pendingSync) { const s = app.pendingSync; app.pendingSync = null; applySync(s); }
            processIncoming();
        },
        onFinish: () => {
            Clock.stop();
            saveSession();
            $("overlay-again").textContent = "Rematch";
            $("overlay-again").disabled = false;
        },
    };

    // a clock ran out; online only the owner of that clock decides (clocks drift)
    function onFlag(p) {
        if (Game.state.over) return;
        if (online()) {
            if (p !== app.me) return;
            Net.send({ t: "timeout", p, g: app.gameNo });
        }
        Game.finish(otherPlayer(p, Game.state.players), "Out of time!");
    }

    /* ================= game lifecycle ================= */
    function startGame(cfg, startPlayer) {
        app.config = cfg;
        const def = Games.get(cfg.game);
        Game = def.engine;
        app.seats = makeSeats(cfg.players || 2);
        document.body.className = document.body.className.replace(/\bgame-\S+/g, "").trim();
        document.body.classList.add("game-" + def.key);
        $("sign-title").textContent = def.title.toUpperCase();
        $("result-fab").textContent = "Show result";
        $("result-fab").hidden = true;
        $("overlay").hidden = true;
        app.rematchMine = app.rematchTheirs = false;
        app.incoming = [];
        app.pendingSync = null;
        Clock.setup(cfg.timer, onFlag, cfg.players || 2);
        Game.newGame({ ...cfg, startPlayer }, hooks);
        renderNetBox();
        show("game");
        saveSession();
    }

    // Start pressed in the lobby (online: host starts, guest asks the host)
    function startFromLobby() {
        const cfg = Settings.read();
        if (!online()) { app.gameNo++; startGame(cfg, startPlayerFor(app.gameNo)); return; }
        if (!friendHere()) return;
        if (isHost()) hostStart(cfg);
        else { Net.send({ t: "start-request" }); toast("Asked the host to start"); }
    }
    function hostStart(cfg) {
        app.gameNo++;
        Net.send({ t: "start", config: cfg, g: app.gameNo });
        startGame(cfg, startPlayerFor(app.gameNo));
        Log.add(`Game ${app.gameNo}: ${Games.get(cfg.game).title}.`, "x");
    }

    // rematch = same config, next game number (online: both must press)
    function requestRematch() {
        if (!online()) { app.gameNo++; startGame(app.config, startPlayerFor(app.gameNo)); return; }
        app.rematchMine = true;
        Net.send({ t: "rematch", g: app.gameNo + 1 });
        if (app.rematchTheirs) beginRematch(app.gameNo + 1);
        else {
            $("overlay-again").textContent = "Waiting for opponent…";
            $("overlay-again").disabled = true;
            toast("Rematch requested");
        }
    }
    function beginRematch(nextGameNo) {
        app.gameNo = nextGameNo;
        startGame(app.config, startPlayerFor(app.gameNo));
        Log.add("Rematch!", "x");
        sendSync();
    }

    // back to the room lobby to pick another game / settings (either player may do it)
    function backToLobby(announce) {
        if (announce && online()) Net.send({ t: "tolobby" });
        Clock.stop();
        Game.abandon();
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        $("net-banner").hidden = true;
        show("lobby");
        saveSession();
    }

    /* ================= online protocol =================
       Handshake on every (re)connect: guest -> hello {seat}; host -> state {you, phase, settings,
       config, g} (+ sync in a game); guest -> sync. The host is the source of truth for the
       room; seats are sticky, so a refresh, a leave-and-rejoin or a host/guest role swap keeps
       everybody's colour. */
    function onPeerOpen(role) {
        app.opponentLeft = false;
        renderNetBox();
        renderLobby();
        $("net-banner").hidden = true;
        if (role === "guest") Net.send({ t: "hello", seat: app.me });
        if (app.phase === "game" && !Game.state.over) Clock.resume();
    }

    function sendState(guestSeat) {
        Net.send({ t: "state", you: guestSeat, phase: app.phase === "game" ? "game" : "lobby", settings: Settings.read(), config: app.config, g: app.gameNo });
    }
    function sendSync() {
        if (!app.config || app.phase !== "game") return;
        Net.send({ t: "sync", g: app.gameNo, history: Game.state.history.slice(), clocks: Clock.snapshot() });
    }

    const inThisGame = (msg) => msg.g === app.gameNo && app.phase === "game";

    const HANDLERS = {
        // a guest (re)connected: give it its old seat back if that is free, else the free one
        hello(msg) {
            if (!isHost()) return;
            const seat = msg.seat >= 0 && msg.seat !== app.me ? msg.seat : otherPlayer(app.me);
            sendState(seat);
            if (app.phase === "game") sendSync();
        },
        // from the host on every (re)connect: take my seat, mirror settings, join a running game
        state(msg) {
            if (isHost()) return;
            if (msg.you >= 0 && msg.you !== app.me) setSeat(msg.you);
            Settings.write(msg.settings);
            if (msg.phase === "game" && msg.config) {
                if (app.phase !== "game" || msg.g !== app.gameNo) {
                    app.gameNo = msg.g;
                    startGame(msg.config, startPlayerFor(app.gameNo));
                    Log.add("Connected to host.", "x");
                }
                sendSync();
            } else {
                app.gameNo = msg.g || app.gameNo;
                if (app.phase !== "lobby") backToLobby(false);
                renderLobby();
            }
        },
        lobby(msg) {                                  // the friend changed game / settings
            Settings.write(msg.s);
            if (app.phase === "lobby") toast("Settings updated by your friend");
        },
        "start-request"() {                           // the guest asked the host to start
            if (isHost() && app.phase === "lobby" && friendHere()) hostStart(Settings.read());
        },
        start(msg) {                                  // the host started a game
            if (isHost() || msg.g <= app.gameNo) return;
            app.gameNo = msg.g;
            startGame(msg.config, startPlayerFor(app.gameNo));
            Log.add(`Game ${app.gameNo}: ${Games.get(msg.config.game).title}.`, "x");
        },
        tolobby() {
            if (app.phase === "game") { toast("Your friend went back to the room"); backToLobby(false); }
        },
        sync(msg) {
            if (!inThisGame(msg)) return;
            if (Game.state.busy) app.pendingSync = msg; else applySync(msg);
        },
        move(msg) {
            if (!inThisGame(msg)) return;
            app.incoming.push(msg);
            processIncoming();
        },
        timeout(msg) {
            if (msg.g !== app.gameNo || Game.state.over) return;
            Game.finish(otherPlayer(msg.p, Game.state.players), "Out of time!");
        },
        rematch(msg) {
            app.rematchTheirs = true;
            if (app.rematchMine) { beginRematch(msg.g); return; }
            toast("Opponent wants a rematch");
            $("overlay-again").textContent = "Accept rematch";
            $("overlay-again").disabled = false;
            $("result-fab").textContent = "Rematch requested!";
        },
        react(msg) {
            Reactions.receive(msg.e, playerColor(otherPlayer(app.me)));
        },
        leave() {
            app.opponentLeft = true;
            Clock.pause();
            renderNetBox();
            renderLobby();
            if (app.phase === "game") renderBanner("reconnecting");
            else $("lobby-status").textContent = "Your friend left the room.";
        },
    };
    function onMessage(msg) {
        const handler = HANDLERS[msg.t];
        if (handler) handler(msg);
    }

    // apply queued friend moves in order; a gap means we missed something -> ask for a sync
    function processIncoming() {
        const st = Game.state;
        if (app.phase !== "game" || st.busy || st.over) return;
        while (app.incoming.length) {
            const m = app.incoming[0];
            if (m.n < st.history.length) { app.incoming.shift(); continue; }   // already applied
            if (m.n > st.history.length) { sendSync(); return; }
            app.incoming.shift();
            if (seatIsLocal(st.current) || !Game.isLegal(m.i, st.current)) { sendSync(); return; }
            Game.play(m.i);
            return;
        }
    }

    // the longer history wins; the shorter side replays the missing tail
    function applySync(msg) {
        const mine = Game.state.history;
        const theirs = msg.history || [];
        const common = Math.min(mine.length, theirs.length);
        for (let k = 0; k < common; k++) if (mine[k] !== theirs[k]) { Log.add("Move history differs, keeping the longer one.", "x"); break; }
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
    const STATUS_TEXT = { connected: "Connected", waiting: "Waiting for friend", reconnecting: "Reconnecting…", connecting: "Connecting…", signaling: "Room server reconnecting…", error: "Connection error" };
    function renderNetBox() {
        $("net-box").hidden = !online();
        if (!online()) return;
        $("net-dot").className = "net-dot " + Net.status;
        $("net-text").textContent = STATUS_TEXT[Net.status] || Net.status;
        $("net-code").textContent = Net.code ? "Room " + Net.code : "";
        for (let k = 0; k < 4; k++) { const you = $(`p${k}-you`); if (you) you.hidden = app.me !== k; }
        Game.render();                               // cell locks depend on the connection
    }
    function renderBanner(status, detail) {
        const banner = $("net-banner");
        const fine = status === "connected" || status === "idle" || (status === "signaling" && Net.connected);
        if (fine) { banner.hidden = true; return; }
        $("net-banner-text").textContent = app.opponentLeft
            ? "Your friend left the room. The game resumes if they come back."
            : detail || "Reconnecting…";
        $("btn-net-retry").hidden = !["reconnecting", "error", "signaling"].includes(status);
        banner.hidden = false;
    }

    /* ================= session (survive a page refresh) ================= */
    const SESSION_KEY = "chainreact.session";
    function saveSession() {
        if (!online()) return;
        Util.save(sessionStorage, SESSION_KEY, {
            code: Net.code, me: app.me, role: Net.role, gameNo: app.gameNo, phase: app.phase, config: app.config,
            history: app.phase === "game" ? Game.state.history.slice() : [], clocks: Clock.snapshot(),
        });
    }
    const clearSession = () => Util.remove(sessionStorage, SESSION_KEY);
    const loadSession = () => Util.load(sessionStorage, SESSION_KEY);

    /* ================= wiring ================= */
    // title screen
    $("btn-create").addEventListener("click", () => enterRoom(Net.randomCode(), true, 0));
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

    // lobby
    $("btn-share").addEventListener("click", async () => {
        const link = roomLink(Net.code);
        const title = Games.get(Settings.game).title;
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

    window.addEventListener("resize", fitBoard);
    new ResizeObserver(fitBoard).observe($("hut"));
    window.addEventListener("beforeunload", () => saveSession());
    document.addEventListener("visibilitychange", () => { if (!document.hidden && online()) Net.retryNow(); });
    window.addEventListener("online", () => { if (online()) Net.retryNow(); });

    /* ================= boot ================= */
    Preload.textures();
    Skins.init({ onChange: () => { Game.render(); renderLobby(); } });
    Settings.init({ onChange: (cfg) => { if (online()) Net.send({ t: "lobby", s: cfg }); } });
    Reactions.init({ onSend: (e) => { if (online()) Net.send({ t: "react", e }); } });

    const roomFromUrl = Net.normalizeCode(new URLSearchParams(location.search).get("room"));
    const session = loadSession();
    if (roomFromUrl && session && session.code === roomFromUrl) {
        // page refresh inside a room: rebuild from the session, then re-sync with the friend
        const me = session.me ?? session.myPlayer ?? -1;   // myPlayer: sessions saved before the refactor
        enterRoom(roomFromUrl, session.role ? session.role === "host" : me === 0, me);
        app.gameNo = session.gameNo || 0;
        if (session.phase === "game" && session.config) {
            startGame(session.config, startPlayerFor(app.gameNo));
            Game.replay(session.history || []);
            Clock.restore(session.clocks);
            Clock.pause();
            Log.add("Rejoining room " + roomFromUrl + "…", "x");
        }
    } else if (roomFromUrl) {
        enterRoom(roomFromUrl, false);
    } else {
        show("menu");
    }
})();
