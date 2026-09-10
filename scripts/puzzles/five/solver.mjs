/* Five Wins solver (gomoku without gravity: n×n board, `winLen` OR MORE in a row in one
   of 4 directions wins; a full board is a draw, and so is a DEAD board — one where no
   window of winLen cells is free of enemy stones for either side, #18 — the rules end the
   game there, so the search treats it as a terminal draw too: `Board.dead()`).

   solve(state, options) → { value, best, depth, method, nodes, moveValues? }
     value   "win" | "draw" | "loss" from the perspective of state.current, or "unknown"
             when nothing could be PROVEN (such positions never become puzzles).
     best    every optimal move: for a win the complete set of moves that force the win in
             the fewest plies; for a draw every move that holds the draw; for a loss every
             move that resists longest (all sorted ascending, cell id = y * n + x).
     depth   plies until the forced result under best play (1 = wins on the spot); for a
             draw it is the string "exhaustive".
     method  "exhaustive" or "threat" (see below).

   Two engines, both of which only ever return proven results:

   1. Exhaustive alpha-beta negamax to terminal positions (`solveExhaustive`), used when
      the board is small enough / empty enough to finish within `maxNodes`. Every line is
      searched to a win, a loss or a draw (full or dead board) — there is no static
      evaluation, so the value is the game-theoretic value of the position. Scores carry the distance to the
      result (WIN - plies), so the root distinguishes fast wins from slow ones. A
      transposition table (exact board key, no hashing collisions possible) and two exact
      pruning rules keep it fast:
        - a side that can complete a line now wins now (no need to look further);
        - a side facing ≥ 2 distinct completion cells of the opponent has lost (it can fill
          only one of them); facing exactly one, its only non-losing move is that cell.
      Both rules are consequences of the rules of the game, not heuristics.
      With the search finished, every root move is classified exactly (win/draw/loss) via
      null-window probes, which is what `moveValues` reports.

   2. Threat search (`proveWin`), used on boards too large to exhaust. It proves a forced
      win for the side to move within ≤ 5 plies: the ROOT considers every legal move and
      the DEFENDER always considers every legal reply (or, when the attacker threatens to
      complete a line, its only non-losing replies: the block / an own immediate win —
      exact, see above). Only the attacker's non-root moves are restricted to cells that
      lie in a line window already holding ≥ winLen-3 own stones and no enemy stone.
      That restriction cannot miss a win of ≤ 5 plies: a win at ply 5 requires the
      attacker's move at ply 3 to create two completion cells at once (the defender
      otherwise blocks the single one), i.e. to land in windows that already held
      winLen-2 own stones, which the candidate set contains; forced blocks are always
      included. Hence for depth ≤ 5 `best` is the COMPLETE set of fastest winning moves,
      and "no win within 5 plies" is a proven fact, not a guess. Nothing beyond that is
      claimed: when no win is found the value is "unknown" (never "draw").

   Determinism: no randomness anywhere; move ordering is by static counts with the cell id
   as the tie-break, so the same input always yields the same output. */

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const WIN = 10000;          // score of a win at distance 0; a win in k plies scores WIN - k
const ABORT = new Error("node budget exhausted");
const EXACT = 0, LOWER = 1, UPPER = 2;
const POW3 = Array.from({ length: 25 }, (_, i) => 3 ** i);

/* ---------- geometry: every winLen-cell window and the windows through each cell ---------- */
const geoCache = new Map();
export function geometry(n, winLen) {
    const k = `${n}/${winLen}`;
    if (geoCache.has(k)) return geoCache.get(k);
    const windows = [];
    const cellWindows = Array.from({ length: n * n }, () => []);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (const [dx, dy] of DIRS) {
        const ex = x + dx * (winLen - 1), ey = y + dy * (winLen - 1);
        if (ex < 0 || ey < 0 || ex >= n || ey >= n) continue;
        const cells = [];
        for (let s = 0; s < winLen; s++) cells.push((y + dy * s) * n + x + dx * s);
        for (const c of cells) cellWindows[c].push(windows.length);
        windows.push(cells);
    }
    const geo = { n, winLen, windows, cellWindows };
    geoCache.set(k, geo);
    return geo;
}

