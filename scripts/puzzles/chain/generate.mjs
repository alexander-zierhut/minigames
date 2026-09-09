#!/usr/bin/env node
/* Generates tests/puzzles/chain/puzzles.json: Chain React positions whose perfect moves are
   proven by solver.mjs. Deterministic: seeded playouts (mulberry32 via Bots.rng), fixed
   node budgets, no wall-clock decisions, so re-running produces the same file.

   Usage: node scripts/puzzles/chain/generate.mjs [--verbose]

   Pipeline: seeded random / "careful" playouts on 3×3 … 6×6 boards → sample positions →
   solve (exhaustive on 3×3/4×4, depth-limited on 5×5/6×6) → keep only proven positions
   where at most half of the legal moves are perfect → dedupe by board symmetry → fill
   per-size / per-tag quotas → replay every kept history with the real ChainRules as a
   final check → write puzzles.json (ids sequential, sorted by board size and move count). */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadHeadless } from "../../../tools/headless.mjs";
import { solve, fromState, apply, legalMoves, winsNow, losesNow, canonicalKey } from "./solver.mjs";

const OUT = new URL("../../../tests/puzzles/chain/puzzles.json", import.meta.url).pathname;
const verbose = process.argv.includes("--verbose");
const { Rules, ChainRules, Bots } = loadHeadless();

/* ---------- plan ----------
   Per board size: how many playouts, which positions to try, how to solve them and how many
   puzzles to keep. Budgets are node counts (deterministic), not milliseconds. */
const PLAN = {
    3: { playouts: 60, minPly: 0, every: 1, attempts: [{ depth: Infinity, nodes: 300_000 }], target: 40, perTagAndMover: 6 },
    4: { playouts: 90, minPly: 11, every: 2, attempts: [{ depth: Infinity, nodes: 400_000 }], target: 50, perTagAndMover: 7 },
    5: { playouts: 90, minPly: 10, every: 2, attempts: [{ depth: 2, nodes: 60_000 }, { depth: 4, nodes: 250_000 }], target: 35, perTagAndMover: 6 },
    6: { playouts: 90, minPly: 14, every: 3, attempts: [{ depth: 2, nodes: 60_000 }, { depth: 4, nodes: 250_000 }], target: 35, perTagAndMover: 6 },
};
const TOTAL_MIN = 100;

/* ---------- hand-crafted positions (histories from the empty board) ---------- */
const HAND = [
    { n: 3, history: [0, 1], note: "The corner is about to blow: one more piece on 0 converts 1 and 3 and player 1 owns nothing." },
    { n: 3, history: [0, 1, 8], note: "Player 0 threatens to blow the corner; two of player 1's replies walk into it." },
    { n: 3, history: [0, 1, 8, 4, 0, 7], note: "Blow the corner 8 first: player 1 is left with the centre only and every reply meets a takeover." },
    { n: 3, history: [1, 4, 1, 0, 3, 4, 3, 4], note: "Two loaded edges next to the loaded centre: either one takes the board." },
    { n: 3, history: [4, 0, 4, 8, 4], note: "Player 0 stacked the centre to 3; player 1 has two corners and must answer the threat." },
    { n: 3, history: [0, 2, 6, 8, 0], note: "Four corners, one already exploded." },
    { n: 3, history: [1, 7, 1, 7, 3, 5], note: "Both edges loaded to two, both sides loaded to one." },
    { n: 4, history: [0, 15, 0, 15, 5, 10, 5, 10, 1, 14, 4, 11, 5, 10], nodes: 3_000_000, note: "Mirror game on 4×4: the first to break symmetry decides it." },
    { n: 4, history: [5, 10, 5, 10, 5, 10, 6, 9, 6, 9, 6, 9, 1, 14, 4, 11], note: "Inner block fully loaded on both sides." },
    { n: 6, history: [14, 21, 14, 21, 14, 21, 15, 20, 15, 20, 15, 20, 8, 27, 8, 27, 9, 26, 9, 26], note: "Two loaded 2×2 blocks facing each other on 6×6." },
];

/* ---------- helpers ---------- */
const newState = (n) => ChainRules.create({ n, chainRule: false }, Rules.base({ n, chainRule: false }));

