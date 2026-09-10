/* The table: who sits where, the active engine, the clock and the bot seat — the same
   for local play, against a bot and online. It knows nothing about rooms: app.js tells it
   the mode and my seat, Room.js listens to its handlers to send moves and to gate play.

   Match.init(handlers):
     live()                may the game run right now (online: everyone here)   default true
     names()               the name of whoever sits in each seat (#35)          default Player 1…4
     turnHint(p)           the turn box hint for a non-bot seat                  default "to move"
     beforeMove(i, p)      false consumes the click instead of playing it        default true
                           (Learn's tutorial takes only the cell its step asks for)
     cellClass(i)          one extra class for cell i, painted by the engine     default ""
                           (Learn's highlight; the premove and the replay analysis'
                           best-move marker win over it)
     onLocalMove(i)        a local seat is about to play cell i (online: tell the room)
     onChanged(kind)       the game record changed: "move" (placed, before its animation) or
                           "out" (a flag fall applied) — the room saves the session here
     onIdle()              the engine is idle again (a move settled / a turn passed): the
                           room applies queued messages here
     onFlag(p)             the local clock of seat p ran out (online: only the owner decides)
     onFinish(winner, why)

     hostsBot()            online: does this device run the room's bot seat (#36)   default false
     onBotReact(seat, e)   the bot's persona reacted (online: relay it to the room)

   Seats: Match.seats[p] = { kind: "local" | "remote" | "bot" | "watch" }. Bot mode: you are
   seat 0, the bot seat 1 (Opponent.current(game) picks which bot and level). Online a room
   can have a bot too (#36): `config.bot = { id, difficulty, seat }` names it, the transport
   host runs it (hostsBot) and relays its moves and reactions, and for everybody else that
   seat is a normal remote seat that happens to be called "Bot". `Match.watch` puts a
   recorded game on the board (#42): mode "replay", every seat "watch", nobody plays.

   Premove (#37): with exactly one local seat (against a bot or online with a seat) a click
   while the friend / bot is to move remembers that cell instead of dropping the click. The
   same cell takes it back, another cell moves it. When the turn comes it is played through
   the very same path as a click (onLocalMove + Game.play), or dropped when it became
   illegal. The engine marks it on the board through the cellClass hook. */

"use strict";

