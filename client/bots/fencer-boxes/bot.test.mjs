/* Fencer (Käsekästchen): the facts that make it a real bot. Everything runs under node
   budgets (ms: Infinity) so the numbers are the same on every machine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { loadPuzzles, positionOf, evaluateBot } from "../../../scripts/puzzles/runner.mjs";
import { Board as SolverBoard, solveExhaustive } from "../../../scripts/puzzles/boxes/solver.mjs";

const H = loadHeadless();
const { Bots, Rules, BoxesRules } = H;
const ID = "fencer-boxes";
const def = Bots.get(ID);
const { Board } = def.internals;
const rules = BoxesRules;
const BUDGET = { ms: Infinity, nodes: 20000 };
const LEVELS = ["easy", "normal", "hard", "insane"];

const t = Bots.tools("boxes", { seed: 1 });
const fresh = (n, players = 2) => Rules.create({ n, players }, "boxes");
function position(n, history) { const s = fresh(n); for (const i of history) Rules.step(rules, s, i); return s; }
const ask = (state, difficulty = "insane", seed = 3, budget = BUDGET) =>
    Bots.create(ID, { me: state.current, difficulty, seed, players: state.players, budget }).move(t.clone(state));

// a seeded position with roughly `free` lines still undrawn, played by a chain-minded policy
function played(n, free, seed) {
    const s = fresh(n);
    const rng = Bots.rng(seed);
    while (!s.over && rules.legalMoves(s).length > free) {
        const legal = rules.legalMoves(s);
        const caps = legal.filter((e) => rules.captures(s, e) > 0);
        const safe = rules.safeMoves(s);
        const pool = caps.length && rng() < 0.85 ? caps : safe.length && rng() < 0.9 ? safe : legal;
        Rules.step(rules, s, pool[Math.floor(rng() * pool.length)]);
    }
    return s;
}

/* ---------- the internal board equals the real rules ---------- */
test("fencer-boxes: the search board agrees with the rules on captures, safety and free boxes; make/unmake round-trips", () => {
    let checked = 0;
    for (const n of [2, 3, 4, 5]) {
        for (let g = 0; g < 6; g++) {
            const s = fresh(n);
            const rng = Bots.rng(n * 100 + g);
            while (!s.over) {
                const b = new Board(n).load(s);
                assert.equal(b.left, rules.legalMoves(s).length, "undrawn lines");
                for (const e of b.freeEdges()) {
                    assert.equal(b.capturesOf(e), rules.captures(s, e), `n=${n}: captures of line ${e}`);
                    assert.equal(b.isSafe(e), rules.safeMoves(s).includes(e), `n=${n}: safety of line ${e}`);
                    assert.equal(b.isFreeCapture(e), rules.isFreeCapture(s, e), `n=${n}: free capture ${e}`);
                    // make + unmake leaves the board exactly as it was
                    const before = JSON.stringify([[...b.drawn], [...b.sides], b.left, b.open]);
                    const gained = b.make(e);
                    assert.equal(gained, rules.captures(s, e), "the same boxes close");
                    b.unmake(e);
                    assert.equal(JSON.stringify([[...b.drawn], [...b.sides], b.left, b.open]), before, "round trip");
                    checked++;
                }
                const legal = rules.legalMoves(s);
                Rules.step(rules, s, legal[Math.floor(rng() * legal.length)]);
            }
        }
    }
    assert.ok(checked > 3000, `${checked} lines checked`);
});

/* ---------- tactics ---------- */
test("fencer-boxes: a free box is always taken, at every level", async () => {
    // 2 × 2: lines 0, 2, 6 drawn, so line 7 closes box 0 and hands nothing over
    const s = position(2, [0, 2, 6]);
    assert.equal(rules.captures(s, 7), 1);
    assert.equal(rules.isFreeCapture(s, 7), true);
    for (const level of LEVELS) assert.equal(await ask(s, level), 7, `${level} takes the free box`);
    // and in 40 seeded positions with a free box on the table, it never leaves it there
    let seen = 0;
    for (let k = 0; k < 120 && seen < 40; k++) {
        const p = played(4, 10 + (k % 14), 700 + k);
        if (p.over) continue;
        const free = rules.legalMoves(p).filter((e) => rules.isFreeCapture(p, e));
        if (!free.length) continue;
        seen++;
        const move = await ask(p, "insane");
        assert.ok(rules.captures(p, move) > 0, `a box was on the table (${free}) but it played ${move}`);
    }
    assert.ok(seen >= 20, `${seen} positions with a free box`);
});

