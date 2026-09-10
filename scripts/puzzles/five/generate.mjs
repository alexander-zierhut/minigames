/* Regenerates puzzles.json for Five Wins:  node scripts/puzzles/five/generate.mjs
   Deterministic: seeded playouts (Bots.rng, mulberry32) + hand-crafted positions, solved by
   solver.mjs (proven results only), filtered for diversity and "a mistake is possible",
   de-duplicated under the 8 board symmetries. Nothing here uses Math.random. */
import { writeFileSync } from "node:fs";
import { loadHeadless } from "../../headless.mjs";
import { solve, solveExhaustive, Board, canonical } from "./solver.mjs";

const OUT = new URL("../../../tests/puzzles/five/puzzles.json", import.meta.url);
const { Rules, FiveRules, Bots } = loadHeadless();

/* ---------- targets ---------- */
const TARGET = 170;                                 // stop once reached (≥ 100 required)
// per board config: quota, playouts, when to try exhaustion (empties), ply sampling step,
// and how many puzzles of each capped tag it may contribute (keeps the mix even per board)
const CONFIGS = [
    { n: 5, winLen: 4, quota: 32, games: 60, exhaustEmpties: 25, step: 2, seed: 501, caps: { "win-in-1": 4, "must-block": 8, "win-in-2": 8, "win-in-3": 6, draw: 9 } },
    { n: 6, winLen: 4, quota: 24, games: 40, exhaustEmpties: 26, step: 2, seed: 602, caps: { "win-in-1": 3, "must-block": 6, "win-in-2": 7, "win-in-3": 6, draw: 6 } },
    { n: 6, winLen: 5, quota: 22, games: 40, exhaustEmpties: 23, step: 2, seed: 603, caps: { "win-in-1": 3, "must-block": 6, "win-in-2": 6, "win-in-3": 5, draw: 7 } },
    { n: 7, winLen: 4, quota: 20, games: 30, exhaustEmpties: 28, step: 2, seed: 704, caps: { "win-in-1": 3, "must-block": 5, "win-in-2": 6, "win-in-3": 6, draw: 5 } },
    { n: 7, winLen: 5, quota: 20, games: 40, exhaustEmpties: 22, step: 2, seed: 705, caps: { "win-in-1": 3, "must-block": 5, "win-in-2": 6, "win-in-3": 5, draw: 6 } },
    { n: 8, winLen: 5, quota: 14, games: 30, exhaustEmpties: 20, step: 3, seed: 806, caps: { "win-in-1": 2, "must-block": 3, "win-in-2": 5, "win-in-3": 4, draw: 3 } },
    { n: 9, winLen: 5, quota: 36, games: 60, exhaustEmpties: 19, step: 3, seed: 907, caps: { "win-in-1": 5, "must-block": 4, "win-in-2": 14, "win-in-3": 13, draw: 3 } },
];
const PER_GAME = 2;                                 // puzzles taken from one playout
const EXHAUSTIVE_NODES = 500_000;                   // ≈ 0.5 s; keeps re-solving in the tests fast

/* ---------- rules plumbing ---------- */
const mk = (config) => FiveRules.create(config, Rules.base(config));
function play(s, i) {
    const p = s.current;
    if (!FiveRules.isLegal(s, i, p)) throw new Error(`illegal ${i}`);
    FiveRules.place(s, i, p); FiveRules.settle(s, p);
    const r = FiveRules.conclude(s, p);
    if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
}
function replay(config, history) {
    const s = mk(config);
    for (const i of history) { if (s.over) throw new Error("move after the end"); play(s, i); }
    return s;
}

