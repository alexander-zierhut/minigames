/* App layer: the screens (title → room lobby → game, plus the replays list), the lobby,
   the flow between them (start, rematch, back to room, leave, watch a replay) and the
   wiring of every module at boot.
   Local play, against a bot and online share the same flow: Match owns the table (seats,
   engine, clock, bot), Room the online protocol; app.js only switches screens and renders
   the lobby. Everything game-specific goes through the engine interface (games.js). */

"use strict";

(() => {
    const { $, toast } = Util;
    const SCREENS = ["menu", "lobby", "game", "replays", "learn", "learn-game"];
    let phase = "menu";          // one of SCREENS
    let replayDoc = null;        // the replay document on the board (#42), null = playing
    let replayFilter = "all";    // the replays list's game filter
    let replayKind = "all";      // all | bot | nobot
    let replaySearch = "";       // part of a player's name
    let replayFrom = "", replayTo = "";   // local days "YYYY-MM-DD", either may be empty
    let replayPage = 0;          // the shown page of the filtered list
    const REPLAY_PAGE = 10;      // rows per page: the card never grows out of hand

    /* Who sits in each seat (#35). Online the room knows it (every device announces its own
       name); offline the seats are this device's own (Prefs.seatNames: me first, then the
       first default names that are not mine), and a bot seat is renamed by Match. */
    // watching a replay the names come from the file: that is who played that game (#42);
    // a Learn tutorial has nobody at the other seat, so it renames that one to "Opponent" (#41)
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
        if (name === "lobby") renderLobby();
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

    /* ================= lobby ================= */
    function renderLobby() {
        const online = Room.online;
        const bot = Match.mode === "bot";
        const nm = seatNames();
        Settings.setMinPlayers(online ? Room.occupiedSeats() : 2);  // no count that takes a seat away (#34)
        const players = Settings.read().players;
        $("lobby-kind").textContent = online ? "Online room" : bot ? "Against a bot" : "Local game";
        $("lobby-code").textContent = online ? Room.codeText() : bot ? "You vs bot" : "Same device";
        $("lobby-code").classList.toggle("as-word", online && Room.watching);   // "Watching" is a word, not a code
        $("screen-lobby").classList.toggle("online", online);       // the code is a copy button in a room
        $("lobby-code").title = online ? (Room.watching ? "Copy the link for spectators" : "Copy the invite link") : "";
        // the Invite modal: a spectate-link viewer never sees the room code, so it gets no
        // eye and no share or copy row, only the spectate link to invite more viewers (#29)
        const watcher = Room.watching;
        const eye = $("btn-hide-code");
        eye.hidden = !online || watcher;
        Icons.set(eye.querySelector(".gear-icon"), Room.codeHidden ? "eye-off" : "eye");
        $("hide-code-label").textContent = Room.codeHidden ? "Show the room code" : "Hide the room code";
        $("invite-code").textContent = online ? Room.codeText() : "";
        $("invite-code").hidden = !online || watcher;
        $("invite-hint").textContent = watcher ? "Pass your own link on: whoever opens it watches too." : "Friends open the link, or type the code under Join room.";
        const roomBot = online ? Settings.bot : null;               // the room plays a bot (#36)
        $("btn-opponent").hidden = !bot && !roomBot;
        if (bot || roomBot) $("opponent-summary").textContent = Opponent.summary(Settings.game, Settings.read(), roomBot);
        Settings.setLocked(online && Match.spectator);              // spectators only watch (#29)
        /* Where the seat count lives: beside the room code online, where the head is busy,
           and as its own section over the game offline, where there is room for it (owner,
           2026-09-11). It is the same control either way, just moved. */
        const countHome = online ? document.querySelector(".lobby-head-row") : $("group-count");
        if ($("row-players").parentElement !== countHome) countHome.appendChild($("row-players"));
        $("group-count").hidden = online || bot;
        $("lobby-share").hidden = !online;
        $("btn-share").hidden = watcher;
        $("btn-copy-code").hidden = watcher;
        $("lobby-players").hidden = !online;
        $("group-players").hidden = !online;                        // seat cards, their heading and the notes are a room's
        const box = $("lobby-players");
        // the seat controls live inside the card they act on; park them before the cards are rebuilt
        const park = $("seat-actions");
        const seatButtons = ["btn-watch", "btn-take-seat", "btn-room-bot", "btn-room-bot-off"].map($);
        for (const b of seatButtons) park.appendChild(b);
        if (box.children.length !== players) {
            box.innerHTML = "";
            for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-lobby-player", k));
        }
        const present = Room.presentSeats();
        const botSeat = online ? Room.botSeat() : -1;                // Room.names() already calls it "Bot" (#36)
        for (let k = 0; k < players; k++) {
            const mine = Match.me === k;
            $(`lp-${k}`).querySelector(".lp-name").textContent = nm[k];
            $(`lp-${k}`).querySelector(".lp-you").textContent = online && mine ? "(you)" : "";
            $(`lp-${k}`).classList.toggle("absent", online && !present[k]);
            $(`lp-${k}-status`).textContent = !online ? "" : mine || k === botSeat ? "ready" : (present[k] ? "connected" : "not here yet");
        }
        // swap between playing and watching (#39): a spectate-link viewer never sits down.
        // Each control sits in the card it acts on: "Watch instead" on my own card, "Sit here"
        // on the first empty card (a spectator), "Add a bot" on the empty card of a two-seat
        // room, "Remove the bot" on the bot's card.
        const canSwap = online && !watcher;
        const free = Room.seatFree();
        const firstFree = online ? present.findIndex((p, k) => !p && k < players) : -1;
        const place = (btn, shown, seat) => {
            btn.hidden = !shown;
            if (shown && seat >= 0 && $(`lp-${seat}`)) $(`lp-${seat}`).appendChild(btn);
        };
        place($("btn-watch"), canSwap && Match.me >= 0, Match.me);
        place($("btn-take-seat"), canSwap && Match.me < 0, firstFree);
        $("btn-take-seat").disabled = !free;
        $("btn-take-seat").title = free ? "" : "Every seat is taken right now.";
        // a two-seat room waiting for a friend may play a bot instead (#36)
        const mayAskBot = canSwap && Match.me >= 0 && players === 2 && Opponent.current(Settings.game, Settings.read());
        place($("btn-room-bot"), mayAskBot && !roomBot && !Room.allHere(), firstFree);
        place($("btn-room-bot-off"), mayAskBot && roomBot, botSeat);
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
        } else if (Room.netTrouble()) {
            // a connection problem says so on the button in two words (the banner at the top
            // carries the whole sentence), never as a stray line under the seats
            start.disabled = true;
            start.textContent = Room.netTrouble().short;
        } else if (!Room.allHere()) {
            const missing = Room.missingSeats().length;
            start.disabled = true;
            start.textContent = players === 2 ? "Waiting for your friend…" : `Waiting for ${missing} more player${missing === 1 ? "" : "s"}…`;
        } else {
            start.disabled = false;
            start.textContent = Room.isHost ? "Start game" : "Start game (asks the host)";
            $("lobby-status").textContent = "";       // everyone is back: drop the "X left the room." note
        }
        $("btn-lobby-back").textContent = online ? "Leave room" : "Back";
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

    /* ================= replay bar (#38) + analysis panel (#43) ================= */
    // After a game everyone can walk through it move by move. The position is a view-only
    // preview in the engine (the live game, the record and the hash never change), and every
    // step is announced so the whole room looks at the same move. showReplay is the single
    // funnel for every step (buttons, keys, Play, the room, the graph), hideReplay the single
    // teardown; the analysis panel above the bar follows both.
    const totalPlies = () => Match.state.history.length;
    const currentPly = () => Match.engine.previewPly ?? totalPlies();
    // Play / Pause (#43): each side steps on its own timer from the move that was announced,
    // so playing through a game together costs one message, not one per move.
    const player = Replays.playback({ ply: currentPly, total: totalPlies, seek: (p) => showReplay(p, false, true) });

    function showReplay(ply, announce, auto) {
        if (!auto) player.stop();                        // any step by hand pauses
        const total = totalPlies();
        const to = Math.max(0, Math.min(total, ply));
        const fresh = $("replay-bar").hidden;
        Match.engine.preview(to >= total ? null : to);
        $("overlay").hidden = true;
        $("result-fab").hidden = false;
        $("replay-bar").hidden = false;
        if (fresh) openAnalysis();
        renderReplay();
        if (announce && Room.online) Room.review(to, player.playing);
    }
    function renderReplay() {
        const total = totalPlies();
        const ply = currentPly();
        $("replay-pos").textContent = `Move ${ply} / ${total}`;
        $("replay-first").disabled = $("replay-prev").disabled = ply === 0;
        $("replay-next").disabled = $("replay-last").disabled = ply === total;
        const play = $("replay-play");
        play.disabled = total === 0;
        play.textContent = player.playing ? "❚❚" : "▶▶";
        play.title = player.playing ? "Pause" : "Play through the game";
        play.setAttribute("aria-label", play.title);
        // the analysis marks the bot's move on the board; a game whose moves are not plain
        // cell ids says which cell that is (`engine.cellOf`)
        const best = Analysis.at(ply);
        Match.mark(best >= 0 && Match.engine.cellOf ? Match.engine.cellOf(best) : best);
    }
    // Play / Pause pressed here: the room follows on its own timer
    function togglePlay() {
        const on = player.toggle();
        renderReplay();
        if (Room.online) Room.review(currentPly(), on);
    }
    // somebody else stepped or pressed Play: look at the same move, run the same timer
    function applyReview(ply, play) {
        player.stop();
        showReplay(ply, false, true);
        if (play) player.start();
        renderReplay();
    }
    // back to the live position: a new game, a rematch, the room, the result overlay
    function hideReplay() {
        player.stop();
        Analysis.close();
        Match.mark(-1);
        Match.engine.preview(null);
        $("replay-bar").hidden = true;
        $("result-fab").hidden = true;
    }
    // the game on the board as a replay document: the file when we watch one, else the game
    // that just ended (the same document the replays list keeps, so the analysis is cached
    // under the same id)
    function analysisDoc() {
        if (replayDoc) return replayDoc;
        if (!Match.config || !Match.state.history.length) return null;
        return Replays.fromRecord(Match.record(), Match.names, Match.mode === "replay" ? "local" : Match.mode);
    }
    function openAnalysis() {
        const doc = Learn.active ? null : analysisDoc();   // a lesson is not a game to judge (#41)
        if (!doc) { Analysis.close(); return; }
        const two = (doc.config.players || 2) === 2;
        // "Play from here" opens a fresh room, so it is offered while watching a replay only
        Analysis.open(doc, { canPlayFrom: Match.mode === "replay" && two && !!Opponent.current(doc.game, doc.config) });
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
        hideReplay();
        Room.enter(Net.randomCode(), { preferHost: true, seat, spec: Net.randomCode() });
        Settings.write({ ...doc.config, bot: null });
        Settings.setBot({ ...choice, seat: seat === 0 ? 1 : 0 }, false);
        Match.gameNo = doc.config.startPlayer || 0;       // …so the next game number starts the recorded starter
        Room.startFromLobby(Settings.read(), prefix);
        Log.add("Playing on from the replay.", "x");
    }

    /* ================= replays (#42) ================= */
    // Every game this device plays is saved (Replays.store), the title screen lists them,
    // and one can be watched here, saved as a file or opened from a file.
    function openReplays() {
        show("replays");
        renderReplayFilter();
        renderReplays();
    }
    /* The game filter (#43): a small dropdown, because a plain <select> cannot show the
       games' preview tiles. The button says what is picked, the menu lists "All games"
       first and then every registered game with its own tile. */
    const filterLabel = (key) => (key === "all" ? "All games" : Games.get(key).title);
    // the 3×3 preview of a game, small; "All games" gets an empty board
    const previewTile = (key) => Games.previewTile(key, { small: true });
    function renderReplayFilter() {
        const box = $("replay-filter");
        box.innerHTML = "";
        const button = document.createElement("button");
        button.className = "dd-button";
        button.id = "replay-filter-button";
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");
        const label = document.createElement("span");
        label.className = "dd-label";
        label.textContent = filterLabel(replayFilter);
        const chev = document.createElement("span");
        chev.className = "dd-chev";
        chev.textContent = "▾";
        button.append(previewTile(replayFilter), label, chev);
        button.addEventListener("click", () => openFilter(box.classList.contains("open") ? false : true));
        const menu = document.createElement("div");
        menu.className = "dd-menu";
        menu.setAttribute("role", "listbox");
        for (const key of ["all", ...Games.keys()]) {
            const opt = document.createElement("button");
            opt.className = "dd-option" + (key === replayFilter ? " selected" : "");
            opt.dataset.filter = key;
            opt.setAttribute("role", "option");
            opt.setAttribute("aria-selected", key === replayFilter ? "true" : "false");
            const name = document.createElement("span");
            name.className = "dd-label";
            name.textContent = filterLabel(key);
            opt.append(previewTile(key), name);
            opt.addEventListener("click", () => {
                const byKey = document.activeElement === opt;      // keyboard: keep the focus on the control
                replayFilter = key;
                replayPage = 0;
                box.classList.remove("open");
                renderReplayFilter();
                if (byKey) $("replay-filter-button").focus();
                renderReplays();
            });
            menu.appendChild(opt);
        }
        box.append(button, menu);
    }
    // open / close the filter menu (a click elsewhere and Escape close it too)
    function openFilter(on) {
        const box = $("replay-filter");
        box.classList.toggle("open", on);
        const button = box.querySelector(".dd-button");
        if (button) button.setAttribute("aria-expanded", on ? "true" : "false");
    }
    /* The list: every filter (game, bot or not, a name, the dates) is applied to all the
       replays on this device, the count says how many were found, and the found ones come
       in pages of REPLAY_PAGE rows, newest first. */
    async function renderReplays() {
        const box = $("replay-list");
        const all = await Replays.store.list({});
        const found = Replays.filter(all, { game: replayFilter, kind: replayKind, search: replaySearch, from: replayFrom, to: replayTo });
        const pages = Math.max(1, Math.ceil(found.length / REPLAY_PAGE));
        replayPage = Math.min(Math.max(0, replayPage), pages - 1);
        const items = found.slice(replayPage * REPLAY_PAGE, (replayPage + 1) * REPLAY_PAGE);
        const kept = await Replays.store.persistent();
        const plural = (k) => `${k} replay${k === 1 ? "" : "s"}`;
        $("replay-count").textContent = found.length === all.length ? plural(all.length) : `${found.length} of ${plural(all.length)}`;
        $("replay-pager").hidden = pages <= 1;
        $("replay-page").textContent = `Page ${replayPage + 1} of ${pages}`;
        $("replay-page-prev").disabled = replayPage === 0;
        $("replay-page-next").disabled = replayPage >= pages - 1;
        box.innerHTML = "";
        for (const r of items) {
            const el = Util.fromTemplate("tpl-replay", 0);
            el.dataset.id = r.id;
            el.prepend(previewTile(r.game));                     // the game's small tile in front of the text
            el.querySelector(".replay-title").textContent = `${r.title} · ${r.n} × ${r.n}` + (r.players.length > 2 ? ` · ${r.players.length} players` : "");
            el.querySelector(".replay-sub").textContent = [Replays.when(r.playedAt), r.players.join(" vs "), r.resultText, `${r.moves} moves`].join(" · ");
            box.appendChild(el);
        }
        const note = $("replays-note");
        note.textContent = kept ? "" : "This browser cannot keep replays, so this list lasts only while the page is open. Save the ones you want as a file.";
        note.hidden = !note.textContent;
        const hint = $("replays-hint");
        hint.textContent = all.length === 0 ? "No replays yet. Play a game and it lands here."
            : found.length === 0 ? "No replay matches. Change the filter, the dates or the name." : "";
        hint.hidden = !hint.textContent;
    }
    // save a replay as a file (a Blob the browser downloads under the replay's own name)
    function downloadReplay(doc) {
        try {
            const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = Replays.fileName(doc);
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (e) { toast("This browser cannot save the file."); }
    }
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
        showReplay(0, false);
    }
    function closeReplay() {
        replayDoc = null;
        hideReplay();
        $("overlay").hidden = true;
        Match.reset("local");
        Settings.setMode("local");
        openReplays();
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
        $("invite-modal").hidden = true;
        Room.leave();
        Match.reset("local");
        $("overlay").hidden = true;
        hideReplay();
        show("menu");
    }

    // game number `gameNo` with `cfg` at this table (local, bot or online — Room calls this too).
    // `prefix` = { history, outs } starts the game from a position instead of an empty board
    // ("Play from here", #43); it travels with the room's `start` message and, for anyone who
    // joins later, inside the usual `sync`.
    function startGame(cfg, gameNo, prefix) {
        Learn.closeHowto();                      // "How to play" never stays up over a game (#41)
        $("invite-modal").hidden = true;         // nor does Invite
        replayDoc = null;                        // a game on the board is never a replay (#42)
        hideReplay();
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
        hideReplay();
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
    $("btn-replays").addEventListener("click", openReplays);
    $("btn-local").addEventListener("click", () => openLocalLobby(false));
    $("btn-bot").addEventListener("click", () => openLocalLobby(true));
    $("btn-opponent").addEventListener("click", () => Opponent.open(Settings.game, Settings.read(), Room.online ? Settings.bot : null));

    // learn (#41): the academy is offline and never touches a room
    $("btn-learn").addEventListener("click", () => { Room.leave(); Match.reset("local"); Learn.open(); });
    $("btn-learn-back").addEventListener("click", () => show("menu"));
    $("btn-learn-game-back").addEventListener("click", () => Learn.open());
    $("btn-howto").addEventListener("click", () => Learn.openHowto(Settings.game));

    // lobby
    /* "It worked" is shown on the thing that was clicked, not in a toast at the other end of
       the screen (owner, 2026-09-11): a row's icon becomes a check and its border turns green
       for DONE_MS, the room code says "Link copied", then both go back. */
    const DONE_MS = 1400;
    const doneTimers = new Map();
    async function copyText(text, ask) {
        try { await navigator.clipboard.writeText(text); return true; }
        catch (e) { prompt(ask, text); return false; }
    }
    function flashDone(btn) {
        const icon = btn.querySelector(".gear-icon");
        if (!icon) return;
        const was = icon.dataset.icon;
        Icons.set(icon, "check");
        btn.classList.add("done");
        clearTimeout(doneTimers.get(btn));
        doneTimers.set(btn, setTimeout(() => { Icons.set(icon, was); btn.classList.remove("done"); doneTimers.delete(btn); }, DONE_MS));
    }
    // true when the link landed on the clipboard (the share sheet and the fallback prompt say so themselves)
    async function shareLink(link, text) {
        if (navigator.share) {
            try { await navigator.share({ title: "ALZlper's Minigames", text, url: link }); return false; } catch (e) { /* cancelled */ }
        }
        try { await navigator.clipboard.writeText(link); return true; }
        catch (e) { prompt("Copy this link:", link); return false; }
    }
    const shareFrom = async (btn, link, text) => { if (await shareLink(link, text)) flashDone(btn); };
    $("btn-share").addEventListener("click", () => shareFrom($("btn-share"), Room.roomLink(), `Play ${Games.get(Settings.game).title} with me!`));
    // the spectate link carries the room's own spectator code, never the room code (#29)
    $("btn-share-spectate").addEventListener("click", () => shareFrom($("btn-share-spectate"), Room.spectateLink(), `Watch us play ${Games.get(Settings.game).title}!`));
    $("btn-copy-code").addEventListener("click", async () => {
        if (await copyText(Net.code, "Room code:")) flashDone($("btn-copy-code"));
    });
    /* The room code itself copies the invite link (owner: a tap on it should do something
       useful, not select the characters). A spectate-link viewer has no room code and
       copies its own watch link instead. */
    $("lobby-code").addEventListener("click", async () => {
        if (!Room.online) return;
        const watcher = Room.watching;
        const link = watcher ? Room.spectateLink() : Room.roomLink();
        if (!(await copyText(link, watcher ? "Watch link:" : "Invite link:"))) return;
        // only the colour says it worked: the code keeps its text, so nothing moves
        const el = $("lobby-code");
        el.classList.add("copied");
        clearTimeout(doneTimers.get(el));
        doneTimers.set(el, setTimeout(() => { el.classList.remove("copied"); doneTimers.delete(el); }, DONE_MS));
    });
    // hiding the code the first time on this device asks whether new rooms should start hidden
    // (the `hideCode` preference); showing it again never asks
    $("btn-hide-code").addEventListener("click", () => {
        if (!Room.codeHidden && !Prefs.get().hideCodeAsked) { $("hide-code-ask").hidden = false; return; }
        Room.hideCode(!Room.codeHidden);
    });
    const answerHideAsk = (always) => {
        $("hide-code-ask").hidden = true;
        Prefs.set({ hideCodeAsked: true, ...(always ? { hideCode: true } : {}) });
        Room.hideCode(true);
    };
    $("btn-hide-once").addEventListener("click", () => answerHideAsk(false));
    $("btn-hide-always").addEventListener("click", () => answerHideAsk(true));
    $("btn-invite").addEventListener("click", () => { renderLobby(); $("invite-modal").hidden = false; });
    $("btn-invite-done").addEventListener("click", () => { $("invite-modal").hidden = true; });
    $("invite-modal").addEventListener("click", (e) => { if (e.target === $("invite-modal")) $("invite-modal").hidden = true; });
    $("btn-watch").addEventListener("click", () => Room.watchInstead());
    $("btn-take-seat").addEventListener("click", () => Room.takeSeat());
    $("btn-room-bot").addEventListener("click", () => Opponent.open(Settings.game));
    $("btn-room-bot-off").addEventListener("click", () => { Settings.setBot(null); renderLobby(); });
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
    $("overlay-look").addEventListener("click", () => showReplay(totalPlies(), false));
    $("result-fab").addEventListener("click", () => { hideReplay(); $("overlay").hidden = false; });
    $("replay-first").addEventListener("click", () => showReplay(0, true));
    $("replay-prev").addEventListener("click", () => showReplay(currentPly() - 1, true));
    $("replay-next").addEventListener("click", () => showReplay(currentPly() + 1, true));
    $("replay-last").addEventListener("click", () => showReplay(totalPlies(), true));
    $("replay-play").addEventListener("click", togglePlay);
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
    $("overlay-menu").addEventListener("click", () => { if (Match.mode === "replay") closeReplay(); else backToLobby(true); });
    // replays screen: watch / save / delete one entry, open a file, back to the title
    $("replay-list").addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const id = btn.closest(".replay-item").dataset.id;
        const doc = await Replays.store.get(id);
        if (!doc) { toast("That replay is gone."); renderReplays(); return; }
        if (btn.dataset.act === "watch") watchReplay(doc);
        else if (btn.dataset.act === "download") downloadReplay(doc);
        else if (btn.dataset.act === "delete") { await Replays.store.remove(id); renderReplays(); toast("Replay deleted"); }
    });
    $("replay-kind").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-kind]");
        if (!btn) return;
        replayKind = btn.dataset.kind;
        replayPage = 0;
        for (const b of $("replay-kind").querySelectorAll("button")) b.classList.toggle("selected", b === btn);
        renderReplays();
    });
    $("replay-search").addEventListener("input", () => { replaySearch = $("replay-search").value; replayPage = 0; renderReplays(); });
    for (const id of ["replay-from", "replay-to"]) $(id).addEventListener("change", () => {
        replayFrom = $("replay-from").value; replayTo = $("replay-to").value; replayPage = 0;
        renderReplays();
    });
    $("replay-page-prev").addEventListener("click", () => { replayPage--; renderReplays(); });
    $("replay-page-next").addEventListener("click", () => { replayPage++; renderReplays(); });
    $("btn-replay-upload").addEventListener("click", () => $("replay-file").click());
    $("replay-file").addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";                                  // the same file may be opened again
        if (!file) return;
        let text = "";
        try { text = await file.text(); } catch (err) { toast("That file could not be read."); return; }
        const res = Replays.parse(text);                      // JSON → migrate → validate
        if (!res.ok) { toast(res.error); return; }
        await Replays.store.save(res.doc);
        renderReplays();
        watchReplay(res.doc);
    });
    $("btn-replays-back").addEventListener("click", () => show("menu"));
    // the game filter's dropdown closes on a click next to it and on Escape (#43)
    document.addEventListener("click", (e) => {
        if (!$("replay-filter").classList.contains("open") || $("replay-filter").contains(e.target)) return;
        openFilter(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !$("replay-filter").classList.contains("open")) return;
        openFilter(false);
        $("replay-filter-button").focus();
    });

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
    // Play in the bot modal: offline it only remembers my choice, in a room it sets the
    // room's bot, so everybody sees it on the empty seat (#36)
    Opponent.init({ onDone: (game, played) => { if (played && Room.online) Settings.setBot(Opponent.current(game, Settings.read())); renderLobby(); } });
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
    Analysis.init({ onSeek: (ply) => showReplay(ply, true), onPlayFrom: playFromHere });
    Room.init({ phase: () => phase, show, startGame, backToLobby, renderLobby, onVotes: renderRematch, onReview: applyReview });
    // Learn runs its lessons on the game screen; app.js stays the only screen switcher (#41)
    Learn.init({ show, exit: () => { hideReplay(); $("overlay").hidden = true; show("learn-game"); } });
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
