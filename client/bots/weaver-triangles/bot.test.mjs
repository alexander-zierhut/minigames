/* Weaver (Triangles): the facts that make it a real bot. The framework conformance (only
   legal moves, determinism, speed) is in tests/unit/bots.test.mjs; this file is about the
   compact board, strength and the win chance. Everything runs under node budgets
   (ms: Infinity), so the numbers are the same on every machine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadHeadless, ROOT } from "../../../scripts/headless.mjs";
import { evaluateBot } from "../../../scripts/puzzles/runner.mjs";

const H = loadHeadless();
const { Bots, Rules, TrianglesRules: R } = H;
const ID = "weaver-triangles";
const def = Bots.get(ID);
const { Board, exactSolver, exactWinner, capped, EXACT_MAX } = def.internals;
const BUDGET = { ms: Infinity, nodes: 20000 };
const LEVELS = ["easy", "normal", "hard", "insane"];
const t = Bots.tools("triangles", { seed: 1 });
const clone = (s) => JSON.parse(JSON.stringify(s));
const open = (s) => s.cells.filter((c) => c === -1).length;
const ask = (state, difficulty = "insane", seed = 3, budget = BUDGET) =>
    Bots.create(ID, { me: state.current, difficulty, seed, players: state.players, budget }).move(clone(state));

// a seeded position with at most `left` uncovered edges, played by a greedy-minded policy
function played(config, left, seed, greed = 0.8) {
    const s = Rules.create(config, "triangles");
    const rng = Bots.rng(seed);
    while (!s.over && open(s) > left) {
        const legal = R.legalMoves(s);
        const caps = legal.filter((m) => R.claims(s, m) > 0);
        const safe = legal.filter((m) => R.opens(s, m) === 0);
        const pool = caps.length && rng() < greed ? caps : safe.length && rng() < greed ? safe : legal;
        Rules.step(R, s, pool[Math.floor(rng() * pool.length)]);
    }
    return s;
}

test("weaver-triangles: registration: four node budgets, an evaluator, plays every config", () => {
    assert.equal(def.game, "triangles");
    assert.equal(def.name, "Weaver");
    assert.equal(def.baseline, undefined);
    assert.equal(def.supports, undefined, "no supports(): Weaver plays every rule the settings can produce");
    assert.equal(JSON.stringify(def.difficulties.map((d) => [d.id, d.nodes])), JSON.stringify([["easy", 2000], ["normal", 10000], ["hard", 30000], ["insane", 100000]]));
    assert.equal(typeof def.evaluate, "function");
    assert.equal(Bots.botFor("triangles", { n: 4 }).id, ID);
    assert.equal(Bots.estimator("triangles", { n: 4, band: 0, touch: false, tokens: null }).bot, ID);
});

/* ---------- the compact board equals the rules ---------- */
const CONFIGS = [];
for (const band of [0, 2, 3]) for (const touch of [true, false]) for (const tokens of [null, 0, 21]) for (const players of [2, 3, 4]) {
    CONFIGS.push({ n: band === 3 ? 4 : 3 + ((players + CONFIGS.length) % 2), band, touch, tokens, players });
}
test("weaver-triangles: the compact board equals the rules on seeded games under every config (legal bands, claims, scores, the end)", () => {
    let positions = 0;
    for (const [c, cfg] of CONFIGS.entries()) {
        const s = Rules.create(cfg, "triangles");
        const rng = Bots.rng(4100 + c);
        const b = new Board(s);
        const out = new Int32Array(b.t.NB), keys = new Int32Array(b.t.NB);
        const newEdges = (mv) => R.bandEdges(s, mv).filter((e) => s.cells[e] === -1).join(",");
        for (let ply = 0; ; ply++) {
            const where = `${JSON.stringify(cfg)} ply ${ply}`;
            for (let p = 0; p < s.players; p++) assert.equal(b.scores[p], s.scores[p], `${where}: score of seat ${p}`);
            assert.equal(JSON.stringify(Array.from(b.cov)), JSON.stringify(s.cells.map((x) => (x === -1 ? 0 : 1))), `${where}: covered edges`);
            if (s.over) break;
            assert.equal(b.cur, s.current, `${where}: seat to move`);
            const legal = R.legalMoves(s).sort((x, y) => x - y);
            assert.equal(JSON.stringify(b.legalMoves().sort((x, y) => x - y)), JSON.stringify(legal), `${where}: legal bands`);
            for (const mv of legal) {
                const k = b.t.index.get(mv);
                assert.equal(b.claims(k), R.claims(s, mv), `${where}: claims of ${mv}`);
                assert.equal(b.opens(k), R.opens(s, mv), `${where}: opens of ${mv}`);
            }
            // the search's move list: one band per set of new edges, and every such set once
            const n = b.gen(out, keys);
            const got = Array.from(out.subarray(0, n), (k) => newEdges(b.t.bMove[k]));
            assert.equal(new Set(got).size, n, `${where}: no two bands with the same new edges`);
            assert.equal(JSON.stringify([...new Set(got)].sort()), JSON.stringify([...new Set(legal.map(newEdges))].sort()), `${where}: every position reachable`);
            const mv = legal[Math.floor(rng() * legal.length)];
            const mover = b.cur;
            const before = JSON.stringify([Array.from(b.cov), Array.from(b.sides), Array.from(b.touch), Array.from(b.scores), b.cur, b.two]);
            const gain = b.make(b.t.index.get(mv));
            b.unmake();
            assert.equal(JSON.stringify([Array.from(b.cov), Array.from(b.sides), Array.from(b.touch), Array.from(b.scores), b.cur, b.two]), before, `${where}: make / unmake round trip`);
            b.make(b.t.index.get(mv));
            Rules.step(R, s, mv);
            assert.equal(gain, s.lastTris.length, `${where}: the same triangles claimed`);
            const tokenWin = b.tokens > 0 && b.scores[mover] >= b.tokens;
            assert.equal(tokenWin || !b.anyLegal(), s.over, `${where}: the game ends at the same move`);
            if (s.over) assert.equal(tokenWin ? mover : b.topSeat(), s.winner, `${where}: the same winner`);
            positions++;
        }
    }
    assert.ok(positions > 1000, `${positions} positions compared over ${CONFIGS.length} configs`);
});

