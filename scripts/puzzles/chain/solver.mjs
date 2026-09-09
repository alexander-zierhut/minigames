/* Chain React solver: proven results only.

   solve(state, options) looks at the position from the point of view of state.current and
   returns { value: "win" | "loss", best: [cell ids], depth, exhaustive, nodes, losesNow }
   or null when nothing could be PROVEN within the search depth / node budget. It never
   guesses.

   Definitions (these are what the puzzle files mean by "perfect move"):
   - value "win":  the mover has a forced win. `depth` = plies of the FASTEST forced win
                   (1 = the move ends the game now, 3 = "win in 2", 5 = "win in 3", …).
                   `best` = every move that forces the win in exactly `depth` plies.
   - value "loss": every move loses by force. `depth` = plies the mover can hold out with
                   best defence. `best` = every move that survives that long.
   Slower wins are not "best": grading a bot against the fastest forced win is stricter but
   well-defined and, unlike "any winning move", provable with a depth-limited search.

   Why the proof is sound
   ----------------------
   Two facts about the rules make this simple:
   1. A move adds exactly one piece and explosions only move pieces around (a cell loses
      `cap` pieces and hands one to each of its `cap` neighbours). So the total number of
      pieces grows by one per move and a position can never repeat: the game is a finite
      DAG, a transposition table keyed by the cells alone is sound (no path dependence),
      and a game can't cycle. It is also short: a settled board holds at most
      sum(cap - 1) pieces (3×3: 15, 4×4: 32, 5×5: 55, 6×6: 84), so that many moves is a
      hard upper bound on the game length.
   2. After a move the mover always owns at least one cell, so the only terminal
      position is "opponent owns no cell (and has already moved)". With the chain rule off
      there is no other way to end the game and there are no draws.

   The search is negamax with alpha-beta and mate-distance scores:
   +MATE - ply for a win at that ply, -(MATE - ply) for a loss, and 0 for "not resolved
   within the horizon". A node can only get a non-zero score if EVERY line below it inside
   the horizon ends in a terminal position (a single unresolved leaf scores 0, which is
   better than any loss and worse than any win, so it stops a proof from propagating).
   Therefore a non-zero root score is a proof, and because the horizon-limited game is
   solved exactly, the distance is the true fastest win / longest defence. With
   depth = Infinity every leaf is terminal ("exhaustive"). Transposition entries with a
   mate score are valid at any depth (a win in k plies stays a win in k plies, "no win in
   fewer than k plies within the horizon" stays true for larger horizons because the
   faster win would have been inside the horizon); entries scoring 0 are only reused for
   searches of at most the same depth.

   If the node budget runs out or the root scores 0 the result is null: the position is
   unresolved, not "probably fine". Puzzle generation only keeps non-null results.

   The rules are re-implemented here on typed arrays for speed; solver.test.mjs checks
   them against the real ChainRules module on thousands of random positions. */

export const MATE = 1_000_000;
const MATE_MIN = MATE - 10_000;        // anything beyond this is a mate-distance score
const INF = MATE + 1;
const EXACT = 0, LOWER = 1, UPPER = 2;

class BudgetExceeded extends Error {}

// orthogonal neighbours of every cell (also the cell's capacity)
const NEIGH = new Map();
export function neighbours(n) {
    if (!NEIGH.has(n)) {
        const out = [];
        for (let i = 0; i < n * n; i++) {
            const x = i % n, y = Math.floor(i / n), a = [];
            if (x > 0) a.push(i - 1);
            if (x < n - 1) a.push(i + 1);
            if (y > 0) a.push(i - n);
            if (y < n - 1) a.push(i + n);
            out.push(a);
        }
        NEIGH.set(n, out);
    }
    return NEIGH.get(n);
}

/* ---------- compact position ----------
   cnt[i] pieces, own[i] owner (-1, 0, 1), mover = player to move, moved = bit mask of
   players who have made their first move (only matters in the first two plies). */
