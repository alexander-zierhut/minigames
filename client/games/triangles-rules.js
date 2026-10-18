/* Triangles rules (pure, no DOM). A hexagonal pegboard with n pegs per side: a move
   stretches one band in a straight line across pegs, every small triangle whose third
   side it covers goes to the mover (a token on it), and the turn passes (no extra turn for
   claiming). `band` is the band length in unit edges (3 = exactly 4 pegs, the box rules;
   2 = exactly 3 pegs; 0 = any length from 1 to 3 edges), `touch` = a band must share a peg
   with a band already on the board (the first one is free; off unless the config says
   `true`, as the real players lay bands anywhere), `tokens` = tokens per player
   (reaching the number wins at once; 0 = no limit). Without a limit, or once no band may be
   stretched any more, most triangles wins among the seats still in.

   Numbering (binding for history, sync, replay, records, puzzles and the e2e tests),
   m = n - 1:
   - Pegs are the lattice points (q, r) with |q| <= m, |r| <= m, |q + r| <= m (axial
     coordinates), indexed row by row r = -m … m, inside a row q ascending. V = 3m² + 3m + 1.
     Directions D0 = (1, 0), D1 = (0, 1), D2 = (-1, 1); pixel position x = q + r / 2,
     y = r * sqrt(3) / 2 (flat top and bottom).
   - Edges (the engine's cells): for every peg p in index order, for d = 0, 1, 2, the edge
     (p, p + Dd) if p + Dd is inside. E = 9m² + 3m. `cells[e]` = the seat that first covered
     edge e, -1 = uncovered.
   - Triangles: for every peg p in index order TA(p) = { p, p + D0, p + D1 } (points down),
     then TB(p) = { p, p + D1, p + D2 } (points up), each when all three pegs are inside.
     T = 6m². `tris[t]` = owner, -1 = unclaimed.
   - A move is one band between pegs a < b on one lattice line: move = a * V + b.
   Geometry is memoised per n and never lives in the state (bots and the session clone it). */

"use strict";

