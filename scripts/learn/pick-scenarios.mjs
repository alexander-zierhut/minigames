/* Learn scenarios (#41, tiers and kinds #44) from the proven puzzle sets.

   tests/puzzles/<game>/puzzles.json holds positions whose optimal moves were PROVEN by the
   per-game solver, but tests/ is never deployed. This script turns them into a ladder from
   easy to mastery and writes it into client/learn/<game>-scenarios.js, a classic script that
   registers the data with `Learn.scenarios(game, [...])` and is listed in index.html.

   Two stages, so the cheap one can be re-run in a unit test:

   1. FACTS (slow, needs the bots): for every usable puzzle — you to move (toMove 0) and a
      value that is not already lost — how deep the proof is, how many of the legal moves are
      best, whether the game's own greedy move is one of them, whether the Easy and the Normal
      bot find one, and the win chance before the move (the estimator at a modest node budget).
      Plus a handful of "play from here" positions from seeded bot vs bot self-play. Everything
      runs on node budgets with fixed seeds, so a re-run gives the same numbers on any machine.
      The facts are written to scripts/learn/facts/<game>.json (never deployed) and committed.
   2. SELECT (pure): `difficultyOf` scores every fact 1..10, `kindOf` names what it teaches
      (trap / turnaround / best-move), `select` splits the sorted candidates into the three
      tiers, mixes the kinds inside each tier and writes titles and texts. The unit test
      re-runs this stage on the committed facts and compares it with the committed file.

   Run with `npm run learn:scenarios` (add --facts-only to stop after stage 1, --keep-facts to
   select from the committed facts without re-running the bots). */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { ROOT, loadHeadless } from "../headless.mjs";
import { loadPuzzles, puzzleGames, positionOf } from "../puzzles/runner.mjs";

export const FACTS_DIR = `${ROOT}scripts/learn/facts/`;
export const OUT_DIR = `${ROOT}client/learn/`;

/* The three tiers, in order. `quota` counts the rows a tier gets (one of them is the
   play-from-here position), `level` is the bot difficulty index the scenarios of that tier
   are played out against: the first level, the second one, and the one below the top
   (the very hardest level would make a whole game a chore on a phone). */
export const TIERS = [
    { id: "basics", label: "Basics", quota: 6, level: 0 },
    { id: "tactics", label: "Tactics", quota: 8, level: 1 },
    { id: "mastery", label: "Mastery", quota: 8, level: -2 },
];
export const KINDS = ["best-move", "trap", "turnaround", "play-from-here"];

// budgets and seeds of the fact collection: fixed, so the numbers are reproducible
const CHANCE_NODES = 12000;          // the estimator budget behind `chance`
const SELFPLAY_LEVEL = -2;           // self-play for the play-from-here positions runs at "hard"
const SELFPLAY_GAMES = 12;           // seeds tried until enough positions are found
const SELFPLAY_OPENING = 6;          // seeded random opening plies, so the seeds give different games
const PLAY_WINDOW = [0.40, 0.70];    // how far into the game a play-from-here position sits
const PLAY_CHANCE = [0.45, 0.70];    // and how good it is for you
const TURNAROUND_CHANCE = 0.35;      // "you look lost" for a turnaround
const UNSOLVED_DEPTH = 6;            // a proof without a ply count (five's exhaustive draws) reads as this deep

// tag -> the title a player sees; the order is also the order titles are preferred in
const TAGS = [
    ["win-in-1", "Win in one move"],
    ["avoid-trap", "Do not walk into the trap"],
    ["must-block", "Block the threat"],
    ["take-box", "Take the free box"],
    ["sacrifice", "Give away as little as possible"],
    ["double-deal", "Give two boxes away to keep control"],
    ["safe-move", "Play a line that hands nothing over"],
    ["double-threat", "Make two threats at once"],
    ["win-in-2", "Win in two moves"],
    ["avoid-loss", "Only one move holds"],
    ["prefer-win", "Take the win, not the block"],
    ["win-in-3", "Win in three moves"],
    ["draw", "Hold the draw"],
    ["win-in-4", "Win in four moves"],
    ["win-in-5", "Win in five moves"],
    ["win-in-6", "Win in six moves"],
    ["win-in-7", "Win in seven moves"],
    ["win-in-9", "Win in nine moves"],
    ["separated", "Win the race for room"],
];
const TITLE = new Map(TAGS);
const TAG_ORDER = TAGS.map(([t]) => t);
// tags that describe how a puzzle was produced, not what it teaches
const TOOLING = ["endgame-exhaustive", "opening", "delay-loss"];

