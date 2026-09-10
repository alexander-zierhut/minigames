/* Isolation rules (pure, no DOM). The classic pen-and-paper game (Isola): every player
   owns one pawn on an n×n field of tiles. A turn is two steps that count as one move:
   step onto one of the up to 8 neighbouring tiles that still exists and is free, then
   remove any remaining tile nobody stands on (the tile you just left included). Whoever
   cannot step when their turn comes is trapped and out; with two players that ends the
   game, with three or four the rest play on and the last one standing wins.

   A move is one integer so history, sync, session, record and replay stay unchanged:
       move = to * (n * n) + removed
   `cells[i]` holds everything about a tile: -2 = removed (a hole), -1 = a free tile,
   >= 0 = the tile the pawn of that seat stands on. */

"use strict";

const IsolationRules = (() => {
    const HOLE = -2, FREE = -1;
    const STEPS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

    // where a seat starts: 0 top edge, 1 bottom edge, 2 left edge, 3 right edge (middle of each)
    function startCell(n, p) {
        const m = Math.floor(n / 2);
        return [m, (n - 1) * n + m, m * n, m * n + n - 1][p];
    }

    function create(config, base) {
        const n = config.n;
        const cells = new Array(n * n).fill(FREE);
        const pawns = [];
        for (let p = 0; p < base.players; p++) {
            const at = startCell(n, p);
            pawns.push(at);
            cells[at] = p;
        }
        return Object.assign(base, {
            cells,
            pawns,                                          // cell index of every pawn (derivable from cells)
            trapped: new Array(base.players).fill(false),    // out by the rules: could not step when their turn came
            lastFrom: -1,                                    // where the pawn of the last move came from (the view's slide)
            lastRemoved: -1,                                 // the tile the last move removed
        });
    }

    const ownerOf = (state, i) => (state.cells[i] >= 0 ? state.cells[i] : -1);
    const alive = (state) => state.trapped.map((t) => !t);
    const active = (state, p) => !state.trapped[p] && !(state.out && state.out[p]);

    // the tiles a pawn may step onto: existing, nobody on them, one of the 8 neighbours
    function steps(state, p) {
        const n = state.n, from = state.pawns[p], out = [];
        if (from === undefined || from < 0) return out;
        const x0 = from % n, y0 = (from - x0) / n;
        for (const [dx, dy] of STEPS) {
            const x = x0 + dx, y = y0 + dy;
            if (!Rules.inside(n, x, y)) continue;
            const i = Rules.index(n, x, y);
            if (state.cells[i] === FREE) out.push(i);
        }
        return out;
    }
    // how many ways a pawn can still move (the HUD bar, the bots' mobility term)
    const mobility = (state, p) => steps(state, p).length;

    const encode = (state, to, removed) => to * state.cells.length + removed;
    const decode = (state, move) => {
        const c = state.cells.length;
        return { to: Math.floor(move / c), removed: move % c };
    };

    function isLegal(state, move, player) {
        if (state.over || !active(state, player)) return false;
        const c = state.cells.length;
        if (!Number.isInteger(move) || move < 0 || move >= c * c) return false;
        const to = Math.floor(move / c), removed = move % c;
        const from = state.pawns[player];
        if (state.cells[to] !== FREE) return false;
        const n = state.n, x = to % n, y = (to - x) / n, fx = from % n, fy = (from - fx) / n;
        if (Math.max(Math.abs(x - fx), Math.abs(y - fy)) !== 1) return false;
        if (removed === to) return false;
        return state.cells[removed] === FREE || removed === from;      // the tile you just left may go too
    }

    // every legal move: destination × removable tile (the board after the step)
    function legalMoves(state, player = state.current) {
        const out = [];
        if (state.over || !active(state, player)) return out;
        const from = state.pawns[player];
        const free = [];
        for (let i = 0; i < state.cells.length; i++) if (state.cells[i] === FREE) free.push(i);
        for (const to of steps(state, player)) {
            for (const r of free) if (r !== to) out.push(encode(state, to, r));
            out.push(encode(state, to, from));                          // the tile the pawn just left
        }
        return out;
    }

    function place(state, move, player) {
        const { to, removed } = decode(state, move);
        const from = state.pawns[player];
        state.cells[from] = FREE;
        state.cells[to] = player;
        state.pawns[player] = to;
        state.cells[removed] = HOLE;
        state.lastFrom = from;
        state.lastRemoved = removed;
        state.history.push(move);
        state.movesBy[player]++;
    }

    function settle() { /* nothing follows a move */ }

    /* Pass the turn, and let it decide who is still in: a player who cannot step when the
       turn reaches them is trapped and out (never earlier — being locked in on somebody
       else's turn means nothing). Eliminations live in the rules (state.trapped), so
       replay and the online clients reach them by themselves. */
    function conclude(state) {
        for (let guard = 0; guard <= state.players; guard++) {
            const left = Rules.remaining(state, alive(state));
            if (left.length <= 1) {
                return { winner: left.length ? left[0] : -1, why: state.players > 2 ? "Everyone else is trapped." : "Trapped!" };
            }
            Rules.pass(state, alive(state));
            if (mobility(state, state.current) > 0) return null;
            state.trapped[state.current] = true;
        }
        return { winner: -1, why: "Nobody can move." };                 // unreachable, a safety net
    }

    /* Fallback win estimate (probability that player 0 wins) until a bot offers evaluate():
       Voronoi territory (tiles a pawn reaches first, king moves) plus mobility. */
    function territory(state) {
        const n = state.n, size = state.cells.length, players = state.players;
        const dist = state.pawns.map(() => new Array(size).fill(-1));
        for (let p = 0; p < players; p++) {
            if (!active(state, p)) continue;
            const d = dist[p], queue = [state.pawns[p]];
            d[state.pawns[p]] = 0;
            for (let head = 0; head < queue.length; head++) {
                const at = queue[head], x0 = at % n, y0 = (at - x0) / n;
                for (const [dx, dy] of STEPS) {
                    const x = x0 + dx, y = y0 + dy;
                    if (!Rules.inside(n, x, y)) continue;
                    const i = Rules.index(n, x, y);
                    if (state.cells[i] !== FREE || d[i] >= 0) continue;
                    d[i] = d[at] + 1;
                    queue.push(i);
                }
            }
        }
        const owned = new Array(players).fill(0);
        for (let i = 0; i < size; i++) {
            if (state.cells[i] !== FREE) continue;
            let best = Infinity, who = -1;
            for (let p = 0; p < players; p++) {
                const d = dist[p][i];
                if (d < 0) continue;
                if (d < best) { best = d; who = p; } else if (d === best) who = -1;
            }
            if (who >= 0) owned[who]++;
        }
        return owned;
    }

    function estimate(state) {
        if (state.over) return state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;
        const t = territory(state);
        const m0 = mobility(state, 0), m1 = mobility(state, 1);
        if (active(state, 0) && m0 === 0 && state.current === 0) return 0;
        if (active(state, 1) && m1 === 0 && state.current === 1) return 1;
        const total = (t[0] + t[1]) || 1;
        const edge = (t[0] - t[1]) / total + (m0 - m1) * 0.05 + (state.current === 0 ? 0.06 : -0.06);
        return 1 / (1 + Math.exp(-2.4 * edge));
    }

    /* Framework hooks for games whose move is not a plain cell (see AGENTS.md):
       cellOf  — the board cell a move belongs to (the last-move marker, a premove marker)
       canPlay — may this player start a move on cell i (the `can-place` highlight) */
    const cellOf = (state, move) => Math.floor(move / state.cells.length);
    const canPlay = (state, i, player) => !state.over && active(state, player)
        && state.cells[i] === FREE && steps(state, player).includes(i);

    return {
        create, ownerOf, isLegal, legalMoves, place, settle, conclude, estimate,
        cellOf, canPlay, steps, mobility, territory, alive, active, startCell, encode, decode, HOLE, FREE,
    };
})();
Rules.register("isolation", IsolationRules);
