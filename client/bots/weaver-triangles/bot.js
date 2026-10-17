/* Weaver: Triangles.

   One compact board and two searches on it:

   1. **Exact endgame** (two players, at most EXACT_MAX uncovered edges): alpha-beta negamax
      to the end of the game with a transposition table. A move covers edges and the turn
      always passes, so the rest of the game depends on the covered edges alone (which pegs
      are touched follows from them); with a token limit the scores decide when it ends, so
      they join the key. The value is the final triangle difference from the mover's view,
      whose sign is the result under every ending (a seat that reaches its token number
      leads at that moment). It gets half the level's nodes; when it finishes, the move is
      proven.

   2. **Alpha-beta** with iterative deepening for everything else: negamax over two sides,
      me and everybody else, so two seats play plain minimax and three or four seats the
      paranoid scheme (every other seat minimises my lead over the best of them). Moves are
      ordered claims first, then safe bands (that hand nothing over), then the rest; at the
      root, while a safe band exists, Weaver never hands a triangle over. A leaf is the
      lead plus what the side to move can claim at once (one band), which also spots a
      token win one move ahead.

   Bands that cover the same new edges lead to the same position, so both searches keep
   one of them (a proven reduction: same covered set, same claims, same touched pegs).

   Deterministic everywhere: node budgets, the seeded tools.random for ties, no wall clock.
   `evaluate` (the HUD's win chance) is ±Infinity once the result is decided by the scores
   or proven by the endgame search, otherwise the lead smoothed over the next two bands a
   short search predicts, measured against the triangles still open, on node caps of its own
   so every HUD stage agrees. */

"use strict";

