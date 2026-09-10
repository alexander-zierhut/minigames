/* Creeper (Chain React): what makes this bot good.
   - its internal rules engine is identical to ChainRules (thousands of random moves)
   - it takes a win in one and never hands the opponent a takeover (hand-made positions)
   - puzzle thresholds per level (tests/puzzles/chain, proven perfect moves), each level
     at least as good as the previous one
   - head-to-head: Very hard beats Random, Hard beats Easy
   - evaluate() (the HUD's win chance): exact when over, 0 on an empty board, mirror
     symmetric, deterministic per node budget, a few ms at 2 000 nodes, decisive when the
     side to move can take over, and — the reason it exists — stable from move to move
     (a swing measurement over ten seeded Normal-vs-Normal games)
   Everything runs under node budgets (ms: Infinity), so the numbers are the same on any
   machine. Thresholds sit below what the bot really reaches (see README.md). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { evaluateBot } from "../../../scripts/puzzles/runner.mjs";

const H = loadHeadless();
const { Bots, Rules } = H;
const rules = Rules.of("chain");
const ID = "creeper-chain";
const I = Bots.get(ID).internals;
const BUDGET = { ms: Infinity, nodes: 20000 };
const LEVELS = ["easy", "normal", "hard", "veryhard"];

const fresh = (cfg) => rules.create(cfg, Rules.base(cfg));
// a position from a move list (player 0 starts), via the real rules
function position(cfg, history) {
    const t = Bots.tools("chain", { seed: 1 });
    let state = fresh(cfg);
    for (const i of history) state = t.apply(state, i);
    return state;
}
const winsNow = (t, state) => t.legalMoves(state).some((i) => t.apply(state, i).over);

test("creeper-chain: internal rules equal ChainRules on 3000+ random moves (3×3…8×8, chain rule on and off)", () => {
    const t = Bots.tools("chain", { seed: 1 });
    let moves = 0;
    for (let g = 0; moves < 3500; g++) {
        const n = 3 + (g % 6);
        const cfg = { n, chainRule: g % 3 === 2, chainLen: 2 + (g % 5) };
        let state = fresh(cfg);
        let pos = I.fromState(state);
        while (!state.over && moves < 3500) {
            const i = t.pick(t.legalMoves(state));
            const real = t.apply(state, i);
            const mine = I.apply(pos, i, { chainRule: state.chainRule, chainLen: state.chainLen });
            for (let k = 0; k < n * n; k++) {
                assert.equal(mine.cnt[k], real.cells[k].count, `game ${g} move ${i}: count of cell ${k}`);
                assert.equal(mine.own[k], real.cells[k].owner, `game ${g} move ${i}: owner of cell ${k}`);
            }
            assert.equal(mine.over, real.over, `game ${g} move ${i}: over`);
            if (real.over) assert.equal(mine.winner, real.winner, `game ${g} move ${i}: winner`);
            else assert.equal(mine.mover, real.current, `game ${g} move ${i}: side to move`);
            state = real; pos = mine; moves++;
        }
    }
    assert.ok(moves >= 3500);
});

test("creeper-chain: takes a win in one at every level above Easy", async () => {
    // 3×3 after 0, 1: one more piece on the corner converts 1 and 3, player 1 owns nothing
    const state = position({ n: 3, chainRule: false }, [0, 1]);
    for (const difficulty of LEVELS.slice(1)) {
        const bot = Bots.create(ID, { me: 0, difficulty, seed: 3, budget: BUDGET });
        assert.equal(await bot.move(bot.tools.clone(state)), 0, `${difficulty} plays the winning corner`);
    }
});

test("creeper-chain: never hands the opponent an immediate takeover (every level above Easy)", async () => {
    // 4×4 after 12, 8, 9 — player 1 to move. Player 0's corner 12 is one piece from
    // exploding onto 8 and 13: putting a piece on either of them lets 12 blow and take
    // everything. 12 of 14 moves are fine, 2 lose on the spot.
    const state = position({ n: 4, chainRule: false }, [12, 8, 9]);
    const t = Bots.tools("chain", { seed: 1 });
    assert.equal(state.current, 1);
    assert.ok(!winsNow(t, state), "no immediate win for player 1");
    const losing = t.legalMoves(state).filter((i) => winsNow(t, t.apply(state, i)));
    assert.equal(JSON.stringify(losing), "[8,13]", "exactly these moves lose at once");
    for (const difficulty of LEVELS.slice(1)) {
        const bot = Bots.create(ID, { me: 1, difficulty, seed: 3, budget: BUDGET });
        const i = await bot.move(t.clone(state));
        assert.ok(!losing.includes(i), `${difficulty} avoids the takeover (played ${i})`);
    }
});

test("creeper-chain: puzzles — thresholds per level, each level at least as good as the previous", async () => {
    const results = {};
    for (const difficulty of LEVELS) results[difficulty] = await evaluateBot(H, ID, { difficulty, budget: BUDGET });
    const pct = LEVELS.map((d) => results[d].pct);
    console.log(`creeper-chain puzzles at 20 000 nodes: ${LEVELS.map((d, k) => `${d} ${results[d].solved}/${results[d].total} (${pct[k]} %)`).join(", ")}, chance ${results.easy.chance} %`);
    // measured: easy 32 %, normal 87 %, hard 95 %, veryhard 100 % (Random: 22 %, chance 23 %)
    assert.ok(results.easy.pct >= 26, `Easy above chance (${results.easy.pct} %)`);
    assert.ok(results.normal.pct >= 75, `Normal (${results.normal.pct} %)`);
    assert.ok(results.hard.pct >= 85, `Hard (${results.hard.pct} %)`);
    assert.ok(results.veryhard.pct >= 95, `Very hard (${results.veryhard.pct} %)`);
    assert.equal(results.veryhard.byTag["win-in-1"].solved, results.veryhard.byTag["win-in-1"].total, "Very hard finds every win in one");
    assert.equal(results.veryhard.byTag["avoid-loss"].solved, results.veryhard.byTag["avoid-loss"].total, "Very hard never allows the takeover");
    for (let k = 1; k < LEVELS.length; k++) assert.ok(pct[k] >= pct[k - 1], `${LEVELS[k]} (${pct[k]} %) ≥ ${LEVELS[k - 1]} (${pct[k - 1]} %)`);
});

async function series(a, b, games, cfg = { n: 6, chainRule: false }, maxMoves = 600) {
    let points = 0;
    for (let g = 0; g < games; g++) {
        const me = g % 2;
        const A = Bots.create(a.id, { seed: 100 + g, me, difficulty: a.difficulty, budget: BUDGET });
        const B = Bots.create(b.id, { seed: 300 + g, me: 1 - me, difficulty: b.difficulty, budget: BUDGET });
        const r = await Bots.playout("chain", { ...cfg, startPlayer: g % 2 }, me === 0 ? [A, B] : [B, A], { maxMoves });
        if (r.winner === me) points += 1; else if (r.winner === null) points += 0.5;
    }
    return points;
}

test("creeper-chain: Very hard beats Random in at least 90 % of 20 games on 6×6", async () => {
    const points = await series({ id: ID, difficulty: "veryhard" }, { id: "random-chain" }, 20);
    console.log(`creeper-chain Very hard vs Random: ${points}/20`);
    assert.ok(points >= 18, `${points}/20`);
});

test("creeper-chain: Hard beats Easy over 10 games", async () => {
    const points = await series({ id: ID, difficulty: "hard" }, { id: ID, difficulty: "easy" }, 10);
    console.log(`creeper-chain Hard vs Easy: ${points}/10`);
    assert.ok(points >= 7, `${points}/10`);
});

test("creeper-chain: same seed and budget give the same move; Easy varies with the seed", async () => {
    const state = position({ n: 6, chainRule: false }, [0, 35, 7, 28, 14, 21]);
    const t = Bots.tools("chain", { seed: 1 });
    const a = Bots.create(ID, { me: 0, difficulty: "veryhard", seed: 9, budget: BUDGET });
    const b = Bots.create(ID, { me: 0, difficulty: "veryhard", seed: 9, budget: BUDGET });
    assert.equal(await a.move(t.clone(state)), await b.move(t.clone(state)));
    const easy = new Set();
    for (let seed = 1; seed <= 12; seed++) easy.add(await Bots.create(ID, { me: 0, difficulty: "easy", seed, budget: BUDGET }).move(t.clone(state)));
    assert.ok(easy.size >= 2, "Easy does not always play the same move");
});

/* ---------- evaluate(): the win-chance judge ---------- */
const NODES_QUICK = 2000, NODES_REFINE = 12000;             // the framework's first two ESTIMATE_STAGES
const judgeTools = (nodes) => Bots.tools("chain", { seed: 0, budget: { ms: Infinity, nodes } });
const judge = (state, nodes) => Bots.get(ID).evaluate(state, judgeTools(nodes));
// the same position with the colours swapped (and the other side to move)
function mirror(state) {
    const m = JSON.parse(JSON.stringify(state));
    for (const c of m.cells) if (c.owner >= 0) c.owner = 1 - c.owner;
    m.current = 1 - m.current;
    m.movesBy = [m.movesBy[1], m.movesBy[0]];
    if (m.over) m.winner = m.winner < 0 ? -1 : 1 - m.winner;
    return m;
}
// ten seeded games on 6×6: six random plies (Normal itself is deterministic, so the games
// would otherwise be two mirror images), then Creeper Normal vs Normal; every settled position
async function judgeGames(games = 10, n = 6) {
    const cfg = { n, chainRule: false };
    const out = [];
    for (let g = 0; g < games; g++) {
        const A = Bots.create(ID, { seed: 100 + g, me: 0, difficulty: "normal", budget: BUDGET });
        const B = Bots.create(ID, { seed: 300 + g, me: 1, difficulty: "normal", budget: BUDGET });
        const t = Bots.tools("chain", { seed: 1000 + g });
        let state = fresh({ ...cfg, startPlayer: g % 2 });
        const positions = [t.clone(state)];
        for (let m = 0; !state.over && m < 600; m++) {
            const i = m < 6 ? t.pick(t.legalMoves(state)) : await (state.current === 0 ? A : B).move(t.clone(state));
            state = t.apply(state, i);
            positions.push(t.clone(state));
        }
        assert.ok(state.over, `game ${g} finished`);
        out.push(positions);
    }
    return out;
}

