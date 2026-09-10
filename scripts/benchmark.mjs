#!/usr/bin/env node
/* Bot benchmark: every real bot (not the Random baselines, `baseline: true`) plays a fixed,
   seeded series against the Random baseline of its game (both colours, alternating starts). The score is the win rate in
   percent (a draw counts half). Results are written to client/bots/<id>/benchmark.js so
   they ship with the page and show up in the bot picker. Deterministic: same bots,
   same numbers, so re-running never creates a diff.
   Usage: node scripts/benchmark.mjs [botId …]   (default: all bots) */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadHeadless, ROOT } from "./headless.mjs";
import { evaluateBot, loadPuzzles } from "./puzzles/runner.mjs";
import { calibrate } from "./calibrate.mjs";

const SERIES = { chain: { games: 60, config: { n: 6, chainRule: false }, maxMoves: 600 }, five: { games: 100, config: { n: 9, winLen: 5 }, maxMoves: 200 } };
// rule variants a bot names with variant(config): the same shape of series plus its own
// puzzle set, stored as `variants: { <key>: { score, games, avgMoves, puzzles } }`
const VARIANTS = { five: { yavalath: { games: 100, config: { n: 9, winLen: 4, yavalath: true }, maxMoves: 200, puzzles: "five-yavalath" } } };
const BASELINE = { chain: "random-chain", five: "random-five" };
// node budget instead of wall clock: the same bot always gets the same numbers (no CI drift, no diff)
const BUDGET = { ms: Infinity, nodes: 20000 };

const H = loadHeadless();
const { Bots } = H;
const only = process.argv.slice(2);
const bots = Bots.list().filter((b) => !b.baseline && (only.length === 0 || only.includes(b.id)));
if (bots.length === 0) { console.error("no bots to benchmark"); process.exit(1); }
let commit = "";
try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: "pipe" }).toString().trim(); } catch (e) { /* not a git checkout */ }

// one seeded series against the baseline, both colours: { score, avgMoves }
async function playSeries(def, baselineId, series, top) {
    let points = 0, moves = 0;
    for (let g = 0; g < series.games; g++) {
        const mySeat = g % 2;                                    // alternate colours; seat 0 starts game 1, seat 1 game 2 …
        const startPlayer = g % 2;
        const me = Bots.create(def.id, { seed: 1000 + g, me: mySeat, difficulty: top, budget: BUDGET });
        const other = Bots.create(baselineId, { seed: 5000 + g, me: 1 - mySeat });
        const seats = mySeat === 0 ? [me, other] : [other, me];
        const r = await Bots.playout(def.game, { ...series.config, startPlayer }, seats, { maxMoves: series.maxMoves });
        if (r.winner === mySeat) points += 1; else if (r.winner === null || r.winner < 0) points += 0.5;
        moves += r.moves;
    }
    return { score: Math.round(points / series.games * 1000) / 10, avgMoves: Math.round(moves / series.games) };
}
const shortPuzzles = (p) => (p ? { solved: p.solved, total: p.total, pct: p.pct, chance: p.chance } : null);

for (const def of bots) {
    const series = SERIES[def.game];
    const baselineId = BASELINE[def.game];
    if (!series || !Bots.get(baselineId)) { console.warn(`${def.id}: no benchmark series for game ${def.game}`); continue; }
    const t0 = Date.now();
    const top = def.difficulties[def.difficulties.length - 1].id;
    const base = await playSeries(def, baselineId, series, top);
    const puzzles = await evaluateBot(H, def.id, { seed: 7, difficulty: top, budget: BUDGET });   // null until a puzzle set exists
    const result = {
        score: base.score,                                         // win rate vs Random, %
        games: series.games, opponent: baselineId, difficulty: top,
        avgMoves: base.avgMoves, version: def.version || 1, commit, at: new Date().toISOString().slice(0, 10),
        puzzles: shortPuzzles(puzzles),                            // perfect moves found in tests/puzzles/<game>; chance = random picking
    };
    // rule variants get their own series and their own puzzle set under the same statement
    const variants = {};
    for (const [key, vs] of Object.entries(VARIANTS[def.game] || {})) {
        if (!Bots.supports(def.id, vs.config) || Bots.variantOf(def.id, vs.config) !== key) continue;
        const v = await playSeries(def, baselineId, vs, top);
        const vp = await evaluateBot(H, def.id, { seed: 7, difficulty: top, budget: BUDGET, set: loadPuzzles(vs.puzzles) });
        variants[key] = { score: v.score, games: vs.games, avgMoves: v.avgMoves, puzzles: shortPuzzles(vp) };
    }
    if (Object.keys(variants).length) result.variants = variants;
    // win-chance calibration for bots that evaluate positions (seeded self-play, deterministic)
    const cal = typeof def.evaluate === "function" ? await calibrate(H, def) : null;
    const file = `${ROOT}client/bots/${def.id}/benchmark.js`;
    const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
    // keep at/commit of an unchanged result so identical numbers never produce a diff
    const old = previous.match(/Bots\.benchmark\("[^"]+", (\{.*?\})\);\n/);        // first statement only (the calibration follows on its own line)
    if (old) { try { const o = JSON.parse(old[1]); if (o.score === result.score && o.games === result.games && o.version === result.version && o.avgMoves === result.avgMoves && JSON.stringify(o.puzzles || null) === JSON.stringify(result.puzzles) && JSON.stringify(o.variants || null) === JSON.stringify(result.variants || null)) { result.at = o.at; result.commit = o.commit; } } catch (e) { /* rewrite */ } }
    writeFileSync(file, `/* generated by scripts/benchmark.mjs — do not edit */\nBots.benchmark("${def.id}", ${JSON.stringify(result)});\n` + (cal ? `Bots.calibration("${def.id}", ${JSON.stringify(cal)});\n` : ""));
    console.log(`${def.id.padEnd(16)} ${String(result.score).padStart(5)} % vs ${baselineId} over ${series.games} games` + (result.puzzles ? `, puzzles ${result.puzzles.solved}/${result.puzzles.total}` : "") + (cal ? `, win chance: scale ${cal.scale} shift ${cal.shift} brier ${cal.brier} swing ${cal.swing} %` : "") + ` (${Math.round((Date.now() - t0) / 1000)} s)`);
    for (const [key, v] of Object.entries(result.variants || {})) console.log(`${("  " + key).padEnd(16)} ${String(v.score).padStart(5)} % vs ${baselineId} over ${v.games} games` + (v.puzzles ? `, puzzles ${v.puzzles.solved}/${v.puzzles.total}` : "") + (cal && cal.variants && cal.variants[key] ? `, win chance: scale ${cal.variants[key].scale} shift ${cal.variants[key].shift} brier ${cal.variants[key].brier}` : ""));
}
