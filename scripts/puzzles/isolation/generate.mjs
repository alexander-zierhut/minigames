/* Regenerates puzzles.json for Isolation:  node scripts/puzzles/isolation/generate.mjs
   Deterministic: seeded playouts (Bots.rng, mulberry32) with a mix of policies, every
   sampled position solved exhaustively by solver.mjs (proven results only), filtered for
   "a mistake is possible" and de-duplicated under the 8 board symmetries. Only positions
   the solver proves within ACCEPT_NODES are kept, so re-solving the whole set in the tests
   stays fast. Nothing here uses Math.random. */
import { writeFileSync } from "node:fs";
import { loadHeadless } from "../../headless.mjs";
import { solveExhaustive, Board, trapsNow, separated, canonical } from "./solver.mjs";

const OUT = new URL("../../../tests/puzzles/isolation/puzzles.json", import.meta.url);
const { Rules, IsolationRules, Bots } = loadHeadless();

/* ---------- targets ---------- */
const TARGET = 200;                                  // stop once reached (>= 100 required)
const ACCEPT_NODES = 40000;                          // a puzzle must be provable in this many nodes (~40 ms)
const MAX_NODES = 300000;                            // what the generator spends before giving up
const PER_GAME = 3;                                  // puzzles taken from one playout
// per board: quota, playouts, when to start solving (free tiles left), tag caps
const CONFIGS = [
    { n: 5, quota: 44, games: 900, from: 13, seed: 5011, caps: { "win-in-1": 9, separated: 14 } },
    { n: 6, quota: 54, games: 900, from: 15, seed: 6022, caps: { "win-in-1": 11, separated: 18 } },
    { n: 7, quota: 54, games: 800, from: 16, seed: 7033, caps: { "win-in-1": 11, separated: 18 } },
    { n: 8, quota: 48, games: 700, from: 17, seed: 8044, caps: { "win-in-1": 10, separated: 16 } },
];

/* ---------- rules plumbing ---------- */
const mk = (config) => Rules.create({ players: 2, ...config }, "isolation");
const play = (s, m) => Rules.step(IsolationRules, s, m);
const freeCount = (s) => s.cells.reduce((k, c) => k + (c === -1 ? 1 : 0), 0);

/* ---------- playout policies: random alone leaves boring boards ---------- */
// break a tile next to the opponent, step where there is room (the natural human idea)
function greedy(s, rng) {
    const me = s.current, foe = 1 - me;
    const moves = IsolationRules.legalMoves(s, me);
    const size = s.cells.length, n = s.n;
    const foeAt = s.pawns[foe];
    const near = (c) => {
        const x = c % n, y = (c - x) / n, fx = foeAt % n, fy = (foeAt - fx) / n;
        return Math.max(Math.abs(x - fx), Math.abs(y - fy));
    };
    let best = [], bs = -Infinity;
    for (const m of moves) {
        const to = Math.floor(m / size), r = m % size;
        const sc = -near(r) * 4 + IsolationRules.steps(s, me).length * 0 + (to === s.pawns[me] ? 0 : 0)
            - Math.abs(near(to) - 2);
        if (sc > bs) { bs = sc; best = [m]; } else if (sc === bs) best.push(m);
    }
    return best[Math.floor(rng() * best.length)];
}
function policy(s, rng, style) {
    const moves = IsolationRules.legalMoves(s, s.current);
    if (style === 0) return moves[Math.floor(rng() * moves.length)];
    if (style === 1) return greedy(s, rng);
    return rng() < 0.6 ? greedy(s, rng) : moves[Math.floor(rng() * moves.length)];
}