/* ---------- playout policy: random but line-minded, so tactics actually arise ---------- */
function policy(s, rng) {
    const b = Board.fromState(s), me = s.current, n = s.n;
    const win = b.threats(me);
    if (win.length && rng() < 0.25) return win[Math.floor(rng() * win.length)];
    const block = b.threats(1 - me);
    if (block.length && rng() < 0.85) return block[Math.floor(rng() * block.length)];
    const empty = FiveRules.legalMoves(s);
    const roll = rng();
    if (roll < 0.35) {                              // greedy by static line potential
        let best = -1, bs = -1;
        for (const i of empty) { const sc = b.score(i, me); if (sc > bs) { bs = sc; best = i; } }
        return best;
    }
    const near = empty.filter((i) => {
        const x = i % n, y = (i / n) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const u = x + dx, v = y + dy;
            if (u >= 0 && v >= 0 && u < n && v < n && s.cells[v * n + u] >= 0) return true;
        }
        return false;
    });
    const pool = near.length && roll < 0.92 ? near : empty;
    return pool[Math.floor(rng() * pool.length)];
}

/* ---------- classification ---------- */
function tagsFor(s, r) {
    const b = Board.fromState(s), me = s.current;
    const tags = [];
    const myWin = b.threats(me).length > 0, opT = b.threats(1 - me).length;
    if (myWin) { tags.push("win-in-1"); if (opT) tags.push("prefer-win"); }
    else if (opT === 1) tags.push("must-block");
    if (r.value === "win" && r.depth > 1) {
        tags.push(`win-in-${(r.depth + 1) / 2}`);
        if (r.depth === 3 && !opT) tags.push("double-threat");
    }
    if (r.value === "draw") tags.push("draw");
    if (r.method === "exhaustive") tags.push("endgame-exhaustive");
    if (r.moveValues && !myWin && opT !== 1) {
        const others = Object.entries(r.moveValues).filter(([m]) => !r.best.includes(Number(m)));
        if (others.length && others.every(([, v]) => v === "loss")) tags.push("avoid-loss");
    }
    return tags;
}
function noteFor(tags, r, n) {
    const parts = [];
    if (tags.includes("prefer-win")) parts.push("Both sides threaten to complete a line: take your own win.");
    else if (tags.includes("win-in-1")) parts.push("Complete the line.");
    if (tags.includes("must-block")) parts.push(r.value === "win" ? "Block the four first; the win comes later." : "Block the four to hold the draw.");
    if (tags.includes("double-threat")) parts.push("Create two completion cells at once.");
    if (tags.includes("win-in-3")) parts.push("A forcing sequence (four, then a double threat) wins.");
    if (r.value === "win" && r.depth > 5) parts.push(`Forced win in ${(r.depth + 1) / 2} moves.`);
    if (tags.includes("draw") && !tags.includes("must-block")) parts.push("Only these moves hold the draw.");
    if (tags.includes("avoid-loss")) parts.push("Every other move loses by force.");
    return parts.join(" ") + ` (${r.best.length}/${n} moves are best)`;
}

/* ---------- acceptance ---------- */
function analyse(s, cfg) {
    const legal = FiveRules.legalMoves(s).length;
    let r = solve(s, { exhaustiveNodes: 0 });                                       // cheap threat search first
    const b = Board.fromState(s);
    const wantExhaustive = b.empties <= cfg.exhaustEmpties;
    if (r.value !== "win" && wantExhaustive) {
        // exhausting only pays when a draw / must-block puzzle can still be accepted
        const opT = b.threats(1 - s.current).length;
        const useful = !capped(cfg, ["draw"]) || (opT === 1 && !capped(cfg, ["must-block"]));
        if (!useful) return null;
        r = solveExhaustive(b, { maxNodes: EXHAUSTIVE_NODES });
    }
    else if (r.value === "win" && wantExhaustive && r.depth > 1) {
        // a won small board: exhaust it too so we know whether the other moves are mistakes
        const e = solveExhaustive(b, { maxNodes: EXHAUSTIVE_NODES });
        if (e.value === "win") {
            if (e.depth !== r.depth || JSON.stringify(e.best) !== JSON.stringify(r.best)) throw new Error("engines disagree: " + JSON.stringify([e, r]));
            r = e;
        }
    }
    if (r.value !== "win" && r.value !== "draw") return null;
    if (r.best.length >= legal) return null;                                        // nothing to get wrong
    if (r.moveValues) {
        const worse = Object.entries(r.moveValues).some(([m, v]) => !r.best.includes(Number(m)) && v !== r.value);
        if (!worse) return null;                                                    // e.g. every move wins, only slower
    } else if (r.best.length > Math.max(2, legal / 8)) return null;                 // threat-only: keep it sharp
    return { r, legal };
}

