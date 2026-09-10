/* Creeper — Chain React. A searching bot with four levels, from a beginner that
   blunders on purpose to a full-budget alpha-beta search that a good human should
   struggle against on 6×6.

   How it plays
   ------------
   1. Rules on typed arrays. tools.apply() JSON-clones the whole state per call, far too
      slow for tens of thousands of positions per move. `apply` below re-implements
      place + settle + conclude on two Int8Arrays with incremental wave resolution
      (only cells touched by a wave are re-checked, cell counts per player are kept
      as the waves land, so the "board decided" stop and the "everyone moved" win
      condition cost nothing). bot.test.mjs proves it identical to ChainRules on
      thousands of random moves, chain rule on and off.
   2. Evaluation (`evaluate`, side-to-move relative). Per owned cell: its pieces, plus
      a corner/edge bonus when the cell is safe, or a penalty when it is *exposed* (an
      enemy critical cell — one piece from exploding — is next to it and can take it
      next move; worse when the cell is critical itself because it then explodes for
      the enemy). Deliberately small: the search does the tactics.
   3. Search (`Search`): negamax alpha-beta with iterative deepening, a transposition
      table (Zobrist hashing on cells + side to move + "both have moved"; sound because
      the piece count grows by one every move, so a position can never repeat), killer
      moves, static move ordering (explosions and captures first, moves next to enemy
      critical cells last) and a short quiescence search over explosive captures so the
      side to move gets to cash in its threats before the position is judged. Wins are
      mate-distance scores, so the fastest win / longest defence is preferred.
   4. Budget: `tools.deadline()` per move, one tick per searched node (regular and
      quiescence). Iterative deepening keeps the last completed depth (or the best of a
      partial iteration once its first move finished), the strong levels yield to the
      page every ~2000 nodes. Under a node budget the answer is the same on any
      machine; tools.random is used only for Easy's noise and tie-breaks.

   Levels: Easy = one ply with noise; Normal = two plies; Hard = four plies;
   Very hard = as deep as the budget allows.

   evaluate(state, tools) is the win-chance evaluation for the HUD (see "Judge" below):
   a raw score from player 0's point of view in "pieces of advantage", searched under
   tools.budget.nodes so every client computes the same number. */

"use strict";

