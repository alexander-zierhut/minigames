/* Triangles: the pure rules in a bare VM context (no DOM). The board is a hexagon of pegs,
   the cells are the unit edges between them and a move is one band, encoded as
   `a * V + b` (a < b, peg indices), so everything the framework does with a history (sync,
   session, record, replay, the replay bar) keeps working unchanged. The engine and the view
   follow in their own section at the end of the file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadDom, hooks } from "./dom.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const FILES = ["client/lib/util.js", "client/games/rules.js", "client/games/triangles-rules.js"];
function loadRules() {
    const ctx = vm.createContext({ document: undefined });
    for (const f of FILES) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
    return vm.runInContext("({ Rules, TrianglesRules })", ctx);
}
const J = (a) => JSON.stringify(a);

/* ---------------- the pure rules, no DOM ---------------- */
function pure(config = {}) {
    const { Rules, TrianglesRules } = loadRules();
    const cfg = { n: 4, players: 2, ...config };
    return { Rules, R: TrianglesRules, s: Rules.create(cfg, TrianglesRules) };
}
function step(Rules, R, s, m) {
    assert.equal(R.isLegal(s, m, s.current), true, `move ${m} legal for ${s.current}`);
    return Rules.step(R, s, m);
}
// peg index of (q, r), and the band between two pegs given by their coordinates
const peg = (R, s, q, r) => R.geometry(s.n).pegs.findIndex((p) => p.q === q && p.r === r);
const band = (R, s, q1, r1, q2, r2) => R.encode(s, peg(R, s, q1, r1), peg(R, s, q2, r2));
const edge = (R, s, q1, r1, q2, r2) => R.geometry(s.n).edgeAt(peg(R, s, q1, r1), peg(R, s, q2, r2));
// a small seeded generator (the bare context has no Bots.rng)
const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function randomGame(config, seed) {
    const { Rules, R, s } = pure(config);
    const rnd = lcg(seed);
    while (!s.over) { const ms = R.legalMoves(s); Rules.step(R, s, ms[Math.floor(rnd() * ms.length)]); }
    return { Rules, R, s };
}

test("no DOM needed: the rules load in a bare context and register themselves", () => {
    const { Rules, TrianglesRules } = loadRules();
    assert.equal(Rules.of("triangles"), TrianglesRules);
    for (const f of ["create", "ownerOf", "isLegal", "canPlay", "cellOf", "legalMoves", "place", "settle", "conclude", "estimate", "geometry", "encode", "decode", "bandEdges", "sides", "claims", "opens", "onTable", "safeMoves", "claimingMoves", "left"]) {
        assert.equal(typeof TrianglesRules[f], "function", f);
    }
});

test("geometry for n = 3 … 7: pegs, edges, triangles, and how they hang together", () => {
    const { R } = pure();
    for (let n = 3; n <= 7; n++) {
        const g = R.geometry(n), m = n - 1;
        assert.equal(g.m, m);
        assert.equal(g.V, 3 * m * m + 3 * m + 1, `n=${n}: pegs`); assert.equal(g.pegs.length, g.V);
        assert.equal(g.E, 9 * m * m + 3 * m, `n=${n}: edges`); assert.equal(g.edges.length, g.E);
        assert.equal(g.T, 6 * m * m, `n=${n}: triangles`); assert.equal(g.tris.length, g.T);
        assert.equal(R.geometry(n), g, "memoised");
        // peg order: rows r = -m … m, q ascending inside a row; positions from the axial coordinates
        for (let p = 1; p < g.V; p++) {
            const a = g.pegs[p - 1], b = g.pegs[p];
            assert.ok(a.r < b.r || (a.r === b.r && a.q < b.q), `n=${n}: peg ${p} in order`);
        }
        for (const p of g.pegs) {
            assert.ok(Math.abs(p.q) <= m && Math.abs(p.r) <= m && Math.abs(p.q + p.r) <= m);
            assert.equal(p.x, p.q + p.r / 2); assert.ok(Math.abs(p.y - p.r * Math.sqrt(3) / 2) < 1e-12);
        }
        // every edge joins neighbours a < b in its direction, and edgeAt finds it either way round
        const D = [[1, 0], [0, 1], [-1, 1]];
        g.edges.forEach((e, i) => {
            assert.ok(e.a < e.b);
            assert.equal(g.pegs[e.b].q - g.pegs[e.a].q, D[e.d][0]); assert.equal(g.pegs[e.b].r - g.pegs[e.a].r, D[e.d][1]);
            assert.equal(g.edgeAt(e.a, e.b), i); assert.equal(g.edgeAt(e.b, e.a), i);
        });
        assert.equal(g.edgeAt(0, g.V - 1), -1, "opposite corners are not neighbours");
        // every triangle: three distinct existing edges; every edge: one or two triangles
        g.tris.forEach((t, k) => {
            assert.equal(new Set(t.edges).size, 3, `n=${n}: triangle ${k} has three distinct edges`);
            for (const e of t.edges) { assert.ok(e >= 0 && e < g.E); assert.ok(g.trisOf[e].includes(k)); }
        });
        let rim = 0;
        g.trisOf.forEach((ts, e) => { assert.ok(ts.length === 1 || ts.length === 2, `edge ${e}`); if (ts.length === 1) rim++; });
        assert.equal(rim, 6 * m, `n=${n}: 6m rim edges`);
        // TA / TB cover every triple of mutually adjacent pegs exactly once
        const triples = new Set();
        for (const e of g.edges) {
            for (let c = 0; c < g.V; c++) {
                if (c !== e.a && c !== e.b && g.edgeAt(e.a, c) >= 0 && g.edgeAt(e.b, c) >= 0) triples.add(J([e.a, e.b, c].sort((x, y) => x - y)));
            }
        }
        const listed = g.tris.map((t) => J([...t.pegs].sort((x, y) => x - y)));
        assert.equal(new Set(listed).size, g.T, "no triangle twice");
        assert.equal(triples.size, g.T, "every adjacent triple is a triangle");
        for (const t of listed) assert.ok(triples.has(t));
        // TA = { p, p + D0, p + D1 } points down (its third peg lies below), TB = { p, p + D1, p + D2 } up
        g.tris.forEach((t, k) => {
            const [a, b, c] = t.pegs.map((p) => g.pegs[p]);
            if (a.r === b.r) { assert.equal(b.q, a.q + 1); assert.ok(c.y > a.y, `triangle ${k} (TA) points down`); }
            else { assert.equal(b.r, a.r + 1); assert.equal(c.r, a.r + 1); assert.ok(a.y < b.y, `triangle ${k} (TB) points up`); }
            if (k > 0 && g.tris[k - 1].pegs[0] === t.pegs[0]) assert.equal(a.r === b.r, false, "TA before TB at the same peg");
        });
    }
    // the first rows on n = 3: three pegs in the top row, the first edge goes right
    const g3 = R.geometry(3);
    assert.equal(J(g3.pegs.slice(0, 3).map((p) => [p.q, p.r])), J([[0, -2], [1, -2], [2, -2]]));
    assert.equal(J(g3.edges[0]), J({ a: 0, b: 1, d: 0 }));
});

