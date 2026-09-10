/* Regenerates puzzles.json for Käsekästchen:  node scripts/puzzles/boxes/generate.mjs
   Deterministic: seeded playouts (Bots.rng, mulberry32) whose policy takes free boxes and
   plays safe lines, so real chains and loony endgames arise; every sampled position is
   solved exhaustively by solver.mjs (game-theoretic value and the exact value of every
   line), filtered for "a mistake is possible and it costs something", and de-duplicated
   under the 8 board symmetries. Nothing here uses Math.random. */
import { writeFileSync } from "node:fs";
import { loadHeadless } from "../../headless.mjs";
import { Board, solveExhaustive, canonical } from "./solver.mjs";

const OUT = new URL("../../../tests/puzzles/boxes/puzzles.json", import.meta.url);
const { Rules, BoxesRules, Bots } = loadHeadless();

/* ---------- targets ---------- */
const TARGET = 170;
const MAX_NODES = 3_000_000;                         // per solve; keeps re-solving in the tests fast
const PER_GAME = 3;
// per board: quota, playouts, how many undrawn lines a position may still have, and the
// caps that keep one kind of puzzle from filling the set
const CONFIGS = [
    { n: 2, quota: 16, games: 60, freeMin: 6, freeMax: 12, seed: 2001, caps: { "take-box": 5, "safe-move": 5, sacrifice: 6, "double-deal": 4 } },
    { n: 3, quota: 40, games: 200, freeMin: 6, freeMax: 20, seed: 3002, caps: { "take-box": 13, "safe-move": 13, sacrifice: 15, "double-deal": 9 } },
    // the deep pass: 3 × 3 positions of up to 24 undrawn lines, which is most of the board
    { n: 3, quota: 8, games: 60, freeMin: 21, freeMax: 24, nodes: 12_000_000, seed: 3102, caps: {} },
    { n: 4, quota: 53, games: 260, freeMin: 6, freeMax: 22, seed: 4003, caps: { "take-box": 17, "safe-move": 17, sacrifice: 19, "double-deal": 11 } },
    { n: 5, quota: 53, games: 260, freeMin: 6, freeMax: 22, seed: 5004, caps: { "take-box": 17, "safe-move": 17, sacrifice: 19, "double-deal": 11 } },
];

/* ---------- rules plumbing ---------- */
const mk = (n) => Rules.create({ n, players: 2 }, "boxes");
const play = (s, i) => Rules.step(BoxesRules, s, i);
const classOf = (board, net) => { const d = board.mine - board.theirs + net; return d > 0 ? "win" : d < 0 ? "loss" : "draw"; };

// seeded playout policy: mostly take free boxes, mostly play safe lines, sometimes not
function policy(s, rng) {
    const b = Board.fromState(s);
    const legal = b.free();
    const caps = legal.filter((e) => b.captures(e) > 0);
    if (caps.length && rng() < 0.85) return caps[Math.floor(rng() * caps.length)];
    const safe = legal.filter((e) => b.isSafe(e));
    if (safe.length && rng() < 0.9) return safe[Math.floor(rng() * safe.length)];
    return legal[Math.floor(rng() * legal.length)];
}

/* ---------- classification ---------- */
function tagsFor(board, r) {
    const legal = board.free();
    const caps = legal.filter((e) => board.captures(e) > 0);
    const safe = legal.filter((e) => board.isSafe(e));
    const tags = ["endgame-exhaustive"];
    if (caps.length && r.best.every((e) => board.captures(e) > 0)) tags.push("take-box");
    if (caps.length && r.best.every((e) => board.captures(e) === 0)) tags.push("double-deal");
    if (!caps.length && safe.length && legal.length > safe.length && r.best.every((e) => board.isSafe(e))) tags.push("safe-move");
    if (!caps.length && !safe.length) tags.push("sacrifice");
    if (r.value !== "loss" && legal.every((e) => r.best.includes(e) || classOf(board, r.moveValues[e]) === "loss")) tags.push("avoid-loss");
    return tags;
}
function noteFor(tags, r, board, legal) {
    const parts = [];
    if (tags.includes("take-box")) parts.push("Close the box and keep the turn.");
    if (tags.includes("double-deal")) parts.push("Give the last two boxes away: the other side has to open the next chain.");
    if (tags.includes("safe-move")) parts.push("Play a line that hands nothing over.");
    if (tags.includes("sacrifice")) parts.push("Every line opens something: concede as little as possible.");
    if (tags.includes("avoid-loss")) parts.push("Every other line loses the game.");
    const margin = r.net - Math.max(...legal.filter((e) => !r.best.includes(e)).map((e) => r.moveValues[e]));
    parts.push(`Best play ends ${r.diff > 0 ? "+" : ""}${r.diff} boxes for the mover; every other line is at least ${margin} box${margin === 1 ? "" : "es"} worse.`);
    return parts.join(" ");
}

