/* Learn (#41): the offline academy. Rules, a guided tutorial and training scenarios,
   one set per game — and every bit of it comes from the game definition, so a new game
   only adds data, never code here:

     howto: {
       rules:     ["one short sentence per rule", …],                  // the details page + the lobby modal
       tutorial:  [{ text, config?, moves?, expect?, highlight? }, …], // a guided lesson on a real board
       scenarios: [{ id, title, text, config, history, toMove: 0, best: [cells], tags? }, …],
     }

   A tutorial step is a position (`config` + `moves`, replayed instantly by the engine) plus
   what to say about it. With `expect` the step waits for that click (anything else answers
   "Try the highlighted cell."), without it a Next button advances. `config` carries over
   from the step before, `highlight` defaults to `expect`.
   A scenario starts a real game against the game's bot from `history` and judges the first
   move against `best` (the proven optimal moves); Retry sets the position up again.
   Generated scenario sets (scripts/learn/pick-scenarios.mjs, from the proven puzzle sets)
   register themselves through Learn.scenarios(game, list) and are appended to the game's own.

   Lessons run on the normal game screen with #learn-panel in the HUD. There is no extra
   Match mode: a tutorial is a plain `local` table (every seat is this device, no clock),
   a scenario a plain `bot` table — `Learn.active` is the flag everything else checks.
   app.js stays the only screen switcher: Learn calls the `show` / `exit` handlers it gets. */

"use strict";

