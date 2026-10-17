/* Triangles solver: exhaustive and exact, written independently of the rules module and of
   the bot, so the puzzle set is not "what the bot thinks". It keeps its own compact board
   (typed arrays, make / unmake) and never edits a rules state: the rules memoise their
   legal bands per state object. tests/puzzles/triangles/solver.test.mjs proves the board
   equal to TrianglesRules through Rules.step on seeded games.

   Without a token limit the rest of the game depends on the covered edges alone: a closed
   triangle is always claimed at once, a peg counts as touched exactly when it touches a
   covered edge, and claiming gives no extra turn. So the value of a position is "triangles
   for the side to move minus triangles for the other one from here on", and one
   transposition entry per covered-edge set is exact. With a token limit it is not (the
   race to the limit depends on the scores), so the solver refuses a state with `tokens > 0`.

   Two engines:
     solveExhaustive(board)  alpha-beta negamax with a transposition table keyed on the
                             edges covered since the root, claims first, then bands that
                             hand nothing over. Returns the game-theoretic value, every
                             optimal band and the exact value of every legal band.
     solveBrute(board)       the same value with no table, no pruning and no ordering. Only
                             for tiny positions: the solver test uses it (and a second
                             oracle that plays through the rules) to prove the fast one.

   Everything here is deterministic: no randomness, ties broken by band number. */

/* ---------- geometry (the numbering of client/games/triangles-rules.js) ---------- */
const DIRS = [[1, 0], [0, 1], [-1, 1]];
const GEO = new Map();
export function geometry(n) {
    let g = GEO.get(n);
    if (g) return g;
    const m = n - 1;
    const inside = (q, r) => Math.abs(q) <= m && Math.abs(r) <= m && Math.abs(q + r) <= m;
    const pegs = [], at = new Map();
    for (let r = -m; r <= m; r++) {
        for (let q = Math.max(-m, -m - r); q <= Math.min(m, m - r); q++) { at.set(`${q},${r}`, pegs.length); pegs.push({ q, r }); }
    }
    const V = pegs.length;
    const pegAt = (q, r) => (inside(q, r) ? at.get(`${q},${r}`) : -1);
    const step = (p, d) => pegAt(pegs[p].q + DIRS[d][0], pegs[p].r + DIRS[d][1]);
    const edgeA = [], edgeB = [], edgeKey = new Map();
    for (let p = 0; p < V; p++) {
        for (let d = 0; d < 3; d++) {
            const b = step(p, d);
            if (b < 0) continue;
            edgeKey.set(p * V + b, edgeA.length);
            edgeA.push(p); edgeB.push(b);
        }
    }
    const E = edgeA.length;
    const edgeAt = (a, b) => { const e = edgeKey.get(Math.min(a, b) * V + Math.max(a, b)); return e === undefined ? -1 : e; };
    const triEdges = [], edgeTris = Array.from({ length: E }, () => []);
    const addTri = (x, y, z) => {
        const t = triEdges.length / 3;
        for (const e of [edgeAt(x, y), edgeAt(x, z), edgeAt(y, z)]) { triEdges.push(e); edgeTris[e].push(t); }
    };
    for (let p = 0; p < V; p++) {
        const a0 = step(p, 0), a1 = step(p, 1), a2 = step(p, 2);
        if (a0 >= 0 && a1 >= 0) addTri(p, a0, a1);
        if (a1 >= 0 && a2 >= 0) addTri(p, a1, a2);
    }
    const T = triEdges.length / 3;
    // every band of 1 to 3 unit edges: walk each lattice line from its first peg
    const bands = [[], [], [], []];
    for (let p = 0; p < V; p++) {
        for (let d = 0; d < 3; d++) {
            if (pegAt(pegs[p].q - DIRS[d][0], pegs[p].r - DIRS[d][1]) >= 0) continue;
            const line = [p];
            for (let x = step(p, d); x >= 0; x = step(x, d)) line.push(x);
            for (let i = 0; i < line.length; i++) {
                for (let len = 1; len <= 3 && i + len < line.length; len++) {
                    const ps = line.slice(i, i + len + 1);
                    const es = [];
                    for (let k = 0; k < len; k++) es.push(edgeAt(ps[k], ps[k + 1]));
                    const a = Math.min(ps[0], ps[len]), b = Math.max(ps[0], ps[len]);
                    bands[len].push({ move: a * V + b, a, b, len, pegs: ps, edges: es });
                }
            }
        }
    }
    for (const list of bands) list.sort((x, y) => x.move - y.move);
    g = { n, m, V, E, T, pegs, pegAt, edgeA, edgeB, edgeAt, triEdges, edgeTris, bands };
    GEO.set(n, g);
    return g;
}

