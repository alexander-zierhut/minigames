/* The app: the screens, the flow between them (start, rematch, back to the room, leave,
   watch a replay) and the wiring of every module at boot. Match owns the table (seats,
   engine, clock, bot), Room the online protocol, Lobby / Review / ReplayList their screens;
   app.js is the only place that switches screens. */

"use strict";

(() => {
    const { $, toast } = Util;
    const { t } = I18n;
    const SCREENS = ["menu", "lobby", "game", "replays", "learn", "learn-game"];
    let phase = "menu";          // one of SCREENS
    let replayDoc = null;        // the replay document on the board (#42), null = playing
    let continued = false;       // a replay played on against the bot (#43): its exits lead back to the replays

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

    /* The language changed (#47): I18n already rewrote the markup (Prefs.set); every module
       paints what it built itself again, in the new words. The log keeps its lines. */
    function relabel() {
        Settings.relabel();
        Opponent.relabel();
        Match.engine.relabel();
        renderRematch();
        Lobby.render();
        Room.render();
        Learn.relabel();
        if (phase === "replays") ReplayList.relabel();
        if (!$("replay-bar").hidden) Review.render();
        Analysis.render();
    }

    // the Rematch buttons (HUD + overlay) and the "Show result" button follow the rematch state;
    // a spectator cannot send everyone back to the room (#29): its button leaves the room instead
    function renderRematch() {
        // watching a replay there is nothing to play again: both buttons lead back to the list
        if (Match.mode === "replay") {
            $("btn-restart").hidden = true;
            $("overlay-again").hidden = true;
            $("overlay-menu").hidden = false;
            $("btn-menu").textContent = $("overlay-menu").textContent = t("game.backReplays");
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
            $("overlay-menu").textContent = t("game.backLearn");
            return;
        }
        $("overlay-again").hidden = false;
        $("overlay-menu").textContent = t("game.changeGame");
        const spec = Match.spectator;
        $("btn-restart").disabled = spec;
        $("btn-restart").textContent = t(spec ? "overlay.spectating" : "overlay.rematch");
        $("btn-menu").textContent = t(spec ? "game.leaveRoom" : "game.backRoom");
        // a replay played on (#43): there is no room to go back to, the replays are where it came from
        if (continued) $("btn-menu").textContent = $("overlay-menu").textContent = t("game.backReplays");
        $("overlay-menu").hidden = spec;
        const again = $("overlay-again");
        if (spec) { again.textContent = t("overlay.spectating"); again.disabled = true; }
        else if (Room.online && Room.votedMyself) { again.textContent = Room.rematchWaitText(); again.disabled = true; }
        else if (Room.online && Room.votes.size > 0) { again.textContent = t("overlay.accept"); again.disabled = false; $("result-fab").textContent = t("replay.requested"); }
        else { again.textContent = t("overlay.rematch"); again.disabled = false; }
    }

    /* ================= replays on the board (#42, #43) ================= */
    // what was played is kept on this device: finished games, and games somebody left
    // through "Back to room" (those are marked unfinished)
    // returns the store's promise, so a screen that lists the replays can wait for it
    // which bot played at this table, at which level and node budget (the replay carries it):
    // the table's own bot, or the room's bot another device runs (config.bot names it)
    function botMeta() {
        const seat = Match.seats.findIndex((s) => s.kind === "bot");
        const b = Match.bot ? { id: Match.bot.def.id, difficulty: Match.bot.difficulty, seat } : Match.config.bot ? { ...Match.config.bot } : null;
        if (!b || !Bots.get(b.id)) return null;
        const def = Bots.get(b.id);
        const level = def.difficulties.find((d) => d.id === b.difficulty);
        return { id: b.id, version: def.version, difficulty: b.difficulty, nodes: level && level.nodes ? level.nodes : null, seat: b.seat };
    }
    function saveReplay(finished) {
        if (Match.mode === "replay" || Learn.active || !Match.running || !Match.config) return null;   // a lesson is not a game (#41)
        const record = Match.record();
        if (!record.history.length) return null;
        if (!finished && record.over) return null;        // it was already saved when it ended
        return Replays.store.save(Replays.fromRecord(record, Match.names, Match.mode, { finished, bot: botMeta() }));
    }
    // watch a replay: the record on the board, nobody to move, the replay bar from move 0
    function watchReplay(doc) {
        replayDoc = doc;
        continued = false;
        Match.watch(doc);
        $("result-fab").textContent = t("replay.showResult");
        renderRematch();
        show("game");
        Review.show(0, false);
    }
    // back to the replays list: from the viewer, or from a game continued out of one (a game
    // left half way is kept, like everywhere else)
    function closeReplay() {
        replayDoc = null;
        continued = false;
        const saved = saveReplay(false);
        Review.hide();
        $("overlay").hidden = true;
        Match.reset("local");
        Settings.setMode("local");
        ReplayList.open();
        if (saved) saved.then(() => ReplayList.render());   // the list shows the game once the store has it
    }
    /* Play from here (#43, #52): continue a two-player replay against the bot, offline, the
       way "Against a bot" plays. The human takes the seat that is to move at the shown
       position and the bot the other one (`config.bot.seat`, which Match honours offline
       too); the game number is picked so that the seat that started the recorded game
       starts this one, and the moves up to here are replayed into it as the start prefix.
       Every exit leads back to the replays, where the player came from. */
    function playFromHere(ply) {
        const doc = replayDoc;
        if (!doc || (doc.config.players || 2) !== 2) return;
        const rec = { game: doc.game, config: doc.config, history: doc.history, outs: doc.outs || [] };
        const at = Math.max(0, Math.min(doc.history.length, ply));
        const pos = Rules.replay(rec, at);
        if (pos.over) { toast(t("toast.decided")); return; }
        const choice = Opponent.current(doc.game, doc.config);
        if (!choice) { toast(t("toast.noBot")); return; }
        const seat = pos.current;
        const prefix = { history: doc.history.slice(0, at), outs: rec.outs.filter((o) => o.at <= at) };
        replayDoc = null;
        Review.hide();
        Match.reset("bot");
        Settings.setMode("bot");
        Settings.write({ ...doc.config, bot: null });
        Match.gameNo = doc.config.startPlayer || 0;       // …so the next game number starts the recorded starter
        continued = true;
        startGame({ ...Settings.read(), bot: { id: choice.id, difficulty: choice.difficulty, seat: seat === 0 ? 1 : 0 } }, Match.gameNo + 1, prefix);
        Log.add(t("log.playingOn"), "x");
    }

    /* ================= flow ================= */
    // offline lobby: two to four people on this device, or you against a bot
    function openLocalLobby(withBot) {
        continued = false;
        Room.leave();
        Match.reset(withBot ? "bot" : "local");
        Settings.setMode(Match.mode);
        show("lobby");
    }

    function leaveRoom() {
        saveReplay(false);                       // a game left half way is kept too (#42)
        continued = false;
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
        $("result-fab").textContent = t("replay.showResult");
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
    $("btn-create").addEventListener("click", () => { continued = false; Room.enter(Net.randomCode(), { preferHost: true, seat: 0, spec: Net.randomCode() }); });
    $("btn-join-open").addEventListener("click", () => {
        const panel = $("join-panel");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) $("join-code").focus();
    });
    $("btn-join").addEventListener("click", () => {
        const code = Net.normalizeCode($("join-code").value);
        if (code.length < 4) { toast(t("menu.codeShort")); $("join-code").focus(); return; }
        continued = false;
        Room.enter(code, { preferHost: false });
    });
    $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });
    $("join-code").addEventListener("input", () => { $("join-code").value = Net.normalizeCode($("join-code").value); });
    $("btn-replays").addEventListener("click", ReplayList.open);
    $("btn-local").addEventListener("click", () => openLocalLobby(false));
    $("btn-bot").addEventListener("click", () => openLocalLobby(true));

    // learn (#41): the academy is offline and never touches a room
    $("btn-learn").addEventListener("click", () => { continued = false; Room.leave(); Match.reset("local"); Learn.open(); });
    $("btn-learn-back").addEventListener("click", () => show("menu"));
    $("btn-learn-game-back").addEventListener("click", () => Learn.open());

    // lobby
    $("btn-lobby-back").addEventListener("click", leaveRoom);
    $("btn-start").addEventListener("click", startFromLobby);

    // in game
    $("gear").addEventListener("click", () => $("hut").classList.toggle("show-controls"));
    $("btn-restart").addEventListener("click", () => { if (!Match.state.busy) requestRematch(); });
    // what the HUD's back button does, by the table's kind (the back gesture takes the same step)
    function backFromGame() {
        if (Match.mode === "replay" || continued) closeReplay();
        else if (Learn.active) Learn.exit();
        else if (Match.spectator) leaveRoom();
        else backToLobby(true);
    }
    $("btn-menu").addEventListener("click", backFromGame);
    $("overlay-again").addEventListener("click", requestRematch);
    $("overlay-menu").addEventListener("click", () => { if (Match.mode === "replay" || continued) closeReplay(); else backToLobby(true); });

    $("btn-net-retry").addEventListener("click", () => Net.retryNow());
    $("btn-net-leave").addEventListener("click", leaveRoom);

    /* ================= the back gesture (a virtual history) =================
       A phone's back button, or the browser's, steps back inside the page instead of leaving
       it: one history entry of ours sits on top of the real one whenever there is something
       to go back from (a screen that is not the title, or an open modal). Popping it takes
       that step (the topmost modal closes, a game goes back to its room, a room is left, a
       Learn page closes) and puts the entry back while there is more; on the title screen
       with nothing open, the next back leaves the page as it always did. */
    const Nav = (() => {
        let armed = false;                                   // our entry sits on top of the real one
        let dropping = 0;                                    // pops we asked for ourselves
        let keepUrl = null;                                  // the URL the app wants while such a pop lands
        const onePane = () => window.matchMedia && window.matchMedia("(max-width: 899px)").matches;
        const openModal = () => {
            const open = [...document.querySelectorAll(".modal:not([hidden])")];
            return open.find((m) => m.id === "prefs-modal") || open[open.length - 1] || null;   // ⚙ opens over everything
        };
        const needed = () => phase !== "menu" || !!openModal();
        function closeModal(m) {
            if (m.id === "prefs-modal") { if (Prefs.section && onePane()) Prefs.showSection(null); else Prefs.close(); }
            else if (m.id === "settings-modal") $("btn-settings-done").click();
            else if (m.id === "bot-modal") $("btn-bot-cancel").click();
            else if (m.id === "howto-modal") Learn.closeHowto();
            else if (m.id === "invite-modal") Lobby.closeInvite();
            else if (m.id === "changelog-modal") Changelog.close();
            else m.hidden = true;
        }
        function back() {
            const m = openModal();
            if (m) closeModal(m);
            else if (phase === "game") backFromGame();
            else if (phase === "lobby") leaveRoom();
            else if (phase === "learn-game") Learn.open();
            else show("menu");                               // replays, learn
        }
        function sync() {
            if (needed() && !armed) { history.pushState({ minigames: true }, ""); armed = true; }
            else if (!needed() && armed) { armed = false; dropping++; keepUrl = location.href; history.back(); }   // nothing left to go back from: our entry goes
        }
        window.addEventListener("popstate", () => {
            if (dropping) {                                  // our own drop landed on the older entry: keep the URL the app set since (Room clears ?room= / ?watch=)
                dropping--;
                if (keepUrl && location.href !== keepUrl) history.replaceState(history.state, "", keepUrl);
                return;
            }
            if (!armed) return;                              // the real entry: the browser leaves the page
            armed = false;
            if (needed()) { back(); sync(); }
        });
        if (history.state && history.state.minigames) history.replaceState(null, "");   // a reload on our entry: start clean
        new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
        return { sync, back };
    })();

    window.addEventListener("resize", fitBoard);
    window.addEventListener("resize", () => Room.updateBanner());   // the banner's height feeds the lobby's top padding
    new ResizeObserver(fitBoard).observe($("hut"));
    new ResizeObserver(fitBoard).observe($("replay-dock"));   // the panel opens: the board makes room (#43)
    window.addEventListener("beforeunload", () => Room.save());
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Room.online) Net.retryNow(); });
    window.addEventListener("online", () => { if (Room.online) Net.retryNow(); });

    /* ================= boot ================= */
    I18n.init(Prefs.get().language);                  // the language (#47) before anything renders a text
    Preload.textures();
    Install.init();
    Update.init({ onTitle: () => phase === "menu" });   // poll version.json on the title screen (#40)
    Skins.init({ onChange: () => { Match.engine.render(); Lobby.render(); } });
    Dev.init();
    let shownName = Prefs.get().name;
    let shownLanguage = Prefs.get().language;
    Prefs.init({
        onChange: (p) => {
            Dev.enable(p.developer);
            if (p.language !== shownLanguage) { shownLanguage = p.language; relabel(); }
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
        name: (seat) => (seat >= 0 ? Match.names[seat] || t("common.player", { n: seat + 1 }) : t("common.spectator")),
        onSend: Room.say,
    });
    Match.init({
        live: Room.live,
        names: seatNames,
        turnHint: (p) => (Room.online ? Room.turnHint(p) : t("hud.toMove")),
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
            Log.add(session.watch ? t("log.rejoinSpectator") : t("log.rejoin", { code: Room.codeText() }), "x");
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
