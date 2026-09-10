/* Sensei (Five Wins): the facts that make it a real bot. Everything runs under node
   budgets (ms: Infinity) so the numbers are the same on every machine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../scripts/headless.mjs";
import { loadPuzzles, evaluateBot } from "../../../scripts/puzzles/runner.mjs";

const H = loadHeadless();
const { Bots, Rules } = H;
const ID = "sensei-five";
const def = Bots.get(ID);
const { Board } = def.internals;
const rules = Rules.of("five");
const BUDGET = { ms: Infinity, nodes: 20000 };
const LEVELS = ["easy", "normal", "hard", "very-hard"];

const t = Bots.tools("five", { seed: 1 });
const position = (hist, n = 9, winLen = 5) => { let s = rules.create({ n, winLen }, Rules.base({ n })); for (const m of hist) s = t.apply(s, m); return s; };
const ask = async (state, difficulty, seed = 3) => Bots.create(ID, { me: state.current, difficulty, seed, budget: BUDGET }).move(t.clone(state));

/* ---------- the internal board equals the real rules ---------- */
test("sensei-five: completion cells == FiveRules wins, make/unmake round-trips, potentials match a brute force (≥ 3000 random moves)", () => {
    const rnd = Bots.tools("five", { seed: 11 });
    let moves = 0, wins = 0;
    for (const [n, L] of [[5, 3], [6, 4], [7, 5], [9, 5], [9, 6], [12, 5], [15, 5], [8, 8], [6, 6]]) {
        for (let g = 0; g < 8; g++) {
            let s = rules.create({ n, winLen: L }, Rules.base({ n }));
            const B = new Board(n, L);
            while (!s.over) {
                B.load(s.cells);
                const p = s.current;
                // every empty cell: the engine says "completes a line" iff the rules say the move wins
                for (let i = 0; i < s.cells.length; i++) {
                    if (s.cells[i] !== -1) continue;
                    const after = rnd.apply(s, i);
                    const winsByRules = after.over && after.winner === p;
                    assert.equal(winsByRules, rules.lineThrough(after, i).len >= L, "rules agree with lineThrough");
                    let completes = false;
                    for (let d = 0; d < 4; d++) {
                        const id = B.lineOf[d * B.size + i];
                        if (id >= 0 && (B.rec[id * 12 + 6 + p] & (1 << B.posOf[d * B.size + i]))) completes = true;
                    }
                    assert.equal(completes, winsByRules, `n=${n} L=${L} cell ${i} for p${p}`);
                    if (winsByRules) wins++;
                }
                // potentials: sum over the L-windows through the cell without an enemy stone
                for (let i = 0; i < s.cells.length; i += 7) {
                    if (s.cells[i] !== -1) continue;
                    for (let p2 = 0; p2 < 2; p2++) {
                        let expect = 0;
                        for (let d = 0; d < 4; d++) {
                            const id = B.lineOf[d * B.size + i];
                            if (id < 0) continue;
                            const line = B.lines[id], pos = B.posOf[d * B.size + i];
                            for (let st = Math.max(0, pos - L + 1); st <= Math.min(pos, line.length - L); st++) {
                                let own = 0, enemy = 0;
                                for (let k = st; k < st + L; k++) { if (s.cells[line[k]] === p2) own++; else if (s.cells[line[k]] === 1 - p2) enemy++; }
                                if (enemy === 0) expect += B.ws[L - own - 1];
                            }
                        }
                        assert.equal(B.pot[i * 2 + p2], expect, `potential of cell ${i} for p${p2}`);
                    }
                }
                // make/unmake: identical to a fresh load, and fully reversible
                const mv = rnd.pick(rules.legalMoves(s));
                const snapshot = JSON.stringify([B.F, B.T, B.S, B.TL, B.MK, Array.from(B.rec), Array.from(B.pot), Array.from(B.nb), B.hashLo, B.hashHi, B.empties]);
                B.make(mv, p);
                const fresh = new Board(n, L);
                const cells = s.cells.slice(); cells[mv] = p; fresh.load(cells);
                assert.equal(JSON.stringify([B.F, B.T, B.S, B.TL, B.MK, Array.from(B.rec), B.hashLo, B.hashHi, B.empties]), JSON.stringify([fresh.F, fresh.T, fresh.S, fresh.TL, fresh.MK, Array.from(fresh.rec), fresh.hashLo, fresh.hashHi, fresh.empties]));
                for (let c = 0; c < B.size; c++) if (B.cell[c] === -1) assert.equal(B.pot[c * 2] * 65536 + B.pot[c * 2 + 1], fresh.pot[c * 2] * 65536 + fresh.pot[c * 2 + 1], `potential after make at ${c}`);
                B.unmake();
                assert.equal(JSON.stringify([B.F, B.T, B.S, B.TL, B.MK, Array.from(B.rec), Array.from(B.pot), Array.from(B.nb), B.hashLo, B.hashHi, B.empties]), snapshot, "unmake restores everything");
                s = rnd.apply(s, mv);
                moves++;
            }
        }
    }
    assert.ok(moves >= 3000, `${moves} random moves checked`);
    assert.ok(wins >= 200, `${wins} winning placements seen`);
});

