/* The online room: the host-authoritative protocol over Net, presence (who of the seats is
   here), seat assignment, the handshake on every (re)connect, move relay, sync / desync
   recovery, rematch votes, the in-game net box and banner, and the session that survives a
   page refresh. app.js drives the screens; Room tells it when to start a game or go back
   to the lobby through its handlers:

   Room.init({ phase(), show(name), startGame(config, gameNo), backToLobby(announce),
               renderLobby(), onVotes() })

   Protocol summary (details in AGENTS.md "Online play"): guest → hello {seat, spectate, rev,
   phase, config, g, rematch}; host → state {you, settings, …} to that guest (+ sync in a
   game) and roster to everyone; the host stamps every guest message with `from` = the
   sender's seat and relays the RELAY types to the other guests. Newest intent wins: every
   phase change bumps `rev`; on reconnect the higher revision decides the phase. */

"use strict";

const Room = (() => {
    const { $, toast } = Util;
    const RELAY = new Set(["move", "chat", "react", "tolobby", "rematch", "timeout", "lobby"]);
    // what only a seated player may do (#29): the host drops these from spectators before relaying
    const PLAYERS_ONLY = new Set(["move", "timeout", "rematch", "tolobby", "lobby", "start-request"]);
    // does the host accept this message from a connection with that seat (-1 = spectator)?
    const accepts = (msg, seat) => !(PLAYERS_ONLY.has(msg.t) && !(seat >= 0));
    const STATUS_TEXT = { connected: "Connected", waiting: "Waiting for friend", reconnecting: "Reconnecting…", connecting: "Connecting…", signaling: "Room server reconnecting…", error: "Connection error" };
    const r = {
        rev: 0,                 // room-state revision: +1 per phase change (start, rematch, back to room)
        roster: { present: [], spectators: 0, left: [] },   // who is here (guests: from the host's roster message)
        left: new Set(),        // seats that said goodbye (their connection may still be closing) — banner wording
        codeHidden: false,      // the room code is hidden (lobby, HUD net box, address bar) — streaming, #19
        netDetail: "",          // last status detail from Net (banner text)
        votes: new Set(),       // seats that pressed Rematch for the next game (everyone must)
        incoming: [],           // queued friend moves while we animate
        syncSentAt: -1,         // history length of my last sync message (-1 = none since my last move)
        rebuiltAt: null,        // "gameNo:length" of my last rebuild from the host (second time = give up)
    };
    let h = { phase: () => "menu", show: () => {}, startGame: () => {}, backToLobby: () => {}, renderLobby: () => {}, onVotes: () => {} };

    const online = () => Match.mode === "online";
    const isHost = () => Net.role === "host";     // transport role: the host is the room's source of truth
    const Game = () => Match.engine;
    const names = () => Skins.names();
    const inGame = () => h.phase() === "game";
    // seats of the running game, else of the settings (the lobby)
    const playersNow = () => (inGame() && Match.config ? Match.config.players : Settings.read().players) || 2;
    const two = () => playersNow() === 2;
    // how a seat is called in messages: with two players the classic "your friend", else the colour name
    const who = (seat) => (two() ? "Your friend" : names()[seat] || "Someone");
    const otherPlayer = (p, players = 2) => (p + 1) % players;
    // every message I originate carries my seat
    const netSend = (obj) => Net.send({ from: Match.me, ...obj });

    /* ---------- presence: who of the seats is here ---------- */
    const seatOf = (id) => { const p = Net.peers.find((x) => x.id === id); return p ? p.seat : -1; };
    // per seat: is somebody there? Host: from its connections; guest: from the host's roster; me: always
    function presentSeats() {
        const n = playersNow();
        const present = new Array(n).fill(!online());
        if (!online()) return present;
        if (Match.me >= 0 && Match.me < n) present[Match.me] = true;
        if (!Net.connected) return present;
        if (isHost()) { for (const p of Net.peers) if (p.open && p.seat >= 0 && p.seat < n && !r.left.has(p.seat)) present[p.seat] = true; }
        else for (let k = 0; k < n; k++) if (r.roster.present[k]) present[k] = true;
        return present;
    }
    const missingSeats = () => presentSeats().map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
    const allHere = () => online() && Net.connected && missingSeats().length === 0;   // every seat filled and connected
    const live = () => !online() || allHere();                                        // the game may run (clock, input)
    const someoneLeft = (seats) => seats.some((k) => r.left.has(k) || r.roster.left.includes(k));

    // host: what everyone should know about presence; sent on every change
    function computeRoster() {
        const n = playersNow();
        let spectators = 0;
        for (const p of Net.peers) if (p.open && (p.seat < 0 || p.seat >= n)) spectators++;
        return { present: presentSeats(), spectators, left: [...r.left] };
    }
    function rosterChanged() {
        if (!online()) return;
        if (isHost()) { r.roster = computeRoster(); netSend({ t: "roster", ...r.roster }); }
        presenceChanged();
    }
    // both sides, after any change of who is here
    function presenceChanged() {
        renderNetBox();
        h.renderLobby();
        Match.syncClock();
        updateBanner();
    }

    // take a seat (room creation, session restore, or assigned by the host in `state`)
    function setSeat(me, spectator = false) {
        Match.setSeat(me, spectator);
        renderNetBox();
        h.renderLobby();
        h.onVotes();                                  // the Rematch / Back-to-room buttons follow the seat (#29)
        save();
    }

    /* ---------- enter / leave ---------- */
    function roomLink(code, spectate) {
        const url = new URL(location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("room", code);
        if (spectate) url.searchParams.set("spectate", "1");
        return url.toString();
    }
    // the address bar carries ?room=CODE (&spectate=1) while in a room, unless the code is hidden
    function setUrlRoom(code) {
        const url = new URL(location.href);
        if (r.codeHidden) code = null;
        if (code) url.searchParams.set("room", code); else { url.searchParams.delete("room"); url.searchParams.delete("spectate"); }
        if (code && Match.spectator) url.searchParams.set("spectate", "1");
        history.replaceState(null, "", url.toString());
    }
    // what the lobby / HUD show as the code: bullets while hidden
    const codeText = (code = Net.code) => (r.codeHidden ? "•••••" : (code || "…"));
    // hide / show the code (a streamer's viewers must not join): lobby, HUD, URL and the session follow
    function hideCode(on) {
        r.codeHidden = !!on;
        setUrlRoom(Net.code);
        renderNetBox();
        h.renderLobby();
        save();
    }

    // preferHost: true = I created / hosted this room, false = joining by code or link.
    // seat: my player number if I already have one (creator: 0, refresh: from the session).
    // spectate: watch only (spectate link, or a refresh of a spectator).
    // hidden: enter with the code hidden (the preference, or the session's state on a refresh).
    function enter(code, preferHost, seat = -1, spectate = false, hidden = Prefs.get().hideCode) {
        if (goodbye) { clearTimeout(goodbye); goodbye = null; }   // a room left a moment ago: Net.open closes it now, the delayed shutdown must not hit the new room
        Match.reset("online", seat, spectate);
        Object.assign(r, { rev: 0, roster: { present: [], spectators: 0, left: [] }, left: new Set(), votes: new Set(), incoming: [], syncSentAt: -1, rebuiltAt: null, codeHidden: !!hidden });
        Chat.enable(true);
        Settings.setMode("online");
        h.show("lobby");
        $("lobby-code").textContent = "…";
        const finalCode = Net.open(code, {
            preferHost,
            onStatus: (status, detail) => {
                r.netDetail = detail;
                if (h.phase() === "lobby") { $("lobby-status").textContent = detail; h.renderLobby(); }
                renderNetBox();
                updateBanner(status);
            },
            onRole: (role) => {
                if (role === "host") { r.left.clear(); if (Match.me < 0 && !Match.spectator) setSeat(0); }
                h.renderLobby();
                save();
            },
            onOpen: onPeerOpen,
            onClose: () => { if (isHost()) rosterChanged(); else { Clock.pause(); presenceChanged(); } },
            onMessage,
            metadata: () => ({ seat: Match.me, spectate: Match.spectator }),
            admit: admitGuest,
        }, preferHost === false ? "guest" : undefined);
        $("lobby-code").textContent = codeText(finalCode);
        setUrlRoom(finalCode);
        h.renderLobby();
        return finalCode;
    }

    // say goodbye (the others treat my seat as gone at once) and drop the connection
    let goodbye = null;                                     // the delayed transport shutdown after a "leave" message
    function leave() {
        if (goodbye) { clearTimeout(goodbye); goodbye = null; }
        if (online()) {
            const sent = netSend({ t: "leave" });
            if (sent) goodbye = setTimeout(() => { goodbye = null; Net.leave(); }, 250); else Net.leave();   // let the goodbye go out first
        } else Net.leave();
        Session.clear();
        Chat.enable(false);
        setUrlRoom(null);
        $("net-banner").hidden = true;
    }

    /* ---------- phase changes ---------- */
    // a game starts (local too): new revision, fresh votes and move queue
    function newGame() {
        r.rev++;
        r.votes = new Set();
        r.incoming = [];
    }
    const bump = () => { r.rev++; };
    // start game `gameNo` with `cfg` (through app.js, which switches the screen)
    const startGame = (cfg, gameNo) => h.startGame(cfg, gameNo);

    /* ---------- rematch (every seat must press; offline it is instant, see app.js) ---------- */
    function requestRematch() {
        if (Match.spectator) return;
        r.votes.add(Match.me);
        netSend({ t: "rematch", g: Match.gameNo + 1 });
        if (rematchComplete()) return;
        h.onVotes();
        toast("Rematch requested");
    }
    const votedMyself = () => r.votes.has(Match.me);
    const rematchWaitText = () => (two() ? "Waiting for opponent…" : `Waiting for others… (${r.votes.size}/${playersNow()})`);
    // everyone pressed: start the next game
    function rematchComplete() {
        for (let k = 0; k < playersNow(); k++) if (!r.votes.has(k)) return false;
        startGame(Match.config, Match.gameNo + 1);
        Log.add("Rematch!", "x");
        sendSync();
        return true;
    }

    /* ---------- handshake & seats ---------- */
    function onPeerOpen(role) {
        r.syncSentAt = -1;
        if (role === "guest") { r.left.clear(); netSend({ t: "hello", seat: Match.me, spectate: Match.spectator, ...roomState() }); }
        presenceChanged();                            // host: the guest's hello assigns its seat and sends the roster
    }

    // host: may a newcomer without a seat of ours join? Always — with every seat taken it
    // becomes a spectator (a returning seat holder replaces its stale connection inside Net)
    function admitGuest() { return true; }
    const takenSeats = (exceptId) => new Set([Match.me, ...Net.peers.filter((p) => p.open && p.id !== exceptId).map((p) => p.seat)]);
    function freeSeat(taken, n) { for (let k = 0; k < n; k++) if (!taken.has(k)) return k; return -1; }

    // host: the number of seats changed (settings) — nobody keeps a seat that no longer
    // exists, and people without a seat get a free one (unless they chose to spectate)
    function reseat() {
        if (!isHost() || !online()) return;
        const n = playersNow();
        if (Match.me >= n) { const s = freeSeat(takenSeats(), n); setSeat(s, s < 0); }
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
            rev: r.rev, phase: inGame() ? "game" : "lobby", config: Match.config, g: Match.gameNo,
            rematch: inGame() && Match.state.over && votedMyself(),
        };
    }
    function sendState(id, guestSeat) {
        Net.sendTo(id, { t: "state", from: Match.me, you: guestSeat, settings: Settings.read(), ...roomState() });
    }
    function syncMessage() {
        const st = Match.state;
        return { t: "sync", g: Match.gameNo, history: st.history.slice(), outs: st.outs.slice(), clocks: Clock.snapshot(), h: Game().hash() };
    }
    function sendSync() {
        if (!Match.config || !inGame()) return;
        r.syncSentAt = Match.state.history.length;
        netSend(syncMessage());
    }
    function sendSyncTo(id) {
        if (!Match.config || !inGame()) return;
        Net.sendTo(id, { from: Match.me, ...syncMessage() });
    }
    // the friend's phase is newer than mine (my last phase change never reached them, or theirs never reached me)
    function adoptRoomState(msg) {
        const gameNo = msg.g || Match.gameNo;
        if (msg.phase === "game" && msg.config) {
            if (!inGame() || gameNo !== Match.gameNo) startGame(msg.config, gameNo);
            Log.add("Joined your friend's game.", "x");
        } else if (h.phase() !== "lobby") {
            Match.gameNo = gameNo;
            h.backToLobby(false);
            toast("Your friend went back to the room");
        } else Match.gameNo = gameNo;
        r.rev = msg.rev;
    }

    const inThisGame = (msg) => msg.g === Match.gameNo && inGame();

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
            if (seat >= 0) r.left.delete(seat);
            if (msg.rev > r.rev) adoptRoomState(msg);         // the guest's phase is newer: follow it before answering
            sendState(id, seat);
            if (inGame()) sendSyncTo(id);
            if (msg.rematch && seat >= 0) {                     // pressed Rematch while away: counts, and the others learn it
                HANDLERS.rematch({ g: Match.gameNo + 1, from: seat });
                Net.sendExcept(id, { t: "rematch", g: Match.gameNo + 1, from: seat });
            }
            rosterChanged();
        },
        // from the host on every (re)connect: take my seat, mirror settings, follow the host's phase
        // (the host already adopted mine if it was newer, so ties are the normal case)
        state(msg) {
            if (isHost()) return;
            const you = msg.you >= 0 ? msg.you : -1;
            r.left.clear();
            setSeat(you, you < 0);
            Settings.write(msg.settings);
            if (msg.rev >= r.rev) {
                if (msg.phase === "game" && msg.config) {
                    if (!inGame() || msg.g !== Match.gameNo) {
                        startGame(msg.config, msg.g);
                        Log.add("Connected to host.", "x");
                    }
                    r.rev = msg.rev;
                    sendSync();
                } else {
                    Match.gameNo = msg.g || Match.gameNo;
                    if (h.phase() !== "lobby") h.backToLobby(false);
                    r.rev = msg.rev;
                    h.renderLobby();
                }
            }
            setUrlRoom(Net.code);
            if (msg.rematch) HANDLERS.rematch({ g: Match.gameNo + 1, from: msg.from });
        },
        roster(msg) {                                 // the host's view of who is here
            if (isHost()) return;
            r.roster = { present: msg.present || [], spectators: msg.spectators || 0, left: msg.left || [] };
            presenceChanged();
        },
        lobby(msg) {                                  // somebody changed game / settings
            Settings.write(msg.s);
            if (h.phase() === "lobby") toast(two() ? "Settings updated by your friend" : `Settings updated by ${names()[msg.from] || "your friend"}`);
            reseat();
        },
        "start-request"() {                           // a guest asked the host to start
            if (isHost() && h.phase() === "lobby" && allHere()) hostStart(Settings.read());
        },
        start(msg) {                                  // the host started a game
            if (isHost() || msg.g <= Match.gameNo) return;
            startGame(msg.config, msg.g);
            Log.add(`Game ${msg.g}: ${Games.get(msg.config.game).title}.`, "x");
        },
        tolobby(msg) {
            if (inGame()) { toast(`${who(msg.from)} went back to the room`); h.backToLobby(false); }
        },
        sync(msg) {
            if (!inThisGame(msg)) return;
            Match.whenIdle(() => applySync(msg), "sync");
        },
        move(msg) {
            if (!inThisGame(msg)) return;
            r.incoming.push(msg);
            processIncoming();
        },
        timeout(msg) {
            if (!inThisGame(msg) || Match.state.over) return;
            Match.flagged(msg.p);
        },
        rematch(msg) {
            if (msg.g <= Match.gameNo || !inGame() || !(msg.from >= 0)) return;   // stale / duplicate request
            r.votes.add(msg.from);
            if (rematchComplete()) return;
            if (!votedMyself()) toast(two() ? "Opponent wants a rematch" : `${names()[msg.from]} wants a rematch`);
            h.onVotes();
        },
        react(msg) {
            Reactions.receive(msg.e, Match.playerColor(Number.isInteger(msg.from) ? msg.from : otherPlayer(Match.me)));
        },
        chat(msg) {                                   // a chat line; `from` = the sender's seat (-1 spectator)
            Chat.receive({ text: msg.text, from: Number.isInteger(msg.from) ? msg.from : otherPlayer(Match.me) });
        },
        leave(msg, id) {                              // somebody says goodbye (their connection closes right after)
            const seat = isHost() ? seatOf(id) : (Number.isInteger(msg.from) ? msg.from : -1);
            if (seat >= 0) { r.left.add(seat); if (!isHost()) r.roster.present[seat] = false; }
            Clock.pause();
            if (isHost()) rosterChanged(); else presenceChanged();
            if (!inGame() && seat >= 0) $("lobby-status").textContent = `${who(seat)} left the room.`;
        },
    };
    function onMessage(msg, id) {
        if (isHost() && id !== "host") {
            msg.from = seatOf(id);                    // the host stamps every guest message with its seat…
            if (!accepts(msg, msg.from)) { onRefused(msg, id); return; }   // …a spectator only watches (#29)…
            if (RELAY.has(msg.t)) Net.sendExcept(id, msg);   // …and passes game messages on to the other guests
        }
        const handler = HANDLERS[msg.t];
        if (handler) handler(msg, id);
    }

    // host: a spectator tried to change something; put its view straight again
    function onRefused(msg, id) {
        if (msg.t === "lobby") Net.sendTo(id, { t: "lobby", s: Settings.read(), from: Match.me });
    }

    // Start pressed in the lobby: the host starts, a guest asks the host
    function startFromLobby(cfg) {
        if (!allHere() || Match.spectator) return;
        if (isHost()) hostStart(cfg);
        else { netSend({ t: "start-request" }); toast("Asked the host to start"); }
    }
    function hostStart(cfg) {
        const g = Match.gameNo + 1;
        netSend({ t: "start", config: cfg, g });
        startGame(cfg, g);
        Log.add(`Game ${g}: ${Games.get(cfg.game).title}.`, "x");
    }

    /* ---------- moves & sync ---------- */
    // my own move (the engine plays it right after): tell everyone, with the board hash before it
    function sendMove(i) {
        netSend({ t: "move", i, n: Match.state.history.length, g: Match.gameNo, h: Game().hash() });
    }

    // apply queued friend moves in order; a gap means we missed something -> ask for a sync
    function processIncoming() {
        const st = Match.state;
        if (!inGame() || st.busy || st.over) return;
        while (r.incoming.length) {
            const m = r.incoming[0];
            if (m.n < st.history.length) { r.incoming.shift(); continue; }   // already applied
            if (m.n > st.history.length) { sendSync(); return; }
            r.incoming.shift();
            if (Match.isLocal(st.current) || !Game().isLegal(m.i, st.current)) { sendSync(); return; }
            if (m.h !== undefined && m.h !== Game().hash()) { sendSync(); return; }   // boards differ: sort it out first
            Game().play(m.i);
            return;
        }
    }

    /* Sync = the friend's move history (+ eliminations) + state hash. The longer history wins
       when the shorter one is its prefix (the short side replays the tail). Anything else is a
       desync: the guest rebuilds the game from the host's history; if the boards still differ
       after that, both go back to the room rather than playing two different games. */
    function applySync(msg) {
        const theirs = msg.history || [];
        const mine = Match.state.history;
        const common = Math.min(mine.length, theirs.length);
        for (let k = 0; k < common; k++) if (mine[k] !== theirs[k]) { resolveDesync(msg); return; }
        if (theirs.length > mine.length) {
            Game().replay(theirs.slice(mine.length), msg.outs);
            if (msg.clocks) Clock.restore(msg.clocks);
            save();
        } else if (theirs.length < mine.length) {
            // I am ahead. If I already told the host and it still doesn't have my moves, it rejected them.
            if (!isHost() && r.syncSentAt === mine.length) { resolveDesync(msg); return; }
            sendSync();
            afterSync();
            return;
        } else if (msg.outs && msg.outs.length) Game().replay([], msg.outs);   // same moves, maybe a flag fall I missed
        if (msg.h !== undefined && Match.state.history.length === theirs.length && msg.h !== Game().hash()) { resolveDesync(msg); return; }
        afterSync();
    }
    function afterSync() {
        if (!Match.state.over) { Clock.setActive(Match.state.current); if (live()) Clock.resume(); }
        Game().render();
        processIncoming();
    }
    function resolveDesync(msg) {
        if (isHost()) { sendSync(); return; }                  // the guest rebuilds from us
        const key = `${Match.gameNo}:${(msg.history || []).length}`;
        if (r.rebuiltAt === key) {                              // rebuilt once already and still different: give up
            Log.add("Out of sync with your friend.", "x");
            toast("Game out of sync. Back to the room.");
            h.backToLobby(true);
            return;
        }
        startGame(Match.config, Match.gameNo);
        r.rebuiltAt = key;
        r.rev--;                                                // a rebuild is not a new phase
        Game().replay(msg.history || [], msg.outs);
        if (msg.clocks) Clock.restore(msg.clocks);
        Log.add("Re-synced with the host.", "x");
        sendSync();
        afterSync();
    }

    /* ---------- net UI ---------- */
    function renderNetBox() {
        $("net-box").hidden = !online();
        if (!online()) return;
        $("net-dot").className = "net-dot " + Net.status;
        const missing = Net.connected ? missingSeats().length : 0;
        $("net-text").textContent = Match.spectator && Net.connected ? "Spectating" : missing && !two() ? `Waiting for ${missing}…` : (STATUS_TEXT[Net.status] || Net.status);
        $("net-code").textContent = Net.code ? "Room " + codeText() : "";
        for (let k = 0; k < 4; k++) { const you = $(`p${k}-you`); if (you) you.hidden = Match.me !== k; }
        Game().render();                              // cell locks depend on the connection
    }
    // the in-game banner: my connection is in trouble, or a seat is empty (the game waits)
    function updateBanner(status = Net.status) {
        const banner = $("net-banner");
        if (!inGame() || !online()) { banner.hidden = true; return; }
        const missing = missingSeats();
        const connectionFine = status === "connected" || status === "idle" || (status === "signaling" && Net.connected);
        if (connectionFine && missing.length === 0) { banner.hidden = true; return; }
        let text;
        if (Net.connected && missing.length) {
            const gone = someoneLeft(missing);
            text = two()
                ? (gone ? "Your friend left the room. The game resumes if they come back." : "Your friend seems to be away. The game resumes when they are back.")
                : `Waiting for ${missing.map((k) => names()[k]).join(", ")}${gone ? " (left the room)" : ""}. The game resumes when everyone is back.`;
        } else text = r.left.size
            ? (two() ? "Your friend left the room. The game resumes if they come back." : `${[...r.left].map((k) => names()[k]).join(", ")} left the room. The game resumes if they come back.`)
            : r.netDetail || "Reconnecting…";
        $("net-banner-text").textContent = text;
        $("btn-net-retry").hidden = !["reconnecting", "error", "signaling"].includes(status);
        banner.hidden = false;
    }
    // after a phase change: net box, banner, session
    function render() {
        renderNetBox();
        updateBanner();
        save();
    }

    /* ---------- session (survive a page refresh) ---------- */
    function save() {
        if (!online()) return;
        const game = inGame();
        const rec = Match.record();
        Session.save({
            code: Net.code, me: Match.me, spectator: Match.spectator, role: Net.role, gameNo: Match.gameNo, rev: r.rev, phase: h.phase(), config: Match.config,
            history: game ? rec.history : [], outs: game ? rec.outs : [], clocks: rec.clocks, codeHidden: r.codeHidden,
        });
    }

    // the turn-box hint for a seat while online
    function turnHint(p) {
        if (Match.spectator) return "spectating";
        if (p === Match.me) return "your move";
        return two() ? "waiting for opponent…" : `waiting for ${names()[p]}…`;
    }

    function init(handlers) { h = { ...h, ...handlers }; }

    return {
        init, enter, leave, roomLink, hideCode, codeText, newGame, bump, save, render, renderNetBox, updateBanner, turnHint,
        presentSeats, missingSeats, allHere, live, who, two, playersNow,
        startFromLobby, requestRematch, rematchWaitText, sendMove, sendSync, reseat,
        onIdle: processIncoming,
        onChanged: (kind) => { if (kind === "move") r.syncSentAt = -1; save(); },
        onFlag: (p) => netSend({ t: "timeout", p, g: Match.gameNo }),
        settingsChanged: (cfg) => { if (Match.spectator) return; netSend({ t: "lobby", s: cfg }); reseat(); },
        say: (text) => netSend({ t: "chat", text }),
        tolobby: () => { if (!Match.spectator) netSend({ t: "tolobby" }); },
        accepts, PLAYERS_ONLY,
        react: (e) => netSend({ t: "react", e }),
        get rev() { return r.rev; }, set rev(v) { r.rev = v; },
        get spectators() { return r.roster.spectators; },
        get votes() { return r.votes; }, get votedMyself() { return votedMyself(); },
        get online() { return online(); }, get codeHidden() { return r.codeHidden; }, get isHost() { return isHost(); },
    };
})();
