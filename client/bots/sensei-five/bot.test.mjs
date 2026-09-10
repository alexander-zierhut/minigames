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
const yavSet = loadPuzzles("five-yavalath");
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

/* ---------- the Yavalath rule: winLen wins, winLen - 1 loses ---------- */
const YAV = { n: 7, winLen: 4, yavalath: true };
const yavPos = (hist, cfg = YAV) => { let s = rules.create(cfg, Rules.base(cfg)); for (const m of hist) s = t.apply(s, m); return s; };

test("sensei-five (Yavalath): never makes the losing row while a safe move exists (seeded random positions, every level)", async () => {
    const rnd = Bots.tools("five", { seed: 77 });
    let checked = 0, traps = 0;
    for (const level of LEVELS) {
        let s = yavPos([]);
        for (let k = 0; k < 60; k++) {
            if (s.over) s = yavPos([]);
            if (s.current === 1) {
                const B = new Board(s.n, s.winLen, true);
                B.load(s.cells);
                const legal = rules.legalMoves(s);
                const safe = legal.filter((i) => !B.suicidal(i, 1));
                if (safe.length) traps += legal.length - safe.length;
                const i = await Bots.create(ID, { me: 1, difficulty: level, seed: 5, budget: BUDGET }).move(t.clone(s));
                assert.ok(rules.isLegal(s, i, 1), `${level}: legal`);
                if (safe.length) assert.ok(safe.includes(i), `${level}: ${i} makes ${s.winLen - 1} in a row although ${safe.length} safe cells are free`);
                checked++;
            }
            s = rnd.apply(s, rnd.pick(rules.legalMoves(s)));
        }
    }
    assert.ok(checked >= 100 && traps >= 20, `${checked} moves checked, ${traps} losing cells were on the board`);
});

test("sensei-five (Yavalath): completes the four, and blocks the opponent's four when the block is safe", async () => {
    // X 0,1 and 3 in the top row: 2 completes four (21 would only be three)
    const win = yavPos([0, 21, 1, 23, 3, 35]);
    assert.equal(win.current, 0);
    for (const level of ["normal", "hard", "very-hard"]) assert.equal(await ask(win, level), 2, `${level}: takes the four`);
    // O 8,9 and 11 in row 1: X has to take 10, and taking it makes nothing for X
    const block = yavPos([28, 8, 30, 9, 48, 11]);
    assert.equal(block.current, 0);
    for (const level of ["normal", "hard", "very-hard"]) assert.equal(await ask(block, level), 10, `${level}: blocks the four`);
});

test("sensei-five (Yavalath): plays the trap that forces the opponent to make the losing row", async () => {
    // X 22,23 in row 3, O 10,17 in column 3. X 25 makes X X _ X: O must take 24, and 24 is
    // O's third stone in the column, so O loses. The proven best move of the puzzle solver.
    const s = yavPos([22, 10, 23, 17, 42, 48]);
    assert.equal(s.current, 0);
    for (const level of ["normal", "hard", "very-hard"]) assert.equal(await ask(s, level), 25, `${level}: sets the trap`);
    // and it really is a trap: the only block ends the game against the opponent
    const after = t.apply(t.apply(s, 25), 24);
    assert.equal(after.over, true); assert.equal(after.winner, 0);
});

test("sensei-five (Yavalath): does not walk into the trap (it answers the four without making three)", async () => {
    // the same position one move on: O to move, 24 is the only block and it loses, so O must
    // play something else instead of blocking
    const s = t.apply(yavPos([22, 10, 23, 17, 42, 48]), 25);
    assert.equal(s.current, 1);
    for (const level of ["normal", "hard", "very-hard"]) {
        const got = await ask(s, level);
        assert.notEqual(got, 24, `${level}: blocking would end the game against it`);
        assert.ok(rules.isLegal(s, got, 1));
    }
});