/* ---------- tactics on hand-made 9×9 positions (cell = y * 9 + x) ---------- */
const TACTICS = [
    // X 40-43 in row 4, both ends open: take the five
    ["takes a win in one", [40, 0, 41, 1, 42, 2, 43, 3], [39, 44]],
    // X 36-39 (row 4 from the edge): the only completion cell is 40
    ["blocks a four", [36, 60, 37, 61, 38, 62, 39], [40]],
    // X 39-41 with room on both sides: only 38 / 42 stop the open four
    ["blocks an open three", [39, 0, 40, 1, 41], [38, 42]],
    // both sides have a four; taking the win beats blocking
    ["prefers its own win over blocking", [36, 45, 37, 46, 38, 47, 39, 48], [40]],
    // 31 makes a four in column 4 (block at 40 forced) and an open three in row 3: four-three
    ["finds a four-three double threat", [4, 62, 13, 64, 22, 66, 29, 68, 30, 80], [31]],
];
for (const [name, hist, best] of TACTICS) {
    test(`sensei-five: ${name} (normal, hard, very-hard)`, async () => {
        const s = position(hist);
        for (const b of best) assert.ok(rules.isLegal(s, b, s.current));
        for (const level of ["normal", "hard", "very-hard"]) {
            const got = await ask(s, level);
            assert.ok(best.includes(got), `${level}: got ${got}, expected one of ${best}`);
        }
    });
}

/* ---------- determinism and honest node counting ---------- */
test("sensei-five: same seed → same move; nodes stay within the budget; different budgets are allowed to differ", async () => {
    const s = position([40, 31, 41, 32, 49, 22, 48]);
    for (const level of LEVELS) {
        const a = Bots.create(ID, { me: s.current, difficulty: level, seed: 9, budget: BUDGET });
        const b = Bots.create(ID, { me: s.current, difficulty: level, seed: 9, budget: BUDGET });
        assert.equal(await a.move(t.clone(s)), await b.move(t.clone(s)), level);
    }
    const quiet = position([40, 31, 41, 32, 49, 22, 48, 58, 30, 50]);
    for (const nodes of [500, 3000]) {
        const inst = def.create(Bots.tools("five", { me: 1, difficulty: "very-hard", seed: 1, budget: { ms: Infinity, nodes } }));
        await inst.move(t.clone(quiet));
        const used = inst.searcher.d.nodes();
        assert.ok(used > 0 && used <= nodes, `ticked ${used} nodes for a ${nodes} budget`);
        assert.ok(inst.searcher.info.depth >= 1, "kept a completed depth");
    }
});

test("sensei-five: handles other win lengths and sizes (3-in-a-row on 5×5, 6 on 12×12, 4 on 25×25)", async () => {
    // 5×5, winLen 3: X 6 7 → 5 or 8 wins
    let s = position([6, 20, 7, 21], 5, 3);
    for (const level of LEVELS) assert.ok([5, 8].includes(await ask(s, level)), level);
    // 12×12, winLen 6: X 60..64 (row 5, x 0..4) → 65 is the only completion cell, O must block
    s = position([60, 130, 61, 131, 62, 132, 63, 133, 64], 12, 6);
    for (const level of ["normal", "hard", "very-hard"]) assert.equal(await ask(s, level), 65, level);
    // 25×25, winLen 4: legal and quick
    s = position([312, 313, 337, 338], 25, 4);
    const t0 = Date.now();
    const got = await ask(s, "very-hard");
    assert.ok(rules.isLegal(s, got, s.current));
    assert.ok(Date.now() - t0 < 4000, `25×25 move in ${Date.now() - t0} ms`);
});

/* ---------- puzzles: thresholds below what the levels reach (never 100 %) ---------- */
const set = loadPuzzles("five");
test("sensei-five: puzzle score per level, each level ≥ the previous", { skip: !set && "no puzzle set in tests/puzzles/five yet" }, async () => {
    const THRESHOLD = { "easy": 30, "normal": 70, "hard": 85, "very-hard": 92 };
    let previous = -1;
    for (const level of LEVELS) {
        const r = await evaluateBot(H, ID, { difficulty: level, seed: 7, budget: BUDGET });
        console.log(`  sensei-five ${level}: ${r.solved}/${r.total} = ${r.pct} % (chance ${r.chance} %)`, Object.fromEntries(Object.entries(r.byTag).map(([k, v]) => [k, `${v.solved}/${v.total}`])));
        assert.ok(r.pct >= THRESHOLD[level], `${level}: ${r.pct} % ≥ ${THRESHOLD[level]} %`);
        assert.ok(r.pct >= previous, `${level} (${r.pct} %) not below the previous level (${previous} %)`);
        previous = r.pct;
    }
});