// replay a history with the real rules; returns the state (throws on an illegal move)
function replay(n, history) {
    const s = newState(n);
    for (const i of history) {
        if (s.over) throw new Error("move after the end");
        const p = s.current;
        if (!ChainRules.isLegal(s, i, p)) throw new Error(`illegal move ${i} for player ${p}`);
        ChainRules.place(s, i, p);
        ChainRules.settle(s, p);
        const r = ChainRules.conclude(s, p);
        if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
    }
    return s;
}

// a seeded playout on the fast engine; policy "random" or "careful" (takes wins, dodges
// immediate losses when it can — that produces longer, more tactical games)
function playout(n, seed, policy) {
    const random = Bots.rng(seed);
    let pos = fromState(newState(n));
    const positions = [];                                  // pos before each move, with its ply
    const history = [];
    while (!pos.over && history.length < 400) {
        positions.push(pos);
        let moves = legalMoves(pos);
        if (policy === "careful") {
            const w = winsNow(pos);
            if (w.length) moves = w;
            else { const bad = new Set(losesNow(pos, moves)); const safe = moves.filter((m) => !bad.has(m)); if (safe.length) moves = safe; }
        }
        const m = moves[Math.floor(random() * moves.length)];
        history.push(m);
        pos = apply(pos, m);
    }
    return { positions, history };
}

function tagsFor(r, legal, ply) {
    const tags = [];
    if (r.value === "win") tags.push(r.depth === 1 ? "win-in-1" : `win-in-${(r.depth + 1) / 2}`);
    else tags.push("delay-loss");
    const bestSet = new Set(r.best), losing = new Set(r.losesNow);
    const others = legal.filter((m) => !bestSet.has(m));
    if (r.depth > 1 && others.length > 0 && others.every((m) => losing.has(m)) && r.best.every((m) => !losing.has(m))) tags.push("avoid-loss");
    if (r.exhaustive) tags.push("endgame-exhaustive");
    if (r.exhaustive && ply <= 4) tags.push("opening");
    return tags;
}
const primaryTag = (tags) => tags[0];

function describe(n, ply, mover, r, legal, tags) {
    const who = `player ${mover}`;
    const k = r.best.length, total = legal.length;
    let s = `${n}×${n}, ${ply} moves played, ${who} to move. `;
    if (r.value === "win") s += r.depth === 1 ? `${k} of ${total} moves take the whole board now.` : `${k} of ${total} moves force a win in ${(r.depth + 1) / 2} (${r.depth} plies).`;
    else s += `Lost position: ${k} of ${total} moves hold out the longest (${r.depth} plies).`;
    if (tags.includes("avoid-loss")) s += " Every other move allows an immediate takeover.";
    if (tags.includes("endgame-exhaustive")) s += " Solved exhaustively.";
    return s;
}

function trySolve(state, attempts) {
    for (const a of attempts) {
        const r = solve(state, a);
        if (r) return r;
    }
    return null;
}

/* ---------- generate ---------- */
const t0 = Date.now();
const seen = new Set();                                   // canonical position keys
const pool = [];                                          // accepted puzzles (unsorted)
const counts = {};                                        // `${n}|${tag}|${mover}` -> count
let attempts = 0, proven = 0;

function consider(n, history, ply, attemptsPlan, note, force = false) {
    const state = replay(n, history);
    if (state.over || state.movesBy.some((m) => m === 0)) return false;
    const pos = fromState(state);
    const legal = legalMoves(pos);
    if (legal.length < 3) return false;
    const key = canonicalKey(pos);
    if (seen.has(key)) return false;
    attempts++;
    const r = trySolve(pos, attemptsPlan);
    if (!r) return false;
    proven++;
    if (!force && r.best.length * 2 > legal.length) return false;      // not much of a puzzle
    if (r.best.length === legal.length) return false;
    const tags = tagsFor(r, legal, ply);
    const ck = `${n}|${primaryTag(tags)}|${state.current}`;
    const plan = PLAN[n];
    if (!force && (counts[ck] || 0) >= plan.perTagAndMover) return false;
    seen.add(key);
    counts[ck] = (counts[ck] || 0) + 1;
    pool.push({
        config: { n, chainRule: false }, history: history.slice(), toMove: state.current,
        best: r.best.slice(), value: r.value, depth: r.depth, tags,
        note: note ? `${note} ${describe(n, ply, state.current, r, legal, tags)}` : describe(n, ply, state.current, r, legal, tags),
    });
    if (verbose) console.log(`  + ${n}×${n} ply ${ply} ${r.value} d${r.depth} best ${JSON.stringify(r.best)} ${tags.join(",")} (${r.nodes} nodes)`);
    return true;
}

