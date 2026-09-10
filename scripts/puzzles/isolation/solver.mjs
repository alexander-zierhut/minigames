/* Isolation solver: an exhaustive win/loss search for two players.

   Isolation cannot be drawn. Every move breaks one tile, so the game is finite, and it
   ends the moment the player to move has no free neighbour left: that player has lost.
   The value of a position is therefore simply **win** or **loss** for the side to move,
   and the solver searches every line to the end. There is no static evaluation and no
   depth limit, so what it returns is the game-theoretic value; a node budget aborts
   positions that are still too open, and those never become puzzles.

   Two exact reductions keep it affordable:

   1. **Dead tiles are interchangeable.** A free tile that no pawn's component holds (over
      the tiles that still exist, king steps, both pawns passable) can never be stepped on
      by anybody, so breaking it is a pure waste move. Two positions that differ only in
      *which* dead tile was broken are the same game, so the search offers exactly one
      representative dead tile. The number of waste moves, which does matter, is unchanged.
   2. **Transposition table.** A position is fully described by the tiles that still exist,
      the two pawns and the side to move, and the values are plain booleans, so a solved
      position is reused wherever the search meets it again.

   The root is classified over *every* legal move, so `best` is the complete set of moves
   that keep the win and `moveValues` says win or loss for each of them.

   Exports: Board, solve(state, opts), solveExhaustive(board, opts), trapsNow(board),
   separated(board), canonical(cells, n). */

const STEPS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const HOLE = -2, FREE = -1;

export class Board {
    constructor(n) {
        this.n = n;
        this.size = n * n;
        this.cell = new Int8Array(this.size);      // -2 hole, -1 free, 0/1 pawn
        this.pawns = [0, 0];
        this.turn = 0;
        this.nb = [];
        for (let c = 0; c < this.size; c++) {
            const x = c % n, y = (c - x) / n, list = [];
            for (const [dx, dy] of STEPS) {
                const u = x + dx, v = y + dy;
                if (u >= 0 && v >= 0 && u < n && v < n) list.push(v * n + u);
            }
            this.nb.push(Int16Array.from(list));
        }
        this.seen = new Int32Array(this.size);
        this.stamp = 0;
        this.queue = new Int32Array(this.size);
        this.hot = new Int32Array(this.size);
        this.hotStamp = 0;
        this.words = Math.ceil(this.size / 32);
        this.mask = new Uint32Array(this.words);       // bit set = the tile still exists
    }

    // the existence bitmask is kept in step with `cell` so key() stays cheap
    setMask() {
        this.mask.fill(0);
        for (let c = 0; c < this.size; c++) if (this.cell[c] !== HOLE) this.mask[c >> 5] |= (1 << (c & 31));
    }

    static fromState(state) {
        if (state.players !== 2) throw new Error("the Isolation solver is for two players");
        const b = new Board(state.n);
        for (let c = 0; c < b.size; c++) b.cell[c] = state.cells[c];
        b.pawns = [state.pawns[0], state.pawns[1]];
        b.turn = state.current;
        b.setMask();
        return b;
    }

    // tiles that still exist + both pawns + the side to move
    key() {
        let s = "";
        for (let w = 0; w < this.words; w++) s += this.mask[w] + ",";
        return `${s}${this.pawns[0]}|${this.pawns[1]}|${this.turn}`;
    }

    steps(p) {
        const out = [], list = this.nb[this.pawns[p]];
        for (let i = 0; i < list.length; i++) if (this.cell[list[i]] === FREE) out.push(list[i]);
        return out;
    }
    mobility(p) { return this.steps(p).length; }
    free() {
        const out = [];
        for (let c = 0; c < this.size; c++) if (this.cell[c] === FREE) out.push(c);
        return out;
    }

    /* mark every tile the pawns' components hold; a tile behind the other pawn counts as
       reachable (both pawns are passable), which over-approximates and keeps the dead-tile
       reduction exact */
    markReachable() {
        this.stamp++;
        let tail = 0;
        for (const at of this.pawns) { if (this.seen[at] !== this.stamp) { this.seen[at] = this.stamp; this.queue[tail++] = at; } }
        for (let head = 0; head < tail; head++) {
            const list = this.nb[this.queue[head]];
            for (let i = 0; i < list.length; i++) {
                const nb = list[i];
                if (this.cell[nb] === HOLE || this.seen[nb] === this.stamp) continue;
                this.seen[nb] = this.stamp;
                this.queue[tail++] = nb;
            }
        }
    }

    /* every legal move of the side to move: `to * size + removed` */
    genFull() {
        const p = this.turn, from = this.pawns[p], out = [];
        const free = this.free();
        for (const to of this.steps(p)) {
            for (const r of free) if (r !== to) out.push(to * this.size + r);
            out.push(to * this.size + from);
        }
        return out;
    }