/* ---------- head-to-head ---------- */
async function series(a, da, b, db, games, cfg) {
    let points = 0, moves = 0;
    for (let g = 0; g < games; g++) {
        const seat = g % 2;
        const A = Bots.create(a, { seed: 100 + g, me: seat, difficulty: da, budget: BUDGET });
        const B = Bots.create(b, { seed: 300 + g, me: 1 - seat, difficulty: db, budget: BUDGET });
        const r = await Bots.playout("five", { ...cfg, startPlayer: g % 2 }, seat === 0 ? [A, B] : [B, A], { maxMoves: 200 });
        if (r.winner === seat) points += 1; else if (r.winner === null || r.winner < 0) points += 0.5;
        moves += r.moves;
    }
    return { points, avgMoves: moves / games };
}
test("sensei-five: Very hard beats Random in ≥ 95 % of 20 games (9×9, both colours)", async () => {
    const r = await series(ID, "very-hard", "random-five", "normal", 20, { n: 9, winLen: 5 });
    console.log(`  very-hard vs random: ${r.points}/20 points, avg ${r.avgMoves.toFixed(0)} moves`);
    assert.ok(r.points >= 19, `${r.points} points`);
});
test("sensei-five: Hard beats Easy over 10 games", async () => {
    const r = await series(ID, "hard", ID, "easy", 10, { n: 9, winLen: 5 });
    console.log(`  hard vs easy: ${r.points}/10 points, avg ${r.avgMoves.toFixed(0)} moves`);
    assert.ok(r.points >= 7, `${r.points} points`);
});

/* ---------- speed ---------- */
test("sensei-five: Very hard answers within 600 ms per move at 15×15 under a 20 000-node budget (report: 9×9 and 15×15)", async () => {
    for (const n of [9, 15]) {
        let s = rules.create({ n, winLen: 5 }, Rules.base({ n }));
        const bot = Bots.create(ID, { seed: 1, me: 0, difficulty: "very-hard", budget: BUDGET });
        const other = Bots.create(ID, { seed: 2, me: 1, difficulty: "normal", budget: BUDGET });
        const times = [];
        for (let k = 0; k < 8 && !s.over; k++) {
            const t0 = performance.now();
            const mv = await bot.move(t.clone(s));
            times.push(performance.now() - t0);
            s = t.apply(s, mv);
            if (!s.over) s = t.apply(s, await other.move(t.clone(s)));
        }
        const max = Math.max(...times);
        console.log(`  ${n}×${n} very-hard ms/move: ${times.map((x) => x.toFixed(0)).join(" ")} (max ${max.toFixed(0)})`);
        assert.ok(max < 600, `${n}×${n}: slowest move ${max.toFixed(0)} ms`);
    }
});

/* ---------- win chance estimate ---------- */
test("sensei-five: estimate() — 0.5 on an empty board, open four ≈ 1 / 0, terminal exact, ≤ 15 ms at 15×15", () => {
    const est = def.estimate;
    assert.equal(est(position([])), 0.5);
    assert.equal(est(rules.create({ n: 15, winLen: 5 }, Rules.base({ n: 15 }))), 0.5);
    const openFourP0 = position([40, 0, 41, 1, 42, 2, 43]);                 // O to move, cannot stop 39/44
    assert.ok(est(openFourP0) > 0.9, `open four for player 0: ${est(openFourP0)}`);
    const openFourP1 = position([0, 40, 1, 41, 2, 42, 3, 43, 72]);         // the mirror: player 1 has it
    assert.ok(est(openFourP1) < 0.1, `open four for player 1: ${est(openFourP1)}`);
    const fourToMove = position([36, 60, 37, 61, 38, 62, 39, 63]);         // player 0 to move with a completion cell
    assert.ok(est(fourToMove) > 0.95);
    const won0 = t.apply(position([40, 0, 41, 1, 42, 2, 43, 3]), 44);
    assert.equal(won0.over, true); assert.equal(est(won0), 1);
    const won1 = t.apply(position([0, 40, 1, 41, 2, 42, 3, 43, 72]), 44);
    assert.equal(won1.winner, 1); assert.equal(est(won1), 0);
    let draw = rules.create({ n: 3, winLen: 3 }, Rules.base({ n: 3 }));
    for (const m of [0, 1, 2, 4, 3, 5, 7, 6, 8]) draw = t.apply(draw, m);
    assert.equal(draw.over, true); assert.equal(draw.winner, -1); assert.equal(est(draw), 0.5);
    // deterministic, symmetric-ish, monotone with material
    assert.equal(est(position([40, 31])), est(position([40, 31])));
    assert.ok(est(position([40, 0, 41, 1, 42])) > 0.6, "three stones in a row vs scattered");
    // speed: a 15×15 middlegame
    let s = rules.create({ n: 15, winLen: 5 }, Rules.base({ n: 15 }));
    const r = Bots.tools("five", { seed: 5 });
    for (let k = 0; k < 40; k++) s = r.apply(s, r.pick(rules.legalMoves(s)));
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) est(s);
    const ms = (performance.now() - t0) / 20;
    assert.ok(ms <= 15, `estimate took ${ms.toFixed(2)} ms`);
});