test("creeper-chain: evaluate — terminal exact, empty board 0, mirror symmetric, deterministic, budget-bound, quick", async () => {
    const cfg = { n: 6, chainRule: false };
    assert.equal(judge(fresh({ n: 4, chainRule: false }), NODES_QUICK), 0, "empty 4×4 board");
    assert.equal(judge(fresh(cfg), NODES_QUICK), 0, "empty 6×6 board");
    for (const [winner, want] of [[0, Infinity], [1, -Infinity], [-1, 0]]) {
        const over = position(cfg, [0, 35]);
        over.over = true; over.winner = winner;
        assert.equal(judge(over, NODES_QUICK), want, `terminal, winner ${winner}`);
    }
    // a big material lead is a big positive score, and its mirror image the negative
    const winning = fresh(cfg);
    for (let i = 0; i < 18; i++) { winning.cells[i].owner = 0; winning.cells[i].count = Math.min(2, winning.cells[i].cap - 1); }
    winning.cells[35].owner = 1; winning.cells[35].count = 1;
    winning.movesBy = [12, 12]; winning.current = 1;
    const big = judge(winning, NODES_QUICK);
    assert.ok(big > 10, `player 0 clearly ahead: ${big}`);
    assert.equal(judge(mirror(winning), NODES_QUICK), -big, "mirror image negated");
    // random middlegame positions: mirror symmetric at both budgets, deterministic, budget honoured
    const t = Bots.tools("chain", { seed: 4 });
    let state = fresh(cfg);
    for (let k = 0; k < 30 && !state.over; k++) state = t.apply(state, t.pick(t.legalMoves(state)));
    for (const nodes of [NODES_QUICK, NODES_REFINE]) {
        const tools = judgeTools(nodes);
        let d = null;
        const deadline = tools.deadline;
        tools.deadline = (...a) => (d = deadline(...a));
        const raw = await Bots.get(ID).evaluate(state, tools);
        assert.ok(Number.isFinite(raw), `finite middlegame score at ${nodes} nodes (${raw})`);
        assert.ok(d && d.nodes() <= nodes && d.nodes() >= nodes * 0.9, `${nodes}-node budget used up to the node (${d && d.nodes()})`);
        assert.equal(await judge(state, nodes), raw, `deterministic at ${nodes} nodes`);
        assert.equal(await judge(mirror(state), nodes), -raw, `mirror symmetric at ${nodes} nodes`);
    }
    const quick = judge(state, NODES_QUICK), refined = judge(state, NODES_REFINE);
    assert.equal(typeof quick, "number", "the quick stage answers synchronously");
    assert.equal(typeof refined.then, "function", "the refinement stages yield to the page (Promise)");
    await refined;
    // timing of the quick stage on a busy 6×6 middlegame (the HUD calls it after every move)
    const t0 = performance.now();
    for (let k = 0; k < 40; k++) judge(state, NODES_QUICK);
    const avg = (performance.now() - t0) / 40;
    console.log(`creeper-chain evaluate at ${NODES_QUICK} nodes: ${avg.toFixed(2)} ms per call on 6×6`);
    assert.ok(avg < 5, `average ${avg.toFixed(2)} ms`);
});

