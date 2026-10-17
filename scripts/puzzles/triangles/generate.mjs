/* Regenerates puzzles.json for Triangles:  node scripts/puzzles/triangles/generate.mjs
   Deterministic: seeded playouts (Bots.rng, mulberry32) with three policies (greedy: claim
   the most, hand over the least, from the rules helpers; greedy with a share of random
   bands; plain random), every sampled position solved exhaustively by solver.mjs (the value
   and the exact value of every band), filtered for "a mistake is possible and it costs
   something", and de-duplicated under the 12 symmetries of the hexagon. One rule set, the
   default one: 4-peg bands anywhere (touch off), no token limit (the solver's key is exact
   only without one). Nothing here uses Math.random. */
import { writeFileSync } from "node:fs";
import { loadHeadless } from "../../headless.mjs";
import { Board, solveExhaustive, longest, canonical } from "./solver.mjs";

const OUT = new URL("../../../tests/puzzles/triangles/puzzles.json", import.meta.url);
const { Rules, TrianglesRules: R, Bots } = loadHeadless();

/* ---------- targets ---------- */
const MAX_NODES = 3_000_000;                         // per solve; keeps re-solving in the tests fast
const DEPTH = [8, 14];                               // the most plies the rest of the game may last
const PER_GAME = 2;                                  // accepted positions per playout
// per board and policy: quota, playouts, seed, and caps that keep one kind of puzzle (or one
// result) from filling the set
const RUNS = [
    { n: 4, policy: "greedy", quota: 34, games: 400, seed: 4101 },
    { n: 4, policy: "mixed", quota: 26, games: 400, seed: 4202 },
    { n: 4, policy: "random", quota: 20, games: 400, seed: 4303 },
    { n: 5, policy: "greedy", quota: 34, games: 400, seed: 5101 },
    { n: 5, policy: "mixed", quota: 26, games: 400, seed: 5202 },
    { n: 5, policy: "random", quota: 20, games: 400, seed: 5303 },
];
const VALUE_CAPS = { win: 0.6, draw: 0.22, loss: 0.22 };     // share of a run's quota
const TAG_CAPS = { claim: 0.5, "safe-move": 0.45, sacrifice: 0.45 };   // no structural tag fills a run
// the generator fails below these counts (per tag and per value, over the whole set)
const MINIMUM = { total: 140, tags: { "endgame-exhaustive": 140, claim: 20, "safe-move": 20, sacrifice: 10, "avoid-loss": 8 }, values: { win: 60, draw: 15, loss: 15 }, winUnique: 15, winSeveral: 15 };

/* ---------- rules plumbing ---------- */
const CONFIG = (n) => ({ n, band: 3, touch: false, tokens: 0 });
const mk = (n) => Rules.create({ ...CONFIG(n), players: 2 }, "triangles");
const pickOf = (rng, list) => list[Math.floor(rng() * list.length)];

// greedy: claim the most, then hand over the least; ties at random
function greedy(s, rng) {
    let best = [], key = -Infinity;
    for (const mv of R.legalMoves(s)) {
        const k = R.claims(s, mv) * 100 - R.opens(s, mv);
        if (k > key) { key = k; best = [mv]; } else if (k === key) best.push(mv);
    }
    return pickOf(rng, best);
}
const POLICIES = {
    greedy: (s, rng) => (rng() < 0.08 ? pickOf(rng, R.legalMoves(s)) : greedy(s, rng)),
    mixed: (s, rng) => (rng() < 0.35 ? pickOf(rng, R.legalMoves(s)) : greedy(s, rng)),
    random: (s, rng) => pickOf(rng, R.legalMoves(s)),
};