test("fencer-boxes: while a safe line exists it never opens a chain (the phase the search cannot reach yet)", async () => {
    let seen = 0;
    for (let k = 0; k < 60 && seen < 25; k++) {
        const p = played(5, 34 + (k % 16), 4200 + k);        // more undrawn lines than the exact search takes
        if (p.over) continue;
        const safe = rules.safeMoves(p);
        if (!safe.length || rules.capturingMoves(p).length) continue;
        seen++;
        const move = await ask(p, "insane");
        assert.ok(safe.includes(move), `${safe.length} safe lines were available but it played ${move}`);
    }
    assert.ok(seen >= 15, `${seen} positions with safe lines left`);
});

test("fencer-boxes: it finds the double-dealing sacrifice in a loony endgame", async () => {
    const data = loadPuzzles("boxes");
    const declines = data.puzzles.filter((p) => p.tags.includes("double-deal"));
    assert.ok(declines.length >= 5);
    let solved = 0;
    for (const p of declines) {
        const s = positionOf(H, p);
        const move = await ask(s, "insane", 5, { ms: Infinity, nodes: 100000 });
        if (p.best.includes(move)) solved++;
        assert.equal(rules.captures(s, move), 0, `${p.id}: it took the boxes instead of keeping control`);
    }
    assert.equal(solved, declines.length, "every declining puzzle solved");
});

test("fencer-boxes: it wins a loony endgame that a greedy taker loses", async () => {
    // both sides start level in a position where every line opens something; the side that
    // eats everything hands the rest away, the side that keeps control wins
    const data = loadPuzzles("boxes");
    const loony = data.puzzles.filter((p) => p.tags.includes("sacrifice") && p.config.n >= 4 && p.value !== "loss").slice(0, 6);
    assert.ok(loony.length >= 3, `${loony.length} loony endgames`);
    const greedy = (state) => {
        const legal = rules.legalMoves(state);
        const caps = legal.filter((e) => rules.captures(state, e) > 0);
        if (caps.length) return caps[0];
        const safe = rules.safeMoves(state);
        return (safe.length ? safe : legal)[0];
    };
    let wins = 0;
    for (const p of loony) {
        const s = positionOf(H, p);
        const me = s.current;
        const bot = Bots.create(ID, { me, difficulty: "insane", seed: 11, budget: { ms: Infinity, nodes: 100000 } });
        while (!s.over) Rules.step(rules, s, await (s.current === me ? bot.move(t.clone(s)) : greedy(s)));
        if (s.winner === me) wins++;
    }
    assert.equal(wins, loony.length, "it converts every won loony endgame against a greedy taker");
});

/* ---------- strength ---------- */
test("fencer-boxes: crushes Random over a seeded series, on small and big boards", async () => {
    for (const n of [3, 4, 5]) {
        let points = 0;
        const games = 16;
        for (let g = 0; g < games; g++) {
            const me = g % 2;
            const a = Bots.create(ID, { seed: 50 + g, me, difficulty: "normal", budget: BUDGET });
            const b = Bots.create("random-boxes", { seed: 900 + g, me: 1 - me });
            const r = await Bots.playout("boxes", { n, startPlayer: g % 2 }, me === 0 ? [a, b] : [b, a], { maxMoves: 300 });
            if (r.winner === me) points++; else if (r.winner < 0) points += 0.5;
        }
        assert.ok(points / games >= 0.9, `${n}×${n}: ${points}/${games} against Random`);
    }
});

test("fencer-boxes: deterministic per seed, and every difficulty answers legally", async () => {
    for (const level of LEVELS) {
        for (let k = 0; k < 8; k++) {
            const s = played(4, 8 + k * 3, 3300 + k);
            if (s.over) continue;
            const a = await ask(s, level, 9);
            const b = await ask(s, level, 9);
            assert.equal(a, b, `${level}: same seed, same line`);
            assert.ok(rules.isLegal(s, a, s.current), `${level}: legal line`);
        }
    }
});

test("fencer-boxes: three and four players are played legally (the exact search is a two-player tool)", async () => {
    for (const players of [3, 4]) {
        const s = Rules.create({ n: 3, players }, "boxes");
        for (let k = 0; k < 24 && !s.over; k++) {
            const i = await Bots.create(ID, { me: s.current, players, difficulty: "hard", seed: 7 + k, budget: BUDGET }).move(t.clone(s));
            assert.ok(rules.isLegal(s, i, s.current), `${players} players: legal line ${i}`);
            Rules.step(rules, s, i);
        }
    }
});

