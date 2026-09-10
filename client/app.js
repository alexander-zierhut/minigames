/* App layer: title screen → room lobby → game. Local play on one device (2–4 people),
   against a bot, and online play through Net (host-authoritative room protocol for up
   to four seats: the host relays what a guest says to the others), rematch and
   switching games inside one room, reconnect re-sync, page-refresh session restore,
   board fitting. Everything game-specific goes through the engine interface (games.js). */

"use strict";

(() => {
    const { $, toast } = Util;

    /* ================= state ================= */
    const app = {
        mode: "local",          // "local" | "bot" | "online"   (bot = offline against a bot)
        bot: null,              // bot mode: { id, difficulty, instance } for the running game
        phase: "menu",          // "menu" | "lobby" | "game"
        me: -1,                 // my seat (player number) online; -1 = not assigned yet / local mode / spectator.
                                // Seats are sticky for the room visit; the transport role (host/guest) may swap.
        spectator: false,       // online without a seat on purpose (spectate link) or because every seat is taken
        seats: [],              // per player: { kind: "local" | "remote" | "bot" }
        config: null,           // config of the running / last game
        gameNo: 0,              // increments per game in this room (local too)
        rev: 0,                 // room-state revision: +1 per phase change (start, rematch, back to room).
                                // On reconnect the higher revision wins, whoever hosts.
        syncSentAt: -1,         // history length of my last sync message (-1 = none since my last move)
        rebuiltAt: null,        // "gameNo:length" of my last rebuild from the host (second time = give up)
        rematchVotes: new Set(),// seats that pressed Rematch for the next game (everyone must)
        incoming: [],           // queued friend moves while we animate
        pendingSync: null,      // sync deferred while animating
        pendingOuts: [],        // timeouts deferred while animating
        roster: { present: [], spectators: 0, left: [] },   // who is here (guests: from the host's roster message)
        left: new Set(),        // seats that said goodbye (their connection may still be closing) — banner wording
        netDetail: "",          // last status detail from Net (banner text)
    };
    let Game = Games.get(Games.keys()[0]).engine;     // active engine, switched in startGame

    const online = () => app.mode === "online";
    const isHost = () => Net.role === "host";     // transport role: the host is the room's source of truth
    const seatIsLocal = (p) => !!app.seats[p] && app.seats[p].kind === "local";
    const seatIsBot = (p) => !!app.seats[p] && app.seats[p].kind === "bot";
    const otherPlayer = (p, players = 2) => (p + 1) % players;
    // seats of the running game, else of the settings (the lobby)
    const playersNow = () => (app.phase === "game" && app.config ? app.config.players : Settings.read().players) || 2;
    const names = () => Skins.names();
    const two = () => playersNow() === 2;
    // how a seat is called in messages: with two players the classic "your friend", else the colour name
    const who = (seat) => (two() ? "Your friend" : names()[seat] || "Someone");
    // who moves for each seat: this device, the friend, or a bot (bot mode: you are seat 0)
    const makeSeats = (players) => Array.from({ length: players }, (_, p) => ({
        kind: online() ? (p === app.me ? "local" : "remote") : (app.mode === "bot" && p > 0 ? "bot" : "local"),
    }));
    const playerColor = (p) => (p >= 0 ? `var(--c${p})` : "#ffffff");
    function startPlayerFor(gameNo, players = 2) { return (gameNo - 1) % players; }   // seat 0 starts game 1, then the next seat

    /* ---------- presence: who of the seats is here ---------- */
    const seatOf = (id) => { const p = Net.peers.find((x) => x.id === id); return p ? p.seat : -1; };
    // per seat: is somebody there? Host: from its connections; guest: from the host's roster; me: always
    function presentSeats() {
        const n = playersNow();
        const present = new Array(n).fill(!online());
        if (!online()) return present;
        if (app.me >= 0 && app.me < n) present[app.me] = true;
        if (!Net.connected) return present;
        if (isHost()) { for (const p of Net.peers) if (p.open && p.seat >= 0 && p.seat < n && !app.left.has(p.seat)) present[p.seat] = true; }
        else for (let k = 0; k < n; k++) if (app.roster.present[k]) present[k] = true;
        return present;
    }
    const missingSeats = () => presentSeats().map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
    const allHere = () => online() && Net.connected && missingSeats().length === 0;   // every seat filled and connected
    const live = () => !online() || allHere();                                        // the game may run (clock, input)
    const someoneLeft = (seats) => seats.some((k) => app.left.has(k) || app.roster.left.includes(k));

    // host: what everyone should know about presence; sent on every change
    function computeRoster() {
        const n = playersNow();
        let spectators = 0;
        for (const p of Net.peers) if (p.open && (p.seat < 0 || p.seat >= n)) spectators++;
        return { present: presentSeats(), spectators, left: [...app.left] };
    }
    function rosterChanged() {
        if (!online()) return;
        if (isHost()) { app.roster = computeRoster(); netSend({ t: "roster", ...app.roster }); }
        presenceChanged();
    }
    // both sides, after any change of who is here
    function presenceChanged() {
        renderNetBox();
        renderLobby();
        syncLive();
        updateBanner();
    }
    // the clock runs only while everyone is here and nothing animates
    function syncLive() {
        if (app.phase !== "game" || Game.state.over) return;
        if (live() && !Game.state.busy) Clock.resume(); else Clock.pause();
    }

    // take a seat (room creation, session restore, or assigned by the host in `state`)
    function setSeat(me) {
        app.me = me;
        if (app.config) app.seats = makeSeats(app.config.players || 2);
        renderNetBox();
        renderLobby();
        saveSession();
    }

    /* ================= screens & board fitting ================= */
    function show(name) {
        for (const s of ["menu", "lobby", "game"]) $("screen-" + s).hidden = s !== name;
        app.phase = name;
        if (name === "game") requestAnimationFrame(() => { fitBoard(); requestAnimationFrame(fitBoard); });
        if (name === "lobby") renderLobby();
    }
    // the board is a square of min(wrapper width, height) minus room for the turn outline
    // (the wrapper's padding keeps it clear of the corner buttons on phones)
    function fitBoard() {
        const wrap = $("board-wrap");
        const cs = getComputedStyle(wrap);
        const h = wrap.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
        const w = wrap.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        const size = Math.floor(Math.min(w, h)) - 10;
        if (size > 0) document.documentElement.style.setProperty("--board", size + "px");
        Reactions.place();                               // layout is synchronous: the board rect is final here
    }

    /* ================= lobby ================= */
    function renderLobby() {
        const nm = names();
        const players = Settings.read().players;
        const bot = app.mode === "bot";
        $("lobby-kind").textContent = online() ? "Room" : bot ? "Against a bot" : "Local game";
        $("lobby-code").textContent = online() ? (Net.code || "…") : bot ? "You vs bot" : "Same device";
        $("btn-opponent").hidden = !bot;
        if (bot) $("opponent-summary").textContent = Opponent.summary(Settings.game);
        $("lobby-share").hidden = !online();
        $("lobby-players").hidden = !online();
        const box = $("lobby-players");
        if (box.children.length !== players) {
            box.innerHTML = "";
            for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-lobby-player", k));
        }
        const present = presentSeats();
        for (let k = 0; k < players; k++) {
            const mine = app.me === k;
            $(`lp-${k}`).querySelector(".lp-name").textContent = nm[k] + (online() && mine ? " (you)" : "");
            $(`lp-${k}`).classList.toggle("absent", online() && !present[k]);
            $(`lp-${k}-status`).textContent = !online() ? "" : mine ? "ready" : (present[k] ? "connected" : "not here yet");
        }
        const watching = online() ? app.roster.spectators : 0;
        $("lobby-spectators").textContent = watching > 0 ? `${watching} spectator${watching > 1 ? "s" : ""} watching` : "";
        const start = $("btn-start");
        if (!online()) {
            start.disabled = bot && !Opponent.current(Settings.game);
            start.textContent = "Start game";
            $("lobby-status").textContent = "";
        } else if (app.spectator) {
            start.disabled = true;
            start.textContent = "Spectating";
        } else if (!allHere()) {
            const missing = missingSeats().length;
            start.disabled = true;
            start.textContent = players === 2 ? "Waiting for your friend…" : `Waiting for ${missing} more player${missing === 1 ? "" : "s"}…`;
        } else {
            start.disabled = false;
            start.textContent = isHost() ? "Start game" : "Start game (asks the host)";
        }
        $("btn-lobby-back").textContent = online() ? "Leave room" : "Back";
    }

    // offline lobby: two to four people on this device, or you against a bot
    function openLocalLobby(withBot) {
        Net.leave();
        app.mode = withBot ? "bot" : "local";
        app.me = -1;
        app.spectator = false;
        app.gameNo = 0;
        app.config = null;
        app.bot = null;
        clearSession();
        Chat.enable(false);
        Settings.setMode(app.mode);
        show("lobby");
    }

    function roomLink(code, spectate) {
        const url = new URL(location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("room", code);
        if (spectate) url.searchParams.set("spectate", "1");
        return url.toString();
    }
    function setUrlRoom(code) {
        const url = new URL(location.href);
        if (code) url.searchParams.set("room", code); else { url.searchParams.delete("room"); url.searchParams.delete("spectate"); }
        if (code && app.spectator) url.searchParams.set("spectate", "1");
        history.replaceState(null, "", url.toString());
    }

    // preferHost: true = I created / hosted this room, false = joining by code or link.
    // seat: my player number if I already have one (creator: 0, refresh: from the session).
    // spectate: watch only (spectate link, or a refresh of a spectator).
    function enterRoom(code, preferHost, seat = -1, spectate = false) {
        app.mode = "online";
        app.me = spectate ? -1 : seat;
        app.spectator = spectate;
        app.gameNo = 0;
        app.rev = 0;
        app.config = null;
        app.left = new Set();
        app.roster = { present: [], spectators: 0, left: [] };
        app.rematchVotes = new Set();
        Clock.stop();
        Chat.enable(true);
        Settings.setMode("online");
        show("lobby");
        $("lobby-code").textContent = "…";
        const finalCode = Net.open(code, {
            preferHost,
            onStatus: (status, detail) => {
                app.netDetail = detail;
                if (app.phase === "lobby") { $("lobby-status").textContent = detail; renderLobby(); }
                renderNetBox();
                updateBanner(status);
            },
            onRole: (role) => {
                if (role === "host") { app.left.clear(); if (app.me < 0 && !app.spectator) setSeat(0); }
                renderLobby();
                saveSession();
            },
            onOpen: onPeerOpen,
            onClose: (reason, id) => { if (isHost()) rosterChanged(); else { Clock.pause(); presenceChanged(); } },
            onMessage,
            metadata: () => ({ seat: app.me, spectate: app.spectator }),
            admit: admitGuest,
        }, preferHost === false ? "guest" : undefined);
        $("lobby-code").textContent = finalCode;
        setUrlRoom(finalCode);
        renderLobby();
    }

    function leaveRoom() {
        BotPersona.detach();
        if (online()) {
            const sent = netSend({ t: "leave" });
            if (sent) setTimeout(Net.leave, 250); else Net.leave();   // let the goodbye go out first
        }
        app.config = null;
        app.mode = "local";
        app.spectator = false;
        clearSession();
        Clock.stop();
        Chat.enable(false);
        setUrlRoom(null);
        $("net-banner").hidden = true;
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        show("menu");
    }

    /* ================= engine hooks ================= */
    const hooks = {
        // player names for the HUD: the skin's colour names; a bot seat shows the bot's name
        get names() { return names().map((n, p) => (seatIsBot(p) && app.bot ? app.bot.def.name : n)); },
        // may this device move for player p right now? (bot seats move in onTurn)
        mayPlay: (p) => seatIsLocal(p) && live(),
        turnHint: (p) => seatIsBot(p) ? "thinking…" : !online() ? "to move"
            : app.spectator ? "spectating" : p === app.me ? "your move" : two() ? "waiting for opponent…" : `waiting for ${hooks.names[p]}…`,
        onCellClick: (i) => {
            const st = Game.state;
            if (st.busy || st.over || !hooks.mayPlay(st.current) || !Game.isLegal(i, st.current)) return;
            if (online()) netSend({ t: "move", i, n: st.history.length, g: app.gameNo, h: Game.hash() });
            Game.play(i);
        },
        onMoveApplied: () => { app.syncSentAt = -1; saveSession(); },
        onTurn: (p) => {
            Clock.setActive(p);
            if (live()) Clock.resume();
            if (seatIsBot(p)) botTurn(p);
            else processIncoming();
        },
        onBusy: (busy) => {
            if (busy) { Clock.pause(); return; }
            if (live()) Clock.resume();
            if (app.pendingSync) { const s = app.pendingSync; app.pendingSync = null; applySync(s); }
            while (app.pendingOuts.length && !Game.state.over) flagged(app.pendingOuts.shift());
            processIncoming();
        },
        onFinish: () => {
            Clock.stop();
            saveSession();
            $("overlay-again").textContent = app.spectator ? "Spectating" : "Rematch";
            $("overlay-again").disabled = app.spectator;
        },
    };

    // a clock ran out; online only the owner of that clock decides (clocks drift)
    function onFlag(p) {
        if (Game.state.over) return;
        if (online()) {
            if (p !== app.me) return;
            netSend({ t: "timeout", p, g: app.gameNo });
        }
        flagged(p);
    }
    // a player is out of time: with two players the other one wins, with more the player is out
    function flagged(p) {
        if (Game.state.over) return;
        if (Game.state.busy) { app.pendingOuts.push(p); return; }
        Game.eliminate(p, "Out of time!");
        saveSession();
    }

    /* ================= bot seat ================= */
    const THINK_MS = 350;      // a bot answering instantly feels wrong

    // the bot's move: ask its instance on a copy of the state, then play it like a click
    function botTurn(p) {
        const gameNo = app.gameNo;
        const bot = app.bot;
        if (!bot) return;
        const stillOn = () => app.phase === "game" && gameNo === app.gameNo && app.bot === bot && !Game.state.over && !Game.state.busy && Game.state.current === p;
        setTimeout(async () => {
            if (!stillOn()) return;
            let i;
            try { i = await bot.move(bot.tools.clone(Game.state)); }
            catch (e) { console.error(`bot ${bot.def.id} failed`, e); Log.add(`${bot.def.name} crashed — picking a random move.`, "x"); }
            if (!stillOn()) return;
            if (!Game.isLegal(i, p)) i = bot.tools.pick(bot.tools.legalMoves(Game.state, p));
            if (i !== undefined) Game.play(i);
        }, THINK_MS);
    }

    /* ================= game lifecycle ================= */
    function startGame(cfg, startPlayer) {
        app.rev++;
        app.config = cfg;
        const players = cfg.players || 2;
        const def = Games.get(cfg.game);
        Game = def.engine;
        app.seats = makeSeats(players);
        if (app.mode === "bot") {
            const choice = Opponent.current(cfg.game);
            // seed: fresh per game so the bot varies; tests pin it via sessionStorage["chainreact.botseed"]
            const seed = (Number(Util.load(sessionStorage, "chainreact.botseed")) || Date.now()) + app.gameNo;
            app.bot = choice ? Bots.create(choice.id, { me: 1, difficulty: choice.difficulty, seed: seed >>> 0, players }) : null;
            if (!app.bot) app.seats[1].kind = "local";                     // no bot for this game: play both sides
            if (app.bot) { const est = Bots.estimator(def.key); BotPersona.attach({ bot: app.bot, seat: 1, game: def.key, state: () => Game.state, estimate: (st) => est.at(st, 300), color: playerColor(1) }); }
            else BotPersona.detach();
        } else { app.bot = null; BotPersona.detach(); }
        document.body.className = document.body.className.replace(/\bgame-\S+/g, "").trim();
        document.body.classList.add("game-" + def.key);
        $("sign-title").textContent = def.title.toUpperCase();
        $("result-fab").textContent = "Show result";
        $("result-fab").hidden = true;
        $("overlay").hidden = true;
        app.rematchVotes = new Set();
        app.incoming = [];
        app.pendingSync = null;
        app.pendingOuts = [];
        $("btn-restart").disabled = app.spectator;
        $("btn-restart").textContent = app.spectator ? "Spectating" : "Rematch";
        Clock.setup(cfg.timer, onFlag, players);
        Game.newGame({ ...cfg, startPlayer }, hooks);
        renderNetBox();
        show("game");
        updateBanner();
        saveSession();
    }

    // Start pressed in the lobby (online: host starts, guest asks the host)
    function startFromLobby() {
        const cfg = Settings.read();
        if (!online()) { app.gameNo++; startGame(cfg, startPlayerFor(app.gameNo, cfg.players)); return; }
        if (!allHere() || app.spectator) return;
        if (isHost()) hostStart(cfg);
        else { netSend({ t: "start-request" }); toast("Asked the host to start"); }
    }
    function hostStart(cfg) {
        app.gameNo++;
        netSend({ t: "start", config: cfg, g: app.gameNo });
        startGame(cfg, startPlayerFor(app.gameNo, cfg.players));
        Log.add(`Game ${app.gameNo}: ${Games.get(cfg.game).title}.`, "x");
    }

    // rematch = same config, next game number (online: every player must press)
    function requestRematch() {
        if (!online()) { app.gameNo++; startGame(app.config, startPlayerFor(app.gameNo, app.config.players)); return; }
        if (app.spectator) return;
        app.rematchVotes.add(app.me);
        netSend({ t: "rematch", g: app.gameNo + 1 });
        if (rematchComplete()) return;
        $("overlay-again").textContent = rematchWaitText();
        $("overlay-again").disabled = true;
        toast("Rematch requested");
    }
    const rematchWaitText = () => (two() ? "Waiting for opponent…" : `Waiting for others… (${app.rematchVotes.size}/${playersNow()})`);
    // everyone pressed: start the next game
    function rematchComplete() {
        for (let k = 0; k < playersNow(); k++) if (!app.rematchVotes.has(k)) return false;
        beginRematch(app.gameNo + 1);
        return true;
    }
    function beginRematch(nextGameNo) {
        app.gameNo = nextGameNo;
        startGame(app.config, startPlayerFor(app.gameNo, app.config.players));
        Log.add("Rematch!", "x");
        sendSync();
    }

    // back to the room lobby to pick another game / settings (anyone may do it)
    function backToLobby(announce) {
        BotPersona.detach();
        if (announce && online()) netSend({ t: "tolobby" });
        app.rev++;
        Clock.stop();
        Game.abandon();
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        $("net-banner").hidden = true;
        show("lobby");
        saveSession();
    }

    /* ================= online protocol =================
       Handshake on every (re)connect: guest -> hello {seat, spectate}; host -> state {you, phase,
       settings, config, g} (+ sync in a game) to that guest, roster to everyone; guest -> sync.
       The host is the source of truth for the room and relays game messages between guests
       (every message carries `from` = the sender's seat). Seats are sticky, so a refresh, a
       leave-and-rejoin or a host/guest role swap keeps everybody's colour. */
    const RELAY = new Set(["move", "chat", "react", "tolobby", "rematch", "timeout", "lobby"]);
    // every message I originate carries my seat
    const netSend = (obj) => Net.send({ from: app.me, ...obj });

    function onPeerOpen(role) {
        app.syncSentAt = -1;
        if (role === "guest") { app.left.clear(); netSend({ t: "hello", seat: app.me, spectate: app.spectator, ...roomState() }); }
        presenceChanged();                            // host: the guest's hello assigns its seat and sends the roster
    }

    // host: may a newcomer without a seat of ours join? Always — with every seat taken it
    // becomes a spectator (a returning seat holder replaces its stale connection inside Net)
    function admitGuest() { return true; }
    const takenSeats = (exceptId) => new Set([app.me, ...Net.peers.filter((p) => p.open && p.id !== exceptId).map((p) => p.seat)]);
    function freeSeat(taken, n) { for (let k = 0; k < n; k++) if (!taken.has(k)) return k; return -1; }

    // host: the number of seats changed (settings) — nobody keeps a seat that no longer
    // exists, and people without a seat get a free one (unless they chose to spectate)
    function reseat() {
        if (!isHost() || !online()) return;
        const n = playersNow();
        if (app.me >= n) { const s = freeSeat(takenSeats(), n); app.spectator = s < 0; setSeat(s); }
        for (const p of Net.peers) if (p.open && p.seat >= n) { Net.setSeat(p.id, -1); sendState(p.id, -1); }
        for (const p of Net.peers) {
            if (!p.open || p.seat >= 0 || (p.meta && p.meta.spectate)) continue;
            const s = freeSeat(takenSeats(), n);
            if (s < 0) break;
            Net.setSeat(p.id, s);
            sendState(p.id, s);
        }
        rosterChanged();
    }

    // what both sides tell each other on (re)connect; `rematch` = I pressed Rematch while you were away
    function roomState() {
        return {
            rev: app.rev, phase: app.phase === "game" ? "game" : "lobby", config: app.config, g: app.gameNo,
            rematch: app.phase === "game" && Game.state.over && app.rematchVotes.has(app.me),
        };
    }
    function sendState(id, guestSeat) {
        Net.sendTo(id, { t: "state", from: app.me, you: guestSeat, settings: Settings.read(), ...roomState() });
    }
    function syncMessage() {
        const st = Game.state;
        return { t: "sync", g: app.gameNo, history: st.history.slice(), outs: st.outs.slice(), clocks: Clock.snapshot(), h: Game.hash() };
    }
    function sendSync() {
        if (!app.config || app.phase !== "game") return;
        app.syncSentAt = Game.state.history.length;
        netSend(syncMessage());
    }
    function sendSyncTo(id) {
        if (!app.config || app.phase !== "game") return;
        Net.sendTo(id, { from: app.me, ...syncMessage() });
    }
    // the friend's phase is newer than mine (my last phase change never reached them, or theirs never reached me)
    function adoptRoomState(msg) {
        app.gameNo = msg.g || app.gameNo;
        if (msg.phase === "game" && msg.config) {
            if (app.phase !== "game" || msg.g !== app.gameNo) startGame(msg.config, startPlayerFor(app.gameNo, msg.config.players));
            Log.add("Joined your friend's game.", "x");
        } else if (app.phase !== "lobby") {
            backToLobby(false);
            toast("Your friend went back to the room");
        }
        app.rev = msg.rev;
    }

    const inThisGame = (msg) => msg.g === app.gameNo && app.phase === "game";

    const HANDLERS = {
        // a guest (re)connected: give it its old seat back if that is free, else a free one,
        // else it watches (also when it asked to spectate)
        hello(msg, id) {
            if (!isHost()) return;
            const n = playersNow();
            const taken = takenSeats(id);
            let seat = -1;
            if (!msg.spectate) seat = (msg.seat >= 0 && msg.seat < n && !taken.has(msg.seat)) ? msg.seat : freeSeat(taken, n);
            Net.setSeat(id, seat);
            if (seat >= 0) app.left.delete(seat);
            if (msg.rev > app.rev) adoptRoomState(msg);       // the guest's phase is newer: follow it before answering
            sendState(id, seat);
            if (app.phase === "game") sendSyncTo(id);
            if (msg.rematch && seat >= 0) {                     // pressed Rematch while away: counts, and the others learn it
                HANDLERS.rematch({ g: app.gameNo + 1, from: seat });
                Net.sendExcept(id, { t: "rematch", g: app.gameNo + 1, from: seat });
            }
            rosterChanged();
        },
        // from the host on every (re)connect: take my seat, mirror settings, follow the host's phase
        // (the host already adopted mine if it was newer, so ties are the normal case)
        state(msg) {
            if (isHost()) return;
            const you = msg.you >= 0 ? msg.you : -1;
            app.spectator = you < 0;
            app.left.clear();
            if (you !== app.me) setSeat(you);
            Settings.write(msg.settings);
            if (msg.rev >= app.rev) {
                if (msg.phase === "game" && msg.config) {
                    if (app.phase !== "game" || msg.g !== app.gameNo) {
                        app.gameNo = msg.g;
                        startGame(msg.config, startPlayerFor(app.gameNo, msg.config.players));
                        Log.add("Connected to host.", "x");
                    }
                    app.rev = msg.rev;
                    sendSync();
                } else {
                    app.gameNo = msg.g || app.gameNo;
                    if (app.phase !== "lobby") backToLobby(false);
                    app.rev = msg.rev;
                    renderLobby();
                }
            }
            setUrlRoom(Net.code);
            if (msg.rematch) HANDLERS.rematch({ g: app.gameNo + 1, from: msg.from });
        },
        roster(msg) {                                 // the host's view of who is here
            if (isHost()) return;
            app.roster = { present: msg.present || [], spectators: msg.spectators || 0, left: msg.left || [] };
            presenceChanged();
        },
        lobby(msg) {                                  // somebody changed game / settings
            Settings.write(msg.s);
            if (app.phase === "lobby") toast(two() ? "Settings updated by your friend" : `Settings updated by ${names()[msg.from] || "your friend"}`);
            reseat();
        },
        "start-request"() {                           // a guest asked the host to start
            if (isHost() && app.phase === "lobby" && allHere()) hostStart(Settings.read());
        },
        start(msg) {                                  // the host started a game
            if (isHost() || msg.g <= app.gameNo) return;
            app.gameNo = msg.g;
            startGame(msg.config, startPlayerFor(app.gameNo, msg.config.players));
            Log.add(`Game ${app.gameNo}: ${Games.get(msg.config.game).title}.`, "x");
        },
        tolobby(msg) {
            if (app.phase === "game") { toast(`${who(msg.from)} went back to the room`); backToLobby(false); }
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
            if (msg.g !== app.gameNo || app.phase !== "game" || Game.state.over) return;
            flagged(msg.p);
        },
        rematch(msg) {
            if (msg.g <= app.gameNo || app.phase !== "game" || !(msg.from >= 0)) return;   // stale / duplicate request
            app.rematchVotes.add(msg.from);
            if (rematchComplete()) return;
            if (app.rematchVotes.has(app.me)) { $("overlay-again").textContent = rematchWaitText(); return; }
            toast(two() ? "Opponent wants a rematch" : `${names()[msg.from]} wants a rematch`);
            $("overlay-again").textContent = "Accept rematch";
            $("overlay-again").disabled = app.spectator;
            $("result-fab").textContent = "Rematch requested!";
        },
        react(msg) {
            Reactions.receive(msg.e, playerColor(Number.isInteger(msg.from) ? msg.from : otherPlayer(app.me)));
        },
        chat(msg) {                                   // a chat line; `from` = the sender's seat (-1 spectator)
            Chat.receive({ text: msg.text, from: Number.isInteger(msg.from) ? msg.from : otherPlayer(app.me) });
        },
        leave(msg, id) {                              // somebody says goodbye (their connection closes right after)
            const seat = isHost() ? seatOf(id) : (Number.isInteger(msg.from) ? msg.from : -1);
            if (seat >= 0) { app.left.add(seat); if (!isHost()) app.roster.present[seat] = false; }
            Clock.pause();
            if (isHost()) rosterChanged(); else presenceChanged();
            if (app.phase !== "game" && seat >= 0) $("lobby-status").textContent = `${who(seat)} left the room.`;
        },
    };
    function onMessage(msg, id) {
        if (isHost() && id !== "host") {
            msg.from = seatOf(id);                    // the host stamps every guest message with its seat…
            if (RELAY.has(msg.t)) Net.sendExcept(id, msg);   // …and passes game messages on to the other guests
        }
        const handler = HANDLERS[msg.t];
        if (handler) handler(msg, id);
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
            if (m.h !== undefined && m.h !== Game.hash()) { sendSync(); return; }   // boards differ: sort it out first
            Game.play(m.i);
            return;
        }
    }

    /* Sync = the friend's move history (+ eliminations) + state hash. The longer history wins
       when the shorter one is its prefix (the short side replays the tail). Anything else is a
       desync: the guest rebuilds the game from the host's history; if the boards still differ
       after that, both go back to the room rather than playing two different games. */
    function applySync(msg) {
        const theirs = msg.history || [];
        const mine = Game.state.history;
        const common = Math.min(mine.length, theirs.length);
        for (let k = 0; k < common; k++) if (mine[k] !== theirs[k]) { resolveDesync(msg); return; }
        if (theirs.length > mine.length) {
            Game.replay(theirs.slice(mine.length), msg.outs);
            if (msg.clocks) Clock.restore(msg.clocks);
            saveSession();
        } else if (theirs.length < mine.length) {
            // I am ahead. If I already told the host and it still doesn't have my moves, it rejected them.
            if (!isHost() && app.syncSentAt === mine.length) { resolveDesync(msg); return; }
            sendSync();
            afterSync();
            return;
        } else if (msg.outs && msg.outs.length) Game.replay([], msg.outs);   // same moves, maybe a flag fall I missed
        if (msg.h !== undefined && Game.state.history.length === theirs.length && msg.h !== Game.hash()) { resolveDesync(msg); return; }
        afterSync();
    }
    function afterSync() {
        if (!Game.state.over) { Clock.setActive(Game.state.current); if (live()) Clock.resume(); }
        Game.render();
        processIncoming();
    }
    function resolveDesync(msg) {
        if (isHost()) { sendSync(); return; }                  // the guest rebuilds from us
        const key = `${app.gameNo}:${(msg.history || []).length}`;
        if (app.rebuiltAt === key) {                            // rebuilt once already and still different: give up
            Log.add("Out of sync with your friend.", "x");
            toast("Game out of sync — back to the room");
            backToLobby(true);
            return;
        }
        startGame(app.config, startPlayerFor(app.gameNo, app.config.players));
        app.rebuiltAt = key;
        app.rev--;                                              // a rebuild is not a new phase
        Game.replay(msg.history || [], msg.outs);
        if (msg.clocks) Clock.restore(msg.clocks);
        Log.add("Re-synced with the host.", "x");
        sendSync();
        afterSync();
    }

    /* ================= net UI ================= */
    const STATUS_TEXT = { connected: "Connected", waiting: "Waiting for friend", reconnecting: "Reconnecting…", connecting: "Connecting…", signaling: "Room server reconnecting…", error: "Connection error" };
    function renderNetBox() {
        $("net-box").hidden = !online();
        if (!online()) return;
        $("net-dot").className = "net-dot " + Net.status;
        const missing = Net.connected ? missingSeats().length : 0;
        $("net-text").textContent = app.spectator && Net.connected ? "Spectating" : missing && !two() ? `Waiting for ${missing}…` : (STATUS_TEXT[Net.status] || Net.status);
        $("net-code").textContent = Net.code ? "Room " + Net.code : "";
        for (let k = 0; k < 4; k++) { const you = $(`p${k}-you`); if (you) you.hidden = app.me !== k; }
        Game.render();                               // cell locks depend on the connection
    }
    // the in-game banner: my connection is in trouble, or a seat is empty (the game waits)
    function updateBanner(status = Net.status) {
        const banner = $("net-banner");
        if (app.phase !== "game" || !online()) { banner.hidden = true; return; }
        const missing = missingSeats();
        const connectionFine = status === "connected" || status === "idle" || (status === "signaling" && Net.connected);
        if (connectionFine && missing.length === 0) { banner.hidden = true; return; }
        let text;
        if (Net.connected && missing.length) {
            const gone = someoneLeft(missing);
            text = two()
                ? (gone ? "Your friend left the room. The game resumes if they come back." : "Your friend seems to be away. The game resumes when they are back.")
                : `Waiting for ${missing.map((k) => names()[k]).join(", ")}${gone ? " (left the room)" : ""}. The game resumes when everyone is back.`;
        } else text = app.left.size
            ? (two() ? "Your friend left the room. The game resumes if they come back." : `${[...app.left].map((k) => names()[k]).join(", ")} left the room. The game resumes if they come back.`)
            : app.netDetail || "Reconnecting…";
        $("net-banner-text").textContent = text;
        $("btn-net-retry").hidden = !["reconnecting", "error", "signaling"].includes(status);
        banner.hidden = false;
    }

    /* ================= session (survive a page refresh) ================= */
    const SESSION_KEY = "chainreact.session";
    function saveSession() {
        if (!online()) return;
        Util.save(sessionStorage, SESSION_KEY, {
            code: Net.code, me: app.me, spectator: app.spectator, role: Net.role, gameNo: app.gameNo, rev: app.rev, phase: app.phase, config: app.config,
            history: app.phase === "game" ? Game.state.history.slice() : [], outs: app.phase === "game" ? Game.state.outs.slice() : [], clocks: Clock.snapshot(),
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
    $("btn-local").addEventListener("click", () => openLocalLobby(false));
    $("btn-bot").addEventListener("click", () => openLocalLobby(true));
    $("btn-opponent").addEventListener("click", () => Opponent.open(Settings.game));

    // lobby
    async function shareLink(link, text) {
        if (navigator.share) {
            try { await navigator.share({ title: "ALZlper's Minigames", text, url: link }); return; } catch (e) { /* cancelled */ }
        }
        try { await navigator.clipboard.writeText(link); toast("Link copied"); }
        catch (e) { prompt("Copy this link:", link); }
    }
    $("btn-share").addEventListener("click", () => shareLink(roomLink(Net.code), `Play ${Games.get(Settings.game).title} with me!`));
    $("btn-share-spectate").addEventListener("click", () => shareLink(roomLink(Net.code, true), `Watch us play ${Games.get(Settings.game).title}!`));
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
    Prefs.init({
        // what the feedback link reports about the current situation (never the room code or chat)
        context: () => ({
            screen: app.phase, mode: app.mode, game: app.phase === "game" && app.config ? app.config.game : Settings.game,
            settings: Settings.summary(), players: app.config ? app.config.players : Settings.read().players,
            seat: online() ? app.me : undefined, spectator: online() ? app.spectator : undefined,
            bot: app.bot ? `${app.bot.def.id} (${app.bot.difficulty})` : undefined,
            net: online() ? `${Net.status} as ${Net.role}` : "offline",
            look: Skins.current, sound: `${Prefs.get().soundSet} ${Prefs.get().volume} %`,
            log: [...document.querySelectorAll("#log > div:not(.chat)")].slice(0, 5).map((d) => d.textContent),
        }),
    });
    Sound.init({ seats: () => app.seats.map((s) => s.kind) });
    Settings.init({
        onChange: (cfg) => { if (online()) { netSend({ t: "lobby", s: cfg }); reseat(); } },
        // picking a game keeps the default opponent (best bot, middle level, #12); the Opponent row opens the picker
        onSelectGame: () => { if (app.mode === "bot" && app.phase === "lobby") renderLobby(); },
    });
    Opponent.init({ onDone: () => renderLobby() });
    Reactions.init({ onSend: (e) => { if (online()) netSend({ t: "react", e }); } });
    Chat.init({
        online,
        me: () => app.me,
        name: (seat) => (seat >= 0 ? hooks.names[seat] || `Player ${seat + 1}` : "Spectator"),
        onSend: (text) => netSend({ t: "chat", text }),
    });

    const params = new URLSearchParams(location.search);
    const roomFromUrl = Net.normalizeCode(params.get("room"));
    const spectateFromUrl = params.get("spectate") === "1";
    const session = loadSession();
    if (roomFromUrl && session && session.code === roomFromUrl) {
        // page refresh inside a room: rebuild from the session, then re-sync with the friends
        const me = session.me ?? session.myPlayer ?? -1;   // myPlayer: sessions saved before the refactor
        enterRoom(roomFromUrl, session.role ? session.role === "host" : me === 0, me, !!session.spectator);
        app.gameNo = session.gameNo || 0;
        if (session.phase === "game" && session.config) {
            startGame(session.config, startPlayerFor(app.gameNo, session.config.players));
            Game.replay(session.history || [], session.outs || []);
            Clock.restore(session.clocks);
            Clock.pause();
            Log.add("Rejoining room " + roomFromUrl + "…", "x");
        }
        app.rev = session.rev || 0;
    } else if (roomFromUrl) {
        enterRoom(roomFromUrl, false, -1, spectateFromUrl);
    } else {
        Settings.setMode("local");
        show("menu");
    }
})();
