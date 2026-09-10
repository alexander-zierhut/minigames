/* Win-chance calibration: the logistic fit recovers a known curve, metrics are sane. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLogistic, metrics } from "../../scripts/calibrate.mjs";
import { loadHeadless } from "../../scripts/headless.mjs";

const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

test("fitLogistic recovers scale and shift from synthetic outcomes", () => {
    const r = rng(1);
    const samples = [];
    for (let g = 0; g < 200; g++) {
        for (let k = 0; k < 10; k++) {
            const raw = (r() - 0.5) * 40;                                   // scores in -20..20
            const p = 1 / (1 + Math.exp(-(raw - 2) / 5));                   // true curve: scale 5, shift 2
            samples.push({ game: g, raw, y: r() < p ? 1 : 0 });
        }
    }
    const cal = fitLogistic(samples);
    assert.ok(cal, "fit found");
    assert.ok(Math.abs(cal.scale - 5) < 1, `scale ≈ 5 (${cal.scale})`);
    assert.ok(Math.abs(cal.shift - 2) < 1, `shift ≈ 2 (${cal.shift})`);
    const { Bots } = loadHeadless();
    const m = metrics(samples, cal, Bots.toProbability);
    assert.ok(m.brier < 0.25 && m.brier > 0, `Brier better than a coin (${m.brier})`);
    assert.equal(m.samples, 2000);
    assert.ok(m.swing > 0);
    assert.equal(fitLogistic(samples.map((s) => ({ ...s, y: 1 - s.y }))), null, "a score pointing the wrong way is not calibrated");
    assert.equal(fitLogistic(samples.slice(0, 5)), null, "too few samples");
});

test("toProbability: infinities exact, calibration applied, clamped", () => {
    const { Bots } = loadHeadless();
    assert.equal(Bots.toProbability(Infinity), 1); assert.equal(Bots.toProbability(-Infinity), 0); assert.equal(Bots.toProbability(NaN), 0.5);
    assert.ok(Math.abs(Bots.toProbability(0, { scale: 5, shift: 0 }) - 0.5) < 1e-9);
    assert.ok(Bots.toProbability(2, { scale: 5, shift: 2 }) === 0.5);
    assert.equal(Bots.toProbability(1e9, { scale: 1, shift: 0 }), 0.995, "clamped: only a decided position is 100 %");
});
