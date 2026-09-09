/* Game choice + settings: the form in #settings-modal, the picker cards in the lobby,
   persistence in localStorage, and the config object a game is started with.
   Which rows a game shows comes from its registry entry (`settings: [...]`, matched
   against the rows' data-setting attribute); board-size limits from `size`/`minSize`.
   Any change calls onChange(config) so the room can mirror it to the friend. */

"use strict";

const Settings = (() => {
    const { $, clamp } = Util;
    const KEY = "chainreact.settings";
    // game-specific inputs: read into config.<key>, written back from a config
    const FIELDS = [
        { key: "winLen", el: "set-winlen", type: "int", min: 3, max: 25, def: 5 },
        { key: "speed", el: "set-speed", type: "int", def: 750 },
        { key: "chainRule", el: "set-chain", type: "bool" },
        { key: "chainLen", el: "set-chain-len", type: "int", min: 5, max: 99, def: 15 },
    ];
    let game = null;             // selected game key
    const sizeFor = {};          // remembered board size per game
    let onChange = () => {};
    let silent = false;          // true while writing the friend's settings into the form

    const def = () => Games.get(game);

    function readField(f) {
        const el = $(f.el);
        if (f.type === "bool") return el.checked;
        const v = parseInt(el.value, 10) || f.def;
        return f.min !== undefined ? clamp(v, f.min, f.max) : v;
    }
    function sizeLimits() {
        const d = def();
        const min = d.minSize ? Math.max(d.size.min, d.minSize({ winLen: readField(FIELDS[0]) })) : d.size.min;
        return { min, max: d.size.max };
    }

    // the config object a game is started with (and what the friend receives)
    function read() {
        const d = def();
        const lim = sizeLimits();
        const timerSel = $("set-timer").value;
        const timer = timerSel === "custom" ? Math.round(parseFloat($("set-timer-custom").value || "3") * 60) : parseInt(timerSel, 10);
        const cfg = {
            game, players: 2,
            n: clamp(parseInt($("set-size").value, 10) || d.size.default, lim.min, lim.max),
            timer: Math.max(0, timer || 0), timerSel, timerCustom: $("set-timer-custom").value,
        };
        for (const f of FIELDS) cfg[f.key] = readField(f);
        return cfg;
    }

    // put a config into the form (localStorage restore, the friend's changes)
    function write(s) {
        if (!s) return;
        silent = true;
        if (s.game && Games.has(s.game)) game = s.game;
        if (s.n) sizeFor[game] = s.n;
        for (const f of FIELDS) {
            if (f.type === "bool") $(f.el).checked = !!s[f.key];
            else if (s[f.key]) $(f.el).value = String(s[f.key]);
        }
        if (s.timerSel) $("set-timer").value = s.timerSel;
        if (s.timerCustom) $("set-timer-custom").value = s.timerCustom;
        selectGame(game, false);
        silent = false;
    }

    function save() {
        sizeFor[game] = parseInt($("set-size").value, 10);
        Util.save(localStorage, KEY, { ...read(), sizeFor });
    }
    function load() {
        const s = Util.load(localStorage, KEY);
        if (!s) return;
        if (s.sizeFor) Object.assign(sizeFor, s.sizeFor);
        write(s);
    }

    function fillSize() {
        const lim = sizeLimits();
        const inp = $("set-size");
        inp.min = String(lim.min);
        inp.max = String(lim.max);
        inp.value = String(clamp(sizeFor[game] || def().size.default, lim.min, lim.max));
        $("size-hint").textContent = `(${lim.min}–${lim.max})`;
    }

    // clamp typed numbers once a field is left (typing "1" on the way to "12" must not snap)
    function clampInputs() {
        const wl = $("set-winlen");
        if (wl.value !== "") wl.value = String(readField(FIELDS[0]));
        const lim = sizeLimits();
        const inp = $("set-size");
        inp.min = String(lim.min);
        if (inp.value !== "") inp.value = String(clamp(parseInt(inp.value, 10) || def().size.default, lim.min, lim.max));
        $("size-hint").textContent = `(${lim.min}–${lim.max})`;
        changed();
    }

    function selectGame(key, announce = true) {
        game = Games.has(key) ? key : Games.keys()[0];
        const d = def();
        document.querySelectorAll(".game-card").forEach((c) => c.classList.toggle("selected", c.dataset.game === game));
        $("menu-tagline").textContent = d.tagline;
        document.querySelectorAll("#settings-modal [data-setting]").forEach((row) => { row.hidden = !d.settings.includes(row.dataset.setting); });
        fillSize();
        if (announce) changed(); else renderSummary();
    }

    function syncUi() {
        $("row-timer-custom").hidden = $("set-timer").value !== "custom";
        $("set-chain-len").disabled = !$("set-chain").checked;
        changed();
    }

    // any local change: persist, refresh the summary, tell the app (which tells the friend)
    function changed() {
        save();
        renderSummary();
        if (!silent) onChange(read());
    }

    // "6 × 6 · 5 in a row · 3 min timer · 15-chain wins"
    function summary(cfg = read()) {
        const d = Games.get(cfg.game);
        const parts = [`${cfg.n} × ${cfg.n}`];
        if (d.describeRules) parts.push(...d.describeRules(cfg));
        parts.push(cfg.timer > 0 ? `${Math.round(cfg.timer / 60 * 10) / 10} min timer` : "no timer");
        if (d.describeOptions) parts.push(...d.describeOptions(cfg));
        return parts.join(" · ");
    }
    function renderSummary() { $("settings-summary").textContent = summary(); }

    // one picker card per registered game (preview: 9 chars, "." empty, digit = player)
    function renderPicker() {
        const picker = $("game-picker");
        picker.innerHTML = "";
        for (const key of Games.keys()) {
            const d = Games.get(key);
            const card = document.createElement("button");
            card.className = "game-card";
            card.dataset.game = key;
            const tiles = [...d.preview].map((ch) => `<i${/\d/.test(ch) ? ` class="p${ch}"` : ""}></i>`).join("");
            card.innerHTML = `<span class="game-preview ${key}">${tiles}</span><span class="game-name"></span><span class="game-desc"></span>`;
            card.querySelector(".game-name").textContent = d.title;
            card.querySelector(".game-desc").textContent = d.desc;
            card.addEventListener("click", () => selectGame(key));
            picker.appendChild(card);
        }
    }

    function open() { $("settings-modal").hidden = false; }
    function close() { clampInputs(); $("settings-modal").hidden = true; }

    function init(handlers) {
        onChange = handlers.onChange || onChange;
        renderPicker();
        $("btn-settings").addEventListener("click", open);
        $("btn-settings-done").addEventListener("click", close);
        $("settings-modal").addEventListener("click", (e) => { if (e.target === $("settings-modal")) close(); });
        for (const id of ["set-speed", "set-timer", "set-timer-custom", "set-chain", "set-chain-len"]) {
            $(id).addEventListener("change", syncUi);
            $(id).addEventListener("input", syncUi);
        }
        for (const id of ["set-size", "set-winlen"]) $(id).addEventListener("change", clampInputs);
        game = Games.keys()[0];
        load();
        selectGame(game, false);
    }

    return { init, read, write, selectGame, summary, get game() { return game; } };
})();
