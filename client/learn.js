/* Learn (#41): the offline academy. Rules, a guided tutorial and training scenarios,
   one set per game — and every bit of it comes from the game definition, so a new game
   only adds data, never code here:

     howto: {
       rules:     ["one short sentence per rule", …],                  // the details page + the lobby modal
       tutorial:  [{ text, config?, moves?, expect?, highlight? }, …], // a guided lesson on a real board
       scenarios: [{ id, title, text, config, history, toMove: 0, best: [cells], tags?,
                     tier, kind, difficulty, level, goal? }, …],
     }

   A tutorial step is a position (`config` + `moves`, replayed instantly by the engine) plus
   what to say about it. With `expect` the step waits for that click (anything else answers
   "Try the highlighted cell."), without it a Next button advances. `config` carries over
   from the step before, `highlight` defaults to `expect`.

   A scenario starts a real game against the game's bot from `history` (#44: at the level its
   `level` names, so a mastery row really is played out against a hard bot). It belongs to a
   `tier` (basics / tactics / mastery), has a `kind` and a `difficulty` 1..10:
     best-move / trap / turnaround   the FIRST move is judged against `best` (the proven
                                     optimal moves); the game then simply plays on
     play-from-here (goal: "win")    only the OUTCOME counts: you have to win the game
   Retry sets the position up again, and a solved scenario offers the next one. A tier is
   marked locked (its header muted) until the one before it is UNLOCK-solved, but nothing is
   ever blocked.
   Generated scenario sets (scripts/learn/pick-scenarios.mjs, from the proven puzzle sets)
   register themselves through Learn.scenarios(game, list) and are appended to the game's own.

   Lessons run on the normal game screen with #learn-panel in the HUD. There is no extra
   Match mode: a tutorial is a plain `local` table (every seat is this device, no clock),
   a scenario a plain `bot` table — `Learn.active` is the flag everything else checks.
   app.js stays the only screen switcher: Learn calls the `show` / `exit` handlers it gets. */

"use strict";

