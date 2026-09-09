/* Helpers every rules module builds on. Rules modules are pure: they work on a plain
   state object, never touch the DOM and never read settings (everything arrives in
   `config`). That keeps animated play, instant replay and future bots identical. */

"use strict";

const Rules = (() => {
    // the part of the game state that every game has; rules.create() adds the rest
    function base(config) {
        const players = config.players || 2;
        return {
            n: config.n,
            players,                                  // number of seats (2 today, up to 4)
            current: config.startPlayer || 0,         // whose turn it is
            round: 1,                                 // increments when the rotation wraps
            history: [],                              // cell ids in play order
            movesBy: new Array(players).fill(0),
            busy: false,                              // a move is being animated
            over: false,
            winner: -1,                               // -1 = draw / none
            finishWhy: "",
        };
    }

    // pass the turn to the next player (skipping eliminated ones when `alive` is given)
    function pass(state, alive) {
        for (let k = 1; k <= state.players; k++) {
            const p = (state.current + k) % state.players;
            if (alive && !alive[p]) continue;
            if (p <= state.current) state.round++;
            state.current = p;
            return;
        }
    }

    const index = (n, x, y) => y * n + x;
    const inside = (n, x, y) => x >= 0 && y >= 0 && x < n && y < n;

    // rules modules register themselves by game key so bots and headless tools can find
    // them without the DOM-bound engine (games.js)
    const byGame = {};
    const register = (key, rules) => { byGame[key] = rules; return rules; };
    const of = (key) => byGame[key];

    return { base, pass, index, inside, register, of };
})();