test("creeper-chain: evaluate — decisive when the side to move can take over, proofs survive more nodes", async () => {
    const t = Bots.tools("chain", { seed: 1 });
    const games = await judgeGames(6);
    let takeovers = 0, proven = 0;
    for (const positions of games) for (const state of positions) {
        if (state.over) continue;
        const quick = judge(state, NODES_QUICK);
        const mover = state.current;
        if (winsNow(t, state)) {
            takeovers++;
            assert.equal(quick, mover === 0 ? Infinity : -Infinity, `takeover available for player ${mover} after ${state.history.length} moves`);
        }
        if (!Number.isFinite(quick)) {
            proven++;
            assert.equal(await judge(state, NODES_REFINE), quick, `a proof at ${NODES_QUICK} nodes still holds at ${NODES_REFINE} (after ${state.history.length} moves)`);
        }
    }
    console.log(`creeper-chain evaluate: ${takeovers} positions with an immediate takeover, ${proven} proven at ${NODES_QUICK} nodes`);
    assert.ok(takeovers >= 6 && proven >= takeovers, `enough decisive positions in the sample (${takeovers}, ${proven})`);
});

/* Swing: how much the HUD number moves from one position to the next. p = logistic(raw / S)
   with a fixed S = SCALE (≈ the score of a clear advantage: a dozen pieces; the framework
   fits the real scale from self-play). Measured on the same ten games:
     old estimate():                          all steps 0.0563   undecided steps 0.0548   mover bias ±0.039
     evaluate() at 12 000 nodes (S = 10):     all steps 0.0579   undecided steps 0.0427   mover bias ±0.009
     (2 000 nodes: 0.0503 / 0.0437 / ±0.016;  60 000 nodes: 0.0549 / 0.0365 / ±0.006)
   "undecided" = neither position is a proven win (a proven win that a depth-2 Normal bot
   then throws away is a real 100 → 0 swing, not a jumpy evaluator). The mover bias is the
   odd/even zigzag the judge exists to remove: the mean of p − (p_before + p_after) / 2,
   split by the side to move — an evaluator that always favours the mover shows +b / −b. */
