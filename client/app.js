/* App layer: the screens (title → room lobby → game), the lobby, the flow between them
   (start, rematch, back to room, leave) and the wiring of every module at boot.
   Local play, against a bot and online share the same flow: Match owns the table (seats,
   engine, clock, bot), Room the online protocol; app.js only switches screens and renders
   the lobby. Everything game-specific goes through the engine interface (games.js). */

"use strict";

(() => {
    const { $, toast } = Util;
    let phase = "menu";          // "menu" | "lobby" | "game"

    /* Who sits in each seat (#35). Online the room knows it (every device announces its own
       name); offline the seats are this device's own (Prefs.seatNames: me first, then the
       first default names that are not mine), and a bot seat is renamed by Match. */
    const seatNames = () => (Room.online ? Room.names() : Prefs.seatNames());

    /* ================= screens & board fitting ================= */
    function show(name) {
        for (const s of ["menu", "lobby", "game"]) $("screen-" + s).hidden = s !== name;
        phase = name;
        Update.screenChanged();                      // the "new version" notice lives on the title screen only (#40)
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
        // phones: the replay bar (#38) sits above the HUD, so it needs the strip the HUD takes
        const hut = $("hut").getBoundingClientRect();
        if (hut.height > 0) document.documentElement.style.setProperty("--hut-h", Math.round(window.innerHeight - hut.top) + "px");
        Reactions.place();                               // layout is synchronous: the board rect is final here
    }

    /* ================= lobby ================= */
    function renderLobby() {
        const online = Room.online;
        const bot = Match.mode === "bot";
        const nm = seatNames();
        Settings.setMinPlayers(online ? Room.occupiedSeats() : 2);  // no count that takes a seat away (#34)
        const players = Settings.read().players;
        $("lobby-kind").textContent = online ? "Room" : bot ? "Against a bot" : "Local game";
        $("lobby-code").textContent = online ? Room.codeText() : bot ? "You vs bot" : "Same device";
        const eye = $("btn-hide-code");
        eye.hidden = !online;
        eye.textContent = Room.codeHidden ? "🙈" : "👁";
        eye.title = Room.codeHidden ? "Show the room code" : "Hide the room code";
        eye.setAttribute("aria-label", eye.title);
        $("btn-opponent").hidden = !bot;
        if (bot) $("opponent-summary").textContent = Opponent.summary(Settings.game, Settings.read());
        Settings.setLocked(online && Match.spectator);              // spectators only watch (#29)
        $("lobby-share").hidden = !online;
        $("lobby-players").hidden = !online;
        $("group-players").hidden = bot;                            // against a bot the whole group is empty (two seats, no room)
        const box = $("lobby-players");
        if (box.children.length !== players) {
            box.innerHTML = "";
            for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-lobby-player", k));
        }
        const present = Room.presentSeats();
        for (let k = 0; k < players; k++) {
            const mine = Match.me === k;
            $(`lp-${k}`).querySelector(".lp-name").textContent = nm[k];
            $(`lp-${k}`).querySelector(".lp-you").textContent = online && mine ? "(you)" : "";
            $(`lp-${k}`).classList.toggle("absent", online && !present[k]);
            $(`lp-${k}-status`).textContent = !online ? "" : mine ? "ready" : (present[k] ? "connected" : "not here yet");
        }
        const watching = online ? Room.spectators : 0;
        $("lobby-spectators").textContent = watching > 0 ? `${watching} spectator${watching > 1 ? "s" : ""} watching` : "";
        const start = $("btn-start");
        if (!online) {
            start.disabled = bot && !Opponent.current(Settings.game, Settings.read());
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

    // the Rematch buttons (HUD + overlay) and the "Show result" button follow the rematch state;
    // a spectator cannot send everyone back to the room (#29): its button leaves the room instead
    function renderRematch() {
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

    /* ================= replay bar (#38) ================= */
    // After a game everyone can walk through it move by move. The position is a view-only
    // preview in the engine (the live game, the record and the hash never change), and every
    // step is announced so the whole room looks at the same move.
    const totalPlies = () => Match.state.history.length;
    const currentPly = () => Match.engine.previewPly ?? totalPlies();

    function showReplay(ply, announce) {
        const total = totalPlies();
        const to = Math.max(0, Math.min(total, ply));
        Match.engine.preview(to >= total ? null : to);
        $("overlay").hidden = true;
        $("result-fab").hidden = false;
        $("replay-bar").hidden = false;
        renderReplay();
        if (announce && Room.online) Room.review(to);
    }
    function renderReplay() {
        const total = totalPlies();
        const ply = currentPly();
        $("replay-pos").textContent = `Move ${ply} / ${total}`;
        $("replay-first").disabled = $("replay-prev").disabled = ply === 0;
        $("replay-next").disabled = $("replay-last").disabled = ply === total;
    }
    // back to the live position: a new game, a rematch, the room, the result overlay
    function hideReplay() {
        Match.engine.preview(null);
        $("replay-bar").hidden = true;
        $("result-fab").hidden = true;
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
        hideReplay();
        show("menu");
    }

    // game number `gameNo` with `cfg` at this table (local, bot or online — Room calls this too)
    function startGame(cfg, gameNo) {
        hideReplay();
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
        hideReplay();
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
    $("btn-opponent").addEventListener("click", () => Opponent.open(Settings.game, Settings.read()));

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
    $("btn-hide-code").addEventListener("click", () => Room.hideCode(!Room.codeHidden));
    $("btn-lobby-back").addEventListener("click", leaveRoom);
    $("btn-start").addEventListener("click", startFromLobby);

    // in game
    $("gear").addEventListener("click", () => $("hut").classList.toggle("show-controls"));
    $("btn-restart").addEventListener("click", () => { if (!Match.state.busy) requestRematch(); });
    $("btn-menu").addEventListener("click", () => { if (Match.spectator) leaveRoom(); else backToLobby(true); });
    $("overlay-again").addEventListener("click", requestRematch);
    $("overlay-look").addEventListener("click", () => showReplay(totalPlies(), false));
    $("result-fab").addEventListener("click", () => { hideReplay(); $("overlay").hidden = false; });
    $("replay-first").addEventListener("click", () => showReplay(0, true));
    $("replay-prev").addEventListener("click", () => showReplay(currentPly() - 1, true));
    $("replay-next").addEventListener("click", () => showReplay(currentPly() + 1, true));
    $("replay-last").addEventListener("click", () => showReplay(totalPlies(), true));
    // arrow keys step, Home / End jump to the ends (while the replay bar is up and nothing is typed)
    document.addEventListener("keydown", (e) => {
        if ($("replay-bar").hidden || e.altKey || e.ctrlKey || e.metaKey) return;
        const t = e.target;
        if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
        const step = { ArrowLeft: currentPly() - 1, ArrowRight: currentPly() + 1, Home: 0, End: totalPlies() }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        showReplay(step, true);
    });
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
    Update.init({ onTitle: () => phase === "menu" });   // poll version.json on the title screen (#40)
    Skins.init({ onChange: () => { Match.engine.render(); renderLobby(); } });
    Dev.init();
    let shownName = Prefs.get().name;
    Prefs.init({
        onChange: (p) => {
            Dev.enable(p.developer);
            if (p.name === shownName) return;         // only a new name needs the room and the boards (#35)
            shownName = p.name;
            Room.nameChanged();
            Match.engine.render();
            renderLobby();
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
    Settings.init({
        // a rule variant can change which bot plays (Yavalath: the baseline), so the Opponent row follows
        onChange: (cfg) => { if (Room.online) Room.settingsChanged(cfg); else if (Match.mode === "bot" && phase === "lobby") renderLobby(); },
        // picking a game keeps the default opponent (best bot, middle level, #12); the Opponent row opens the picker
        onSelectGame: () => { if (Match.mode === "bot" && phase === "lobby") renderLobby(); },
    });
    Opponent.init({ onDone: () => renderLobby() });
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
        onLocalMove: (i) => { if (Room.online) Room.sendMove(i); },
        onChanged: Room.onChanged,
        onIdle: Room.onIdle,
        onFlag: (p) => { if (Room.online) Room.onFlag(p); },
        onFinish: () => { Room.save(); renderRematch(); },
    });
    Room.init({ phase: () => phase, show, startGame, backToLobby, renderLobby, onVotes: renderRematch, onReview: (ply) => showReplay(ply, false) });
    Dev.enable(Prefs.get().developer);

    const params = new URLSearchParams(location.search);
    const roomFromUrl = Net.normalizeCode(params.get("room"));
    const spectateFromUrl = params.get("spectate") === "1";
    const session = Session.load();
    // a refresh inside a room: the URL names the session's room, or the session hid the code (then the URL carries none)
    const rejoin = session && session.code && (roomFromUrl ? session.code === roomFromUrl : !!session.codeHidden);
    if (rejoin) {
        // rebuild from the session's game record, then re-sync with the friends
        const me = session.me ?? -1;
        Room.enter(session.code, session.role ? session.role === "host" : me === 0, me, !!session.spectator, !!session.codeHidden);
        Match.gameNo = session.gameNo || 0;
        if (session.phase === "game" && session.config) {
            startGame(session.config, Match.gameNo);
            Match.engine.replay(session.history || [], session.outs || []);
            Clock.restore(session.clocks);
            Clock.pause();
            Log.add("Rejoining room " + Room.codeText() + "…", "x");
        }
        Room.rev = session.rev || 0;
    } else if (roomFromUrl) {
        Room.enter(roomFromUrl, false, -1, spectateFromUrl);
    } else {
        Settings.setMode("local");
        show("menu");
    }
})();
