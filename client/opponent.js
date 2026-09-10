/* Opponent for "Against a bot" (#bot-modal). One bot per game (#21), called "Bot" wherever
   a player sees it (Opponent.NAME; Bots.botFor(game) decides which registered bot that is),
   so the modal is a single step: the bot's description and scores, the difficulty control
   (hidden with one level) and whatever parameters a bot gets in the future, with Cancel
   and Play. Nothing opens by itself: the lobby's Opponent row shows the current choice
   and opens the modal (#12). Default = the middle difficulty; the choice is remembered
   per game in localStorage["chainreact.bots"] as { game: { id, difficulty } }. */

"use strict";

const Opponent = (() => {
    const { $ } = Util;
    const KEY = "chainreact.bots";
    const NAME = "Bot";
    let choices = Util.load(localStorage, KEY) || {};      // game -> { id, difficulty }
    let game = null;                                        // game the modal is open for
    let difficulty = null;                                  // difficulty being edited
    let onDone = () => {};

    const middle = (def) => def.difficulties[Math.floor((def.difficulties.length - 1) / 2)].id;
    const level = (def, id) => def.difficulties.find((d) => d.id === id) || def.difficulties[0];

    // the bot + difficulty for a game (and its rule variants, cfg): the remembered level if that bot
    // still has it, else the middle one
    function current(g, cfg) {
        const def = Bots.botFor(g, cfg);
        if (!def) return null;
        const saved = choices[g];
        const d = saved && saved.id === def.id && def.difficulties.some((x) => x.id === saved.difficulty) ? saved.difficulty : middle(def);
        return { id: def.id, difficulty: d, def };
    }

    // the lobby's Opponent row: "Bot · Normal · 100 % vs Random · 100 % puzzles"
    function summary(g, cfg) {
        const c = current(g, cfg);
        if (!c) return "No bot plays this game yet";
        const parts = [NAME];
        if (c.def.difficulties.length > 1) parts.push(level(c.def, c.difficulty).label);
        const b = Bots.benchmarkOf(c.id);
        if (b) parts.push(`${b.score} % vs Random`);
        if (b && b.puzzles) parts.push(`${b.puzzles.pct} % puzzles`);
        return parts.join(" · ");
    }

    function badges(id) {
        const b = Bots.benchmarkOf(id);
        if (!b) return `<span class="bot-badge muted">not rated</span>`;
        return `<span class="bot-badge"><b>${b.score} %</b> vs Random</span>` + (b.puzzles ? `<span class="bot-badge"><b>${b.puzzles.pct} %</b> puzzles</span>` : "");
    }
    const thousands = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, "\u202f");   // 2 000, 100 000

    let cfg = null;                                         // the settings the modal was opened with (rule variants)
    function render() {
        const def = current(game, cfg).def;
        $("bot-name").textContent = NAME;
        $("bot-desc").textContent = def.description || "";
        $("bot-badges").innerHTML = badges(def.id);
        const seg = $("bot-difficulty");
        seg.innerHTML = "";
        $("bot-difficulty-row").hidden = def.difficulties.length <= 1;
        for (const d of def.difficulties) {
            const btn = document.createElement("button");
            btn.textContent = d.label;
            btn.dataset.difficulty = d.id;
            btn.classList.toggle("selected", d.id === difficulty);
            btn.addEventListener("click", () => { difficulty = d.id; render(); });
            seg.appendChild(btn);
        }
        const lv = level(def, difficulty);
        $("bot-difficulty-hint").textContent = lv.nodes ? `${lv.label}: searches up to ${thousands(lv.nodes)} positions per move.` : "";
    }

    function open(g, config) {
        cfg = config || null;
        const c = current(g, cfg);
        if (!c) return;                                     // no bot for this game: the lobby's Start is disabled anyway
        game = g;
        difficulty = c.difficulty;
        render();
        $("bot-modal").hidden = false;
    }
    function close(save) {
        if (save && game) {
            choices[game] = { id: current(game, cfg).id, difficulty };
            Util.save(localStorage, KEY, choices);
        }
        $("bot-modal").hidden = true;
        onDone(game);
    }

    function init(handlers) {
        onDone = handlers.onDone || onDone;
        $("btn-bot-done").addEventListener("click", () => close(true));
        $("btn-bot-cancel").addEventListener("click", () => close(false));
        $("bot-modal").addEventListener("click", (e) => { if (e.target === $("bot-modal")) close(false); });
    }

    return { init, open, current, summary, NAME };
})();