const TrianglesRules = (() => {
    const DIRS = [[1, 0], [0, 1], [-1, 1]];
    const MAX_LEN = 3;                                       // the longest band, in unit edges
    const GEO = {};

    /* Everything about a board of n pegs per side, computed once:
       { m, V, E, T, pegs: [{ q, r, x, y }], edges: [{ a, b, d }], tris: [{ pegs, edges }],
         trisOf: [[t…] per edge], edgeAt(a, b) → e | -1, lines: [{ d, pegs }],
         bands: [[], [len 1…], [len 2…], [len 3…]], bandOf: Map(move → band) } */
    function geometry(n) {
        if (GEO[n]) return GEO[n];
        const m = n - 1, w = 2 * m + 1;
        const inside = (q, r) => Math.abs(q) <= m && Math.abs(r) <= m && Math.abs(q + r) <= m;
        const at = new Array(w * w).fill(-1);
        const idx = (q, r) => (inside(q, r) ? at[(r + m) * w + q + m] : -1);
        const pegs = [];
        for (let r = -m; r <= m; r++) {
            for (let q = Math.max(-m, -m - r); q <= Math.min(m, m - r); q++) {
                at[(r + m) * w + q + m] = pegs.length;
                pegs.push({ q, r, x: q + r / 2, y: r * Math.sqrt(3) / 2 });
            }
        }
        const V = pegs.length;
        const step = (p, d) => idx(pegs[p].q + DIRS[d][0], pegs[p].r + DIRS[d][1]);
        const edges = [], edgeKey = new Map();
        for (let p = 0; p < V; p++) {
            for (let d = 0; d < 3; d++) {
                const b = step(p, d);
                if (b < 0) continue;
                edgeKey.set(p * V + b, edges.length);
                edges.push({ a: p, b, d });
            }
        }
        const edgeAt = (a, b) => {
            const e = edgeKey.get(Math.min(a, b) * V + Math.max(a, b));
            return e === undefined ? -1 : e;
        };
        const tris = [], trisOf = edges.map(() => []);
        const addTri = (ps) => {
            const es = [edgeAt(ps[0], ps[1]), edgeAt(ps[0], ps[2]), edgeAt(ps[1], ps[2])];
            for (const e of es) trisOf[e].push(tris.length);
            tris.push({ pegs: ps, edges: es });
        };
        for (let p = 0; p < V; p++) {
            const a0 = step(p, 0), a1 = step(p, 1), a2 = step(p, 2);
            if (a0 >= 0 && a1 >= 0) addTri([p, a0, a1]);
            if (a1 >= 0 && a2 >= 0) addTri([p, a1, a2]);
        }
        // the lattice lines: start where the peg before is outside, walk while inside
        const lines = [];
        for (let p = 0; p < V; p++) {
            for (let d = 0; d < 3; d++) {
                if (idx(pegs[p].q - DIRS[d][0], pegs[p].r - DIRS[d][1]) >= 0) continue;
                const line = [p];
                for (let x = step(p, d); x >= 0; x = step(x, d)) line.push(x);
                if (line.length >= 2) lines.push({ d, pegs: line });
            }
        }
        // every band of 1…3 unit edges on every line; a band is immutable (decode hands it out)
        const bands = [[], [], [], []], bandOf = new Map();
        for (const { d, pegs: line } of lines) {
            for (let i = 0; i < line.length; i++) {
                for (let len = 1; len <= MAX_LEN && i + len < line.length; len++) {
                    const ps = line.slice(i, i + len + 1);
                    const es = [];
                    for (let k = 0; k < len; k++) es.push(edgeAt(ps[k], ps[k + 1]));
                    const a = ps[0], b = ps[len];
                    const band = Object.freeze({ move: a * V + b, a, b, d, len, pegs: Object.freeze(ps), edges: Object.freeze(es) });
                    bands[len].push(band);
                    bandOf.set(band.move, band);
                }
            }
        }
        GEO[n] = { m, V, E: edges.length, T: tris.length, pegs, edges, tris, trisOf, edgeAt, lines, bands, bandOf };
        return GEO[n];
    }
    const geo = (state) => geometry(state.n);
    const allowed = (state, len) => (state.band === 0 ? len >= 1 && len <= MAX_LEN : len === state.band);

    /* ---------- moves: one integer per band ---------- */
    // the order of the two pegs does not matter: one band is one integer everywhere
    const encode = (state, a, b) => Math.min(a, b) * geo(state).V + Math.max(a, b);
    // { move, a, b, d, len, pegs, edges } of a band this game allows, else null (frozen: read only)
    function decode(state, move) {
        const g = geo(state);
        if (!Number.isInteger(move) || move < 0 || move >= g.V * g.V) return null;
        const band = g.bandOf.get(move);
        return band && allowed(state, band.len) ? band : null;
    }
    const bandEdges = (state, move) => { const b = decode(state, move); return b ? b.edges.slice() : []; };
    // every cell of a move (the premove marker, #37): the band's edges
    const cellsOf = bandEdges;
    // the middle edge of the band: the last-move and best-move marker
    const cellOf = (state, move) => { const b = decode(state, move); return b ? b.edges[(b.len - 1) >> 1] : -1; };

    function create(config, base) {
        const n = config.n || 4;
        const g = geometry(n);
        const raw = config.band === undefined || config.band === null ? 3 : Number(config.band);
        return Object.assign(base, {
            n,
            cells: new Array(g.E).fill(-1),                  // owner per edge, -1 = uncovered
            tris: new Array(g.T).fill(-1),                   // owner per triangle, -1 = unclaimed
            scores: new Array(base.players).fill(0),         // triangles per seat (= tokens placed)
            band: raw === 0 || raw === 2 || raw === 3 ? raw : 3,
            touch: config.touch === true,                    // undefined, null and false: bands anywhere
            tokens: config.tokens === undefined ? 21 : (Number(config.tokens) > 0 ? Number(config.tokens) : 0),
            touched: new Array(g.V).fill(0),                 // bands through every peg
            lastEdges: [],                                   // the edges of the last band
            lastTris: [],                                    // the triangles the last band claimed (the view pops them)
        });
    }

    const ownerOf = (state, e) => state.cells[e];

    function isLegal(state, move, player) {
        if (state.over) return false;
        const band = decode(state, move);
        if (!band) return false;
        let open = false;
        for (const e of band.edges) if (state.cells[e] === -1) { open = true; break; }
        if (!open) return false;
        if (!state.touch || state.history.length === 0) return true;
        for (const p of band.pegs) if (state.touched[p] > 0) return true;
        return false;
    }

    /* The legal bands and the edges that lie on one, memoised per state object and position
       (history length and last move, which also tells apart a make / unmake at the same depth):
       the engine asks canPlay for every edge on every render. */
    const memo = new WeakMap();
    function legal(state) {
        const h = state.history, key = h.length ? h.length * 1e9 + h[h.length - 1] : 0;
        const hit = memo.get(state);
        if (hit && hit.key === key) return hit;
        const g = geo(state), moves = [], onLegal = new Array(g.E).fill(false);
        for (let len = 1; len <= MAX_LEN; len++) {
            if (!allowed(state, len)) continue;
            for (const band of g.bands[len]) {
                if (!isLegal(state, band.move, state.current)) continue;
                moves.push(band.move);
                for (const e of band.edges) onLegal[e] = true;
            }
        }
        const entry = { key, moves, onLegal };
        memo.set(state, entry);
        return entry;
    }
    // every legal band (the player does not matter), [] once the game is over
    const legalMoves = (state) => (state.over ? [] : legal(state).moves.slice());
    // may a move start on edge e: it is uncovered and lies on a legal band (the `can-place` cells)
    const canPlay = (state, e, player) => !state.over && state.cells[e] === -1 && legal(state).onLegal[e] === true;

    /* ---------- the move ---------- */
    function place(state, move, player) {
        const band = decode(state, move);
        state.history.push(move);
        state.movesBy[player]++;
        for (const e of band.edges) if (state.cells[e] === -1) state.cells[e] = player;
        for (const p of band.pegs) state.touched[p]++;
        state.lastEdges = band.edges.slice();
        state.lastTris = [];
    }
    // every triangle the band closed goes to the mover (a band covers at most one side of each)
    function settle(state, player) {
        const g = geo(state);
        for (const e of state.lastEdges) {
            for (const t of g.trisOf[e]) {
                if (state.tris[t] !== -1 || sides(state, t) !== 3) continue;
                state.tris[t] = player;
                state.scores[player]++;
                state.lastTris.push(t);
            }
        }
    }
    function conclude(state, player) {
        if (state.tokens > 0 && state.scores[player] >= state.tokens) return { winner: player, why: { k: "why.triangles.all" } };
        if (legalMoves(state).length === 0) {                       // nothing may be stretched: count the triangles
            const left = Rules.remaining(state);
            const best = left.reduce((mx, p) => Math.max(mx, state.scores[p]), -1);
            const top = left.filter((p) => state.scores[p] === best);
            if (top.length === 1) return { winner: top[0], why: { k: "why.triangles.most", count: best } };
            return { winner: -1, why: { k: "why.triangles.tied" } };
        }
        const left = Rules.remaining(state);
        if (state.players > 2 && left.length === 1) return { winner: left[0], why: { k: "why.triangles.out" } };   // a safety net: Rules.eliminate ends it first
        Rules.pass(state);
        return null;
    }

    /* ---------- board analysis (bots, the estimate, the solver and the puzzle verifier) ---------- */
    // covered sides of triangle t (0…3)
    function sides(state, t) {
        let k = 0;
        for (const e of geo(state).tris[t].edges) if (state.cells[e] !== -1) k++;
        return k;
    }
    // unclaimed triangles next to the band's uncovered edges with exactly `before` sides
    function next(state, move, before) {
        const band = decode(state, move);
        if (!band) return 0;
        const g = geo(state);
        let k = 0;
        for (const e of band.edges) {
            if (state.cells[e] !== -1) continue;
            for (const t of g.trisOf[e]) if (state.tris[t] === -1 && sides(state, t) === before) k++;
        }
        return k;
    }
    // how many triangles the band would claim right now
    const claims = (state, move) => next(state, move, 2);
    // how many triangles the band would hand over: one covered side before, two after
    const opens = (state, move) => next(state, move, 1);
    // the unclaimed triangles with two covered sides: what the next band may claim
    function onTable(state) {
        const out = [];
        for (let t = 0; t < state.tris.length; t++) if (state.tris[t] === -1 && sides(state, t) === 2) out.push(t);
        return out;
    }
    const safeMoves = (state) => legalMoves(state).filter((mv) => opens(state, mv) === 0);
    const claimingMoves = (state) => legalMoves(state).filter((mv) => claims(state, mv) > 0);
    // how many triangles nobody owns yet
    const left = (state) => state.tris.reduce((k, o) => k + (o === -1 ? 1 : 0), 0);

    /* Fallback win estimate (probability that seat 0 wins) until a bot offers evaluate():
       the triangles already won against the best other seat, plus a share of what lies on
       the table for the seat to move. Nothing on the table = no term, so a quiet position
       does not flip from move to move. */
    function estimate(state) {
        const done = Rules.decided(state);
        if (done !== null) return done;
        let other = 0;
        for (let p = 1; p < state.players; p++) if (!state.out[p]) other = Math.max(other, state.scores[p]);
        const diff = state.scores[0] - other;
        const rest = left(state);
        const table = Math.min(onTable(state).length, 2) * 0.6;
        const turn = state.current === 0 ? 1 : -1;
        return Rules.sigmoid((diff + turn * table) / Math.max(1.5, Math.sqrt(rest + 1)), 2);
    }

    return {
        create, ownerOf, isLegal, legalMoves, place, settle, conclude, estimate,
        cellOf, cellsOf, canPlay, geometry, encode, decode, bandEdges,
        sides, claims, opens, onTable, safeMoves, claimingMoves, left, MAX_LEN,
    };
})();
Rules.register("triangles", TrianglesRules);
