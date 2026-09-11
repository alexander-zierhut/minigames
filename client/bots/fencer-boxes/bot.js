/* Fencer — Dots and Boxes (dots and boxes).

   Two engines in one bot:

   1. **Exact endgame** (two players, at most EXACT_MAX undrawn lines): alpha-beta negamax
      over the remaining game with a transposition table keyed by the bitmask of the lines
      drawn since the root. Because a capture keeps the mover on turn, the value of a
      position is "boxes for whoever moves next minus boxes for the other one" and depends
      on the remaining lines alone, which is what makes one table entry per mask correct.
      Free captures (a box whose line hands nothing over) are forced, never branched — that
      is the classic reduction and it collapses whole cascades into one node. The search is
      exact, so it finds the double-dealing sacrifices ("all but two") by itself and plays
      the endgame perfectly whenever the node budget lets it finish.

   2. **Chain play** for everything the search cannot reach yet: take every free box, decline
      the last two of a chain when keeping control is worth more than two boxes, play a safe
      line while one exists (the one that leaves the board least committed), and when every
      line is loony open the chain that concedes the fewest boxes.

   Deterministic everywhere: node budgets instead of wall clock, seeded tie-breaks, no
   Math.random. `evaluate` (the HUD's win chance) is ±Infinity once the result is proven (a
   solved endgame or a majority of the boxes) and otherwise the box lead measured against the
   boxes still open; it runs on a node cap of its own so every HUD stage agrees. */

"use strict";