test("encode normalises the order; decode accepts allowed bands only", () => {
    const { R, s } = pure({ n: 4 });
    const g = R.geometry(4);
    const a = peg(R, s, -1, 0), b = peg(R, s, 2, 0);
    assert.equal(R.encode(s, a, b), a * g.V + b);
    assert.equal(R.encode(s, b, a), a * g.V + b, "either end first, one integer");
    const d = R.decode(s, R.encode(s, a, b));
    assert.equal(d.a, a); assert.equal(d.b, b); assert.equal(d.d, 0); assert.equal(d.len, 3);
    assert.equal(J(d.pegs), J([a, peg(R, s, 0, 0), peg(R, s, 1, 0), b]));
    assert.equal(J(d.edges), J([edge(R, s, -1, 0, 0, 0), edge(R, s, 0, 0, 1, 0), edge(R, s, 1, 0, 2, 0)]));
    assert.equal(J(R.bandEdges(s, R.encode(s, a, b))), J(d.edges));
    assert.equal(R.cellOf(s, R.encode(s, a, b)), edge(R, s, 0, 0, 1, 0), "the middle edge");
    // refused: not an integer, out of range, a >= b, a length the rule does not allow, off a line
    for (const bad of [1.5, -1, g.V * g.V, NaN, "5", null, b * g.V + a, a * g.V + a]) assert.equal(R.decode(s, bad), null, String(bad));
    assert.equal(R.decode(s, band(R, s, -1, 0, 1, 0)), null, "3 pegs under the 4-peg rule");
    assert.equal(R.decode(s, band(R, s, -1, 0, 0, 0)), null, "2 pegs under the 4-peg rule");
    assert.equal(R.decode(s, R.encode(s, peg(R, s, -3, 0), peg(R, s, 1, 0))), null, "5 pegs are never a band");
    assert.equal(R.decode(s, R.encode(s, peg(R, s, 0, 0), peg(R, s, 1, 1))), null, "not on one lattice line");
    assert.equal(J(R.bandEdges(s, band(R, s, -1, 0, 1, 0))), "[]"); assert.equal(R.cellOf(s, 2), -1, "pegs 0 and 2: a 3-peg band");
    // the other band rules
    const two = pure({ n: 4, band: 2 });
    assert.equal(two.R.decode(two.s, band(two.R, two.s, -1, 0, 1, 0)).len, 2);
    assert.equal(two.R.cellOf(two.s, band(two.R, two.s, -1, 0, 1, 0)), edge(two.R, two.s, -1, 0, 0, 0), "an even band marks its first middle edge");
    assert.equal(two.R.decode(two.s, band(two.R, two.s, -1, 0, 2, 0)), null);
    const any = pure({ n: 4, band: 0 });
    for (const [q2, len] of [[0, 1], [1, 2], [2, 3]]) assert.equal(any.R.decode(any.s, band(any.R, any.s, -1, 0, q2, 0)).len, len);
    assert.equal(any.R.decode(any.s, band(any.R, any.s, -1, 0, 3, 0)), null);
    // every legal move decodes and re-encodes to itself
    for (const m of any.R.legalMoves(any.s)) { const x = any.R.decode(any.s, m); assert.equal(any.R.encode(any.s, x.b, x.a), m); }
});

test("create reads band, touch and tokens exactly like the settings defaults", () => {
    const at = (config) => pure({ n: 4, ...config }).s;
    assert.equal(at({}).band, 3); assert.equal(at({ band: undefined }).band, 3); assert.equal(at({ band: null }).band, 3);
    assert.equal(at({ band: 0 }).band, 0, "0 is a value, not a missing key"); assert.equal(at({ band: 2 }).band, 2); assert.equal(at({ band: 3 }).band, 3);
    assert.equal(at({ band: 5 }).band, 3, "anything else falls back to the box rules"); assert.equal(at({ band: 1 }).band, 3);
    assert.equal(at({}).touch, false, "bands anywhere unless the config says otherwise"); assert.equal(at({ touch: undefined }).touch, false); assert.equal(at({ touch: null }).touch, false);
    assert.equal(at({ touch: true }).touch, true); assert.equal(at({ touch: false }).touch, false);
    assert.equal(at({}).tokens, 21); assert.equal(at({ tokens: undefined }).tokens, 21);
    assert.equal(at({ tokens: null }).tokens, 0, "Off in the settings: no limit"); assert.equal(at({ tokens: 0 }).tokens, 0, "a Learn or puzzle config: no limit");
    assert.equal(at({ tokens: 21 }).tokens, 21); assert.equal(at({ tokens: 10 }).tokens, 10);
    const s = at({ players: 3 });
    assert.equal(s.cells.length, 90); assert.ok(s.cells.every((c) => c === -1));
    assert.equal(s.tris.length, 54); assert.equal(s.touched.length, 37);
    assert.equal(J(s.scores), "[0,0,0]"); assert.equal(J(s.lastEdges), "[]"); assert.equal(J(s.lastTris), "[]");
    assert.equal(J(JSON.parse(J(s))), J(s), "the state is plain JSON");
    assert.equal(pure({ n: 4 }).R.ownerOf(s, 0), -1);
});