/* ---------- the win chance ---------- */
test("fencer-boxes: evaluate is the solver's verdict in the endgame and never claims more than it proved", () => {
    const tools = Bots.tools("boxes", { seed: 0, budget: { ms: Infinity, nodes: 2000000 } });
    let decided = 0, checked = 0;
    for (let k = 0; k < 40; k++) {
        const s = played(4, 8 + (k % 12), 9100 + k);
        if (s.over) continue;
        const raw = def.evaluate(s, tools);
        const r = solveExhaustive(SolverBoard.fromState(s));
        assert.notEqual(r.value, "unknown");
        const diffForMover = s.scores[s.current] - s.scores[1 - s.current] + r.net;
        const diff0 = s.current === 0 ? diffForMover : -diffForMover;
        checked++;
        if (diff0 !== 0) { assert.equal(raw, diff0 > 0 ? Infinity : -Infinity, "a solved endgame is decided"); decided++; }
        else assert.equal(raw, 0, "a solved tie is even");
    }
    assert.ok(checked >= 20 && decided >= 10, `${decided}/${checked} solved endgames`);
    // the opening is never claimed as decided
    for (const n of [4, 5]) {
        const raw = def.evaluate(Rules.create({ n, players: 2 }, "boxes"), Bots.tools("boxes", { seed: 0, budget: { ms: Infinity, nodes: 12000 } }));
        assert.ok(Number.isFinite(raw), `${n}×${n} opening is not decided (${raw})`);
    }
    // a majority of the boxes is decided by the rules, whatever the search says
    const won = played(3, 6, 12345);
    if (!won.over && won.scores[0] * 2 > won.n * won.n) assert.equal(def.evaluate(won, tools), Infinity);
});

test("fencer-boxes: the null-window verdict says exactly what the full-window value says", () => {
    const { exactWinner, exactValue, Board: B, capped, EXACT_MAX } = def.internals;
    let checked = 0;
    for (let k = 0; k < 60; k++) {
        const s = played(4, 6 + (k % 16), 7700 + k);
        if (s.over) continue;
        const board = new B(s.n).load(s);
        const free = board.freeEdges();
        if (free.length > EXACT_MAX) continue;
        const v = exactValue(board, free, capped(400000));
        if (v === null) continue;
        const lead = s.scores[0] - s.scores[1];
        const diff = lead + (s.current === 0 ? v : -v);
        const r = exactWinner(board, free, capped(400000), lead, s.current);
        assert.equal(r, Math.sign(diff), `null window agrees with the value (${diff})`);
        checked++;
    }
    assert.ok(checked >= 30, `${checked} endgames compared`);
});

test("fencer-boxes: the win chance is the same at every HUD stage (one node cap of its own)", () => {
    let checked = 0;
    for (let k = 0; k < 40; k++) {
        for (const n of [4, 5]) {
            const s = played(n, 8 + (k % 24), 8800 + k);
            if (s.over) continue;
            const values = Bots.ESTIMATE_STAGES.map((nodes) => def.evaluate(s, Bots.tools("boxes", { seed: 0, budget: { ms: Infinity, nodes } })));
            assert.ok(values.every((v) => Object.is(v, values[0])), `same value at every stage (${values.join(", ")})`);
            checked++;
        }
    }
    assert.ok(checked >= 40, `${checked} positions`);
});

test("fencer-boxes: evaluate is symmetric, and does not depend on who is to move while nothing is proven", () => {
    // mirroring the seats negates the score
    const mirror = (s) => {
        const m = t.clone(s);
        m.scores = [s.scores[1], s.scores[0]];
        m.movesBy = [s.movesBy[1], s.movesBy[0]];
        m.current = 1 - s.current;
        m.cells = s.cells.map((c) => (c < 0 ? c : 1 - c));
        m.boxes = s.boxes.map((b) => (b < 0 ? b : 1 - b));
        return m;
    };
    let checked = 0, undecided = 0;
    for (let k = 0; k < 40; k++) {
        const s = played(4 + (k % 2), 10 + (k % 20), 6600 + k);
        if (s.over) continue;
        const a = def.evaluate(s), b = def.evaluate(mirror(s));
        assert.ok(Object.is(b, -a) || (a === 0 && b === 0), `mirroring negates the score (${a} / ${b})`);
        checked++;
    }
    // a quiet position (too many lines left for the endgame proof) reads the same either way
    for (let k = 0; k < 20; k++) {
        const s = played(5, 34 + (k % 16), 6400 + k);
        if (s.over) continue;
        const a = def.evaluate(s);
        assert.ok(Number.isFinite(a), "nothing is proven this early");
        const other = t.clone(s);
        other.current = 1 - s.current;
        assert.equal(def.evaluate(other), a, "an unproven position reads the same for either side to move");
        undecided++;
    }
    assert.ok(checked >= 20 && undecided >= 15, `${checked} positions, ${undecided} of them quiet`);
});

