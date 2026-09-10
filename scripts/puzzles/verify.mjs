#!/usr/bin/env node
/* Independent spot check of the puzzle sets, written without the solvers: re-proves every
   win-in-1 / must-block / avoid-loss / avoid-three / forced-three puzzle with a plain one- or
   two-ply look-ahead through the real rules, and prints what blind random picking would score
   on each set (the baseline to read bot scores against).
   node scripts/puzzles/verify.mjs [chain|five|five-yavalath] */
import { loadHeadless } from "../headless.mjs";
import { puzzleSets, loadPuzzles, positionOf } from "./runner.mjs";

const H = loadHeadless();
const dirs = process.argv[2] ? [process.argv[2]] : puzzleSets();
let problems = 0;
for (const dir of dirs) {
    const data = loadPuzzles(dir);
    const game = data.game;
    const rules = H.Rules.of(game);
    const tools = H.Bots.tools(game, { seed: 1 });
    const winsNow = (s, i) => { const t = tools.apply(s, i); return t.over && t.winner === s.current; };
    const opponentWinsNext = (t) => !t.over && rules.legalMoves(t, t.current).some((r) => winsNow(t, r));
    // lost at once: the move ended the game for somebody else (a draw — full or dead board, #18 — is not a loss)
    const lostAtOnce = (s, t) => t.over && t.winner >= 0 && t.winner !== s.current;
    const bad = [];
    let chance = 0, checked = 0;
    for (const p of data.puzzles) {
        const s = positionOf(H, p);
        const legal = rules.legalMoves(s, s.current);
        chance += p.best.length / legal.length;
        if (p.tags.includes("win-in-1")) {
            checked++;
            for (const b of p.best) if (!winsNow(s, b)) bad.push(`${p.id}: best ${b} does not win now`);
            for (const m of legal) if (!p.best.includes(m) && winsNow(s, m)) bad.push(`${p.id}: non-best ${m} also wins now`);
        }
        // the Yavalath variant: a move that makes winLen - 1 ends the game against its owner
        if (p.tags.includes("avoid-three")) {
            checked++;
            for (const b of p.best) if (lostAtOnce(s, tools.apply(s, b))) bad.push(`${p.id}: best ${b} loses at once`);
            if (!legal.some((m) => lostAtOnce(s, tools.apply(s, m)))) bad.push(`${p.id}: no move loses at once, so there is nothing to avoid`);
        }
        if (p.tags.includes("forced-three")) {
            checked++;
            for (const b of p.best) {
                const t = tools.apply(s, b);
                if (lostAtOnce(s, t)) { bad.push(`${p.id}: best ${b} loses at once`); continue; }
                if (t.over) continue;                                       // already won by the move itself
                const lost = (u) => (u.over && u.winner === s.current) || opponentWinsNext(u);
                for (const r of rules.legalMoves(t, t.current)) if (!lost(tools.apply(t, r))) bad.push(`${p.id}: after best ${b} the reply ${r} does not lose`);
            }
        }
        if (p.tags.includes("must-block") || p.tags.includes("avoid-loss")) {
            checked++;
            for (const b of p.best) { const t = tools.apply(s, b); if (lostAtOnce(s, t) || opponentWinsNext(t)) bad.push(`${p.id}: best ${b} loses at once`); }
            // "avoid-loss" means every other move loses by force; only when the puzzle's depth says the
            // loss comes at once (depth 2) can a one-ply check confirm that for the other moves
            if (p.tags.includes("avoid-loss") && p.depth === 2) for (const m of legal) if (!p.best.includes(m)) { const t = tools.apply(s, m); if (!lostAtOnce(s, t) && !opponentWinsNext(t)) bad.push(`${p.id}: non-best ${m} does not lose at once`); }
        }
    }
    problems += bad.length;
    console.log(`${dir}: ${data.puzzles.length} puzzles, blind random picking would score ${(chance / data.puzzles.length * 100).toFixed(1)} %, one-ply re-proof of ${checked} tactical puzzles: ${bad.length} problems`);
    for (const b of bad.slice(0, 10)) console.log("  " + b);
}
process.exit(problems ? 1 : 0);