/* ---------- the 12 symmetries of the hexagon, as edge permutations ---------- */
const PEG_MAPS = [];
for (let k = 0; k < 6; k++) {
    for (const flip of [false, true]) {
        PEG_MAPS.push((q, r) => {
            if (flip) [q, r] = [r, q];                              // a mirror line through the centre
            for (let i = 0; i < k; i++) [q, r] = [-r, q + r];       // 60 degrees each
            return [q, r];
        });
    }
}
const SYM = new Map();
export function symmetries(n) {
    let s = SYM.get(n);
    if (s) return s;
    const g = geometry(n);
    s = PEG_MAPS.map((f) => {
        const map = new Int32Array(g.E);
        for (let e = 0; e < g.E; e++) {
            const [qa, ra] = f(g.pegs[g.edgeA[e]].q, g.pegs[g.edgeA[e]].r);
            const [qb, rb] = f(g.pegs[g.edgeB[e]].q, g.pegs[g.edgeB[e]].r);
            map[e] = g.edgeAt(g.pegAt(qa, ra), g.pegAt(qb, rb));
        }
        return map;
    });
    SYM.set(n, s);
    return s;
}
// a position's fingerprint under the 12 symmetries (covered edges only; the caller appends
// the score difference)
export function canonical(covered, n) {
    let best = null;
    for (const map of symmetries(n)) {
        const bits = new Uint8Array(map.length);
        for (let e = 0; e < map.length; e++) if (covered[e]) bits[map[e]] = 1;
        const s = bits.join("");
        if (best === null || s < best) best = s;
    }
    return best;
}

