/* Dots and Boxes (dots and boxes) solver — exhaustive and exact, written independently of
   the bot so the puzzle sets are not "what the bot thinks".

   A position is fully described by the set of undrawn lines plus the boxes already won.
   Because closing a box keeps the mover on turn, the value of the remaining game is
   "boxes for whoever moves next minus boxes for the other one" and depends on the undrawn
   lines alone — not on who is to move. That makes one transposition entry per subset of
   lines correct, and it is what makes exhausting boards of up to ~30 undrawn lines cheap.

   Two engines:
     solveExhaustive(board)  alpha-beta negamax with a transposition table and one exact
                             reduction (a *free* capture is forced, see below). Returns the
                             game-theoretic value, every optimal move and the exact value of
                             every legal move.
     solveBrute(board)       the same value with no reductions, no table, no pruning. Far
                             too slow for anything but a handful of lines; the solver test
                             uses it to prove the reduction and the table are sound.

   The one reduction: a capture is **free** when the line closes a box and leaves no other
   open box with three sides behind (the neighbour is missing, already closed, or closed by
   the same line, or it still has at most one side). Taking such a box is always at least as
   good as anything else: the mover keeps the turn either way, so leaving it costs the tempo
   nothing and gives the box away. Captures that *do* open the next box are never forced —
   that is exactly the "all but two" decision, and the search branches on it.

   Everything here is deterministic: no randomness, ties broken by line number. */

/* ---------- line numbering (identical to client/games/boxes-rules.js) ---------- */
const CACHE = new Map();
export function tables(n) {
    let t = CACHE.get(n);
    if (t) return t;
    const H = n * (n + 1), E = 2 * H, B = n * n;
    const boxEdges = [];
    const edgeBoxes = Array.from({ length: E }, () => []);
    for (let b = 0; b < B; b++) {
        const r = (b / n) | 0, c = b % n;
        const es = [r * n + c, (r + 1) * n + c, H + r * (n + 1) + c, H + r * (n + 1) + c + 1];
        boxEdges.push(es);
        for (const e of es) edgeBoxes[e].push(b);
    }
    t = { n, H, E, B, boxEdges, edgeBoxes };
    CACHE.set(n, t);
    return t;
}
// the two dots a line connects, as [row, col] pairs
export function dotsOf(n, e) {
    const H = n * (n + 1);
    if (e < H) { const r = (e / n) | 0, c = e % n; return [[r, c], [r, c + 1]]; }
    const j = e - H, r = (j / (n + 1)) | 0, c = j % (n + 1);
    return [[r, c], [r + 1, c]];
}
export function edgeOf(n, [r1, c1], [r2, c2]) {
    const H = n * (n + 1);
    if (r1 === r2) return r1 * n + Math.min(c1, c2);
    return H + Math.min(r1, r2) * (n + 1) + c1;
}

/* ---------- the 8 symmetries of the square, as line permutations ---------- */
const DOT_MAPS = [
    (r, c, n) => [r, c],
    (r, c, n) => [c, n - r],
    (r, c, n) => [n - r, n - c],
    (r, c, n) => [n - c, r],
    (r, c, n) => [r, n - c],
    (r, c, n) => [n - r, c],
    (r, c, n) => [c, r],
    (r, c, n) => [n - c, n - r],
];
const SYM = new Map();
export function symmetries(n) {
    let s = SYM.get(n);
    if (s) return s;
    const t = tables(n);
    s = DOT_MAPS.map((f) => {
        const map = new Int32Array(t.E);
        for (let e = 0; e < t.E; e++) {
            const [a, b] = dotsOf(n, e);
            map[e] = edgeOf(n, f(a[0], a[1], n), f(b[0], b[1], n));
        }
        return map;
    });
    SYM.set(n, s);
    return s;
}
// a position's fingerprint under the 8 symmetries (drawn lines only; the caller appends
// the scores and the side to move)
export function canonical(drawn, n) {
    let best = null;
    for (const map of symmetries(n)) {
        let s = "";
        for (let e = 0; e < map.length; e++) s += drawn[map[e]] ? "1" : "0";
        if (best === null || s < best) best = s;
    }
    return best;
}

/* ---------- the board ---------- */
export function Board(n) {
    const t = tables(n);
    this.t = t; this.n = n; this.E = t.E; this.B = t.B;
    this.drawn = new Uint8Array(t.E);
    this.sides = new Uint8Array(t.B);
    this.left = t.E;
    this.mine = 0;                       // boxes the side to move already has
    this.theirs = 0;
}
// from a rules state (BoxesRules): the position and the scores from the mover's view
Board.fromState = function (state) {
    const b = new Board(state.n);
    for (let e = 0; e < b.E; e++) if (state.cells[e] !== -1) { b.drawn[e] = 1; b.left--; }
    for (let x = 0; x < b.B; x++) {
        let k = 0;
        for (const e of b.t.boxEdges[x]) if (b.drawn[e]) k++;
        b.sides[x] = k;
    }
    b.mine = state.scores[state.current];
    b.theirs = state.scores.reduce((a, v, p) => a + (p === state.current ? 0 : v), 0);
    return b;
};
Board.prototype.free = function () {
    const out = [];
    for (let e = 0; e < this.E; e++) if (!this.drawn[e]) out.push(e);
    return out;
};
Board.prototype.captures = function (e) {
    let g = 0;
    for (const b of this.t.edgeBoxes[e]) if (this.sides[b] === 3) g++;
    return g;
};
Board.prototype.isFreeCapture = function (e) {
    let cap = 0, gift = 0;
    for (const b of this.t.edgeBoxes[e]) { if (this.sides[b] === 3) cap++; else if (this.sides[b] === 2) gift++; }
    return cap > 0 && gift === 0;
};
Board.prototype.isSafe = function (e) {
    for (const b of this.t.edgeBoxes[e]) if (this.sides[b] === 2) return false;
    return true;
};
Board.prototype.make = function (e) {
    this.drawn[e] = 1; this.left--;
    let g = 0;
    for (const b of this.t.edgeBoxes[e]) if (++this.sides[b] === 4) g++;
    return g;
};
Board.prototype.unmake = function (e) {
    this.drawn[e] = 0; this.left++;
    for (const b of this.t.edgeBoxes[e]) this.sides[b]--;
};