test("legality: the band rule, a band on covered edges only, and the touch rule", () => {
    // every band value: the lengths it allows, on the empty board
    const count = (config) => { const { R, s } = pure(config); return R.legalMoves(s).length; };
    const g = pure().R.geometry(4);
    assert.equal(count({ band: 3 }), g.bands[3].length);
    assert.equal(count({ band: 2 }), g.bands[2].length);
    assert.equal(count({ band: 0 }), g.bands[1].length + g.bands[2].length + g.bands[3].length);
    // touch on: the first band is free, later bands must share a peg with one on the board, inner pegs included
    const { Rules, R, s } = pure({ n: 4, touch: true });
    assert.equal(R.isLegal(s, band(R, s, -3, 3, 0, 3), 0), true, "anywhere first");
    step(Rules, R, s, band(R, s, -1, 0, 2, 0));
    assert.equal(R.isLegal(s, band(R, s, -3, 3, 0, 3), 1), false, "a band far away does not touch");
    assert.equal(R.isLegal(s, band(R, s, 1, -3, 1, 0), 1), true, "ends on an inner peg of the band on the board");
    assert.equal(R.isLegal(s, band(R, s, 0, -1, 0, 2), 1), true, "crosses it at an inner peg of both");
    assert.equal(R.isLegal(s, band(R, s, 3, -3, 3, 0), 1), false, "stops one peg short");
    assert.equal(R.isLegal(s, band(R, s, -1, 0, 2, 0), 1), false, "every edge already covered");
    assert.equal(R.isLegal(s, band(R, s, 0, 0, 3, 0), 1), true, "a partial overlap still covers one edge");
    step(Rules, R, s, band(R, s, 0, 0, 3, 0));
    assert.equal(s.cells[edge(R, s, 0, 0, 1, 0)], 0, "a covered edge keeps its first owner");
    assert.equal(s.cells[edge(R, s, 2, 0, 3, 0)], 1);
    assert.equal(s.touched[peg(R, s, 1, 0)], 2); assert.equal(s.touched[peg(R, s, 3, 0)], 1); assert.equal(s.touched[peg(R, s, -1, 0)], 1);
    assert.equal(s.touched[peg(R, s, 0, 1)], 0);
    // touch off (the default, and false): anywhere, any time
    for (const config of [{ n: 4 }, { n: 4, touch: false }]) {
        const free = pure(config);
        step(free.Rules, free.R, free.s, band(free.R, free.s, -1, 0, 2, 0));
        assert.equal(free.R.isLegal(free.s, band(free.R, free.s, -3, 3, 0, 3), 1), true, J(config));
        assert.equal(free.R.legalMoves(free.s).length, g.bands[3].length - 1, `${J(config)}: every band but the one on the board`);
    }
    // never once the game is over, and the player does not matter
    assert.equal(R.isLegal(s, band(R, s, 0, -1, 0, 2), 0), true);
    s.over = true;
    assert.equal(R.isLegal(s, band(R, s, 0, -1, 0, 2), 0), false); assert.equal(J(R.legalMoves(s)), "[]");
});

test("canPlay marks exactly the uncovered edges that lie on a legal band", () => {
    const check = (R, s, what) => {
        const on = new Set();
        for (const m of R.legalMoves(s)) for (const e of R.decode(s, m).edges) if (s.cells[e] === -1) on.add(e);
        for (let e = 0; e < s.cells.length; e++) assert.equal(R.canPlay(s, e, s.current), on.has(e), `${what}: edge ${e}`);
        return on.size;
    };
    const { Rules, R, s } = pure({ n: 4, touch: true });
    assert.equal(check(R, s, "empty"), 90, "on n = 4 every edge lies on a 4-peg band");
    step(Rules, R, s, band(R, s, -1, 0, 2, 0));
    const after = check(R, s, "touch");
    assert.ok(after < 87 && after > 20, `only edges on bands through a touched peg (${after})`);
    assert.equal(R.canPlay(s, edge(R, s, 0, 0, 1, 0), 1), false, "a covered edge never");
    const dead = pure({ n: 3 });
    assert.ok(check(dead.R, dead.s, "n = 3") < 42, "the rim of n = 3 is out of reach of a 4-peg band");
    const any = pure({ n: 5, band: 0, touch: false });
    for (const m of [band(any.R, any.s, 0, 0, 2, 0), band(any.R, any.s, -4, 4, -3, 4)]) step(any.Rules, any.R, any.s, m);
    check(any.R, any.s, "any length");
    any.s.over = true;
    assert.equal(any.R.canPlay(any.s, 0, 0), false);
});

/* A position where the band from (-1,0) to (2,0) closes all six triangles along it: the
   twelve other sides, on D1 and D2 lines only, are covered first by single-edge bands, so
   nothing is claimed before (every triangle needs a D0 side). */
const SIDES = [
    [0, -1, 0, 0], [1, -1, 1, 0], [2, -1, 2, 0], [0, -1, -1, 0], [1, -1, 0, 0], [2, -1, 1, 0],
    [-1, 0, -1, 1], [0, 0, 0, 1], [1, 0, 1, 1], [0, 0, -1, 1], [1, 0, 0, 1], [2, 0, 1, 1],
];

test("place and settle: a band claims one, two, or all six triangles along it", () => {
    const six = pure({ n: 4, band: 0, touch: false, tokens: 0 });
    for (const q of SIDES) step(six.Rules, six.R, six.s, band(six.R, six.s, ...q));
    assert.equal(J(six.s.scores), "[0,0]", "nothing claimed yet");
    assert.equal(six.R.onTable(six.s).length, 10, "the six along the row and four more beside them");
    const row = band(six.R, six.s, -1, 0, 2, 0);
    assert.equal(six.R.claims(six.s, row), 6);
    assert.equal(six.s.current, 0);
    step(six.Rules, six.R, six.s, row);
    assert.equal(J(six.s.scores), "[6,0]"); assert.equal(six.s.lastTris.length, 6);
    assert.ok(six.s.lastTris.every((t) => six.s.tris[t] === 0 && six.R.sides(six.s, t) === 3));
    assert.equal(J(six.s.lastEdges), J(six.R.bandEdges(six.s, row)));
    assert.equal(six.s.movesBy[0], 7); assert.equal(six.s.current, 1);
    assert.equal(six.R.left(six.s), 54 - 6);
    // one and two at once: X = (0,0)-(1,0) between the triangle above and the one below
    const { Rules, R, s } = pure({ n: 4, band: 0, touch: false, tokens: 0 });
    const X = band(R, s, 0, 0, 1, 0);
    step(Rules, R, s, band(R, s, 1, -1, 1, 0)); step(Rules, R, s, band(R, s, 1, -1, 0, 0));      // the one above: two sides
    assert.equal(R.claims(s, X), 1); assert.equal(R.opens(s, X), 0, "the one below has no side yet");
    step(Rules, R, s, band(R, s, 0, 0, 0, 1));
    assert.equal(R.claims(s, X), 1); assert.equal(R.opens(s, X), 1, "now X would hand the one below over");
    assert.ok(!R.safeMoves(s).includes(X)); assert.ok(R.claimingMoves(s).includes(X));
    step(Rules, R, s, band(R, s, 1, 0, 0, 1));
    assert.equal(R.claims(s, X), 2);
    assert.equal(s.current, 0);
    step(Rules, R, s, band(R, s, -3, 3, -2, 3));                                                // seat 0 waits
    step(Rules, R, s, X);                                                                     // seat 1 takes both
    assert.equal(J(s.scores), "[0,2]"); assert.equal(s.lastTris.length, 2);
    step(Rules, R, s, band(R, s, -3, 0, -2, 0));
    assert.equal(J(s.lastTris), "[]", "a band that closes nothing claims nothing");
});

