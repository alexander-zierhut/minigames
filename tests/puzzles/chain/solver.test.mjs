/* Chain React solver + puzzle set. Hand-verified positions first (the reasoning is in the
   comments), then a plain brute-force minimax as an independent oracle for the alpha-beta
   + transposition-table search, then the consistency of puzzles.json. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHeadless } from "../../../tools/headless.mjs";
import { solve, fromState, apply, legalMoves, losesNow, winsNow, SYMMETRIES, mapCell, MATE } from "./solver.mjs";

const { Rules, ChainRules, Bots } = loadHeadless();
const PUZZLES = new URL("./puzzles.json", import.meta.url).pathname;

const newState = (n, startPlayer = 0) => ChainRules.create({ n, chainRule: false, startPlayer }, Rules.base({ n, chainRule: false, startPlayer }));
// replay with the real rules (throws on illegal moves)
function replay(n, history, startPlayer = 0) {
    const s = newState(n, startPlayer);
    for (const i of history) {
        const p = s.current;
        assert.ok(!s.over, "history continues after the end");
        assert.ok(ChainRules.isLegal(s, i, p), `move ${i} legal for ${p}`);
        ChainRules.place(s, i, p);
        ChainRules.settle(s, p);
        const r = ChainRules.conclude(s, p);
        if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
    }
    return s;
}
const sorted = (a) => a.slice().sort((x, y) => x - y);
const J = JSON.stringify;

/* ---------- the fast rules inside the solver must be the real rules ---------- */
test("solver.apply matches ChainRules place/settle/conclude on seeded random games (3×3 … 6×6)", () => {
    let checked = 0;
    for (let g = 0; g < 120; g++) {
        const n = 3 + (g % 4);
        const random = Bots.rng(100 + g);
        const tools = Bots.tools("chain", { seed: g });
        let s = newState(n, g % 2);
        while (!s.over) {
            const moves = ChainRules.legalMoves(s, s.current);
            const m = moves[Math.floor(random() * moves.length)];
            const real = tools.apply(s, m);
            const mine = apply(fromState(s), m);
            assert.equal(J([...mine.cnt]), J(real.cells.map((c) => c.count)), `counts after ${J(s.history)} + ${m}`);
            assert.equal(J([...mine.own]), J(real.cells.map((c) => c.owner)), `owners after ${J(s.history)} + ${m}`);
            assert.equal(mine.over, !!real.over);
            if (real.over) assert.equal(mine.winner, real.winner);
            else {                                          // the real isLegal also refuses moves after the end
                assert.equal(mine.mover, real.current);
                assert.equal(J(legalMoves(mine)), J(ChainRules.legalMoves(real, real.current)));
            }
            checked++;
            s = real;
        }
    }
    assert.ok(checked > 2000, `${checked} moves compared`);
});

/* ---------- hand-verified positions ----------
   3×3 cells:  0 1 2       caps: corners 2, edges 3, centre 4
               3 4 5
               6 7 8 */
test("takes an immediate board takeover: [0,1] → 0 blows the corner into 1 and 3", () => {
    // p0 owns 0 (1 piece), p1 owns 1 (1 piece). One more piece on 0 explodes it, 1 and 3 become p0's,
    // p1 has moved and owns nothing → over. No other move explodes anything.
    const r = solve(replay(3, [0, 1]));
    assert.equal(r.value, "win");
    assert.equal(r.depth, 1);
    assert.equal(J(r.best), "[0]");
    assert.equal(J(winsNow(fromState(replay(3, [0, 1])))), "[0]");
});

test("avoids a move that lets the opponent take over next turn: [0,1,8], player 1 to move", () => {
    // p0: 0×1 and 8×1, p1: 1×1. p0 threatens 0 → converts 1 and 3. If p1 stacks 1 (→ 2 pieces) then 0
    // explodes, 1 becomes p0's with 3 → explodes too: p1 has nothing. If p1 plays 3, 0's explosion
    // converts 1 and 3 again. Every other cell keeps a p1 piece out of reach of that explosion.
    const s = replay(3, [0, 1, 8]);
    assert.equal(s.current, 1);
    const r = solve(s);
    assert.ok(r, "3×3 is solved exhaustively");
    assert.equal(J(losesNow(fromState(s))), "[1,3]");
    assert.ok(!r.best.includes(1) && !r.best.includes(3), `best ${J(r.best)} never walks into the corner`);
    assert.ok(r.best.length >= 1);
});