/* ---------- acceptance ---------- */
// a puzzle must have a real mistake in it: the best line beats every other by two boxes,
// or the others throw the result away altogether
function analyse(s, cfg) {
    const board = Board.fromState(s);
    const legal = board.free();
    if (legal.length < cfg.freeMin || legal.length > cfg.freeMax) return null;
    const r = solveExhaustive(board, { maxNodes: cfg.nodes || MAX_NODES });
    if (r.value === "unknown") return null;
    if (r.best.length >= legal.length) return null;                       // nothing to get wrong
    const others = legal.filter((e) => !r.best.includes(e));
    const second = Math.max(...others.map((e) => r.moveValues[e]));
    const classDiffers = others.some((e) => classOf(board, r.moveValues[e]) !== r.value);
    if (r.net - second < 2 && !classDiffers) return null;                 // too fine a difference
    return { board, r, legal };
}

/* ---------- main ---------- */
const started = Date.now();
const puzzles = [];
const seen = new Set();
const tagCount = new Map();
const colour = [0, 0];
function capped(cfg, tags) {
    const c = tagCount.get(cfg) || {};
    return tags.some((t) => cfg.caps[t] !== undefined && (c[t] || 0) >= cfg.caps[t]);
}
const count = (cfg) => (tagCount.get(cfg) || {}).__n || 0;

function accept(cfg, s, a) {
    const { board, r, legal } = a;
    const key = `${cfg.n}:${canonical(board.drawn, cfg.n)}:${board.mine - board.theirs}`;
    if (seen.has(key)) return false;
    const tags = tagsFor(board, r);
    if (capped(cfg, tags) || count(cfg) >= cfg.quota) return false;
    if (colour[s.current] > colour[1 - s.current] + 6) return false;
    seen.add(key);
    const c = tagCount.get(cfg) || {};
    c.__n = (c.__n || 0) + 1;
    for (const t of tags) c[t] = (c[t] || 0) + 1;
    tagCount.set(cfg, c);
    colour[s.current]++;
    puzzles.push({
        config: { n: s.n },
        history: Array.from(s.history), toMove: s.current,
        best: r.best.slice().sort((x, y) => x - y), value: r.value, depth: r.depth, tags,
        note: noteFor(tags, r, board, legal),
    });
    return true;
}

for (const cfg of CONFIGS) {
    const rng = Bots.rng(cfg.seed);
    const before = puzzles.length;
    for (let g = 0; g < cfg.games && count(cfg) < cfg.quota && puzzles.length < TARGET; g++) {
        const s = mk(cfg.n);
        let taken = 0;
        while (!s.over && taken < PER_GAME) {
            const free = BoxesRules.legalMoves(s).length;
            if (free < cfg.freeMin) break;                       // past this board's window
            if (free <= cfg.freeMax) {
                const a = analyse(s, cfg);
                if (a && accept(cfg, s, a)) taken++;
            }
            play(s, policy(s, rng));
        }
    }
    console.error(`${cfg.n}x${cfg.n}: +${puzzles.length - before} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

/* ---------- order, ids, write ---------- */
puzzles.sort((a, b) => a.config.n - b.config.n || a.history.length - b.history.length || (a.history.join() < b.history.join() ? -1 : 1));
puzzles.forEach((p, k) => { p.id = `boxes-${String(k + 1).padStart(4, "0")}`; });
const ordered = puzzles.map((p) => ({ id: p.id, config: p.config, history: p.history, toMove: p.toMove, best: p.best, value: p.value, depth: p.depth, tags: p.tags, note: p.note }));
const doc = {
    game: "boxes",
    generated: new Date().toISOString().slice(0, 10),
    solver: "exhaustive alpha-beta negamax to the last line, with a transposition table over the set of undrawn lines and free captures forced (an exact reduction). Value, every optimal line and the exact value of every legal line are game-theoretic facts.",
    puzzles: ordered,
};
writeFileSync(OUT, `{\n  "game": ${JSON.stringify(doc.game)},\n  "generated": ${JSON.stringify(doc.generated)},\n  "solver": ${JSON.stringify(doc.solver)},\n  "puzzles": [\n${ordered.map((p) => "    " + JSON.stringify(p)).join(",\n")}\n  ]\n}\n`);

const byTag = {}, byCfg = {};
for (const p of ordered) { for (const t of p.tags) byTag[t] = (byTag[t] || 0) + 1; const k = `${p.config.n}x${p.config.n}`; byCfg[k] = (byCfg[k] || 0) + 1; }
console.error(`${ordered.length} puzzles in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.error("by board:", JSON.stringify(byCfg));
console.error("by tag:", JSON.stringify(byTag));
console.error("to move:", JSON.stringify(colour));