/* ---------- Board: cells + per-window stone counts, incrementally maintained ---------- */
export class Board {
    constructor(n, winLen, cells, current) {
        this.n = n; this.w = winLen; this.geo = geometry(n, winLen);
        this.cells = Int8Array.from(cells);
        this.current = current;
        this.cnt = [new Int8Array(this.geo.windows.length), new Int8Array(this.geo.windows.length)];
        this.keys = new Float64Array(Math.ceil(n * n / 25));   // exact base-3 encoding in 25-cell chunks
        this.empties = 0;
        this.open = [this.geo.windows.length, this.geo.windows.length];   // windows without an enemy stone, per player
        this.mark = new Int32Array(n * n); this.stamp = 0;
        for (let i = 0; i < this.cells.length; i++) {
            const p = this.cells[i];
            if (p < 0) { this.empties++; continue; }
            for (const w of this.geo.cellWindows[i]) { if (this.cnt[p][w]++ === 0) this.open[1 - p]--; }
            this.keys[(i / 25) | 0] += (p + 1) * POW3[i % 25];
        }
    }
    static fromState(state) { return new Board(state.n, state.winLen, state.cells, state.current); }
    place(i, p) {
        this.cells[i] = p; this.empties--;
        for (const w of this.geo.cellWindows[i]) { if (this.cnt[p][w]++ === 0) this.open[1 - p]--; }
        this.keys[(i / 25) | 0] += (p + 1) * POW3[i % 25];
        this.current = 1 - p;
    }
    undo(i, p) {
        this.cells[i] = -1; this.empties++;
        for (const w of this.geo.cellWindows[i]) { if (--this.cnt[p][w] === 0) this.open[1 - p]++; }
        this.keys[(i / 25) | 0] -= (p + 1) * POW3[i % 25];
        this.current = p;
    }
    // no line can be completed any more by either side: the rules call that a draw (#18)
    dead() { return this.open[0] === 0 && this.open[1] === 0; }
    // terminal draw: full or dead board
    drawn() { return this.empties === 0 || this.dead(); }
    key() { return this.keys.join("|"); }
    empty() { const out = []; for (let i = 0; i < this.cells.length; i++) if (this.cells[i] < 0) out.push(i); return out; }
    // cells where `p` completes a line right now (each listed once)
    threats(p) {
        const own = this.cnt[p], other = this.cnt[1 - p], W = this.geo.windows, need = this.w - 1;
        const out = []; const stamp = ++this.stamp;
        for (let w = 0; w < W.length; w++) {
            if (own[w] !== need || other[w] !== 0) continue;
            const cells = W[w];
            for (let s = 0; s < cells.length; s++) {
                const c = cells[s];
                if (this.cells[c] < 0) { if (this.mark[c] !== stamp) { this.mark[c] = stamp; out.push(c); } break; }
            }
        }
        return out;
    }
    // empty cells lying in an enemy-free window that already holds ≥ minOwn stones of `p`
    candidates(p, minOwn) {
        const own = this.cnt[p], other = this.cnt[1 - p], cw = this.geo.cellWindows, out = [];
        for (let i = 0; i < this.cells.length; i++) {
            if (this.cells[i] >= 0) continue;
            const ws = cw[i];
            for (let k = 0; k < ws.length; k++) if (other[ws[k]] === 0 && own[ws[k]] >= minOwn) { out.push(i); break; }
        }
        return out;
    }
    // static ordering score of an empty cell for `p`: attacking and defending potential
    score(i, p) {
        const own = this.cnt[p], other = this.cnt[1 - p], ws = this.geo.cellWindows[i];
        let s = 0;
        for (let k = 0; k < ws.length; k++) {
            const a = own[ws[k]], d = other[ws[k]];
            if (d === 0) s += 1 << (2 * a);
            if (a === 0) s += (1 << (2 * d)) - (d ? 1 : 0);
        }
        return s;
    }
    ordered(p, first = -1) {
        const moves = this.empty();
        const sc = moves.map((i) => (i === first ? 1e9 : this.score(i, p)));
        const idx = moves.map((_, k) => k);
        idx.sort((a, b) => sc[b] - sc[a] || moves[a] - moves[b]);
        return idx.map((k) => moves[k]);
    }
}

/* ---------- 1. exhaustive alpha-beta to terminal ---------- */
// scores stored relative to the node so a transposition at another ply reads correctly
const toTT = (s, ply) => (s > WIN / 2 ? s + ply : s < -WIN / 2 ? s - ply : s);
const fromTT = (s, ply) => (s > WIN / 2 ? s - ply : s < -WIN / 2 ? s + ply : s);