test("finds a forced win in 2 on a 3×3: [0,1,8,4,0,7] → only 8", () => {
    // Position: 1:p0×2, 3:p0×1, 8:p0×1, 4:p1×1, 7:p1×1. p0 plays 8: it explodes into 5 and 7, p1 keeps
    // only the centre. Replies: 4 (→ 4×2): p0 plays 1 → explodes into 0, 2, 4 → takeover. 0 or 2: 1
    // explodes and converts them together with 4. 6 or 8: 7 (now p0×2) explodes into 4, 6, 8.
    // No move wins at once (8 reaches 5 and 7 only; 1 reaches 0, 2, 4 but not 7), so depth is 3.
    const s = replay(3, [0, 1, 8, 4, 0, 7]);
    assert.equal(s.current, 0);
    const r = solve(s);
    assert.equal(r.value, "win");
    assert.equal(r.depth, 3);
    assert.equal(J(r.best), "[8]");
    // the depth-limited search proves the same thing
    const d = solve(s, { depth: 2, nodes: 10_000 });
    assert.equal(J([d.value, d.depth, d.best]), J(["win", 3, [8]]));
});

test("returns ALL optimal moves: [1,4,1,0,3,4,3,4] → both loaded edges 1 and 3 take the board", () => {
    // p0: 1×2, 3×2; p1: 0×1, 4×3. Playing 1 explodes into 0, 2, 4; playing 3 into 0, 4, 6 — either
    // converts every p1 cell. The other five moves just add one piece somewhere.
    const s = replay(3, [1, 4, 1, 0, 3, 4, 3, 4]);
    assert.equal(s.current, 0);
    const r = solve(s);
    assert.equal(r.value, "win");
    assert.equal(r.depth, 1);
    assert.equal(J(r.best), "[1,3]");
    assert.equal(ChainRules.legalMoves(s, 0).length, 7);
});

test("symmetric positions give symmetric answers (all 8 board symmetries, 3×3 and 4×4)", () => {
    const cases = [[3, [0, 1, 8, 4, 0, 7]], [3, [1, 4, 1, 0, 3, 4, 3, 4]], [4, [5, 10, 5, 10, 5, 10, 6, 9, 6, 9, 6, 9, 1, 14, 4, 11]]];
    for (const [n, history] of cases) {
        const base = solve(replay(n, history), { nodes: 1_000_000 });
        assert.ok(base, `${n}×${n} ${J(history)} solved`);
        for (const sym of SYMMETRIES) {
            const h = history.map((i) => mapCell(i, n, sym));
            const r = solve(replay(n, h), { nodes: 1_000_000 });
            assert.equal(r.value, base.value);
            assert.equal(r.depth, base.depth);
            assert.equal(J(sorted(r.best)), J(sorted(base.best.map((i) => mapCell(i, n, sym)))), `${J(h)}`);
        }
    }
});

test("respects the node budget and never guesses: unresolved positions return null", () => {
    const six = replay(6, [14, 21, 14, 21]);
    assert.equal(solve(six, { nodes: 5_000 }), null, "exhaustive 6×6 with a tiny budget");
    assert.equal(solve(six, { depth: 4, nodes: 1_000_000 }), null, "no forced result within 5 plies in a 6×6 opening");
    const four = replay(4, [0, 15, 0, 15, 5, 10, 5, 10]);
    assert.equal(solve(four, { nodes: 20_000 }), null, "4×4 after 8 moves needs far more than 20k nodes");
    // depth 0 = only the immediate-win check
    assert.equal(solve(replay(3, [0, 1, 8, 4, 0, 7]), { depth: 0 }), null);
    assert.equal(solve(replay(3, [0, 1]), { depth: 0 }).depth, 1);
    assert.throws(() => solve(replay(3, [0, 1, 0])), /already over/);
});

/* ---------- independent oracle: plain minimax, no pruning, no table ---------- */
function naive(pos, ply) {
    let best = -Infinity;
    for (const m of legalMoves(pos)) {
        const c = apply(pos, m);
        const s = c.over ? MATE - (ply + 1) : -naive(c, ply + 1);
        if (s > best) best = s;
    }
    return best;
}
function naiveSolve(pos) {
    const scores = legalMoves(pos).map((m) => { const c = apply(pos, m); return { m, s: c.over ? MATE - 1 : -naive(c, 1) }; });
    const v = Math.max(...scores.map((x) => x.s));
    return { value: v > 0 ? "win" : "loss", depth: v > 0 ? MATE - v : MATE + v, best: scores.filter((x) => x.s === v).map((x) => x.m) };
}
function randomPosition(n, seed, minPly) {
    const random = Bots.rng(seed);
    let pos = fromState(newState(n));
    while (!pos.over) {
        const moves = legalMoves(pos);
        if (pos.moved === 3 && pos.cnt.reduce((a, b) => a + b, 0) >= minPly && random() < 0.5) return pos;
        pos = apply(pos, moves[Math.floor(random() * moves.length)]);
    }
    return null;
}