test("conclude: all tokens placed wins at once, an overshoot too", () => {
    // tokens 2: seat 0 takes one triangle, then a band that closes two at once (3 >= 2)
    const { Rules, R, s } = pure({ n: 4, band: 0, touch: false, tokens: 2 });
    const seq = [[1, -1, 1, 0], [1, -1, 0, 0], [0, 0, 0, 1], [1, 0, 0, 1],                         // X = (0,0)-(1,0) now closes two
        [-2, 0, -1, 0], [-2, 0, -2, 1], [-1, 0, -2, 1],                                         // seat 0 closes TA(-2, 0)
        [3, -3, 3, -2]];                                                                        // seat 1 elsewhere
    for (const q of seq) assert.equal(step(Rules, R, s, band(R, s, ...q)), null);
    assert.equal(J(s.scores), "[1,0]"); assert.equal(s.current, 0);
    const r = step(Rules, R, s, band(R, s, 0, 0, 1, 0));
    assert.equal(J(r), J({ winner: 0, why: { k: "why.triangles.all" } }));
    assert.equal(s.scores[0], 3, "the score passes the limit"); assert.equal(s.over, true);
    assert.equal(J(R.legalMoves(s)), "[]");
    // exactly the limit, the six-claim band
    const six = pure({ n: 4, band: 0, touch: false, tokens: 6 });
    for (const q of SIDES) step(six.Rules, six.R, six.s, band(six.R, six.s, ...q));
    assert.equal(step(six.Rules, six.R, six.s, band(six.R, six.s, -1, 0, 2, 0)).why.k, "why.triangles.all");
});

test("conclude: nothing left to stretch counts the triangles, a tie is a draw, a seat that is out cannot win", () => {
    const seen = { most: 0, tied: 0 };
    for (let seed = 1; seed <= 40 && !(seen.most && seen.tied); seed++) {
        const { R, s } = randomGame({ n: 3, band: 0, tokens: 0 }, seed);
        assert.equal(R.legalMoves(s).length, 0); assert.equal(R.left(s), 0, "n = 3 with any length: every triangle is claimed");
        assert.equal(s.scores[0] + s.scores[1], 24);
        if (s.scores[0] === s.scores[1]) { assert.equal(s.winner, -1); assert.equal(J(s.finishWhy), J({ k: "why.triangles.tied" })); seen.tied++; }
        else {
            const w = s.scores[0] > s.scores[1] ? 0 : 1;
            assert.equal(s.winner, w); assert.equal(J(s.finishWhy), J({ k: "why.triangles.most", count: s.scores[w] })); seen.most++;
        }
    }
    assert.ok(seen.most && seen.tied, `both endings seen (${J(seen)})`);
    // three players: a seat flagged out near the end leads by far, the count is among the others
    const { Rules, R, s } = pure({ n: 3, band: 0, tokens: 0, players: 3 });
    const rnd = lcg(11);
    const pick = () => { const ms = R.legalMoves(s); return ms[Math.floor(rnd() * ms.length)]; };
    while (s.cells.filter((c) => c === -1).length > 3) Rules.step(R, s, pick());
    assert.equal(s.over, false);
    const outSeat = (s.current + 1) % 3;
    s.out[outSeat] = true; s.scores[outSeat] = 99;                                             // hand-made: flagged out while leading
    let r = null;
    while (!s.over) { assert.notEqual(s.current, outSeat, "skipped"); r = Rules.step(R, s, pick()); }
    const rest = [0, 1, 2].filter((p) => p !== outSeat);
    const best = Math.max(...rest.map((p) => s.scores[p]));
    assert.notEqual(r.winner, outSeat, "the seat that is out cannot win the count");
    if (s.scores[rest[0]] === s.scores[rest[1]]) assert.equal(r.why.k, "why.triangles.tied");
    else { assert.equal(r.why.k, "why.triangles.most"); assert.equal(r.why.count, best); assert.equal(s.scores[r.winner], best); }
});

test("seeded games end on every board and band rule, within the edges there are", () => {
    for (const n of [4, 5]) for (const b of [3, 2, 0]) for (const tokens of [21, 0]) {
        const { R, s } = randomGame({ n, band: b, tokens }, n * 10 + b);
        assert.equal(s.over, true);
        assert.ok(s.history.length <= R.geometry(n).E, `n=${n} band=${b}: ${s.history.length} plies`);
        assert.ok(["why.triangles.all", "why.triangles.most", "why.triangles.tied"].includes(s.finishWhy.k));
        if (tokens === 0) assert.notEqual(s.finishWhy.k, "why.triangles.all", "no limit, no token win");
        if (s.finishWhy.k === "why.triangles.all") assert.ok(s.scores[s.winner] >= tokens);
    }
});

test("analysis helpers on hand-made positions: sides, claims, opens, onTable, safeMoves", () => {
    const { Rules, R, s } = pure({ n: 4, band: 0, touch: false, tokens: 0 });
    assert.equal(R.safeMoves(s).length, R.legalMoves(s).length, "on an empty board every band is safe");
    assert.equal(R.claimingMoves(s).length, 0); assert.equal(J(R.onTable(s)), "[]"); assert.equal(R.left(s), 54);
    const g = R.geometry(4);
    const up = g.trisOf[edge(R, s, 0, 0, 1, 0)].find((t) => g.tris[t].pegs.includes(peg(R, s, 1, -1)));
    step(Rules, R, s, band(R, s, 1, -1, 1, 0));
    assert.equal(R.sides(s, up), 1);
    // a band along (1,-1)…(0,0) would put the second side on `up`: it opens one
    const second = band(R, s, 1, -1, 0, 0);
    assert.equal(R.opens(s, second), 1); assert.equal(R.claims(s, second), 0);
    assert.ok(!R.safeMoves(s).includes(second));
    step(Rules, R, s, second);
    assert.equal(R.sides(s, up), 2); assert.equal(J(R.onTable(s)), J([up]));
    assert.equal(R.claimingMoves(s).length > 0, true);
    for (const m of R.claimingMoves(s)) assert.ok(R.decode(s, m).edges.includes(edge(R, s, 0, 0, 1, 0)), "every claiming band runs through the open side");
    // a longer band through the open side claims it too; the other triangles along it have no side yet
    const long = band(R, s, -1, 0, 2, 0);
    assert.equal(R.claims(s, long), 1); assert.equal(R.opens(s, long), 0);
    assert.ok(R.safeMoves(s).includes(long));
    // a band over covered edges only changes nothing
    step(Rules, R, s, long);
    assert.equal(R.claims(s, band(R, s, 0, 0, 1, 0)), 0); assert.equal(R.opens(s, band(R, s, 0, 0, 1, 0)), 0);
});