export function solveExhaustive(board, { maxNodes = 2_000_000, classify = true } = {}) {
    const b = board instanceof Board ? board : Board.fromState(board);
    const tt = new Map();
    let nodes = 0;

    function negamax(ply, alpha, beta) {
        if (++nodes > maxNodes) throw ABORT;
        const me = b.current, op = 1 - me;
        if (b.threats(me).length) return WIN - (ply + 1);            // complete a line now
        if (b.drawn()) return 0;                                      // full or dead board: draw
        const opT = b.threats(op);
        if (opT.length >= 2) return -(WIN - (ply + 2));               // cannot fill two cells at once
        const key = b.key();
        const e = tt.get(key);
        let ttMove = -1;
        if (e) {
            const s = fromTT(e.s, ply);
            if (e.f === EXACT || (e.f === LOWER && s >= beta) || (e.f === UPPER && s <= alpha)) return s;
            ttMove = e.m;
        }
        const moves = opT.length === 1 ? opT : b.ordered(me, ttMove);
        const a0 = alpha;
        let best = -Infinity, bestMove = -1;
        for (const m of moves) {
            b.place(m, me);
            const s = -negamax(ply + 1, -beta, -alpha);
            b.undo(m, me);
            if (s > best) {
                best = s; bestMove = m;
                if (s > alpha) { alpha = s; if (alpha >= beta) break; }
            }
        }
        tt.set(key, { s: toTT(best, ply), f: best <= a0 ? UPPER : best >= beta ? LOWER : EXACT, m: bestMove });
        return best;
    }

    const me = b.current, op = 1 - me;
    const result = { method: "exhaustive", nodes: 0 };
    try {
        const myT = b.threats(me);
        if (myT.length) {                                             // wins on the spot
            Object.assign(result, { value: "win", best: myT.sort((x, y) => x - y), depth: 1, score: WIN - 1 });
        } else {
            const opT = b.threats(op);
            const moves = opT.length === 1 ? opT : b.ordered(me);
            let best = -Infinity, bestMoves = [];
            if (opT.length >= 2) { best = -(WIN - 2); bestMoves = b.empty(); }
            else for (const m of moves) {
                // window (best-1, +inf): moves scoring exactly `best` are still seen exactly
                b.place(m, me);
                const s = -negamax(1, -Infinity, best === -Infinity ? Infinity : -(best - 1));
                b.undo(m, me);
                if (s > best) { best = s; bestMoves = [m]; } else if (s === best) bestMoves.push(m);
            }
            result.score = best;
            result.best = bestMoves.sort((x, y) => x - y);
            if (best > 0) { result.value = "win"; result.depth = WIN - best; }
            else if (best === 0) { result.value = "draw"; result.depth = "exhaustive"; }
            else { result.value = "loss"; result.depth = WIN + best; }
        }
        if (classify) {
            // exact class of every legal move: two null-window probes around the class borders
            const mv = {};
            const bestSet = new Set(result.best);
            for (const m of b.empty()) {
                if (bestSet.has(m)) { mv[m] = result.value; continue; }
                b.place(m, me);
                let cls;
                const opWins = b.threats(op).length;
                if (opWins) cls = "loss";
                else if (b.drawn()) cls = "draw";
                else {
                    const s1 = negamax(1, -1, 0);                      // child ≤ -1 ⇔ we win
                    if (s1 <= -1) cls = "win";
                    else cls = negamax(1, 0, 1) >= 1 ? "loss" : "draw";
                }
                b.undo(m, me);
                mv[m] = cls;
            }
            result.moveValues = mv;
        }
    } catch (err) {
        if (err !== ABORT) throw err;
        return { method: "exhaustive", value: "unknown", best: [], depth: null, nodes, aborted: true };
    }
    result.nodes = nodes;
    return result;
}

/* ---------- 2. threat search: proven forced win within ≤ MAX_PROOF plies ---------- */
export const MAX_PROOF = 5;