/* ---------- the board ---------- */
export function Board(n, { band = 3, touch = false } = {}) {
    const g = geometry(n);
    this.g = g; this.n = n; this.band = band; this.touch = touch;
    this.covered = new Uint8Array(g.E);
    this.sides = new Uint8Array(g.T);
    this.deg = new Uint8Array(g.V);                // covered edges at every peg (> 0 = touched)
    this.count = 0;                                // covered edges
    this.mine = 0;                                 // triangles the side to move already has
    this.theirs = 0;
    this.stack = new Int32Array(g.E);              // edges in the order make covered them
    this.sp = 0;
    this.marks = [];                               // stack height before every make
    this.all = [];
    for (let len = 1; len <= 3; len++) if (band === 0 || band === len) this.all.push(...g.bands[len]);
    this.all.sort((x, y) => x.move - y.move);
}
// from a rules state (TrianglesRules, two players, no token limit): the covered edges and the
// scores from the mover's view
Board.fromState = function (state) {
    if (state.tokens > 0) throw new Error("solver: the covered edges decide the value only without a token limit (tokens: 0)");
    if (state.players !== 2) throw new Error("solver: two players only");
    const b = new Board(state.n, { band: state.band, touch: state.touch });
    for (let e = 0; e < b.g.E; e++) if (state.cells[e] !== -1) b.cover(e);
    b.sp = 0;
    b.mine = state.scores[state.current];
    b.theirs = state.scores[1 - state.current];
    return b;
};
// cover one edge, return the triangles it closes
Board.prototype.cover = function (e) {
    const g = this.g;
    this.covered[e] = 1; this.count++;
    this.deg[g.edgeA[e]]++; this.deg[g.edgeB[e]]++;
    this.stack[this.sp++] = e;
    let k = 0;
    for (const t of g.edgeTris[e]) if (++this.sides[t] === 3) k++;
    return k;
};
Board.prototype.isLegal = function (band) {
    let open = false;
    for (const e of band.edges) if (!this.covered[e]) { open = true; break; }
    if (!open) return false;
    if (!this.touch || this.count === 0) return true;
    for (const p of band.pegs) if (this.deg[p] > 0) return true;
    return false;
};
Board.prototype.legal = function (from = this.all) {
    return from.filter((band) => this.isLegal(band));
};
// what a band would claim now (triangles at two sides) and hand over (at one side)
Board.prototype.claims = function (band) {
    let k = 0;
    for (const e of band.edges) if (!this.covered[e]) for (const t of this.g.edgeTris[e]) if (this.sides[t] === 2) k++;
    return k;
};
Board.prototype.opens = function (band) {
    let k = 0;
    for (const e of band.edges) if (!this.covered[e]) for (const t of this.g.edgeTris[e]) if (this.sides[t] === 1) k++;
    return k;
};
// the move: covers the band's open edges, returns the triangles claimed
Board.prototype.make = function (band) {
    this.marks.push(this.sp);
    let k = 0;
    for (const e of band.edges) if (!this.covered[e]) k += this.cover(e);
    return k;
};
Board.prototype.unmake = function () {
    const g = this.g, to = this.marks.pop();
    while (this.sp > to) {
        const e = this.stack[--this.sp];
        this.covered[e] = 0; this.count--;
        this.deg[g.edgeA[e]]--; this.deg[g.edgeB[e]]--;
        for (const t of g.edgeTris[e]) this.sides[t]--;
    }
};
// take back every make above the given stack height
Board.prototype.rewind = function (height) {
    while (this.marks.length > height) this.unmake();
};
Board.prototype.onTable = function () {
    let k = 0;
    for (let t = 0; t < this.g.T; t++) if (this.sides[t] === 2) k++;
    return k;
};

