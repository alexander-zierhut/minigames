#!/usr/bin/env node
/* Win-chance calibration: for every bot that offers evaluate(), play seeded self-play games,
   record (raw score, final result) for every settled position and fit the logistic
   p = 1 / (1 + exp(-(raw - shift) / scale)) that predicts the result best (log-loss, Newton
   steps). Reports the Brier score, the mean swing (|Δp| between consecutive positions of a
   game — what the owner perceives as "jumpy") and the number of samples. The result is baked
   into client/bots/<id>/benchmark.js as Bots.calibration(id, …) by scripts/benchmark.mjs,
   which imports calibrate() from here.   Standalone: node scripts/calibrate.mjs [botId …] */
import { loadHeadless } from "./headless.mjs";

/* One series per game. Pick a board where plenty of positions are still *undecided* (see the
   boxes note below) and, for an evaluator that is symmetric by construction, say so:
   `symmetric` fits the samples together with their mirrors, which pins the 50 % point at raw
   0 and takes the series' own seat prior out of the curve (every fifth game is played against
   Random, always on seat 1). Käsekästchen runs on 7 × 7: Fencer proves 5 × 5 endgames
   exactly, and on that board nearly every position in which a box has already been won is
   proven, so 95 % of the finite samples were a plain raw 0 and the fit collapsed. */
export const SERIES = { chain: { games: 30, config: { n: 6, chainRule: false }, maxMoves: 400 }, five: { games: 40, config: { n: 9, winLen: 5 }, maxMoves: 200 }, isolation: { games: 40, config: { n: 7 }, maxMoves: 200 }, boxes: { games: 24, config: { n: 7 }, maxMoves: 200, symmetric: true } };
export const BUDGET = 12000;          // nodes per evaluation (the middle HUD stage)

// fit scale/shift of a 1-D logistic on samples [{ raw, y }] (y = 1 / 0.5 / 0), infinite raws excluded
export function fitLogistic(samples) {
    const pts = samples.filter((s) => Number.isFinite(s.raw));
    if (pts.length < 20) return null;
    let a = 1 / (Math.sqrt(pts.reduce((acc, s) => acc + s.raw * s.raw, 0) / pts.length) || 1), b = 0;   // p = σ(a·raw + b)
    for (let iter = 0; iter < 60; iter++) {                        // Newton–Raphson on (a, b)
        let gA = 0, gB = 0, hAA = 0, hAB = 0, hBB = 0;
        for (const { raw, y } of pts) {
            const p = 1 / (1 + Math.exp(-(a * raw + b)));
            const e = p - y, w = p * (1 - p) + 1e-9;
            gA += e * raw; gB += e; hAA += w * raw * raw; hAB += w * raw; hBB += w;
        }
        const det = hAA * hBB - hAB * hAB;
        if (Math.abs(det) < 1e-12) break;
        const dA = (hBB * gA - hAB * gB) / det, dB = (hAA * gB - hAB * gA) / det;
        a -= dA; b -= dB;
        if (Math.abs(dA) < 1e-9 && Math.abs(dB) < 1e-9) break;
    }
    if (!(a > 0)) return null;                                       // a bot whose score points the wrong way is not calibrated
    return { scale: 1 / a, shift: -b / a };
}

export function metrics(samples, cal, toP) {
    let brier = 0, n = 0, swing = 0, swings = 0;
    for (const s of samples) { const p = toP(s.raw, cal); brier += (p - s.y) ** 2; n++; }
    for (const g of new Set(samples.map((s) => s.game))) {
        const seq = samples.filter((s) => s.game === g);
        for (let i = 1; i < seq.length; i++) { swing += Math.abs(toP(seq[i].raw, cal) - toP(seq[i - 1].raw, cal)); swings++; }
    }
    return { brier: n ? Math.round(brier / n * 1000) / 1000 : null, swing: swings ? Math.round(swing / swings * 1000) / 10 : null, samples: n };
}

// self-play with the bot's middle difficulty (a few games vs Random for variety); returns samples
export async function collect(H, def, series = SERIES[def.game]) {
    const { Bots, Rules } = H;
    const rules = Rules.of(def.game);
    const middle = def.difficulties[Math.floor((def.difficulties.length - 1) / 2)].id;
    const samples = [];
    for (let g = 0; g < series.games; g++) {
        const vsRandom = g % 5 === 4;
        const a = Bots.create(def.id, { seed: 300 + g, me: 0, difficulty: middle, budget: { ms: Infinity, nodes: 4000 } });
        const b = vsRandom ? Bots.create(`random-${def.game}`, { seed: 900 + g, me: 1 }) : Bots.create(def.id, { seed: 600 + g, me: 1, difficulty: middle, budget: { ms: Infinity, nodes: 4000 } });
        const cfg = { ...series.config, startPlayer: g % 2 };
        const state = Rules.create(cfg, rules);
        const positions = [];
        for (let moves = 0; !state.over && moves < series.maxMoves; moves++) {
            const seat = state.current === 0 ? a : b;
            const i = await seat.move(state);
            Rules.step(rules, state, i);
            if (!state.over) {
                const t = Bots.tools(def.game, { seed: 0, budget: { ms: Infinity, nodes: BUDGET } });
                positions.push(Number(await def.evaluate(JSON.parse(JSON.stringify(state)), t)));
            }
        }
        if (!state.over) continue;                                   // unfinished games teach nothing
        const y = state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;
        positions.forEach((raw) => samples.push({ game: g, raw, y }));
    }
    return samples;
}

export async function calibrate(H, def) {
    const series = SERIES[def.game];
    const samples = await collect(H, def, series);
    // a symmetric evaluator must map raw 0 to 50 %: fit the samples and their mirrors
    const cal = fitLogistic(series && series.symmetric ? samples.concat(samples.map((s) => ({ ...s, raw: -s.raw, y: 1 - s.y }))) : samples);
    if (!cal) return null;
    const m = metrics(samples, cal, H.Bots.toProbability);
    return { scale: Math.round(cal.scale * 1000) / 1000, shift: Math.round(cal.shift * 1000) / 1000, ...m, budget: BUDGET, games: SERIES[def.game].games };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const H = loadHeadless();
    const only = process.argv.slice(2);
    for (const def of H.Bots.list().filter((b) => typeof b.evaluate === "function" && (only.length === 0 || only.includes(b.id)))) {
        const t0 = Date.now();
        const c = await calibrate(H, def);
        console.log(`${def.id.padEnd(16)} ${c ? `scale ${c.scale} shift ${c.shift} brier ${c.brier} swing ${c.swing} % (${c.samples} positions)` : "not calibratable"} (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
}
