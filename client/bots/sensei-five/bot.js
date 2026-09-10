/* Sensei — Five Wins. A real gomoku engine for any board size and win length.

   Pure and headless: it only reads state.cells / state.current / state.n / state.winLen
   and returns a cell index. Everything else is its own: an incremental board with line
   pattern records, a static evaluation, alpha-beta negamax with iterative deepening,
   transposition table, killer + history ordering, a threat-space search for forced wins
   by fours (VCF), and a candidate generator restricted to cells near stones.

   Vocabulary (all defined for any winLen L, on one line, for one player):
   - completion cell: an empty cell that finishes ≥ L in a row when the player fills it
     (a "four" in gomoku terms; two of them = an open four / double four = unstoppable).
   - four-maker:      an empty cell whose filling creates ≥ 1 completion cell (forcing move).
   - three-cell:      an empty cell whose filling creates ≥ 2 completion cells on that line
     (playing there makes an open four; owning one = an "open three" incl. broken ones).
   - window sum:      Σ over L-windows without an enemy stone of WS[stones still missing].
   The line records hold those per line and player; totals are kept incrementally so a
   position is evaluated in O(1) after an O(L) make/unmake.

   Search: forced situations are handled exactly (own completion cell → win; two enemy
   completion cells → loss; one → the block is the only move and costs no depth), enemy
   three-cells restrict the reply to own four-makers / three-cells / real defences, other
   nodes search the K best candidates by a per-cell potential that is updated incrementally.
   Determinism: no Math.random; tie-breaks are by cell index, Easy's noise uses tools.random. */

"use strict";