export function proveWin(board, { maxPlies = MAX_PROOF, maxNodes = 5_000_000 } = {}) {
    const b = board instanceof Board ? board : Board.fromState(board);
    const att = b.current, def = 1 - att, minOwn = b.w - 3;
    const memo = new Map();   // key → { proven: min relative plies, failed: max relative limit that failed }
    let nodes = 0;

    // attacker to move at `ply`; can it force a win by ply `limit`?
    function attack(ply, limit) {
        if (++nodes > maxNodes) throw ABORT;
        if (b.threats(att).length) return ply + 1 <= limit;
        if (ply + 3 > limit || b.dead()) return false;
        const defT = b.threats(def);
        if (defT.length >= 2) return false;                           // the defender wins first
        const rel = limit - ply, key = b.key();
        const e = memo.get(key);
        if (e) { if (e.proven <= rel) return true; if (e.failed >= rel) return false; }
        const moves = defT.length === 1 ? defT : b.candidates(att, minOwn);
        let ok = false;
        for (const m of moves) {
            b.place(m, att);
            ok = defend(ply + 1, limit);
            b.undo(m, att);
            if (ok) break;
        }
        const entry = e || { proven: Infinity, failed: -Infinity };
        if (ok) entry.proven = Math.min(entry.proven, rel); else entry.failed = Math.max(entry.failed, rel);
        memo.set(key, entry);
        return ok;
    }
    // defender to move at `ply`; does EVERY legal reply lose by `limit`?
    function defend(ply, limit) {
        if (++nodes > maxNodes) throw ABORT;
        if (b.threats(def).length) return false;                      // defender completes a line
        if (b.drawn()) return false;                                  // draw (full or dead board)
        const attT = b.threats(att);
        if (attT.length >= 2) return ply + 2 <= limit;                // one block cannot stop two
        if (ply + 4 > limit) return false;                            // need def, att, def, att
        const moves = attT.length === 1 ? attT : b.ordered(def);
        for (const m of moves) {
            b.place(m, def);
            const ok = attack(ply + 1, limit);
            b.undo(m, def);
            if (!ok) return false;
        }
        return true;
    }

    try {
        const myT = b.threats(att);
        if (myT.length) return { method: "threat", value: "win", best: myT.sort((x, y) => x - y), depth: 1, nodes };
        const defT = b.threats(def);
        if (defT.length >= 2) return { method: "threat", value: "unknown", best: [], depth: null, nodes, note: "opponent has two completion cells" };
        const rootMoves = defT.length === 1 ? defT : b.empty();
        for (let limit = 3; limit <= maxPlies; limit += 2) {
            const best = [];
            for (const m of rootMoves) {
                b.place(m, att);
                const ok = defend(1, limit);
                b.undo(m, att);
                if (ok) best.push(m);
            }
            if (best.length) return { method: "threat", value: "win", best: best.sort((x, y) => x - y), depth: limit, nodes };
        }
        return { method: "threat", value: "unknown", best: [], depth: null, nodes };
    } catch (err) {
        if (err !== ABORT) throw err;
        return { method: "threat", value: "unknown", best: [], depth: null, nodes, aborted: true };
    }
}

/* ---------- the public entry point ---------- */
// The threat search runs first (milliseconds): a forced win within MAX_PROOF plies is the
// same answer (same depth, same complete `best`) the exhaustive search would give, only
// cheaper. Otherwise the board is exhausted when it is small enough (≤ exhaustiveMaxEmpties
// empty cells, ≤ exhaustiveNodes nodes); if that aborts the value stays "unknown".
// options: exhaustiveNodes (0 = never exhaust), exhaustiveMaxEmpties, maxPlies (threat
// search), classify (report moveValues after an exhaustive solve).
export function solve(state, options = {}) {
    const { exhaustiveNodes = 1_500_000, exhaustiveMaxEmpties = 30, maxPlies = MAX_PROOF, classify = true } = options;
    if (state.over) throw new Error("solve: the game is over");
    const b = Board.fromState(state);
    if (b.drawn()) throw new Error("solve: the game is over (full or dead board)");
    const t = proveWin(b, { maxPlies });
    if (t.value === "win") return t;
    if (exhaustiveNodes > 0 && b.empties <= exhaustiveMaxEmpties) {
        const r = solveExhaustive(b, { maxNodes: exhaustiveNodes, classify });
        if (r.value !== "unknown") return r;
        t.exhaustiveNodes = r.nodes;
    }
    return t;
}

/* ---------- helpers shared with the generator / tests ---------- */
// the 8 symmetries of the square as cell maps; canonical() picks the smallest board string
export function symmetries(n) {
    const maps = [];
    for (const f of [
        (x, y) => [x, y], (x, y) => [n - 1 - x, y], (x, y) => [x, n - 1 - y], (x, y) => [n - 1 - x, n - 1 - y],
        (x, y) => [y, x], (x, y) => [n - 1 - y, x], (x, y) => [y, n - 1 - x], (x, y) => [n - 1 - y, n - 1 - x],
    ]) {
        const map = new Int32Array(n * n);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const [u, v] = f(x, y); map[y * n + x] = v * n + u; }
        maps.push(map);
    }
    return maps;
}
export function canonical(cells, n) {
    let best = null;
    for (const map of symmetries(n)) {
        const out = new Array(n * n);
        for (let i = 0; i < n * n; i++) out[map[i]] = cells[i] < 0 ? "." : String(cells[i]);
        const s = out.join("");
        if (best === null || s < best) best = s;
    }
    return best;
}
