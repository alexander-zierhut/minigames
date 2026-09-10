/* Replay analysis (#43): what the win chance did over a game, what the bot would have
   played at every move, and a score per seat — plus the panel under the replay bar that
   shows it.

   Two halves, kept apart on purpose:

   1. The computation is pure and headless. `Analysis.analyse(doc, opts)` walks a replay
      document (or any game record: { game, config, history, outs }) with `Rules.replay`,
      asks an estimator for the win chance of every position and the game's bot for the
      best move at every ply, and returns plain data. Everything it needs can be injected
      (`estimator`, `bot`, `nodes`, `onProgress`, `cancelled`, `breathe`), so the unit
      tests run it with fakes and without a browser. Budgets are node counts, never wall
      clock, so the same game always gets the same numbers.
   2. The panel (#replay-panel) renders that data next to the replay bar: a progress bar
      while it runs, the verdict of the move that led to the shown position, the win-chance
      graph (a preference, two players only) and the per-seat scores. app.js owns the
      replay bar and calls open / at / close; the panel never steps the board itself, it
      asks through the onSeek handler.

   The score of a seat (0..100, documented in AGENTS.md):
       accuracy = perfect moves / moves of that seat
       loss     = win-chance points a move gave away against the bot's move (0 when the bot
                  would have played it, mistake from 10 points, blunder from 20)
       score    = 100 × (0.6 × accuracy + 0.4 × max(0, 1 − average loss / 50))
   With three or four players there is no estimator, so there is no loss and no graph, and
   the score is the accuracy alone.

   Results are cached in the `analysis` object store next to the replays (Replays.store),
   stamped with the bot id, the bot version and the node budgets: a new bot or a new budget
   invalidates the cache instead of showing stale numbers. Like the replay store it is
   async and fail-safe; without IndexedDB the analysis simply runs again. */

"use strict";