const Match = (() => {
    const THINK_MS = 350;      // a bot answering instantly feels wrong
    const st = {
        mode: "local",         // "local" | "bot" | "online" | "replay"   (bot = offline against a bot, replay = watching a record)
        me: -1,                // my seat online; -1 = none yet / local mode / spectator
        spectator: false,      // online without a seat (spectate link, or every seat taken)
        seats: [],             // per player: { kind }
        config: null,          // config of the running / last game
        gameNo: 0,             // increments per game in this room (local too)
        bot: null,             // bot mode: the Bots.create instance for the running game
        premove: -1,           // the cell I will play as soon as it is my turn (-1 = none, #37)
        marked: -1,            // a cell the replay analysis wants marked (-1 = none, #43): display only
        botInfo: null,         // the bot's last move for the dev panel (#31): { id, difficulty, budget, move, ms, nodes, depth, value }
    };
    let Game = Games.get(Games.keys()[0]).engine;     // active engine, switched in start()
    let deferred = [];                                 // { key, fn } to run once the engine is idle
    let running = false;                               // a game is on the screen (start … stop)
    let h = {
        live: () => true, names: () => ["Player 1", "Player 2", "Player 3", "Player 4"], turnHint: () => "to move", hostsBot: () => false,
        beforeMove: () => true, cellClass: () => "",
        onLocalMove: () => {}, onChanged: () => {}, onIdle: () => {}, onFlag: () => {}, onBotReact: () => {}, onFinish: () => {},
    };

    const online = () => st.mode === "online";
    const watching = () => st.mode === "replay";       // a recorded game on the board (#42)
    const kind = (p) => (st.seats[p] ? st.seats[p].kind : "local");
    const isLocal = (p) => kind(p) === "local";
    const isBot = (p) => kind(p) === "bot";
    // seat 0 starts game 1, then the next seat, round-robin
    const startPlayerFor = (gameNo, players = 2) => (gameNo - 1) % players;
    // the seat a bot holds: offline every seat but mine, online the one the room's config names (#36)
    const roomBotSeat = () => (st.config && st.config.bot ? st.config.bot.seat : -1);
    // who moves for each seat: this device, a friend, or the bot. Online the room's bot runs
    // on the transport host and is a normal remote seat for everybody else (#36).
    const makeSeats = (players) => Array.from({ length: players }, (_, p) => ({
        kind: watching() ? "watch"                                   // a replay: nobody sits here (#42)
            : online()
            ? (p === roomBotSeat() ? (h.hostsBot() ? "bot" : "remote") : p === st.me ? "local" : "remote")
            : (st.mode === "bot" && p > 0 ? "bot" : "local"),
    }));
    const playerColor = (p) => (p >= 0 ? `var(--c${p})` : "#ffffff");
    // my seat at this table: the one seat this device plays (-1 = none / several / spectator)
    const mySeat = () => {
        const local = st.seats.map((s, p) => (s.kind === "local" ? p : -1)).filter((p) => p >= 0);
        return local.length === 1 ? local[0] : -1;
    };
    // premoves make sense only when somebody else moves in between (bot or online seat)
    const premovable = () => running && !st.spectator && st.mode !== "local" && mySeat() >= 0;
    // seat names for the HUD: what the people at the table are called; a bot seat is simply
    // "Bot" (#21) — in a room on every device, not only on the one that runs it (#36)
    const names = () => h.names().map((n, p) => ((isBot(p) && st.bot) || p === roomBotSeat() ? Opponent.NAME : n));

    /* ---------- engine hooks ---------- */
    const hooks = {
        get names() { return names(); },
        mayPlay: (p) => isLocal(p) && h.live(),          // bot seats move in onTurn
        turnHint: (p) => {
            const hint = isBot(p) ? "thinking…" : h.turnHint(p);
            return st.premove >= 0 && !isLocal(p) ? `${hint} · premove set` : hint;
        },
        // one class per cell: the premove wins, then the replay analysis' best move (#43),
        // then whatever the app wants there (Learn's highlight). They never overlap in
        // practice: a lesson is not a finished game and a replay has no premove.
        cellClass: (i) => (i === st.premove ? "premove" : i === st.marked ? "best-move" : h.cellClass(i)),
        onCellClick: (i) => {
            const s = Game.state;
            if (s.over) return;
            if (!isLocal(s.current)) { premove(i); return; }        // not my turn: remember the cell (#37)
            if (s.busy) return;                                     // nothing lands while a move animates
            if (!h.beforeMove(i, s.current)) return;                // a lesson may take the click itself (Learn)
            if (!hooks.mayPlay(s.current) || !Game.isLegal(i, s.current)) return;
            h.onLocalMove(i);
            Game.play(i);
        },
        onMoveApplied: () => h.onChanged("move"),
        onTurn: (p) => {
            Clock.setActive(p);
            if (h.live()) Clock.resume();
            if (isBot(p)) { botTurn(p); return; }
            idle();
            if (isLocal(p)) firePremove(p);
        },
        onBusy: (busy) => {
            if (busy) { Clock.pause(); return; }
            if (h.live()) Clock.resume();
            idle();
        },
        onFinish: (winner, why) => { Clock.stop(); clearPremove(); h.onFinish(winner, why); },
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

    /* ---------- premove (#37) ---------- */
    // a click while the friend / bot is to move: set, switch or take back the premove
    function premove(i) {
        if (!premovable()) return;
        st.premove = i === st.premove ? -1 : i;
        repaint();
    }
    // the marked cells and the turn hint follow st.premove; while a move animates the
    // render right after it paints them (never render into a running animation)
    function repaint() {
        if (!Game.state.busy) Game.render();
    }
    function clearPremove() {
        if (st.premove < 0) return;
        st.premove = -1;
        repaint();
    }
    // my turn: play the premoved cell exactly like a click, or drop it when it went illegal
    function firePremove(p) {
        if (st.premove < 0) return;
        const i = st.premove;
        st.premove = -1;
        if (!premovable() || !isLocal(p)) { repaint(); return; }
        whenIdle(() => {
            const s = Game.state;
            if (!running || s.over || s.busy || s.current !== p || !hooks.mayPlay(p) || !Game.isLegal(i, p)) { repaint(); return; }
            h.onLocalMove(i);
            Game.play(i);
        }, "premove");
    }
    /* ---------- the analysis marker (#43) ----------
       The replay analysis asks for one cell to be marked as "the bot would have played
       here". Display only, exactly like the premove: it goes through the same cellClass
       hook, so no game and no engine knows about it. */
    function mark(i) {
        const to = Number.isInteger(i) && i >= 0 ? i : -1;
        if (to === st.marked) return;
        st.marked = to;
        repaint();
    }

    // the dashed marker takes the colour of the seat this device plays
    function paintPremoveColor() {
        const el = Util.$("board");
        if (el) el.style.setProperty("--premove", playerColor(mySeat()));
    }

    /* ---------- clock ---------- */
    // a clock ran out: online only the owner of that clock decides (clocks drift)
    function onFlag(p) {
        if (Game.state.over) return;
        if (online() && p !== st.me && !isBot(p)) return;   // the bot's clock belongs to whoever runs it (#36)
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
            const t0 = performance.now();
            try { i = await bot.move(bot.tools.clone(Game.state)); }
            catch (e) { console.error(`bot ${bot.def.id} failed`, e); Log.add(`${Opponent.NAME} crashed, picking a random move.`, "x"); }
            if (!stillOn()) return;
            if (!Game.isLegal(i, p)) i = bot.tools.pick(bot.tools.legalMoves(Game.state, p));
            st.botInfo = { id: bot.def.id, difficulty: bot.difficulty, budget: bot.tools.budget.nodes, move: i, ms: performance.now() - t0, nodes: bot.tools.lastDeadline ? bot.tools.lastDeadline.nodes() : null, ...(bot.tools.last || {}) };
            if (i === undefined) return;
            h.onLocalMove(i);                    // in a room the bot's move is mine to relay (#36)
            Game.play(i);
        }, THINK_MS);
    }
    // build the bot instance for the seat this device plays the bot on (offline: the
    // opponent I picked; online: the bot the room's config names)
    function setupBot(cfg, players) {
        BotPersona.detach();
        st.bot = null;
        const seat = st.seats.findIndex((s) => s.kind === "bot");
        if (seat < 0) return;
        // the room's bot is named by the config (#36), mine by the opponent I picked. A rule
        // variant can change which bot can play at all (#35's Yavalath), so a room bot that
        // does not know the rules steps aside for one that does, exactly like offline.
        let choice = online() ? cfg.bot : Opponent.current(cfg.game, cfg);
        if (online() && choice && !(Bots.get(choice.id) && Bots.supports(choice.id, cfg))) choice = Opponent.current(cfg.game, cfg);
        if (!choice || !Bots.get(choice.id)) { if (!online()) st.seats[seat].kind = "local"; return; }   // no bot for this game: play both sides
        // seed: fresh per game so the bot varies; tests pin it via sessionStorage["chainreact.botseed"]
        const seed = ((Number(Util.load(sessionStorage, "chainreact.botseed")) || Date.now()) + st.gameNo) >>> 0;
        st.bot = Bots.create(choice.id, { me: seat, difficulty: choice.difficulty, seed, players });
        st.botInfo = { id: st.bot.def.id, difficulty: st.bot.difficulty, budget: st.bot.tools.budget.nodes };
        const est = Bots.estimator(cfg.game, cfg);
        BotPersona.attach({
            bot: st.bot, seat, game: cfg.game, state: () => Game.state, estimate: (s) => est.at(s, 300), color: playerColor(seat),
            post: (e) => { Reactions.receive(e, playerColor(seat)); h.onBotReact(seat, e); },   // the room sees them too (#36)
        });
    }
    // seats changed under a running game (the transport host swapped, #36): rebuild them and
    // let the bot move if it is its turn now
    function refreshSeats() {
        if (!running || !st.config) return;
        const players = st.config.players || 2;
        st.seats = makeSeats(players);
        setupBot(st.config, players);
        const s = Game.state;
        if (!s.over && !s.busy && isBot(s.current)) botTurn(s.current);
    }

    /* ---------- lifecycle ---------- */
    // a new game at this table: game number, config; seat 0 starts game 1, then the next seat
    function start(cfg, gameNo) {
        const players = cfg.players || 2;
        st.config = cfg;
        st.gameNo = gameNo;
        st.seats = makeSeats(players);
        st.premove = -1;
        st.marked = -1;
        deferred = [];
        running = true;
        Game = Games.get(cfg.game).engine;
        setupBot(cfg, players);
        Clock.setup(cfg.timer, onFlag, players);
        paintPremoveColor();
        Game.newGame({ ...cfg, startPlayer: startPlayerFor(gameNo, players) }, hooks);
    }
    /* Watch a recorded game (#42): the same engine and the same board, but nobody sits at
       this table. Every seat is a "watch" seat, so no click, no premove, no clock and no
       bot; the record is replayed instantly and app.js drives the replay bar from there. */
    function watch(record) {
        stop();
        st.mode = "replay";
        st.me = -1;
        st.spectator = false;
        st.config = { ...record.config };
        st.gameNo = record.gameNo || 0;
        st.bot = null;
        st.botInfo = null;
        st.premove = -1;
        st.marked = -1;
        deferred = [];
        running = false;
        const players = st.config.players || 2;
        Game = Games.get(record.game).engine;
        st.seats = makeSeats(players);
        Clock.setup(0, () => {}, players);
        Game.newGame({ ...st.config }, hooks);
        Game.replay((record.history || []).slice(), (record.outs || []).slice());
    }

    // stop the running game without a result (back to the room)
    function stop() {
        running = false;
        st.premove = -1;
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
        st.botInfo = null;
        st.seats = [];
        st.premove = -1;
        st.marked = -1;
        deferred = [];
        setSeat(me, spectator);
    }
    // take a seat (room creation, session restore, assigned by the host)
    function setSeat(me, spectator = false) {
        st.me = spectator ? -1 : me;
        st.spectator = spectator;
        st.premove = -1;
        if (st.config) st.seats = makeSeats(st.config.players || 2);
        paintPremoveColor();
    }

    // the running game as data (session, sync, a future replay list) + the room's numbering
    const record = () => ({ ...Game.record(), gameNo: st.gameNo, clocks: Clock.snapshot() });

    function init(handlers) { h = { ...h, ...handlers }; }

    return {
        init, start, watch, stop, reset, setSeat, refreshSeats, record, flagged, whenIdle, syncClock, startPlayerFor, playerColor, mark,
        get engine() { return Game; }, get state() { return Game.state; }, get names() { return names(); }, get running() { return running; },
        get mode() { return st.mode; }, get me() { return st.me; }, get spectator() { return st.spectator; },
        get seats() { return st.seats; }, get config() { return st.config; }, get gameNo() { return st.gameNo; }, get bot() { return st.bot; },
        get botInfo() { return st.botInfo; }, get premove() { return st.premove; }, get marked() { return st.marked; },
        set gameNo(n) { st.gameNo = n; },
        isLocal, isBot, THINK_MS,
    };
})();