/* ---------- exhaustive alpha-beta ---------- */
class Budget extends Error {}
const EXACT = 0, LOWER = 1, UPPER = 2;
// the key: the root's uncovered edges as bits, up to 52 of them in one exact double
function keyer(board, rootOpen) {
    const K = rootOpen.length;
    if (K > 52) throw new Error(`solver: ${K} uncovered edges is beyond the 52-bit key`);
    const bit = new Int32Array(board.g.E).fill(-1);
    rootOpen.forEach((e, k) => { bit[e] = k; });
    return () => {
        let lo = 0, hi = 0;
        for (const e of rootOpen) {
            if (!board.covered[e]) continue;
            const k = bit[e];
            if (k < 30) lo |= 1 << k; else hi |= 1 << (k - 30);
        }
        return hi * 1073741824 + lo;
    };
}
function searcher(board, maxNodes) {
    const rootOpen = [];
    for (let e = 0; e < board.g.E; e++) if (!board.covered[e]) rootOpen.push(e);
    const key = keyer(board, rootOpen);
    const candidates = board.legal().length ? board.all.filter((b) => b.edges.some((e) => !board.covered[e])) : [];
    const tt = new Map();
    const self = { nodes: 0, tt };

    // the rest of the game for the side to move, between alpha and beta
    function search(alpha, beta) {
        if (++self.nodes > maxNodes) throw new Budget();
        const k = key();
        const hit = tt.get(k);
        if (hit !== undefined) {
            const v = (hit >> 2) - 512, flag = hit & 3;
            if (flag === EXACT) return v;
            if (flag === LOWER) { if (v >= beta) return v; if (v > alpha) alpha = v; }
            else { if (v <= alpha) return v; if (v < beta) beta = v; }
            if (alpha >= beta) return v;
        }
        const moves = board.legal(candidates);
        if (moves.length === 0) return 0;
        // claims first (most first), then the bands that hand over the least
        const order = moves.map((b, i) => ({ b, i, c: board.claims(b), o: board.opens(b) }));
        order.sort((x, y) => (y.c - x.c) || (x.o - y.o) || (x.i - y.i));
        const a0 = alpha;
        let best = -Infinity;
        for (const { b } of order) {
            const c = board.make(b);
            const v = c - search(c - beta, c - alpha);
            board.unmake();
            if (v > best) best = v;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        tt.set(k, ((best + 512) << 2) | (best <= a0 ? UPPER : best >= beta ? LOWER : EXACT));
        return best;
    }
    self.search = search;
    return self;
}

// the most plies the rest of the game can last (memoised on the covered set, no pruning)
export function longest(board, { maxNodes = 5_000_000 } = {}) {
    const rootOpen = [];
    for (let e = 0; e < board.g.E; e++) if (!board.covered[e]) rootOpen.push(e);
    const key = keyer(board, rootOpen);
    const candidates = board.all.filter((b) => b.edges.some((e) => !board.covered[e]));
    const memo = new Map(), base = board.marks.length;
    let nodes = 0;
    function rec() {
        const k = key();
        const hit = memo.get(k);
        if (hit !== undefined) return hit;
        if (++nodes > maxNodes) throw new Budget();
        let best = 0;
        for (const b of board.legal(candidates)) { board.make(b); best = Math.max(best, 1 + rec()); board.unmake(); }
        memo.set(k, best);
        return best;
    }
    try { return rec(); } catch (err) { board.rewind(base); if (err instanceof Budget) return null; throw err; }
}

const classify = (diff) => (diff > 0 ? "win" : diff < 0 ? "loss" : "draw");

/* The game-theoretic result of a position, plus the exact value of every legal band.
   { value, net, diff, best, moveValues, nodes } - `net` is the best reachable (mover's
   triangles - the other side's) from here on, `diff` adds the triangles already won (the
   final score difference with best play), `moveValues` maps every legal band to its net,
   and `best` lists the bands that reach `net`, sorted. `value: "unknown"` when the node
   budget ran out. */
export function solveExhaustive(board, { maxNodes = 20_000_000 } = {}) {
    const moves = board.legal();
    const done = board.mine - board.theirs;
    if (moves.length === 0) return { value: classify(done), net: 0, diff: done, best: [], moveValues: {}, nodes: 0 };
    const s = searcher(board, maxNodes), base = board.marks.length;
    const moveValues = {};
    let net = -Infinity;
    try {
        for (const b of moves) {
            const c = board.make(b);
            const v = c - s.search(-Infinity, Infinity);
            board.unmake();
            moveValues[b.move] = v;
            if (v > net) net = v;
        }
    } catch (err) {
        board.rewind(base);                                 // the budget ran out halfway down a line
        if (err instanceof Budget) return { value: "unknown", net: null, diff: null, best: [], moveValues: {}, nodes: s.nodes };
        throw err;
    }
    const best = moves.filter((b) => moveValues[b.move] === net).map((b) => b.move).sort((x, y) => x - y);
    return { value: classify(done + net), net, diff: done + net, best, moveValues, nodes: s.nodes };
}

/* The same value with nothing but the board: no table, no pruning, no ordering. Only for
   tiny positions; the solver test uses it to prove the fast engine. */
export function solveBrute(board) {
    function rec() {
        let best = -Infinity;
        for (const b of board.legal()) {
            const c = board.make(b);
            const v = c - rec();
            board.unmake();
            if (v > best) best = v;
        }
        return best === -Infinity ? 0 : best;
    }
    const moveValues = {};
    let net = -Infinity;
    for (const b of board.legal()) {
        const c = board.make(b);
        moveValues[b.move] = c - rec();
        board.unmake();
        if (moveValues[b.move] > net) net = moveValues[b.move];
    }
    if (net === -Infinity) net = 0;
    const best = Object.keys(moveValues).map(Number).filter((mv) => moveValues[mv] === net).sort((x, y) => x - y);
    return { net, best, moveValues, value: classify(board.mine - board.theirs + net) };
}
