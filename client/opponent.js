/* Opponent picker for "Against a bot" (#bot-modal), two steps:
   1. the list: one card per bot that plays the selected game — name, one line, its two
      scores (win rate vs Random, puzzles solved) — tap a bot to open it;
   2. the bot: description, scores, the difficulty control (hidden with one level) and
      whatever parameters a bot gets in the future, with Back and Play.
   Nothing opens by itself: the lobby's Opponent row shows the current choice and opens
   the picker (#12). Default per game = the best-rated bot at its middle difficulty.
   The choice is remembered per game in localStorage["chainreact.bots"]. */

"use strict";

const Opponent = (() => {
    const { $ } = Util;
    const KEY = "chainreact.bots";
    let choices = Util.load(localStorage, KEY) || {};      // game -> { id, difficulty }
    let game = null;                                        // game the modal is open for
    let selected = null;                                    // { id, difficulty } being edited
    let onDone = () => {};

    const score = (id) => { const b = Bots.benchmarkOf(id); return b ? b.score : -1; };
    const middle = (def) => def.difficulties[Math.floor((def.difficulties.length - 1) / 2)].id;
    // best-rated bot first (a real bot beats Random's ~50 %), registration order breaks ties
    const ranked = (g) => Bots.forGame(g).slice().sort((a, b) => score(b.id) - score(a.id));
    const label = (def, difficulty) => (def.difficulties.find((d) => d.id === difficulty) || def.difficulties[0]).label;

    // the bot + difficulty for a game: the remembered choice if still valid, else the default
    function current(g) {
        const bots = ranked(g);
        if (bots.length === 0) return null;
        const saved = choices[g];
        const def = (saved && Bots.get(saved.id) && Bots.get(saved.id).game === g) ? Bots.get(saved.id) : bots[0];
        const difficulty = def.difficulties.some((d) => d.id === (saved && saved.difficulty)) ? saved.difficulty : middle(def);
        return { id: def.id, difficulty, def };
    }

    function summary(g) {
        const c = current(g);
        if (!c) return "No bot plays this game yet";
        const parts = [c.def.name];
        if (c.def.difficulties.length > 1) parts.push(label(c.def, c.difficulty));
        const b = Bots.benchmarkOf(c.id);
        if (b) parts.push(`${b.score} % vs Random`);
        if (b && b.puzzles) parts.push(`${b.puzzles.pct} % puzzles`);
        return parts.join(" · ");
    }

    /* ---------- step 1: the list ---------- */
    function scoreBadges(id) {
        const b = Bots.benchmarkOf(id);
        if (!b) return `<span class="bot-badge muted">not rated</span>`;
        return `<span class="bot-badge"><b>${b.score} %</b> vs Random</span>` + (b.puzzles ? `<span class="bot-badge"><b>${b.puzzles.pct} %</b> puzzles</span>` : "");
    }
    function renderList() {
        const list = $("bot-list");
        list.innerHTML = "";
        const bots = ranked(game);
        if (bots.length === 0) { list.innerHTML = `<div class="bot-empty">No bot plays ${Games.get(game).title} yet.</div>`; return; }
        for (const def of bots) {
            const el = document.createElement("button");
            el.className = "bot-option" + (def.id === selected.id ? " selected" : "");
            el.dataset.bot = def.id;
            el.innerHTML = `<span class="bot-main"><span class="bot-name"></span><span class="bot-desc"></span></span><span class="bot-badges">${scoreBadges(def.id)}</span><span class="chev">›</span>`;
            el.querySelector(".bot-name").textContent = def.name;
            el.querySelector(".bot-desc").textContent = def.description || "";
            el.addEventListener("click", () => {
                const keep = def.id === selected.id && def.difficulties.some((d) => d.id === selected.difficulty);
                selected = { id: def.id, difficulty: keep ? selected.difficulty : middle(def) };
                showStep("detail");
            });
            list.appendChild(el);
        }
    }

    /* ---------- step 2: one bot ---------- */
    function renderDetail() {
        const def = Bots.get(selected.id);
        $("bot-detail-name").textContent = def.name;
        $("bot-detail-desc").textContent = def.description || "";
        $("bot-detail-badges").innerHTML = scoreBadges(def.id);
        const b = Bots.benchmarkOf(def.id);
        $("bot-detail-meta").textContent = b
            ? `Rated over ${b.games} games against Random${b.puzzles ? ` and ${b.puzzles.total} solved puzzles` : ""} (${b.at}).`
            : "Not rated yet.";
        const seg = $("bot-difficulty");
        seg.innerHTML = "";
        $("bot-difficulty-row").hidden = def.difficulties.length <= 1;
        for (const d of def.difficulties) {
            const btn = document.createElement("button");
            btn.textContent = d.label;
            btn.dataset.difficulty = d.id;
            btn.classList.toggle("selected", d.id === selected.difficulty);
            btn.addEventListener("click", () => { selected.difficulty = d.id; renderDetail(); });
            seg.appendChild(btn);
        }
        const level = def.difficulties.find((d) => d.id === selected.difficulty) || def.difficulties[0];
        $("bot-difficulty-hint").textContent = level.thinkMs ? `${level.label}: thinks up to ${level.thinkMs >= 1000 ? `${level.thinkMs / 1000} s` : `${level.thinkMs} ms`} per move.` : "";
    }

    function showStep(step) {
        $("bot-step-list").hidden = step !== "list";
        $("bot-step-detail").hidden = step !== "detail";
        if (step === "list") renderList(); else renderDetail();
    }

    function open(g) {
        game = g;
        const c = current(g);
        selected = c ? { id: c.id, difficulty: c.difficulty } : { id: null, difficulty: null };
        $("bot-modal-game").textContent = Games.get(g).title;
        showStep("list");
        $("bot-modal").hidden = false;
    }
    function close(save) {
        if (save && selected && selected.id) {
            choices[game] = { id: selected.id, difficulty: selected.difficulty };
            Util.save(localStorage, KEY, choices);
        }
        $("bot-modal").hidden = true;
        onDone(game);
    }

    function init(handlers) {
        onDone = handlers.onDone || onDone;
        $("btn-bot-done").addEventListener("click", () => close(true));
        $("btn-bot-back").addEventListener("click", () => showStep("list"));
        $("btn-bot-cancel").addEventListener("click", () => close(false));
        $("bot-modal").addEventListener("click", (e) => { if (e.target === $("bot-modal")) close(false); });
    }

    return { init, open, current, summary };
})();