    /* the same set with the dead tiles collapsed into one representative, the tiles next to
       the opponent first (that is what decides games, so alpha cuts come early) */
    genReduced() {
        const p = this.turn, q = 1 - p, from = this.pawns[p], out = [];
        const steps = this.steps(p);
        if (steps.length === 0) return out;
        // the components do not depend on where the pawn steps (both pawns are passable),
        // so one pass gives the candidates for every step
        this.markReachable();
        this.hotStamp++;
        const around = this.nb[this.pawns[q]];
        for (let i = 0; i < around.length; i++) this.hot[around[i]] = this.hotStamp;
        const first = [], later = [];
        let dead = -1;
        for (let c = 0; c < this.size; c++) {
            if (this.cell[c] !== FREE) continue;
            if (this.seen[c] !== this.stamp) { if (dead < 0) dead = c; continue; }   // one representative waste move
            (this.hot[c] === this.hotStamp ? first : later).push(c);
        }
        (this.hot[from] === this.hotStamp ? first : later).push(from);               // the tile the pawn leaves behind
        const cand = dead >= 0 ? first.concat(later, [dead]) : first.concat(later);
        for (const to of steps) {
            for (const r of cand) if (r !== to) out.push(to * this.size + r);
        }
        return out;
    }

    make(m) {
        const p = this.turn, to = (m / this.size) | 0, r = m % this.size, from = this.pawns[p];
        this.cell[from] = FREE;
        this.cell[to] = p;
        this.pawns[p] = to;
        this.cell[r] = HOLE;
        this.mask[r >> 5] &= ~(1 << (r & 31));
        this.turn = 1 - p;
        return { p, from, to, r };
    }
    unmake(u) {
        this.cell[u.r] = FREE;
        this.mask[u.r >> 5] |= (1 << (u.r & 31));
        this.cell[u.to] = FREE;
        this.cell[u.from] = u.p;
        this.pawns[u.p] = u.from;
        this.turn = u.p;
    }
}

/* ---------- the search: does the side to move win? ---------- */
function wins(b, ctx) {
    if (++ctx.nodes > ctx.maxNodes) { ctx.aborted = true; return false; }
    const key = b.key();
    const hit = ctx.tt.get(key);
    if (hit !== undefined) return hit;
    let res = false;
    for (const m of b.genReduced()) {
        const u = b.make(m);
        const opponentWins = wins(b, ctx);
        b.unmake(u);
        if (ctx.aborted) return false;
        if (!opponentWins) { res = true; break; }
    }
    ctx.tt.set(key, res);                     // no moves at all: res stays false (trapped = lost)
    return res;
}

/* the moves that trap the opponent on the spot */
export function trapsNow(b) {
    const out = [];
    for (const m of b.genFull()) {
        const u = b.make(m);
        if (b.mobility(b.turn) === 0) out.push(m);
        b.unmake(u);
    }
    return out.sort((x, y) => x - y);
}

/* are the pawns in different components (nobody can ever reach the other)? */
export function separated(b) {
    b.stamp++;
    let tail = 0;
    const at = b.pawns[0];
    b.seen[at] = b.stamp; b.queue[tail++] = at;
    for (let head = 0; head < tail; head++) {
        const list = b.nb[b.queue[head]];
        for (let i = 0; i < list.length; i++) {
            const nb = list[i];
            if (b.cell[nb] === HOLE || b.seen[nb] === b.stamp) continue;
            b.seen[nb] = b.stamp;
            b.queue[tail++] = nb;
        }
    }
    return b.seen[b.pawns[1]] !== b.stamp;
}

/* Solve a position exhaustively. Returns
   { value: "win" | "loss" | "unknown", depth, best: [moves], moveValues: { move: "win"|"loss" },
     nodes, method: "exhaustive" }.
   `best` = every move that keeps the win (Isolation has no draws, so a slower win is still
   a win); `depth` = 1 when the best moves trap the opponent right away, else "exhaustive". */
export function solveExhaustive(board, { maxNodes = 400000, tt = new Map() } = {}) {
    const b = board;
    const ctx = { nodes: 0, maxNodes, aborted: false, tt };
    const unknown = () => ({ value: "unknown", depth: 0, best: [], nodes: ctx.nodes, method: "exhaustive" });
    const won = wins(b, ctx);
    if (ctx.aborted) return unknown();
    const moveValues = {};
    const best = [];
    for (const m of b.genFull()) {
        const u = b.make(m);
        const opponentWins = wins(b, ctx);
        b.unmake(u);
        if (ctx.aborted) return unknown();
        moveValues[m] = opponentWins ? "loss" : "win";
        if (!opponentWins) best.push(m);
    }
    best.sort((x, y) => x - y);
    const now = won ? trapsNow(b) : [];
    const depth = won && now.length === best.length && best.length > 0 ? 1 : "exhaustive";
    return { value: won ? "win" : "loss", depth, best, moveValues, nodes: ctx.nodes, method: "exhaustive" };
}

/* Convenience: solve a rules state (two players, not over). */
export function solve(state, opts = {}) {
    return solveExhaustive(Board.fromState(state), opts);
}

/* Canonical form of a position under the 8 board symmetries (dedup in the generator).
   The pawns sit in `cells` as their seat number, so they are part of the form. */
export function canonical(cells, n) {
    const forms = [];
    for (let t = 0; t < 8; t++) {
        let s = "";
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const u = t & 4 ? y : x, v = t & 4 ? x : y;
            const px = t & 1 ? n - 1 - u : u, py = t & 2 ? n - 1 - v : v;
            s += String(cells[py * n + px] + 2);
        }
        forms.push(s);
    }
    forms.sort();
    return forms[0];
}
