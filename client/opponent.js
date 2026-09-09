/* Opponent picker for "Play against a bot": the #bot-modal lists the bots that play the
   selected game (name, description, baked-in benchmark score), a difficulty control per
   bot, and remembers the choice per game in localStorage. app.js asks current(game) when
   it starts a game with a bot seat. */

"use strict";

const Opponent = (() => {
    const { $ } = Util;
    const KEY = "chainreact.bots";
    let choices = Util.load(localStorage, KEY) || {};      // game -> { id, difficulty }
    let game = null;                                        // game the modal is open for
    let selected = null;                                    // { id, difficulty } being edited
    let onChange = () => {};
    let onDone = () => {};

    // the bot + difficulty for a game (first registered bot of that game if nothing was chosen)
    function current(g) {
        const bots = Bots.forGame(g);
        if (bots.length === 0) return null;
        const saved = choices[g];
        const def = (saved && Bots.get(saved.id) && Bots.get(saved.id).game === g) ? Bots.get(saved.id) : bots[0];
        const difficulty = def.difficulties.some((d) => d.id === (saved && saved.difficulty)) ? saved.difficulty : def.difficulties[0].id;
        return { id: def.id, difficulty, def };
    }

    function summary(g) {
        const c = current(g);
        if (!c) return "No bot plays this game yet";
        const parts = [c.def.name];
        if (c.def.difficulties.length > 1) parts.push(c.def.difficulties.find((d) => d.id === c.difficulty).label);
        const b = Bots.benchmarkOf(c.id);
        if (b) parts.push(`${b.score} % vs Random`);
        return parts.join(" · ");
    }

    function renderList() {
        const list = $("bot-list");
        list.innerHTML = "";
        const bots = Bots.forGame(game);
        if (bots.length === 0) {
            list.innerHTML = `<div class="bot-empty">No bot plays ${Games.get(game).title} yet.</div>`;
            $("bot-difficulty-row").hidden = true;
            $("btn-bot-done").disabled = true;
            return;
        }
        $("btn-bot-done").disabled = false;
        for (const def of bots) {
            const el = document.createElement("button");
            el.className = "bot-option" + (def.id === selected.id ? " selected" : "");
            el.dataset.bot = def.id;
            const b = Bots.benchmarkOf(def.id);
            el.innerHTML = `<span class="bot-name"></span><span class="bot-score">${b ? `<b>${b.score} %</b>vs Random` : "not rated"}</span><span class="bot-desc"></span>`;
            el.querySelector(".bot-name").textContent = def.name;
            el.querySelector(".bot-desc").textContent = def.description || "";
            el.title = b ? `Win rate against the Random bot over ${b.games} games (${b.at})` : "No benchmark yet";
            el.addEventListener("click", () => { selected = { id: def.id, difficulty: def.difficulties[0].id }; renderList(); });
            list.appendChild(el);
        }
        renderDifficulty();
    }

    function renderDifficulty() {
        const def = Bots.get(selected.id);
        const seg = $("bot-difficulty");
        seg.innerHTML = "";
        $("bot-difficulty-row").hidden = def.difficulties.length <= 1;
        for (const d of def.difficulties) {
            const b = document.createElement("button");
            b.textContent = d.label;
            b.dataset.difficulty = d.id;
            b.classList.toggle("selected", d.id === selected.difficulty);
            b.addEventListener("click", () => { selected.difficulty = d.id; renderDifficulty(); });
            seg.appendChild(b);
        }
    }

    function open(g) {
        game = g;
        const c = current(g);
        selected = c ? { id: c.id, difficulty: c.difficulty } : { id: null, difficulty: null };
        $("bot-modal-game").textContent = Games.get(g).title;
        renderList();
        $("bot-modal").hidden = false;
    }
    function close(save) {
        if (save && selected && selected.id) {
            choices[game] = { id: selected.id, difficulty: selected.difficulty };
            Util.save(localStorage, KEY, choices);
            onChange(game);
        }
        $("bot-modal").hidden = true;
        onDone(game);
    }

    function init(handlers) {
        onChange = handlers.onChange || onChange;
        onDone = handlers.onDone || onDone;
        $("btn-bot-done").addEventListener("click", () => close(true));
        $("bot-modal").addEventListener("click", (e) => { if (e.target === $("bot-modal")) close(true); });
    }

    return { init, open, current, summary };
})();