(() => {
    const EXACT_MAX = 30;                 // undrawn lines the exact search will even try (the mask must fit an int32)
    const YIELD_EVERY = 2000;             // nodes between two tools.yield() calls on the long levels
    const EVAL_NODES = 30000;             // the win chance's own node cap: the same one at every HUD stage

    // a node budget of our own, independent of the caller's (see evaluate)
    function capped(nodes) {
        let used = 0;
        const expired = () => used >= nodes;
        return { expired, tick: (n = 1) => { used += n; return expired(); }, nodes: () => used };
    }

    /* ---------- per board size: which lines belong to which box and back ---------- */
    const TABLES = new Map();
    function tablesFor(n) {
        let t = TABLES.get(n);
        if (t) return t;
        const H = n * (n + 1), E = 2 * H, B = n * n;
        const boxEdges = new Int32Array(B * 4);
        const edgeBoxes = new Int32Array(E * 2).fill(-1);
        const fill = new Uint8Array(E);
        for (let b = 0; b < B; b++) {
            const r = (b / n) | 0, c = b % n;
            const es = [r * n + c, (r + 1) * n + c, H + r * (n + 1) + c, H + r * (n + 1) + c + 1];
            for (let k = 0; k < 4; k++) {
                const e = es[k];
                boxEdges[b * 4 + k] = e;
                edgeBoxes[e * 2 + fill[e]++] = b;
            }
        }
        t = { n, H, E, B, boxEdges, edgeBoxes };
        TABLES.set(n, t);
        return t;
    }

    /* ---------- the compact board the search works on ---------- */
    function Board(n) {
        const t = tablesFor(n);
        this.t = t; this.n = n; this.E = t.E; this.B = t.B;
        this.drawn = new Uint8Array(t.E);
        this.sides = new Uint8Array(t.B);
        this.left = t.E;                                   // undrawn lines
        this.open = t.B;                                   // boxes nobody closed yet
    }
    Board.prototype.load = function (state) {
        const t = this.t;
        this.left = t.E; this.open = t.B;
        for (let e = 0; e < t.E; e++) { const d = state.cells[e] === -1 ? 0 : 1; this.drawn[e] = d; if (d) this.left--; }
        for (let b = 0; b < t.B; b++) {
            let k = 0;
            for (let j = 0; j < 4; j++) if (this.drawn[t.boxEdges[b * 4 + j]]) k++;
            this.sides[b] = k;
            if (k === 4) this.open--;
        }
        return this;
    };
    // boxes drawing line e would close right now
    Board.prototype.capturesOf = function (e) {
        const eb = this.t.edgeBoxes;
        let g = 0;
        for (let k = 0; k < 2; k++) { const b = eb[e * 2 + k]; if (b >= 0 && this.sides[b] === 3) g++; }
        return g;
    };
    // a capture that hands nothing over: never wrong, so the search may force it
    Board.prototype.isFreeCapture = function (e) {
        const eb = this.t.edgeBoxes;
        let cap = 0, gift = 0;
        for (let k = 0; k < 2; k++) {
            const b = eb[e * 2 + k];
            if (b < 0) continue;
            if (this.sides[b] === 3) cap++; else if (this.sides[b] === 2) gift++;
        }
        return cap > 0 && gift === 0;
    };
    // a line that leaves no box with three sides behind
    Board.prototype.isSafe = function (e) {
        const eb = this.t.edgeBoxes;
        for (let k = 0; k < 2; k++) { const b = eb[e * 2 + k]; if (b >= 0 && this.sides[b] === 2) return false; }
        return true;
    };
    Board.prototype.make = function (e) {
        const eb = this.t.edgeBoxes;
        this.drawn[e] = 1; this.left--;
        let g = 0;
        for (let k = 0; k < 2; k++) { const b = eb[e * 2 + k]; if (b >= 0 && ++this.sides[b] === 4) { g++; this.open--; } }
        return g;
    };
    Board.prototype.unmake = function (e) {
        const eb = this.t.edgeBoxes;
        this.drawn[e] = 0; this.left++;
        for (let k = 0; k < 2; k++) { const b = eb[e * 2 + k]; if (b < 0) continue; if (this.sides[b] === 4) this.open++; this.sides[b]--; }
    };
    Board.prototype.freeEdges = function () {
        const out = [];
        for (let e = 0; e < this.E; e++) if (!this.drawn[e]) out.push(e);
        return out;
    };

    /* ---------- exact endgame search ---------- */
    // best (mover's boxes - the other one's) from here on, exact; null when the budget ran out
    function exactSolver(board, rootFree, budget) {
        const K = rootFree.length;
        const bit = new Int32Array(board.E).fill(-1);
        for (let k = 0; k < K; k++) bit[rootFree[k]] = k;
        const tt = new Map();
        const self = { aborted: false, nodes: 0, mask: 0 };

        function search(alpha, beta) {
            if (board.left === 0) return 0;
            self.nodes++;
            if (budget.tick()) { self.aborted = true; return 0; }
            const key = self.mask;
            const hit = tt.get(key);
            if (hit !== undefined) {
                if (hit.flag === 0) return hit.v;
                if (hit.flag === 1) { if (hit.v >= beta) return hit.v; if (hit.v > alpha) alpha = hit.v; }
                else { if (hit.v <= alpha) return hit.v; if (hit.v < beta) beta = hit.v; }
                if (alpha >= beta) return hit.v;
            }
            const a0 = alpha;
            let best = -Infinity;
            // a free capture is never wrong: play it and search on, no alternatives
            let forced = -1;
            for (let k = 0; k < K; k++) { const e = rootFree[k]; if (!board.drawn[e] && board.isFreeCapture(e)) { forced = e; break; } }
            if (forced >= 0) {
                const g = board.make(forced); self.mask |= 1 << bit[forced];
                best = g + search(alpha - g, beta - g);
                self.mask &= ~(1 << bit[forced]); board.unmake(forced);
                if (self.aborted) return 0;
            } else {
                outer:
                for (let pass = 0; pass < 2; pass++) {
                    for (let k = 0; k < K; k++) {
                        const e = rootFree[k];
                        if (board.drawn[e]) continue;
                        const cap = board.capturesOf(e);
                        if ((pass === 0) !== (cap > 0)) continue;         // captures first
                        const g = board.make(e); self.mask |= 1 << bit[e];
                        const v = g > 0 ? g + search(alpha - g, beta - g) : -search(-beta, -alpha);
                        self.mask &= ~(1 << bit[e]); board.unmake(e);
                        if (self.aborted) return 0;
                        if (v > best) best = v;
                        if (best > alpha) alpha = best;
                        if (alpha >= beta) break outer;
                    }
                }
            }
            tt.set(key, { v: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0 });
            return best;
        }
        self.search = search;
        self.bit = bit;
        return self;
    }

    // the exact value of the position for the side to move (null when the budget ran out)
    function exactValue(board, rootFree, budget) {
        const s = exactSolver(board, rootFree, budget);
        const v = s.search(-Infinity, Infinity);
        return s.aborted ? null : v;
    }

    /* Who wins from here, and nothing more: 1 = player 0, -1 = player 1, 0 = a tie,
       null = the budget ran out. The win chance only needs the sign of the final box
       difference, and a null-window probe ("is the mover's margin at least t?") proves that
       with a fraction of the nodes a full-window value search needs — the cut-offs are much
       harder. Both probes share one transposition table, so the second one is nearly free.
       `lead` = boxes of player 0 minus boxes of player 1 so far. */
    function exactWinner(board, rootFree, budget, lead, current) {
        const s = exactSolver(board, rootFree, budget);
        const atLeast = (t) => s.search(t - 1, t) >= t;              // is the mover's margin >= t?
        let r;
        if (current === 0) r = atLeast(1 - lead) ? 1 : atLeast(-lead) ? 0 : -1;
        else r = !atLeast(lead) ? 1 : !atLeast(lead + 1) ? 0 : -1;
        return s.aborted ? null : r;
    }

    // the exact best move (null when the budget ran out); yields between root moves on long budgets
    async function exactMove(board, rootFree, budget, tools) {
        const s = exactSolver(board, rootFree, budget);
        const order = rootFree.slice().sort((a, b) => board.capturesOf(b) - board.capturesOf(a) || a - b);
        const chatty = tools.budget.nodes >= 20000;
        let best = -Infinity, move = -1, mark = 0;
        for (const e of order) {
            const g = board.make(e); s.mask |= 1 << s.bit[e];
            const v = g > 0 ? g + s.search(best === -Infinity ? -Infinity : best - g, Infinity) : -s.search(-Infinity, best === -Infinity ? Infinity : -best);
            s.mask &= ~(1 << s.bit[e]); board.unmake(e);
            if (s.aborted) return null;
            if (v > best) { best = v; move = e; }
            if (chatty && s.nodes - mark > YIELD_EVERY) { mark = s.nodes; await tools.yield(); }
        }
        return { move, value: best, nodes: s.nodes };
    }

    /* ---------- chain play (everything the exact search cannot reach) ---------- */
    // the run of boxes that hangs off a capturable one: through undrawn lines to boxes with
    // exactly two sides. { boxes, loop } — what taking everything would eat.
    function chainOf(board, start) {
        const t = board.t, seen = new Set([start]), boxes = [start];
        let loop = false, b = start;
        for (let guard = 0; guard <= board.B; guard++) {
            let next = -1;
            for (let j = 0; j < 4; j++) {
                const e = t.boxEdges[b * 4 + j];
                if (board.drawn[e]) continue;
                for (let k = 0; k < 2; k++) {
                    const o = t.edgeBoxes[e * 2 + k];
                    if (o < 0 || o === b || board.sides[o] === 4) continue;
                    if (seen.has(o)) { if (o === start && boxes.length > 2) loop = true; continue; }
                    if (board.sides[o] === 2) next = o;
                }
            }
            if (next < 0) break;
            seen.add(next); boxes.push(next); b = next;
        }
        return { boxes, loop };
    }
    // boxes the other side would take by capturing greedily from here
    function cascade(board) {
        const played = [];
        let total = 0;
        for (;;) {
            let pick = -1;
            for (let e = 0; e < board.E; e++) if (!board.drawn[e] && board.capturesOf(e) > 0) { pick = e; break; }
            if (pick < 0) break;
            total += board.make(pick); played.push(pick);
        }
        for (let k = played.length - 1; k >= 0; k--) board.unmake(played[k]);
        return total;
    }
    const countSafe = (board) => board.freeEdges().filter((e) => board.isSafe(e)).length;

    // pick with a seeded tie-break among equally good moves, so two games are not the same
    function pickBest(tools, moves, score) {
        let best = -Infinity, pool = [];
        for (const m of moves) {
            const s = score(m);
            if (s > best) { best = s; pool = [m]; } else if (s === best) pool.push(m);
        }
        return pool.length === 1 ? pool[0] : pool[Math.floor(tools.random() * pool.length)];
    }

    function chainPlay(tools, board) {
        const free = board.freeEdges();
        const caps = free.filter((e) => board.capturesOf(e) > 0);
        if (caps.length) {
            const cheap = caps.find((e) => board.isFreeCapture(e));
            if (cheap !== undefined) return { move: cheap, why: "free box" };
            const decline = declineMove(board);
            if (decline >= 0) return { move: decline, why: "all but two" };
            return { move: pickBest(tools, caps, (e) => board.capturesOf(e)), why: "take the chain" };
        }
        const safe = free.filter((e) => board.isSafe(e));
        if (safe.length) {
            // among safe lines: leave as few boxes as possible with two sides (fewer chains
            // started), prefer lines with fewer open boxes next to them (the rim first)
            return { move: pickBest(tools, safe, (e) => -halves(board, e) * 4 - neighbours(board, e)), why: "safe line" };
        }
        // everything is loony: concede as few boxes as possible
        return { move: pickBest(tools, free, (e) => -concedes(board, e)), why: "smallest chain" };
    }
    function halves(board, e) {                            // boxes that reach two sides through e
        const eb = board.t.edgeBoxes;
        let k = 0;
        for (let j = 0; j < 2; j++) { const b = eb[e * 2 + j]; if (b >= 0 && board.sides[b] === 1) k++; }
        return k;
    }
    function neighbours(board, e) {
        const eb = board.t.edgeBoxes;
        let k = 0;
        for (let j = 0; j < 2; j++) if (eb[e * 2 + j] >= 0) k++;
        return k;
    }
    function concedes(board, e) {
        board.make(e);
        const c = cascade(board);
        board.unmake(e);
        return c;
    }
    /* "All but two": when only two boxes of the chain are left, draw the far line of the
       last one instead of taking. The other side gets both with one line and then has to
       open the next chain, which is worth far more than two boxes. Only when the rest of
       the board is chains too (no safe line left) and there is still something to win.
       Loops are eaten here; the exact search handles them once it reaches that far. */
    function declineMove(board) {
        const t = board.t;
        let start = -1;
        for (let b = 0; b < board.B; b++) if (board.sides[b] === 3) { start = b; break; }
        if (start < 0) return -1;
        const chain = chainOf(board, start);
        if (chain.loop || chain.boxes.length !== 2) return -1;
        if (board.open - 2 < 2) return -1;                       // nothing left to win afterwards
        if (countSafe(board) > 0) return -1;                     // the others still have safe lines: no control to keep
        const [b, c] = chain.boxes;                              // b is capturable, c is the far one
        for (let j = 0; j < 4; j++) {
            const e = t.boxEdges[c * 4 + j];
            if (board.drawn[e]) continue;
            const o = t.edgeBoxes[e * 2] === c ? t.edgeBoxes[e * 2 + 1] : t.edgeBoxes[e * 2];
            if (o === b) continue;                               // the shared line would capture b instead
            return e;
        }
        return -1;
    }

    /* ---------- the bot ---------- */
    async function chooseMove(tools, state) {
        const board = new Board(state.n).load(state);
        const free = board.freeEdges();
        const budget = tools.deadline();
        if (state.players === 2 && free.length <= EXACT_MAX) {
            const r = await exactMove(board, free, budget, tools);
            if (r && r.move >= 0) { tools.report({ method: "exact", value: r.value, depth: free.length, nodes: r.nodes }); return r.move; }
        }
        const r = chainPlay(tools, board);
        tools.report({ method: "chains", forced: r.why });
        return r.move;
    }

    Bots.register({
        id: "fencer-boxes",
        name: "Fencer",
        game: "boxes",
        version: 2,                       // 2: the win chance was rewritten (see evaluate); cached analyses are stamped with this
        description: "Takes every free box, keeps its lines safe while it can, counts the chains and gives two boxes away to stay in control. Solves the endgame exactly.",
        difficulties: [
            { id: "easy", label: "Easy", nodes: 2000 },
            { id: "normal", label: "Normal", nodes: 10000 },
            { id: "hard", label: "Hard", nodes: 30000 },
            { id: "insane", label: "Very hard", nodes: 100000 },
        ],
        create(tools) {
            return { move: (state) => chooseMove(tools, state) };
        },
        /* Win chance from player 0's point of view. ±Infinity only for proven results (a
           majority of the boxes, or a solved endgame); everything else is the lead measured
           against what is still on the table.

           Two things make this number calm, and both were measured (see docs/bots.md §11):
           - **One node cap for every stage.** The HUD asks at 2 000, 12 000 and 60 000 nodes;
             if the endgame proof depended on that budget the same position would read 43 %,
             then 100 %, and the next one 0 % again, because whether the search finishes is
             not monotone in the lines left. The proof therefore always gets EVAL_NODES,
             whatever the caller offers, and every stage returns the same value.
           - **No positional guess.** The old score added a term for who would have to open
             first (the parity of the safe lines), which flipped with every quiet move and
             was worth nothing: in seeded self-play with 12 % random moves it predicted no
             better than the plain box count, and neither did chain-play rollouts of the rest
             of the game (they only looked convincing on the games their own policy played).
             Until the endgame is proven, Dots and Boxes simply has no honest signal beyond the
             boxes on the table, and pretending otherwise is what made the bar jump.

           Symmetric by construction: swapping the seats negates the score, and nothing here
           depends on who is to move (the exact search accounts for the turn itself). */
        evaluate(state) {
            const total = state.n * state.n;
            const s0 = state.scores[0] || 0, s1 = state.scores[1] || 0;
            if (state.over) return state.winner < 0 ? 0 : state.winner === 0 ? Infinity : -Infinity;
            if (s0 * 2 > total) return Infinity;
            if (s1 * 2 > total) return -Infinity;
            const board = new Board(state.n).load(state);
            const free = board.freeEdges();
            if (state.players === 2 && free.length <= EXACT_MAX) {
                const r = exactWinner(board, free, capped(EVAL_NODES), s0 - s1, state.current);
                if (r !== null) return r > 0 ? Infinity : r < 0 ? -Infinity : 0;
            }
            return (s0 - s1) / (total - s0 - s1 + 1);
        },
        internals: { Board, tablesFor, chainOf, chainPlay, exactValue, exactMove, exactWinner, capped, EXACT_MAX, EVAL_NODES },
    });
})();
