/* Bots: the registry and the toolset a bot plays with.

   A bot is pure and headless: it never touches the DOM, so the same code runs in the
   browser (a seat of kind "bot", see app.js) and in Node (unit tests, benchmark). It
   only ever sees the pure rules module of its game plus the helpers below.

   Bots.register({
       id: "random-chain",            // folder name under client/bots/
       name: "Random", game: "chain", version: 1,
       description: "…",
       difficulties: [{ id: "normal", label: "Normal", thinkMs: 50 }],   // at least one; shown in the UI
       create(tools) { return { move(state) { … return cellIndex; } }; },
       evaluate(state, tools) { … return rawScore; },   // optional: player 0's advantage, see "win chance" below
   })

   Win chance: a bot may offer evaluate(state, tools) → a raw score from PLAYER 0's point of
   view (0 = even, positive = player 0 better, ±Infinity = decided; draw = 0). It must honour
   tools.budget.nodes (deterministic for a given budget — no wall clock — so both online
   clients get the same number), be cheap at small budgets (a few ms at 2 000 nodes) and get
   better, not jumpier, with more nodes. The framework turns it into a probability with a
   per-bot calibration (scale/shift) fitted from self-play by scripts/calibrate.mjs and baked
   into benchmark.js as Bots.calibration(id, {...}); Bots.estimator(game) picks the strongest
   evaluating bot and runs it in stages (ESTIMATE_STAGES) so the HUD can show a quick number
   first and refine it while nobody moves.

   create(tools) is called once per game and returns an instance; move(state) may return
   the cell index or a Promise of it. The instance may keep state across moves (caches,
   opening books). Searching bots work against tools.budget: in the app it is a time
   budget (the difficulty's thinkMs), in tests and the benchmark a node budget so results
   are deterministic — call tools.deadline() once per move and d.tick() per node.
   The benchmark workflow writes client/bots/<id>/benchmark.js, which calls
   Bots.benchmark(id, result) so the score is baked into the deployed page. */

"use strict";