test("estimate: 0.5 on the empty board for either mover, inside (0, 1) while it runs, exact once decided", () => {
    const { Rules, R, s } = pure({ n: 4 });
    assert.equal(R.estimate(s), 0.5);
    s.current = 1; assert.equal(R.estimate(s), 0.5, "nothing on the table, no mover bias"); s.current = 0;
    const rnd = lcg(4);
    for (let k = 0; k < 20 && !s.over; k++) {
        Rules.step(R, s, R.legalMoves(s)[Math.floor(rnd() * R.legalMoves(s).length)]);
        const e = R.estimate(s);
        if (!s.over) assert.ok(e > 0 && e < 1, `ply ${k}: ${e}`);
    }
    // ahead is good, behind is bad, the table counts for the seat to move
    const lead = pure({ n: 4, band: 0, touch: false, tokens: 0 });
    for (const q of SIDES) step(lead.Rules, lead.R, lead.s, band(lead.R, lead.s, ...q));
    const before = lead.R.estimate(lead.s);
    assert.ok(before > 0.5, "seat 0 to move with six on the table");
    step(lead.Rules, lead.R, lead.s, band(lead.R, lead.s, -1, 0, 2, 0));
    assert.ok(lead.R.estimate(lead.s) > before, "and better once they are taken");
    const done = randomGame({ n: 3, band: 0, tokens: 0 }, 2);
    assert.equal(done.R.estimate(done.s), done.s.winner < 0 ? 0.5 : done.s.winner === 0 ? 1 : 0);
});

test("n = 3 with 4-peg bands has dead triangles (the registration's minSize is 4 for band 3)", () => {
    const { R, s } = pure({ n: 3, band: 3 });
    const g = R.geometry(3);
    const reach = new Set();
    for (const m of R.legalMoves(s)) for (const e of R.decode(s, m).edges) reach.add(e);
    const dead = g.tris.filter((t) => t.edges.some((e) => !reach.has(e))).length;
    assert.equal(dead, 12, "half of the 24 triangles can never be closed");
    // with 3-peg bands every edge of n = 3 is reachable
    const ok = pure({ n: 3, band: 2 });
    const all = new Set();
    for (const m of ok.R.legalMoves(ok.s)) for (const e of ok.R.decode(ok.s, m).edges) all.add(e);
    assert.equal(all.size, g.E);
});

/* ---------------- the engine and the view (jsdom) ----------------
   The board the view builds (triangles, bands as the cells, pegs on top), the two-click
   band, a claim, the HUD model, both endings, replay == play, the `clicks` hook, the win
   chance rows, the settings rows and the summary. */
function fresh(config = {}, extra = {}) {
    const w = loadDom();
    const G = w.eval("TrianglesGame");
    const { h, calls } = hooks(extra);
    G.newGame({ game: "triangles", n: 4, players: 2, timer: 0, band: 3, touch: false, tokens: 21, ...config, startPlayer: 0 }, h);
    return { w, G, calls, d: w.document, R: w.eval("TrianglesRules"), V: w.eval("TrianglesView") };
}
async function playAll(G, seq) { for (const m of seq) assert.equal(await G.play(m), true, `band ${m} legal`); }
const $$ = (d, sel) => [...d.querySelectorAll(sel)];
const click = (w, el) => el.dispatchEvent(new w.Event("click"));
// the tutorial's opening on n = 4 (left corner to the middle, middle to the bottom right
// corner, middle to the top right corner, a band that hands a triangle over, the claim)
const OPENING = [573, 702, 129, 345];
const CLAIM = 438;                                       // claims triangle 20

test("registry: 3 to 7 pegs per side, default 4, its own size text, premoves on, three dropdown rows", () => {
    const { w } = fresh();
    const def = w.eval("Games.get('triangles')");
    assert.equal(def.size.min, 3); assert.equal(def.size.max, 7); assert.equal(def.size.default, 4);
    assert.equal(J(def.size.presets), "[4,5,6]");
    assert.equal(def.size.text(5), "5 pegs per side");
    assert.equal(def.minSize({ band: 3 }), 4, "a 4-peg band never reaches the rim of n = 3");
    assert.equal(def.minSize({ band: 2 }), 3); assert.equal(def.minSize({ band: 0 }), 3);
    assert.equal(def.premove, true, "a two-click band is premoved like any other move (#37)");
    assert.equal(w.eval("Games").title("triangles"), "Triangles");
    assert.equal(J(def.settings.map((s) => [s.key, s.type, s.def])), '[["band","select",3],["touch","bool",false],["tokens","preset",21]]');
    assert.equal(def.settings[2].flag, undefined, "the token limit is one key: null when Off");
    // the summary parts, 0 / null included: the band and the touch rule only when they differ from the defaults
    assert.equal(J(def.describeRules({ band: 3, tokens: 21 })), '["21 tokens"]');
    assert.equal(J(def.describeRules({ band: 2, tokens: null })), '["3-peg bands","no token limit"]');
    assert.equal(J(def.describeRules({ band: 0, tokens: 0 })), '["bands of 2 to 4 pegs","no token limit"]');
    assert.equal(J(def.describeRules({ band: 3, tokens: 1 })), '["1 token"]');
    assert.equal(J(def.describeRules({})), '["21 tokens"]', "the rules' defaults");
    assert.equal(J(def.describeOptions({ touch: true })), '["bands touch"]');
    assert.equal(J(def.describeOptions({})), "[]", "bands anywhere by default");
    assert.equal(J(def.describeOptions({ touch: false })), "[]");
    // the settings: dropdowns everywhere, the size list in pegs per side, the summary
    const S = w.eval("Settings"); const d = w.document;
    S.init({});
    S.selectGame("triangles");
    for (const id of ["set-band", "set-touch", "set-tokens", "set-size"]) assert.equal(d.getElementById(id).tagName, "SELECT", id);
    assert.equal(J([...d.getElementById("set-band").options].map((o) => [o.value, o.textContent])), '[["3","4 pegs"],["2","3 pegs"],["0","2 to 4 pegs"]]');
    assert.equal(J([...d.getElementById("set-tokens").options].map((o) => o.textContent)), '["Off","10 tokens","15 tokens","21 tokens","30 tokens","Custom…"]');
    assert.equal(J([...d.getElementById("set-size").options].map((o) => o.textContent)), '["4 pegs per side","5 pegs per side","6 pegs per side","Custom…"]');
    assert.equal(d.getElementById("row-band").hidden, false); assert.equal(d.getElementById("row-winlen").hidden, true, "another game's row stays hidden");
    assert.equal(S.summary(), "4 pegs per side · 21 tokens · no timer", "short enough for two lines on a phone");
    const cfg = S.read();
    assert.equal(cfg.band, 3); assert.equal(cfg.touch, false); assert.equal(cfg.tokens, 21);
    // Off writes null, 3-peg bands allow n = 3, and a config without the keys keeps the rows
    d.getElementById("set-tokens").value = "off";
    d.getElementById("set-band").value = "2";
    d.getElementById("set-touch").value = "on";
    assert.equal(S.read().tokens, null); assert.equal(S.read().band, 2); assert.equal(S.read().touch, true);
    assert.equal(S.summary({ ...S.read(), n: 3 }), "3 pegs per side · 3-peg bands · no token limit · no timer · bands touch");
    S.write({ game: "triangles", tokens: null, band: 0 });
    assert.equal(d.getElementById("set-tokens").value, "off"); assert.equal(d.getElementById("set-band").value, "0");
    assert.equal(d.getElementById("set-touch").value, "on", "a config without touch keeps the row");
    S.write({ game: "triangles", tokens: 15 });
    assert.equal(d.getElementById("set-tokens").value, "15");
    w.close();
});

