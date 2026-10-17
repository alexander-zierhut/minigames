/* Triangles puzzle solver: the compact board proved equal to TrianglesRules through
   Rules.step, the fast engine proved against two oracles without a table (the board's own
   brute force and a plain search through the rules), a few hand-made positions, and the
   integrity of puzzles.json (replays legally, explicit rules, every puzzle re-solves to the
   same answer). It runs by hand like the other solver tests (about half a minute):
   node --test tests/puzzles/triangles/solver.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { loadPuzzles, positionOf } from "../../../scripts/puzzles/runner.mjs";
import { geometry, symmetries, canonical, Board, solveExhaustive, solveBrute, longest } from "../../../scripts/puzzles/triangles/solver.mjs";

const H = loadHeadless();
const { Rules, TrianglesRules: R, Bots } = H;
const J = (a) => JSON.stringify(a);
const sorted = (a) => Array.from(a).sort((x, y) => x - y);

const fresh = (cfg) => Rules.create({ players: 2, tokens: 0, ...cfg }, "triangles");
const clone = (s) => JSON.parse(JSON.stringify(s));
// a seeded random game, stopped `left` plies before its end (null: play it out)
function seeded(cfg, seed, left = 0) {
    const rng = Bots.rng(seed);
    const s = fresh(cfg), history = [];
    while (!s.over) { const ms = R.legalMoves(s); const mv = ms[Math.floor(rng() * ms.length)]; history.push(mv); Rules.step(R, s, mv); }
    const t = fresh(cfg);
    for (const mv of history.slice(0, Math.max(0, history.length - left))) Rules.step(R, t, mv);
    return t;
}
// the size of the whole game tree below a position, counted up to a cap (the oracles are O(tree))
function tree(board, cap) {
    let k = 0;
    (function walk() {
        if (++k > cap) return;
        for (const b of board.legal()) { board.make(b); walk(); board.unmake(); if (k > cap) return; }
    })();
    return k;
}
// the deepest position of a seeded game whose game tree stays below the cap
function small(cfg, seed, cap) {
    let pick = null;
    for (let left = 1; left <= 12; left++) {
        const s = seeded(cfg, seed, left);
        if (s.over) continue;
        if (tree(Board.fromState(s), cap) > cap) break;
        pick = s;
    }
    return pick;
}
// the second oracle: the rest of the game for the mover, played through the rules alone
function oracle(state) {
    const values = {};
    for (const mv of R.legalMoves(state)) {
        const t = clone(state), before = t.scores[t.current];
        Rules.step(R, t, mv);
        const gain = t.scores[state.current] - before;
        values[mv] = gain - (t.over ? 0 : oracle(t).net);
    }
    const net = Math.max(...Object.values(values));
    return { net, best: sorted(Object.keys(values).map(Number).filter((mv) => values[mv] === net)), values };
}

test("geometry: the solver's own numbering equals the rules for n = 3 … 7", () => {
    for (let n = 3; n <= 7; n++) {
        const mine = geometry(n), theirs = R.geometry(n);
        assert.equal(mine.V, theirs.V); assert.equal(mine.E, theirs.E); assert.equal(mine.T, theirs.T);
        for (let p = 0; p < mine.V; p++) assert.equal(J([mine.pegs[p].q, mine.pegs[p].r]), J([theirs.pegs[p].q, theirs.pegs[p].r]), `n=${n} peg ${p}`);
        for (let e = 0; e < mine.E; e++) assert.equal(J([mine.edgeA[e], mine.edgeB[e]]), J([theirs.edges[e].a, theirs.edges[e].b]), `n=${n} edge ${e}`);
        for (let t = 0; t < mine.T; t++) assert.equal(J(mine.triEdges.slice(3 * t, 3 * t + 3)), J(theirs.tris[t].edges), `n=${n} triangle ${t}`);
        for (let len = 1; len <= 3; len++) {
            const a = mine.bands[len].map((b) => [b.move, sorted(b.edges)]);
            const b = theirs.bands[len].map((x) => [x.move, sorted(x.edges)]).sort((x, y) => x[0] - y[0]);
            assert.equal(J(a), J(b), `n=${n}: the bands of ${len} edges`);
        }
    }
});

test("symmetries: the 12 maps permute the edges and keep triangles together", () => {
    for (const n of [3, 4, 5]) {
        const g = geometry(n), maps = symmetries(n);
        assert.equal(maps.length, 12);
        const triKey = (es) => J(sorted(es));
        const tris = new Set();
        for (let t = 0; t < g.T; t++) tris.add(triKey(g.triEdges.slice(3 * t, 3 * t + 3)));
        for (const map of maps) {
            assert.equal(new Set(map).size, g.E, `n=${n}: a permutation of every edge`);
            for (let t = 0; t < g.T; t++) assert.ok(tris.has(triKey(Array.from(g.triEdges.slice(3 * t, 3 * t + 3), (e) => map[e]))), `n=${n}: a triangle maps onto a triangle`);
        }
        assert.equal(new Set(maps.map((m) => m.join())).size, 12, `n=${n}: 12 different maps`);
        const covered = new Uint8Array(g.E);
        for (let e = 0; e < g.E; e += 5) covered[e] = 1;
        for (const map of maps) {
            const moved = new Uint8Array(g.E);
            for (let e = 0; e < g.E; e++) moved[map[e]] = covered[e];
            assert.equal(canonical(moved, n), canonical(covered, n), `n=${n}: a turned or mirrored position is the same position`);
        }
    }
});

test("the compact board equals the rules through Rules.step on seeded games (every band and touch value)", () => {
    let positions = 0;
    const configs = [{ n: 4, band: 3, touch: true }, { n: 5, band: 3, touch: true }, { n: 4, band: 2, touch: true }, { n: 4, band: 0, touch: true }, { n: 4, band: 3, touch: false }, { n: 3, band: 0, touch: false }];
    configs.forEach((cfg, c) => {
        for (let g = 0; g < 4; g++) {
            const rng = Bots.rng(100 + 10 * c + g);
            const s = fresh(cfg);
            const board = new Board(cfg.n, cfg);
            board.mine = 0; board.theirs = 0;
            while (!s.over) {
                const legal = R.legalMoves(s);
                const bands = board.legal();
                assert.equal(J(bands.map((b) => b.move)), J(sorted(legal)), `${J(cfg)} game ${g}: the same legal bands`);
                for (const b of bands) {
                    assert.equal(board.claims(b), R.claims(s, b.move), "claims");
                    assert.equal(board.opens(b), R.opens(s, b.move), "opens");
                }
                assert.equal(board.onTable(), R.onTable(s).length, "on the table");
                // make / unmake leaves nothing behind
                const snap = J([Array.from(board.covered), Array.from(board.sides), Array.from(board.deg), board.count]);
                for (const b of bands) { board.make(b); board.unmake(); }
                assert.equal(J([Array.from(board.covered), Array.from(board.sides), Array.from(board.deg), board.count]), snap, "unmake restores the board");
                // follow one move on both
                const mv = legal[Math.floor(rng() * legal.length)];
                const before = s.scores[s.current], mover = s.current;
                const band = bands.find((b) => b.move === mv);
                const claimed = board.make(band);
                Rules.step(R, s, mv);
                assert.equal(claimed, s.scores[mover] - before, "the same triangles claimed");
                for (let e = 0; e < board.g.E; e++) assert.equal(board.covered[e] === 1, s.cells[e] !== -1, `edge ${e}`);
                for (let p = 0; p < board.g.V; p++) assert.equal(board.deg[p] > 0, s.touched[p] > 0, `peg ${p} touched`);
                // a board built from the rules state is the same board
                if (!s.over) {
                    const from = Board.fromState(s);
                    assert.equal(J(Array.from(from.covered)), J(Array.from(board.covered)));
                    assert.equal(J(Array.from(from.sides)), J(Array.from(board.sides)));
                    assert.equal(from.mine - from.theirs, s.scores[s.current] - s.scores[1 - s.current], "the scores from the mover's view");
                }
                positions++;
            }
            assert.equal(board.legal().length, 0, "the game ends on both when no band is left");
        }
    });
    assert.ok(positions >= 500, `${positions} positions compared`);
});

test("the fast engine equals both oracles without a table on small positions", () => {
    let checked = 0;
    const configs = [{ n: 4, band: 3, touch: true }, { n: 5, band: 3, touch: true }, { n: 4, band: 0, touch: true }, { n: 4, band: 2, touch: false }];
    configs.forEach((cfg, c) => {
        for (let g = 0; g < 12; g++) {
            const s = small(cfg, 900 + 20 * c + g, 15000);
            if (!s) continue;
            const fast = solveExhaustive(Board.fromState(s));
            const brute = solveBrute(Board.fromState(s));
            const rules = oracle(s);
            assert.equal(fast.net, rules.net, `${J(cfg)} game ${g}: value`);
            assert.equal(brute.net, rules.net, `${J(cfg)} game ${g}: brute value`);
            assert.equal(J(fast.best), J(rules.best), `${J(cfg)} game ${g}: every optimal band`);
            assert.equal(J(brute.best), J(rules.best));
            for (const mv of R.legalMoves(s)) assert.equal(fast.moveValues[mv], rules.values[mv], `${J(cfg)} game ${g}: band ${mv}`);
            checked++;
        }
    });
    assert.ok(checked >= 40, `${checked} positions compared`);
});

test("the solver refuses what its key cannot describe: a token limit, three players", () => {
    assert.throws(() => Board.fromState(Rules.create({ n: 4, players: 2 }, "triangles")), /token limit/);
    assert.throws(() => Board.fromState(Rules.create({ n: 4, players: 3, tokens: 0 }, "triangles")), /two players/);
});

test("hand-made endings: the last band, the last two bands", () => {
    // the last band: its value is what it claims, through the rules helpers
    let last = 0, two = 0;
    for (let seed = 1; seed <= 60 && (last < 5 || two < 5); seed++) {
        for (const left of [1, 2]) {
            const s = seeded({ n: 4, band: 3, touch: true }, seed, left);
            const legal = R.legalMoves(s);
            const r = solveExhaustive(Board.fromState(s));
            if (legal.length === 1) {
                const t = clone(s); Rules.step(R, t, legal[0]);
                if (!t.over) continue;                              // not the last one after all
                assert.equal(r.net, R.claims(s, legal[0]), `seed ${seed}: the last band claims ${R.claims(s, legal[0])}`);
                assert.equal(J(r.best), J(legal));
                last++;
            } else if (legal.length === 2) {
                // two bands: play one, then the other side gets whatever the rest is worth
                const worth = legal.map((mv) => {
                    const t = clone(s); Rules.step(R, t, mv);
                    if (t.over) return R.claims(s, mv);
                    const rest = R.legalMoves(t).map((x) => { const u = clone(t); Rules.step(R, u, x); return R.claims(t, x) - (u.over ? 0 : Math.max(...R.legalMoves(u).map((y) => R.claims(u, y)))); });
                    return R.claims(s, mv) - Math.max(...rest);
                });
                if (legal.some((mv) => { const t = clone(s); Rules.step(R, t, mv); return !t.over && R.legalMoves(t).some((x) => { const u = clone(t); Rules.step(R, u, x); return !u.over && R.legalMoves(u).length > 1; }); })) continue;
                assert.equal(r.net, Math.max(...worth), `seed ${seed}: two bands left`);
                two++;
            }
        }
    }
    assert.ok(last >= 5 && two >= 5, `${last} last-band and ${two} two-band endings`);
});

test("n = 3 with 4-peg bands: the whole board, solved; the border triangles stay dead", () => {
    const empty = new Board(3, { band: 3, touch: true });
    const r = solveExhaustive(empty);
    assert.equal(r.value, "loss", "whoever starts loses");
    assert.equal(r.net, -2, "by two triangles");
    assert.equal(r.best.length, 12, "every first band is as good as any other");
    assert.equal(longest(empty), 12, "twelve bands at the most");
    // a 4-peg band only fits the lines of four and five pegs: the twelve border triangles keep a free side
    const all = new Board(3, { band: 3, touch: false });
    for (const b of all.all) all.make(b);
    let closed = 0;
    for (let t = 0; t < all.g.T; t++) if (all.sides[t] === 3) closed++;
    assert.equal(closed, 12, "12 of 24 triangles can ever be claimed");
});

const data = loadPuzzles("triangles");

test("puzzles.json: ≥ 100 puzzles, unique ids, explicit rules, every position replays, every best band is legal", () => {
    assert.equal(data.game, "triangles");
    assert.ok(data.puzzles.length >= 100, `${data.puzzles.length} puzzles`);
    assert.equal(new Set(data.puzzles.map((p) => p.id)).size, data.puzzles.length, "unique ids");
    const tags = new Set(), seen = new Set(), values = {};
    for (const p of data.puzzles) {
        assert.match(p.id, /^triangles-\d{4}$/);
        assert.equal(J(Object.keys(p.config).sort()), J(["band", "n", "tokens", "touch"]), `${p.id}: every rule written out`);
        assert.equal(p.config.band, 3); assert.equal(p.config.touch, false, `${p.id}: the default, bands anywhere`); assert.equal(p.config.tokens, 0);
        assert.ok([4, 5].includes(p.config.n), `${p.id}: n`);
        assert.equal(p.toMove, 0, `${p.id}: you to move`);
        const s = positionOf(H, p);
        const legal = R.legalMoves(s);
        assert.ok(["win", "draw", "loss"].includes(p.value), `${p.id}: value`);
        assert.equal(p.value, p.margin > 0 ? "win" : p.margin < 0 ? "loss" : "draw", `${p.id}: value and margin agree`);
        assert.ok(p.depth >= 8 && p.depth <= 14, `${p.id}: depth ${p.depth}`);
        assert.ok(p.best.length < legal.length, `${p.id}: a mistake is possible`);
        assert.equal(J(p.best), J(sorted(p.best)), `${p.id}: best sorted`);
        assert.ok(p.tags.includes("endgame-exhaustive"));
        const key = `${s.n}:${canonical(Board.fromState(s).covered, s.n)}:${s.scores[0] - s.scores[1]}`;
        assert.ok(!seen.has(key), `${p.id}: not a duplicate under the hexagon's symmetries`);
        seen.add(key);
        for (const t of p.tags) tags.add(t);
        values[p.value] = (values[p.value] || 0) + 1;
    }
    for (const t of ["claim", "safe-move", "sacrifice", "avoid-loss"]) assert.ok(tags.has(t), `tag ${t}`);
    for (const v of ["win", "draw", "loss"]) assert.ok(values[v] >= 10, `${values[v]} × ${v}`);
});

test("puzzles.json: every puzzle re-solves to the same value, margin, depth and optimal bands", () => {
    for (const p of data.puzzles) {
        const s = positionOf(H, p);
        const board = Board.fromState(s);
        const r = solveExhaustive(board, { maxNodes: 40_000_000 });
        assert.equal(r.value, p.value, `${p.id}: value`);
        assert.equal(r.diff, p.margin, `${p.id}: margin`);
        assert.equal(J(r.best), J(p.best), `${p.id}: optimal bands`);
        assert.equal(longest(board), p.depth, `${p.id}: depth`);
        // the note's numbers are the solver's: where best play ends, and how far behind the next band is
        const gap = r.net - Math.max(...R.legalMoves(s).filter((mv) => !r.best.includes(mv)).map((mv) => r.moveValues[mv]));
        const m = /Best play ends (?:(\d+) triangles? (ahead|behind)|level); every other band is at least (\d+) triangles? worse\.$/.exec(p.note);
        assert.ok(m, `${p.id}: the margin sentence`);
        assert.equal(m[2] ? (m[2] === "ahead" ? +m[1] : -m[1]) : 0, p.margin, `${p.id}: note margin`);
        assert.equal(+m[3], gap, `${p.id}: note gap`);
    }
});
