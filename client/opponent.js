/* Opponent for "Against a bot" (#bot-modal). One bot per game (#21), called "Bot" wherever
   a player sees it (Opponent.NAME; Bots.botFor(game) decides which registered bot that is),
   so the modal is a single step: the bot's description and scores, the difficulty control
   (hidden with one level) and whatever parameters a bot gets in the future, with Cancel
   and Play. Nothing opens by itself: the lobby's Opponent row shows the current choice
   and opens the modal (#12). Default = the easiest difficulty; the choice is remembered
   per game in localStorage["chainreact.bots"] as { game: { id, difficulty } }. */

"use strict";

const Opponent = (() => {
    const { $ } = Util;
    const { t } = I18n;
    const KEY = "chainreact.bots";
    const NAME = () => t("bot.name");            // what a player sees wherever a bot sits
    let choices = Util.load(localStorage, KEY) || {};      // game -> { id, difficulty }
    let game = null;                                        // game the modal is open for
    let difficulty = null;                                  // difficulty being edited
    let onDone = () => {};

    const easiest = (def) => def.difficulties[0].id;          // a first game should be winnable (owner, 2026-09-13)
    const level = (def, id) => def.difficulties.find((d) => d.id === id) || def.difficulties[0];

    // the bot + difficulty for a game (and its rule variants, cfg): the remembered level if that bot
    // still has it, else the easiest
    function current(g, cfg) {
        const def = Bots.botFor(g, cfg);
        if (!def) return null;
        const saved = choices[g];
        const d = saved && saved.id === def.id && def.difficulties.some((x) => x.id === saved.difficulty) ? saved.difficulty : easiest(def);
        return { id: def.id, difficulty: d, def };
    }

    // the lobby's Opponent row: "Bot · Normal · 100 % vs Random · 100 % puzzles".
    // `choice` describes a bot somebody else picked (the room's bot, #36); without it my own.
    function summary(g, cfg, choice) {
        const c = choice && choice.id && Bots.get(choice.id) ? { ...choice, def: Bots.get(choice.id) } : current(g, cfg);
        if (!c) return t("bot.none");
        const parts = [NAME()];
        if (c.def.difficulties.length > 1) parts.push(levelName(level(c.def, c.difficulty)));
        const b = Bots.benchmarkOf(c.id, cfg);
        if (b) parts.push(t("bot.vsRandom", { pct: b.score }));
        if (b && b.puzzles) parts.push(t("bot.puzzles", { pct: b.puzzles.pct }));
        return parts.join(" · ");
    }

    // a difficulty's name in the chosen language (the definition's `label` is the English one)
    const levelName = (d) => t("level." + d.id);
    function badges(id, config) {
        const b = Bots.benchmarkOf(id, config);
        const box = $("bot-badges");
        box.innerHTML = "";
        const badge = (text, muted) => { const el = document.createElement("span"); el.className = "bot-badge" + (muted ? " muted" : ""); el.textContent = text; box.appendChild(el); };
        if (!b) { badge(t("bot.notRated"), true); return; }
        badge(t("bot.vsRandom", { pct: b.score }));
        if (b.puzzles) badge(t("bot.puzzles", { pct: b.puzzles.pct }));
    }
    const thousands = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, "\u202f");   // 2 000, 100 000

    let cfg = null;                                         // the settings the modal was opened with (rule variants)
    function render() {
        const def = current(game, cfg).def;
        $("bot-name").textContent = NAME();
        $("bot-desc").textContent = t(`bot.${def.id}.desc`);
        badges(def.id, cfg);
        const seg = $("bot-difficulty");
        seg.innerHTML = "";
        $("bot-difficulty-row").hidden = def.difficulties.length <= 1;
        for (const d of def.difficulties) {
            const btn = document.createElement("button");
            btn.textContent = levelName(d);
            btn.dataset.difficulty = d.id;
            btn.classList.toggle("selected", d.id === difficulty);
            btn.addEventListener("click", () => { difficulty = d.id; render(); });
            seg.appendChild(btn);
        }
        const lv = level(def, difficulty);
        $("bot-difficulty-hint").textContent = lv.nodes ? t("bot.levelHint", { level: levelName(lv), nodes: thousands(lv.nodes) }) : "";
    }

    // `config` = the settings the bot has to play (rule variants); `choice` = the level to
    // start from (the room's bot, #36), without it my own
    function open(g, config, choice) {
        cfg = config || null;
        const c = current(g, cfg);
        if (!c) return;                                     // no bot for this game: the lobby's Start is disabled anyway
        game = g;
        difficulty = choice && c.def.difficulties.some((d) => d.id === choice.difficulty) ? choice.difficulty : c.difficulty;
        render();
        $("bot-modal").hidden = false;
    }
    function close(save) {
        if (save && game) {
            choices[game] = { id: current(game, cfg).id, difficulty };
            Util.save(localStorage, KEY, choices);
        }
        $("bot-modal").hidden = true;
        onDone(game, !!save);                                // `save` = Play was pressed (the room's bot follows, #36)
    }

    function init(handlers) {
        onDone = handlers.onDone || onDone;
        $("btn-bot-done").addEventListener("click", () => close(true));
        $("btn-bot-cancel").addEventListener("click", () => close(false));
        $("bot-modal").addEventListener("click", (e) => { if (e.target === $("bot-modal")) close(false); });
    }

    const relabel = () => { if (game && !$("bot-modal").hidden) render(); };   // the language changed while the modal is open (#47)
    return { init, open, current, summary, relabel, get NAME() { return NAME(); } };
})();
