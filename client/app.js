/* The app: the screens, the flow between them (start, rematch, back to the room, leave,
   watch a replay) and the wiring of every module at boot. Match owns the table (seats,
   engine, clock, bot), Room the online protocol, Lobby / Review / ReplayList their screens;
   app.js is the only place that switches screens. */

"use strict";

(() => {
    const { $, toast } = Util;
    const SCREENS = ["menu", "lobby", "game", "replays", "learn", "learn-game"];
    let phase = "menu";          // one of SCREENS
    let replayDoc = null;        // the replay document on the board (#42), null = playing

    /* Who sits in each seat (#35): online the room knows, offline the seats are this
       device's own (Prefs.seatNames); watching a replay the file says who played; a Learn
       tutorial renames the other seat. A bot seat is renamed by Match. */
    const seatNames = () => {
        if (replayDoc) return replayDoc.players;
        const base = Room.online ? Room.names() : Prefs.seatNames();
        return Learn.names(base) || base;
    };

    /* ================= screens & board fitting ================= */
    function show(name) {
        for (const s of SCREENS) $("screen-" + s).hidden = s !== name;
        $("screen-" + name).scrollTop = 0;            // a screen that scrolls (Learn, #43) opens at its top
        phase = name;
        Update.screenChanged();                      // the "new version" notice lives on the title screen only (#40)
        Room.updateBanner();                         // the connection banner shows in the lobby and in a game only
        if (name === "game") requestAnimationFrame(() => { fitBoard(); requestAnimationFrame(fitBoard); });
        if (name === "lobby") Lobby.render();
    }
    // the board is a square of min(wrapper width, height) minus room for the turn outline
    // (the wrapper's padding keeps it clear of the corner buttons on phones)
    function fitBoard() {
        const wrap = $("board-wrap");
        // first the strips the board has to keep clear, because the wrapper's padding follows
        // them: phones put the replay bar (#38) above the HUD, and the analysis panel (#43)
        // above the bar. Reading the wrapper afterwards sees the new padding.
        const hut = $("hut").getBoundingClientRect();
        if (hut.height > 0) document.documentElement.style.setProperty("--hut-h", Math.round(window.innerHeight - hut.top) + "px");
        const dock = $("replay-dock").getBoundingClientRect();
        document.documentElement.style.setProperty("--dock-h", (dock.height ? Math.round(dock.height) + 8 : 0) + "px");
        const cs = getComputedStyle(wrap);
        const h = wrap.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
        const w = wrap.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        const size = Math.floor(Math.min(w, h)) - 10;
        if (size > 0) document.documentElement.style.setProperty("--board", size + "px");
        Reactions.place();                               // layout is synchronous: the board rect is final here
    }

    // the Rematch buttons (HUD + overlay) and the "Show result" button follow the rematch state;
    // a spectator cannot send everyone back to the room (#29): its button leaves the room instead
    function renderRematch() {
        // watching a replay there is nothing to play again: both buttons lead back to the list
        if (Match.mode === "replay") {
            $("btn-restart").hidden = true;
            $("overlay-again").hidden = true;
            $("overlay-menu").hidden = false;
            $("btn-menu").textContent = $("overlay-menu").textContent = "Back to replays";
            return;
        }
        $("btn-restart").hidden = false;
        // a Learn lesson owns the board: the result card offers the lesson's own actions (#41),
        // which after a solved scenario is "Next scenario" instead of Retry (#44)
        if (Learn.active) {
            const again = $("overlay-again");
            again.hidden = false;
            again.disabled = false;
            again.textContent = Learn.againText();
            $("overlay-menu").hidden = false;
            $("overlay-menu").textContent = "Back to Learn";
            return;
        }
        $("overlay-again").hidden = false;
        $("overlay-menu").textContent = "Change game";
        const spec = Match.spectator;
        $("btn-restart").disabled = spec;
        $("btn-restart").textContent = spec ? "Spectating" : "Rematch";
        $("btn-menu").textContent = spec ? "Leave room" : "Back to room";
        $("overlay-menu").hidden = spec;
        const again = $("overlay-again");
        if (spec) { again.textContent = "Spectating"; again.disabled = true; }
        else if (Room.online && Room.votedMyself) { again.textContent = Room.rematchWaitText(); again.disabled = true; }
        else if (Room.online && Room.votes.size > 0) { again.textContent = "Accept rematch"; again.disabled = false; $("result-fab").textContent = "Rematch requested!"; }
        else { again.textContent = "Rematch"; again.disabled = false; }
    }

    /* ================= replays on the board (#42, #43) ================= */
    // what was played is kept on this device: finished games, and games somebody left
    // through "Back to room" (those are marked unfinished)
    function saveReplay(finished) {
        if (Match.mode === "replay" || Learn.active || !Match.running || !Match.config) return;   // a lesson is not a game (#41)
        const record = Match.record();
        if (!record.history.length) return;
        if (!finished && record.over) return;             // it was already saved when it ended
        Replays.store.save(Replays.fromRecord(record, Match.names, Match.mode, { finished }));
    }
    // watch a replay: the record on the board, nobody to move, the replay bar from move 0
    function watchReplay(doc) {
        replayDoc = doc;
        Match.watch(doc);
        $("result-fab").textContent = "Show result";
        renderRematch();
        show("game");
        Review.show(0, false);
    }
    function closeReplay() {
        replayDoc = null;
        Review.hide();
        $("overlay").hidden = true;
        Match.reset("local");
        Settings.setMode("local");
        ReplayList.open();
    }
    /* Play from here (#43): continue a two-player replay against the bot, in an online room
       so the spectate link still works. The human takes the seat that is to move at the
       shown position, the bot the other one; the game number is picked so that the seat that
       started the recorded game starts this one too, and the moves up to here are replayed
       into it as the start prefix. */
    function playFromHere(ply) {
        const doc = replayDoc;
        if (!doc || (doc.config.players || 2) !== 2) return;
        const rec = { game: doc.game, config: doc.config, history: doc.history, outs: doc.outs || [] };
        const at = Math.max(0, Math.min(doc.history.length, ply));
        const pos = Rules.replay(rec, at);
        if (pos.over) { toast("That game is already decided."); return; }
        const choice = Opponent.current(doc.game, doc.config);
        if (!choice) { toast("No bot plays this game yet."); return; }
        const seat = pos.current;
        const prefix = { history: doc.history.slice(0, at), outs: rec.outs.filter((o) => o.at <= at) };
        replayDoc = null;
        Review.hide();
        Room.enter(Net.randomCode(), { preferHost: true, seat, spec: Net.randomCode() });
        Settings.write({ ...doc.config, bot: null });
        Settings.setBot({ ...choice, seat: seat === 0 ? 1 : 0 }, false);
        Match.gameNo = doc.config.startPlayer || 0;       // …so the next game number starts the recorded starter
        Room.startFromLobby(Settings.read(), prefix);
        Log.add("Playing on from the replay.", "x");
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
        saveReplay(false);                       // a game left half way is kept too (#42)
        Lobby.closeInvite();
        Room.leave();
        Match.reset("local");
        $("overlay").hidden = true;
        Review.hide();
        show("menu");
    }

    // game number `gameNo` with `cfg` at this table (local, bot or online; Room calls this too).
    // `prefix` = { history, outs } starts the game from a position instead of an empty board
    // ("Play from here", #43); it travels with the room's `start` message and, for anyone who
    // joins later, inside the usual `sync`.
    function startGame(cfg, gameNo, prefix) {
        Learn.closeHowto();                      // "How to play" never stays up over a game (#41)
        Lobby.closeInvite();                     // nor does Invite
        replayDoc = null;                        // a game on the board is never a replay (#42)
        Review.hide();
        Room.newGame();
        Match.start(cfg, gameNo);
        if (prefix && prefix.history && prefix.history.length) Match.engine.replay(prefix.history.slice(), (prefix.outs || []).slice());
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
        if (Learn.active) { Learn.again(); return; }        // a lesson retries itself, or moves on (#41, #44)
        if (Room.online) Room.requestRematch();
        else startGame(Match.config, Match.gameNo + 1);
    }

    // back to the room lobby to pick another game / settings (anyone may do it)
    function backToLobby(announce) {
        if (Learn.active) { Learn.exit(); return; }
        saveReplay(false);                       // a game left half way is kept too (#42)
        if (announce && Room.online) Room.tolobby();
        Room.bump();
        Match.stop();
        $("overlay").hidden = true;
        Review.hide();
        $("net-banner").hidden = true;
        show("lobby");
        Room.enteredLobby();                             // somebody waiting for a seat gets the bot's (#36)
        Room.save();
    }

    /* ================= wiring ================= */
    // title screen
    $("btn-create").addEventListener("click", () => Room.enter(Net.randomCode(), { preferHost: true, seat: 0, spec: Net.randomCode() }));
    $("btn-join-open").addEventListener("click", () => {
        const panel = $("join-panel");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) $("join-code").focus();
    });
    $("btn-join").addEventListener("click", () => {
        const code = Net.normalizeCode($("join-code").value);
        if (code.length < 4) { toast("Enter the 5-letter room code"); $("join-code").focus(); return; }
        Room.enter(code, { preferHost: false });
    });
    $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });
    $("join-code").addEventListener("input", () => { $("join-code").value = Net.normalizeCode($("join-code").value); });
    $("btn-replays").addEventListener("click", ReplayList.open);
    $("btn-local").addEventListener("click", () => openLocalLobby(false));
    $("btn-bot").addEventListener("click", () => openLocalLobby(true));

    // learn (#41): the academy is offline and never touches a room
    $("btn-learn").addEventListener("click", () => { Room.leave(); Match.reset("local"); Learn.open(); });
    $("btn-learn-back").addEventListener("click", () => show("menu"));
    $("btn-learn-game-back").addEventListener("click", () => Learn.open());

    // lobby
    $("btn-lobby-back").addEventListener("click", leaveRoom);
    $("btn-start").addEventListener("click", startFromLobby);

    // in game
    $("gear").addEventListener("click", () => $("hut").classList.toggle("show-controls"));
    $("btn-restart").addEventListener("click", () => { if (!Match.state.busy) requestRematch(); });
    $("btn-menu").addEventListener("click", () => {
        if (Match.mode === "replay") closeReplay();
        else if (Learn.active) Learn.exit();
        else if (Match.spectator) leaveRoom();
        else backToLobby(true);
    });
    $("overlay-again").addEventListener("click", requestRematch);
    $("overlay-menu").addEventListener("click", () => { if (Match.mode === "replay") closeReplay(); else backToLobby(true); });

    $("btn-net-retry").addEventListener("click", () => Net.retryNow());
    $("btn-net-leave").addEventListener("click", leaveRoom);

    window.addEventListener("resize", fitBoard);
    window.addEventListener("resize", () => Room.updateBanner());   // the banner's height feeds the lobby's top padding
    new ResizeObserver(fitBoard).observe($("hut"));
    new ResizeObserver(fitBoard).observe($("replay-dock"));   // the panel opens: the board makes room (#43)
    window.addEventListener("beforeunload", () => Room.save());
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Room.online) Net.retryNow(); });
    window.addEventListener("online", () => { if (Room.online) Net.retryNow(); });

    /* ================= boot ================= */
    Preload.textures();
    Install.init();
    Update.init({ onTitle: () => phase === "menu" });   // poll version.json on the title screen (#40)
    Skins.init({ onChange: () => { Match.engine.render(); Lobby.render(); } });
    Dev.init();
    let shownName = Prefs.get().name;
    Prefs.init({
        onChange: (p) => {
            Dev.enable(p.developer);
            if (p.name === shownName) return;         // only a new name needs the room and the boards (#35)
            shownName = p.name;
            Room.nameChanged();
            Match.engine.render();
            Lobby.render();
        },
        // what the feedback link reports about the current situation (never the room code or chat)
        context: () => ({
            screen: phase, mode: Match.mode, game: phase === "game" && Match.config ? Match.config.game : Settings.game,
            settings: Settings.summary(), players: Match.config ? Match.config.players : Settings.read().players,
            seat: Room.online ? Match.me : undefined, spectator: Room.online ? Match.spectator : undefined,
            bot: Match.bot ? `${Match.bot.def.id} (${Match.bot.difficulty})` : undefined,
            net: Room.online ? `${Net.status} as ${Net.role}` : "offline",
            look: Skins.current, sound: `${Prefs.get().soundSet} ${Prefs.get().volume} %`,
            name: Prefs.get().name,
            log: [...document.querySelectorAll("#log > div:not(.chat)")].slice(0, 5).map((d) => d.textContent),
        }),
    });
    Sound.init({ seats: () => Match.seats.map((s) => s.kind) });
    const lobbyShown = () => phase === "lobby";
    Settings.init({
        // a rule variant can change which bot plays (Yavalath: the baseline), so the Opponent row follows
        onChange: (cfg) => { if (Room.online) Room.settingsChanged(cfg); else if (Match.mode === "bot" && lobbyShown()) Lobby.render(); },
        // picking a game keeps the default opponent (best bot, middle level, #12); the Opponent row opens the picker
        onSelectGame: () => { if (Match.mode === "bot" && lobbyShown()) Lobby.render(); },
    });
    // Play in the bot modal: offline it only remembers my choice, in a room it sets the
    // room's bot, so everybody sees it on the empty seat (#36)
    Opponent.init({ onDone: (game, played) => { if (played && Room.online) Settings.setBot(Opponent.current(game, Settings.read())); Lobby.render(); } });
    Changelog.init();
    Reactions.init({
        onSend: (e) => { if (Room.online) Room.react(e); },
        // my own reaction glows in my seat's colour (#33); a spectator's is white, and with
        // everyone on one device it takes the colour of whoever is to move
        color: () => {
            if (Match.me >= 0) return Match.playerColor(Match.me);
            if (Match.spectator) return Match.playerColor(-1);
            const s = Match.state;
            return Match.playerColor(s ? s.current : -1);
        },
    });
    Chat.init({
        online: () => Room.online,
        me: () => Match.me,
        name: (seat) => (seat >= 0 ? Match.names[seat] || `Player ${seat + 1}` : "Spectator"),
        onSend: Room.say,
    });
    Match.init({
        live: Room.live,
        names: seatNames,
        turnHint: (p) => (Room.online ? Room.turnHint(p) : "to move"),
        hostsBot: () => Room.isHost,                 // the room's bot seat runs on the transport host (#36)
        onBotReact: (seat, e) => { if (Room.online) Room.react(e, seat); },
        beforeMove: (i) => Learn.beforeMove(i),          // a tutorial takes only the cell it asks for (#41)
        cellClass: (i) => Learn.cellClass(i),            // and highlights it
        onLocalMove: (i) => { if (Room.online) Room.sendMove(i); else Learn.onLocalMove(i); },
        onChanged: Room.onChanged,
        onIdle: Room.onIdle,
        onFlag: (p) => { if (Room.online) Room.onFlag(p); },
        onFinish: () => { saveReplay(true); Room.save(); renderRematch(); },
    });
    Lobby.init({ names: seatNames });
    Review.init({ doc: () => replayDoc, onPlayFrom: playFromHere });
    ReplayList.init({ show, watch: watchReplay });
    Room.init({ phase: () => phase, show, startGame, backToLobby, renderLobby: Lobby.render, onVotes: renderRematch, onReview: Review.follow });
    // Learn runs its lessons on the game screen; app.js stays the only screen switcher (#41)
    Learn.init({ show, exit: () => { Review.hide(); $("overlay").hidden = true; show("learn-game"); } });
    Dev.enable(Prefs.get().developer);

    const params = new URLSearchParams(location.search);
    const roomFromUrl = Net.normalizeCode(params.get("room"));
    const watchFromUrl = Net.normalizeCode(params.get("watch"));      // the spectate link (#29): a code of its own
    const spectateFromUrl = params.get("spectate") === "1";
    const session = Session.load();
    // a refresh inside a room: the URL names the session's room (or its spectator code), or
    // the session hid the code (then the URL carries none)
    const rejoin = session && session.code && (session.watch
        ? (watchFromUrl ? session.code === watchFromUrl : true)
        : (roomFromUrl ? session.code === roomFromUrl : !!session.codeHidden));
    if (rejoin) {
        // rebuild from the session's game record, then re-sync with the friends
        const me = session.me ?? -1;
        Room.enter(session.code, {
            preferHost: session.role ? session.role === "host" : me === 0,
            seat: me, spectate: !!session.spectator, watch: !!session.watch,
            spec: session.spec || null, hidden: !!session.codeHidden,
        });
        Match.gameNo = session.gameNo || 0;
        if (session.phase === "game" && session.config) {
            startGame(session.config, Match.gameNo);
            Match.engine.replay(session.history || [], session.outs || []);
            Clock.restore(session.clocks);
            Clock.pause();
            Log.add(session.watch ? "Rejoining as a spectator…" : "Rejoining room " + Room.codeText() + "…", "x");
        }
        Room.rev = session.rev || 0;
    } else if (watchFromUrl) {
        Room.enter(watchFromUrl, { preferHost: false, spectate: true, watch: true });
    } else if (roomFromUrl) {
        Room.enter(roomFromUrl, { preferHost: false, spectate: spectateFromUrl });
    } else {
        Settings.setMode("local");
        show("menu");
    }
})();