const SenseiFive = (() => {
    const WIN = 1000000;                   // mate scores: WIN - ply (faster wins score higher)
    const MAXPLY = 48;                     // search depth incl. forced extensions
    const PLIES = 100;                     // move buffers: search plies + VCF plies below a leaf
    const YIELD_EVERY = 2000;              // nodes between tools.yield() on the long levels
    const TT_BITS = 16;
    const RECS = 12;                       // ints per line record, see scanLine
    const R_F = 0, R_T = 2, R_S = 4, R_FM = 6, R_TM = 8, R_MM = 10;
    // window value by the number of stones still missing in an L-window (0 = fills a line)
    const WS = [100000, 250, 70, 12, 2, 1];
    const wsOf = (need) => (need < WS.length ? WS[need] : 0);
    // static evaluation terms (see evaluate); an object so tuning scripts can tweak them
    const EVAL = { threeMine: 3000, threeOne: 1000, threeTwo: 2500, fourPending: 1500 };

    /* ---------- difficulty profiles ----------
       depth: iterative-deepening cap; K: candidates per node; vcf / vct: max own fours /
       threats in the root threat searches (0 = off); leafVcf / leafVct: fours / threats tried
       below a leaf; defend: re-check the chosen move against an enemy VCT of that many
       threats; noise: Easy's randomness; yields: breathe every 2000 nodes. */
    const LEVELS = {
        "easy": { depth: 1, K: 8, vcf: 0, vct: 0, leafVcf: 0, leafVct: 0, defend: 0, noise: true, yields: false },
        "normal": { depth: 2, K: 10, vcf: 0, vct: 0, leafVcf: 0, leafVct: 0, defend: 0, noise: false, yields: false },
        "hard": { depth: 4, K: 12, vcf: 8, vct: 4, leafVcf: 0, leafVct: 0, defend: 0, noise: false, yields: true },
        "very-hard": { depth: 24, K: 12, vcf: 16, vct: 10, leafVcf: 6, leafVct: 0, defend: 6, noise: false, yields: true },
    };

    /* ================================================================
       Board: cells, line records, totals, per-cell potential, Zobrist hash, make/unmake stack
       ================================================================ */
    class Board {
        constructor(n, L) {
            this.n = n; this.L = L; this.size = n * n;
            this.cell = new Int8Array(this.size).fill(-1);
            this.empties = this.size;
            this.ws = new Int32Array(L + 1);
            for (let k = 0; k <= L; k++) this.ws[k] = wsOf(k);
            this.buildLines();
            this.rec = new Int32Array(this.lines.length * RECS);
            this.F = [0, 0]; this.T = [0, 0]; this.S = [0, 0];
            this.TL = [0, 0];                                  // lines with ≥ 1 three-cell
            this.MK = [0, 0];                                  // lines with ≥ 1 four-maker
            this.potD = new Int32Array(4 * this.size * 2);    // potential per direction, cell, player
            this.pot = new Int32Array(this.size * 2);         // Σ over directions
            this.nb = new Uint8Array(this.size);              // stones within Chebyshev distance 2
            this.nbList = [];
            for (let c = 0; c < this.size; c++) {
                const x = c % n, y = (c - x) / n, list = [];
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                    if ((dx || dy) && x + dx >= 0 && x + dx < n && y + dy >= 0 && y + dy < n) list.push(c + dy * n + dx);
                }
                this.nbList.push(Int16Array.from(list));
            }
            const rng32 = Bots.rng(0x5e15e1);                 // fixed seed: the same Zobrist keys on every machine
            this.zlo = new Uint32Array(2 * this.size); this.zhi = new Uint32Array(2 * this.size);
            for (let i = 0; i < 2 * this.size; i++) { this.zlo[i] = (rng32() * 4294967296) >>> 0; this.zhi[i] = (rng32() * 4294967296) >>> 0; }
            this.hashLo = 0; this.hashHi = 0;
            // undo stack: per make a frame of [cell, player, 10 totals, 4 × (line id + record), potential entries…]
            this.frame = 2 + 10 + 4 * (1 + RECS) + 1 + 4 * (2 * L - 2) * 5;
            this.stack = new Int32Array(this.frame * (PLIES + 8));
            this.frames = new Int32Array(PLIES + 8);           // frame start per made stone
            this.sp = 0; this.depth = 0;
            this.runL = new Int16Array(n + 1); this.runR = new Int16Array(n + 1);
            this.tmp0 = new Int32Array(n + 1); this.tmp1 = new Int32Array(n + 1);
            this.scratch = new Int32Array(RECS);
        }

        // the 4 line families as arrays of cell ids; lineOf/posOf map (dir, cell) → line, position
        buildLines() {
            const n = this.n, L = this.L, lines = [];
            this.lineOf = new Int16Array(4 * this.size).fill(-1);
            this.posOf = new Int16Array(4 * this.size);
            const add = (d, cells) => {
                if (cells.length < L) return;
                const id = lines.length;
                lines.push(Int16Array.from(cells));
                cells.forEach((c, pos) => { this.lineOf[d * this.size + c] = id; this.posOf[d * this.size + c] = pos; });
            };
            for (let y = 0; y < n; y++) add(0, Array.from({ length: n }, (_, x) => y * n + x));
            for (let x = 0; x < n; x++) add(1, Array.from({ length: n }, (_, y) => y * n + x));
            for (let s = -(n - 1); s <= n - 1; s++) {                       // x - y = s
                const cells = [];
                for (let y = 0; y < n; y++) { const x = y + s; if (x >= 0 && x < n) cells.push(y * n + x); }
                add(2, cells);
            }
            for (let s = 0; s <= 2 * n - 2; s++) {                          // x + y = s
                const cells = [];
                for (let y = 0; y < n; y++) { const x = s - y; if (x >= 0 && x < n) cells.push(y * n + x); }
                add(3, cells);
            }
            this.lines = lines;
        }

        /* Pattern scan of one line into rec[at…]: completion cells (F, mask FM), three-cells
           (T, TM), four-makers (MM) per player, and the window sums S. runL[i]/runR[i] are the
           own stones directly left/right of i, so filling an empty i yields a run of
           runL + runR + 1; that run gains a completion cell at its ends a/b when the stones
           beyond a/b bring it to L. */
        scanLine(id, at) {
            const cells = this.lines[id], m = cells.length, L = this.L, cell = this.cell, rec = this.rec;
            const runL = this.runL, runR = this.runR;
            for (let p = 0; p < 2; p++) {
                let run = 0;
                for (let i = 0; i < m; i++) { runL[i] = run; run = cell[cells[i]] === p ? run + 1 : 0; }
                run = 0;
                for (let i = m - 1; i >= 0; i--) { runR[i] = run; run = cell[cells[i]] === p ? run + 1 : 0; }
                let F = 0, T = 0, FM = 0, TM = 0, MM = 0;
                for (let i = 0; i < m; i++) {
                    if (cell[cells[i]] !== -1) continue;
                    const total = runL[i] + runR[i] + 1;
                    if (total >= L) { F++; FM |= 1 << i; continue; }
                    const a = i - runL[i] - 1, b = i + runR[i] + 1;
                    const ca = a >= 0 && cell[cells[a]] === -1 && runL[a] + 1 + total >= L;
                    const cb = b < m && cell[cells[b]] === -1 && runR[b] + 1 + total >= L;
                    if (ca && cb) { T++; TM |= 1 << i; }
                    if (ca || cb) MM |= 1 << i;
                }
                rec[at + R_F + p] = F; rec[at + R_T + p] = T; rec[at + R_FM + p] = FM; rec[at + R_TM + p] = TM; rec[at + R_MM + p] = MM;
            }
            let c0 = 0, c1 = 0, S0 = 0, S1 = 0;
            const ws = this.ws;
            for (let i = 0; i < L; i++) { const v = cell[cells[i]]; if (v === 0) c0++; else if (v === 1) c1++; }
            for (let s = 0; ; s++) {
                if (c1 === 0 && c0 > 0) S0 += ws[L - c0];
                if (c0 === 0 && c1 > 0) S1 += ws[L - c1];
                if (s + L >= m) break;
                const out = cell[cells[s]], inn = cell[cells[s + L]];
                if (out === 0) c0--; else if (out === 1) c1--;
                if (inn === 0) c0++; else if (inn === 1) c1++;
            }
            rec[at + R_S] = S0; rec[at + R_S + 1] = S1;
        }

        // totals ± one line record
        addRec(at, sign) {
            const rec = this.rec;
            for (let p = 0; p < 2; p++) {
                this.F[p] += sign * rec[at + R_F + p];
                this.T[p] += sign * rec[at + R_T + p];
                this.S[p] += sign * rec[at + R_S + p];
                if (rec[at + R_T + p]) this.TL[p] += sign;
                if (rec[at + R_MM + p]) this.MK[p] += sign;
            }
        }

        /* Potentials of positions lo..hi of line id for both players into tmp0/tmp1: the
           window sums a cell would have after being filled by that player (ws[0] when it
           completes a line). One sliding pass over every L-window touching the range, each
           window adding its value to the cells it covers. Used for move ordering and Easy. */
        sweep(id, lo, hi) {
            const cells = this.lines[id], m = cells.length, L = this.L, cell = this.cell, ws = this.ws;
            const t0 = this.tmp0, t1 = this.tmp1;
            for (let q = lo; q <= hi; q++) { t0[q] = 0; t1[q] = 0; }
            const s0 = Math.max(0, lo - L + 1), s1 = Math.min(m - L, hi);
            let c0 = 0, c1 = 0;
            for (let i = s0; i < s0 + L; i++) { const v = cell[cells[i]]; if (v === 0) c0++; else if (v === 1) c1++; }
            for (let s = s0; ; s++) {
                const a = s > lo ? s : lo, b = s + L - 1 < hi ? s + L - 1 : hi;
                if (c1 === 0 && c0 < L) { const v = ws[L - c0 - 1]; for (let q = a; q <= b; q++) t0[q] += v; }
                if (c0 === 0 && c1 < L) { const v = ws[L - c1 - 1]; for (let q = a; q <= b; q++) t1[q] += v; }
                if (s === s1) break;
                const out = cell[cells[s]], inn = cell[cells[s + L]];
                if (out === 0) c0--; else if (out === 1) c1--;
                if (inn === 0) c0++; else if (inn === 1) c1++;
            }
        }

        // full recompute from an array of owners (-1/0/1); the stack is cleared
        load(cells) {
            const size = this.size;
            this.sp = 0; this.depth = 0; this.empties = 0; this.hashLo = 0; this.hashHi = 0;
            this.nb.fill(0);
            for (let c = 0; c < size; c++) {
                const v = cells[c];
                this.cell[c] = v;
                if (v === -1) this.empties++;
                else { this.hashLo ^= this.zlo[v * size + c]; this.hashHi ^= this.zhi[v * size + c]; for (const o of this.nbList[c]) this.nb[o]++; }
            }
            this.F[0] = this.F[1] = this.T[0] = this.T[1] = this.S[0] = this.S[1] = this.TL[0] = this.TL[1] = this.MK[0] = this.MK[1] = 0;
            for (let id = 0; id < this.lines.length; id++) { this.scanLine(id, id * RECS); this.addRec(id * RECS, 1); }
            this.potD.fill(0); this.pot.fill(0);
            for (let d = 0; d < 4; d++) for (let c = 0; c < size; c++) {
                const id = this.lineOf[d * size + c];
                if (id < 0 || this.posOf[d * size + c] !== 0) continue;        // once per line
                const cells = this.lines[id];
                this.sweep(id, 0, cells.length - 1);
                for (let q = 0; q < cells.length; q++) {
                    const x = cells[q];
                    if (this.cell[x] !== -1) continue;
                    this.potD[(d * size + x) * 2] = this.tmp0[q]; this.potD[(d * size + x) * 2 + 1] = this.tmp1[q];
                    this.pot[x * 2] += this.tmp0[q]; this.pot[x * 2 + 1] += this.tmp1[q];
                }
            }
        }

        /* make/unmake: a frame per stone on the undo stack holds the totals, the 4 touched
           line records and the potentials that change (cells within L-1 on the 4 lines). */
        make(c, p) {
            const size = this.size, st = this.stack;
            let sp = this.sp;
            this.frames[this.depth++] = sp;
            st[sp++] = c; st[sp++] = p;
            st[sp++] = this.F[0]; st[sp++] = this.F[1]; st[sp++] = this.T[0]; st[sp++] = this.T[1]; st[sp++] = this.S[0]; st[sp++] = this.S[1];
            st[sp++] = this.TL[0]; st[sp++] = this.TL[1]; st[sp++] = this.MK[0]; st[sp++] = this.MK[1];
            this.cell[c] = p; this.empties--;
            this.hashLo ^= this.zlo[p * size + c]; this.hashHi ^= this.zhi[p * size + c];
            for (const o of this.nbList[c]) this.nb[o]++;
            for (let d = 0; d < 4; d++) {
                const id = this.lineOf[d * size + c];
                st[sp++] = id;
                if (id < 0) { sp += RECS; continue; }
                const at = id * RECS;
                for (let k = 0; k < RECS; k++) st[sp++] = this.rec[at + k];
                this.addRec(at, -1); this.scanLine(id, at); this.addRec(at, 1);
            }
            const countAt = sp++;
            let count = 0;
            for (let d = 0; d < 4; d++) {
                const id = this.lineOf[d * size + c];
                if (id < 0) continue;
                const cells = this.lines[id], pos = this.posOf[d * size + c];
                const lo = Math.max(0, pos - this.L + 1), hi = Math.min(cells.length - 1, pos + this.L - 1);
                this.sweep(id, lo, hi);
                for (let q = lo; q <= hi; q++) {
                    const x = cells[q];
                    if (this.cell[x] !== -1) continue;
                    const i = (d * size + x) * 2;
                    st[sp++] = i; st[sp++] = this.potD[i]; st[sp++] = this.potD[i + 1]; st[sp++] = this.pot[x * 2]; st[sp++] = this.pot[x * 2 + 1];
                    count++;
                    this.pot[x * 2] += this.tmp0[q] - this.potD[i]; this.pot[x * 2 + 1] += this.tmp1[q] - this.potD[i + 1];
                    this.potD[i] = this.tmp0[q]; this.potD[i + 1] = this.tmp1[q];
                }
            }
            st[countAt] = count;
            this.sp = sp;
        }

        unmake() {
            const size = this.size, st = this.stack;
            let sp = this.frames[--this.depth];
            this.sp = sp;
            const c = st[sp++], p = st[sp++];
            this.F[0] = st[sp++]; this.F[1] = st[sp++]; this.T[0] = st[sp++]; this.T[1] = st[sp++]; this.S[0] = st[sp++]; this.S[1] = st[sp++];
            this.TL[0] = st[sp++]; this.TL[1] = st[sp++]; this.MK[0] = st[sp++]; this.MK[1] = st[sp++];
            for (let d = 0; d < 4; d++) {
                const id = st[sp++];
                if (id < 0) { sp += RECS; continue; }
                const at = id * RECS;
                for (let k = 0; k < RECS; k++) this.rec[at + k] = st[sp++];
            }
            const count = st[sp++];
            for (let e = 0; e < count; e++, sp += 5) {                  // absolute values: order is irrelevant
                const i = st[sp], x = (i >> 1) % size;
                this.potD[i] = st[sp + 1]; this.potD[i + 1] = st[sp + 2]; this.pot[x * 2] = st[sp + 3]; this.pot[x * 2 + 1] = st[sp + 4];
            }
            this.cell[c] = -1; this.empties++;
            this.hashLo ^= this.zlo[p * size + c]; this.hashHi ^= this.zhi[p * size + c];
            for (const o of this.nbList[c]) this.nb[o]--;
        }

        // distinct completion cells of p into out (stops early at 2); returns the count
        completionCells(p, out) {
            let count = 0;
            if (this.F[p] === 0) return 0;
            for (let id = 0; id < this.lines.length && count < 2; id++) {
                let mask = this.rec[id * RECS + R_FM + p];
                while (mask && count < 2) {
                    const bit = mask & -mask, pos = 31 - Math.clz32(bit);
                    mask ^= bit;
                    const c = this.lines[id][pos];
                    if (count === 0 || out[0] !== c) out[count++] = c;
                }
            }
            return count;
        }

        // cells of a mask family (R_MM four-makers, R_TM three-cells) of p, deduplicated by stamp
        collect(field, p, out, count, mark, stamp) {
            for (let id = 0; id < this.lines.length; id++) {
                let mask = this.rec[id * RECS + field + p];
                while (mask) {
                    const bit = mask & -mask, pos = 31 - Math.clz32(bit);
                    mask ^= bit;
                    const c = this.lines[id][pos];
                    if (mark[c] !== stamp) { mark[c] = stamp; out[count++] = c; }
                }
            }
            return count;
        }

        /* Defences against q's three-cells: empty cells on those lines whose filling by p
           leaves the line without a three-cell (anything less still loses to the open four).
           Tested by a scratch scan (no stack, no totals). */
        defences(p, q, out, count, mark, stamp) {
            const rec = this.rec, sc = this.scratch;
            for (let id = 0; id < this.lines.length; id++) {
                const at = id * RECS;
                if (rec[at + R_T + q] === 0) continue;
                const cells = this.lines[id];
                sc.set(rec.subarray(at, at + RECS));
                for (let i = 0; i < cells.length; i++) {
                    const x = cells[i];
                    if (this.cell[x] !== -1 || mark[x] === stamp) continue;
                    this.cell[x] = p;
                    this.scanLine(id, at);
                    const after = rec[at + R_T + q];
                    this.cell[x] = -1;
                    if (after === 0) { mark[x] = stamp; out[count++] = x; }
                }
                rec.set(sc, at);
            }
            return count;
        }
    }

    /* ================================================================
       Static evaluation from the side to move's view. Completion cells are resolved by the
       search (win / forced block) before this is reached, so it weighs the slower material:
       window sums (potential lines), an own three-cell (= an open four next move: nearly won),
       enemy three-lines (one costs a tempo, two are usually lost) and, at the ply cap only,
       a pending enemy four. */
    function evaluate(B, p) {
        const q = 1 - p;
        let v = B.S[p] - B.S[q];
        if (B.T[p] > 0) v += EVAL.threeMine;
        if (B.TL[q] >= 2) v -= EVAL.threeTwo; else if (B.TL[q] === 1) v -= EVAL.threeOne;
        if (B.F[q] > 0) v -= EVAL.fourPending;
        return v;
    }

    /* ================================================================
       Searcher: one per bot instance (keeps the board and tables across moves)
       ================================================================ */
    class Searcher {
        constructor(tools, level) {
            this.tools = tools; this.level = level;
            this.B = null;
            this.ttLo = new Uint32Array(1 << TT_BITS); this.ttHi = new Uint32Array(1 << TT_BITS);
            this.ttDepth = new Int8Array(1 << TT_BITS); this.ttFlag = new Int8Array(1 << TT_BITS);
            this.ttVal = new Int32Array(1 << TT_BITS); this.ttMove = new Int16Array(1 << TT_BITS);
            this.vcfLo = new Uint32Array(1 << 14); this.vcfHi = new Uint32Array(1 << 14); this.vcfGen = new Uint16Array(1 << 14);
            this.vcfFours = new Int8Array(1 << 14); this.vcfStamp = 0; this.vcfMove = -1;
        }

        board(n, L) {
            if (!this.B || this.B.n !== n || this.B.L !== L) {
                this.B = new Board(n, L);
                this.moves = new Int16Array(PLIES * this.B.size);
                this.scores = new Int32Array(PLIES * this.B.size);
                this.mark = new Int32Array(this.B.size); this.stamp = 0;
                this.hist = new Int32Array(2 * this.B.size);
                this.killers = new Int16Array(PLIES * 2);
                this.buf2 = new Int16Array(2);
            }
            return this.B;
        }

        /* ---------- per-move driver ---------- */
        async move(state) {
            const B = this.board(state.n, state.winLen);
            B.load(state.cells);
            const me = state.current, opp = 1 - me, tools = this.tools, level = this.level;
            this.me = me;
            this.d = tools.deadline(); this.stop = false; this.sinceYield = 0;
            this.info = { depth: 0, nodes: 0, value: 0, root: [] };
            this.ttFlag.fill(0); this.hist.fill(0); this.killers.fill(-1);
            if (++this.vcfStamp === 65536) { this.vcfStamp = 1; this.vcfGen.fill(0); }
            if (B.empties === B.size) return Math.floor((B.n - 1) / 2) * B.n + Math.floor((B.n - 1) / 2);
            const buf = this.buf2;
            if (B.completionCells(me, buf) > 0) return buf[0];                       // win now
            const threats = B.completionCells(opp, buf);
            if (threats > 0 && !(level.noise && tools.random() > 0.75)) return buf[0];  // block (Easy sometimes misses)
            if (level.noise) return this.easyMove(me);
            // a forced win by fours / threats is certain; the search may still know a faster one
            let forced = level.vcf > 0 ? await this.rootVcf(me, level.vcf) : null;
            if (!forced && level.vct > 0) forced = await this.rootVct(me, level.vct, 0.4);
            if (forced && forced.plies <= 2) return forced.move;
            this.vctNodeEnd = Infinity; this.vctTimeEnd = Infinity; this.vctAbort = false;   // leaf searches run on the main budget
            const best = await this.deepen(me, forced ? forced.plies - 1 : level.depth);
            if (forced && !(this.info.value >= WIN - forced.plies + 1)) return forced.move;
            return best;
        }

        // Easy: greedy by potential with a weighted random pick among the best candidates
        easyMove(me) {
            const count = this.generate(me, 0, -1);
            const moves = this.moves, r = this.tools.random();
            const k = Math.min(count, r < 0.45 ? 1 : r < 0.7 ? 2 : r < 0.85 ? 3 : count);
            return moves[this.tools.randInt(k)];
        }

        // iterative deepening at the root; keeps the best move of the last completed depth.
        // this.info records depth, nodes and the root scores of the last completed iteration.
        async deepen(me, depthCap) {
            const B = this.B, level = this.level, moves = this.moves;
            const count = this.generate(me, 0, -1);
            const root = Array.from(moves.subarray(0, count));
            const rootScore = new Map(root.map((c) => [c, 0]));
            let best = root[0], bestVal = -Infinity;
            const maxDepth = Math.min(depthCap, B.empties);
            for (let depth = 1; depth <= maxDepth && !this.stop; depth++) {
                let alpha = -WIN, curBest = -1, curVal = -Infinity;
                for (const c of root) {
                    B.make(c, me);
                    const v = -(await this.negamax(depth - 1, -WIN, -alpha, 1));
                    B.unmake();
                    if (this.stop) break;
                    rootScore.set(c, v);
                    if (v > curVal) { curVal = v; curBest = c; }
                    if (v > alpha) alpha = v;
                }
                if (this.stop) break;
                best = curBest; bestVal = curVal;
                // later moves only got an upper bound (≤ alpha); the move that raised alpha stays first
                root.sort((a, b) => (b === best) - (a === best) || rootScore.get(b) - rootScore.get(a) || a - b);
                this.info = { depth, nodes: this.d.nodes(), value: bestVal, root: root.map((c) => [c, rootScore.get(c)]) };
                // stop once a win within depth + 1 plies is known (nothing faster can exist) or the
                // position is lost by force (deeper search cannot add candidates)
                if (bestVal >= WIN - depth - 1 || bestVal <= -(WIN - MAXPLY)) break;
            }
            if (level.defend > 0 && bestVal > -(WIN - MAXPLY)) {
                // the chosen move must not run into a forced win by threats; otherwise take the
                // best alternative that doesn't (root order = last completed iteration)
                for (const c of root.slice(0, 4)) {
                    B.make(c, me);
                    const r = await this.rootVct(1 - me, level.defend, 0.2, 1);
                    B.unmake();
                    if (this.stop) break;
                    if (!r) return c;
                }
            }
            return best;
        }

        /* ---------- candidate generation ----------
           Fills moves[ply*size…] ordered best-first and returns the count. Enemy three-cells
           restrict the set to own four-makers, own three-cells and real defences; otherwise
           all empty cells near a stone, scored by potential (attack + defence), top K. The
           transposition move, killers and history bonuses shape the order. */
        generate(p, ply, ttMove) {
            const B = this.B, size = B.size, q = 1 - p, base = ply * size;
            const moves = this.moves, scores = this.scores, pot = B.pot, hist = this.hist;
            const K = B.empties <= 16 ? B.empties : (ply === 0 ? Math.max(this.level.K, 20) : this.level.K);
            const k0 = this.killers[ply * 2], k1 = this.killers[ply * 2 + 1];
            const stamp = ++this.stamp, mark = this.mark;
            let count = 0;
            const scoreOf = (c) => {
                let s = pot[c * 2 + p] + pot[c * 2 + q] + (hist[p * size + c] >> 4);
                if (c === ttMove) s += 1 << 30; else if (c === k0 || c === k1) s += 4000;
                return s;
            };
            if (B.TL[q] > 0) {
                let n = B.collect(R_MM, p, moves, base, mark, stamp) - base;
                n = B.collect(R_TM, p, moves, base + n, mark, stamp) - base;
                n = B.defences(p, q, moves, base + n, mark, stamp) - base;
                for (let i = 0; i < n; i++) scores[base + i] = scoreOf(moves[base + i]);
                count = n;
                // insertion sort (few moves)
                for (let i = 1; i < count; i++) {
                    const m = moves[base + i], s = scores[base + i];
                    let j = i - 1;
                    while (j >= 0 && (scores[base + j] < s || (scores[base + j] === s && moves[base + j] > m))) { moves[base + j + 1] = moves[base + j]; scores[base + j + 1] = scores[base + j]; j--; }
                    moves[base + j + 1] = m; scores[base + j + 1] = s;
                }
                if (count > 0) return count;
            }
            // near-stone cells, kept as a sorted top-K list
            for (let c = 0; c < size; c++) {
                if (B.cell[c] !== -1 || B.nb[c] === 0) continue;
                const s = scoreOf(c);
                if (count === K && s <= scores[base + count - 1]) continue;
                let j = count < K ? count : K - 1;
                while (j > 0 && scores[base + j - 1] < s) { moves[base + j] = moves[base + j - 1]; scores[base + j] = scores[base + j - 1]; j--; }
                moves[base + j] = c; scores[base + j] = s;
                if (count < K) count++;
            }
            return count;
        }

        /* ---------- alpha-beta negamax ---------- */
        async negamax(depth, alpha, beta, ply) {
            if (this.stop) return 0;
            if (this.d.tick()) { this.stop = true; return 0; }
            if (this.level.yields && ++this.sinceYield >= YIELD_EVERY) { this.sinceYield = 0; await this.tools.yield(); }
            const B = this.B, p = (ply & 1) ? 1 - this.me : this.me, q = 1 - p;
            if (B.F[p] > 0) return WIN - ply;
            if (B.empties === 0) return 0;
            const buf = this.buf2;
            const forced = B.completionCells(q, buf);
            if (forced >= 2) return -(WIN - ply - 1);
            if (ply >= MAXPLY) return evaluate(B, p);
            if (forced === 0 && depth <= 0) {
                // leaf threat search: a forced win by fours / threats for the side to move
                if (this.level.leafVct > 0 && (B.MK[p] > 0 || B.T[p] > 0)) {
                    const plies = await this.vct(p, this.level.leafVct, ply, -1);
                    if (this.stop) return 0;
                    if (plies >= 0) return WIN - ply - plies;
                } else if (this.level.leafVcf > 0 && B.MK[p] > 0) {
                    const plies = await this.vcf(p, this.level.leafVcf, ply, -1);
                    if (this.stop) return 0;
                    if (plies >= 0) return WIN - ply - plies;
                }
                return evaluate(B, p);
            }
            // transposition table
            const idx = (B.hashLo ^ (B.hashHi << 7)) & ((1 << TT_BITS) - 1);
            let ttMove = -1;
            if (this.ttFlag[idx] && this.ttLo[idx] === B.hashLo && this.ttHi[idx] === B.hashHi) {
                ttMove = this.ttMove[idx];
                if (this.ttDepth[idx] >= depth) {
                    let v = this.ttVal[idx];
                    if (v > WIN - 200) v -= ply; else if (v < -(WIN - 200)) v += ply;
                    const f = this.ttFlag[idx];
                    if (f === 1 || (f === 2 && v >= beta) || (f === 3 && v <= alpha)) return v;
                }
            }
            const size = B.size, base = ply * size, moves = this.moves;
            let count, next;
            if (forced === 1) { moves[base] = buf[0]; count = 1; next = depth; }          // the block is free
            else { count = this.generate(p, ply, ttMove); next = depth - 1; }
            if (count === 0) return evaluate(B, p);
            let bestV = -Infinity, bestM = -1, flag = 3;
            for (let i = 0; i < count; i++) {
                const c = moves[base + i];
                B.make(c, p);
                const v = -(await this.negamax(next, -beta, -alpha, ply + 1));
                B.unmake();
                if (this.stop) return 0;
                if (v > bestV) { bestV = v; bestM = c; }
                if (v > alpha) {
                    alpha = v; flag = 1;
                    if (alpha >= beta) {
                        flag = 2;
                        if (forced === 0) {
                            if (this.killers[ply * 2] !== c) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = c; }
                            this.hist[p * size + c] += depth * depth;
                        }
                        break;
                    }
                }
            }
            let stored = bestV;
            if (stored > WIN - 200) stored += ply; else if (stored < -(WIN - 200)) stored -= ply;
            this.ttLo[idx] = B.hashLo; this.ttHi[idx] = B.hashHi; this.ttDepth[idx] = depth; this.ttFlag[idx] = flag; this.ttVal[idx] = stored; this.ttMove[idx] = bestM;
            return bestV;
        }

        /* ---------- threat-space search: victory by continuous fours ----------
           p plays only four-makers; each forces the single block (or wins at once with two
           completion cells). A block that creates an enemy completion cell must be covered by
           the next four. Returns the number of plies until p stands on a completion cell
           (2 per four) or -1 if there is no such win within `fours`; this.vcfMove is the first
           four. Positions that failed with ≥ the same number of fours left are remembered for
           the current move. */
        async vcf(p, fours, ply, cover) {
            if (this.stop) return -1;
            if (this.d.tick()) { this.stop = true; return -1; }
            if (this.level.yields && ++this.sinceYield >= YIELD_EVERY) { this.sinceYield = 0; await this.tools.yield(); }
            const B = this.B, q = 1 - p, buf = this.buf2;
            if (B.F[p] > 0) { B.completionCells(p, buf); this.vcfMove = buf[0]; return 0; }
            if (fours === 0 || B.MK[p] === 0 || ply + 2 >= PLIES) return -1;
            const keyHi = (B.hashHi ^ Math.imul(cover + 2, 0x9e3779b1) ^ (p << 31)) >>> 0;
            const vi = (B.hashLo ^ (keyHi << 5)) & ((1 << 14) - 1);
            if (this.vcfGen[vi] === this.vcfStamp && this.vcfLo[vi] === B.hashLo && this.vcfHi[vi] === keyHi && this.vcfFours[vi] >= fours) return -1;
            const size = B.size, base = ply * size, moves = this.moves, stamp = ++this.stamp;
            const count = B.collect(R_MM, p, moves, base, this.mark, stamp) - base;
            for (let i = 0; i < count; i++) {
                const c = moves[base + i];
                if (cover >= 0 && c !== cover) continue;
                B.make(c, p);
                let plies = -1;
                if (B.F[q] === 0) {                                    // else the enemy completes first
                    if (B.completionCells(p, buf) >= 2) plies = 2;
                    else {
                        B.make(buf[0], q);                                // the forced block
                        let nextCover = -1, ok = true;
                        if (B.F[q] > 0) { if (B.completionCells(q, buf) >= 2) ok = false; else nextCover = buf[0]; }
                        if (ok) { const r = await this.vcf(p, fours - 1, ply + 2, nextCover); if (r >= 0) plies = r + 2; }
                        B.unmake();
                    }
                }
                B.unmake();
                if (this.stop) return -1;
                if (plies >= 0) { this.vcfMove = c; return plies; }
            }
            this.vcfGen[vi] = this.vcfStamp; this.vcfLo[vi] = B.hashLo; this.vcfHi[vi] = keyHi; this.vcfFours[vi] = fours;
            return -1;
        }

        // the fastest win by fours from the root: tries 1, 2, … fours; { move, plies } or null
        async rootVcf(p, maxFours) {
            for (let fours = 1; fours <= maxFours && !this.stop; fours++) {
                const plies = await this.vcf(p, fours, 0, -1);
                if (plies >= 0) return { move: this.vcfMove, plies };
            }
            return null;
        }

        /* ---------- threat-space search with fours and threes (VCT) ----------
           Like vcf, but the attacker may also play three-cells (threatening an open four).
           After a four the defender's block is forced; after a three the defender may only
           counter with own four-makers or really defend (cells lowering the three-cell count)
           — anything else loses to the open four — and every such reply must lose. Returns
           plies until p stands on a completion cell or -1; this.vctMove is the first move.
           Bounded by `threats` and by its own share of the move budget (this.vctNodeEnd /
           vctTimeEnd): an aborted search records no failures. */
        async vct(p, threats, ply, cover) {
            if (this.stop || this.vctAbort) return -1;
            if (this.d.tick()) { this.stop = true; return -1; }
            if (this.d.nodes() >= this.vctNodeEnd || Date.now() >= this.vctTimeEnd) { this.vctAbort = true; return -1; }
            if (this.level.yields && ++this.sinceYield >= YIELD_EVERY) { this.sinceYield = 0; await this.tools.yield(); }
            const B = this.B, q = 1 - p, buf = this.buf2;
            if (B.F[p] > 0) { B.completionCells(p, buf); this.vctMove = buf[0]; return 0; }
            if (threats === 0 || ply + 3 >= PLIES) return -1;
            const keyHi = (B.hashHi ^ Math.imul(cover + 2, 0x9e3779b1) ^ (p << 31) ^ 0x40000000) >>> 0;
            const vi = (B.hashLo ^ (keyHi << 5)) & ((1 << 14) - 1);
            if (this.vcfGen[vi] === this.vcfStamp && this.vcfLo[vi] === B.hashLo && this.vcfHi[vi] === keyHi && this.vcfFours[vi] >= threats) return -1;
            const size = B.size, base = ply * size, moves = this.moves, mark = this.mark;
            let count;
            if (cover >= 0) { moves[base] = cover; count = 1; }
            else {
                const stamp = ++this.stamp;
                count = B.collect(R_MM, p, moves, base, mark, stamp) - base;              // fours first
                count = B.collect(R_TM, p, moves, base + count, mark, stamp) - base;
            }
            for (let i = 0; i < count; i++) {
                const c = moves[base + i];
                B.make(c, p);
                let plies = -1;
                if (B.F[q] === 0) {                                    // else the enemy completes first
                    const mine = B.completionCells(p, buf);
                    if (mine >= 2) plies = 2;
                    else if (mine === 1) {
                        B.make(buf[0], q);                                // the forced block
                        let nextCover = -1, ok = true;
                        if (B.F[q] > 0) { if (B.completionCells(q, buf) >= 2) ok = false; else nextCover = buf[0]; }
                        if (ok) { const r = await this.vct(p, threats - 1, ply + 2, nextCover); if (r >= 0) plies = r + 2; }
                        B.unmake();
                    } else if (B.T[p] > 0) {
                        const dbase = (ply + 1) * size, stamp = ++this.stamp;
                        let dc = B.collect(R_MM, q, moves, dbase, mark, stamp) - dbase;
                        dc = B.defences(q, p, moves, dbase + dc, mark, stamp) - dbase;
                        let worst = dc === 0 ? 4 : 0;                       // no reply at all: open four next, then the win
                        for (let j = 0; j < dc && worst >= 0; j++) {
                            B.make(moves[dbase + j], q);
                            let nextCover = -1, ok = true;
                            if (B.F[q] > 0) { if (B.completionCells(q, buf) >= 2) ok = false; else nextCover = buf[0]; }
                            const r = ok ? await this.vct(p, threats - 1, ply + 2, nextCover) : -1;
                            B.unmake();
                            if (r < 0) worst = -1; else if (r + 2 > worst) worst = r + 2;
                        }
                        plies = worst;
                    }
                }
                B.unmake();
                if (this.stop || this.vctAbort) return -1;
                if (plies >= 0) { this.vctMove = c; return plies; }
            }
            this.vcfGen[vi] = this.vcfStamp; this.vcfLo[vi] = B.hashLo; this.vcfHi[vi] = keyHi; this.vcfFours[vi] = threats;
            return -1;
        }

        // the fastest win by threats for p (to move at `ply`) within `share` of what is left of
        // the move budget: tries 1, 2, … threats; { move, plies } or null
        async rootVct(p, maxThreats, share, ply = 0) {
            const d = this.d, budget = this.tools.budget;
            this.vctNodeEnd = d.nodes() + (budget.nodes === Infinity ? Infinity : share * (budget.nodes - d.nodes()));
            this.vctTimeEnd = budget.ms === Infinity ? Infinity : Date.now() + share * d.left();
            this.vctAbort = false;
            for (let threats = 1; threats <= maxThreats && !this.stop && !this.vctAbort; threats++) {
                const plies = await this.vct(p, threats, ply, -1);
                if (plies >= 0) return { move: this.vctMove, plies };
            }
            return null;
        }
    }

    /* ================================================================
       Win chance for player 0 (HUD): static, deterministic, cheap. Terminal positions are
       exact; an unstoppable four / two completion cells for the side to move or an
       unanswerable threat for the other side dominate; otherwise the material difference
       goes through a logistic curve scaled by the board's window values. */
    const estBoards = new Map();                                     // "n/L" -> Board, reused per call
    function estimate(state) {
        if (state.over) return state.winner === 0 ? 1 : state.winner === 1 ? 0 : 0.5;
        const key = `${state.n}/${state.winLen}`;
        if (!estBoards.has(key)) estBoards.set(key, new Board(state.n, state.winLen));
        const B = estBoards.get(key);
        B.load(state.cells);
        const p = state.current, q = 1 - p, buf = new Int16Array(2);
        let v;                                                       // from p's view
        const mine = B.completionCells(p, buf);
        const theirs = B.completionCells(q, buf);
        if (mine > 0) v = 12;                                        // wins on the spot
        else if (theirs >= 2) v = -12;                               // cannot block both
        else if (theirs === 1) v = -1.5 + (B.S[p] - B.S[q]) / 600;   // must block, initiative lost
        else if (B.T[p] > 0) v = 5 + (B.S[p] - B.S[q]) / 600;        // open four next move
        else if (B.TL[q] >= 2) v = -4 + (B.S[p] - B.S[q]) / 600;     // two open threes to stop
        else v = (B.S[p] - B.S[q] + (B.TL[q] === 1 ? -600 : 0) + (B.MK[p] > 0 ? 80 : 0)) / 400;
        const pv = 1 / (1 + Math.exp(-v));
        return p === 0 ? pv : 1 - pv;
    }

    return { Board, Searcher, evaluate, estimate, LEVELS, WS, EVAL };
})();

Bots.register({
    id: "sensei-five",
    name: "Sensei",
    game: "five",
    version: 1,
    description: "Reads the lines: fours, open threes, forcing sequences. Very hard searches for forced wins.",
    difficulties: [
        { id: "easy", label: "Easy", thinkMs: 30 },
        { id: "normal", label: "Normal", thinkMs: 150 },
        { id: "hard", label: "Hard", thinkMs: 600 },
        { id: "very-hard", label: "Very hard", thinkMs: 1500 },
    ],
    create(tools) {
        const s = new SenseiFive.Searcher(tools, SenseiFive.LEVELS[tools.difficulty] || SenseiFive.LEVELS.normal);
        return { move: (state) => s.move(state), searcher: s };     // searcher: test hook (info of the last search)
    },
    estimate: (state) => SenseiFive.estimate(state),
    internals: SenseiFive,          // test hooks: Board, Searcher, evaluate, estimate, LEVELS, WS, EVAL
});