// a plain full-width oracle through the real rules (memoised on the whole position, nothing else)
function oracle(s, memo = new Map()) {
    const key = s.cells.map((c) => (c < 0 ? 0 : 1)).join("") + "/" + s.scores.join(",") + "/" + s.current;
    if (memo.has(key)) return memo.get(key);
    const p = s.current;
    let best = -Infinity;
    for (const m of R.legalMoves(s)) {
        const n = clone(s);
        Rules.step(R, n, m);
        const v = n.over ? n.scores[p] - n.scores[1 - p] : -oracle(n, memo);
        if (v > best) best = v;
    }
    memo.set(key, best);
    return best;
}
test("weaver-triangles: the exact endgame equals a full-width oracle, with and without a token limit", () => {
    let checked = 0;
    for (const band of [0, 2, 3]) for (const touch of [true, false]) for (const tokens of [0, 7]) for (let g = 0; g < 4; g++) {
        const n = band === 3 ? 4 : 3 + (g % 2);
        const s = played({ n, band, touch, tokens }, 8, 5100 + g * 17 + band * 3 + tokens + (touch ? 1 : 0), 0.5);
        if (s.over) continue;
        const want = oracle(s) + 0;                                       // + 0: no negative zero
        const b = new Board(s);
        const future = exactSolver(b, capped(1e8)).search(-Infinity, Infinity, 0);
        assert.equal(s.scores[s.current] - s.scores[1 - s.current] + future, want, `${JSON.stringify({ n, band, touch, tokens, g })}: final margin`);
        const w = exactWinner(new Board(s), capped(1e8));
        assert.equal(w, Math.sign(s.current === 0 ? want : -want) + 0, "the null-window verdict");
        checked++;
    }
    assert.ok(checked >= 20, `${checked} endgames`);
});

/* ---------- tactics ---------- */
test("weaver-triangles: takes a claim that wins the game on the spot, at every level", async () => {
    let seen = 0;
    for (let k = 0; k < 80 && seen < 16; k++) {
        // a position with a claim on the table, replayed with a token limit it reaches
        const base = played({ n: 4 + (k % 2), tokens: 0, band: [3, 0, 2][k % 3] }, 30 + (k % 20), 6100 + k, 0.6);
        if (base.over || !R.claimingMoves(base).length) continue;
        const cfg = { n: base.n, band: base.band, touch: base.touch, tokens: base.scores[base.current] + 1 };
        const s = Rules.create(cfg, "triangles");
        Rules.apply(R, s, base.history);
        if (s.over || s.history.length !== base.history.length) continue;
        seen++;
        for (const level of LEVELS) {
            const after = t.apply(s, await ask(s, level, 5 + k));
            assert.ok(after.over && after.winner === s.current, `${level}: it wins with the claim (position ${k})`);
        }
    }
    assert.ok(seen >= 10, `${seen} positions`);
});