test("the board: triangles, then one band per edge (the engine's cells), then the pegs on top", () => {
    const { w, G, d, R } = fresh({ n: 5 });
    const g = R.geometry(5);
    assert.equal(G.state.cells.length, g.E);
    assert.equal($$(d, "#board > .peg").length, g.V, "61 pegs");
    assert.equal($$(d, "#board > .band").length, g.E, "156 bands");
    assert.equal($$(d, "#board > .tri").length, g.T, "96 triangles");
    assert.equal(d.getElementById("board").className.split(" ")[0], "triangles");
    assert.ok(d.body.classList.contains("game-triangles"));
    assert.equal(d.getElementById("sign-title").textContent, "TRIANGLES");
    // DOM order: T triangles, E bands, V pegs; every band carries a last-move marker
    const kids = [...d.getElementById("board").children];
    assert.ok(kids.slice(0, g.T).every((el) => el.classList.contains("tri")));
    assert.ok(kids.slice(g.T, g.T + g.E).every((el) => el.classList.contains("band")));
    assert.ok(kids.slice(g.T + g.E).every((el) => el.classList.contains("peg")));
    assert.equal($$(d, "#board > .band > .last-marker").length, g.E);
    assert.equal($$(d, "#board > .tri.down").length + $$(d, "#board > .tri.up").length, g.T);
    assert.equal(d.getElementById("board").style.getPropertyValue("--tm"), "4");
    // the view returns exactly the E bands to the engine
    const box = d.createElement("div");
    const els = w.eval("TrianglesView").build(box, G.state, G.config, () => {});
    assert.equal(els.length, g.E);
    assert.ok(els.every((el) => el.classList.contains("band")));
    w.close();
});

test("can-place: every edge before the first band, then only edges on a band that may be stretched", async () => {
    const seen = [];
    const { w, G, d, R } = fresh({ touch: true }, { onCellClick: (m) => seen.push(m) });
    const bands = () => $$(d, "#board > .band");
    assert.equal(bands().filter((el) => el.classList.contains("can-place")).length, R.geometry(4).E, "the first band is free");
    $$(d, "#board > .band").slice(0, 5).forEach((el) => click(w, el));
    assert.equal(seen.length, 0, "a band is never clicked: an edge index is not a move");
    await G.play(649);                                    // the middle row, (-1,0) to (2,0)
    const can = bands().map((el) => el.classList.contains("can-place"));
    can.forEach((on, e) => assert.equal(on, R.canPlay(G.state, e, G.state.current), `edge ${e}`));
    assert.ok(can.some(Boolean), "some edge may still be played");
    assert.ok(can.some((on, e) => !on && G.state.cells[e] === -1), "bands must touch: an uncovered edge far away is not playable");
    for (const e of R.decode(G.state, 649).edges) assert.equal(can[e], false, `covered edge ${e} is not playable`);
    assert.ok(bands().some((el) => el.classList.contains("locked")));
    w.close();
});

test("the two-click band: pick a peg, the targets light up, take it back, the far end first is the same band", async () => {
    const seen = [];
    let allow = true;
    const { w, G, d, R, V } = fresh({}, { onCellClick: (m) => seen.push(m), mayPlay: () => allow });
    const pegs = () => $$(d, "#board > .peg");
    const g = R.geometry(4);
    const P = (q, r) => g.pegs.findIndex((p) => p.q === q && p.r === r);
    click(w, pegs()[P(-3, 0)]);                           // the left corner
    assert.equal(V.pending, P(-3, 0));
    assert.ok(pegs()[P(-3, 0)].classList.contains("pending"));
    const targets = pegs().map((el, p) => (el.classList.contains("target") ? p : -1)).filter((p) => p >= 0);
    const expected = R.legalMoves(G.state).map((m) => R.decode(G.state, m)).filter((b) => b.a === P(-3, 0) || b.b === P(-3, 0)).map((b) => (b.a === P(-3, 0) ? b.b : b.a)).sort((a, b) => a - b);
    assert.equal(J(targets), J(expected), "every peg three steps away along a line");
    assert.ok(targets.includes(P(0, 0)));
    assert.ok(d.getElementById("board").classList.contains("picking"));
    click(w, pegs()[P(-1, 0)]);                           // not a target: nothing happens
    assert.equal(V.pending, P(-3, 0)); assert.equal(seen.length, 0);
    click(w, pegs()[P(-3, 0)]);                           // the same peg takes it back
    assert.equal(V.pending, -1);
    assert.equal(pegs().filter((el) => el.classList.contains("target")).length, 0);
    assert.ok(!d.getElementById("board").classList.contains("picking"));
    // left corner then the middle, and the middle then the left corner: one integer
    click(w, pegs()[P(-3, 0)]); click(w, pegs()[P(0, 0)]);
    click(w, pegs()[P(0, 0)]); click(w, pegs()[P(-3, 0)]);
    assert.equal(J(seen), "[573,573]");
    assert.equal(V.pending, -1);
    // hovering a target previews the band
    click(w, pegs()[P(-3, 0)]);
    pegs()[P(0, 0)].dispatchEvent(new w.Event("mouseenter"));
    assert.equal(J($$(d, "#board > .band.preview").map((el) => $$(d, "#board > .band").indexOf(el))), J(R.bandEdges(G.state, 573)));
    pegs()[P(0, 0)].dispatchEvent(new w.Event("mouseleave"));
    assert.equal($$(d, "#board > .band.preview").length, 0);
    click(w, pegs()[P(-3, 0)]);
    // not this device's turn: the first click is dropped
    allow = false; G.render();
    assert.equal($$(d, "#board > .band.can-place").length, 0);
    click(w, pegs()[P(-3, 0)]);
    assert.equal(V.pending, -1, "nothing is picked while the engine says no");
    assert.ok(d.getElementById("board").classList.contains("idle"), "and the board says so (no pointer on a peg)");
    // a pick dies with the position it was made in
    allow = true; G.render();
    assert.ok(!d.getElementById("board").classList.contains("idle"));
    click(w, pegs()[P(-3, 0)]);
    await G.play(573);
    assert.equal(V.pending, -1, "a move by anybody drops the pick");
    w.close();
});