/* ---------- classification ---------- */
const classOf = (board, net) => { const d = board.mine - board.theirs + net; return d > 0 ? "win" : d < 0 ? "loss" : "draw"; };
function tagsFor(s, board, r) {
    const legal = R.legalMoves(s);
    const claims = (mv) => R.claims(s, mv), opens = (mv) => R.opens(s, mv);
    const tags = ["endgame-exhaustive"];
    if (r.best.every((mv) => claims(mv) > 0) && legal.some((mv) => claims(mv) === 0)) tags.push("claim");
    if (r.best.every((mv) => opens(mv) === 0) && legal.some((mv) => opens(mv) > 0)) tags.push("safe-move");
    if (legal.every((mv) => opens(mv) > 0)) tags.push("sacrifice");
    if (r.value !== "loss" && legal.every((mv) => r.best.includes(mv) || classOf(board, r.moveValues[mv]) === "loss")) tags.push("avoid-loss");
    return tags;
}
const triangles = (k) => `${k} triangle${k === 1 ? "" : "s"}`;
// a small fixed set of sentences (README, and the Learn generator maps each one to a key)
function noteFor(tags, r, legal) {
    const parts = [];
    if (tags.includes("claim")) parts.push("Claim what is on the table.");
    if (tags.includes("safe-move")) parts.push("Play a band that hands nothing over.");
    if (tags.includes("sacrifice")) parts.push("Every band opens something: concede as little as possible.");
    if (tags.includes("avoid-loss")) parts.push("Every other band loses the game.");
    const gap = r.net - Math.max(...legal.filter((mv) => !r.best.includes(mv)).map((mv) => r.moveValues[mv]));
    const end = r.diff > 0 ? `${triangles(r.diff)} ahead` : r.diff < 0 ? `${triangles(-r.diff)} behind` : "level";
    parts.push(`Best play ends ${end}; every other band is at least ${triangles(gap)} worse.`);
    return parts.join(" ");
}

/* ---------- acceptance ---------- */
// a puzzle must have a real mistake in it: the best band beats every other by two triangles,
// or the others throw the result away altogether
function analyse(s) {
    const board = Board.fromState(s);
    const depth = longest(board, { maxNodes: 400_000 });
    if (depth === null || depth < DEPTH[0] || depth > DEPTH[1]) return null;
    const legal = R.legalMoves(s);
    const r = solveExhaustive(board, { maxNodes: MAX_NODES });
    if (r.value === "unknown") return null;
    if (r.best.length >= legal.length) return null;                       // nothing to get wrong
    const others = legal.filter((mv) => !r.best.includes(mv));
    const second = Math.max(...others.map((mv) => r.moveValues[mv]));
    const classDiffers = others.some((mv) => classOf(board, r.moveValues[mv]) !== r.value);
    if (r.net - second < 2 && !classDiffers) return null;                 // too fine a difference
    return { board, r, legal, depth };
}

/* ---------- main ---------- */
const started = Date.now();
const puzzles = [];
const seen = new Set();

function accept(run, s, a, stats) {
    const { board, r, legal, depth } = a;
    const key = `${s.n}:${canonical(board.covered, s.n)}:${board.mine - board.theirs}`;
    if (seen.has(key)) return false;
    const tags = tagsFor(s, board, r);
    if ((stats.values[r.value] || 0) >= Math.ceil(run.quota * VALUE_CAPS[r.value])) return false;
    for (const [t, share] of Object.entries(TAG_CAPS)) if (tags.includes(t) && (stats.tags[t] || 0) >= Math.ceil(run.quota * share)) return false;
    seen.add(key);
    stats.n++;
    stats.values[r.value] = (stats.values[r.value] || 0) + 1;
    for (const t of tags) stats.tags[t] = (stats.tags[t] || 0) + 1;
    puzzles.push({
        config: CONFIG(s.n),
        history: Array.from(s.history), toMove: s.current,
        best: r.best.slice(), value: r.value, margin: r.diff, depth, tags,
        note: noteFor(tags, r, legal),
    });
    return true;
}