const Learn = (() => {
    const { $ } = Util;
    const { t } = I18n;
    const KEY = "chainreact.learn";
    const STEP_MS = 450;                 // pause after a correct click, so the move can be seen
    // the panel's hint lines (keys; MISS is what the tests look for)
    const MISS = "learn.hint.miss", READ = "learn.hint.read", ASK = "learn.hint.ask", RIGHT = "learn.hint.right", WRONG = "learn.hint.wrong", FINISHED = "learn.hint.finished";
    // play-from-here (#44): only the result of the whole game counts
    const GOAL = "learn.hint.goal", WON = "learn.hint.won", LOST = "learn.hint.lost";

    /* The ladder (#44): three tiers, four kinds of scenario. A tier opens up once UNLOCK of
       the one before it is solved, but a locked row still starts when it is tapped: the lock
       is a muted header, never a wall or a note. */
    // id, the label and the one line under it on the details page (keys)
    const TIERS = [
        { id: "basics", label: "learn.tier.basics", text: "learn.tier.basics.text" },
        { id: "tactics", label: "learn.tier.tactics", text: "learn.tier.tactics.text" },
        { id: "mastery", label: "learn.tier.mastery", text: "learn.tier.mastery.text" },
    ];
    const UNLOCK = 0.6;
    const KINDS = {
        "best-move": { icon: "target", label: "learn.kind.best-move" },       // icon names, see client/lib/icons.js
        trap: { icon: "alert", label: "learn.kind.trap" },
        turnaround: { icon: "refresh", label: "learn.kind.turnaround" },
        "play-from-here": { icon: "flag", label: "learn.kind.play-from-here" },
    };
    /* A scenario's title is a key plus a number inside its tier ("Win in one move (2)"), its
       text a list of message descriptors from the generator, or a plain key. */
    const titleOf = (sc) => (sc.no > 1 ? t("learn.title.numbered", { title: t(sc.title), n: sc.no }) : t(sc.title));
    const textOf = (sc) => (Array.isArray(sc.text) ? sc.text.map(I18n.msg).join(" ") : t(sc.text));
    const DOTS = 5;                      // difficulty 1..10 shown as five dots
    const tierOf = (id) => TIERS.find((t) => t.id === id) || TIERS[0];
    const kindOf = (id) => KINDS[id] || KINDS["best-move"];
    const dots = (difficulty) => {
        const filled = Math.max(1, Math.min(DOTS, Math.ceil(difficulty / 2)));
        return "●".repeat(filled) + "○".repeat(DOTS - filled);
    };

    const PANEL_KEY = "chainreact.learnpanel";   // "explanation folded away", this visit only (#43)

    const registered = {};               // game -> scenarios from the generated files
    let h = { show: () => {}, exit: () => {} };
    let progress = Util.load(localStorage, KEY) || {};
    let active = null;                   // the running lesson (null outside a lesson)
    let page = null;                     // the game whose details page is open
    let hint = "";                       // the transient line under the step text
    let folded = !!Util.load(sessionStorage, PANEL_KEY);   // a scenario's text hidden (#43)

    /* ---------- the data a game provides ---------- */
    /* Every scenario is filled in and sorted into its tier (#44), so a hand-written one that
       says nothing about tiers simply lands in Basics as a best-move row. */
    function normalize(sc) {
        const difficulty = Math.max(1, Math.min(10, Math.round(Number(sc.difficulty) || 3)));
        return {
            ...sc,
            tier: TIERS.some((t) => t.id === sc.tier) ? sc.tier : TIERS[0].id,
            kind: KINDS[sc.kind] ? sc.kind : "best-move",
            difficulty,
        };
    }
    function howto(game) {
        const d = Games.get(game);
        const ho = d.howto || {};
        const list = [...(ho.scenarios || []), ...(registered[d.key] || [])].map(normalize);
        // tier by tier, the order inside a tier is the one the generator wrote (easy first)
        list.sort((a, b) => TIERS.findIndex((t) => t.id === a.tier) - TIERS.findIndex((t) => t.id === b.tier));
        return {
            key: d.key,
            rules: ho.rules || [],
            tutorial: ho.tutorial || [],
            scenarios: list,
        };
    }
    const tierList = (game, tier) => howto(game).scenarios.filter((s) => s.tier === tier);
    // how far a tier is done, and whether the tier before it is done enough to open this one
    function tierProgress(game, tier) {
        const list = tierList(game, tier);
        return { solved: list.filter((s) => isSolved(game, s.id)).length, total: list.length };
    }
    function tierLocked(game, tier) {
        const k = TIERS.findIndex((t) => t.id === tier);
        if (k <= 0) return false;
        const before = tierProgress(game, TIERS[k - 1].id);
        return before.total > 0 && before.solved / before.total < UNLOCK;
    }
    /* Which tier is open on the details page: by default the first one that is not solved
       yet, and none before the tutorial is done (a game without a tutorial counts as done);
       a click on a header toggles it for this visit (`opened`, per game and tier, cleared
       whenever progress is made so the default rule decides again). */
    function tierOpen(game, tier) {
        const o = opened[game] || {};
        if (tier in o) return o[tier];
        if (howto(game).tutorial.length && !tutorialDone(game)) return false;
        const first = TIERS.find((t) => { const p = tierProgress(game, t.id); return p.total > 0 && p.solved < p.total; });
        return !!first && first.id === tier;
    }
    function toggleTier(game, tier) {
        opened[game] = opened[game] || {};
        opened[game][tier] = !tierOpen(game, tier);
    }
    // the scenario after this one (same game, ladder order), or null at the end
    function nextScenario(game, id) {
        const list = howto(game).scenarios;
        const at = list.findIndex((s) => s.id === id);
        return at >= 0 && at + 1 < list.length ? list[at + 1] : null;
    }
    const teaches = (key) => { const ho = howto(key); return ho.rules.length > 0 || ho.tutorial.length > 0 || ho.scenarios.length > 0; };
    const games = () => Games.keys().filter(teaches);
    // the generated sets call this (they are loaded after this file)
    function scenarios(game, list) { registered[game] = [...(registered[game] || []), ...list]; }

    // a complete config for a lesson position: every setting of the game at its default,
    // overridden by the lesson's own keys. Two seats, no clock — a lesson is never timed.
    function configFor(game, cfg) {
        const d = Games.get(game);
        const out = { game: d.key, n: d.size.default };
        for (const s of d.settings) out[s.key] = s.def;
        return { ...out, ...(cfg || {}), game: d.key, players: 2, timer: 0 };
    }

    /* ---------- progress (this device only) ---------- */
    const opened = {};             // tiers opened or closed by hand on the details page, per game
    const solvedIds = (game) => (progress.solved && progress.solved[game]) || [];
    const isSolved = (game, id) => solvedIds(game).includes(id);
    const tutorialDone = (game) => !!(progress.tutorials && progress.tutorials[game]);
    function store(next) { progress = next; Util.save(localStorage, KEY, progress); }
    // progress forgets the tiers opened or closed by hand (`opened`, see tierOpen), so the
    // details page opens the tier to work on next when the player comes back to it
    function markSolved(game, id) {
        if (isSolved(game, id)) return;
        store({ ...progress, solved: { ...(progress.solved || {}), [game]: [...solvedIds(game), id] } });
        delete opened[game];
    }
    function markTutorial(game) {
        if (tutorialDone(game)) return;
        store({ ...progress, tutorials: { ...(progress.tutorials || {}), [game]: true } });
        delete opened[game];
    }

    /* ---------- the board of a lesson ---------- */
    const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    // show `moves` of `cfg`; only rebuild when the position on the board is a different one
    function loadPosition(game, cfg, moves) {
        const full = configFor(game, cfg);
        const on = Match.running && Match.config && JSON.stringify(Match.config) === JSON.stringify(full) && sameList(Match.state.history, moves);
        if (on) return;
        Match.start(full, 1);                       // game 1 of this table: seat 0 always starts
        if (moves.length) Match.engine.replay(moves.slice());
    }

    /* ---------- tutorial ---------- */
    const step = () => (active && active.kind === "tutorial" && active.i < active.steps.length ? active.steps[active.i] : null);
    // a step inherits the config of the last step that named one
    function stepConfig(steps, i) {
        for (let k = i; k >= 0; k--) if (steps[k].config) return steps[k].config;
        return null;
    }

    function startTutorial(game) {
        const steps = howto(game).tutorial;
        if (!steps.length) return;
        page = game;
        Match.reset("local");                        // every seat is this device: you play both sides
        active = { kind: "tutorial", game, steps, i: 0, pending: false, hints: [] };
        showStep();
        h.show("game");
        sizeText();                                  // now the panel has its real width
    }

    function showStep() {
        hint = "";
        const done = active.i >= active.steps.length;
        active.hints = [];
        if (!done) {
            const s = active.steps[active.i];
            active.hints = s.highlight || s.expect || [];
            loadPosition(active.game, stepConfig(active.steps, active.i), s.moves || []);
        }
        Match.engine.render();                       // repaint the highlighted cells
        render();
        sizeText();                                  // the step text keeps the panel's height (#43)
    }

    // the panel's Next button: one step on in a tutorial, the next scenario after a solved one
    function advance() {
        if (!active) return;
        if (active.kind !== "tutorial") { nextOne(); return; }
        active.i++;
        if (active.i >= active.steps.length) markTutorial(active.game);
        showStep();
    }

    // a click on the board while a lesson runs: a tutorial only takes the expected cell
    function beforeMove(i) {
        if (!active || active.kind !== "tutorial") return true;
        const s = step();
        if (!s) return false;
        if (!s.expect) { say(t(READ)); return false; }
        if (!s.expect.includes(i)) { say(t(MISS)); return false; }
        return true;
    }
    // the highlight the engine paints on a cell (through Match's cellClass hook)
    const cellClass = (i) => (active && active.hints.includes(i) ? "hint" : "");

    function say(text) { hint = text; render(); }

    // the expected move settled: step on (never inside the engine's own call stack)
    Bus.on("game:position", () => {
        if (!active || active.kind !== "tutorial" || !active.pending || Match.state.busy) return;
        const lesson = active;
        lesson.pending = false;
        setTimeout(() => { if (active === lesson) advance(); }, STEP_MS);
    });

    /* ---------- scenario ---------- */
    /* The table a scenario plays on: the position's own config plus the bot the tier asks for
       (#44). `config.bot` is the same door the room's bot uses, so Match needs no idea of
       Learn; a level the bot does not have (or no bot at all) simply falls back to the one
       the player picked in the Opponent modal. */
    function scenarioConfig(game, sc) {
        const cfg = { ...(sc.config || {}) };
        const def = Bots.botFor(game, configFor(game, cfg));
        const level = def && (def.difficulties.find((d) => d.id === sc.level) || null);
        if (def && level) cfg.bot = { id: def.id, difficulty: level.id, seat: 1 };
        return cfg;
    }
    const isGoal = (sc) => sc.goal === "win" || sc.kind === "play-from-here";
    function startScenario(game, id) {
        const sc = howto(game).scenarios.find((s) => s.id === id);
        if (!sc) return;
        page = game;
        Match.reset("bot");                          // you are seat 0, the game's bot is seat 1
        active = { kind: "scenario", game, scenario: sc, judged: false, result: "", won: false, hints: [] };
        loadPosition(game, scenarioConfig(game, sc), sc.history || []);
        render();
        h.show("game");
    }
    /* A move this device really plays (Match calls it right before engine.play). In a
       tutorial that is the expected click, so the step may step on once it settled; in a
       scenario the first one is the answer and the game then simply plays on. A
       play-from-here scenario judges nothing here: only the result of the game counts. */
    function onLocalMove(i) {
        if (!active) return;
        if (active.kind === "tutorial") { active.pending = true; hint = ""; return; }
        if (active.judged || isGoal(active.scenario)) return;
        active.judged = true;
        active.result = (active.scenario.best || []).includes(i) ? "right" : "wrong";
        if (active.result === "right") markSolved(active.game, active.scenario.id);
        render();
    }

    /* The game a scenario runs in ended (#44): a play-from-here scenario is solved exactly
       when you won it; for the others winning the game is a bonus on top of the right move. */
    Bus.on("game:finish", (e) => {
        if (!active || active.kind !== "scenario") return;
        const sc = active.scenario;
        const won = e && e.winner === 0;
        if (isGoal(sc)) {
            active.judged = true;
            active.result = won ? "right" : "wrong";
            if (won) markSolved(active.game, sc.id);
        } else if (won) active.won = true;
        render();
    });

    /* ---------- lesson lifecycle ---------- */
    function restart() {
        if (!active) return;
        if (active.kind === "tutorial") startTutorial(active.game);
        else { const { game, scenario } = active; active = null; startScenario(game, scenario.id); }
    }
    // is this scenario done, so the ladder can offer the one after it?
    const solvedNow = () => !!active && active.kind === "scenario" && isSolved(active.game, active.scenario.id);
    const canAdvance = () => !!(solvedNow() && nextScenario(active.game, active.scenario.id));
    // the next scenario of the ladder (the panel's Next and the overlay's primary button)
    function nextOne() {
        if (!canAdvance()) return;
        const { game, scenario } = active;
        const next = nextScenario(game, scenario.id);
        active = null;
        startScenario(game, next.id);
    }
    /* What the result overlay's primary button does inside a lesson (app.js asks): the next
       scenario once this one is solved, otherwise simply set it up again. */
    const againText = () => t(canAdvance() ? "learn.nextScenario" : active && active.kind === "scenario" ? "common.retry" : "learn.startOver");
    const again = () => { if (canAdvance()) nextOne(); else restart(); };
    // leave a running lesson for the game's details page (the panel button, the HUD, the overlay)
    function exit() {
        if (!active) return;
        page = active.game;
        active = null;
        Match.stop();
        $("learn-panel").hidden = true;
        document.body.classList.remove("learn", "learn-tutorial");
        renderGame();
        h.exit();
    }
    /* Seat names inside a lesson (app.js asks with the names it would use otherwise).
       A tutorial has nobody at the other seat, so it is simply "Opponent"; a scenario is a
       real game against the bot and Match already renames that seat to "Bot". You keep your
       own name in both, so every log line still reads properly. */
    const names = (base) => (active && active.kind === "tutorial" ? [base[0], t("learn.opponent"), ...base.slice(2)] : null);

    /* ---------- the panel in the HUD ---------- */
    /* Fold a scenario's explanation away (#43). Remembered for this visit, so it stays
       folded from one scenario to the next; a tutorial is always unfolded (its text is
       the lesson). */
    function fold(on) {
        folded = !!on;
        Util.save(sessionStorage, PANEL_KEY, folded);
        render();
    }
    /* A tutorial must not move the board when a step is longer than the one before (#43):
       the text keeps the height of the longest step of this lesson. Measured on the real
       element, so it is right for any width, and re-measured on every step (a rotation
       changes it). */
    function sizeText() {
        const el = $("learn-text");
        el.style.minHeight = "";
        if (!active || active.kind !== "tutorial") return;
        const keep = el.textContent;
        let max = 0;
        for (const text of [...active.steps.map((s) => t(s.text)), t(FINISHED)]) {
            el.textContent = text;
            max = Math.max(max, el.scrollHeight);
        }
        el.textContent = keep;
        el.style.minHeight = max + "px";
    }

    function render() {
        const panel = $("learn-panel");
        panel.hidden = !active;
        document.body.classList.toggle("learn", !!active);
        // a tutorial is about the mechanics: no win chance flickering next to the steps
        document.body.classList.toggle("learn-tutorial", !!active && active.kind === "tutorial");
        const toggle = $("learn-hide");
        // the fold is a scenario's, so a tutorial always shows its step
        const foldable = !!active && active.kind === "scenario";
        toggle.hidden = !foldable;
        toggle.textContent = t(folded ? "common.show" : "common.hide");
        panel.classList.toggle("folded", foldable && folded);
        if (!active) return;
        const title = Games.title(active.game);
        const next = $("learn-next");
        const back = $("learn-back");
        if (active.kind === "tutorial") {
            $("overlay").hidden = true;               // the panel tells the story, not the result card
            const done = active.i >= active.steps.length;
            $("learn-kind").textContent = t("learn.kindTutorial", { game: title });
            $("learn-step").textContent = done ? t("learn.stepDone") : t("learn.step", { step: active.i + 1, total: active.steps.length });
            $("learn-text").textContent = t(done ? FINISHED : active.steps[active.i].text);
            next.hidden = done || !!active.steps[active.i].expect;
            next.textContent = t(active.i === active.steps.length - 1 ? "learn.finish" : "common.next");
            $("learn-retry").textContent = t("learn.startOver");
            $("learn-hint").textContent = hint;
            $("learn-hint").className = "learn-hint" + (hint ? " bad" : "");
            back.classList.toggle("primary", done);
        } else {
            const sc = active.scenario;
            const goal = isGoal(sc);
            $("learn-kind").textContent = `${t(tierOf(sc.tier).label)} · ${t(kindOf(sc.kind).label)}`;
            $("learn-step").textContent = dots(sc.difficulty);
            $("learn-text").textContent = `${titleOf(sc)}. ${textOf(sc)}`;
            next.hidden = !canAdvance();
            next.textContent = t("learn.nextScenario");
            $("learn-retry").textContent = t("common.retry");
            $("learn-hint").textContent = goal
                ? t(active.result === "right" ? WON : active.result === "wrong" ? LOST : GOAL)
                : (active.result === "right" ? (active.won ? `${t(RIGHT)} ${t(WON)}` : t(RIGHT)) : t(active.result === "wrong" ? WRONG : ASK));
            $("learn-hint").className = "learn-hint " + (active.result || "ask");
            back.classList.remove("primary");
        }
    }

    // the language changed (#47): the list, the open details page and the lesson panel, in the new words
    function relabel() {
        renderList();
        if (page) renderGame();
        sizeText();
        render();
    }

    /* ---------- the two Learn screens ---------- */
    function open() {
        renderList();
        h.show("learn");
    }
    function renderList() {
        const box = $("learn-games");
        box.innerHTML = "";
        for (const key of games()) {
            const d = Games.get(key);
            const ho = howto(key);
            const solved = ho.scenarios.filter((s) => isSolved(key, s.id)).length;
            const card = document.createElement("button");
            card.className = "game-card";
            card.dataset.game = key;
            card.innerHTML = `<span class="game-name"></span><span class="game-desc"></span><span class="game-players"></span>`;
            card.prepend(Games.previewTile(key));
            card.querySelector(".game-name").textContent = t(d.title);
            card.querySelector(".game-desc").textContent = t(d.desc);
            card.querySelector(".game-players").textContent = ho.scenarios.length ? t("learn.cardScenarios", { solved, total: ho.scenarios.length }) : t("learn.cardRules");
            card.addEventListener("click", () => openGame(key));
            box.appendChild(card);
        }
    }

    function openGame(game) {
        page = Games.get(game).key;
        renderGame();
        h.show("learn-game");
    }
    function renderGame() {
        const d = Games.get(page);
        const ho = howto(page);
        $("learn-title").textContent = t(d.title);
        $("learn-tagline").textContent = t(d.tagline);
        bullets($("learn-rules"), ho.rules);
        $("learn-tutorial-group").hidden = ho.tutorial.length === 0;
        $("learn-tutorial-hint").textContent = tutorialDone(page) ? t("learn.tutorialDone") : t("learn.tutorialSteps", { count: ho.tutorial.length });
        const solved = ho.scenarios.filter((s) => isSolved(page, s.id)).length;
        $("learn-scenarios-group").hidden = ho.scenarios.length === 0;
        $("learn-progress").textContent = ho.scenarios.length ? t("learn.solved", { solved, total: ho.scenarios.length }) : "";
        // one block per tier (#44): a header with the tier's progress and, while the tier
        // before it is not solved enough, a hint that it is meant for later
        const box = $("learn-scenarios");
        box.innerHTML = "";
        for (const tier of TIERS) {
            const list = tierList(page, tier.id);
            if (!list.length) continue;
            const done = tierProgress(page, tier.id);
            const locked = tierLocked(page, tier.id);
            const open = tierOpen(page, tier.id);
            // one card per tier; its header is a button that folds the tier's rows away
            // (collapsed by default, see tierOpen), so the ladder reads as three cards until
            // one is opened
            const card = document.createElement("div");
            card.className = "learn-tier-box" + (open ? " open" : "");
            card.dataset.tier = tier.id;
            const head = document.createElement("button");
            head.type = "button";
            head.className = "learn-tier" + (locked ? " locked" : "") + (open ? " open" : "");
            head.dataset.tier = tier.id;
            head.setAttribute("aria-expanded", open ? "true" : "false");
            head.innerHTML = `<span class="learn-chev">›</span><b></b><span class="learn-tier-count"></span><small class="learn-tier-text"></small>`;
            head.querySelector("b").textContent = t(tier.label);
            head.querySelector(".learn-tier-count").textContent = `${done.solved} / ${done.total}`;
            head.querySelector(".learn-tier-text").textContent = t(tier.text);   // every tier says what it holds
            head.addEventListener("click", () => { toggleTier(page, tier.id); renderGame(); });
            card.appendChild(head);
            for (const sc of list) { const row = scenarioRow(sc); row.hidden = !open; card.appendChild(row); }
            box.appendChild(card);
        }
    }
    function scenarioRow(sc) {
        const solved = isSolved(page, sc.id);
        const kind = kindOf(sc.kind);
        const row = document.createElement("button");
        row.className = "settings-summary learn-scenario";
        row.dataset.scenario = sc.id;
        row.dataset.kind = sc.kind;
        row.innerHTML = `<span class="gear-icon"></span><span class="learn-sc-text"><b></b><small></small></span><span class="learn-dots"></span><span class="chev">›</span>`;
        Icons.set(row.querySelector(".gear-icon"), solved ? "check" : kind.icon);
        row.querySelector(".gear-icon").className = "gear-icon" + (solved ? " solved" : "");
        row.querySelector("b").textContent = titleOf(sc);
        row.querySelector("small").textContent = t(kind.label);
        row.querySelector(".learn-dots").textContent = dots(sc.difficulty);
        row.querySelector(".learn-dots").title = t("learn.difficulty", { d: sc.difficulty });
        row.addEventListener("click", () => startScenario(page, sc.id));
        return row;
    }
    function bullets(box, list) {
        box.innerHTML = "";
        for (const text of list) {
            const li = document.createElement("li");
            li.textContent = t(text);
            box.appendChild(li);
        }
    }

    /* ---------- "How to play" in the room lobby (reading only) ---------- */
    function openHowto(game) {
        const d = Games.get(game);
        const ho = howto(game);
        $("howto-title").textContent = t(d.title);
        $("howto-tagline").textContent = t(d.tagline);
        bullets($("howto-rules"), ho.rules);
        const steps = $("howto-steps");
        steps.innerHTML = "";
        for (const s of ho.tutorial) {
            const li = document.createElement("li");
            li.textContent = t(s.text);
            steps.appendChild(li);
        }
        $("howto-steps-title").hidden = ho.tutorial.length === 0;
        steps.hidden = ho.tutorial.length === 0;
        $("howto-modal").hidden = false;
    }
    const closeHowto = () => { $("howto-modal").hidden = true; };

    function init(handlers) {
        h = { ...h, ...handlers };
        $("learn-next").addEventListener("click", advance);
        $("learn-retry").addEventListener("click", restart);
        $("learn-back").addEventListener("click", exit);
        $("learn-hide").addEventListener("click", () => fold(!folded));
        window.addEventListener("resize", () => { if (active && active.kind === "tutorial") sizeText(); });
        $("btn-learn-tutorial").addEventListener("click", () => startTutorial(page));
        $("btn-howto-done").addEventListener("click", closeHowto);
        $("howto-modal").addEventListener("click", (e) => { if (e.target === $("howto-modal")) closeHowto(); });
    }

    return {
        init, open, openGame, startTutorial, startScenario, restart, exit, names, relabel,
        howto, scenarios, games, configFor, beforeMove, cellClass, onLocalMove, openHowto, closeHowto,
        isSolved, markSolved, tutorialDone, fold, tierProgress, tierLocked, tierOpen, toggleTier, nextScenario, again, againText, canAdvance,
        get active() { return active; }, get page() { return page; }, get folded() { return folded; },
        STEP_MS, MISS, TIERS, KINDS, UNLOCK, dots, titleOf, textOf,
    };
})();