test("weaver-triangles: never hands a triangle over while a safe band exists, Easy included", async () => {
    let seen = 0;
    for (let k = 0; k < 160 && seen < 20; k++) {
        const n = 5 + (k % 2);
        const s = played({ n, band: [3, 0, 2][k % 3], touch: k % 4 !== 3 }, Math.floor(R.geometry(n).E * (0.6 + (k % 5) * 0.07)), 7100 + k, 0.97);
        if (s.over || open(s) <= EXACT_MAX) continue;                       // the exact search may sacrifice on purpose
        const safe = R.safeMoves(s);
        if (!safe.length || R.claimingMoves(s).length) continue;
        seen++;
        for (const level of LEVELS) {
            const m = await ask(s, level, 9 + k, { ms: Infinity, nodes: Bots.get(ID).difficulties.find((d) => d.id === level).nodes });
            assert.equal(R.opens(s, m), 0, `${level}: ${safe.length} safe bands, but ${m} hands ${R.opens(s, m)} over`);
        }
    }
    assert.ok(seen >= 15, `${seen} positions with safe bands left`);
});

test("weaver-triangles: deterministic per seed, legal at every level, and it says what it did", async () => {
    for (const level of LEVELS) {
        for (let k = 0; k < 6; k++) {
            const s = played({ n: 4, band: [3, 0, 2][k % 3], tokens: k % 2 ? 0 : 21 }, 20 + k * 10, 3300 + k);
            if (s.over) continue;
            const bot = Bots.create(ID, { me: s.current, difficulty: level, seed: 9, budget: BUDGET });
            const a = await bot.move(clone(s));
            assert.equal(await ask(s, level, 9), a, `${level}: same seed, same band`);
            assert.ok(R.isLegal(s, a, s.current), `${level}: legal band`);
            assert.ok(bot.tools.last && "depth" in bot.tools.last && "value" in bot.tools.last && "forced" in bot.tools.last, "depth, value and a forced note reported");
        }
    }
});

test("weaver-triangles: Very hard yields to the page inside the tree, never more than a few thousand nodes apart", async () => {
    const cases = [
        [{ n: 4 }, 75, 3500], [{ n: 5, tokens: 0 }, 30, 3501], [{ n: 5, tokens: 0 }, 16, 3502],
        [{ n: 6 }, 140, 3503], [{ n: 7, band: 0, tokens: 0 }, 160, 3501], [{ n: 4, players: 3 }, 60, 3500],
        // 3 and 4 seats on big boards: the other side moves twice in a row below my band, which
        // alpha-beta cannot cut, so that depth-2 subtree once took the whole budget without a yield
        [{ n: 7, band: 0, players: 3 }, 200, 3504], [{ n: 6, band: 0, players: 4 }, 140, 3505],
    ];
    let searched = 0, exact = 0;
    for (const [cfg, left, seed] of cases) {
        const s = played(cfg, left, seed, 0.5);
        if (s.over) continue;
        const bot = Bots.create(ID, { me: s.current, difficulty: "insane", seed: 1, players: s.players });
        const tl = bot.tools, deadline = tl.deadline.bind(tl);
        let d, last = 0, gap = 0, yields = 0;
        tl.deadline = (...a) => (d = deadline(...a));
        tl.yield = () => { gap = Math.max(gap, d.nodes() - last); last = d.nodes(); yields++; return Promise.resolve(); };
        const m = await bot.move(clone(s));
        gap = Math.max(gap, d.nodes() - last);
        assert.ok(R.isLegal(s, m, s.current), "legal band");
        if (d.nodes() > 10000) assert.ok(yields > 0, `${JSON.stringify(cfg)}: ${d.nodes()} nodes without a yield`);
        assert.ok(gap <= 5000, `${JSON.stringify(cfg)}, ${open(s)} open edges, ${tl.last.method}: ${gap} nodes between two yields`);
        searched++;
        if (tl.last.method === "exact") exact++;
    }
    assert.ok(searched >= 5 && exact >= 1, `${searched} positions searched, ${exact} of them exactly`);
});

test("weaver-triangles: a forced band is reported as one, so the dev panel does not keep the last search", () => {
    let found = 0;
    for (let seed = 0; seed < 40 && !found; seed++) {
        const s = Rules.create({ n: 3, band: 3 }, "triangles");
        const rng = Bots.rng(3600 + seed);
        while (!s.over && R.legalMoves(s).length > 1) { const l = R.legalMoves(s); Rules.step(R, s, l[Math.floor(rng() * l.length)]); }
        if (s.over) continue;
        const bot = Bots.create(ID, { me: s.current, difficulty: "easy", seed: 1 });
        bot.tools.report({ method: "search", nodes: 1234 });
        assert.equal(bot.move(clone(s)), R.legalMoves(s)[0]);
        assert.equal(bot.tools.last.method, "forced");
        assert.equal(bot.tools.last.nodes, 0);
        found++;
    }
    assert.ok(found, "a position with one legal band");
});

