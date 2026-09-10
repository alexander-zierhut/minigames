/* The HUD win chance: frozen while a move animates, refined in stages once it settled,
   smoothed by a third between moves except in decided territory, exact when over. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks, wait } from "./dom.mjs";

// a fake estimator: stage k returns values[k] for the current history length
function install(w, table, stages = [1, 2, 3]) {
    const calls = [];
    w.eval("Bots").estimator = () => ({
        bot: "fake", stages,
        at: (state, nodes) => {
            if (state.over) return state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;   // like the real estimator
            calls.push([state.history.length, nodes]);
            const row = table[state.history.length] || [0.5, 0.5, 0.5];
            return row[stages.indexOf(nodes)];
        },
    });
    return calls;
}
const pct = (w, k) => parseInt(w.document.getElementById(`p${k}-win-pct`).textContent, 10);

test("frozen during the explosion animation, then refined stage by stage", async () => {
    const w = loadDom(); const G = w.eval("ChainGame");
    const calls = install(w, { 0: [0.5, 0.5, 0.5], 1: [0.6, 0.62, 0.64], 2: [0.4, 0.45, 0.5], 3: [0.7, 0.75, 0.8] });
    const { h } = hooks();
    G.newGame({ n: 4, speed: 30, startPlayer: 0 }, h);
    assert.equal(pct(w, 0), 50);
    await wait(20);                                        // background stages of the start position
    await G.play(0); await wait(20); await G.play(15); await wait(20);
    assert.equal(calls.length, 9, "three stages after each settled move (+ start)");
    const before = pct(w, 0);
    const p = G.play(0);                                   // corner explodes: animated
    await wait(5);
    assert.equal(pct(w, 0), before, "no change while the move animates");
    const mid = calls.length;
    await p;
    assert.equal(calls.length, mid + 1, "first stage right after settling");
    await wait(20);
    assert.equal(calls.length, mid + 3, "later stages in the background");
    w.close();
});

test("smoothing: a third of the previous move's value, none above 90 % or below 10 %, none when over", async () => {
    const w = loadDom(); const G = w.eval("FiveGame");
    install(w, { 0: [0.5], 1: [0.8], 2: [0.2], 3: [0.95], 4: [0.3] }, [1]);
    const { h } = hooks();
    G.newGame({ n: 5, winLen: 4, startPlayer: 0 }, h);
    await G.play(0);
    assert.equal(pct(w, 0), Math.round((0.67 * 0.8 + 0.33 * 0.5) * 100), "blended with the previous value");
    const shown1 = pct(w, 0) / 100;
    await G.play(20);
    assert.equal(pct(w, 0), Math.round((0.67 * 0.2 + 0.33 * shown1) * 100));
    await G.play(1);
    assert.equal(pct(w, 0), 95, "decided territory is shown as is");
    await G.play(21);
    assert.equal(pct(w, 0), 30, "and coming from a decided value nothing is blended either");
    G.finish(1, "x");
    assert.equal(pct(w, 0), 0); assert.equal(pct(w, 1), 100);
    w.close();
});

test("the estimator itself: bot with evaluate() is preferred, calibration applied, rules fallback otherwise", () => {
    const w = loadDom(); const Bots = w.eval("Bots"); const Rules = w.eval("Rules");
    const cfg = { n: 5, winLen: 4 }; const state = Rules.of("five").create(cfg, Rules.base(cfg));
    const est = Bots.estimator("five");
    if (est.bot) {
        assert.ok(est.stages.length >= 2);
        const p = est.at(state, est.stages[0]);
        assert.ok(p >= 0 && p <= 1);
    } else {
        assert.ok(Math.abs(est.at(state, 0) - 0.5) < 0.06, "empty board via the rules' heuristic");
    }
    w.close();
});