test("sensei-five (Yavalath): evaluate() knows the rule (a made three is decided, the trap is a win)", async () => {
    const lost0 = t.apply(yavPos([0, 21, 1, 23]), 2);            // X makes three: X has lost
    assert.equal(lost0.over, true); assert.equal(lost0.winner, 1);
    assert.equal(await evalAt(lost0, 2000), -Infinity);
    assert.equal(await evalAt({ ...lost0, over: false, winner: undefined }, 12000), -Infinity, "read off the board too");
    const trap = yavPos([22, 10, 23, 17, 42, 48]);               // X to move: 25 forces the losing block
    for (const nodes of [2000, 12000]) assert.equal(await evalAt(trap, nodes), Infinity, `trap @${nodes}`);
    // and without the rule the very same block is harmless: the game simply goes on
    const plain = t.apply(t.apply(position([22, 10, 23, 17, 42, 48], 7, 4), 25), 24);
    assert.equal(plain.over, false, "three in a row is nothing in Five Wins");
});

test("sensei-five (Yavalath): puzzle score on tests/puzzles/five-yavalath, each level ≥ the previous", { skip: !yavSet && "no Yavalath puzzle set yet" }, async () => {
    const THRESHOLD = { "easy": 25, "normal": 55, "hard": 70, "very-hard": 80 };
    let previous = -1;
    for (const level of LEVELS) {
        const r = await evaluateBot(H, ID, { difficulty: level, seed: 7, budget: BUDGET, set: yavSet });
        console.log(`  sensei-five ${level} (yavalath): ${r.solved}/${r.total} = ${r.pct} % (chance ${r.chance} %)`, Object.fromEntries(Object.entries(r.byTag).map(([k, v]) => [k, `${v.solved}/${v.total}`])));
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
test("sensei-five (Yavalath): Very hard beats Random in ≥ 95 % of 20 games (9×9, 4 wins / 3 loses, both colours)", async () => {
    const r = await series(ID, "very-hard", "random-five", "normal", 20, { n: 9, winLen: 4, yavalath: true });
    console.log(`  very-hard vs random (yavalath): ${r.points}/20 points, avg ${r.avgMoves.toFixed(0)} moves`);
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

/* ---------- win chance: evaluate(state, tools) — raw score from player 0's view ---------- */
const evalAt = (state, nodes) => def.evaluate(state, Bots.tools("five", { seed: 0, budget: { ms: Infinity, nodes } }));
const S = 300;                                                   // units of a clear advantage (see README)
const logistic = (raw) => (raw === Infinity ? 1 : raw === -Infinity ? 0 : 1 / (1 + Math.exp(-raw / S)));
const mirror = (state) => ({ ...state, cells: state.cells.map((c) => (c < 0 ? c : 1 - c)), current: 1 - state.current, movesBy: [state.movesBy[1], state.movesBy[0]] });

test("sensei-five: evaluate() — terminal positions exact, empty board 0, a full board 0", async () => {
    const won0 = t.apply(position([40, 0, 41, 1, 42, 2, 43, 3]), 44);
    assert.equal(won0.winner, 0); assert.equal(await evalAt(won0, 2000), Infinity);
    const won1 = t.apply(position([0, 40, 1, 41, 2, 42, 3, 43, 72]), 44);
    assert.equal(won1.winner, 1); assert.equal(await evalAt(won1, 2000), -Infinity);
    // a five on the board counts even when the flags are missing (a state rebuilt from cells)
    assert.equal(await evalAt({ ...won0, over: false, winner: undefined }, 12000), Infinity);
    let draw = rules.create({ n: 3, winLen: 3 }, Rules.base({ n: 3 }));
    for (const m of [1, 0, 2, 5, 3, 6, 4, 7, 8]) draw = t.apply(draw, m);
    assert.equal(draw.winner, -1); assert.equal(await evalAt(draw, 2000), 0);
    // a dead board (#18: no window free of the opponent for anyone, 2 cells still empty) is a draw
    // for the engine too, flags or not: the engine's open-window totals reach 0 exactly there
    let dead = rules.create({ n: 6, winLen: 5 }, Rules.base({ n: 6 }));
    for (const m of [22, 0, 18, 35, 33, 9, 21, 25, 13, 34, 14, 16, 4, 12, 7, 5, 19, 2, 17, 29, 10, 6, 1, 23, 27, 30, 11, 8, 28, 24, 31, 3, 26, 20]) dead = t.apply(dead, m);
    assert.equal(dead.over, true); assert.equal(dead.winner, -1); assert.equal(dead.cells.filter((c) => c < 0).length, 2);
    const deadBoard = new Board(6, 5); deadBoard.load(dead.cells);
    assert.equal(JSON.stringify(deadBoard.OW), "[0,0]", "no open window for either player");
    assert.equal(await evalAt(dead, 2000), 0);
    assert.equal(await evalAt({ ...dead, over: false, winner: undefined }, 12000), 0);
    for (const nodes of [2000, 12000, 60000]) {
        assert.equal(await evalAt(position([]), nodes), 0, `empty 9×9 @${nodes}`);
        assert.equal(await evalAt(rules.create({ n: 15, winLen: 5 }, Rules.base({ n: 15 })), nodes), 0, `empty 15×15 @${nodes}`);
    }
});

test("sensei-five: evaluate() — a four / open four is decided whoever is to move, immediate threats are handled at 2 000 nodes", async () => {
    const openFourP0 = position([40, 0, 41, 1, 42, 2, 43]);                 // O to move, cannot stop 39/44
    const fourToMoveP0 = position([36, 60, 37, 61, 38, 62, 39, 63]);         // X to move with a completion cell
    const openFourP1 = position([0, 40, 1, 41, 2, 42, 3, 43, 72]);           // the mirror: O owns the open four, X to move
    const twoFoursP1 = position([0, 36, 2, 37, 4, 38, 6, 39, 8, 45, 18, 46, 20, 47, 22, 48]);   // O 36-39 and 45-48, X scattered
    for (const nodes of [2000, 12000]) {
        assert.equal(await evalAt(openFourP0, nodes), Infinity, `open four p0 @${nodes}`);
        assert.equal(await evalAt(fourToMoveP0, nodes), Infinity, `four to move p0 @${nodes}`);
        assert.equal(await evalAt(openFourP1, nodes), -Infinity, `open four p1 @${nodes}`);
    }
    // one enemy four: the forced block is assumed, the score stays finite (X blocks 40 and plays on)
    const mustBlock = position([60, 36, 61, 37, 62, 38, 70, 39]);           // X to move, O 36-39 needs 40
    const v = await evalAt(mustBlock, 2000);
    assert.ok(Number.isFinite(v), `must-block position stays finite: ${v}`);
    // two enemy fours (completion cells 40 and 49) → decided against the side to move
    assert.equal(twoFoursP1.current, 0); assert.equal(twoFoursP1.over, false);
    assert.equal(await evalAt(twoFoursP1, 2000), -Infinity);
});

test("sensei-five: evaluate() — forced wins are reported before they are on the board (four-three at 2 000, three-three fork at 12 000 nodes)", async () => {
    const fourThree = position([4, 62, 13, 64, 22, 66, 29, 68, 30, 80]);    // X to move: 31 makes a four and an open three
    assert.equal(await evalAt(fourThree, 2000), Infinity);
    assert.equal(await evalAt(fourThree, 12000), Infinity);
    const fork = position([39, 0, 41, 1, 22, 2, 58, 80]);                   // X to move: 40 makes two open threes
    assert.ok(Number.isFinite(await evalAt(fork, 2000)), "the quick stage has no threat search");
    assert.equal(await evalAt(fork, 12000), Infinity, "VCT with three-makers finds the fork");
    // the same fork with the colours swapped (player 1 to move): decided against player 0
    assert.equal(await evalAt(mirror(fork), 12000), -Infinity);
});

test("sensei-five: evaluate() — mirrored positions negate, deterministic per budget, monotone with material", async () => {
    const rnd = Bots.tools("five", { seed: 21 });
    let s = position([]);
    for (let k = 0; k < 14 && !s.over; k++) {
        s = rnd.apply(s, rnd.pick(rules.legalMoves(s)));
        for (const nodes of [2000, 12000]) {
            const a = await evalAt(s, nodes), b = await evalAt(mirror(s), nodes);
            assert.equal(a, -b || 0, `mirror after ${k + 1} moves @${nodes}: ${a} vs ${b}`);   // (-0 is 0)
            assert.equal(await evalAt(t.clone(s), nodes), a, `deterministic @${nodes}`);
        }
    }
    assert.ok((await evalAt(position([40, 0, 41, 1, 42]), 2000)) > 100, "three in a row vs scattered stones");
});

test("sensei-five: evaluate() — the 2 000-node stage averages under 5 ms at 15×15; the long stages yield", async () => {
    // a random 15×15 middlegame that the quick stage does not already see as decided
    let s = rules.create({ n: 15, winLen: 5 }, Rules.base({ n: 15 }));
    const r = Bots.tools("five", { seed: 5 });
    let quick;
    for (let k = 0; k < 60; k++) {
        s = r.apply(s, r.pick(rules.legalMoves(s)));
        quick = evalAt(s, 2000);
        assert.ok(typeof quick === "number", "the quick stage is synchronous");
        if (k >= 30 && Number.isFinite(quick)) break;
    }
    assert.ok(Number.isFinite(quick), "found an undecided middlegame");
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) evalAt(s, 2000);
    const ms = (performance.now() - t0) / 20;
    console.log(`  evaluate 15×15 @2000: ${ms.toFixed(2)} ms`);
    assert.ok(ms < 5, `2 000-node evaluate took ${ms.toFixed(2)} ms`);
    const long = evalAt(s, 12000);
    assert.ok(long && typeof long.then === "function", "a long stage returns a Promise");
    assert.ok(Number.isFinite(await long));
});

/* Swing: 10 seeded Normal-vs-Normal games on 9×9 (4 random opening plies near the centre for
   variety), every settled position evaluated with 12 000 nodes, p through a fixed logistic.
   Before (the old estimate()): mean |Δp| 0.166, 243 jumps > 0.25 in 630 transitions. */
test("sensei-five: evaluate() — win chance is calm: mean |Δp| < 0.05 between consecutive positions (12 000 nodes, 10 games)", async () => {
    let sum = 0, cnt = 0, big = 0;
    const bias = [[0, 0], [0, 0]];
    for (let g = 0; g < 10; g++) {
        const rnd = Bots.tools("five", { seed: 1000 + g });
        let s = rules.create({ n: 9, winLen: 5 }, Rules.base({ n: 9, startPlayer: g % 2 }));
        const bots = [Bots.create(ID, { me: 0, difficulty: "normal", seed: 10 + g, budget: BUDGET }), Bots.create(ID, { me: 1, difficulty: "normal", seed: 20 + g, budget: BUDGET })];
        const ps = [logistic(await evalAt(s, 12000))], movers = [s.current];
        for (let k = 0; !s.over && k < 200; k++) {
            let mv;
            if (k < 4) mv = rnd.pick(rules.legalMoves(s).filter((i) => Math.abs(i % 9 - 4) <= 2 && Math.abs(Math.floor(i / 9) - 4) <= 2));
            else mv = await bots[s.current].move(t.clone(s));
            s = t.apply(s, mv);
            ps.push(logistic(await evalAt(t.clone(s), 12000))); movers.push(s.current);
        }
        for (let i = 1; i < ps.length; i++) { const d = Math.abs(ps[i] - ps[i - 1]); sum += d; cnt++; if (d > 0.25) big++; }
        for (let i = 1; i < ps.length - 1; i++) {
            if ([ps[i - 1], ps[i], ps[i + 1]].some((p) => p === 0 || p === 1)) continue;
            bias[movers[i]][0] += ps[i] - (ps[i - 1] + ps[i + 1]) / 2; bias[movers[i]][1]++;
        }
    }
    const mean = sum / cnt;
    console.log(`  swing @12000: mean |Δp| ${mean.toFixed(4)} over ${cnt} transitions, ${big} jumps > 0.25, mover bias p0 ${(bias[0][0] / bias[0][1]).toFixed(4)} p1 ${(bias[1][0] / bias[1][1]).toFixed(4)}`);
    assert.ok(mean < 0.05, `mean |Δp| ${mean.toFixed(4)}`);
    assert.ok(Math.abs(bias[0][0] / bias[0][1]) < 0.02 && Math.abs(bias[1][0] / bias[1][1]) < 0.02, "no side-to-move zigzag");
});
