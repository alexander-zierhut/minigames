/* App layer: the screens (title → room lobby → game), the lobby, the flow between them
   (start, rematch, back to room, leave) and the wiring of every module at boot.
   Local play, against a bot and online share the same flow: Match owns the table (seats,
   engine, clock, bot), Room the online protocol; app.js only switches screens and renders
   the lobby. Everything game-specific goes through the engine interface (games.js). */

"use strict";

(() => {
    const { $, toast } = Util;
    let phase = "menu";          // "menu" | "lobby" | "game"

    /* ================= screens & board fitting ================= */
    function show(name) {
        for (const s of ["menu", "lobby", "game"]) $("screen-" + s).hidden = s !== name;
        phase = name;
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
        const online = Room.online;
        const bot = Match.mode === "bot";
        const nm = Skins.names();
        const players = Settings.read().players;
        $("lobby-kind").textContent = online ? "Room" : bot ? "Against a bot" : "Local game";
        $("lobby-code").textContent = online ? (Net.code || "…") : bot ? "You vs bot" : "Same device";
        $("btn-opponent").hidden = !bot;
        if (bot) $("opponent-summary").textContent = Opponent.summary(Settings.game);
        $("lobby-share").hidden = !online;
        $("lobby-players").hidden = !online;
        const box = $("lobby-players");
        if (box.children.length !== players) {
            box.innerHTML = "";
            for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-lobby-player", k));
        }
        const present = Room.presentSeats();
        for (let k = 0; k < players; k++) {
            const mine = Match.me === k;
            $(`lp-${k}`).querySelector(".lp-name").textContent = nm[k] + (online && mine ? " (you)" : "");
            $(`lp-${k}`).classList.toggle("absent", online && !present[k]);
            $(`lp-${k}-status`).textContent = !online ? "" : mine ? "ready" : (present[k] ? "connected" : "not here yet");
        }
        const watching = online ? Room.spectators : 0;
        $("lobby-spectators").textContent = watching > 0 ? `${watching} spectator${watching > 1 ? "s" : ""} watching` : "";
        const start = $("btn-start");
        if (!online) {
            start.disabled = bot && !Opponent.current(Settings.game);
            start.textContent = "Start game";
            $("lobby-status").textContent = "";
        } else if (Match.spectator) {
            start.disabled = true;
            start.textContent = "Spectating";
        } else if (!Room.allHere()) {
            const missing = Room.missingSeats().length;
            start.disabled = true;
            start.textContent = players === 2 ? "Waiting for your friend…" : `Waiting for ${missing} more player${missing === 1 ? "" : "s"}…`;
        } else {
            start.disabled = false;
            start.textContent = Room.isHost ? "Start game" : "Start game (asks the host)";
        }
        $("btn-lobby-back").textContent = online ? "Leave room" : "Back";
    }

    // the Rematch buttons (HUD + overlay) and the "Show result" button follow the rematch state
    function renderRematch() {
        const spec = Match.spectator;
        $("btn-restart").disabled = spec;
        $("btn-restart").textContent = spec ? "Spectating" : "Rematch";
        const again = $("overlay-again");
        if (spec) { again.textContent = "Spectating"; again.disabled = true; }
        else if (Room.online && Room.votedMyself) { again.textContent = Room.rematchWaitText(); again.disabled = true; }
        else if (Room.online && Room.votes.size > 0) { again.textContent = "Accept rematch"; again.disabled = false; $("result-fab").textContent = "Rematch requested!"; }
        else { again.textContent = "Rematch"; again.disabled = false; }
    }

    /* ================= flow ================= */
    // offline lobby: two to four people on this device, or you against a bot
    function openLocalLobby(withBot) {
        Room.leave();
        Match.reset(withBot ? "bot" : "local");
        Settings.setMode(Match.mode);
        show("lobby");
    }

    function leaveRoom() {
        Room.leave();
        Match.reset("local");
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        show("menu");
    }

    // game number `gameNo` with `cfg` at this table (local, bot or online — Room calls this too)
    function startGame(cfg, gameNo) {
        Room.newGame();
        Match.start(cfg, gameNo);
        $("result-fab").textContent = "Show result";
        $("result-fab").hidden = true;
        renderRematch();
        show("game");
        Room.render();
    }

    // Start pressed in the lobby (online: host starts, guest asks the host)
    function startFromLobby() {
        const cfg = Settings.read();
        if (Room.online) Room.startFromLobby(cfg);
        else startGame(cfg, Match.gameNo + 1);
    }

    // rematch = same config, next game number (online: every player must press)
    function requestRematch() {
        if (Room.online) Room.requestRematch();
        else startGame(Match.config, Match.gameNo + 1);
    }

    // back to the room lobby to pick another game / settings (anyone may do it)
    function backToLobby(announce) {
        if (announce && Room.online) Room.tolobby();
        Room.bump();
        Match.stop();
        $("overlay").hidden = true;
        $("result-fab").hidden = true;
        $("net-banner").hidden = true;
        show("lobby");
        Room.save();
    }

    /* ================= wiring ================= */
    // title screen
    $("btn-create").addEventListener("click", () => Room.enter(Net.randomCode(), true, 0));
    $("btn-join-open").addEventListener("click", () => {
        const panel = $("join-panel");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) $("join-code").focus();
    });
    $("btn-join").addEventListener("click", () => {
        const code = Net.normalizeCode($("join-code").value);
        if (code.length < 4) { toast("Enter the 5-letter room code"); $("join-code").focus(); return; }
        Room.enter(code, false);
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
    $("btn-share").addEventListener("click", () => shareLink(Room.roomLink(Net.code), `Play ${Games.get(Settings.game).title} with me!`));
    $("btn-share-spectate").addEventListener("click", () => shareLink(Room.roomLink(Net.code, true), `Watch us play ${Games.get(Settings.game).title}!`));
    $("btn-copy-code").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(Net.code); toast("Code copied"); }
        catch (e) { prompt("Room code:", Net.code); }
    });
    $("btn-lobby-back").addEventListener("click", leaveRoom);
    $("btn-start").addEventListener("click", startFromLobby);

    // in game
    $("gear").addEventListener("click", () => $("hut").classList.toggle("show-controls"));
    $("btn-restart").addEventListener("click", () => { if (!Match.state.busy) requestRematch(); });
    $("btn-menu").addEventListener("click", () => backToLobby(true));
    $("overlay-again").addEventListener("click", requestRematch);
    $("overlay-look").addEventListener("click", () => { $("overlay").hidden = true; $("result-fab").hidden = false; });
    $("result-fab").addEventListener("click", () => { $("result-fab").hidden = true; $("overlay").hidden = false; });
    $("overlay-menu").addEventListener("click", () => backToLobby(true));
    $("btn-net-retry").addEventListener("click", () => Net.retryNow());
    $("btn-net-leave").addEventListener("click", leaveRoom);

    window.addEventListener("resize", fitBoard);
    new ResizeObserver(fitBoard).observe($("hut"));
    window.addEventListener("beforeunload", () => Room.save());
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Room.online) Net.retryNow(); });
    window.addEventListener("online", () => { if (Room.online) Net.retryNow(); });

    /* ================= boot ================= */
    Preload.textures();
    Install.init();
    Skins.init({ onChange: () => { Match.engine.render(); renderLobby(); } });
    Prefs.init({
        // what the feedback link reports about the current situation (never the room code or chat)
        context: () => ({
            screen: phase, mode: Match.mode, game: phase === "game" && Match.config ? Match.config.game : Settings.game,
            settings: Settings.summary(), players: Match.config ? Match.config.players : Settings.read().players,
            seat: Room.online ? Match.me : undefined, spectator: Room.online ? Match.spectator : undefined,
            bot: Match.bot ? `${Match.bot.def.id} (${Match.bot.difficulty})` : undefined,
            net: Room.online ? `${Net.status} as ${Net.role}` : "offline",
            look: Skins.current, sound: `${Prefs.get().soundSet} ${Prefs.get().volume} %`,
            log: [...document.querySelectorAll("#log > div:not(.chat)")].slice(0, 5).map((d) => d.textContent),
        }),
    });
    Sound.init({ seats: () => Match.seats.map((s) => s.kind) });
    Settings.init({
        onChange: (cfg) => { if (Room.online) Room.settingsChanged(cfg); },
        // picking a game keeps the default opponent (best bot, middle level, #12); the Opponent row opens the picker
        onSelectGame: () => { if (Match.mode === "bot" && phase === "lobby") renderLobby(); },
    });
    Opponent.init({ onDone: () => renderLobby() });
    Changelog.init();
    Reactions.init({ onSend: (e) => { if (Room.online) Room.react(e); } });
    Chat.init({
        online: () => Room.online,
        me: () => Match.me,
        name: (seat) => (seat >= 0 ? Match.names[seat] || `Player ${seat + 1}` : "Spectator"),
        onSend: Room.say,
    });
    Match.init({
        live: Room.live,
        turnHint: (p) => (Room.online ? Room.turnHint(p) : "to move"),
        onLocalMove: (i) => { if (Room.online) Room.sendMove(i); },
        onChanged: Room.onChanged,
        onIdle: Room.onIdle,
        onFlag: (p) => { if (Room.online) Room.onFlag(p); },
        onFinish: () => { Room.save(); renderRematch(); },
    });
    Room.init({ phase: () => phase, show, startGame, backToLobby, renderLobby, onVotes: renderRematch });

    const params = new URLSearchParams(location.search);
    const roomFromUrl = Net.normalizeCode(params.get("room"));
    const spectateFromUrl = params.get("spectate") === "1";
    const session = Session.load();
    if (roomFromUrl && session && session.code === roomFromUrl) {
        // page refresh inside a room: rebuild from the session's game record, then re-sync with the friends
        const me = session.me ?? -1;
        Room.enter(roomFromUrl, session.role ? session.role === "host" : me === 0, me, !!session.spectator);
        Match.gameNo = session.gameNo || 0;
        if (session.phase === "game" && session.config) {
            startGame(session.config, Match.gameNo);
            Match.engine.replay(session.history || [], session.outs || []);
            Clock.restore(session.clocks);
            Clock.pause();
            Log.add("Rejoining room " + roomFromUrl + "…", "x");
        }
        Room.rev = session.rev || 0;
    } else if (roomFromUrl) {
        Room.enter(roomFromUrl, false, -1, spectateFromUrl);
    } else {
        Settings.setMode("local");
        show("menu");
    }
})();