/* ---------- main ---------- */
const started = Date.now();
const puzzles = [];
const seen = new Set();
const tagCount = new Map();                         // cfg → { tag → count }
const colour = [0, 0];
function capped(cfg, tags) {
    const c = tagCount.get(cfg) || {};
    return tags.some((t) => cfg.caps[t] !== undefined && (c[t] || 0) >= cfg.caps[t]);
}
const count = (cfg) => puzzles.filter((p) => p.config.n === cfg.n && p.config.winLen === cfg.winLen).length;

function accept(cfg, s, r, legal, note) {
    const cfgKey = `${cfg.n}/${cfg.winLen}`;
    const key = cfgKey + ":" + canonical(s.cells, s.n) + ":" + s.current;
    if (seen.has(key)) return false;
    const tags = tagsFor(s, r);
    if (capped(cfg, tags) || count(cfg) >= cfg.quota) return false;
    if (colour[s.current] > colour[1 - s.current] + 6) return false;               // both colours to move
    seen.add(key);
    const c = tagCount.get(cfg) || {};
    for (const t of tags) c[t] = (c[t] || 0) + 1;
    tagCount.set(cfg, c);
    colour[s.current]++;
    puzzles.push({
        config: { n: s.n, winLen: s.winLen },
        history: Array.from(s.history), toMove: s.current,
        best: r.best, value: r.value, depth: r.depth, tags,
        note: note || noteFor(tags, r, legal),
    });
    return true;
}

// 1. hand-crafted positions (stones as [x, y] per player; p0 moved first, so |p0| - |p1| ∈
//    {0, 1}: equal counts → p0 to move, one more p0 stone → p1 to move)
const HAND = [
    { n: 9, winLen: 5, p0: [[3, 4], [4, 4], [5, 4]], p1: [[3, 3], [4, 3], [0, 8]], note: "Open three: extend it to an open four." },
    { n: 9, winLen: 5, p1: [[2, 4], [3, 4], [4, 4], [4, 5], [4, 6]], p0: [[1, 4], [3, 3], [5, 3], [7, 7], [8, 0], [0, 0]], note: "Four-three: the four forces a block, then the three becomes an open four." },
    { n: 9, winLen: 5, p0: [[3, 3], [4, 3], [3, 5], [3, 6]], p1: [[6, 6], [7, 7], [1, 1], [0, 8]], note: "Double three: one move makes two open threes." },
    { n: 7, winLen: 5, p1: [[1, 3], [2, 3], [3, 3], [4, 3]], p0: [[1, 1], [2, 2], [3, 1], [5, 3], [6, 6]], note: "Your four is blocked on the right; the other end still wins." },
    { n: 7, winLen: 5, p0: [[1, 1], [2, 2], [3, 3], [4, 4]], p1: [[1, 5], [2, 5], [3, 5], [4, 5]], note: "Both sides have an open four: complete your own line instead of blocking." },
    { n: 6, winLen: 4, p1: [[0, 0], [1, 1], [2, 2]], p0: [[3, 0], [3, 1], [3, 2], [5, 5]], note: "Both have a three: whoever moves wins." },
    { n: 6, winLen: 4, p0: [[1, 2], [2, 2], [4, 4]], p1: [[2, 3], [3, 3], [5, 5]], note: "Symmetric threes; the mover attacks first." },
    { n: 5, winLen: 4, p1: [[0, 0], [1, 1], [2, 2]], p0: [[3, 0], [3, 1], [1, 3], [4, 4]], note: "Diagonal three with a free end." },
];
for (const h of HAND) {
    const history = [];
    for (let k = 0; k < Math.max(h.p0.length, h.p1.length); k++) {
        if (k < h.p0.length) history.push(h.p0[k][1] * h.n + h.p0[k][0]);
        if (k < h.p1.length) history.push(h.p1[k][1] * h.n + h.p1[k][0]);
    }
    const cfg = { n: h.n, winLen: h.winLen };
    const s = replay(cfg, history);
    if (s.over) { console.error("hand-crafted position is over:", h.note); continue; }
    const c = CONFIGS.find((c) => c.n === h.n && c.winLen === h.winLen);
    const a = analyse(s, c);
    if (!a) { console.error("hand-crafted position not usable (unproven or trivial):", h.note); continue; }
    if (!accept(c, s, a.r, a.legal, h.note)) console.error("hand-crafted position rejected (duplicate/cap):", h.note);
}
console.error(`hand-crafted: ${puzzles.length}`);