// the title a row of that kind gets (a best-move row prefers the puzzle's own tag title)
const KIND_TITLE = { "best-move": "Find the best move", trap: "Spot the trap", turnaround: "Behind, but winning", "play-from-here": "Play it out" };
// the sentence in front of the puzzle's own note
const KIND_TEXT = {
    "best-move": "",
    trap: "The obvious move loses. Find the right one.",
    turnaround: "You are behind. There is a forced win.",
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/* How bad the position looks for you before the move: the lower of the two views, the
   searching estimator (`chance`) and the game's own static heuristic (`look`, what the
   position looks like at a glance). A proven win that either of them writes off is a
   turnaround. */
export const behind = (f) => Math.min(Number(f.chance ?? 0.5), Number(f.look ?? f.chance ?? 0.5));

/* ---------------- stage 2: the pure part (difficulty, kind, selection) ---------------- */

/* How hard a scenario is, 1..10, from facts a solver and the bots produced:
   the proof depth (a win in one is not a lesson, a win in five is), how thin the set of
   good moves is, whether the natural greedy move and the Easy / Normal bot walk past it,
   and how far behind you look. Play-from-here positions are scored by their tier instead:
   the work there is the whole game against that tier's bot. */
export function difficultyOf(f) {
    if (f.kind === "play-from-here") {
        const base = { basics: 4, tactics: 7, mastery: 9 }[f.tier] || 5;
        return clamp(base + (f.chance <= 0.55 ? 1 : 0), 1, 10);
    }
    const depth = typeof f.depth === "number" ? f.depth : UNSOLVED_DEPTH;
    const share = f.bestCount / Math.max(1, f.legal);
    let d = 1;
    d += Math.min(4, (depth - 1) / 2);                                     // the proof depth
    d += share <= 0.05 ? 2 : share <= 0.15 ? 1.5 : share <= 0.35 ? 1 : 0;  // few moves work
    if (!f.greedyOk) d += 1;                                               // the natural move is wrong
    if (!f.easyOk) d += 1.5;                                               // the Easy bot walks into it
    if (!f.normalOk) d += 1;                                               // so does the Normal one
    if (behind(f) <= TURNAROUND_CHANCE) d += 1;                            // and you look lost
    return clamp(Math.round(d), 1, 10);
}

/* What a puzzle teaches: a turnaround (you look lost, yet a win is proven), a trap (the
   obvious move — the game's own greedy move, or the one the Easy bot plays — is not among
   the proven ones), else simply the best move. */
export function kindOf(f) {
    if (f.kind) return f.kind;
    if (f.value === "win" && behind(f) <= TURNAROUND_CHANCE) return "turnaround";
    if (!f.greedyOk || !f.easyOk) return "trap";
    return "best-move";
}

const primaryTag = (tags = []) => TAG_ORDER.find((t) => tags.includes(t)) || null;
const shownTags = (tags = []) => tags.filter((t) => TITLE.has(t) && !TOOLING.includes(t));

/* The generated notes are written for the puzzle tooling: they end in a sentence naming the
   board and the ply, count plies and say how the position was solved. Keep the ideas, drop
   the bookkeeping, and speak about the players instead of seat numbers. */
export function clean(note) {
    const parts = String(note || "").split(/(?<=\.)\s+/);
    const kept = parts.filter((s) => !/moves played, player \d to move/.test(s) && !/^Solved exhaustively\.$/.test(s));
    return kept.join(" ")
        .replace(/\s*\(\d+\/\d+ moves are best\)/g, "")
        .replace(/\s*\(\d+ plies\)/g, "")
        .replace(/\bplayer 0\b/g, "you")
        .replace(/\bplayer 1\b/g, "the bot")
        .replace(/\s+/g, " ")
        .replace(/\s+\./g, ".")
        .trim();
}

// the rows of one tier: a slice of the sorted candidates, taken kind by kind so a tier is
// never eight of the same thing, then sorted from easy to hard again
function takeTier(pool, quota, kindOrder) {
    const out = [];
    const left = pool.slice();
    for (let round = 0; out.length < quota && round < quota; round++) {
        for (const kind of kindOrder) {
            if (out.length >= quota) break;
            const at = left.findIndex((c) => c.kind === kind);
            if (at >= 0) out.push(left.splice(at, 1)[0]);
        }
        if (!kindOrder.some((k) => left.some((c) => c.kind === k))) break;
    }
    while (out.length < quota && left.length) out.push(left.shift());
    return out.sort((a, b) => (a.difficulty - b.difficulty) || (a.id < b.id ? -1 : 1));
}

/* The ladder of one game, purely from the facts file: score every candidate, split the
   sorted list into three bands sized like the tier quotas, mix the kinds inside each band
   and hang the tier's play-from-here position at its end. */
export function select(facts) {
    const scored = (facts.puzzles || [])
        .map((f) => ({ ...f, kind: kindOf(f), difficulty: difficultyOf(f) }))
        .sort((a, b) => (a.difficulty - b.difficulty) || (a.id < b.id ? -1 : 1));
    const play = facts.play || [];
    const puzzleQuota = TIERS.map((t, k) => Math.max(0, t.quota - (play[k] ? 1 : 0)));
    const wanted = puzzleQuota.reduce((a, b) => a + b, 0);
    const out = [];
    let at = 0;
    TIERS.forEach((tier, k) => {
        // the band this tier picks from: its share of the sorted candidates (the last one takes the rest)
        const size = k === TIERS.length - 1
            ? scored.length - at
            : Math.min(scored.length - at, Math.max(puzzleQuota[k], Math.round(scored.length * puzzleQuota[k] / wanted)));
        const band = scored.slice(at, at + size);
        at += size;
        const order = tier.id === "basics" ? ["best-move", "trap", "turnaround"]
            : tier.id === "tactics" ? ["trap", "turnaround", "best-move"]
                : ["turnaround", "trap", "best-move"];
        const rows = takeTier(band, puzzleQuota[k], order);
        const pfh = play[k];
        if (pfh) rows.push({ ...pfh, tier: tier.id, kind: "play-from-here", difficulty: difficultyOf({ ...pfh, kind: "play-from-here", tier: tier.id }) });
        rows.sort((a, b) => (a.difficulty - b.difficulty) || (a.id < b.id ? -1 : 1));   // easy first, whatever came in
        for (const row of rows) out.push({ ...row, tier: tier.id, level: facts.levels[tier.id] });
    });
    return dress(out, facts);
}

// titles and texts, and the shape the client reads. Titles are numbered inside a tier, so
// the numbers stay small and every tier reads like a chapter of its own.
function dress(rows, facts) {
    const seen = new Map();
    const levelLabel = (id) => (facts.levelLabels && facts.levelLabels[id] ? facts.levelLabels[id].toLowerCase() : id);
    return rows.map((row) => {
        const tag = primaryTag(row.tags);
        let title = row.kind === "best-move" ? (TITLE.get(tag) || KIND_TITLE[row.kind]) : KIND_TITLE[row.kind];
        const key = `${row.tier}/${title}`;
        const k = (seen.get(key) || 0) + 1;
        seen.set(key, k);
        if (k > 1) title = `${title} (${k})`;
        const text = row.kind === "play-from-here"
            ? `Win this game from here against the ${levelLabel(row.level)} bot. A draw is not enough.`
            : [KIND_TEXT[row.kind], clean(row.note)].filter(Boolean).join(" ");
        const sc = {
            id: row.id,
            tier: row.tier,
            kind: row.kind,
            difficulty: row.difficulty,
            level: row.level,
            title,
            text: text || "Find the move that wins.",
            config: row.config,
            history: row.history,
            toMove: 0,
        };
        if (row.kind === "play-from-here") sc.goal = "win";
        else sc.best = row.best;
        sc.tags = row.kind === "play-from-here" ? [] : shownTags(row.tags);
        return sc;
    });
}

/* ---------------- stage 1: the facts (bots, estimator, self-play) ---------------- */

// the move the game's own heuristic likes best: one ply deep, greedy. For Chain React that is
// the move taking the most cells, for Five Wins the one extending your longest row.
export function greedyMove(H, game, state) {
    const rules = H.Rules.of(game);
    const p = state.current;
    let best = -Infinity, move = -1;
    for (const i of rules.legalMoves(state, p)) {
        const s = JSON.parse(JSON.stringify(state));
        H.Rules.step(rules, s, i);
        const e = typeof rules.estimate === "function" ? Number(rules.estimate(s)) : 0.5;
        const score = p === 0 ? e : 1 - e;
        if (score > best + 1e-9) { best = score; move = i; }
    }
    return move;
}

const levelIds = (def) => def.difficulties.map((d) => d.id);
const levelAt = (def, k) => def.difficulties[(k + def.difficulties.length) % def.difficulties.length];

// a stable fingerprint of a puzzle set, so the facts can say which set they belong to
export function fingerprint(data) {
    let h = 0x811c9dc5;
    for (const ch of JSON.stringify((data.puzzles || []).map((p) => [p.id, p.best, p.history, p.value, p.depth]))) {
        h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    }
    return h.toString(16);
}

async function botMove(H, id, difficulty, state, seed) {
    const bot = H.Bots.create(id, { me: state.current, difficulty, seed, players: state.players });
    return bot.move(bot.tools.clone(state));
}

export async function collectFacts(H, game) {
    const data = loadPuzzles(game);
    if (!data) return null;
    const def = H.Bots.botFor(game);
    if (!def) throw new Error(`no bot registered for ${game}`);
    const ids = levelIds(def);
    const levels = Object.fromEntries(TIERS.map((t) => [t.id, levelAt(def, t.level).id]));
    const levelLabels = Object.fromEntries(def.difficulties.map((d) => [d.id, d.label]));
    const est = H.Bots.estimator(game);
    const facts = {
        game, bot: def.id, levels, levelLabels, levelOrder: ids,
        set: { count: data.puzzles.length, fingerprint: fingerprint(data) },
        puzzles: [], play: [],
    };
    const rules = H.Rules.of(game);
    let seed = 1;
    for (const p of data.puzzles) {
        // a Learn table always starts at seat 0 (Match.start numbers the game 1), so a puzzle
        // whose own config starts somebody else could not be replayed here
        if (p.toMove !== 0 || (p.config.startPlayer || 0) !== 0) continue;
        if (p.value === "loss" || !Array.isArray(p.best) || !p.best.length) continue;
        const state = positionOf(H, p);
        const legal = rules.legalMoves(state, 0);
        const easy = await botMove(H, def.id, ids[0], state, seed);
        const normal = await botMove(H, def.id, ids[Math.min(1, ids.length - 1)], state, seed);
        const chance = await est.at(state, CHANCE_NODES);
        const look = typeof rules.estimate === "function" ? Number(rules.estimate(state)) : 0.5;
        facts.puzzles.push({
            id: p.id,
            depth: p.depth,
            value: p.value,
            legal: legal.length,
            bestCount: p.best.length,
            greedyOk: p.best.includes(greedyMove(H, game, state)),
            easyOk: p.best.includes(easy),
            normalOk: p.best.includes(normal),
            chance: Math.round(Number(chance) * 1000) / 1000,
            look: Math.round(look * 1000) / 1000,
            tags: p.tags || [],
            note: p.note || "",
            config: p.config,
            history: p.history,
            best: p.best,
        });
        seed++;
    }
    facts.play = await playPositions(H, game, data, def, est);
    return facts;
}

/* Play-from-here positions: seeded bot vs bot self-play on the biggest board the puzzle set
   uses, then the first position in the middle of the game where you are to move, the game is
   undecided and your chance sits in a narrow band around even. One position per tier, each
   from its own game, so the three are never the same fight. */
async function playPositions(H, game, data, def, est) {
    const biggest = data.puzzles.slice().sort((a, b) => (b.config.n - a.config.n) || (a.id < b.id ? -1 : 1))[0];
    const config = { ...biggest.config, players: 2 };
    delete config.startPlayer;                   // a Learn table is always game 1: seat 0 starts
    const rules = H.Rules.of(game);
    const level = levelAt(def, SELFPLAY_LEVEL).id;
    const out = [];
    for (let seed = 1; seed <= SELFPLAY_GAMES && out.length < TIERS.length; seed++) {
        // a seeded random opening makes every seed a different game (the bots themselves
        // are deterministic, so without it every seed would replay the same one)
        const rnd = H.Bots.rng(seed * 7919);
        const seats = [0, 1].map((me) => {
            const bot = H.Bots.create(def.id, { me, difficulty: level, seed: seed * 100 + me, players: 2 });
            return (state) => {
                if (state.history.length >= SELFPLAY_OPENING) return bot.move(state);
                const moves = rules.legalMoves(state, state.current);
                return moves[Math.floor(rnd() * moves.length)];
            };
        });
        const played = await H.Bots.playout(game, config, seats);
        const total = played.history.length;
        const from = Math.ceil(total * PLAY_WINDOW[0]), to = Math.floor(total * PLAY_WINDOW[1]);
        const state = H.Rules.create(config, rules);
        let hit = null;
        for (let ply = 0; ply < total && !hit; ply++) {
            // you are seat 0, so the position has to be one where seat 0 is to move — asked of
            // the state, never of the ply's parity (Käsekästchen lets a seat move twice)
            if (ply >= from && ply <= to && state.current === 0 && !state.over) {
                const chance = Number(await est.at(state, CHANCE_NODES));
                if (chance >= PLAY_CHANCE[0] && chance <= PLAY_CHANCE[1]) {
                    hit = { id: `${game}-play-${out.length + 1}`, config, history: played.history.slice(0, ply), chance: Math.round(chance * 1000) / 1000, ply, of: total, seed };
                }
            }
            H.Rules.step(rules, state, played.history[ply]);
        }
        if (hit) out.push(hit);
    }
    return out;
}

/* ---------------- files ---------------- */

const factsFile = (game) => `${FACTS_DIR}${game}.json`;
export const loadFacts = (game) => (existsSync(factsFile(game)) ? JSON.parse(readFileSync(factsFile(game), "utf8")) : null);

function writeFacts(game, facts) {
    if (!existsSync(FACTS_DIR)) mkdirSync(FACTS_DIR, { recursive: true });
    writeFileSync(factsFile(game), `${JSON.stringify(facts, null, 1)}\n`);
}

function render(game, list, solver) {
    const rows = list.map((s) => `    ${JSON.stringify(s)},`).join("\n");
    return `/* Generated by scripts/learn/pick-scenarios.mjs — do not edit by hand.
   The Learn ladder of ${game} (#41, tiers and kinds #44), built from the proven puzzle set
   tests/puzzles/${game}/puzzles.json (${solver.split(/[.;]/)[0].trim()})
   and from seeded self-play for the "play from here" positions.
   Every "best" list is the complete set of optimal moves the solver proved. */

"use strict";

Learn.scenarios("${game}", [
${rows}
]);
`;
}

export async function writeAll({ factsOnly = false, keepFacts = false } = {}) {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    const H = keepFacts ? null : loadHeadless();
    for (const game of puzzleGames()) {
        // a rule variant is not a game of its own (tests/puzzles/five-yavalath): no facts, no ladder
        if ((loadPuzzles(game) || {}).variant) continue;
        const t0 = Date.now();
        let facts = keepFacts ? loadFacts(game) : await collectFacts(H, game);
        if (!facts) { console.log(`${game}: no facts, skipped`); continue; }
        if (!keepFacts) writeFacts(game, facts);
        console.log(`${game}: ${facts.puzzles.length} candidates, ${facts.play.length} play-from-here (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        if (factsOnly) continue;
        const list = select(facts);
        const data = loadPuzzles(game);
        const file = `${OUT_DIR}${game}-scenarios.js`;
        const text = render(game, list, data.solver || "");
        const before = existsSync(file) ? readFileSync(file, "utf8") : "";
        writeFileSync(file, text);
        console.log(`  -> client/learn/${game}-scenarios.js${before === text ? " (unchanged)" : ""}`);
        for (const s of list) console.log(`  ${s.tier.padEnd(8)} ${String(s.difficulty).padStart(2)}  ${s.kind.padEnd(15)} ${s.id}  ${s.title}`);
    }
}

// run as a script, not when a test imports the pure part
if (process.argv[1] && process.argv[1].endsWith("pick-scenarios.mjs")) {
    await writeAll({ factsOnly: process.argv.includes("--facts-only"), keepFacts: process.argv.includes("--keep-facts") });
}