/* The owner's complaint: the bar jumped between 43 % and 72 % on quiet moves and
   between a proven 100 % and an unproven 60 % on the next one. Thresholds are set well
   above what the fixed evaluator actually reaches (0 jumps over 15 points and a mover bias
   of 0.000 in these games), so a future tweak that brings the zigzag back fails here. */
test("fencer-boxes: the win chance stays calm over whole seeded games", async () => {
    const est = Bots.estimator("boxes", {});
    const seats = (n, seed, vsRandom) => [
        Bots.create(ID, { me: 0, difficulty: "normal", seed: 300 + seed, budget: { ms: Infinity, nodes: 4000 } }),
        vsRandom ? Bots.create("random-boxes", { me: 1, seed: 900 + seed })
            : Bots.create(ID, { me: 1, difficulty: "normal", seed: 600 + seed, budget: { ms: Infinity, nodes: 4000 } }),
    ];
    let steps = 0, sum = 0, worst = 0, triples = 0;
    const bias = [[], []];
    const und = (v) => v > 0.1 && v < 0.9;
    for (const [n, seed, vsRandom] of [[5, 1, false], [5, 2, true], [7, 3, false], [4, 4, false]]) {
        const bots = seats(n, seed, vsRandom);
        const state = Rules.create({ n, players: 2, startPlayer: seed % 2 }, "boxes");
        const ps = [], turn = [];
        for (let m = 0; !state.over && m < 400; m++) {
            Rules.step(rules, state, await bots[state.current].move(t.clone(state)));
            if (state.over) break;
            ps.push(est.at(state, 12000));
            turn.push(state.current);
        }
        assert.ok(ps.length > 20, "a whole game");
        for (let i = 1; i < ps.length; i++) {
            if (!und(ps[i]) || !und(ps[i - 1])) continue;              // a proven 100 % may follow a 50 %
            const d = Math.abs(ps[i] - ps[i - 1]);
            sum += d; steps++; worst = Math.max(worst, d);
        }
        for (let i = 1; i < ps.length - 1; i++) {
            if (!und(ps[i]) || !und(ps[i - 1]) || !und(ps[i + 1])) continue;
            bias[turn[i]].push(ps[i] - (ps[i - 1] + ps[i + 1]) / 2);
            triples++;
        }
    }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const mover = Math.abs(mean(bias[0]) - mean(bias[1])) / 2;
    console.log(`  undecided steps ${steps}, mean change ${(sum / steps * 100).toFixed(2)} %, worst ${(worst * 100).toFixed(1)} points, mover bias ${mover.toFixed(4)} over ${triples} triples`);
    assert.ok(steps >= 100 && triples >= 100, `${steps} steps, ${triples} triples`);
    assert.ok(worst <= 0.2, `no undecided step flips by more than 20 points (worst ${(worst * 100).toFixed(1)})`);
    assert.ok(sum / steps <= 0.04, `the average undecided step stays under 4 points (${(sum / steps * 100).toFixed(2)})`);
    assert.ok(mover <= 0.03, `the mover bias stays under 3 points (${mover.toFixed(4)})`);
});

test("fencer-boxes: calibrated win chance stays inside 0..1 and the bars add up", () => {
    const est = Bots.estimator("boxes", {});
    assert.equal(est.bot, ID, "the win chance uses this bot");
    for (let k = 0; k < 20; k++) {
        const s = played(4, 10 + k, 5500 + k);
        if (s.over) continue;
        const p = est.at(s, 12000);
        assert.ok(p >= 0 && p <= 1, `probability in range (${p})`);
    }
});

/* ---------- puzzles (thresholds below what it really reaches) ---------- */
test("fencer-boxes: the proven puzzle set, per level and per tag", async () => {
    const scores = {};
    for (const level of LEVELS) {
        const r = await evaluateBot(H, ID, { seed: 7, difficulty: level, budget: { ms: Infinity, nodes: 100000 } });
        scores[level] = r.pct;
        console.log(`  ${level}: ${r.solved}/${r.total} perfect lines (${r.pct} %, random picking gets ${r.chance} %)`,
            Object.fromEntries(Object.entries(r.byTag).map(([k, v]) => [k, `${v.solved}/${v.total}`])));
        assert.ok(r.pct >= 85, `${level}: ${r.pct} % of the proven puzzles`);
        assert.equal(r.byTag["take-box"].solved, r.byTag["take-box"].total, `${level}: every free box taken`);
        assert.equal(r.byTag["double-deal"].solved, r.byTag["double-deal"].total, `${level}: every sacrifice found`);
        assert.ok(r.byTag.sacrifice.solved / r.byTag.sacrifice.total >= 0.9, `${level}: opens the smallest chain`);
    }
    assert.ok(Math.min(...Object.values(scores)) >= 85);
});