(() => {
    const WIN = 100000;                 // mate score at the root; WIN - ply deeper down
    const WIN_MIN = WIN - 1000;         // anything beyond is a forced win/loss
    const INF = WIN + 1;
    const YIELD_EVERY = 2000;           // nodes between tools.yield() on the strong levels

    /* evaluation weights and search knobs (one object so variants can be compared in
       self-play; the values here are the tuned defaults) */
    const DEFAULTS = {
        corner: 3, edge: 2,             // positional value of a safe corner / edge cell
        exposed: 2, exposedCrit: 2,     // penalty base for a cell an enemy critical cell can take (+ pieces), more if critical
        qdepth: 3,                      // quiescence plies over explosive captures
        lmr: true,                      // late move reductions for quiet moves
        pvs: true,                      // null-window search after the first move
        history: true,                  // history heuristic in move ordering
    };

    /* ---------- board geometry, cached per size ---------- */
    const geos = {};
    function geometry(n) {
        if (geos[n]) return geos[n];
        const N = n * n, cap = new Int8Array(N), nb = new Int8Array(N * 4);
        for (let i = 0; i < N; i++) {
            const x = i % n, y = (i / n) | 0;
            let k = 0;
            if (x > 0) nb[i * 4 + k++] = i - 1;
            if (x < n - 1) nb[i * 4 + k++] = i + 1;
            if (y > 0) nb[i * 4 + k++] = i - n;
            if (y < n - 1) nb[i * 4 + k++] = i + n;
            cap[i] = k;                                    // capacity = number of neighbours
        }
        // Zobrist keys: 12 cell codes (owner -1/0/1 × 0..3 pieces) × 2 halves, from a fixed
        // LCG so every machine hashes the same (never Math.random)
        let seed = 0x2545f491 ^ (n * 0x9e3779b9);
        const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed ^ (seed >>> 13)) | 0; };
        const zob = new Int32Array(N * 12 * 2);
        for (let k = 0; k < zob.length; k++) zob[k] = next();
        const zMover = [next(), next()], zMoved = [next(), next()];
        return (geos[n] = { n, N, cap, nb, zob, zMover, zMoved });
    }

    /* ---------- compact position ----------
       cnt/own per cell (owner -1 empty), mover = side to move, moved = bit mask of players
       who have made their first move, cells0/cells1 = cells owned, over/winner. The wave
       buffers are scratch space for apply(). */
    function makePos(geo) {
        const N = geo.N;
        return {
            geo, cnt: new Int8Array(N), own: new Int8Array(N).fill(-1), mover: 0, moved: 0,
            cells0: 0, cells1: 0, over: false, winner: -1,
            waveA: new Int16Array(N), waveB: new Int16Array(N), mark: new Uint8Array(N),
        };
    }
    function fromState(state) {
        const geo = geometry(state.n), pos = makePos(geo);
        for (let i = 0; i < geo.N; i++) {
            const c = state.cells[i];
            pos.cnt[i] = c.count; pos.own[i] = c.owner;
            if (c.owner === 0) pos.cells0++; else if (c.owner === 1) pos.cells1++;
        }
        pos.mover = state.current;
        pos.moved = (state.movesBy[0] > 0 ? 1 : 0) | (state.movesBy[1] > 0 ? 2 : 0);
        pos.over = !!state.over;
        pos.winner = state.over ? state.winner : -1;
        return pos;
    }
    const isLegal = (pos, i) => pos.own[i] === -1 || pos.own[i] === pos.mover;

    // `rule` = { chainRule, chainLen }: the optional "N explosions win" setting
    function applyInto(src, i, dst, rule) {
        const geo = src.geo, cap = geo.cap, nb = geo.nb, me = src.mover, opp = 1 - me;
        const cnt = dst.cnt, own = dst.own;
        cnt.set(src.cnt); own.set(src.own);
        let myCells = me === 0 ? src.cells0 : src.cells1, oppCells = me === 0 ? src.cells1 : src.cells0;
        if (own[i] === -1) myCells++;
        own[i] = me; cnt[i]++;
        const moved = src.moved | (1 << me), bothMoved = moved === 3;
        const chainRule = rule.chainRule, chainLen = rule.chainLen;
        let chain = 0;                                     // explosions so far in this move
        let wave = dst.waveA, next = dst.waveB, wl = 0;
        const mark = dst.mark;
        if (cnt[i] >= cap[i]) wave[wl++] = i;
        // one iteration = one wave: ChainRules.settle stops before a wave when the board is
        // decided (single owner, everyone moved) or the chain rule is reached
        while (wl > 0) {
            if (bothMoved && oppCells === 0) break;
            if (chainRule && chain >= chainLen) break;
            chain += wl;
            // detonations and landings of a wave commute (all cells of a wave are the
            // mover's), so they can be fused; the owner is refreshed on every landing
            for (let w = 0; w < wl; w++) {
                const k = wave[w], c = cap[k];
                mark[k] = 0;
                cnt[k] -= c;
                if (cnt[k] === 0) { own[k] = -1; myCells--; }
                for (let q = 0; q < c; q++) {
                    const t = nb[k * 4 + q];
                    if (own[t] !== me) { if (own[t] === opp) oppCells--; own[t] = me; myCells++; }
                    cnt[t]++;
                }
            }
            // the next wave: every touched cell that is full now
            let nl = 0;
            for (let w = 0; w < wl; w++) {
                const k = wave[w], c = cap[k];
                if (cnt[k] >= c && !mark[k]) { mark[k] = 1; next[nl++] = k; }
                for (let q = 0; q < c; q++) {
                    const t = nb[k * 4 + q];
                    if (cnt[t] >= cap[t] && !mark[t]) { mark[t] = 1; next[nl++] = t; }
                }
            }
            const tmp = wave; wave = next; next = tmp; wl = nl;
        }
        for (let w = 0; w < wl; w++) mark[wave[w]] = 0;   // a stopped chain leaves marks behind
        dst.moved = moved;
        dst.cells0 = me === 0 ? myCells : oppCells;
        dst.cells1 = me === 0 ? oppCells : myCells;
        dst.over = (chainRule && chain >= chainLen) || (bothMoved && oppCells === 0);
        dst.winner = dst.over ? me : -1;
        dst.mover = opp;
        return dst;
    }
    // convenience for tests and the estimator: apply on a fresh copy
    const apply = (pos, i, rule) => applyInto(pos, i, makePos(pos.geo), rule || { chainRule: false, chainLen: 15 });

    /* ---------- evaluation ----------
       Score for the side to move. Every owned cell contributes:
         + pieces
         exposed (an enemy critical cell next to it):  - (2 + pieces), - 2 more if critical
                (the cell is as good as lost, and a critical one explodes for the enemy)
         safe:  corner + 3, edge + 2 (few neighbours: easy to fill, hard to attack)
       Roughly one unit = one piece. Bonuses for own threats (safe critical cells, chain
       potential) were tried and lost in self-play: the opponent's exposure penalty already
       counts them, and the search cashes threats in. Terminal positions never get here. */
    function evaluate(pos, w) {
        const geo = pos.geo, N = geo.N, cap = geo.cap, nb = geo.nb, cnt = pos.cnt, own = pos.own;
        let s0 = 0, s1 = 0;
        for (let i = 0; i < N; i++) {
            const o = own[i];
            if (o < 0) continue;
            const c = cnt[i], k = cap[i], critical = c === k - 1;
            let v = c, exposed = false;
            for (let q = 0; q < k; q++) {
                const t = nb[i * 4 + q];
                if (own[t] === 1 - o && cnt[t] === cap[t] - 1) { exposed = true; break; }
            }
            if (exposed) v -= w.exposed + c + (critical ? w.exposedCrit : 0);
            else v += k === 2 ? w.corner : k === 3 ? w.edge : 0;
            if (o === 0) s0 += v; else s1 += v;
        }
        return pos.mover === 0 ? s0 - s1 : s1 - s0;
    }

    /* ---------- move ordering ----------
       A cheap static guess of how promising a move is, for alpha-beta only: explosions
       first (bigger captures and chains first), then moves that build a safe critical
       cell or a corner/edge, moves next to an enemy critical cell last. */
    function orderScore(pos, i) {
        const geo = pos.geo, cap = geo.cap, nb = geo.nb, cnt = pos.cnt, own = pos.own, me = pos.mover;
        const c = cnt[i], k = cap[i];
        let s;
        if (own[i] === me && c === k - 1) {
            s = 1000;
            for (let q = 0; q < k; q++) {
                const t = nb[i * 4 + q];
                if (own[t] === 1 - me) s += 20 + 10 * cnt[t];
                else if (own[t] === me && cnt[t] === cap[t] - 1) s += 15;
            }
            return s;
        }
        s = 3 * c;
        let exposed = false;
        for (let q = 0; q < k; q++) {
            const t = nb[i * 4 + q];
            if (own[t] === 1 - me) { s += 2 + cnt[t]; if (cnt[t] === cap[t] - 1) exposed = true; }
        }
        if (exposed) s -= 60;
        else { if (c + 1 === k - 1) s += 25; s += k === 2 ? 12 : k === 3 ? 6 : 0; }
        return s;
    }

    /* ---------- search ---------- */
    const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;

    class Search {
        constructor(ttBits, params = DEFAULTS) {
            this.p = params;
            this.ttMask = (1 << ttBits) - 1;
            this.ttKey1 = new Int32Array(1 << ttBits);
            this.ttKey2 = new Int32Array(1 << ttBits);
            this.ttValue = new Int32Array(1 << ttBits);
            this.ttDepth = new Int8Array(1 << ttBits);
            this.ttFlag = new Uint8Array(1 << ttBits);
            this.ttMove = new Int16Array(1 << ttBits);
            this.killers = new Int16Array(128 * 2).fill(-1);
            this.hist = null;                     // history heuristic: [mover][cell] cutoff weight
            this.stack = [];                      // one scratch position per ply
            this.moveBuf = [];                    // one move list (Int16 ids + Int32 scores) per ply
            this.rule = { chainRule: false, chainLen: 15 };
            this.deadline = null;
            this.aborted = false;
            this.nodes = 0;
        }
        reset(geo, rule, deadline) {
            this.rule = rule; this.deadline = deadline; this.aborted = false; this.nodes = 0;
            this.ttFlag.fill(0);
            this.killers.fill(-1);
            if (!this.hist || this.hist.length !== geo.N * 2) this.hist = new Int32Array(geo.N * 2); else this.hist.fill(0);
            if (this.stack.length === 0 || this.stack[0].geo !== geo) {
                this.stack = Array.from({ length: 128 }, () => makePos(geo));
                this.moveBuf = Array.from({ length: 128 }, () => ({ ids: new Int16Array(geo.N), score: new Int32Array(geo.N) }));
            }
        }
        // one tick per evaluated position; returns true when the budget is gone
        tick() {
            this.nodes++;
            if (this.deadline.tick()) { this.aborted = true; return true; }
            return false;
        }
        // Zobrist key of a settled position into this.h1/this.h2 (no allocation per node)
        hash(pos) {
            const geo = pos.geo, zob = geo.zob, cnt = pos.cnt, own = pos.own;
            let h1 = 0, h2 = 0;
            for (let i = 0; i < geo.N; i++) {
                if (own[i] < 0) continue;
                const k = (i * 12 + (own[i] + 1) * 4 + cnt[i]) * 2;
                h1 ^= zob[k]; h2 ^= zob[k + 1];
            }
            if (pos.mover === 1) { h1 ^= geo.zMover[0]; h2 ^= geo.zMover[1]; }
            if (pos.moved === 3) { h1 ^= geo.zMoved[0]; h2 ^= geo.zMoved[1]; }
            this.h1 = h1; this.h2 = h2;
        }
        // legal moves of a ply, best guess first (TT move, killers, static order)
        genMoves(pos, ply, ttMove) {
            const buf = this.moveBuf[ply], ids = buf.ids, score = buf.score, N = pos.geo.N;
            const k0 = this.killers[ply * 2], k1 = this.killers[ply * 2 + 1];
            const hist = this.p.history ? this.hist : null, hbase = pos.mover * N;
            let m = 0;
            for (let i = 0; i < N; i++) {
                if (!isLegal(pos, i)) continue;
                let s = orderScore(pos, i);
                if (i === ttMove) s += 100000; else if (i === k0 || i === k1) s += 500;
                if (hist) s += Math.min(400, hist[hbase + i] >> 2);
                // insertion sort by descending score; stable, so ties keep cell order
                let j = m++;
                while (j > 0 && score[j - 1] < s) { ids[j] = ids[j - 1]; score[j] = score[j - 1]; j--; }
                ids[j] = i; score[j] = s;
            }
            return m;
        }
        // negamax with alpha-beta; scores are for pos.mover, mate distances from the root
        negamax(pos, depth, ply, alpha, beta) {
            if (this.tick()) return 0;
            if (pos.over) return -(WIN - ply);
            if (depth <= 0) return this.quiesce(pos, ply, alpha, beta, this.p.qdepth);
            this.hash(pos);
            const h1 = this.h1, h2 = this.h2, slot = h1 & this.ttMask;
            let ttMove = -1;
            if (this.ttFlag[slot] && this.ttKey1[slot] === h1 && this.ttKey2[slot] === h2) {
                ttMove = this.ttMove[slot];
                if (this.ttDepth[slot] >= depth) {
                    let v = this.ttValue[slot];
                    if (v > WIN_MIN) v -= ply; else if (v < -WIN_MIN) v += ply;
                    const f = this.ttFlag[slot];
                    if (f === TT_EXACT || (f === TT_LOWER && v >= beta) || (f === TT_UPPER && v <= alpha)) return v;
                }
            }
            const alpha0 = alpha;
            const m = this.genMoves(pos, ply, ttMove), ids = this.moveBuf[ply].ids;
            if (m === 0) return evaluate(pos, this.p);               // cannot happen in a legal game; stay safe
            const child = this.stack[ply + 1], cap = pos.geo.cap, p = this.p;
            let best = -INF, bestMove = -1;
            for (let x = 0; x < m; x++) {
                const i = ids[x];
                applyInto(pos, i, child, this.rule);
                let v;
                // the child buffer is untouched by its own subtree, so a re-search reuses it
                const explosive = pos.cnt[i] === cap[i] - 1;
                if (p.lmr && depth >= 3 && x >= 3 && !explosive) {
                    // late quiet move: reduced depth, null window; full re-search if it surprises
                    v = -this.negamax(child, depth - 2, ply + 1, -alpha - 1, -alpha);
                    if (v > alpha && !this.aborted) v = -this.negamax(child, depth - 1, ply + 1, -beta, -alpha);
                } else if (p.pvs && x > 0) {
                    v = -this.negamax(child, depth - 1, ply + 1, -alpha - 1, -alpha);
                    if (v > alpha && v < beta && !this.aborted) v = -this.negamax(child, depth - 1, ply + 1, -beta, -alpha);
                } else {
                    v = -this.negamax(child, depth - 1, ply + 1, -beta, -alpha);
                }
                if (this.aborted) return 0;
                if (v > best) { best = v; bestMove = i; }
                if (v > alpha) {
                    alpha = v;
                    if (alpha >= beta) {
                        const k = ply * 2;
                        if (this.killers[k] !== i) { this.killers[k + 1] = this.killers[k]; this.killers[k] = i; }
                        if (!explosive) this.hist[pos.mover * pos.geo.N + i] += depth * depth;
                        break;
                    }
                }
            }
            // store (root-relative mate scores become node-relative)
            let stored = best;
            if (stored > WIN_MIN) stored += ply; else if (stored < -WIN_MIN) stored -= ply;
            this.ttKey1[slot] = h1; this.ttKey2[slot] = h2; this.ttValue[slot] = stored;
            this.ttDepth[slot] = depth; this.ttMove[slot] = bestMove;
            this.ttFlag[slot] = best <= alpha0 ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
            return best;
        }
        // stand pat, then only explosions that capture enemy cells (the mover's threats)
        quiesce(pos, ply, alpha, beta, qd) {
            if (this.tick()) return 0;
            if (pos.over) return -(WIN - ply);
            const stand = evaluate(pos, this.p);
            if (qd <= 0 || stand >= beta) return stand;
            if (stand > alpha) alpha = stand;
            const geo = pos.geo, cap = geo.cap, nb = geo.nb, cnt = pos.cnt, own = pos.own, me = pos.mover;
            const child = this.stack[ply + 1];
            let best = stand;
            for (let i = 0; i < geo.N; i++) {
                if (own[i] !== me || cnt[i] !== cap[i] - 1) continue;
                let captures = false;
                for (let q = 0; q < cap[i]; q++) if (own[nb[i * 4 + q]] === 1 - me) { captures = true; break; }
                if (!captures) continue;
                applyInto(pos, i, child, this.rule);
                const v = -this.quiesce(child, ply + 1, -beta, -alpha, qd - 1);
                if (this.aborted) return 0;
                if (v > best) best = v;
                if (v > alpha) { alpha = v; if (alpha >= beta) break; }
            }
            return best;
        }
        /* iterative deepening from the root, as a generator that yields the node count after
           every root move (so a caller can let the page breathe) and returns
           { move, score, depth, nodes }. The move is always legal: the statically best one
           until a ply completes. */
        *iterate(pos, maxDepth) {
            const root = this.stack[0];
            root.cnt.set(pos.cnt); root.own.set(pos.own);
            root.mover = pos.mover; root.moved = pos.moved; root.cells0 = pos.cells0; root.cells1 = pos.cells1; root.over = false;
            const m = this.genMoves(root, 0, -1), order = Array.from(this.moveBuf[0].ids.subarray(0, m));
            const result = { move: order[0], score: 0, depth: 0, nodes: 0 };
            if (m === 1) return result;
            const child = this.stack[1];
            for (let depth = 1; depth <= maxDepth; depth++) {
                let alpha = -INF, best = -INF, bestMove = -1, done = 0;
                for (const i of order) {
                    applyInto(root, i, child, this.rule);
                    const v = -this.negamax(child, depth - 1, 1, -INF, -alpha);
                    if (this.aborted) break;
                    done++;
                    if (v > best) { best = v; bestMove = i; }
                    if (v > alpha) alpha = v;
                    yield this.nodes;
                }
                // the previous best is searched first, so a partial iteration that finished
                // at least that move is still an improvement over the last depth
                if (done > 0) { result.move = bestMove; result.score = best; result.depth = this.aborted ? depth - 1 : depth; }
                if (this.aborted) break;
                order.splice(order.indexOf(bestMove), 1); order.unshift(bestMove);
                if (best > WIN_MIN || best < -WIN_MIN) break;      // forced result: deeper cannot improve
            }
            result.nodes = this.nodes;
            return result;
        }
        // synchronous search (estimator)
        run(pos, maxDepth) {
            const it = this.iterate(pos, maxDepth);
            for (;;) { const s = it.next(); if (s.done) return s.value; }
        }
        // search that awaits `breathe()` every `every` nodes (the strong levels in the app)
        async runAsync(pos, maxDepth, every, breathe) {
            const it = this.iterate(pos, maxDepth);
            let last = 0;
            for (;;) {
                const s = it.next();
                if (s.done) return s.value;
                if (s.value - last >= every) { last = s.value; await breathe(); }
            }
        }
        /* Judge (win-chance evaluation): iterative deepening over the given depth list,
           yielding the node count after every root move like iterate(), returning the
           scores of the depths that were fully completed: [{ depth, score }] for pos.mover,
           starting with depth 0 = the quiescence value of the root itself. A depth the
           budget cuts short is dropped entirely — a partial iteration would judge some
           moves deeper than others — and the loop stops once a depth proves a forced
           result (deeper cannot change it). */
        *judge(pos, depths) {
            const root = this.stack[0];
            root.cnt.set(pos.cnt); root.own.set(pos.own);
            root.mover = pos.mover; root.moved = pos.moved; root.cells0 = pos.cells0; root.cells1 = pos.cells1; root.over = false;
            const scores = [];
            const q = this.quiesce(root, 0, -INF, INF, this.p.qdepth);
            if (this.aborted) return scores;
            scores.push({ depth: 0, score: q });
            yield this.nodes;
            if (q > WIN_MIN || q < -WIN_MIN) return scores;
            const m = this.genMoves(root, 0, -1), order = Array.from(this.moveBuf[0].ids.subarray(0, m));
            const child = this.stack[1];
            for (const depth of depths) {
                let alpha = -INF, best = -INF, bestMove = -1;
                for (const i of order) {
                    applyInto(root, i, child, this.rule);
                    const v = -this.negamax(child, depth - 1, 1, -INF, -alpha);
                    if (this.aborted) return scores;
                    if (v > best) { best = v; bestMove = i; }
                    if (v > alpha) alpha = v;
                    yield this.nodes;
                }
                scores.push({ depth, score: best });
                order.splice(order.indexOf(bestMove), 1); order.unshift(bestMove);
                if (best > WIN_MIN || best < -WIN_MIN) break;
            }
            return scores;
        }
    }

    /* ---------- levels ---------- */
    const LEVELS = {
        easy: { depth: 1, noise: 0.3, spread: 3, yields: false },
        normal: { depth: 2, noise: 0, spread: 0, yields: false },
        hard: { depth: 4, noise: 0, spread: 0, yields: true },
        veryhard: { depth: 60, noise: 0, spread: 0, yields: true },
    };
    const ruleOf = (state) => ({ chainRule: !!state.chainRule, chainLen: state.chainLen || 15 });

    // Easy: one ply, but not always the best of it: sometimes a random move, otherwise one
    // of the top `spread` moves (a beginner who sees explosions but not what follows)
    function easyMove(pos, rule, tools, level, deadline) {
        const N = pos.geo.N, legal = [];
        for (let i = 0; i < N; i++) if (isLegal(pos, i)) legal.push(i);
        if (tools.random() < level.noise) return tools.pick(legal);
        const child = makePos(pos.geo), scored = [];
        for (const i of legal) {
            deadline.tick();
            applyInto(pos, i, child, rule);
            scored.push({ i, v: child.over ? WIN : -evaluate(child, DEFAULTS) });
        }
        scored.sort((a, b) => b.v - a.v || a.i - b.i);
        return tools.pick(scored.slice(0, level.spread)).i;
    }

    /* ---------- Judge: win-chance evaluation for the HUD ----------
       evaluate(state, tools) → raw score for PLAYER 0 (0 = even, + = player 0 better,
       ±Infinity = decided by rule or proven within the search), in the evaluation's units
       (≈ pieces of advantage). The framework maps it to a probability with a calibration
       fitted from self-play, so only consistency matters here — and stability: the HUD
       must not flip from move to move because a shallow search always hands the side to
       move the initiative (the odd/even horizon effect of Chain React). Hence:
       - iterative deepening over EVEN depths only (both sides get to answer; blending
         odd and even depths brought the zigzag back, because which depths complete
         changes with the mover),
       - only fully completed depths count; the value is the mean of the last three
         completed ones (depth 0 = the root's quiescence value, so a 2 000-node call on
         6×6 blends depths 0 and 2, 12 000 nodes 0, 2 and 4) — measured on self-play, the
         blend is smoother AND predicts the outcome better than the last depth alone,
       - a deep quiescence over explosive captures at every leaf, so no forced chain is
         left hanging in the static evaluation (quiescence 3 → 10 halved the swing),
       - no late-move reductions (they judge some moves shallower than others).
       Tried and rejected: a "tempo-neutral" leaf (quiescence for the mover averaged with
       the opponent's on the null move) — in Chain React the side not to move nearly
       always has a capture threat, so it doubled the swing instead of removing it.
       Budget: tools.budget.nodes exactly (deadline().tick() per node, no wall clock), so
       a given budget gives the same number on every client. Above YIELD_BUDGET nodes the
       search awaits tools.yield() every YIELD_EVERY nodes and returns a Promise; below it
       the number comes back synchronously. A pooled Search per call keeps a pending
       background refinement and a fresh quick call from sharing scratch buffers. */
    const JUDGE = { ...DEFAULTS, qdepth: 10, lmr: false, evenOnly: true, blend: 3 };
    const JUDGE_MAX_DEPTH = 40;
    const YIELD_BUDGET = 5000;                              // node budgets above this yield to the page
    const judgePool = [];
    function judgeDepths() {
        const out = [];
        for (let d = JUDGE.evenOnly ? 2 : 1; d <= JUDGE_MAX_DEPTH; d += JUDGE.evenOnly ? 2 : 1) out.push(d);
        return out;
    }
    // completed scores (for pos.mover) → raw score for player 0
    function judgeValue(pos, scores) {
        let v;
        if (scores.length === 0) v = evaluate(pos, JUDGE);               // budget too small for a single quiescence
        else {
            const last = scores[scores.length - 1].score;
            if (last > WIN_MIN) v = Infinity;
            else if (last < -WIN_MIN) v = -Infinity;
            else {
                const k = Math.min(JUDGE.blend, scores.length);
                v = 0;
                for (let j = scores.length - k; j < scores.length; j++) v += scores[j].score;
                v /= k;
            }
        }
        return pos.mover === 0 ? v : -v;
    }
    function evaluateState(state, tools) {
        if (state.over) return state.winner === 0 ? Infinity : state.winner === 1 ? -Infinity : 0;
        if (state.players !== 2) return 0;
        const pos = fromState(state), rule = ruleOf(state);
        const budget = tools.budget.nodes, deadline = tools.deadline();
        const search = judgePool.pop() || new Search(15, JUDGE);
        search.p = JUDGE;
        search.reset(pos.geo, rule, deadline);
        const it = search.judge(pos, judgeDepths());
        const finish = (scores) => { judgePool.push(search); return judgeValue(pos, scores); };
        if (!(budget > YIELD_BUDGET)) {
            for (;;) { const s = it.next(); if (s.done) return finish(s.value); }
        }
        return (async () => {
            let last = 0;
            for (;;) {
                const s = it.next();
                if (s.done) return finish(s.value);
                if (s.value - last >= YIELD_EVERY) { last = s.value; await tools.yield(); }
            }
        })();
    }

    const def = Bots.register({
        id: "creeper-chain",
        name: "Creeper",
        game: "chain",
        version: 1,
        description: "Looks ahead and blows things up. Very hard searches as deep as its budget allows.",
        difficulties: [
            { id: "easy", label: "Easy", nodes: 2000 },          // node budgets: deterministic strength on every device
            { id: "normal", label: "Normal", nodes: 10000 },     // (depth-2 finishes early; the cap only guards huge boards)
            { id: "hard", label: "Hard", nodes: 30000 },
            { id: "veryhard", label: "Very hard", nodes: 100000 },   // ~0.15 s on a desktop, a second or two on a slow phone
        ],
        create(tools) {
            const level = LEVELS[tools.difficulty] || LEVELS.normal;
            const search = new Search(16);
            return {
                async move(state) {
                    if (state.players !== 2) return tools.pick(tools.legalMoves(state));   // the engine knows two seats
                    const pos = fromState(state), rule = ruleOf(state);
                    const deadline = tools.deadline();
                    tools.report({ depth: 1, value: null });
                    if (level.depth === 1) return easyMove(pos, rule, tools, level, deadline);
                    search.reset(pos.geo, rule, deadline);
                    const r = level.yields ? await search.runAsync(pos, level.depth, YIELD_EVERY, tools.yield) : search.run(pos, level.depth);
                    tools.report({ depth: r.depth, value: r.score });
                    return r.move;
                },
            };
        },
        evaluate: evaluateState,
    });
    // internals for bot.test.mjs (rules equivalence, evaluation, search) — not part of the bot API
    def.internals = { geometry, fromState, apply, applyInto, makePos, evaluate, Search, DEFAULTS, JUDGE, LEVELS, WIN, WIN_MIN };
})();
