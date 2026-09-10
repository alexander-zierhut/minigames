/* Helpers every rules module builds on, and the pure game loop shared by everything that
   drives a game without the DOM (engine replay, bots, benchmark, puzzle runner, a future
   replay viewer). Rules modules are pure: they work on a plain state object, never touch
   the DOM and never read settings (everything arrives in `config`). That keeps animated
   play, instant replay and bots identical. */

"use strict";

const Rules = (() => {
    // the part of the game state that every game has; rules.create() adds the rest
    function base(config) {
        const players = config.players || 2;
        return {
            n: config.n,
            players,                                  // number of seats (2–4)
            current: config.startPlayer || 0,         // whose turn it is
            round: 1,                                 // increments when the rotation wraps
            history: [],                              // cell ids in play order
            movesBy: new Array(players).fill(0),
            out: new Array(players).fill(false),      // eliminated outside the rules (flag fall) — skipped, can't win
            outs: [],                                 // those eliminations in order: { p, at: history length then, why }
            busy: false,                              // a move is being animated
            over: false,
            winner: -1,                               // -1 = draw / none
            finishWhy: "",
        };
    }

    // pass the turn to the next player (skipping eliminated ones: `state.out`, and the
    // game's own `alive` list when given)
    function pass(state, alive) {
        for (let k = 1; k <= state.players; k++) {
            const p = (state.current + k) % state.players;
            if (state.out && state.out[p]) continue;
            if (alive && !alive[p]) continue;
            if (p <= state.current) state.round++;
            state.current = p;
            return;
        }
    }

    // players still in the game after outside eliminations (and the game's own `alive` list)
    function remaining(state, alive) {
        const out = [];
        for (let p = 0; p < state.players; p++) if (!(state.out && state.out[p]) && (!alive || alive[p])) out.push(p);
        return out;
    }

    const index = (n, x, y) => y * n + x;
    const inside = (n, x, y) => x >= 0 && y >= 0 && x < n && y < n;

    // rules modules register themselves by game key so bots and headless tools can find
    // them without the DOM-bound engine (games.js)
    const byGame = {};
    const register = (key, rules) => { byGame[key] = rules; return rules; };
    const of = (key) => byGame[key];
    const resolve = (rules) => (typeof rules === "string" ? byGame[rules] : rules);

    /* ---------- the game loop, instant and pure ---------- */
    const finish = (state, result) => { state.over = true; state.winner = result.winner; state.finishWhy = result.why; };

    // a fresh state for a config (game key from config.game unless `rules` is given)
    function create(config, rules = config.game) {
        const r = resolve(rules);
        if (!r) throw new Error(`no rules registered for game "${config.game}"`);
        return r.create(config, base(config));
    }

    // one complete move by the current player, resolved instantly: place, settle, conclude.
    // Returns the result ({ winner, why }) when the game ended, else null. Throws on an
    // illegal move — callers check isLegal when the move comes from outside.
    function step(rules, state, i) {
        const r = resolve(rules);
        const p = state.current;
        if (!r.isLegal(state, i, p)) throw new Error(`illegal move ${i} for player ${p}`);
        r.place(state, i, p);
        r.settle(state, p);
        const result = r.conclude(state, p);
        if (result) finish(state, result);
        return result;
    }

    // a player is out without a move of the rules (flag fall): skipped from now on, the
    // turn passes if it was theirs, the last one standing wins. False when nothing changed.
    function eliminate(state, p, why) {
        if (state.over || p < 0 || p >= state.players || state.out[p]) return false;
        state.out[p] = true;
        state.outs.push({ p, at: state.history.length, why });
        const left = remaining(state);
        if (left.length <= 1) finish(state, { winner: left.length ? left[0] : -1, why });
        else if (state.current === p) pass(state);
        return true;
    }

    // apply moves (and eliminations at the history length they happened) to a state:
    // stops at the end of the history, at an illegal move or once the game is over.
    // Returns the number of moves applied.
    function apply(rules, state, history, outs = []) {
        const r = resolve(rules);
        const pending = outs.filter((o) => o && !state.out[o.p]).sort((a, b) => a.at - b.at);
        const flush = () => { while (pending.length && pending[0].at <= state.history.length) { const o = pending.shift(); eliminate(state, o.p, o.why); } };
        flush();
        let applied = 0;
        for (const i of history) {
            if (state.over || !r.isLegal(state, i, state.current)) break;
            step(r, state, i);
            applied++;
            flush();
        }
        return applied;
    }

    /* The position of a game record after `ply` moves (default: all). A record is what a
       game is made of and what a replay viewer will read: { game, config, history, outs }
       (config carries n, players, startPlayer and the game's own keys). Pure — no DOM. */
    function replay(record, ply = record.history.length) {
        const key = record.game || record.config.game;
        const state = create(record.config, key);
        apply(key, state, record.history.slice(0, ply), record.outs || []);
        return state;
    }

    return { base, pass, remaining, index, inside, register, of, create, step, eliminate, apply, replay };
})();
