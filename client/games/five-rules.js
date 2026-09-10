/* Five Wins rules (pure, no DOM). Gomoku without gravity: place a stone on any empty
   cell; `winLen` or more in a row (4 directions) wins; a full board is a draw, and so is
   a board where no line can be completed any more (#18: no window of winLen cells is
   free of enemy stones for any player still in the game).
   Yavalath rule (`config.yavalath`, owner's request): a line of exactly winLen - 1 loses
   for the one who made it (unless the same stone also made winLen). With two players
   the other one wins; with three or four the loser is out (`state.dead`) and the rest
   play on, the last one standing wins. */

"use strict";

const FiveRules = (() => {
    const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    function create(config, base) {
        const n = config.n;
        return Object.assign(base, {
            cells: new Array(n * n).fill(-1),         // owner per cell, -1 = empty
            winLen: Util.clamp(config.winLen || 5, 3, n),
            winLine: [],                               // cells of the winning line
            yavalath: !!config.yavalath,               // one less than winLen in a row loses
            dead: new Array(base.players).fill(false), // Yavalath: players who made the losing line (3+ players)
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

    // can `player` still complete a line: is there a window of winLen cells (any of the 4
    // directions) holding only that player's stones or empties? O(cells × 4 × winLen).
    function canWin(state, player) {
        const n = state.n, w = state.winLen, cells = state.cells;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (const [dx, dy] of DIRS) {
            const ex = x + dx * (w - 1), ey = y + dy * (w - 1);
            if (ex < 0 || ey < 0 || ex >= n || ey >= n) continue;
            let open = true;
            for (let s = 0; s < w && open; s++) {
                const o = cells[(y + dy * s) * n + x + dx * s];
                if (o !== -1 && o !== player) open = false;
            }
            if (open) return true;
        }
        return false;
    }

    function place(state, i, player) {
        state.cells[i] = player;
        state.history.push(i);
        state.movesBy[player]++;
    }
    function settle() { /* nothing follows a placement */ }

    const alive = (state) => state.dead.map((d) => !d);
    function conclude(state, player) {
        const line = lineThrough(state, state.history[state.history.length - 1]);
        if (line.len >= state.winLen) {
            state.winLine = line.cells;
            return { winner: player, why: `${state.winLen} in a row!` };
        }
        if (state.yavalath && line.len === state.winLen - 1) {      // the losing line: out (3+ players) or lost (2)
            state.dead[player] = true;
            state.winLine = line.cells;
            const rest = Rules.remaining(state, alive(state));
            if (rest.length <= 1) return { winner: rest.length ? rest[0] : -1, why: `${state.winLen - 1} in a row loses!` };
        }
        if (state.history.length === state.cells.length) return { winner: -1, why: "The board is full." };
        const left = Rules.remaining(state, alive(state));
        if (left.length === 1 && state.players > 1) return { winner: left[0], why: "Everyone else is out." };
        // dead board (#18): nobody still in the game has a window left → draw, however many cells are empty
        if (!left.some((p) => canWin(state, p))) return { winner: -1, why: "No line can be completed any more." };
        Rules.pass(state, alive(state));
        return null;
    }

    // fallback win estimate (probability that player 0 wins) when no bot offers a better one:
    // longest rows relative to winLen, squared so a four counts far more than two twos
    function estimate(state) {
        if (state.over) return state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;
        const r0 = bestRow(state, 0) / state.winLen, r1 = bestRow(state, 1) / state.winLen;
        const edge = r0 * r0 - r1 * r1 + (state.current === 0 ? 0.03 : -0.03);
        return 1 / (1 + Math.exp(-4 * edge));
    }

    return { create, ownerOf, isLegal, legalMoves, place, settle, conclude, lineThrough, bestRow, canWin, estimate, alive };
})();
Rules.register("five", FiveRules);
