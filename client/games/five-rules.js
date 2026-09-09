/* Five Wins rules (pure, no DOM). Gomoku without gravity: place a stone on any empty
   cell; `winLen` or more in a row (4 directions) wins; a full board is a draw. */

"use strict";

const FiveRules = (() => {
    const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    function create(config, base) {
        const n = config.n;
        return Object.assign(base, {
            cells: new Array(n * n).fill(-1),         // owner per cell, -1 = empty
            winLen: Util.clamp(config.winLen || 5, 3, n),
            winLine: [],                               // cells of the winning line
        });
    }

    const ownerOf = (state, i) => state.cells[i];
    const isLegal = (state, i, player) => !state.over && i >= 0 && i < state.cells.length && state.cells[i] === -1;
    function legalMoves(state) {
        const out = [];
        state.cells.forEach((o, i) => { if (o === -1) out.push(i); });
        return out;
    }

    // longest line through cell i for its owner, with its cells
    function lineThrough(state, i) {
        const owner = state.cells[i];
        if (owner < 0) return { len: 0, cells: [] };
        const n = state.n, x0 = i % n, y0 = Math.floor(i / n);
        let best = { len: 1, cells: [i] };
        for (const [dx, dy] of DIRS) {
            const cells = [i];
            for (const dir of [1, -1]) {
                let x = x0 + dx * dir, y = y0 + dy * dir;
                while (Rules.inside(n, x, y) && state.cells[Rules.index(n, x, y)] === owner) {
                    cells.push(Rules.index(n, x, y));
                    x += dx * dir; y += dy * dir;
                }
            }
            if (cells.length > best.len) best = { len: cells.length, cells };
        }
        return best;
    }

    // a player's longest row, capped at winLen (for the HUD bar)
    function bestRow(state, player) {
        let best = 0;
        for (let i = 0; i < state.cells.length; i++) {
            if (state.cells[i] === player) best = Math.max(best, lineThrough(state, i).len);
        }
        return Math.min(best, state.winLen);
    }

    function place(state, i, player) {
        state.cells[i] = player;
        state.history.push(i);
        state.movesBy[player]++;
    }
    function settle() { /* nothing follows a placement */ }

    function conclude(state, player) {
        const line = lineThrough(state, state.history[state.history.length - 1]);
        if (line.len >= state.winLen) {
            state.winLine = line.cells;
            return { winner: player, why: `${state.winLen} in a row!` };
        }
        if (state.history.length === state.cells.length) return { winner: -1, why: "The board is full." };
        Rules.pass(state);
        return null;
    }

    return { create, ownerOf, isLegal, legalMoves, place, settle, conclude, lineThrough, bestRow };
})();
Rules.register("five", FiveRules);