const Bots = (() => {
    const defs = {};
    const order = [];
    const results = {};          // id -> benchmark result (from the generated benchmark.js files)
    const calibrations = {};     // id -> { scale, shift, … } (also from benchmark.js)
    const ESTIMATE_STAGES = [2000, 12000, 60000];   // node budgets of the progressive win-chance refinement

    /* ---------- seeded random numbers (mulberry32): same seed, same game ---------- */
    function rng(seed) {
        let a = (seed >>> 0) || 0x9e3779b9;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ---------- registry ---------- */
    function validate(def) {
        const fail = (msg) => { throw new Error(`Bots.register(${def && def.id}): ${msg}`); };
        if (!def || typeof def !== "object") fail("definition missing");
        if (!/^[a-z0-9-]{2,40}$/.test(def.id || "")) fail("id must be a folder-safe slug");
        if (typeof def.name !== "string" || !def.name.trim()) fail("name missing");
        if (typeof def.game !== "string" || !def.game) fail("game missing");
        if (!Array.isArray(def.difficulties) || def.difficulties.length === 0) fail("difficulties must list at least one { id, label }");
        for (const d of def.difficulties) {
            if (!d || typeof d.id !== "string" || typeof d.label !== "string") fail("difficulty needs id and label");
            if (d.thinkMs !== undefined && !(d.thinkMs > 0 && d.thinkMs <= 5000)) fail("thinkMs must be 1..5000 ms (phones!)");
        }
        if (typeof def.create !== "function") fail("create(tools) missing");
        if (defs[def.id]) fail("registered twice");
    }
    function register(def) {
        validate(def);
        defs[def.id] = def;
        order.push(def.id);
        return def;
    }
    const get = (id) => defs[id];
    const list = () => order.map((id) => defs[id]);
    const forGame = (game) => list().filter((b) => b.game === game);
    function benchmark(id, result) { results[id] = result; }
    const benchmarkOf = (id) => results[id] || null;
    function calibration(id, c) { calibrations[id] = c; }
    const calibrationOf = (id) => calibrations[id] || null;

    // raw score -> probability that player 0 wins, with the bot's calibration (or its default)
    function toProbability(raw, cal) {
        if (raw === Infinity) return 1;
        if (raw === -Infinity) return 0;
        if (!Number.isFinite(raw)) return 0.5;
        const scale = (cal && cal.scale) || 1, shift = (cal && cal.shift) || 0;
        const p = 1 / (1 + Math.exp(-(raw - shift) / scale));
        return Math.min(0.995, Math.max(0.005, p));
    }

    /* Win-chance estimator for a game: { stages, at(state, nodes) -> P(player 0 wins), quick(state) }.
       Uses the strongest registered bot that offers evaluate() (highest benchmark score first),
       else the rules module's own heuristic. `at` is deterministic for a given node budget, so
       both online clients agree; the HUD runs the stages in the background between moves. */
    function estimator(game) {
        const rules = Rules.of(game);
        const candidates = forGame(game).filter((b) => typeof b.evaluate === "function")
            .sort((a, b) => ((benchmarkOf(b.id) || {}).score || 0) - ((benchmarkOf(a.id) || {}).score || 0));
        const def = candidates[0];
        const heuristic = (state) => Math.min(1, Math.max(0, Number(rules && rules.estimate ? rules.estimate(state) : 0.5) || 0));
        if (!def) return { bot: null, stages: [0], at: heuristic, quick: heuristic };
        const cal = calibrationOf(def.id) || def.calibration || null;
        // evaluate() may return a Promise (long budgets yield to the page); `at` follows suit
        const at = (state, nodes) => {
            if (state.over) return state.winner < 0 ? 0.5 : state.winner === 0 ? 1 : 0;
            const t = tools(game, { seed: 0, budget: { ms: Infinity, nodes } });
            const raw = def.evaluate(state, t);
            return raw && typeof raw.then === "function" ? raw.then((r) => toProbability(Number(r), cal)) : toProbability(Number(raw), cal);
        };
        return { bot: def.id, stages: ESTIMATE_STAGES.slice(), at, quick: (state) => at(state, ESTIMATE_STAGES[0]) };
    }

    /* ---------- toolset ---------- */
    // rules: the game's pure rules module; me: the bot's seat; seed: for reproducible games;
    // budget: { ms, nodes } per move (either may be Infinity)
    function tools(game, { rules = Rules.of(game), me = 1, seed = 1, difficulty = "normal", players = 2, budget = { ms: 50, nodes: Infinity } } = {}) {
        if (!rules) throw new Error(`no rules registered for game "${game}"`);
        const random = rng(seed);
        const t = {
            game, rules, me, players, difficulty, seed, budget,
            random,
            randInt: (n) => Math.floor(random() * n),
            pick: (arr) => (arr.length ? arr[Math.floor(random() * arr.length)] : undefined),
            shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
            legalMoves: (state, p = state.current) => rules.legalMoves(state, p),
            isLegal: (state, i, p = state.current) => rules.isLegal(state, i, p),
            clone: (state) => JSON.parse(JSON.stringify(state)),
            // the state after `i` is played by the current player (place + settle + conclude), on a copy
            apply(state, i) {
                const s = t.clone(state);
                Rules.step(rules, s, i);
                return s;
            },
            outcome: (state) => ({ over: !!state.over, winner: state.over ? state.winner : null }),
            opponents: (p = me) => Array.from({ length: players }, (_, k) => k).filter((k) => k !== p),
            // budget helper for searching bots: const d = tools.deadline(); … if (d.tick()) stop;
            // expires on the time budget (app) or the node budget (tests, benchmark), whichever comes first
            deadline(ms = budget.ms) {
                const end = ms === Infinity ? Infinity : Date.now() + ms;
                let nodes = 0;
                const expired = () => nodes >= budget.nodes || Date.now() >= end;
                return { expired, tick: (n = 1) => { nodes += n; return expired(); }, left: () => Math.max(0, end - Date.now()), nodes: () => nodes };
            },
            // let the page breathe during a long search (call every few thousand nodes on the strong levels)
            yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
        };
        return t;
    }

    // a ready-to-play instance of a registered bot. options.budget overrides the difficulty's
    // think time ({ ms, nodes }); the app passes nothing (time), tools pass nodes.
    function create(id, options = {}) {
        const def = get(id);
        if (!def) throw new Error(`unknown bot "${id}"`);
        const level = def.difficulties.find((d) => d.id === options.difficulty) || def.difficulties[0];
        const budget = { ms: level.thinkMs || 50, nodes: Infinity, ...(options.budget || {}) };
        const t = tools(def.game, { ...options, difficulty: level.id, budget });
        const instance = def.create(t) || {};
        if (typeof instance.move !== "function") throw new Error(`bot "${id}" returned no move()`);
        return { def, tools: t, difficulty: level.id, move: (state) => instance.move(state) };
    }

    /* ---------- headless playout (tests, benchmark) ---------- */
    // seats: one player per seat: a bot instance (from create) or a function state -> move
    async function playout(game, config, seats, { maxMoves = 2000, rules = Rules.of(game) } = {}) {
        const state = Rules.create({ players: seats.length, ...config }, rules);
        for (let moves = 0; !state.over && moves < maxMoves; moves++) {
            const seat = seats[state.current];
            const i = await (typeof seat === "function" ? seat(state) : seat.move(state));
            if (!rules.isLegal(state, i, state.current)) throw new Error(`seat ${state.current} played illegal move ${i}`);
            Rules.step(rules, state, i);
        }
        return { over: state.over, winner: state.over ? state.winner : null, moves: state.history.length, history: state.history.slice(), state };
    }

    return { register, get, list, forGame, benchmark, benchmarkOf, calibration, calibrationOf, estimator, toProbability, ESTIMATE_STAGES, tools, create, playout, rng, validate };
})();