/* ---------- strength ---------- */
test("weaver-triangles: beats Random by a wide margin as either seat (4 and 5 pegs per side)", async () => {
    for (const [n, games] of [[4, 16], [5, 6]]) {
        let points = 0;
        for (let g = 0; g < games; g++) {
            const me = g % 2;
            const a = Bots.create(ID, { seed: 50 + g, me, difficulty: "normal", budget: { ms: Infinity, nodes: 4000 } });
            const b = Bots.create("random-triangles", { seed: 900 + g, me: 1 - me });
            const r = await Bots.playout("triangles", { n, startPlayer: g % 2 }, me === 0 ? [a, b] : [b, a], { maxMoves: 400 });
            if (r.winner === me) points++; else if (r.winner < 0) points += 0.5;
        }
        assert.ok(points / games >= 0.9, `${n} pegs per side: ${points}/${games} against Random`);
    }
});

test("weaver-triangles: three and four seats (paranoid search) are played legally and well", async () => {
    let wins = 0, games = 0;
    for (const players of [3, 4]) {
        for (let g = 0; g < 3; g++) {
            const me = g % players;
            const seats = Array.from({ length: players }, (_, p) => (p === me
                ? Bots.create(ID, { seed: 70 + g, me, players, difficulty: "normal", budget: { ms: Infinity, nodes: 3000 } })
                : Bots.create("random-triangles", { seed: 700 + g * 7 + p, me: p })));
            const r = await Bots.playout("triangles", { n: 4, band: g === 2 ? 0 : 3, tokens: g === 1 ? 0 : 21, startPlayer: g % players }, seats, { maxMoves: 400 });
            assert.equal(r.over, true);
            games++;
            if (r.winner === me) wins++;
        }
    }
    assert.ok(wins >= games - 1, `${wins}/${games} won against Random seats`);
});

/* ---------- the win chance ---------- */
const mirror = (s) => {
    const m = clone(s);
    m.scores = [s.scores[1], s.scores[0]];
    m.movesBy = [s.movesBy[1], s.movesBy[0]];
    m.current = 1 - s.current;
    m.cells = s.cells.map((c) => (c < 0 ? c : 1 - c));
    m.tris = s.tris.map((c) => (c < 0 ? c : 1 - c));
    return m;
};
test("weaver-triangles: evaluate is symmetric, decided only when it is, and even on an empty board", () => {
    let checked = 0, finite = 0;
    for (let k = 0; k < 60; k++) {
        const s = played({ n: 4 + (k % 2), band: [3, 0, 2][k % 3], tokens: k % 2 ? 0 : 21 }, 8 + (k % 40) * 2, 6600 + k, 0.6);
        if (s.over) continue;
        const a = def.evaluate(s), b = def.evaluate(mirror(s));
        assert.ok(Object.is(b, -a) || (a === 0 && b === 0), `mirroring the seats negates the score (${a} / ${b})`);
        if (Number.isFinite(a)) finite++;
        checked++;
    }
    assert.ok(checked >= 40 && finite >= 15, `${checked} positions, ${finite} undecided`);
    for (const n of [4, 5, 6]) assert.equal(def.evaluate(Rules.create({ n }, "triangles")), 0, `${n}: the empty board is even`);
    // finished games
    const done = (winner) => Object.assign(Rules.create({ n: 4 }, "triangles"), { over: true, winner });
    assert.equal(def.evaluate(done(0)), Infinity);
    assert.equal(def.evaluate(done(1)), -Infinity);
    assert.equal(def.evaluate(done(-1)), 0);
    // a lead nobody can catch up with any more is decided whatever the search says
    const s = played({ n: 4, tokens: 0 }, 30, 4242);
    const lead = clone(s);
    lead.scores = [R.left(s) + 1, 0];
    assert.equal(def.evaluate(lead), Infinity);
    assert.equal(def.evaluate(mirror(lead)), -Infinity);
});

test("weaver-triangles: the win chance is the same at every HUD stage (one node cap of its own)", () => {
    let checked = 0, proven = 0;
    for (let k = 0; k < 40; k++) {
        const s = played({ n: 4 + (k % 2), tokens: k % 3 ? 21 : 0 }, 10 + k * 2, 8800 + k, 0.6);
        if (s.over) continue;
        const values = Bots.ESTIMATE_STAGES.map((nodes) => def.evaluate(s, Bots.tools("triangles", { seed: 0, budget: { ms: Infinity, nodes } })));
        assert.ok(values.every((v) => Object.is(v, values[0])), `same value at every stage (${values.join(", ")})`);
        if (!Number.isFinite(values[0])) proven++;
        checked++;
    }
    assert.ok(checked >= 20 && proven >= 3, `${checked} positions, ${proven} proven`);
});