export function fromState(state) {
    if (state.chainRule) throw new Error("solver: the chain rule is not supported");
    if (state.players !== undefined && state.players !== 2) throw new Error("solver: two players only");
    const n = state.n, cells = state.cells;
    const cnt = new Int8Array(n * n), own = new Int8Array(n * n);
    for (let i = 0; i < n * n; i++) { cnt[i] = cells[i].count; own[i] = cells[i].owner; }
    const moved = (state.movesBy[0] > 0 ? 1 : 0) | (state.movesBy[1] > 0 ? 2 : 0);
    return { n, cnt, own, mover: state.current, moved, over: !!state.over };
}

export function legalMoves(pos) {
    const out = [];
    for (let i = 0; i < pos.cnt.length; i++) if (pos.own[i] === -1 || pos.own[i] === pos.mover) out.push(i);
    return out;
}

// play `i` for pos.mover on a copy: place, settle all waves, decide. Returns the new
// position with `over` set when the mover took the whole board (the only way to end).
export function apply(pos, i) {
    const n = pos.n, N = n * n, nb = neighbours(n), me = pos.mover, opp = 1 - me;
    const cnt = pos.cnt.slice(), own = pos.own.slice();
    own[i] = me; cnt[i]++;
    const moved = pos.moved | (1 << me);
    const bothMoved = moved === 3;
    let oppCells = 0;
    for (let k = 0; k < N; k++) if (own[k] === opp) oppCells++;
    // waves: every full cell explodes together, then all landings apply (ChainRules.settle)
    for (;;) {
        if (bothMoved && oppCells === 0) break;           // boardDecided: the chain would loop forever
        let ready = null;
        for (let k = 0; k < N; k++) if (cnt[k] >= nb[k].length) (ready || (ready = [])).push(k);
        if (!ready) break;
        for (const k of ready) { cnt[k] -= nb[k].length; if (cnt[k] === 0) own[k] = -1; }
        for (const k of ready) for (const to of nb[k]) { if (own[to] === opp) oppCells--; own[to] = me; cnt[to]++; }
    }
    const over = bothMoved && oppCells === 0;
    return { n, cnt, own, mover: opp, moved, over, winner: over ? me : -1 };
}

// transposition key: the cells decide everything (see the DAG argument above); the mover
// and the "has moved" flags are appended for the first two plies where they matter.
function keyOf(pos) {
    const N = pos.cnt.length, a = new Uint8Array(N + 1);
    for (let i = 0; i < N; i++) a[i] = pos.cnt[i] === 0 ? 32 : 40 + pos.own[i] * 8 + pos.cnt[i];
    a[N] = 64 + pos.mover + pos.moved * 2;
    return String.fromCharCode.apply(null, a);
}

/* ---------- search ---------- */
function makeSearch(budget) {
    const tt = new Map();
    let nodes = 0;
    const isMate = (s) => s > MATE_MIN || s < -MATE_MIN;
    const toTT = (s, ply) => (s > MATE_MIN ? s + ply : s < -MATE_MIN ? s - ply : s);
    const fromTT = (s, ply) => (s > MATE_MIN ? s - ply : s < -MATE_MIN ? s + ply : s);

    // score for pos.mover, root-relative mate distances; `depth` = remaining plies
    function search(pos, depth, ply, alpha, beta) {
        if (++nodes > budget) throw new BudgetExceeded();
        const key = keyOf(pos);
        const e = tt.get(key);
        if (e && (e.depth >= depth || isMate(e.score))) {
            const s = fromTT(e.score, ply);
            if (e.flag === EXACT) return s;
            if (e.flag === LOWER) { if (s >= beta) return s; if (s > alpha) alpha = s; }
            else if (e.flag === UPPER) { if (s <= alpha) return s; if (s < beta) beta = s; }
        }
        const moves = legalMoves(pos);
        // one-ply lookahead: a move that ends the game is the fastest possible win from here
        const kids = [];
        for (const m of moves) {
            const child = apply(pos, m);
            if (child.over) {
                const s = MATE - (ply + 1);
                tt.set(key, { depth: Infinity, flag: EXACT, score: toTT(s, ply) });
                return s;
            }
            kids.push(child);
        }
        if (depth <= 0) return 0;                          // horizon: unresolved (never stored as a proof)
        // move ordering: the opponent's remaining cells, fewest first (cheap and effective)
        const opp = pos.mover ^ 1;
        const order = kids.map((c, k) => { let o = 0; for (let i = 0; i < c.own.length; i++) if (c.own[i] === opp) o++; return { c, o, k }; });
        order.sort((a, b) => a.o - b.o || a.k - b.k);
        const alpha0 = alpha;
        let best = -INF;
        for (const { c } of order) {
            const s = -search(c, depth - 1, ply + 1, -beta, -alpha);
            if (s > best) best = s;
            if (s > alpha) alpha = s;
            if (alpha >= beta) break;
        }
        const flag = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
        // a horizon-limited 0 stays valid only for searches up to this depth; mate scores for any
        tt.set(key, { depth: isMate(best) ? Infinity : depth, flag, score: toTT(best, ply) });
        return best;
    }
    return { search, nodes: () => nodes, tt };
}

