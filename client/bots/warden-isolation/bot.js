/* Warden — Isolation. A searching bot for 2 to 4 players.

   Pure and headless: it reads state.cells / state.pawns / state.trapped / state.out /
   state.current / state.n and returns an encoded move (to * cells + removed).

   Board: an Int8Array (-2 hole, -1 free, >= 0 the pawn of that seat) with make/unmake, a
   precomputed 8-neighbour list and the same "who is trapped when their turn comes" rule
   the rules module uses, so the search sees exactly the game that is played.

   Search: paranoid alpha-beta (I maximise, everybody else minimises) with iterative
   deepening, the previous iteration's best move first and a node budget from the
   difficulty. A move is a pair (step, broken tile), so the raw branching factor is
   8 × free tiles; the generator keeps the steps but only the most useful broken tiles:
   the tiles around the opponents (that is what shrinks them), the tile the pawn just
   left, then the free tiles nearest to an opponent, capped per difficulty.

   Evaluation (from my seat's view): Voronoi territory — a multi-source BFS with king
   steps gives every free tile to whoever reaches it first, ties belong to nobody — plus
   mobility and a small tempo term. That is also the right measure once the board falls
   apart: a pawn alone in its region owns exactly the tiles it can still reach, which is
   how long it survives.

   Determinism: no Math.random (Easy's spread uses tools.random), no wall clock — the node
   budget decides when a search stops, so the same position and budget give the same move
   on every device. */

"use strict";

