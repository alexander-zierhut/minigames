/* Käsekästchen rules (pure, no DOM) — the German school game, also known as dots and
   boxes. n × n boxes, so (n+1) × (n+1) dots and 2n(n+1) edges between them. A move draws
   one undrawn edge; every box whose fourth edge it draws goes to the mover, and closing
   at least one box gives the mover another turn. The game runs until every edge is drawn:
   most boxes wins, a tie for the most is a draw.

   Edge numbering (binding for history, sync, replay and the puzzle sets): the n(n+1)
   horizontal edges first, row-major — h(r, c) = r * n + c with r = 0…n (the dot rows) and
   c = 0…n-1 — then the n(n+1) vertical ones — v(r, c) = n(n+1) + r * (n+1) + c with
   r = 0…n-1 and c = 0…n (the dot columns). Box (r, c) = r * n + c is closed by h(r, c),
   h(r+1, c), v(r, c) and v(r, c+1). Note `state.n` is the number of boxes per side, so
   `state.cells.length` is 2n(n+1) and not n². */

"use strict";

const BoxesRules = (() => {
    const hCount = (n) => n * (n + 1);                       // horizontal edges (= vertical ones)
    const edgeCount = (n) => 2 * n * (n + 1);
    const hEdge = (n, r, c) => r * n + c;
    const vEdge = (n, r, c) => hCount(n) + r * (n + 1) + c;
    // the four edges of box b
    function edgesOf(n, b) {
        const r = (b / n) | 0, c = b % n;
        return [hEdge(n, r, c), hEdge(n, r + 1, c), vEdge(n, r, c), vEdge(n, r, c + 1)];
    }
    // the one (border) or two boxes an edge touches
    function boxesOf(n, i) {
        const H = hCount(n), out = [];
        if (i < H) {
            const r = (i / n) | 0, c = i % n;
            if (r > 0) out.push((r - 1) * n + c);
            if (r < n) out.push(r * n + c);
        } else {
            const j = i - H, r = (j / (n + 1)) | 0, c = j % (n + 1);
            if (c > 0) out.push(r * n + c - 1);
            if (c < n) out.push(r * n + c);
        }
        return out;
    }

    function create(config, base) {
        const n = config.n;
        return Object.assign(base, {
            cells: new Array(edgeCount(n)).fill(-1),         // owner per edge, -1 = not drawn yet
            boxes: new Array(n * n).fill(-1),                // owner per box, -1 = still open
            scores: new Array(base.players).fill(0),
            lastBoxes: [],                                   // boxes the last move closed (the view pops them)
            again: false,                                    // the mover closed a box and keeps the turn
        });
    }

    const ownerOf = (state, i) => state.cells[i];
    const isLegal = (state, i, player) => !state.over && i >= 0 && i < state.cells.length && state.cells[i] === -1;
    function legalMoves(state) {
        const out = [];
        for (let i = 0; i < state.cells.length; i++) if (state.cells[i] === -1) out.push(i);
        return out;
    }

    /* ---------- board analysis (bots and the win-chance heuristic build on these) ---------- */
    // drawn edges of box b (0…4)
    function sides(state, b) {
        let k = 0;
        for (const e of edgesOf(state.n, b)) if (state.cells[e] !== -1) k++;
        return k;
    }
    // how many boxes drawing edge i would close right now (0, 1 or 2)
    function captures(state, i) {
        if (state.cells[i] !== -1) return 0;
        let k = 0;
        for (const b of boxesOf(state.n, i)) if (state.boxes[b] === -1 && sides(state, b) === 3) k++;
        return k;
    }
    const capturingMoves = (state) => legalMoves(state).filter((i) => captures(state, i) > 0);
    // edges that hand nothing over: no box next to them ends up with three drawn sides
    function safeMoves(state) {
        const out = [];
        for (const i of legalMoves(state)) {
            let safe = true;
            for (const b of boxesOf(state.n, i)) if (state.boxes[b] === -1 && sides(state, b) === 2) safe = false;
            if (safe) out.push(i);
        }
        return out;
    }
    /* A capture that costs nothing: the edge closes a box and leaves no half-open box behind
       (its other side is already owned, is closed by the same move, or does not exist).
       Taking such a box is never wrong, which is what lets a search skip every alternative. */
    function isFreeCapture(state, i) {
        const c = captures(state, i);
        if (c === 0) return false;
        if (c === 2) return true;                                // both boxes closed: nothing left over
        for (const b of boxesOf(state.n, i)) {
            if (state.boxes[b] !== -1) continue;
            if (sides(state, b) === 3) continue;                 // the box this move closes
            if (sides(state, b) === 2) return false;             // the other side becomes half open
        }
        return true;
    }
    /* The run of boxes hanging off a capturable box: follow the undrawn edges through boxes
       that have exactly two drawn sides. Returns { boxes, loop } — what the mover would eat
       by taking everything, and whether the run closes on itself (a loop costs four boxes
       to decline instead of two). */
    function chainFrom(state, start) {
        const n = state.n, seen = new Set([start]);
        const boxes = [start];
        let loop = false;
        const step = (b) => {
            let next = -1;
            for (const e of edgesOf(n, b)) {
                if (state.cells[e] !== -1) continue;
                for (const o of boxesOf(n, e)) {
                    if (o === b || state.boxes[o] !== -1) continue;
                    if (seen.has(o)) { if (o === start && boxes.length > 2) loop = true; continue; }
                    if (sides(state, o) === 2) next = o;
                }
            }
            return next;
        };
        for (let b = start, guard = 0; guard <= n * n; guard++) {
            const next = step(b);
            if (next < 0) break;
            seen.add(next); boxes.push(next); b = next;
        }
        return { boxes, loop };
    }

    /* ---------- the move ---------- */
    function place(state, i, player) {
        state.cells[i] = player;
        state.history.push(i);
        state.movesBy[player]++;
    }
    // everything a placement drags with it: the boxes it closed, and whether the mover goes again
    function settle(state, player) {
        const i = state.history[state.history.length - 1];
        const closed = [];
        for (const b of boxesOf(state.n, i)) {
            if (state.boxes[b] === -1 && sides(state, b) === 4) { state.boxes[b] = player; state.scores[player]++; closed.push(b); }
        }
        state.lastBoxes = closed;
        state.again = closed.length > 0;
    }
    function conclude(state, player) {
        if (state.history.length === state.cells.length) {           // every edge drawn: count the boxes
            const left = Rules.remaining(state);
            const best = left.reduce((m, p) => Math.max(m, state.scores[p]), -1);
            const top = left.filter((p) => state.scores[p] === best);
            if (top.length === 1) return { winner: top[0], why: `${best} ${best === 1 ? "box" : "boxes"}!` };
            return { winner: -1, why: "Tied!" };
        }
        if (state.again) return null;                                // closing a box gives another turn
        Rules.pass(state);
        return null;
    }

    /* Fallback win estimate (probability that player 0 wins) until a bot offers evaluate():
       the boxes already won, plus who is under pressure — a player to move without a safe
       edge has to open something and usually pays for it. */
    function estimate(state) {
        if (state.over) return state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;
        const total = state.n * state.n;
        const left = total - state.scores.reduce((a, b) => a + b, 0);
        const diff = state.scores[0] - (state.scores[1] || 0);
        if (left === 0) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
        const turn = state.current === 0 ? 1 : -1;
        const free = capturingMoves(state).length ? Infinity : safeMoves(state).length;
        const pressure = free === 0 ? -turn * Math.min(left, 4) * 0.6 : turn * 0.2;
        const edge = (diff + pressure) / Math.max(1.5, Math.sqrt(total));
        return 1 / (1 + Math.exp(-2.2 * edge));
    }

    return {
        create, ownerOf, isLegal, legalMoves, place, settle, conclude, estimate,
        hCount, edgeCount, hEdge, vEdge, edgesOf, boxesOf,
        sides, captures, capturingMoves, safeMoves, isFreeCapture, chainFrom,
    };
})();
Rules.register("boxes", BoxesRules);