test("alpha-beta + transposition table agree with brute-force minimax (value, plies, full best set)", () => {
    let compared = 0;
    for (let seed = 0; compared < 40 && seed < 400; seed++) {
        const n = seed % 2 ? 3 : 4;
        const pos = randomPosition(n, 500 + seed, n === 3 ? 9 : 26);
        if (!pos) continue;
        const oracle = naiveSolve(pos);
        const r = solve(pos);
        assert.ok(r, "small endgames always resolve");
        assert.equal(J([r.value, r.depth, r.best]), J([oracle.value, oracle.depth, oracle.best]), `seed ${seed}`);
        // a depth-limited proof, when it exists, must tell the same story
        for (const depth of [1, 2, 3]) {
            const d = solve(pos, { depth });
            if (d) assert.equal(J([d.value, d.depth, d.best]), J([oracle.value, oracle.depth, oracle.best]), `seed ${seed} depth ${depth}`);
            else assert.ok(oracle.depth > depth + 1 || (oracle.value === "loss" && oracle.depth > depth), `seed ${seed}: depth ${depth} may only fail when the result lies beyond the horizon (${oracle.value} in ${oracle.depth})`);
        }
        compared++;
    }
    assert.ok(compared >= 40);
});

/* ---------- the shipped puzzle set ---------- */
test("puzzles.json: ≥ 100 puzzles, unique sequential ids, legal histories, open positions, legal best moves, tags", () => {
    const data = JSON.parse(readFileSync(PUZZLES, "utf8"));
    assert.equal(data.game, "chain");
    assert.match(data.generated, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof data.solver === "string" && data.solver.length > 20);
    assert.ok(data.puzzles.length >= 100, `${data.puzzles.length} puzzles`);
    const ids = data.puzzles.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, "unique ids");
    ids.forEach((id, k) => assert.equal(id, `chain-${String(k + 1).padStart(4, "0")}`, "sequential ids"));
    const sizes = new Set(), movers = new Set(), tags = new Set();
    for (const p of data.puzzles) {
        assert.equal(p.config.chainRule, false);
        const s = replay(p.config.n, p.history);
        assert.ok(!s.over, `${p.id} is not over`);
        assert.equal(s.current, p.toMove, `${p.id} toMove`);
        assert.ok(Array.isArray(p.best) && p.best.length > 0, `${p.id} best non-empty`);
        for (const m of p.best) assert.ok(ChainRules.isLegal(s, m, s.current), `${p.id} best move ${m} legal`);
        assert.ok(p.best.length < ChainRules.legalMoves(s, s.current).length, `${p.id}: not every move is best`);
        assert.ok(["win", "loss"].includes(p.value), `${p.id} value`);
        assert.ok(Number.isInteger(p.depth) && p.depth >= 1, `${p.id} depth`);
        assert.ok(Array.isArray(p.tags) && p.tags.length > 0, `${p.id} tags`);
        assert.ok(typeof p.note === "string");
        if (p.tags.includes("win-in-1")) assert.equal(p.depth, 1);
        if (p.tags.includes("win-in-2")) assert.equal(p.depth, 3);
        if (p.tags.includes("win-in-3")) assert.equal(p.depth, 5);
        if (p.tags.includes("avoid-loss")) {
            const bad = new Set(losesNow(fromState(s)));
            for (const m of ChainRules.legalMoves(s, s.current)) assert.equal(bad.has(m), !p.best.includes(m), `${p.id}: avoid-loss means exactly the non-best moves lose to an immediate reply`);
        }
        sizes.add(p.config.n); movers.add(p.toMove); p.tags.forEach((t) => tags.add(t));
    }
    for (const t of ["win-in-1", "avoid-loss", "win-in-2", "win-in-3", "endgame-exhaustive", "opening"]) assert.ok(tags.has(t), `tag ${t} present`);
    for (const n of [3, 4, 5, 6]) assert.ok(sizes.has(n), `${n}×${n} present`);
    assert.equal(movers.size, 2, "both colours to move");
});

test("re-solving a sample of 20 puzzles reproduces value, depth and the full best set", () => {
    const data = JSON.parse(readFileSync(PUZZLES, "utf8"));
    const step = Math.floor(data.puzzles.length / 20);
    for (let k = 0; k < 20; k++) {
        const p = data.puzzles[k * step];
        const s = replay(p.config.n, p.history);
        // same proof plan as generate.mjs: exhaustive up to 4×4, otherwise a 4-ply horizon
        const r = p.config.n <= 4 ? solve(s, { nodes: 3_000_000 }) : solve(s, { depth: 4, nodes: 500_000 });
        assert.ok(r, `${p.id} resolves`);
        assert.equal(J([r.value, r.depth, r.best]), J([p.value, p.depth, p.best]), p.id);
    }
});
