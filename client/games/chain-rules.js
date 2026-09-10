/* Chain React rules (pure, no DOM).
   A cell holds up to (neighbours - 1) pieces; reaching the neighbour count makes it
   explode: it loses that many pieces and hands one to every neighbour, converting
   them to the mover's colour. Explosions resolve wave by wave: every full cell of a
   wave explodes together, then all landings apply. A player who has moved and owns
   nothing is out; the last owner on the board wins. Optional: N explosions in one
   move win outright ("chain rule"). */

"use strict";

const ChainRules = (() => {
    function neighbours(n, i) {
        const x = i % n, y = Math.floor(i / n);
        const out = [];
        if (x > 0) out.push(i - 1);
        if (x < n - 1) out.push(i + 1);
        if (y > 0) out.push(i - n);
        if (y < n - 1) out.push(i + n);
        return out;
    }

    function create(config, base) {
        const n = config.n;
        return Object.assign(base, {
            cells: Array.from({ length: n * n }, (_, i) => ({ count: 0, owner: -1, cap: neighbours(n, i).length })),
            chainRule: !!config.chainRule,
            chainLen: config.chainLen || 15,
            chainNow: 0,        // explosions in the current move
            chainBest: 0,       // longest chain of the game
            explosions: 0,      // total
        });
    }

    const ownerOf = (state, i) => state.cells[i].owner;

    function isLegal(state, i, player) {
        if (state.over || i < 0 || i >= state.cells.length) return false;
        const owner = state.cells[i].owner;
        return owner === -1 || owner === player;
    }
    function legalMoves(state, player) {
        const out = [];
        for (let i = 0; i < state.cells.length; i++) if (isLegal(state, i, player)) out.push(i);
        return out;
    }

    // cells and pieces per player
    function tally(state) {
        const t = Array.from({ length: state.players }, () => ({ cells: 0, pieces: 0 }));
        for (const c of state.cells) if (c.owner >= 0) { t[c.owner].cells++; t[c.owner].pieces += c.count; }
        return t;
    }
    // still in the game: owns a cell, or hasn't had a first move yet (and not eliminated from outside)
    function alive(state) {
        const t = tally(state);
        return t.map((x, p) => !(state.out && state.out[p]) && (x.cells > 0 || state.movesBy[p] === 0));
    }
    // one owner left after everyone moved: the chain would loop forever, the game is decided
    function boardDecided(state) {
        if (state.movesBy.some((m, p) => m === 0 && !(state.out && state.out[p]))) return false;
        return alive(state).filter(Boolean).length <= 1;
    }

    function place(state, i, player) {
        const c = state.cells[i];
        c.owner = player;
        c.count++;
        state.movesBy[player]++;
        state.history.push(i);
        state.chainNow = 0;
    }

    function readyCells(state) {
        const ready = [];
        state.cells.forEach((c, i) => { if (c.count >= c.cap) ready.push(i); });
        return ready;
    }
    const chainStopped = (state) => boardDecided(state) || (state.chainRule && state.chainNow >= state.chainLen);

    // explode a wave: count it, empty the cells, return the flights they produce
    function detonate(state, ready) {
        state.chainNow += ready.length;
        state.explosions += ready.length;
        if (state.chainNow > state.chainBest) state.chainBest = state.chainNow;
        const flights = [];
        for (const i of ready) {
            const c = state.cells[i];
            c.count -= c.cap;
            if (c.count === 0) c.owner = -1;
            for (const to of neighbours(state.n, i)) flights.push({ from: i, to });
        }
        return flights;
    }
    function land(state, flights, player) {
        for (const f of flights) {
            const target = state.cells[f.to];
            target.owner = player;
            target.count++;
        }
    }

    // resolve every wave instantly (replay); the animated path in chain.js takes the same steps
    function settle(state, player) {
        for (;;) {
            const ready = readyCells(state);
            if (ready.length === 0 || chainStopped(state)) return;
            land(state, detonate(state, ready), player);
        }
    }

    // after the chain settled: winner, or pass the turn (returns null)
    function conclude(state, player) {
        if (state.chainRule && state.chainNow >= state.chainLen) {
            return { winner: player, why: `Chain reaction of ${state.chainNow} explosions!` };
        }
        const live = alive(state);
        if (live.filter(Boolean).length === 1 && state.movesBy.every((m, p) => m > 0 || (state.out && state.out[p]))) {
            return { winner: live.indexOf(true), why: "Took over the whole board!" };
        }
        Rules.pass(state, live);
        return null;
    }

    // fallback win estimate (probability that player 0 wins) when no bot offers a better one:
    // material share, pieces counting a bit more than cells; critical cells add a little
    function estimate(state) {
        if (state.over) return state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;
        const t = tally(state);
        const total = t.reduce((a, x) => a + x.pieces, 0);
        if (total === 0 || state.movesBy.some((m) => m === 0)) return 0.5;
        let crit = [0, 0];
        for (const c of state.cells) if (c.owner >= 0 && c.count >= c.cap - 1) crit[c.owner] += 1;
        const material = (t[0].pieces - t[1].pieces) / total + 0.5 * (t[0].cells - t[1].cells) / state.cells.length + 0.05 * (crit[0] - crit[1]);
        return 1 / (1 + Math.exp(-3 * material));
    }

    return { create, ownerOf, isLegal, legalMoves, place, settle, conclude, tally, readyCells, chainStopped, detonate, land, estimate };
})();
Rules.register("chain", ChainRules);