const Learn = (() => {
    const { $ } = Util;
    const KEY = "chainreact.learn";
    const STEP_MS = 450;                 // pause after a correct click, so the move can be seen
    const MISS = "Try the highlighted cell.";
    const READ = "Read the step, then press Next.";
    const ASK = "Your move: find the best one.";
    const RIGHT = "Right! Play the position out, or go back to Learn.";
    const WRONG = "Not this one. Press Retry to set the position up again.";
    const FINISHED = "That is everything. Try a scenario, or start a game.";

    const registered = {};               // game -> scenarios from the generated files
    let h = { show: () => {}, exit: () => {} };
    let progress = Util.load(localStorage, KEY) || {};
    let active = null;                   // the running lesson (null outside a lesson)
    let page = null;                     // the game whose details page is open
    let hint = "";                       // the transient line under the step text

    /* ---------- the data a game provides ---------- */
    function howto(game) {
        const d = Games.get(game);
        const ho = d.howto || {};
        return {
            key: d.key,
            rules: ho.rules || [],
            tutorial: ho.tutorial || [],
            scenarios: [...(ho.scenarios || []), ...(registered[d.key] || [])],
        };
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
        for (const s of d.settings) {
            out[s.key] = s.def;
            if (s.with) out[s.with.key] = s.with.def;
        }
        return { ...out, ...(cfg || {}), game: d.key, players: 2, timer: 0 };
    }

    /* ---------- progress (this device only) ---------- */
    const solvedIds = (game) => (progress.solved && progress.solved[game]) || [];
    const isSolved = (game, id) => solvedIds(game).includes(id);
    const tutorialDone = (game) => !!(progress.tutorials && progress.tutorials[game]);
    function store(next) { progress = next; Util.save(localStorage, KEY, progress); }
    function markSolved(game, id) {
        if (isSolved(game, id)) return;
        store({ ...progress, solved: { ...(progress.solved || {}), [game]: [...solvedIds(game), id] } });
    }
    function markTutorial(game) {
        if (tutorialDone(game)) return;
        store({ ...progress, tutorials: { ...(progress.tutorials || {}), [game]: true } });
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
    }

    function advance() {
        if (!active || active.kind !== "tutorial") return;
        active.i++;
        if (active.i >= active.steps.length) markTutorial(active.game);
        showStep();
    }

    // a click on the board while a lesson runs: a tutorial only takes the expected cell
    function beforeMove(i) {
        if (!active || active.kind !== "tutorial") return true;
        const s = step();
        if (!s) return false;
        if (!s.expect) { say(READ); return false; }
        if (!s.expect.includes(i)) { say(MISS); return false; }
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
    function startScenario(game, id) {
        const sc = howto(game).scenarios.find((s) => s.id === id);
        if (!sc) return;
        page = game;
        Match.reset("bot");                          // you are seat 0, the game's bot is seat 1
        active = { kind: "scenario", game, scenario: sc, judged: false, result: "", hints: [] };
        loadPosition(game, sc.config, sc.history || []);
        render();
        h.show("game");
    }
    /* A move this device really plays (Match calls it right before engine.play). In a
       tutorial that is the expected click, so the step may step on once it settled; in a
       scenario the first one is the answer and the game then simply plays on. */
    function onLocalMove(i) {
        if (!active) return;
        if (active.kind === "tutorial") { active.pending = true; hint = ""; return; }
        if (active.judged) return;
        active.judged = true;
        active.result = active.scenario.best.includes(i) ? "right" : "wrong";
        if (active.result === "right") markSolved(active.game, active.scenario.id);
        render();
    }

    /* ---------- lesson lifecycle ---------- */
    function restart() {
        if (!active) return;
        if (active.kind === "tutorial") startTutorial(active.game);
        else { const { game, scenario } = active; active = null; startScenario(game, scenario.id); }
    }
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
    const names = (base) => (active && active.kind === "tutorial" ? [base[0], "Opponent", ...base.slice(2)] : null);

    /* ---------- the panel in the HUD ---------- */
    function render() {
        const panel = $("learn-panel");
        panel.hidden = !active;
        document.body.classList.toggle("learn", !!active);
        // a tutorial is about the mechanics: no win chance flickering next to the steps
        document.body.classList.toggle("learn-tutorial", !!active && active.kind === "tutorial");
        if (!active) return;
        const title = Games.get(active.game).title;
        const next = $("learn-next");
        const back = $("learn-back");
        if (active.kind === "tutorial") {
            $("overlay").hidden = true;               // the panel tells the story, not the result card
            const done = active.i >= active.steps.length;
            $("learn-kind").textContent = `${title} tutorial`;
            $("learn-step").textContent = done ? "Done" : `Step ${active.i + 1} / ${active.steps.length}`;
            $("learn-text").textContent = done ? FINISHED : active.steps[active.i].text;
            next.hidden = done || !!active.steps[active.i].expect;
            next.textContent = active.i === active.steps.length - 1 ? "Finish" : "Next";
            $("learn-retry").textContent = "Start over";
            $("learn-hint").textContent = hint;
            $("learn-hint").className = "learn-hint" + (hint ? " bad" : "");
            back.classList.toggle("primary", done);
        } else {
            const sc = active.scenario;
            $("learn-kind").textContent = `${title} scenario`;
            $("learn-step").textContent = (sc.tags || []).join(" · ");
            $("learn-text").textContent = `${sc.title}. ${sc.text}`;
            next.hidden = true;
            $("learn-retry").textContent = "Retry";
            $("learn-hint").textContent = active.result === "right" ? RIGHT : active.result === "wrong" ? WRONG : ASK;
            $("learn-hint").className = "learn-hint " + (active.result || "ask");
            back.classList.remove("primary");
        }
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
            const tiles = [...d.preview].map((ch) => `<i${/\d/.test(ch) ? ` class="p${ch}"` : ""}></i>`).join("");
            card.innerHTML = `<span class="game-preview ${key}">${tiles}</span><span class="game-name"></span><span class="game-desc"></span><span class="game-players"></span>`;
            card.querySelector(".game-name").textContent = d.title;
            card.querySelector(".game-desc").textContent = d.desc;
            card.querySelector(".game-players").textContent = ho.scenarios.length ? `${solved} / ${ho.scenarios.length} scenarios` : "rules and tutorial";
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
        $("learn-title").textContent = d.title;
        $("learn-tagline").textContent = d.tagline;
        bullets($("learn-rules"), ho.rules);
        $("learn-tutorial-group").hidden = ho.tutorial.length === 0;
        $("learn-tutorial-hint").textContent = tutorialDone(page)
            ? "You finished this tutorial. Run it again any time."
            : `${ho.tutorial.length} steps on a real board.`;
        const solved = ho.scenarios.filter((s) => isSolved(page, s.id)).length;
        $("learn-scenarios-group").hidden = ho.scenarios.length === 0;
        $("learn-progress").textContent = ho.scenarios.length ? `${solved} / ${ho.scenarios.length} solved` : "";
        const box = $("learn-scenarios");
        box.innerHTML = "";
        ho.scenarios.forEach((sc) => {
            const row = document.createElement("button");
            row.className = "settings-summary learn-scenario";
            row.dataset.scenario = sc.id;
            row.innerHTML = `<span class="gear-icon"></span><span class="learn-sc-text"><b></b><small></small></span><span class="chev">›</span>`;
            row.querySelector(".gear-icon").textContent = isSolved(page, sc.id) ? "✓" : "•";
            row.querySelector(".gear-icon").className = "gear-icon" + (isSolved(page, sc.id) ? " solved" : "");
            row.querySelector("b").textContent = sc.title;
            row.querySelector("small").textContent = (sc.tags || []).join(" · ");
            row.addEventListener("click", () => startScenario(page, sc.id));
            box.appendChild(row);
        });
    }
    function bullets(box, list) {
        box.innerHTML = "";
        for (const text of list) {
            const li = document.createElement("li");
            li.textContent = text;
            box.appendChild(li);
        }
    }

    /* ---------- "How to play" in the room lobby (reading only) ---------- */
    function openHowto(game) {
        const d = Games.get(game);
        const ho = howto(game);
        $("howto-title").textContent = d.title;
        $("howto-tagline").textContent = d.tagline;
        bullets($("howto-rules"), ho.rules);
        const steps = $("howto-steps");
        steps.innerHTML = "";
        for (const s of ho.tutorial) {
            const li = document.createElement("li");
            li.textContent = s.text;
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
        $("btn-learn-tutorial").addEventListener("click", () => startTutorial(page));
        $("btn-howto-done").addEventListener("click", closeHowto);
        $("howto-modal").addEventListener("click", (e) => { if (e.target === $("howto-modal")) closeHowto(); });
    }

    return {
        init, open, openGame, startTutorial, startScenario, restart, exit, names,
        howto, scenarios, games, configFor, beforeMove, cellClass, onLocalMove, openHowto, closeHowto,
        isSolved, tutorialDone,
        get active() { return active; }, get page() { return page; },
        STEP_MS, MISS,
    };
})();