// 2. seeded playouts
for (const cfg of CONFIGS) {
    const rng = Bots.rng(cfg.seed);
    const before = puzzles.length;
    for (let g = 0; g < cfg.games && count(cfg) < cfg.quota && puzzles.length < TARGET; g++) {
        const s = mk({ n: cfg.n, winLen: cfg.winLen });
        let taken = 0;
        const phase = g % cfg.step;                  // sample every step-th position, offset per game
        while (!s.over && taken < PER_GAME) {
            const stones = s.history.length;
            if (stones >= 2 * (cfg.winLen - 1) && stones % cfg.step === phase) {
                const b = Board.fromState(s), me = s.current;
                const myWin = b.threats(me).length > 0, opT = b.threats(1 - me).length;
                const cheapSkip = (myWin && capped(cfg, ["win-in-1"])) || (!myWin && opT === 1 && capped(cfg, ["must-block"])) || opT >= 2;
                if (!cheapSkip) {
                    const a = analyse(s, cfg);
                    if (a && accept(cfg, s, a.r, a.legal)) taken++;
                }
            }
            play(s, policy(s, rng));
        }
    }
    console.error(`${cfg.n}/${cfg.winLen}: +${puzzles.length - before} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

// 3. order, ids, write
puzzles.sort((a, b) => a.config.n - b.config.n || a.config.winLen - b.config.winLen || a.history.length - b.history.length || a.history.join() < b.history.join() ? -1 : 1);
puzzles.forEach((p, k) => { p.id = `five-${String(k + 1).padStart(4, "0")}`; });
const ordered = puzzles.map((p) => ({ id: p.id, config: p.config, history: p.history, toMove: p.toMove, best: p.best, value: p.value, depth: p.depth, tags: p.tags, note: p.note }));
const doc = {
    game: "five",
    generated: new Date().toISOString().slice(0, 10),
    solver: "exhaustive alpha-beta to terminal (exact value, every optimal move) when the board can be exhausted; otherwise a threat search with a complete defender proving forced wins within 5 plies (every fastest winning move). Only proven positions are included.",
    puzzles: ordered,
};
const json = `{\n  "game": ${JSON.stringify(doc.game)},\n  "generated": ${JSON.stringify(doc.generated)},\n  "solver": ${JSON.stringify(doc.solver)},\n  "puzzles": [\n${ordered.map((p) => "    " + JSON.stringify(p)).join(",\n")}\n  ]\n}\n`;
writeFileSync(OUT, json);

// report
const byTag = {}, byCfg = {};
for (const p of ordered) { for (const t of p.tags) byTag[t] = (byTag[t] || 0) + 1; const k = `${p.config.n}x${p.config.n}/${p.config.winLen}`; byCfg[k] = (byCfg[k] || 0) + 1; }
console.error(`${ordered.length} puzzles in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.error("by config:", JSON.stringify(byCfg));
console.error("by tag:", JSON.stringify(byTag));
console.error("to move:", JSON.stringify(colour));
