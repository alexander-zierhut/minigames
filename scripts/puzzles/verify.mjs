#!/usr/bin/env node
/* Independent spot check of the puzzle sets, written without the solvers: re-proves every
   win-in-1 / must-block / avoid-loss / avoid-trap / avoid-three / forced-three puzzle with a
   plain one- or two-ply look-ahead through the real rules, and prints what blind random
   picking would score on each set (the baseline to read bot scores against).
   node scripts/puzzles/verify.mjs [chain|five|five-yavalath|isolation|boxes] */
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
    // somebody else can win right now (a game where a move may keep the mover on turn —
    // boxes — must not count the mover's own follow-up as the opponent's win)
    const opponentWinsNext = (s, t) => !t.over && t.current !== s.current && rules.legalMoves(t, t.current).some((r) => winsNow(t, r));
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
            // I win now: the reply ended the game against its own player, or I complete a line next
            const iWinNow = (u) => !u.over && u.current === s.current && rules.legalMoves(u, u.current).some((r) => winsNow(u, r));
            for (const b of p.best) {
                const t = tools.apply(s, b);
                if (lostAtOnce(s, t)) { bad.push(`${p.id}: best ${b} loses at once`); continue; }
                if (t.over) continue;                                       // already won by the move itself
                const lost = (u) => (u.over && u.winner === s.current) || iWinNow(u);
                for (const r of rules.legalMoves(t, t.current)) if (!lost(tools.apply(t, r))) bad.push(`${p.id}: after best ${b} the reply ${r} does not lose`);
            }
        }
        if (p.tags.includes("must-block") || p.tags.includes("avoid-loss") || p.tags.includes("avoid-trap")) {
            checked++;
            for (const b of p.best) { const t = tools.apply(s, b); if (lostAtOnce(s, t) || opponentWinsNext(s, t)) bad.push(`${p.id}: best ${b} loses at once`); }
            /* "avoid-loss" / "avoid-trap" mean every other move loses by force; a one-ply check
               can confirm that for the other moves whenever the loss comes at once (five: depth 2;
               isolation: always, the tag is only set when the opponent traps on the spot) */
            if ((p.tags.includes("avoid-loss") && p.depth === 2) || p.tags.includes("avoid-trap")) {
                for (const m of legal) if (!p.best.includes(m)) { const t = tools.apply(s, m); if (!lostAtOnce(s, t) && !opponentWinsNext(s, t)) bad.push(`${p.id}: non-best ${m} does not lose at once`); }
            }
        }
        /* Käsekästchen: the structural tags say what the position looks like, and that is
           checkable with the rules alone, without any solver. */
        if (game === "boxes") {
            const captures = (i) => rules.captures(s, i);
            const safe = (i) => rules.safeMoves(s).includes(i);
            if (p.tags.includes("take-box")) {
                checked++;
                for (const b of p.best) if (captures(b) === 0) bad.push(`${p.id}: "take-box" best ${b} closes no box`);
                if (legal.every((m) => captures(m) > 0)) bad.push(`${p.id}: "take-box" but every line closes a box`);
            }
            if (p.tags.includes("double-deal")) {
                checked++;
                if (!legal.some((m) => captures(m) > 0)) bad.push(`${p.id}: "double-deal" without a box on the table`);
                for (const b of p.best) if (captures(b) > 0) bad.push(`${p.id}: "double-deal" best ${b} takes instead of declining`);
            }
            if (p.tags.includes("safe-move")) {
                checked++;
                for (const b of p.best) if (!safe(b)) bad.push(`${p.id}: "safe-move" best ${b} hands a box over`);
                if (legal.every((m) => safe(m))) bad.push(`${p.id}: "safe-move" but every line is safe`);
            }
            if (p.tags.includes("sacrifice")) {
                checked++;
                if (rules.safeMoves(s).length) bad.push(`${p.id}: "sacrifice" but a safe line exists`);
                if (legal.some((m) => captures(m) > 0)) bad.push(`${p.id}: "sacrifice" with a box still on the table`);
            }
        }
    }
    problems += bad.length;
    console.log(`${dir}: ${data.puzzles.length} puzzles, blind random picking would score ${(chance / data.puzzles.length * 100).toFixed(1)} %, one-ply re-proof of ${checked} tactical puzzles: ${bad.length} problems`);
    for (const b of bad.slice(0, 10)) console.log("  " + b);
}
process.exit(problems ? 1 : 0);
