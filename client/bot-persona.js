/* Bot persona: a bot seat reacts with emojis now and then so it feels like a player (#14).
   Listens to the Bus (game:new / game:move / game:finish) for the bot's game and posts a
   reaction through Reactions.receive in the bot's colour. Sparse on purpose: a wave at the
   start, "GG" at the end, "EZ" once when its win chance jumps, a thumbs-up (or applause)
   for a strong human move (the bot's chance drops a lot), a surprised / teasing face for
   a move the bot considers among the worst options, 😔 once when it thinks it is losing —
   never more than one reaction every COOLDOWN_MS and MAX_PER_GAME per game. Every moment
   draws from a small weighted POOL so the bot is not the same every game (a bit of
   trolling, a bit of teaching, mostly nice). Seeded (Bots.rng from the bot's seed), so a
   pinned seed gives the same behaviour in tests; delays are configurable for tests. */

"use strict";

const BotPersona = (() => {
    const COOLDOWN_MS = 6000, MAX_PER_GAME = 8;
    const DELAY = { min: 500, max: 1400 };
    // what the bot may say at each moment: [emoji, weight] — picked with the seeded rng
    const POOLS = {
        hello: [["👋", 1]],
        strong: [["👍", 45], ["👏", 25], ["🔥", 15], ["🫡", 15]],       // the human found one of the best moves
        blunder: [["😲", 40], ["🤡", 20], ["💀", 20], ["😂", 20]],      // the human played one of the worst
        ez: [["EZ", 60], ["😎", 40]],                                    // the bot thinks it has this
        sad: [["😔", 60], ["😱", 40]],                                   // the bot thinks it is losing
        gg: [["GG", 1]],
        won: [["😄", 50], ["😎", 30], ["🥰", 20]],
        lost: [["😔", 50], ["👏", 30], ["🫡", 20]],                     // gracious: well played
    };
    let session = null;          // the active bot game, or null
    let unsubscribe = [];

    // params: { bot (Bots.create result), seat, game, state: () => state, estimate: p0 -> chance,
    //           color, post? (how a reaction is shown; default Reactions.receive), delays? }
    function attach(params) {
        detach();
        const random = Bots.rng((params.bot.tools.seed ^ 0xc0ffee) >>> 0);
        session = {
            ...params,
            delays: params.delays || DELAY,
            cooldownMs: params.cooldownMs === undefined ? COOLDOWN_MS : params.cooldownMs,
            random,
            sent: 0, lastAt: -Infinity, done: new Set(),
            counts: { alert: 0, surprise: 0 },
            before: null,                      // position before the human's move (a clone)
            pending: null,                     // the human's last move, judged once the turn passes
            timers: [],
        };
        unsubscribe = [
            Bus.on("game:new", onNew),
            Bus.on("game:move", onMove),
            Bus.on("game:turn", onTurn),
            Bus.on("game:finish", onFinish),
        ];
        return session;
    }
    function detach() {
        for (const off of unsubscribe) off();
        unsubscribe = [];
        if (session) for (const t of session.timers) clearTimeout(t);
        session = null;
    }

    // the bot's own win chance from the estimator (which reports player 0's)
    const chanceFor = (s, state) => { const p0 = s.estimate(state); return s.seat === 0 ? p0 : 1 - p0; };

    // one emoji from a weighted pool (seeded, so a pinned seed picks the same)
    function pick(s, pool) {
        const total = pool.reduce((sum, [, w]) => sum + w, 0);
        let r = s.random() * total;
        for (const [emoji, w] of pool) { r -= w; if (r < 0) return emoji; }
        return pool[pool.length - 1][0];
    }

    // maybe say something from a pool: once per key when `once`, respecting cooldown, cap and probability
    function say(pool, probability, { key, once = true } = {}) {
        const s = session;
        if (!s || s.sent >= MAX_PER_GAME) return false;
        if (once && key && s.done.has(key)) return false;
        if (Date.now() - s.lastAt < s.cooldownMs) return false;
        if (s.random() > probability) { if (key) s.done.add(key); return false; }
        if (key) s.done.add(key);
        s.sent++;
        s.lastAt = Date.now();
        const emoji = pick(s, pool);
        const delay = s.delays.min + Math.floor(s.random() * (s.delays.max - s.delays.min + 1));
        const post = s.post || ((e) => Reactions.receive(e, s.color));   // a room relays them too (#36)
        const t = setTimeout(() => { if (session === s) post(emoji); }, delay);
        s.timers.push(t);
        return true;
    }

    function onNew(ev) {
        const s = session;
        if (!s || ev.game !== s.game) return;
        s.done.clear(); s.sent = 0; s.lastAt = -Infinity; s.counts = { alert: 0, surprise: 0 };
        s.before = null; s.pending = null;
        say(POOLS.hello, 1, { key: "hello" });
    }

    // remember the position the human is about to move in, so the move can be judged once
    // it has settled (chain explosions resolve after game:move, so judge at game:turn)
    function onTurn(ev) {
        const s = session;
        if (!s || ev.game !== s.game) return;
        const state = s.state();
        if (ev.player === s.seat && s.pending !== null && s.pending !== undefined) judge(s, s.pending, state);
        s.pending = null;
        s.before = ev.player !== s.seat && !state.over ? s.bot.tools.clone(state) : null;
    }
    function onMove(ev) {
        const s = session;
        if (!s || ev.game !== s.game || ev.player === s.seat) return;
        s.pending = ev.cell;
    }

    // the human's move has settled: how good was it compared with the alternatives?
    function judge(s, cell, after) {
        const before = s.before;
        s.before = null;
        const mine = chanceFor(s, after);
        if (before && !before.over) {
            const prev = chanceFor(s, before);
            const drop = prev - mine;
            const legal = s.bot.tools.legalMoves(before, before.current);
            if (legal.length >= 6) {
                let worse = 0, better = 0;
                for (const m of legal) {
                    if (m === cell) continue;
                    const c = chanceFor(s, s.bot.tools.apply(before, m));   // the bot's chance after that alternative
                    if (c > mine + 0.02) worse++; else if (c < mine - 0.02) better++;
                }
                const alternatives = legal.length - 1;
                if (drop >= 0.15 && better <= Math.ceil(alternatives * 0.1) && s.counts.alert < 2) { if (say(POOLS.strong, 0.7, { key: `alert${s.counts.alert}` })) s.counts.alert++; }
                else if (worse === 0 && better >= Math.floor(alternatives * 0.75) && mine - prev >= 0.1 && s.counts.surprise < 2) { if (say(POOLS.blunder, 0.6, { key: `surprise${s.counts.surprise}` })) s.counts.surprise++; }
            }
        }
        if (!after.over && mine >= 0.9) say(POOLS.ez, 0.7, { key: "ez" });
        else if (!after.over && mine <= 0.12) say(POOLS.sad, 0.7, { key: "sad" });
    }

    function onFinish(ev) {
        const s = session;
        if (!s || ev.game !== s.game) return;
        const won = ev.winner === s.seat;
        say(POOLS.gg, 0.9, { key: "gg" });
        if (won) say(POOLS.won, 0.5, { key: "happy" });
        else if (ev.winner >= 0) say(POOLS.lost, 0.4, { key: "lost" });
    }

    return { attach, detach, get active() { return session; }, COOLDOWN_MS, MAX_PER_GAME, POOLS };
})();