test("the pegs say what a click can do: the board is idle in a preview and while a band animates, a peg no band starts at is dead", async () => {
    const { w, G, d, R } = fresh();
    const board = d.getElementById("board");
    const pegs = () => $$(d, "#board > .peg");
    const dead = () => pegs().map((el, p) => (el.classList.contains("dead") ? p : -1)).filter((p) => p >= 0);
    const noBand = () => {
        const ends = new Set();
        for (const m of R.legalMoves(G.state)) { const b = R.decode(G.state, m); ends.add(b.a); ends.add(b.b); }
        return pegs().map((_, p) => p).filter((p) => !ends.has(p));
    };
    assert.ok(!board.classList.contains("idle"), "my turn: the pegs take clicks");
    let seen = 0;
    for (let k = 0; k < 40 && !G.state.over && !seen; k++) {
        assert.equal(J(dead()), J(noBand()), `move ${k}: dead = the pegs no legal band starts at`);
        if (dead().length) seen++;
        const playing = G.play(R.legalMoves(G.state)[k % R.legalMoves(G.state).length]);
        assert.ok(board.classList.contains("idle"), "nothing to pick while the band snaps");
        assert.equal(dead().length, 0, "an idle board singles no peg out");
        await playing;
    }
    assert.ok(seen > 0, "some pegs went dead on the way");
    if (!G.state.over) {
        assert.ok(!board.classList.contains("idle"));
        G.preview(1);
        assert.ok(board.classList.contains("idle"), "a preview is never playable");
        G.preview(null);
        assert.ok(!board.classList.contains("idle"));
    }
    w.close();
});

test("clicks(state, move): the two pegs of the band, and clicking them plays it", async () => {
    const { w, G, d, R, V } = fresh({}, { onCellClick: (m) => G.play(m) });
    const pegs = $$(d, "#board > .peg");
    const b = R.decode(G.state, 573);
    const els = V.clicks(G.state, 573);
    assert.equal(els.length, 2);
    assert.equal(els[0], pegs[b.a]); assert.equal(els[1], pegs[b.b]);
    assert.equal(J(V.clicks(G.state, 1)), "[]", "a number that is no band has no clicks");
    for (const el of els) click(w, el);
    for (let k = 0; k < 200 && G.state.busy; k++) await new Promise((r) => setTimeout(r, 10));   // the band animates
    assert.equal(J(G.state.history), "[573]");
    // Isolation got the same hook: the tile to step onto, then the tile to break
    const I = w.eval("IsolationGame"), IR = w.eval("IsolationRules"), IV = w.eval("IsolationView");
    I.newGame({ game: "isolation", n: 5, players: 2, timer: 0, startPlayer: 0 }, hooks().h);
    const move = IR.legalMoves(I.state)[0];
    const { to, removed } = IR.decode(I.state, move);
    const tiles = $$(d, "#board > .slab");
    assert.equal(J(IV.clicks(I.state, move).map((el) => tiles.indexOf(el))), J([to, removed]));
    w.close();
});

test("a claim: the band snaps, the triangle pops with a token and triangles:claim goes out; the whole band is the last move", async () => {
    const { w, G, d, R } = fresh();
    const Bus = w.eval("Bus");
    const seen = [];
    let snapped = null;
    const bands = () => $$(d, "#board > .band");
    // game:move goes out just before animateMove; a microtask runs once it waits on the snap
    Bus.on("game:move", () => queueMicrotask(() => { snapped = $$(d, "#board > .band.snap").map((el) => bands().indexOf(el)); }));
    Bus.on("triangles:claim", (e) => {
        seen.push([e.game, J(e.tris), e.player, e.score]);
        queueMicrotask(() => seen.push(["won", $$(d, "#board > .tri.won").map((el) => $$(d, "#board > .tri").indexOf(el)).join()]));
    });
    await playAll(G, OPENING);
    assert.equal(seen.length, 0, "nothing claimed yet");
    assert.equal(J(R.onTable(G.state)), "[20]");
    await G.play(CLAIM);
    assert.equal(J(seen), J([["triangles", "[20]", 0, 1], ["won", "20"]]));
    const tri = $$(d, "#board > .tri")[20];
    assert.ok(tri.classList.contains("taken") && tri.classList.contains("p0"));
    assert.equal($$(d, "#board > .tri.taken").length, 1);
    assert.equal(J(snapped), J(R.bandEdges(G.state, CLAIM)), "every edge of the band snaps while it animates");
    assert.equal($$(d, "#board > .band.snap").length, 0, "the snap does not outlive the animation");
    // every edge of the band carries the marker, covered ones included
    const last = $$(d, "#board > .band.last").map((el) => $$(d, "#board > .band").indexOf(el));
    assert.equal(J(last), J(R.bandEdges(G.state, CLAIM)));
    assert.equal(G.state.current, 1, "claiming gives no extra turn");
    assert.equal(JSON.stringify(w.eval("Sound.map('triangles:claim', {}, ['local', 'bot'])")), '{"name":"place","rate":1.5,"gain":1.1}');
    w.close();
});