/* ---------- classification ---------- */
function tagsFor(board, r, legal) {
    const tags = ["endgame-exhaustive"];
    if (r.depth === 1) tags.push("win-in-1", "trap-now");
    if (separated(board)) tags.push("separated");
    // every move outside `best` hands the opponent an immediate trap
    const losers = legal.filter((m) => !r.best.includes(m));
    if (r.depth !== 1 && losers.length && losers.every((m) => {
        const u = board.make(m);
        const doomed = trapsNow(board).length > 0;
        board.unmake(u);
        return doomed;
    })) tags.push("avoid-trap");
    return tags;
}
function noteFor(tags, r, legal) {
    const parts = [];
    if (tags.includes("win-in-1")) parts.push("Break the last tile the other pawn can step on.");
    else parts.push("Only these moves keep the win.");
    if (tags.includes("avoid-trap")) parts.push("Every other move lets the other pawn trap you at once.");
    if (tags.includes("separated")) parts.push("The pawns are cut off from each other: it is a race for room.");
    return `${parts.join(" ")} (${r.best.length}/${legal} moves are best)`;
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
const count = (cfg) => puzzles.filter((p) => p.config.n === cfg.n).length;

function accept(cfg, s, board, r, legal, startPlayer) {
    const key = `${cfg.n}:${canonical(s.cells, s.n)}:${s.current}`;
    if (seen.has(key)) return false;
    const tags = tagsFor(board, r, legal);
    if (capped(cfg, tags) || count(cfg) >= cfg.quota) return false;
    if (colour[s.current] > colour[1 - s.current] + 5) return false;      // both seats to move
    seen.add(key);
    const c = tagCount.get(cfg) || {};
    for (const t of tags) c[t] = (c[t] || 0) + 1;
    tagCount.set(cfg, c);
    colour[s.current]++;
    puzzles.push({
        config: { n: s.n, startPlayer }, history: Array.from(s.history), toMove: s.current,
        best: r.best, value: r.value, depth: r.depth, tags,
        note: noteFor(tags, r, legal.length),
    });
    return true;
}

for (const cfg of CONFIGS) {
    const rng = Bots.rng(cfg.seed);
    const before = puzzles.length;
    for (let g = 0; g < cfg.games && count(cfg) < cfg.quota && puzzles.length < TARGET; g++) {
        const s = mk({ n: cfg.n, startPlayer: g % 2 });
        const style = g % 3;
        let taken = 0;
        while (!s.over && taken < PER_GAME) {
            if (freeCount(s) <= cfg.from) {
                const legal = IsolationRules.legalMoves(s, s.current);
                if (legal.length > 2) {
                    const board = Board.fromState(s);
                    const r = solveExhaustive(board, { maxNodes: MAX_NODES });
                    if (r.value === "win" && r.nodes <= ACCEPT_NODES && r.best.length && r.best.length < legal.length
                        && r.best.length <= Math.max(2, legal.length / 2)) {
                        if (accept(cfg, s, board, r, legal, g % 2)) taken++;
                    }
                }
            }
            play(s, policy(s, rng, style));
        }
    }
    console.error(`n=${cfg.n}: +${puzzles.length - before} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

/* ---------- order, ids, write ---------- */
puzzles.sort((a, b) => a.config.n - b.config.n || a.config.startPlayer - b.config.startPlayer || a.history.length - b.history.length || (a.history.join() < b.history.join() ? -1 : 1));
puzzles.forEach((p, k) => { p.id = `isolation-${String(k + 1).padStart(4, "0")}`; });
const ordered = puzzles.map((p) => ({ id: p.id, config: p.config, history: p.history, toMove: p.toMove, best: p.best, value: p.value, depth: p.depth, tags: p.tags, note: p.note }));
const doc = {
    game: "isolation",
    generated: new Date().toISOString().slice(0, 10),
    solver: "exhaustive win/loss search to the end of the game (Isolation has no draws), with a transposition table and dead tiles collapsed into one representative waste move. `best` = every move that keeps the win, classified over all legal moves. Only proven positions are included.",
    puzzles: ordered,
};
const json = `{\n  "game": ${JSON.stringify(doc.game)},\n  "generated": ${JSON.stringify(doc.generated)},\n  "solver": ${JSON.stringify(doc.solver)},\n  "puzzles": [\n${ordered.map((p) => "    " + JSON.stringify(p)).join(",\n")}\n  ]\n}\n`;
writeFileSync(OUT, json);

const byTag = {}, byCfg = {};
for (const p of ordered) { for (const t of p.tags) byTag[t] = (byTag[t] || 0) + 1; byCfg[p.config.n] = (byCfg[p.config.n] || 0) + 1; }
console.error(`${ordered.length} puzzles in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.error("by board:", JSON.stringify(byCfg));
console.error("by tag:", JSON.stringify(byTag));
console.error("to move:", JSON.stringify(colour));
