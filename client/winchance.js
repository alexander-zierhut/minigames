/* Win chance in the HUD player cards (two players only). An observer of the engine: it
   listens to `game:new` / `game:position` on the Bus and writes the `.win-bar` rows itself,
   so neither the engine nor a game knows about it — a new game gets a win chance as soon
   as a bot of that game offers evaluate() (else the rules module's `estimate` heuristic;
   see Bots.estimator).

   Computed only when a move has settled (never while a move animates), in stages of
   growing node budgets (Bots.ESTIMATE_STAGES) so the bar shows a quick number first and
   refines it while nobody moves; budgets are node counts, so both online clients see the
   same values. Display smoothing blends a new value with the previous move's value by a
   third, except in decided territory (≥ 90 % / ≤ 10 %) and never once the game is over. */

"use strict";

const WinChance = (() => {
    const { $ } = Util;
    const REFINE_MS = 5000, SMOOTH = 0.33, DECIDED = 0.9;
    let estimator = null;       // for the running game, null = no win chance (3+ players, no Bots)
    let token = 0;              // bumps on every new position: stale stage results are dropped
    let timer = null;
    let display = null;         // [p0, p1] shown right now
    let prev = null;            // the previous move's final value (smoothing)

    function reset(ev) {
        token++;
        if (timer) clearTimeout(timer);
        display = prev = null;
        estimator = ev.state && ev.state.players === 2 && typeof Bots !== "undefined" ? Bots.estimator(ev.game) : null;
        show(null);
    }

    function show(values) {
        display = values;
        for (let k = 0; k < 4; k++) {
            const row = $(`p${k}-win-row`);
            if (!row) continue;
            row.hidden = !values;
            if (!values) continue;
            const pct = Math.round(values[k] * 100);
            $(`p${k}-win`).style.width = pct + "%";
            $(`p${k}-win-pct`).textContent = `${pct} % win`;
        }
    }

    function smoothed(state, p) {
        const undecided = (v) => v < DECIDED && v > 1 - DECIDED;
        if (!state.over && prev !== null && undecided(p) && undecided(prev)) return (1 - SMOOTH) * p + SMOOTH * prev;
        return p;
    }

    // a settled position: quick stage now (synchronous when the estimator is), the rest in the background
    function refresh(ev) {
        if (!estimator || !ev.state) return;
        const state = ev.state;
        token++;
        const mine = token;
        if (timer) clearTimeout(timer);
        if (display) prev = display[0];
        const started = Date.now();
        const stages = state.over ? [estimator.stages[0]] : estimator.stages;
        const apply = (k, p) => {
            if (mine !== token || !$("p0-win")) return;                 // superseded, or the page is gone (tests)
            const shown = smoothed(state, p);
            show([shown, 1 - shown]);                                   // the two always add to 100
            if (k + 1 < stages.length && !state.over && Date.now() - started < REFINE_MS) timer = setTimeout(() => run(k + 1), 0);
        };
        const run = (k) => {
            if (mine !== token || state.busy) return;
            const r = estimator.at(state, stages[k]);
            if (r && typeof r.then === "function") r.then((p) => apply(k, p)).catch(() => {});
            else apply(k, r);
        };
        run(0);
    }

    if (typeof Bus !== "undefined") {
        Bus.on("game:new", reset);
        Bus.on("game:position", refresh);
    }

    return { get display() { return display; }, get estimator() { return estimator; }, REFINE_MS, SMOOTH, DECIDED };
})();