/* ---------- exhaustive alpha-beta ---------- */
class Budget extends Error {}
function searcher(board, rootFree, maxNodes) {
    const K = rootFree.length;
    if (K > 30) throw new Error(`solver: ${K} undrawn lines is beyond the 30-line mask`);
    const bit = new Int32Array(board.E).fill(-1);
    rootFree.forEach((e, k) => { bit[e] = k; });
    const tt = new Map();
    const self = { nodes: 0, mask: 0 };

    function search(alpha, beta) {
        if (board.left === 0) return 0;
        if (++self.nodes > maxNodes) throw new Budget();
        const hit = tt.get(self.mask);
        if (hit !== undefined) {
            if (hit.flag === 0) return hit.v;
            if (hit.flag === 1) { if (hit.v >= beta) return hit.v; if (hit.v > alpha) alpha = hit.v; }
            else { if (hit.v <= alpha) return hit.v; if (hit.v < beta) beta = hit.v; }
            if (alpha >= beta) return hit.v;
        }
        const a0 = alpha;
        let best = -Infinity;
        let forced = -1;
        for (const e of rootFree) if (!board.drawn[e] && board.isFreeCapture(e)) { forced = e; break; }
        if (forced >= 0) {
            const g = board.make(forced); self.mask |= 1 << bit[forced];
            best = g + search(alpha - g, beta - g);
            self.mask &= ~(1 << bit[forced]); board.unmake(forced);
        } else {
            outer:
            for (let pass = 0; pass < 2; pass++) {
                for (const e of rootFree) {
                    if (board.drawn[e]) continue;
                    const cap = board.captures(e);
                    if ((pass === 0) !== (cap > 0)) continue;              // captures first
                    const g = board.make(e); self.mask |= 1 << bit[e];
                    const v = g > 0 ? g + search(alpha - g, beta - g) : -search(-beta, -alpha);
                    self.mask &= ~(1 << bit[e]); board.unmake(e);
                    if (v > best) best = v;
                    if (best > alpha) alpha = best;
                    if (alpha >= beta) break outer;
                }
            }
        }
        tt.set(self.mask, { v: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0 });
        return best;
    }
    self.search = search;
    self.bit = bit;
    return self;
}

const classify = (finalDiff) => (finalDiff > 0 ? "win" : finalDiff < 0 ? "loss" : "draw");

/* The game-theoretic result of a position, plus the exact value of every legal line.
   { value, net, best, moveValues, depth, method, nodes } — `net` is the best reachable
   (mover's boxes - the other side's) counting only the boxes still open, `moveValues` maps
   every legal line to the final box difference for the mover, and `best` lists the lines
   that reach `net`. `value: "unknown"` when the node budget ran out. */
export function solveExhaustive(board, { maxNodes = 20_000_000 } = {}) {
    const rootFree = board.free();
    if (rootFree.length === 0) return { value: classify(board.mine - board.theirs), net: 0, best: [], moveValues: {}, depth: 0, method: "exhaustive", nodes: 0 };
    const s = searcher(board, rootFree, maxNodes);
    const moveValues = {};
    let net = -Infinity;
    try {
        for (const e of rootFree) {
            const g = board.make(e); s.mask |= 1 << s.bit[e];
            const v = g > 0 ? g + s.search(-Infinity, Infinity) : -s.search(-Infinity, Infinity);
            s.mask &= ~(1 << s.bit[e]); board.unmake(e);
            moveValues[e] = v;
            if (v > net) net = v;
        }
    } catch (err) {
        if (err instanceof Budget) return { value: "unknown", net: null, best: [], moveValues: {}, depth: rootFree.length, method: "exhaustive", nodes: s.nodes };
        throw err;
    }
    const best = rootFree.filter((e) => moveValues[e] === net);
    const diff = board.mine - board.theirs + net;
    return { value: classify(diff), net, diff, best, moveValues, depth: rootFree.length, method: "exhaustive", nodes: s.nodes };
}

/* The same value with nothing but the rules: no transposition table, no pruning, no forced
   captures. Only for tiny positions — the solver test uses it to prove the fast engine. */
export function solveBrute(board) {
    function rec() {
        if (board.left === 0) return 0;
        let best = -Infinity;
        for (let e = 0; e < board.E; e++) {
            if (board.drawn[e]) continue;
            const g = board.make(e);
            const v = g > 0 ? g + rec() : -rec();
            board.unmake(e);
            if (v > best) best = v;
        }
        return best;
    }
    const moveValues = {};
    let net = -Infinity;
    for (let e = 0; e < board.E; e++) {
        if (board.drawn[e]) continue;
        const g = board.make(e);
        const v = g > 0 ? g + rec() : -rec();
        board.unmake(e);
        moveValues[e] = v;
        if (v > net) net = v;
    }
    const best = Object.keys(moveValues).map(Number).filter((e) => moveValues[e] === net).sort((a, b) => a - b);
    return { net, best, moveValues, value: classify(board.mine - board.theirs + net) };
}