(() => {
    const EXACT_MAX = 32;                 // uncovered edges the exact search will try (its key must stay an exact integer)
    const EVAL_NODES = 20000;             // the win chance's own node cap for the proof: the same at every HUD stage
    const LINE_NODES = 300;               // ... and per band of the line it predicts
    const YIELD_BUDGET = 20000;           // node budgets from here on yield to the page and answer with a Promise
    const YIELD_EVERY = 2000;             // nodes between two tools.yield() calls
    const GEN_DEPTH = 3;                  // alpha-beta nodes with this much depth left run as generators (they may yield)
    const GEN_DEPTH_PARANOID = 2;         // the same with 3 or 4 seats in: two plies of the other side in a row prune nothing
    const GEN_OPEN = 8;                   // exact-search nodes with more uncovered edges than this run as generators
    const MAX_DEPTH = 40;
    const WIN = 100000;                   // a finished game, plus the final margin

    const rulesOf = () => Rules.of("triangles");

    // a node budget of our own, independent of the caller's (see evaluate)
    function capped(nodes) {
        let used = 0;
        const expired = () => used >= nodes;
        return { expired, tick: (n = 1) => { used += n; return expired(); }, nodes: () => used };
    }

    /* ---------- per board size and band rule: the tables the board works with ---------- */
    const TABLES = new Map();
    function tablesFor(n, band) {
        const id = `${n}/${band}`;
        let t = TABLES.get(id);
        if (t) return t;
        const g = rulesOf().geometry(n);
        const { V, E, T } = g;
        const list = [];
        for (let len = 1; len <= 3; len++) if (band === 0 || band === len) for (const b of g.bands[len]) list.push(b);
        const NB = list.length;
        const bEdges = new Int16Array(NB * 3).fill(-1), bPegs = new Int16Array(NB * 4).fill(-1);
        const bMove = new Int32Array(NB), bLen = new Uint8Array(NB), index = new Map();
        list.forEach((b, k) => {
            b.edges.forEach((e, j) => { bEdges[k * 3 + j] = e; });
            b.pegs.forEach((p, j) => { bPegs[k * 4 + j] = p; });
            bMove[k] = b.move; bLen[k] = b.len; index.set(b.move, k);
        });
        const edgeTris = new Int16Array(E * 2).fill(-1), eA = new Int16Array(E), eB = new Int16Array(E);
        g.edges.forEach((ed, e) => { eA[e] = ed.a; eB[e] = ed.b; g.trisOf[e].forEach((tr, j) => { edgeTris[e * 2 + j] = tr; }); });
        const triEdges = new Int16Array(T * 3);
        g.tris.forEach((tr, k) => tr.edges.forEach((e, j) => { triEdges[k * 3 + j] = e; }));
        // the bands through every edge (CSR: edgeBands[edgeStart[e] … edgeStart[e + 1]))
        const through = Array.from({ length: E }, () => []);
        for (let k = 0; k < NB; k++) for (let j = 0; j < 3; j++) if (bEdges[k * 3 + j] >= 0) through[bEdges[k * 3 + j]].push(k);
        const edgeStart = new Int32Array(E + 1);
        for (let e = 0; e < E; e++) edgeStart[e + 1] = edgeStart[e] + through[e].length;
        const edgeBands = Int16Array.from(through.flat());
        t = { n, band, V, E, T, NB, bEdges, bPegs, bMove, bLen, index, edgeTris, eA, eB, triEdges, edgeStart, edgeBands };
        TABLES.set(id, t);
        return t;
    }

    /* ---------- the compact board: typed arrays, make / unmake ---------- */
    const HASH = 4096;                                       // the duplicate filter of one move list
    function Board(state) {
        const t = tablesFor(state.n, state.band);
        this.t = t;
        this.players = state.players;
        this.tokens = state.tokens > 0 ? state.tokens : 0;
        this.touchRule = state.touch === true;
        this.cov = new Uint8Array(t.E);                      // 1 = covered
        this.sides = new Uint8Array(t.T);                    // covered edges per triangle (3 = claimed)
        this.touch = new Uint8Array(t.V);                    // covered edges at every peg (> 0 = touched)
        this.scores = new Int16Array(4);
        this.out = new Uint8Array(4);
        this.covered = 0; this.claimed = 0; this.two = 0; this.cur = 0;
        this.bit = new Float64Array(t.E);                    // the exact search's key: 2^k for its k-th open edge
        this.mask = 0;
        this.undoE = new Int16Array(t.E * 3 + 3); this.undoK = new Uint8Array(t.E + 1);
        this.undoCur = new Uint8Array(t.E + 1); this.undoGain = new Uint8Array(t.E + 1);
        this.sp = 0;
        this.hKey = new Int32Array(HASH); this.hStamp = new Int32Array(HASH); this.stamp = 0;
        this.load(state);
    }
    Board.prototype.load = function (state) {
        const t = this.t;
        this.covered = 0; this.claimed = 0; this.two = 0; this.sp = 0; this.mask = 0;
        this.touch.fill(0); this.bit.fill(0);
        for (let e = 0; e < t.E; e++) {
            const c = state.cells[e] === -1 ? 0 : 1;
            this.cov[e] = c;
            if (c) { this.covered++; this.touch[t.eA[e]]++; this.touch[t.eB[e]]++; }
        }
        for (let k = 0; k < t.T; k++) {
            let s = 0;
            for (let j = 0; j < 3; j++) s += this.cov[t.triEdges[k * 3 + j]];
            this.sides[k] = s;
            if (s === 3) this.claimed++; else if (s === 2) this.two++;
        }
        for (let p = 0; p < 4; p++) { this.scores[p] = p < this.players ? state.scores[p] : 0; this.out[p] = p < this.players && state.out && state.out[p] ? 1 : 0; }
        this.cur = state.current;
        return this;
    };
    // the seat after `p` that is still in (Rules.pass)
    Board.prototype.next = function (p) {
        for (let k = 1; k <= this.players; k++) { const q = (p + k) % this.players; if (!this.out[q]) return q; }
        return p;
    };
    // play band k for the seat to move: the triangles it claims (and the turn passes)
    Board.prototype.make = function (k) {
        const t = this.t, sp = this.sp;
        let gain = 0, n = 0;
        for (let j = 0; j < 3; j++) {
            const e = t.bEdges[k * 3 + j];
            if (e < 0) break;
            if (this.cov[e]) continue;
            this.cov[e] = 1; this.covered++; this.mask += this.bit[e];
            this.touch[t.eA[e]]++; this.touch[t.eB[e]]++;
            this.undoE[sp * 3 + n++] = e;
            for (let i = 0; i < 2; i++) {
                const tr = t.edgeTris[e * 2 + i];
                if (tr < 0) continue;
                const k3 = ++this.sides[tr];
                if (k3 === 3) { gain++; this.two--; } else if (k3 === 2) this.two++;
            }
        }
        this.undoK[sp] = n; this.undoCur[sp] = this.cur; this.undoGain[sp] = gain;
        this.sp = sp + 1;
        this.scores[this.cur] += gain; this.claimed += gain;
        this.cur = this.next(this.cur);
        return gain;
    };
    Board.prototype.unmake = function () {
        const t = this.t, sp = --this.sp;
        this.cur = this.undoCur[sp];
        const gain = this.undoGain[sp];
        this.scores[this.cur] -= gain; this.claimed -= gain;
        for (let j = this.undoK[sp] - 1; j >= 0; j--) {
            const e = this.undoE[sp * 3 + j];
            this.cov[e] = 0; this.covered--; this.mask -= this.bit[e];
            this.touch[t.eA[e]]--; this.touch[t.eB[e]]--;
            for (let i = 0; i < 2; i++) {
                const tr = t.edgeTris[e * 2 + i];
                if (tr < 0) continue;
                const k3 = this.sides[tr]--;
                if (k3 === 3) this.two++; else if (k3 === 2) this.two--;
            }
        }
    };
    // may band k be stretched now (the rules' isLegal: an uncovered edge, and a touched peg)
    Board.prototype.legal = function (k) {
        const t = this.t;
        let open = false;
        for (let j = 0; j < 3; j++) { const e = t.bEdges[k * 3 + j]; if (e < 0) break; if (!this.cov[e]) { open = true; break; } }
        if (!open) return false;
        if (!this.touchRule || this.covered === 0) return true;
        for (let j = 0; j < 4; j++) { const p = t.bPegs[k * 4 + j]; if (p < 0) break; if (this.touch[p]) return true; }
        return false;
    };
    // the triangles band k would claim (2 covered sides before) and hand over (1 before)
    Board.prototype.claims = function (k) { return this.around(k, 2); };
    Board.prototype.opens = function (k) { return this.around(k, 1); };
    Board.prototype.around = function (k, before) {
        const t = this.t;
        let c = 0;
        for (let j = 0; j < 3; j++) {
            const e = t.bEdges[k * 3 + j];
            if (e < 0) break;
            if (this.cov[e]) continue;
            for (let i = 0; i < 2; i++) { const tr = t.edgeTris[e * 2 + i]; if (tr >= 0 && this.sides[tr] === before) c++; }
        }
        return c;
    };
    /* The legal bands, one per set of new edges, into `out`, with an ordering key into
       `keys` (claims first, then safe bands, then the fewest triangles handed over);
       returns the count. Bands that cover the same new edges lead to the same position:
       - any length (band 0): a band with covered edges whose new edges form one run is
         the same move as the band over exactly that run, which is legal whenever it is
         (the peg it shares with the covered part is touched); so only bands without
         covered edges and 4-peg bands with just the middle edge covered are kept;
       - one length: a band without covered edges is the only one with its edge set; the
         others go through a small hash of their new edges. */
    Board.prototype.gen = function (out, keys) {
        const t = this.t, E = t.E, mixed = t.band === 0, cov = this.cov, be = t.bEdges;
        const st = ++this.stamp;
        let n = 0;
        for (let k = 0; k < t.NB; k++) {
            const len = t.bLen[k], b3 = k * 3;
            let nc = 0;
            for (let j = 0; j < len; j++) nc += cov[be[b3 + j]];
            if (nc === len) continue;                                    // nothing new to cover
            if (mixed && nc > 0 && !(len === 3 && nc === 1 && cov[be[b3 + 1]])) continue;
            if (this.touchRule && this.covered > 0) {
                let touched = false;
                for (let j = 0; j <= len; j++) if (this.touch[t.bPegs[k * 4 + j]]) { touched = true; break; }
                if (!touched) continue;
            }
            let sig = 0, c = 0, o = 0;
            for (let j = 0; j < len; j++) {
                const e = be[b3 + j];
                if (cov[e]) continue;
                sig = sig * E + e + 1;
                for (let i = 0; i < 2; i++) {
                    const tr = t.edgeTris[e * 2 + i];
                    if (tr < 0) continue;
                    if (this.sides[tr] === 2) c++; else if (this.sides[tr] === 1) o++;
                }
            }
            if (!mixed && nc > 0) {                                      // open addressing on the new edges
                let h = Math.imul(sig, 0x9e3779b1) >>> 20, dup = false;
                while (this.hStamp[h] === st) { if (this.hKey[h] === sig) { dup = true; break; } h = (h + 1) & (HASH - 1); }
                if (dup) continue;
                this.hStamp[h] = st; this.hKey[h] = sig;
            }
            out[n] = k;
            keys[n] = c > 0 ? 1000 + c * 16 - o : o === 0 ? 500 : 400 - o;
            n++;
        }
        return n;
    };
    // the legal bands as moves (every band, duplicates included): the rules' legalMoves
    Board.prototype.legalMoves = function () {
        const out = [];
        for (let k = 0; k < this.t.NB; k++) if (this.legal(k)) out.push(this.t.bMove[k]);
        return out;
    };
    /* What a leaf needs and nothing more: -1 when no band may be stretched (the game is
       over), else the most triangles one band claims right now. */
    Board.prototype.bestClaim = function () {
        if (!this.anyLegal()) return -1;
        if (this.two === 0) return 0;                        // nothing lies on the table
        const t = this.t;
        let best = 0;
        for (let tr = 0; tr < t.T; tr++) {
            if (this.sides[tr] !== 2) continue;
            let e = -1;
            for (let j = 0; j < 3; j++) if (!this.cov[t.triEdges[tr * 3 + j]]) { e = t.triEdges[tr * 3 + j]; break; }
            for (let i = t.edgeStart[e]; i < t.edgeStart[e + 1]; i++) {
                const k = t.edgeBands[i];
                const c = this.around(k, 2);
                if (c > best && this.legal(k)) best = c;
            }
        }
        return best;
    };
    Board.prototype.anyLegal = function () {
        for (let k = 0; k < this.t.NB; k++) if (this.legal(k)) return true;
        return false;
    };
    // the highest score among the seats still in other than p
    Board.prototype.bestOther = function (p) {
        let m = -1;
        for (let q = 0; q < this.players; q++) if (q !== p && !this.out[q] && this.scores[q] > m) m = this.scores[q];
        return m;
    };
    // the winner once nothing may be stretched: the one top seat among those still in, else -1
    Board.prototype.topSeat = function () {
        let best = -1, who = -1, ties = 0;
        for (let q = 0; q < this.players; q++) {
            if (this.out[q]) continue;
            if (this.scores[q] > best) { best = this.scores[q]; who = q; ties = 1; } else if (this.scores[q] === best) ties++;
        }
        return ties === 1 ? who : -1;
    };

    // move the best remaining move (highest key) to slot i: a lazy sort, since a cut-off
    // usually comes after the first move or two
    function pickNext(moves, keys, i, n) {
        let bi = i;
        for (let j = i + 1; j < n; j++) if (keys[j] > keys[bi]) bi = j;
        if (bi !== i) {
            const m = moves[i], k = keys[i];
            moves[i] = moves[bi]; keys[i] = keys[bi]; moves[bi] = m; keys[bi] = k;
        }
        return moves[i];
    }
    // stable insertion sort of moves[0..n) by descending key (the root order)
    function order(moves, keys, n) {
        for (let i = 1; i < n; i++) {
            const m = moves[i], k = keys[i];
            let j = i - 1;
            while (j >= 0 && keys[j] < k) { moves[j + 1] = moves[j]; keys[j + 1] = keys[j]; j--; }
            moves[j + 1] = m; keys[j + 1] = k;
        }
    }

    /* ---------- the exact endgame (two players) ---------- */
    /* The best final triangle difference from the mover's view from here on, as "what the
       mover still gains minus what the other one still gains" (the future part; the lead so
       far is the caller's). Without a token limit that depends on the covered edges alone,
       with one the scores join the key. Null-window probes work on the same table. */
    function exactSolver(board, budget) {
        const t = board.t;
        let k = 0;
        board.bit.fill(0);
        for (let e = 0; e < t.E; e++) if (!board.cov[e]) board.bit[e] = 2 ** k++;
        board.mask = 0;
        const tt = new Map();
        const mv = [], ky = [];
        const self = { aborted: false, nodes: 0 };
        const keyOf = () => (board.tokens ? board.mask * 65536 + board.scores[board.cur] * 256 + board.scores[1 - board.cur] : board.mask);
        function search(alpha, beta, ply) {
            self.nodes++;
            if (budget.tick()) { self.aborted = true; return 0; }
            const rest = t.T - board.claimed;                        // nobody can gain more than what is left
            if (rest <= alpha) return rest;
            if (-rest >= beta) return -rest;
            const key = keyOf();
            const hit = tt.get(key);
            if (hit !== undefined) {
                if (hit.flag === 0) return hit.v;
                if (hit.flag === 1) { if (hit.v >= beta) return hit.v; if (hit.v > alpha) alpha = hit.v; }
                else { if (hit.v <= alpha) return hit.v; if (hit.v < beta) beta = hit.v; }
                if (alpha >= beta) return hit.v;
            }
            if (!mv[ply]) { mv[ply] = new Int32Array(t.NB); ky[ply] = new Int32Array(t.NB); }
            const moves = mv[ply], keys = ky[ply];
            const n = board.gen(moves, keys);
            if (n === 0) return 0;                                   // the game is over: nothing more to gain
            const a0 = alpha;
            let best = -Infinity;
            for (let i = 0; i < n; i++) {
                const mover = board.cur;
                const g = board.make(pickNext(moves, keys, i, n));
                const v = board.tokens && board.scores[mover] >= board.tokens ? g : g - search(g - beta, g - alpha, ply + 1);
                board.unmake();
                if (self.aborted) return 0;
                if (v > best) best = v;
                if (best > alpha) alpha = best;
                if (alpha >= beta) break;
            }
            tt.set(key, { v: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0 });
            return best;
        }
        /* The same search as a generator near the root, where one subtree can take tens of
           thousands of nodes: it yields the node count after every move, so a long level
           breathes inside the tree too. Positions with GEN_OPEN uncovered edges or fewer
           go back to the plain recursion. Same nodes, same order, same values. */
        function* searchG(alpha, beta, ply) {
            if (openEdges(board) <= GEN_OPEN) return search(alpha, beta, ply);
            self.nodes++;
            if (budget.tick()) { self.aborted = true; return 0; }
            const rest = t.T - board.claimed;
            if (rest <= alpha) return rest;
            if (-rest >= beta) return -rest;
            const key = keyOf();
            const hit = tt.get(key);
            if (hit !== undefined) {
                if (hit.flag === 0) return hit.v;
                if (hit.flag === 1) { if (hit.v >= beta) return hit.v; if (hit.v > alpha) alpha = hit.v; }
                else { if (hit.v <= alpha) return hit.v; if (hit.v < beta) beta = hit.v; }
                if (alpha >= beta) return hit.v;
            }
            if (!mv[ply]) { mv[ply] = new Int32Array(t.NB); ky[ply] = new Int32Array(t.NB); }
            const moves = mv[ply], keys = ky[ply];
            const n = board.gen(moves, keys);
            if (n === 0) return 0;
            const a0 = alpha;
            let best = -Infinity;
            for (let i = 0; i < n; i++) {
                const mover = board.cur;
                const g = board.make(pickNext(moves, keys, i, n));
                const v = board.tokens && board.scores[mover] >= board.tokens ? g : g - (yield* searchG(g - beta, g - alpha, ply + 1));
                board.unmake();
                if (self.aborted) return 0;
                if (v > best) best = v;
                if (best > alpha) alpha = best;
                if (alpha >= beta) break;
                yield self.nodes;
            }
            tt.set(key, { v: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0 });
            return best;
        }
        self.search = search;
        self.searchG = searchG;
        self.mv = mv; self.ky = ky;
        return self;
    }
    const openEdges = (board) => board.t.E - board.covered;
    const exactReady = (board) => board.players === 2 && !board.out[0] && !board.out[1] && openEdges(board) <= EXACT_MAX;

    /* Who wins from here and nothing more: 1 = seat 0, -1 = seat 1, 0 = a tie, null = the
       budget ran out. Null-window probes ("is the mover's margin at least x?") prove the
       sign with far fewer nodes than the full value, and both share one table. The probes
       are asked from the mover's side in the same order whichever seat moves, so a position
       and its seat swap search the same nodes and are proven (or not) together. */
    function exactWinner(board, budget) {
        const s = exactSolver(board, budget);
        const mine = board.scores[board.cur] - board.scores[1 - board.cur];
        const atLeast = (x) => s.search(x - 1, x, 0) >= x;
        const r = atLeast(1 - mine) ? 1 : atLeast(-mine) ? 0 : -1;      // from the mover's view
        return s.aborted ? null : board.cur === 0 || r === 0 ? r : -r;
    }

    /* The exact best root move among `root` (band indices, already in the order to try):
       { k, value } or null when the budget ran out. A generator: it yields the node count
       after every move near the root (searchG) so a long level can breathe. */
    function* exactMove(board, budget, root) {
        const s = exactSolver(board, budget);
        let best = -Infinity, pick = -1;
        for (const k of root) {
            const mover = board.cur;
            const g = board.make(k);
            const v = board.tokens && board.scores[mover] >= board.tokens ? g
                : g - (yield* s.searchG(-Infinity, best === -Infinity ? Infinity : g - best, 1));
            board.unmake();
            if (s.aborted) return null;
            if (v > best) { best = v; pick = k; }
            yield s.nodes;
        }
        return { k: pick, value: best, nodes: s.nodes };
    }

    /* ---------- alpha-beta with iterative deepening ---------- */
    function Searcher(board, me, budget) {
        this.b = board; this.me = me; this.d = budget;
        let live = 0;
        for (let p = 0; p < board.players; p++) if (!board.out[p]) live++;
        this.genDepth = live > 2 ? GEN_DEPTH_PARANOID : GEN_DEPTH;
        this.mv = []; this.ky = [];
        this.aborted = false; this.leaves = 0;
    }
    // a position nothing more can be played in, from my seat's view: a win counts WIN plus the margin
    Searcher.prototype.final = function (winner) {
        const b = this.b, lead = b.scores[this.me] - b.bestOther(this.me);
        return winner < 0 ? 0 : winner === this.me ? WIN + lead : -WIN + lead;
    };
    // a leaf from my seat's view: the lead after the seat to move took its best claim `q`
    Searcher.prototype.leaf = function (q) {
        const b = this.b, p = b.cur, me = this.me;
        if (b.tokens && b.scores[p] + q >= b.tokens) { b.scores[p] += q; const v = this.final(p); b.scores[p] -= q; return v; }
        if (p === me) return b.scores[me] + q - b.bestOther(me);
        let other = b.bestOther(me);
        if (b.scores[p] + q > other) other = b.scores[p] + q;
        return b.scores[me] - other;
    };
    // the value for the side to move (me, or everybody else as one side)
    Searcher.prototype.search = function (depth, alpha, beta, ply) {
        const b = this.b, sign = b.cur === this.me ? 1 : -1;
        if (this.d.tick()) { this.aborted = true; return 0; }
        if (depth <= 0) {
            const q = b.bestClaim();
            if (q < 0) return sign * this.final(b.topSeat());
            this.leaves++;
            return sign * this.leaf(q);
        }
        if (!this.mv[ply]) { this.mv[ply] = new Int32Array(b.t.NB); this.ky[ply] = new Int32Array(b.t.NB); }
        const moves = this.mv[ply], keys = this.ky[ply];
        const n = b.gen(moves, keys);
        if (n === 0) return sign * this.final(b.topSeat());
        let best = -Infinity;
        for (let i = 0; i < n; i++) {
            const v = this.child(pickNext(moves, keys, i, n), depth, alpha, beta, ply, sign);
            if (this.aborted) return 0;
            if (v > best) best = v;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    };
    // play band k, value it for the side that played it, take it back
    Searcher.prototype.child = function (k, depth, alpha, beta, ply, sign) {
        const b = this.b, mover = b.cur;
        b.make(k);
        let v;
        if (b.tokens && b.scores[mover] >= b.tokens) v = sign * this.final(mover);
        else if ((b.cur === this.me ? 1 : -1) === sign) v = this.search(depth - 1, alpha, beta, ply + 1);
        else v = -this.search(depth - 1, -beta, -alpha, ply + 1);
        b.unmake();
        return v;
    };
    /* The same search and child as generators for the nodes near the root, whose subtrees
       can take tens of thousands of nodes: they yield the node count after every move, so
       a long level breathes inside the tree too. A node with less than GEN_DEPTH depth left
       goes back to the plain recursion (the hot path). With 3 or 4 seats in, the two plies
       after my band both belong to the other side, so that depth-2 subtree is a max over a
       max that alpha-beta cannot cut (b² nodes, the whole budget on 6 or 7 pegs): there only
       a depth-1 subtree runs as plain recursion (GEN_DEPTH_PARANOID). Same nodes in the same
       order, so the same moves and values as the plain search. */
    Searcher.prototype.searchG = function* (depth, alpha, beta, ply) {
        if (depth < this.genDepth) return this.search(depth, alpha, beta, ply);
        const b = this.b, sign = b.cur === this.me ? 1 : -1;
        if (this.d.tick()) { this.aborted = true; return 0; }
        if (!this.mv[ply]) { this.mv[ply] = new Int32Array(b.t.NB); this.ky[ply] = new Int32Array(b.t.NB); }
        const moves = this.mv[ply], keys = this.ky[ply];
        const n = b.gen(moves, keys);
        if (n === 0) return sign * this.final(b.topSeat());
        let best = -Infinity;
        for (let i = 0; i < n; i++) {
            const v = yield* this.childG(pickNext(moves, keys, i, n), depth, alpha, beta, ply, sign);
            if (this.aborted) return 0;
            if (v > best) best = v;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
            yield this.d.nodes();
        }
        return best;
    };
    Searcher.prototype.childG = function* (k, depth, alpha, beta, ply, sign) {
        const b = this.b, mover = b.cur;
        b.make(k);
        let v;
        if (b.tokens && b.scores[mover] >= b.tokens) v = sign * this.final(mover);
        else if ((b.cur === this.me ? 1 : -1) === sign) v = yield* this.searchG(depth - 1, alpha, beta, ply + 1);
        else v = -(yield* this.searchG(depth - 1, -beta, -alpha, ply + 1));
        b.unmake();
        return v;
    };
    /* Iterative deepening from the root over `root` (band indices in the order to try),
       as a generator that yields the node count after every move near the root. Returns { k, value,
       depth, proven }: the best move of the last finished depth (or of the unfinished one,
       when its first move, the previous best, was searched to the end). */
    Searcher.prototype.iterate = function* (root) {
        const b = this.b, sign = b.cur === this.me ? 1 : -1;
        const list = root.slice();
        let result = { k: list[0], value: null, depth: 0, proven: false };
        const horizon = Math.min(MAX_DEPTH, openEdges(b));
        for (let depth = 1; depth <= horizon; depth++) {
            this.leaves = 0;
            let best = -Infinity, pick = -1, done = 0;
            for (const k of list) {
                const v = yield* this.childG(k, depth, best, Infinity, 1, sign);
                if (this.aborted) break;
                done++;
                if (v > best) { best = v; pick = k; }
                yield this.d.nodes();
            }
            if (this.aborted) {
                if (done > 0) result = { k: pick, value: sign * best, depth: depth - 1, proven: false };
                break;
            }
            result = { k: pick, value: sign * best, depth, proven: this.leaves === 0 };
            list.splice(list.indexOf(pick), 1);
            list.unshift(pick);
            if (result.proven) break;                                 // every line reached the end of the game
        }
        return result;
    };

    // run a generator to its end: synchronously, or yielding to the page every YIELD_EVERY nodes
    function drive(gen, tools) {
        if (!(tools.budget.nodes >= YIELD_BUDGET)) {
            for (;;) { const s = gen.next(); if (s.done) return s.value; }
        }
        return (async () => {
            let last = 0;
            for (;;) {
                const s = gen.next();
                if (s.done) return s.value;
                if (s.value - last >= YIELD_EVERY) { last = s.value; await tools.yield(); }
            }
        })();
    }

    /* ---------- the bot ---------- */
    function* choose(tools, state) {
        const board = new Board(state);
        const t = board.t;
        const me = board.cur;
        const d = tools.deadline();
        const moves = new Int32Array(t.NB), keys = new Int32Array(t.NB);
        let n = board.gen(moves, keys);
        // seeded tie-break: shuffle, then a stable sort by the ordering key
        const idx = tools.shuffle(Array.from({ length: n }, (_, i) => i));
        const sm = Int32Array.from(idx, (i) => moves[i]), sk = Int32Array.from(idx, (i) => keys[i]);
        order(sm, sk, n);
        let root = Array.from(sm.subarray(0, n));
        const rootKeys = Array.from(sk.subarray(0, n));
        if (n === 1) { tools.report({ method: "forced", depth: 0, value: null, nodes: 0, forced: "only band" }); return t.bMove[root[0]]; }

        // the exact endgame first, on half the level's nodes
        if (exactReady(board)) {
            const half = Math.floor(tools.budget.nodes / 2);
            const cap = { tick: () => d.tick() || d.nodes() >= half };
            const r = yield* exactMove(board, cap, root);
            if (r && r.k >= 0) {
                const lead = board.scores[me] - board.scores[1 - me];
                tools.report({ method: "exact", depth: openEdges(board), value: lead + r.value, nodes: d.nodes(), forced: lead + r.value > 0 ? "proven win" : lead + r.value < 0 ? "proven loss" : "proven tie" });
                return t.bMove[r.k];
            }
            board.load(state);
            yield d.nodes();                                          // breathe between the two searches
        }
        // while a safe band exists nobody needs to hand a triangle over: keep the claims and the safe bands
        if (rootKeys.some((k) => k >= 500)) root = root.filter((_, i) => rootKeys[i] >= 500);
        const s = new Searcher(board, me, d);
        const r = yield* s.iterate(root);
        tools.report({ method: "search", depth: r.depth, value: r.value, nodes: d.nodes(), forced: r.proven ? "searched to the end" : "" });
        return t.bMove[r.k];
    }

    /* The band the seat to move would stretch, from a short search of its own (LINE_NODES):
       the root list in the ordering key's order (stable on the band index, no random tie-break)
       with the root rule of `choose`, then iterative deepening. -1 when no band is left. */
    function predicted(board) {
        const moves = new Int32Array(board.t.NB), keys = new Int32Array(board.t.NB);
        const n = board.gen(moves, keys);
        if (n === 0) return -1;
        order(moves, keys, n);
        let root = Array.from(moves.subarray(0, n));
        const rootKeys = Array.from(keys.subarray(0, n));
        if (rootKeys.some((k) => k >= 500)) root = root.filter((_, i) => rootKeys[i] >= 500);
        if (root.length === 1) return root[0];
        const gen = new Searcher(board, board.cur, capped(LINE_NODES)).iterate(root);
        for (;;) { const s = gen.next(); if (s.done) return s.value.k; }
    }
    // seat 0's lead over the best other seat still in
    const leadOf = (board) => board.scores[0] - board.bestOther(0);

    /* Win chance from seat 0's point of view: ±Infinity when the scores decide it (nobody can
       catch up with the triangles left), when the endgame search proves it, or when the seat
       to move reaches its token number with its next band; otherwise the lead **smoothed along
       the predicted line**, `(lead now + 2 × lead after the mover's band + lead after the
       reply) / 4`, measured against the triangles still open: `/ (triangles left + 1)`.

       Why (measured, see the README): once the safe bands run out the game is a trade, every
       band claiming what the last one handed over, so the lead itself zigzags move after move.
       Half of the mover's biggest claim (the first version) fixed the one-triangle trade but
       overshot whenever the biggest claim was not the band actually played (it often hands
       more back), and the bar still flipped by 30 points per move. The lead after the band the
       mover will really stretch, from a short search, averages the zigzag out; the 1 : 2 : 1
       weights over two plies take the rest. Out of sample it beat the plain lead and the half
       claim on the calibration series and on most of 26 seeded series, with about half the
       move-to-move change and a fraction of the flips. Nothing else: no term for who has to
       open first.

       Own node caps for every part (EVAL_NODES for the proof, LINE_NODES per predicted band),
       whatever the caller's budget, so the bar never changes between the HUD's stages.
       Symmetric by construction: the search sees the same bands in the same order from the
       mover's side whichever seat that is, so swapping the seats (and the turn) negates the
       score. */
    function evaluate(state) {
        if (state.over) return state.winner < 0 ? 0 : state.winner === 0 ? Infinity : -Infinity;
        if (state.out && state.out[0]) return -Infinity;
        let other = -1;
        for (let p = 1; p < state.players; p++) if (!(state.out && state.out[p]) && state.scores[p] > other) other = state.scores[p];
        const s0 = state.scores[0];
        let left = 0;
        for (const o of state.tris) if (o === -1) left++;
        if (s0 > other + left) return Infinity;
        if (s0 + left < other) return -Infinity;
        const board = new Board(state);
        if (exactReady(board)) {
            const r = exactWinner(board, capped(EVAL_NODES));
            if (r !== null) return r > 0 ? Infinity : r < 0 ? -Infinity : 0;
            board.load(state);
        }
        const leads = [leadOf(board)];
        for (let ply = 0; ply < 2; ply++) {
            const k = predicted(board);
            if (k < 0) break;                                           // nothing more to stretch
            const mover = board.cur;
            board.make(k);
            if (board.tokens && board.scores[mover] >= board.tokens) {
                if (ply === 0) return mover === 0 ? Infinity : -Infinity;   // a token win with the next band
                leads.push(leadOf(board));
                break;
            }
            leads.push(leadOf(board));
        }
        while (leads.length < 3) leads.push(leads[leads.length - 1]);
        return (leads[0] + 2 * leads[1] + leads[2]) / 4 / (left + 1);
    }

    Bots.register({
        id: "weaver-triangles",
        name: "Weaver",
        game: "triangles",
        version: 2,
        description: "Stretches its bands where they claim the most and hand over the least, counts what is on the table and solves the endgame exactly. Very hard searches deep.",
        difficulties: [
            { id: "easy", label: "Easy", nodes: 2000 },
            { id: "normal", label: "Normal", nodes: 10000 },
            { id: "hard", label: "Hard", nodes: 30000 },
            { id: "insane", label: "Very hard", nodes: 100000 },
        ],
        create(tools) {
            return { move: (state) => drive(choose(tools, state), tools) };
        },
        evaluate,
        internals: { Board, Searcher, tablesFor, exactSolver, exactWinner, exactMove, exactReady, capped, order, pickNext, drive, predicted, EXACT_MAX, EVAL_NODES, LINE_NODES, WIN },
    });
})();