const SCALE = 10;
const SWING_ALL = 0.065, SWING_UNDECIDED = 0.05, BIAS = 0.02;
test("creeper-chain: evaluate — swing between consecutive positions of ten Normal vs Normal games", async () => {
    const games = await judgeGames(10);
    const logistic = (raw) => raw === Infinity ? 1 : raw === -Infinity ? 0 : 1 / (1 + Math.exp(-raw / SCALE));
    const rows = [];
    let ms = 0;
    for (const positions of games) {
        const line = [];
        for (const state of positions) {
            const t0 = performance.now();
            const raw = await judge(state, NODES_REFINE);
            ms += performance.now() - t0;
            line.push({ p: logistic(raw), raw, mover: state.current });
        }
        rows.push(line);
    }
    const positions = rows.reduce((a, l) => a + l.length, 0);
    const swing = (filter) => {
        let sum = 0, cnt = 0;
        for (const line of rows) for (let k = 1; k < line.length; k++) {
            if (!filter(line[k - 1], line[k])) continue;
            sum += Math.abs(line[k].p - line[k - 1].p); cnt++;
        }
        return sum / cnt;
    };
    const all = swing(() => true);
    const undecided = swing((a, b) => Number.isFinite(a.raw) && Number.isFinite(b.raw));
    const bias = [[0, 0], [0, 0]];
    for (const line of rows) for (let k = 1; k + 1 < line.length; k++) {
        if (![k - 1, k, k + 1].every((j) => Number.isFinite(line[j].raw))) continue;
        const r = line[k];
        bias[r.mover][0] += r.p - (line[k - 1].p + line[k + 1].p) / 2; bias[r.mover][1]++;
    }
    const b0 = bias[0][0] / bias[0][1], b1 = bias[1][0] / bias[1][1];
    console.log(`creeper-chain evaluate swing (${positions} positions, ${NODES_REFINE} nodes, S=${SCALE}, ${(ms / positions).toFixed(1)} ms/position): all steps ${all.toFixed(4)}, undecided ${undecided.toFixed(4)}, mover bias ${b0.toFixed(4)} / ${b1.toFixed(4)}`);
    assert.ok(all < SWING_ALL, `mean |Δp| over all steps ${all.toFixed(4)} < ${SWING_ALL}`);
    assert.ok(undecided < SWING_UNDECIDED, `mean |Δp| over undecided steps ${undecided.toFixed(4)} < ${SWING_UNDECIDED}`);
    assert.ok(Math.abs(b0) < BIAS && Math.abs(b1) < BIAS, `no mover bias (${b0.toFixed(4)}, ${b1.toFixed(4)})`);
});