// hand-crafted first (they get the slots), then playouts per size
for (const h of HAND) {
    const plan = PLAN[h.n];
    const ok = consider(h.n, h.history, h.history.length, [{ depth: Infinity, nodes: h.nodes || 600_000 }, ...plan.attempts], h.note, true);
    if (verbose) console.log(`hand ${h.n}×${h.n} ${JSON.stringify(h.history)}: ${ok ? "kept" : "skipped (not proven or duplicate)"}`);
}
for (const n of Object.keys(PLAN).map(Number)) {
    const plan = PLAN[n];
    const before = pool.length;
    for (let g = 0; g < plan.playouts && pool.length - before < plan.target; g++) {
        const seed = n * 1000 + g;
        const policy = g % 3 === 2 ? "random" : "careful";
        const { positions, history } = playout(n, seed, policy);
        let kept = 0, lastPly = -99;
        // walk the game backwards: late positions resolve cheaply and give clean endgames
        for (let ply = positions.length - 1; ply >= plan.minPly && kept < 2; ply--) {
            if ((ply - plan.minPly) % plan.every !== 0 || (lastPly >= 0 && lastPly - ply < 4)) continue;   // keep samples of one game apart
            if (consider(n, history.slice(0, ply), ply, plan.attempts, "")) { kept++; lastPly = ply; }
        }
    }
    if (verbose) console.log(`${n}×${n}: ${pool.length - before} puzzles`);
}

/* ---------- final check with the real rules, order, ids, write ---------- */
pool.sort((a, b) => a.config.n - b.config.n || a.history.length - b.history.length || a.toMove - b.toMove || JSON.stringify(a.history).localeCompare(JSON.stringify(b.history)));
const puzzles = pool.map((p, k) => {
    const s = replay(p.config.n, p.history);
    if (s.over || s.current !== p.toMove) throw new Error("final check failed: position over or wrong mover");
    for (const m of p.best) if (!ChainRules.isLegal(s, m, s.current)) throw new Error("final check failed: illegal best move");
    return { id: `chain-${String(k + 1).padStart(4, "0")}`, ...p };
});
if (puzzles.length < TOTAL_MIN) throw new Error(`only ${puzzles.length} puzzles (need ${TOTAL_MIN}); raise the plan`);

// keep the previous date when the puzzles didn't change, so a re-run never diffs
const now = new Date();
let generated = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;   // local date
if (existsSync(OUT)) {
    try {
        const old = JSON.parse(readFileSync(OUT, "utf8"));
        if (JSON.stringify(old.puzzles) === JSON.stringify(puzzles)) generated = old.generated;
    } catch (e) { /* unreadable old file: write a fresh one */ }
}
const file = {
    game: "chain",
    generated,
    solver: "alpha-beta negamax with mate-distance scores and a transposition table; a result is only reported when every line inside the horizon reaches a terminal position (exhaustive on 3×3/4×4), so value, depth (plies to the fastest forced win / longest defence) and best (all moves achieving exactly that) are proven",
    puzzles,
};
writeFileSync(OUT, JSON.stringify(file, null, 1).replace(/\[\n\s+(\d+(?:,\n\s+\d+)*)\n\s+\]/g, (m, inner) => `[${inner.replace(/\s+/g, "")}]`) + "\n");

// report
const byTag = {}, bySize = {}, byMover = {};
for (const p of puzzles) {
    for (const t of p.tags) byTag[t] = (byTag[t] || 0) + 1;
    bySize[p.config.n] = (bySize[p.config.n] || 0) + 1;
    byMover[p.toMove] = (byMover[p.toMove] || 0) + 1;
}
console.log(`${puzzles.length} puzzles written to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${attempts} positions tried, ${proven} proven)`);
console.log("by size:", JSON.stringify(bySize), "by mover:", JSON.stringify(byMover));
console.log("by tag:", JSON.stringify(byTag));