for (const run of RUNS) {
    const rng = Bots.rng(run.seed);
    const policy = POLICIES[run.policy];
    const stats = { n: 0, values: {}, tags: {} };
    for (let g = 0; g < run.games && stats.n < run.quota; g++) {
        // play the whole game, then look at its tail: positions with seat 0 to move
        const s = mk(run.n);
        const history = [];
        while (!s.over) { const mv = policy(s, rng); history.push(mv); Rules.step(R, s, mv); }
        const t = mk(run.n);
        let taken = 0;
        // the playout's own rest is a lower bound of the depth: start where it fits, a few
        // plies later at random so the depths spread
        let next = Math.max(0, history.length - DEPTH[1] + Math.floor(rng() * 5));
        for (let ply = 0; ply < history.length && taken < PER_GAME && stats.n < run.quota; ply++) {
            if (ply >= next && t.current === 0 && history.length - ply >= DEPTH[0]) {
                const a = analyse(t);
                if (a && accept(run, t, a, stats)) { taken++; next = ply + 4; }      // the next one a little later
            }
            Rules.step(R, t, history[ply]);
        }
    }
    console.error(`n=${run.n} ${run.policy}: +${stats.n} ${JSON.stringify(stats.values)} ${JSON.stringify(stats.tags)} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

/* ---------- order, ids, write ---------- */
puzzles.sort((a, b) => a.config.n - b.config.n || a.history.length - b.history.length || (a.history.join() < b.history.join() ? -1 : 1));
puzzles.forEach((p, k) => { p.id = `triangles-${String(k + 1).padStart(4, "0")}`; });
const ordered = puzzles.map((p) => ({ id: p.id, config: p.config, history: p.history, toMove: p.toMove, best: p.best, value: p.value, margin: p.margin, depth: p.depth, tags: p.tags, note: p.note }));
const doc = {
    game: "triangles",
    generated: new Date().toISOString().slice(0, 10),
    solver: "exhaustive alpha-beta negamax to the last band, with a transposition table over the set of covered edges (exact without a token limit, which every puzzle config sets). Value, margin, every optimal band and the exact value of every legal band are game-theoretic facts.",
    puzzles: ordered,
};
writeFileSync(OUT, `{\n  "game": ${JSON.stringify(doc.game)},\n  "generated": ${JSON.stringify(doc.generated)},\n  "solver": ${JSON.stringify(doc.solver)},\n  "puzzles": [\n${ordered.map((p) => "    " + JSON.stringify(p)).join(",\n")}\n  ]\n}\n`);

/* ---------- counts, and a loud failure below the minimum ---------- */
const byTag = {}, byValue = {}, byBoard = {}, byDepth = {};
let winUnique = 0, winSeveral = 0;
for (const p of ordered) {
    for (const t of p.tags) byTag[t] = (byTag[t] || 0) + 1;
    byValue[p.value] = (byValue[p.value] || 0) + 1;
    byBoard[`n=${p.config.n}`] = (byBoard[`n=${p.config.n}`] || 0) + 1;
    byDepth[p.depth] = (byDepth[p.depth] || 0) + 1;
    if (p.value === "win") { if (p.best.length === 1) winUnique++; else winSeveral++; }
}
console.error(`${ordered.length} puzzles in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.error("by board:", JSON.stringify(byBoard));
console.error("by tag:  ", JSON.stringify(byTag));
console.error("by value:", JSON.stringify(byValue), `(wins with one best band: ${winUnique}, with several: ${winSeveral})`);
console.error("by depth:", JSON.stringify(byDepth));
const short = [];
if (ordered.length < MINIMUM.total) short.push(`${ordered.length} puzzles < ${MINIMUM.total}`);
for (const [t, k] of Object.entries(MINIMUM.tags)) if ((byTag[t] || 0) < k) short.push(`tag ${t}: ${byTag[t] || 0} < ${k}`);
for (const [v, k] of Object.entries(MINIMUM.values)) if ((byValue[v] || 0) < k) short.push(`value ${v}: ${byValue[v] || 0} < ${k}`);
if (winUnique < MINIMUM.winUnique) short.push(`wins with one best band: ${winUnique} < ${MINIMUM.winUnique}`);
if (winSeveral < MINIMUM.winSeveral) short.push(`wins with several best bands: ${winSeveral} < ${MINIMUM.winSeveral}`);
if (short.length) {
    console.error(`FAILED: the set is below its minimum:\n  ${short.join("\n  ")}`);
    process.exit(1);
}