/* solve(state, { depth = Infinity, nodes = 2_000_000 })
   state: a ChainRules state (n, cells[{count, owner}], current, movesBy, over, chainRule).
   depth: plies to look ahead (Infinity = exhaustive to terminal positions).
   Returns null when the position is not proven within depth and budget. */
export function solve(state, options = {}) {
    const depth = options.depth === undefined ? Infinity : options.depth;
    const budget = options.nodes === undefined ? 2_000_000 : options.nodes;
    const pos = state.cnt ? state : fromState(state);
    if (pos.over) throw new Error("solver: the game is already over");
    const moves = legalMoves(pos);
    if (moves.length === 0) throw new Error("solver: no legal moves");
    const S = makeSearch(budget);
    let v;
    try {
        v = S.search(pos, depth, 0, -INF, INF);
        if (v === 0) return null;                          // not resolved within the horizon
        // the root score is exact; a null-window search per move tells which moves reach it
        const best = [];
        for (const m of moves) {
            const child = apply(pos, m);
            let s;
            if (child.over) s = MATE - 1;
            else s = -S.search(child, depth - 1, 1, -v, -v + 1);
            if (s >= v) best.push(m);
        }
        const value = v > 0 ? "win" : "loss";
        const plies = v > 0 ? MATE - v : MATE + v;
        return { value, best, depth: plies, exhaustive: depth === Infinity, nodes: S.nodes(), losesNow: losesNow(pos, moves) };
    } catch (err) {
        if (err instanceof BudgetExceeded) return null;
        throw err;
    }
}

// moves after which the opponent can end the game at once (used for the "avoid-loss" tag)
export function losesNow(pos, moves = legalMoves(pos)) {
    const out = [];
    for (const m of moves) {
        const child = apply(pos, m);
        if (child.over) continue;
        if (legalMoves(child).some((r) => apply(child, r).over)) out.push(m);
    }
    return out;
}

// moves that end the game now
export function winsNow(pos) {
    return legalMoves(pos).filter((m) => apply(pos, m).over);
}

/* ---------- board symmetries (used by the generator to avoid duplicates, and by tests) ---------- */
export const SYMMETRIES = [
    (x, y, n) => [x, y], (x, y, n) => [n - 1 - x, y], (x, y, n) => [x, n - 1 - y], (x, y, n) => [n - 1 - x, n - 1 - y],
    (x, y, n) => [y, x], (x, y, n) => [n - 1 - y, x], (x, y, n) => [y, n - 1 - x], (x, y, n) => [n - 1 - y, n - 1 - x],
];
export function mapCell(i, n, sym) { const [x, y] = sym(i % n, Math.floor(i / n), n); return y * n + x; }
// smallest key over the 8 symmetries of a position: two puzzles with the same canonical key are the same puzzle
export function canonicalKey(pos) {
    const n = pos.n;
    let bestKey = null;
    for (const sym of SYMMETRIES) {
        const cnt = new Int8Array(n * n), own = new Int8Array(n * n);
        for (let i = 0; i < n * n; i++) { const j = mapCell(i, n, sym); cnt[j] = pos.cnt[i]; own[j] = pos.own[i]; }
        const k = keyOf({ n, cnt, own, mover: pos.mover, moved: pos.moved });
        if (bestKey === null || k < bestKey) bestKey = k;
    }
    return bestKey;
}

export { keyOf };