const WardenIsolation = (() => {
    const WIN = 1000000;             // mate scores: WIN - ply, so a faster trap scores higher
    const MAXPLY = 60;
    const MAXMOVES = 8 * 20;         // steps × capped broken-tile candidates

    /* difficulty profiles: depth = iterative-deepening cap, removals = how many broken-tile
       candidates a step may combine with, spread = Easy's tolerance when picking among the
       root moves, yields = breathe between deepening iterations */
    const LEVELS = {
        "easy": { depth: 1, removals: 6, spread: 220, yields: false },
        "normal": { depth: 2, removals: 8, spread: 0, yields: false },
        "hard": { depth: 4, removals: 10, spread: 0, yields: true },
        "very-hard": { depth: 14, removals: 12, spread: 0, yields: true },
    };
    // evaluation weights (an object so tuning can reach them)
    const EVAL = { territory: 100, mobility: 14, tempo: 6 };

    /* ================= board ================= */
    class Board {
        constructor(n, players) {
            this.n = n; this.players = players; this.size = n * n;
            this.cell = new Int8Array(this.size);
            this.pawns = new Int32Array(4);
            this.trapped = new Uint8Array(4);
            this.alive = players;
            this.nb = [];
            for (let c = 0; c < this.size; c++) {
                const x = c % n, y = (c - x) / n, list = [];
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const u = x + dx, v = y + dy;
                    if (u >= 0 && v >= 0 && u < n && v < n) list.push(v * n + u);
                }
                this.nb.push(Int16Array.from(list));
            }
            this.dist = new Int16Array(this.size);
            this.own = new Int8Array(this.size);
            this.queue = new Int32Array(this.size);
            this.terr = new Int32Array(4);
        }

        load(state) {
            for (let c = 0; c < this.size; c++) this.cell[c] = state.cells[c];
            this.alive = 0;
            for (let p = 0; p < this.players; p++) {
                this.pawns[p] = state.pawns[p];
                this.trapped[p] = (state.trapped && state.trapped[p]) || (state.out && state.out[p]) ? 1 : 0;
                if (!this.trapped[p]) this.alive++;
            }
        }

        mobility(p) {
            const list = this.nb[this.pawns[p]], cell = this.cell;
            let k = 0;
            for (let i = 0; i < list.length; i++) if (cell[list[i]] === -1) k++;
            return k;
        }

        make(m, p) {
            const to = (m / this.size) | 0, r = m % this.size, from = this.pawns[p];
            this.cell[from] = -1;
            this.cell[to] = p;
            this.pawns[p] = to;
            this.cell[r] = -2;                       // r === from is fine: the hole wins
            return (from << 20) | (to << 10) | r;    // undo frame (a cell id fits in 10 bits: 12 × 12 = 144)
        }
        unmake(u, p) {
            const from = u >> 20, to = (u >> 10) & 1023, r = u & 1023;
            this.cell[r] = -1;
            this.cell[to] = -1;
            this.cell[from] = p;
            this.pawns[p] = from;
        }

        // the next seat that is still in (never a trapped one)
        next(p) {
            for (let k = 1; k <= this.players; k++) {
                const q = (p + k) % this.players;
                if (!this.trapped[q]) return q;
            }
            return p;
        }
        firstAlive() {
            for (let p = 0; p < this.players; p++) if (!this.trapped[p]) return p;
            return -1;
        }

        /* Pass the turn the way the rules do: whoever cannot step when their turn comes is
           trapped and out. Returns the next mover, or -1 when the game is decided (the
           winner is in this.winner). Newly trapped seats land in `out` so the search can
           take them back. */
        advance(p, out) {
            let cur = p;
            for (let guard = 0; guard <= this.players; guard++) {
                if (this.alive <= 1) { this.winner = this.firstAlive(); return -1; }
                cur = this.next(cur);
                if (this.mobility(cur) > 0) return cur;
                this.trapped[cur] = 1; this.alive--; out.push(cur);
            }
            this.winner = -1;
            return -1;
        }

        /* Voronoi: every free tile goes to the pawn that reaches it first (king steps);
           tiles reached at the same distance by two pawns belong to nobody. One BFS. */
        voronoi() {
            const size = this.size, cell = this.cell, dist = this.dist, own = this.own, queue = this.queue;
            dist.fill(-1); own.fill(-1);
            let head = 0, tail = 0;
            for (let p = 0; p < this.players; p++) {
                if (this.trapped[p]) continue;
                const at = this.pawns[p];
                dist[at] = 0; own[at] = p; queue[tail++] = at;
            }
            while (head < tail) {
                const c = queue[head++], d = dist[c] + 1, o = own[c], list = this.nb[c];
                for (let i = 0; i < list.length; i++) {
                    const nb = list[i];
                    if (cell[nb] !== -1) continue;
                    if (dist[nb] < 0) { dist[nb] = d; own[nb] = o; queue[tail++] = nb; }
                    else if (dist[nb] === d && own[nb] !== o) own[nb] = -2;      // contested
                }
            }
            const terr = this.terr;
            terr.fill(0);
            for (let c = 0; c < size; c++) if (cell[c] === -1 && own[c] >= 0) terr[own[c]]++;
            return terr;
        }
    }

    /* ================= searcher ================= */
    class Searcher {
        constructor(tools, level) {
            this.tools = tools;
            this.level = level;
            this.B = null;
            this.moves = new Int32Array(MAXPLY * MAXMOVES);
            this.scores = new Int32Array(MAXMOVES);
            this.order = new Int32Array(MAXMOVES);
            this.rootValues = [];
        }

        board(state) {
            if (!this.B || this.B.n !== state.n || this.B.players !== state.players) this.B = new Board(state.n, state.players);
            this.B.load(state);
            return this.B;
        }

        /* static value of the position from this.me's view */
        evaluate() {
            const B = this.B;
            const terr = B.voronoi();
            let mine = 0, best = -Infinity, myMob = 0, bestMob = 0;
            for (let p = 0; p < B.players; p++) {
                if (B.trapped[p]) continue;
                const mob = B.mobility(p);
                if (p === this.me) { mine = terr[p]; myMob = mob; }
                else if (terr[p] > best || (terr[p] === best && mob > bestMob)) { best = terr[p]; bestMob = mob; }
            }
            if (best === -Infinity) return WIN - MAXPLY;                 // nobody left but me
            return (mine - best) * EVAL.territory + (myMob - bestMob) * EVAL.mobility
                + (B.turnIsMine ? EVAL.tempo : -EVAL.tempo);
        }

        /* the moves of seat p, best first: every step, combined with the broken tiles that
           matter (around the opponents, the tile just left, then the tiles nearest to an
           opponent). Writes them into this.moves at `ply` and returns how many. */
        generate(p, ply) {
            const B = this.B, size = B.size, cell = B.cell, base = ply * MAXMOVES;
            const from = B.pawns[p];
            // 1. the tiles that may be broken, scored
            const cand = [], score = [];
            const near = (c) => {                                        // Chebyshev distance to the nearest opponent
                const n = B.n, x = c % n, y = (c - x) / n;
                let d = 99;
                for (let q = 0; q < B.players; q++) {
                    if (q === p || B.trapped[q]) continue;
                    const a = B.pawns[q], ax = a % n, ay = (a - ax) / n;
                    const dd = Math.max(Math.abs(x - ax), Math.abs(y - ay));
                    if (dd < d) d = dd;
                }
                return d;
            };
            for (let c = 0; c < size; c++) {
                if (cell[c] !== -1) continue;
                const d = near(c);
                if (d > 2) continue;                                     // too far to hurt anybody right now
                cand.push(c); score.push(d === 1 ? 200 : 120 - d * 10);
            }
            cand.push(from); score.push(90 - near(from) * 5);            // the tile the pawn leaves behind
            if (cand.length < 3) {                                       // an empty board around the opponents: take anything
                for (let c = 0; c < size && cand.length < 8; c++) if (cell[c] === -1 && !cand.includes(c)) { cand.push(c); score.push(1); }
            }
            const idx = cand.map((c, k) => k).sort((a, b) => score[b] - score[a] || cand[a] - cand[b]).slice(0, this.level.removals);
            // 2. every step, combined with those tiles
            const list = B.nb[from];
            let count = 0;
            for (let i = 0; i < list.length; i++) {
                const to = list[i];
                if (cell[to] !== -1) continue;
                let mob = 0;                                             // how open the destination is (move ordering)
                const around = B.nb[to];
                for (let k = 0; k < around.length; k++) if (cell[around[k]] === -1 || around[k] === from) mob++;
                for (const k of idx) {
                    const r = cand[k];
                    if (r === to || count >= MAXMOVES) continue;
                    this.moves[base + count] = to * size + r;
                    this.scores[count] = mob * 30 + score[k];
                    count++;
                }
            }
            // order by the static score, ties by move id (deterministic)
            const ord = [];
            for (let k = 0; k < count; k++) ord.push(k);
            ord.sort((a, b) => this.scores[b] - this.scores[a] || this.moves[base + a] - this.moves[base + b]);
            for (let k = 0; k < count; k++) this.order[k] = this.moves[base + ord[k]];
            for (let k = 0; k < count; k++) this.moves[base + k] = this.order[k];
            return count;
        }

        // one node: the side to move is this.turn and is guaranteed to have a move
        search(depth, alpha, beta, ply) {
            if (this.d.tick()) { this.stop = true; return 0; }
            const B = this.B;
            B.turnIsMine = this.turn === this.me;
            if (depth <= 0 || ply >= MAXPLY - 1) return this.evaluate();
            const p = this.turn;
            const count = this.generate(p, ply);
            const base = ply * MAXMOVES;
            const maxing = p === this.me;
            let best = maxing ? -Infinity : Infinity;
            for (let k = 0; k < count; k++) {
                const m = this.moves[base + k];
                const u = B.make(m, p);
                const out = [];
                const nxt = B.advance(p, out);
                let v;
                if (nxt < 0) v = B.winner === this.me ? WIN - ply : -(WIN - ply);
                else { this.turn = nxt; v = this.search(depth - 1, alpha, beta, ply + 1); }
                this.turn = p;
                for (const q of out) { B.trapped[q] = 0; B.alive++; }
                B.unmake(u, p);
                if (this.stop) return best === Infinity || best === -Infinity ? v : best;
                if (maxing) { if (v > best) best = v; if (best > alpha) alpha = best; }
                else { if (v < best) best = v; if (best < beta) beta = best; }
                if (alpha >= beta) break;
            }
            return best;
        }

        /* The root: every move, the previous best first; null when the budget ran out. The
           root seat maximises only when it is the seat we play for — the win-chance
           evaluator asks about positions where somebody else is to move. */
        rootSearch(depth, first) {
            const B = this.B, p = this.turn;
            const count = this.generate(p, 0);
            const list = [];
            for (let k = 0; k < count; k++) list.push(this.moves[k]);
            if (first >= 0) {
                const at = list.indexOf(first);
                if (at > 0) { list.splice(at, 1); list.unshift(first); }
            }
            const maxing = p === this.me;
            let alpha = -Infinity, beta = Infinity;
            let bestV = maxing ? -Infinity : Infinity, bestM = list[0];
            const values = [];
            for (const m of list) {
                const u = B.make(m, p);
                const out = [];
                const nxt = B.advance(p, out);
                let v;
                if (nxt < 0) v = B.winner === this.me ? WIN : -WIN;
                else { this.turn = nxt; v = this.search(depth - 1, alpha, beta, 1); }
                this.turn = p;
                for (const q of out) { B.trapped[q] = 0; B.alive++; }
                B.unmake(u, p);
                if (this.stop) return null;
                values.push({ move: m, value: v });
                if (maxing) { if (v > bestV) { bestV = v; bestM = m; } if (bestV > alpha) alpha = bestV; }
                else { if (v < bestV) { bestV = v; bestM = m; } if (bestV < beta) beta = bestV; }
            }
            return { move: bestM, value: bestV, values };
        }

        // iterative deepening within the node budget
        async run(state) {
            this.board(state);
            this.me = state.current;                       // the seat to move is the one I play for
            this.turn = state.current;
            this.d = this.tools.deadline();
            this.stop = false;
            let best = null, depth = 0;
            for (let dpt = 1; dpt <= this.level.depth; dpt++) {
                if (this.level.yields && dpt > 1) await this.tools.yield();
                const r = this.rootSearch(dpt, best ? best.move : -1);
                if (!r) break;
                best = r; depth = dpt;
                if (Math.abs(r.value) >= WIN - MAXPLY) break;             // decided: no point searching deeper
                if (this.d.expired()) break;
            }
            this.lastDepth = depth;
            return best;
        }

        /* One search of `state` as if `turn` were to move, for the win chance. Returns the
           value from player 0's view, or null when the budget ran out. */
        probe(state, turn, depth) {
            const B = this.board(state);
            this.turn = turn;
            if (B.trapped[turn]) return null;
            if (B.mobility(turn) === 0) return turn === this.me ? -WIN : WIN;   // trapped the moment it is their turn
            this.stop = false;
            const r = this.rootSearch(depth, -1);
            return r ? r.value : null;
        }

        // the move for a seat: the root search, Easy spreads over the near-best moves
        async move(state) {
            const legal = this.tools.legalMoves(state, state.current);
            if (legal.length === 0) return undefined;
            const best = await this.run(state);
            if (!best) return legal[0];
            let chosen = best.move;
            if (this.level.spread > 0) {
                const pool = best.values.filter((v) => v.value >= best.value - this.level.spread).map((v) => v.move).sort((a, b) => a - b);
                chosen = pool[Math.floor(this.tools.random() * pool.length)];
            }
            this.tools.report({ depth: this.lastDepth, value: best.value });
            return chosen;
        }
    }

    /* Win chance: the raw score from PLAYER 0's view for the given node budget.

       Any minimax value carries a tempo artefact: with the mover choosing last the position
       looks better for them than with the mover choosing first, so the bar jumped up and
       down every single move (the horizon effect AGENTS.md warns about). The score is
       therefore the average of the search of the real position and of the same position with
       the other seat to move: that pair is symmetric by construction, so what is left is the
       position, not whose turn it is. Both halves always run to the same depth, which is why
       the deepening loop lives out here. A proven result for the *real* position still wins
       outright (±Infinity); a proven result for the hypothetical half is only worth CLAMP. */
    const EST_CAP = 12;
    const CLAMP = 5000;
    const QUICK_NODES = 4000;      // up to here the estimate is synchronous (the HUD's first stage)
    // the estimator keeps fewer broken-tile candidates than a playing level: a narrower tree
    // buys a ply or two of depth, which is what makes the number calm
    const EST_LEVEL = { depth: EST_CAP, removals: 4, spread: 0, yields: true };
    const decided = (v) => Math.abs(v) >= WIN - MAXPLY;

    const evaluators = new Map();
    function acquire(n, players) {
        const key = `${n}/${players}`;
        if (!evaluators.has(key)) evaluators.set(key, []);
        const pool = evaluators.get(key);
        let e = pool.find((x) => !x.busy);
        if (!e) { e = new Searcher(null, EST_LEVEL); pool.push(e); }
        return e;
    }
    /* one deepening iteration at a time, so the quick stage can run synchronously (the bar
       shows a number the moment a move settles) and the long ones can breathe between plies */
    function makeEstimate(e, state, tools) {
        e.tools = tools;
        e.me = 0;
        e.d = tools.deadline();
        e.stop = false;
        const other = state.players === 2 ? 1 - state.current : -1;
        const clamp = (v) => (decided(v) ? (v > 0 ? CLAMP : -CLAMP) : v);
        let depth = 0, last = null, proven = 0, done = false;
        return {
            get done() { return done; },
            step() {
                if (++depth > EST_CAP) { done = true; return; }
                const a = e.probe(state, state.current, depth);
                if (a === null) { done = true; return; }
                let b = a;
                if (other >= 0) { b = e.probe(state, other, depth); if (b === null) { done = true; return; } }
                last = (clamp(a) + clamp(b)) / 2;
                if (decided(a)) { proven = a > 0 ? 1 : -1; done = true; return; }   // proven: deeper cannot change it
                if (e.d.expired()) done = true;
            },
            value: () => (proven ? (proven > 0 ? Infinity : -Infinity) : (last === null ? 0 : last)),
        };
    }
    function estimateRaw(state, tools) {
        if (state.over) return state.winner === 0 ? Infinity : state.winner < 0 ? 0 : -Infinity;
        const e = acquire(state.n, state.players);
        e.level = EST_LEVEL;
        const it = makeEstimate(e, state, tools);
        if (tools.budget.nodes <= QUICK_NODES) {                       // small budget: answer at once
            while (!it.done) it.step();
            return it.value();
        }
        e.busy = true;                                                 // a background stage: the pool hands out another one
        return (async () => {
            try {
                while (!it.done) { it.step(); if (!it.done) await tools.yield(); }
                return it.value();
            } finally { e.busy = false; }
        })();
    }

    return { Board, Searcher, LEVELS, EVAL, estimateRaw, WIN };
})();

Bots.register({
    id: "warden-isolation",
    name: "Warden",
    game: "isolation",
    version: 1,
    description: "Counts the ground each pawn can still reach and breaks the tiles you need. Very hard searches deep.",
    difficulties: [
        { id: "easy", label: "Easy", nodes: 2000 },              // node budgets: the same strength on every device
        { id: "normal", label: "Normal", nodes: 10000 },
        { id: "hard", label: "Hard", nodes: 30000 },
        { id: "very-hard", label: "Very hard", nodes: 100000 },
    ],
    create(tools) {
        const s = new WardenIsolation.Searcher(tools, WardenIsolation.LEVELS[tools.difficulty] || WardenIsolation.LEVELS.normal);
        return { move: (state) => s.move(state), searcher: s };   // searcher: test hook
    },
    evaluate: (state, tools) => WardenIsolation.estimateRaw(state, tools),
    internals: WardenIsolation,        // test hooks: Board, Searcher, LEVELS, EVAL, estimateRaw
});