/* The measurement pass (README, "Win chance"): seeded self-play on 4 pegs per side, the
   calibrated bar at the HUD's middle stage, on the default rules and with bands that must
   touch. Bounds sit well above what it reaches, so a change that brings the zigzag back
   fails here. */
for (const [name, CALM] of [["the default rules", { n: 4 }], ["bands that must touch", { n: 4, touch: true }]]) {
    test(`weaver-triangles: the win chance stays calm and honest over seeded self-play (${name})`, async () => {
        const est = Bots.estimator("triangles", CALM);
        assert.equal(est.bot, ID);
        let steps = 0, sum = 0, flips = 0, triples = 0, brier = 0, samples = 0;
        const bias = [[], []];
        const und = (v) => v > 0.1 && v < 0.9;
        for (let g = 0; g < 10; g++) {
            const seat = (me, seed) => Bots.create(ID, { me, difficulty: "normal", seed, budget: { ms: Infinity, nodes: 4000 } });
            const bots = [seat(0, 300 + g), g % 5 === 4 ? Bots.create("random-triangles", { me: 1, seed: 900 + g }) : seat(1, 600 + g)];
            const s = Rules.create({ ...CALM, startPlayer: g % 2 }, "triangles");
            const ps = [], turn = [];
            while (!s.over) {
                Rules.step(R, s, await bots[s.current].move(clone(s)));
                if (s.over) break;
                const p = est.at(clone(s), 12000);
                assert.ok(p >= 0 && p <= 1, `a probability (${p})`);
                ps.push(p); turn.push(s.current);
            }
            const y = s.winner < 0 ? 0.5 : s.winner === 0 ? 1 : 0;
            for (const p of ps) { brier += (p - y) ** 2; samples++; }
            for (let i = 1; i < ps.length; i++) {
                if (!und(ps[i]) || !und(ps[i - 1])) continue;
                const d = Math.abs(ps[i] - ps[i - 1]);
                sum += d; steps++;
                if (d > 0.15) flips++;
            }
            for (let i = 1; i < ps.length - 1; i++) {
                if (!und(ps[i]) || !und(ps[i - 1]) || !und(ps[i + 1])) continue;
                bias[turn[i]].push(ps[i] - (ps[i - 1] + ps[i + 1]) / 2);
                triples++;
            }
        }
        const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        const mover = Math.abs(mean(bias[0]) - mean(bias[1])) / 2;
        console.log(`  ${name}: ${samples} positions, Brier ${(brier / samples).toFixed(3)}, undecided steps ${steps}, mean change ${(sum / steps * 100).toFixed(2)} %, ${flips} over 15 points, mover bias ${mover.toFixed(4)} over ${triples} triples`);
        assert.ok(steps >= 60 && triples >= 30, `${steps} steps, ${triples} triples`);
        assert.ok(brier / samples <= 0.2, `Brier ${(brier / samples).toFixed(3)}`);
        assert.ok(sum / steps <= 0.08, `the average undecided step stays under 8 points (${(sum / steps * 100).toFixed(2)})`);
        assert.ok(flips <= steps * 0.12, `at most one undecided step in eight moves the bar by more than 15 points (${flips} of ${steps})`);
        assert.ok(mover <= 0.04, `the mover bias stays under 4 points (${mover.toFixed(4)})`);
    });
}

/* ---------- puzzles (thresholds below what it really reaches) ---------- */
const SET = `${ROOT}tests/puzzles/triangles/puzzles.json`;
test("weaver-triangles: the proven puzzle set, per level", { skip: !existsSync(SET) && "no triangles puzzle set yet" }, async () => {
    const floor = { easy: 75, normal: 85, hard: 90, insane: 95 };
    for (const level of LEVELS) {
        const nodes = def.difficulties.find((d) => d.id === level).nodes;
        const r = await evaluateBot(H, ID, { seed: 7, difficulty: level, budget: { ms: Infinity, nodes } });
        console.log(`  ${level}: ${r.solved}/${r.total} perfect bands (${r.pct} %, random picking gets ${r.chance} %)`,
            Object.fromEntries(Object.entries(r.byTag).map(([k, v]) => [k, `${v.solved}/${v.total}`])));
        assert.ok(r.pct >= floor[level], `${level}: ${r.pct} % of the proven puzzles`);
    }
});