const Analysis = (() => {
    const { $ } = Util;
    const NODES = 12000;            // win-chance budget per position (the estimator's middle stage)
    const BOT_NODES = 30000;        // the best move's search budget (a level that finishes quickly)
    const TOLERANCE = 3;            // percentage points: as good as the bot's move still counts as perfect
    const MISTAKE = 10, BLUNDER = 20;
    const MAX_PLIES = 300;          // a runaway game is analysed up to here
    const MAX_MS = 60000;           // …and never longer than this (a partial result is never cached)

    /* ================= pure computation ================= */

    const clone = (s) => JSON.parse(JSON.stringify(s));
    const clampP = (p) => Math.min(1, Math.max(0, Number(p) || 0));
    const pct = (p) => Math.round(clampP(p) * 100);
    // a probability from the seat's own point of view (the estimator always talks about seat 0)
    const forSeat = (p, seat) => (seat === 0 ? p : 1 - p);
    const recordOf = (doc) => ({ game: doc.game, config: doc.config, history: doc.history || [], outs: doc.outs || [] });

    // every position of a game, from the empty board to the end (index = ply)
    function positionsOf(rec) {
        const key = rec.game || rec.config.game;
        const state = Rules.create(rec.config, key);
        Rules.apply(key, state, [], rec.outs);            // an elimination before the first move
        const out = [clone(state)];
        for (const i of rec.history) {
            if (!Rules.apply(key, state, [i], rec.outs)) break;   // a validated document never stops early
            out.push(clone(state));
        }
        return out;
    }

    // the strongest level of a bot that still answers quickly enough for a whole game
    function levelFor(def) {
        const fits = def.difficulties.filter((d) => (d.nodes || 2000) <= BOT_NODES);
        return fits.length ? fits[fits.length - 1] : def.difficulties[0];
    }

    // the game's own bot, one instance per seat (an instance is bound to the seat it plays)
    function defaultBot(rec, players) {
        if (typeof Bots === "undefined") return null;
        const game = rec.game || rec.config.game;
        const def = Bots.botFor(game, rec.config);
        if (!def) return null;
        const level = levelFor(def);
        const nodes = Math.min(level.nodes || 2000, BOT_NODES);
        const seats = [];
        const seat = (p) => (seats[p] || (seats[p] = Bots.create(def.id, { me: p, difficulty: level.id, seed: 1, players, budget: { ms: Infinity, nodes } })));
        return { id: def.id, version: def.version || 0, nodes, move: (state) => seat(state.current).move(state) };
    }
    // the win chance, exactly the estimator the live bars use (two players only)
    function defaultEstimator(rec, players) {
        if (players !== 2 || typeof Bots === "undefined") return null;
        return Bots.estimator(rec.game || rec.config.game, rec.config);
    }

    /* Analyse a replay document / game record. Returns
       { game, players, nodes, bot: { id, version, nodes } | null, chances: [p per ply] | null,
         moves: [{ ply, player, played, best, loss, perfect }], scores: [per seat], partial }
       or null when the run was cancelled. */
    async function analyse(doc, opts = {}) {
        const rec = recordOf(doc);
        const game = rec.game || rec.config.game;
        const players = rec.config.players || 2;
        const nodes = opts.nodes || NODES;
        const estimator = "estimator" in opts ? opts.estimator : defaultEstimator(rec, players);
        const bot = "bot" in opts ? opts.bot : defaultBot(rec, players);
        const onProgress = opts.onProgress || (() => {});
        const cancelled = opts.cancelled || (() => false);
        const breathe = opts.breathe || (() => new Promise((r) => setTimeout(r, 0)));
        const until = Date.now() + (opts.maxMs || MAX_MS);
        const rules = Rules.of(game);

        const positions = positionsOf(rec);
        const plies = Math.min(positions.length - 1, MAX_PLIES);
        const steps = (estimator ? plies + 1 : 0) + (bot ? plies : 0);
        let done = 0, partial = false;
        const step = async () => { done++; onProgress(done, steps); await breathe(); };

        // 1. the win chance of every position (the graph and every loss are built from it)
        const chances = estimator ? [] : null;
        if (estimator) {
            for (let k = 0; k <= plies; k++) {
                if (cancelled()) return null;
                if (Date.now() > until) { partial = true; break; }
                chances.push(clampP(await estimator.at(positions[k], nodes)));
                await step();
            }
        }
        // 2. the bot's move at every ply, and what the played move gave away against it
        const moves = [];
        const known = chances ? chances.length - 1 : plies;      // plies we have both ends of
        if (bot) {
            for (let k = 0; k < Math.min(plies, known); k++) {
                if (cancelled()) return null;
                if (Date.now() > until) { partial = true; break; }
                const pos = positions[k];
                const player = pos.current;
                const played = rec.history[k];
                let best = null;
                try { best = await bot.move(clone(pos)); } catch (e) { best = null; }
                if (!Number.isInteger(best) || !rules.isLegal(pos, best, player)) best = null;
                let loss = null, perfect = best === null ? null : best === played;
                if (chances && best !== null) {
                    let after = chances[k + 1];
                    if (!perfect) {
                        const s = clone(pos);
                        Rules.step(rules, s, best);
                        after = clampP(await estimator.at(s, nodes));
                    }
                    loss = Math.max(0, (forSeat(after, player) - forSeat(chances[k + 1], player)) * 100);
                    if (loss <= TOLERANCE) perfect = true;
                }
                moves.push({ ply: k, player, played, best, loss, perfect });
                await step();
            }
        }
        if (!partial) onProgress(steps, steps);
        return {
            game, players, nodes, bot: bot ? { id: bot.id, version: bot.version, nodes: bot.nodes } : null,
            chances, moves, scores: scores(moves, players), partial,
        };
    }

    // one score per seat from the analysed moves (see the formula at the top of the file)
    function scores(moves, players) {
        const out = [];
        for (let p = 0; p < players; p++) {
            const rows = moves.filter((m) => m.player === p && m.perfect !== null);
            const perfect = rows.filter((m) => m.perfect).length;
            const losses = rows.filter((m) => typeof m.loss === "number").map((m) => m.loss);
            const avgLoss = losses.length ? losses.reduce((a, v) => a + v, 0) / losses.length : null;
            const accuracy = rows.length ? perfect / rows.length : null;
            let score = null;
            if (accuracy !== null) {
                const clean = avgLoss === null ? accuracy : Math.min(1, Math.max(0, 1 - avgLoss / 50));
                score = Math.round(100 * (avgLoss === null ? accuracy : 0.6 * accuracy + 0.4 * clean));
            }
            out.push({
                player: p, score, moves: rows.length, perfect, avgLoss,
                blunders: losses.filter((v) => v >= BLUNDER).length,
                mistakes: losses.filter((v) => v >= MISTAKE && v < BLUNDER).length,
            });
        }
        return out;
    }

    // how one move is judged, as text plus the class that colours it
    function verdict(m) {
        if (!m) return null;
        if (m.best === null) return { cls: "an-unknown", text: "Not analysed" };
        const drop = m.loss === null ? null : Math.round(m.loss);
        if (m.perfect) return { cls: "an-perfect", text: "Perfect move" };
        if (drop === null) return { cls: "an-mistake", text: `Best was ${m.best}` };
        if (drop >= BLUNDER) return { cls: "an-blunder", text: `Blunder: ${drop} % lost, best was ${m.best}` };
        if (drop >= MISTAKE) return { cls: "an-mistake", text: `Mistake: ${drop} % lost, best was ${m.best}` };
        return { cls: "an-inaccuracy", text: `Best was ${m.best} (${drop} % lost)` };
    }

    /* ---------- the cache (the `analysis` store next to the replays) ---------- */
    const stampOf = (res) => ({ bot: res.bot ? res.bot.id : "", version: res.bot ? res.bot.version : 0, nodes: res.nodes, botNodes: res.bot ? res.bot.nodes : 0 });
    const sameStamp = (a, b) => !!a && !!b && a.bot === b.bot && a.version === b.version && a.nodes === b.nodes && a.botNodes === b.botNodes;
    // what a fresh run of this document would be stamped with (to compare against the cache)
    function stampFor(doc) {
        const rec = recordOf(doc);
        const players = rec.config.players || 2;
        const bot = defaultBot(rec, players);
        return { bot: bot ? bot.id : "", version: bot ? bot.version : 0, nodes: NODES, botNodes: bot ? bot.nodes : 0 };
    }
    async function load(id, stamp) {
        if (!id || typeof Replays === "undefined" || !Replays.store.analysis) return null;
        const rec = await Replays.store.analysis.get(id);
        if (!rec || !sameStamp(rec.stamp, stamp)) return null;
        return rec.result;
    }
    async function store(id, result) {
        if (!id || result.partial || typeof Replays === "undefined" || !Replays.store.analysis) return false;
        return Replays.store.analysis.put(id, { stamp: stampOf(result), at: new Date().toISOString(), result });
    }

    /* ================= the panel (#replay-panel) ================= */

    const ui = {
        doc: null,          // the record on the board
        id: null,           // its replay id (the cache key)
        res: null,          // the finished analysis
        token: 0,           // bumps on every open / close: a stale run stops
        running: false,
        progress: [0, 1],
        ply: 0,
        canPlayFrom: false,
        open: false,
    };
    let seek = () => {};            // app.js: jump the board to a ply
    let playFrom = () => {};        // app.js: open a room from the shown position

    const names = () => (ui.doc && ui.doc.players) || [];
    const seatName = (p) => names()[p] || `Player ${p + 1}`;

    // start (or restart) the analysis of the open document, in the background
    async function run() {
        if (!ui.doc || ui.running) return;
        const mine = ui.token;
        ui.running = true;
        ui.progress = [0, 1];
        render();
        let res = null;
        try {
            res = await analyse(ui.doc, {
                onProgress: (d, t) => { if (mine === ui.token) { ui.progress = [d, t]; renderProgress(); } },
                cancelled: () => mine !== ui.token,
            });
        } catch (e) { res = null; }
        if (mine !== ui.token) return;
        ui.running = false;
        ui.res = res;
        if (res) store(ui.id, res);
        render();
    }

    /* Show the panel for a game record (a replay document, or the game that just ended).
       `doc` needs game, config, history, outs and the names; `canPlayFrom` offers the
       "Play from here" button. The analysis starts by itself (cached results come back at
       once) and yields to the page, so stepping stays snappy while it runs. */
    function open(doc, { canPlayFrom = false } = {}) {
        const panel = $("replay-panel");
        if (!panel) return;
        ui.token++;
        ui.doc = doc;
        ui.res = null;
        ui.running = false;
        ui.canPlayFrom = !!canPlayFrom;
        ui.progress = [0, 1];
        ui.open = true;
        ui.id = doc && typeof Replays !== "undefined" && doc.format ? Replays.idFor(doc) : null;
        panel.hidden = false;
        panel.classList.toggle("collapsed", onePane());
        render();
        const mine = ui.token;
        Promise.resolve(ui.id ? load(ui.id, stampFor(doc)) : null)
            .catch(() => null)
            .then((cached) => {
                if (mine !== ui.token) return;
                if (cached) { ui.res = cached; render(); return; }
                run();
            });
    }
    function close() {
        ui.token++;
        ui.open = false;
        ui.running = false;
        ui.doc = null;
        ui.res = null;
        const panel = $("replay-panel");
        if (panel) panel.hidden = true;
    }
    // the shown position changed: re-render and tell the caller which cell to mark (-1 = none)
    function at(ply) {
        ui.ply = ply;
        render();
        return bestAt(ply);
    }
    // the cell the bot would have played instead of the move that led to this position
    function bestAt(ply) {
        const m = moveAt(ply);
        return m && m.best !== null && !m.perfect ? m.best : -1;
    }
    const moveAt = (ply) => (ui.res && ply > 0 ? ui.res.moves[ply - 1] || null : null);

    const onePane = () => !!(window.matchMedia && window.matchMedia("(max-width: 899px)").matches);

    function renderProgress() {
        const box = $("analysis-progress");
        if (!box) return;
        const [d, t] = ui.progress;
        box.hidden = !ui.running;
        $("analysis-bar").style.width = Math.round((100 * d) / Math.max(1, t)) + "%";
        $("analysis-progress-text").textContent = ui.running ? `Analysing… ${Math.round((100 * d) / Math.max(1, t))} %` : "";
    }

    function render() {
        const panel = $("replay-panel");
        if (!panel || panel.hidden) return;
        const res = ui.res;
        $("btn-analyse").hidden = ui.running || !!res;
        $("btn-play-from-here").hidden = !ui.canPlayFrom;
        renderProgress();
        renderVerdict(res);
        renderGraph(res);
        renderScores(res);
    }

    function renderVerdict(res) {
        const line = $("an-verdict");
        const chance = $("an-chance");
        line.className = "an-verdict";
        if (!res) { line.textContent = ui.running ? "" : "Analyse this game to see the win chance and the best moves."; chance.textContent = ""; return; }
        const m = moveAt(ui.ply);
        if (!m) {
            line.textContent = ui.ply === 0 ? "Step forward to see how every move was judged." : "";
            chance.textContent = "";
        } else {
            const v = verdict(m);
            line.classList.add(v.cls);
            line.textContent = `Move ${m.ply + 1} · ${seatName(m.player)} · ${v.text}`;
            chance.textContent = res.chances ? `${seatName(0)} ${pct(res.chances[m.ply])} % → ${pct(res.chances[m.ply + 1])} %` : "";
        }
        if (res.partial) line.textContent += " (analysis stopped early)";
    }

    // the win chance over the game: one line per seat, a marker at the shown ply, click to jump
    function renderGraph(res) {
        const box = $("an-graph");
        const on = res && res.chances && res.chances.length > 1 && res.players === 2 && (typeof Prefs === "undefined" || Prefs.get().winGraph);
        box.hidden = !on;
        if (!on) { box.innerHTML = ""; return; }
        const c = res.chances, N = c.length - 1, W = 240, H = 44;
        const x = (k) => (k / N) * W;
        const y = (p) => H - clampP(p) * H;
        const line = (seat) => c.map((p, k) => `${x(k).toFixed(1)},${y(forSeat(p, seat)).toFixed(1)}`).join(" ");
        const mx = x(Math.min(ui.ply, N)).toFixed(1);
        box.innerHTML =
            `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Win chance per move">` +
            `<line class="an-mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"></line>` +
            `<polyline class="an-line an-p1" points="${line(1)}"></polyline>` +
            `<polyline class="an-line an-p0" points="${line(0)}"></polyline>` +
            `<line class="an-marker" x1="${mx}" y1="0" x2="${mx}" y2="${H}"></line></svg>`;
    }

    function renderScores(res) {
        const box = $("an-scores");
        box.innerHTML = "";
        if (!res) return;
        for (const s of res.scores) {
            if (s.score === null) continue;
            const el = document.createElement("div");
            el.className = `an-seat p${s.player}`;
            const bits = [`${s.perfect}/${s.moves} best`];
            if (s.blunders) bits.push(`${s.blunders} blunder${s.blunders > 1 ? "s" : ""}`);
            if (s.mistakes) bits.push(`${s.mistakes} mistake${s.mistakes > 1 ? "s" : ""}`);
            el.innerHTML = `<b class="an-score">${s.score}</b><span class="an-seat-name"></span><span class="an-seat-sub"></span>`;
            el.querySelector(".an-seat-name").textContent = seatName(s.player);
            el.querySelector(".an-seat-sub").textContent = bits.join(" · ");
            box.appendChild(el);
        }
    }

    // app.js wires the buttons once; the panel never touches the board itself
    function init(handlers = {}) {
        seek = handlers.onSeek || seek;
        playFrom = handlers.onPlayFrom || playFrom;
        if (!$("replay-panel")) return;
        $("btn-analyse").addEventListener("click", run);
        $("btn-play-from-here").addEventListener("click", () => playFrom(ui.ply));
        $("an-toggle").addEventListener("click", () => $("replay-panel").classList.toggle("collapsed"));
        // a click on the graph jumps to that move
        $("an-graph").addEventListener("click", (e) => {
            const res = ui.res;
            if (!res || !res.chances) return;
            const svg = $("an-graph").querySelector("svg");
            const r = (svg || $("an-graph")).getBoundingClientRect();
            if (!r.width) return;
            const N = res.chances.length - 1;
            seek(Math.round(((e.clientX - r.left) / r.width) * N));
        });
    }

    return {
        init, open, close, at, run, analyse, scores, verdict, positionsOf, stampFor, load, store,
        NODES, BOT_NODES, TOLERANCE, MISTAKE, BLUNDER, MAX_PLIES,
        get result() { return ui.res; }, get busy() { return ui.running; }, get progress() { return ui.progress.slice(); },
        get shown() { return ui.open; },
    };
})();