test("HUD: triangles and tokens left per seat (bands without a limit), the game box, the phone line", async () => {
    const a = fresh();
    await playAll(a.G, [...OPENING, CLAIM]);
    const d = a.d;
    assert.equal(d.getElementById("p0-stat-0").textContent, "1", "triangles");
    assert.equal(d.getElementById("p0-stat-1").textContent, "20", "tokens left");
    assert.equal(d.getElementById("p1-stat-1").textContent, "21");
    assert.equal(d.getElementById("p0-pct").textContent, "1 / 21");
    assert.equal(d.getElementById("mini-line2").textContent, "triangles 1 · 0");
    assert.equal(d.getElementById("game-box").hidden, false);
    assert.equal(d.getElementById("game-stat-0").textContent, "53", "triangles left");
    assert.equal(d.getElementById("game-stat-1").textContent, "1", "one on the table");
    assert.ok(d.getElementById("game-box").classList.contains("hot"));
    assert.match(d.getElementById("round-label").textContent, /^Move 6$/);
    assert.ok(d.getElementById("p-0").classList.contains("leading"));
    a.w.close();
    const b = fresh({ tokens: 0 });
    await playAll(b.G, [...OPENING, CLAIM]);
    assert.equal(b.d.getElementById("p0-stat-1").textContent, "3", "bands stretched");
    assert.equal(b.d.getElementById("p1-stat-1").textContent, "2");
    assert.equal(b.d.getElementById("p0-pct").textContent, "1 / 54");
    b.w.close();
});

test("all tokens placed wins at once: the overlay names the winner", async () => {
    const { w, G, calls, d } = fresh({ tokens: 1 });
    await playAll(G, [...OPENING, CLAIM]);
    assert.equal(G.state.over, true);
    assert.equal(J(calls.finish), J({ winner: 0, why: { k: "why.triangles.all" } }));
    assert.equal(d.getElementById("overlay").hidden, false);
    assert.equal(d.getElementById("overlay-title").textContent, "Cyan wins!");
    assert.equal(d.getElementById("overlay-sub").textContent, "All tokens placed!\n1 of 54 triangles");
    assert.ok(d.getElementById("board").classList.contains("over"));
    assert.equal($$(d, "#board > .band.can-place").length, 0);
    w.close();
});

test("a band that passes the token limit: the HUD clamps (no tokens left, a full bar), the overlay counts every triangle", async () => {
    // the overshoot of the pure test above, played through the engine: 3 triangles on a limit of 2
    const { w, G, d, R } = fresh({ band: 0, touch: false, tokens: 2 });
    const seq = [[1, -1, 1, 0], [1, -1, 0, 0], [0, 0, 0, 1], [1, 0, 0, 1], [-2, 0, -1, 0], [-2, 0, -2, 1], [-1, 0, -2, 1], [3, -3, 3, -2], [0, 0, 1, 0]];
    await playAll(G, seq.map((q) => band(R, G.state, ...q)));
    assert.equal(G.state.scores[0], 3); assert.equal(G.state.over, true);
    assert.equal(d.getElementById("p0-stat-1").textContent, "0");
    assert.equal(d.getElementById("p0-pct").textContent, "2 / 2");
    assert.equal(d.getElementById("p0-bar").style.width, "100%");
    assert.equal(d.getElementById("overlay-sub").textContent, "All tokens placed!\n3 of 54 triangles");
    w.close();
});

test("nothing left to stretch with the same number of triangles is a draw, with its hint", () => {
    let game = null;
    for (let seed = 1; !game && seed < 200; seed++) { const r = randomGame({ n: 3, band: 0, tokens: 0 }, seed); if (r.s.winner === -1) game = r.s; }
    assert.ok(game, "a seeded tie exists");
    const { w, G, calls, d } = fresh({ n: 3, band: 0, tokens: 0 });
    G.replay(game.history.slice());
    assert.equal(G.state.over, true);
    assert.equal(G.state.winner, -1);
    assert.equal(J(calls.finish.why), J({ k: "why.triangles.tied" }));
    assert.equal(d.getElementById("overlay-title").textContent, "Draw!");
    assert.equal(d.getElementById("turn-name").textContent, "Draw");
    assert.equal(d.getElementById("turn-hint").textContent, "same number of triangles");
    assert.equal(d.getElementById("overlay-sub").textContent, `Tied!\n${G.state.scores[0]} of 24 triangles`);
    w.close();
});

test("replay equals play, and the record rebuilds the very same position", async () => {
    const seq = [...OPENING, CLAIM, 91];
    const a = fresh(); await playAll(a.G, seq);
    const b = fresh(); b.G.replay(seq);
    for (const k of ["cells", "tris", "scores", "touched", "lastEdges", "lastTris", "movesBy"]) assert.equal(J(b.G.state[k]), J(a.G.state[k]), k);
    assert.equal(b.G.state.current, a.G.state.current);
    assert.equal(b.G.hash(), a.G.hash(), "the same fingerprint, so two clients agree");
    const R = a.w.eval("Rules").replay(a.G.record());
    for (const k of ["cells", "tris", "scores", "touched"]) assert.equal(J(R[k]), J(a.G.state[k]), `record: ${k}`);
    assert.equal(R.current, a.G.state.current);
    // the replay bar's preview paints an earlier position without touching the live one
    const live = a.G.hash();
    a.G.preview(4);
    assert.equal($$(a.d, "#board > .tri.taken").length, 0, "nothing claimed at ply 4");
    assert.equal($$(a.d, "#board > .band.can-place").length, 0, "a preview is never playable");
    assert.equal(a.G.hash(), live);
    a.G.preview(null);
    assert.equal($$(a.d, "#board > .tri.taken").length, 2);
    a.w.close(); b.w.close();
});

test("win chance: two seats get a bar, three do not; three seats rotate", async () => {
    const two = fresh();
    assert.equal(two.d.getElementById("p0-win-row").hidden, false);
    const pct = (k) => parseInt(two.d.getElementById(`p${k}-win-pct`).textContent, 10);
    assert.ok(pct(0) >= 0 && pct(0) <= 100 && pct(0) + pct(1) === 100, `a percentage pair (${pct(0)})`);
    two.G.finish(1, { k: "why.triangles.all" });
    assert.equal(pct(1), 100); assert.equal(pct(0), 0);
    two.w.close();
    const three = fresh({ players: 3 });
    assert.equal($$(three.d, "#players .player").length, 3);
    assert.equal(three.d.getElementById("p0-win-row").hidden, true, "no win chance with three players");
    await playAll(three.G, [573, 702]);
    assert.equal(three.G.state.current, 2);
    three.w.close();
});
