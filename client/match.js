/* The table: who sits where, the active engine, the clock and the bot seat — the same
   for local play, against a bot and online. It knows nothing about rooms: app.js tells it
   the mode and my seat, Room.js listens to its handlers to send moves and to gate play.

   Match.init(handlers):
     live()                may the game run right now (online: everyone here)   default true
     names()               the seat names for the current skin                  default Skins.names()
     turnHint(p)           the turn box hint for a non-bot seat                  default "to move"
     onLocalMove(i)        a local seat is about to play cell i (online: tell the room)
     onChanged(kind)       the game record changed: "move" (placed, before its animation) or
                           "out" (a flag fall applied) — the room saves the session here
     onIdle()              the engine is idle again (a move settled / a turn passed): the
                           room applies queued messages here
     onFlag(p)             the local clock of seat p ran out (online: only the owner decides)
     onFinish(winner, why)

   Seats: app.seats[p] = { kind: "local" | "remote" | "bot" }. Bot mode: you are seat 0,
   the bot seat 1 (Opponent.current(game) picks which bot and level). */

"use strict";

const Match = (() => {
    const THINK_MS = 350;      // a bot answering instantly feels wrong
    const st = {
        mode: "local",         // "local" | "bot" | "online"   (bot = offline against a bot)
        me: -1,                // my seat online; -1 = none yet / local mode / spectator
        spectator: false,      // online without a seat (spectate link, or every seat taken)
        seats: [],             // per player: { kind }
        config: null,          // config of the running / last game
        gameNo: 0,             // increments per game in this room (local too)
        bot: null,             // bot mode: the Bots.create instance for the running game
    };
    let Game = Games.get(Games.keys()[0]).engine;     // active engine, switched in start()
    let deferred = [];                                 // { key, fn } to run once the engine is idle
    let running = false;                               // a game is on the screen (start … stop)
    let h = {
        live: () => true, names: () => Skins.names(), turnHint: () => "to move",
        onLocalMove: () => {}, onChanged: () => {}, onIdle: () => {}, onFlag: () => {}, onFinish: () => {},
    };

    const online = () => st.mode === "online";
    const kind = (p) => (st.seats[p] ? st.seats[p].kind : "local");
    const isLocal = (p) => kind(p) === "local";
    const isBot = (p) => kind(p) === "bot";
    // seat 0 starts game 1, then the next seat, round-robin
    const startPlayerFor = (gameNo, players = 2) => (gameNo - 1) % players;
    // who moves for each seat: this device, a friend, or the bot
    const makeSeats = (players) => Array.from({ length: players }, (_, p) => ({
        kind: online() ? (p === st.me ? "local" : "remote") : (st.mode === "bot" && p > 0 ? "bot" : "local"),
    }));
    const playerColor = (p) => (p >= 0 ? `var(--c${p})` : "#ffffff");
    // seat names for the HUD: the skin's colour names; a bot seat shows the bot's name
    const names = () => h.names().map((n, p) => (isBot(p) && st.bot ? st.bot.def.name : n));

    /* ---------- engine hooks ---------- */
    const hooks = {
        get names() { return names(); },
        mayPlay: (p) => isLocal(p) && h.live(),          // bot seats move in onTurn
        turnHint: (p) => (isBot(p) ? "thinking…" : h.turnHint(p)),
        onCellClick: (i) => {
            const s = Game.state;
            if (s.busy || s.over || !hooks.mayPlay(s.current) || !Game.isLegal(i, s.current)) return;
            h.onLocalMove(i);
            Game.play(i);
        },
        onMoveApplied: () => h.onChanged("move"),
        onTurn: (p) => {
            Clock.setActive(p);
            if (h.live()) Clock.resume();
            if (isBot(p)) botTurn(p); else idle();
        },
        onBusy: (busy) => {
            if (busy) { Clock.pause(); return; }
            if (h.live()) Clock.resume();
            idle();
        },
        onFinish: (winner, why) => { Clock.stop(); h.onFinish(winner, why); },
    };

    // the engine settled: run what waited for it (sync, flag falls), then the room's queue
    function idle() {
        while (deferred.length && !Game.state.busy) deferred.shift().fn();
        h.onIdle();
    }
    // run fn now if the engine is idle, else once it is (a key replaces an older entry)
    function whenIdle(fn, key) {
        if (!Game.state.busy) { fn(); return; }
        if (key) deferred = deferred.filter((d) => d.key !== key);
        deferred.push({ key, fn });
    }

    /* ---------- clock ---------- */
    // a clock ran out: online only the owner of that clock decides (clocks drift)
    function onFlag(p) {
        if (Game.state.over) return;
        if (online() && p !== st.me) return;
        h.onFlag(p);
        flagged(p);
    }
    // a player is out of time: with two players the other one wins, with more the player is out
    function flagged(p) {
        if (Game.state.over) return;
        whenIdle(() => { if (Game.eliminate(p, "Out of time!")) h.onChanged("out"); }, "out:" + p);
    }
    // the clock runs only while the game may run and nothing animates
    function syncClock() {
        if (!running || Game.state.over) return;
        if (h.live() && !Game.state.busy) Clock.resume(); else Clock.pause();
    }

    /* ---------- bot seat ---------- */
    // the bot's move: ask its instance on a copy of the state, then play it like a click
    function botTurn(p) {
        const gameNo = st.gameNo;
        const bot = st.bot;
        if (!bot) return;
        const stillOn = () => running && gameNo === st.gameNo && st.bot === bot && !Game.state.over && !Game.state.busy && Game.state.current === p;
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
    function setupBot(cfg, players) {
        BotPersona.detach();
        st.bot = null;
        if (st.mode !== "bot") return;
        const choice = Opponent.current(cfg.game);
        if (!choice) { st.seats[1].kind = "local"; return; }        // no bot for this game: play both sides
        // seed: fresh per game so the bot varies; tests pin it via sessionStorage["chainreact.botseed"]
        const seed = ((Number(Util.load(sessionStorage, "chainreact.botseed")) || Date.now()) + st.gameNo) >>> 0;
        st.bot = Bots.create(choice.id, { me: 1, difficulty: choice.difficulty, seed, players });
        const est = Bots.estimator(cfg.game);
        BotPersona.attach({ bot: st.bot, seat: 1, game: cfg.game, state: () => Game.state, estimate: (s) => est.at(s, 300), color: playerColor(1) });
    }

    /* ---------- lifecycle ---------- */
    // a new game at this table: game number, config; seat 0 starts game 1, then the next seat
    function start(cfg, gameNo) {
        const players = cfg.players || 2;
        st.config = cfg;
        st.gameNo = gameNo;
        st.seats = makeSeats(players);
        deferred = [];
        running = true;
        Game = Games.get(cfg.game).engine;
        setupBot(cfg, players);
        Clock.setup(cfg.timer, onFlag, players);
        Game.newGame({ ...cfg, startPlayer: startPlayerFor(gameNo, players) }, hooks);
    }
    // stop the running game without a result (back to the room)
    function stop() {
        running = false;
        BotPersona.detach();
        Clock.stop();
        Game.abandon();
    }
    // a fresh table for a mode (title-screen choice, entering / leaving a room)
    function reset(mode, me = -1, spectator = false) {
        stop();
        st.mode = mode;
        st.config = null;
        st.gameNo = 0;
        st.bot = null;
        st.seats = [];
        deferred = [];
        setSeat(me, spectator);
    }
    // take a seat (room creation, session restore, assigned by the host)
    function setSeat(me, spectator = false) {
        st.me = spectator ? -1 : me;
        st.spectator = spectator;
        if (st.config) st.seats = makeSeats(st.config.players || 2);
    }

    // the running game as data (session, sync, a future replay list) + the room's numbering
    const record = () => ({ ...Game.record(), gameNo: st.gameNo, clocks: Clock.snapshot() });

    function init(handlers) { h = { ...h, ...handlers }; }

    return {
        init, start, stop, reset, setSeat, record, flagged, whenIdle, syncClock, startPlayerFor, playerColor,
        get engine() { return Game; }, get state() { return Game.state; }, get names() { return names(); }, get running() { return running; },
        get mode() { return st.mode; }, get me() { return st.me; }, get spectator() { return st.spectator; },
        get seats() { return st.seats; }, get config() { return st.config; }, get gameNo() { return st.gameNo; }, get bot() { return st.bot; },
        set gameNo(n) { st.gameNo = n; },
        isLocal, isBot, THINK_MS,
    };
})();
