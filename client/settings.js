/* Game choice + settings: the form in #settings-modal, the picker cards in the lobby,
   persistence in localStorage, and the config object a game is started with.

   Shared rows (board size, timer) are in index.html; the players control is the lobby's
   segmented row (#set-players, #28) so everyone sees the room takes two to four; the game-specific rows are
   BUILT here from every registered game's `settings` list (see Games / AGENTS.md):
     { key, label, type: "int" | "select" | "bool", def, min?, max?, unit?, options?, with? }
   into #game-settings, as `<label class="row" id="row-<key>" data-setting="<key>">` with the
   input `#set-<key>` (key lowercased). A row shows when the selected game lists that key.
   Every field of every game is read into the config (`config.<key>`), persisted and
   mirrored to the room. Board-size limits come from `size` / `minSize(cfg)`, and its label
   from `sizeLabel` when a game wants its own ("Boxes per side"). A game
   declares `players: { min, max }` (default 2–4): the picker grays out games that don't
   take the chosen player count, and the selection moves to one that does (#28).
   `setMinPlayers(n)` (the lobby says how many seats are taken) disables every smaller count
   and lifts `read().players` to it, so nobody is pushed out of a seat they sit in (#34).
   Any change calls onChange(config) so the room can mirror it to the friends. */

"use strict";

const Settings = (() => {
    const { $, clamp } = Util;
    const KEY = "chainreact.settings";
    const MIN_PLAYERS_HINT = "Someone would lose their seat. They have to leave the room first.";
    let fields = [];             // every game field: { key, el, type, min, max, def, game }
    let game = null;             // selected game key
    let players = 2;             // seats in the room / on this device (the lobby's players control)
    let maxPlayers = 4;          // 2 against a bot (setMode), else 4
    const sizeFor = {};          // remembered board size per game
    let onChange = () => {};
    let onSelectGame = () => {}; // a game card was clicked (not a mirrored / restored selection)
    let silent = false;          // true while writing the friend's settings into the form
    let locked = false;          // a spectator: everything read-only (#29)
    let minPlayers = 2;          // seats already taken in the room: a smaller count would kick somebody (#34)
    let bot = null;              // online: the room plays against a bot on seat 1 (#36) — { id, difficulty, seat }

    const def = () => Games.get(game);
    const supports = (key, n = clamp(players, 2, maxPlayers)) => { const p = Games.get(key).players; return n >= p.min && n <= p.max; };
    const idFor = (key) => "set-" + key.toLowerCase();

    /* ---------- the game rows, from the definitions ---------- */
    function buildRows() {
        const box = $("game-settings");
        box.innerHTML = "";
        fields = [];
        for (const key of Games.keys()) {
            for (const s of Games.get(key).settings) box.appendChild(row(key, s));
        }
    }
    function input(gameKey, s) {
        let el;
        if (s.type === "select") {
            el = document.createElement("select");
            for (const [value, label] of s.options) {
                const o = document.createElement("option");
                o.value = String(value); o.textContent = label; o.selected = value === s.def;
                el.appendChild(o);
            }
        } else {
            el = document.createElement("input");
            if (s.type === "bool") { el.type = "checkbox"; el.checked = !!s.def; }
            else { el.type = "number"; el.min = String(s.min); el.max = String(s.max); el.step = "1"; el.value = String(s.def); }
        }
        el.id = idFor(s.key);
        el.autocomplete = "off";
        fields.push({ key: s.key, el: el.id, type: s.type, min: s.min, max: s.max, def: s.def, options: s.options, game: gameKey, with: s.with ? s.with.key : null });
        return el;
    }
    function row(gameKey, s) {
        const label = document.createElement("label");
        label.className = "row";
        label.id = "row-" + s.key.toLowerCase();
        label.dataset.setting = s.key;
        const name = document.createElement("span");
        name.textContent = s.label;
        label.appendChild(name);
        const main = input(gameKey, s);
        if (s.unit || s.with) {
            const inline = document.createElement("span");
            inline.className = "inline";
            inline.appendChild(main);
            if (s.with) {                                   // a number that only counts while the checkbox is on
                const sub = input(gameKey, s.with);
                sub.disabled = !s.def;
                inline.appendChild(sub);
                if (s.with.unit) inline.appendChild(small(s.with.unit));
            }
            if (s.unit) inline.appendChild(small(s.unit));
            label.appendChild(inline);
        } else label.appendChild(main);
        return label;
    }
    function small(text) { const el = document.createElement("small"); el.textContent = text; return el; }

    /* ---------- read / write ---------- */
    function readField(f) {
        const el = $(f.el);
        if (f.type === "bool") return el.checked;
        if (f.type === "select") { const o = f.options.find(([v]) => String(v) === el.value); return o ? o[0] : f.def; }
        const v = parseInt(el.value, 10) || f.def;
        return f.min !== undefined ? clamp(v, f.min, f.max) : v;
    }
    const gameValues = () => Object.fromEntries(fields.map((f) => [f.key, readField(f)]));
    function sizeLimits() {
        const d = def();
        const min = d.minSize ? Math.max(d.size.min, d.minSize(gameValues())) : d.size.min;
        return { min, max: d.size.max };
    }

    // the config object a game is started with (and what the friends receive)
    function read() {
        const d = def();
        const lim = sizeLimits();
        const timerSel = $("set-timer").value;
        const timer = timerSel === "custom" ? Math.round(parseFloat($("set-timer-custom").value || "3") * 60) : parseInt(timerSel, 10);
        return {
            game, players: clamp(players, floor(), maxPlayers),
            n: clamp(parseInt($("set-size").value, 10) || d.size.default, lim.min, lim.max),
            timer: Math.max(0, timer || 0), timerSel, timerCustom: $("set-timer-custom").value,
            bot: bot ? { ...bot } : null,
            ...gameValues(),
        };
    }

    // put a config into the form (localStorage restore, the friends' changes)
    function write(s) {
        if (!s) return;
        silent = true;
        if (s.game && Games.has(s.game)) game = s.game;
        if (s.n) sizeFor[game] = s.n;
        if ("bot" in s) bot = normalizeBot(s.bot);      // the room's bot travels with the settings (#36)
        if (s.players) players = clamp(parseInt(s.players, 10) || 2, floor(), 4);   // never below the seats in use (#34)
        for (const f of fields) {
            if (f.type === "bool") $(f.el).checked = !!s[f.key];
            else if (s[f.key]) $(f.el).value = String(s[f.key]);
        }
        if (s.timerSel) $("set-timer").value = s.timerSel;
        if (s.timerCustom) $("set-timer-custom").value = s.timerCustom;
        syncDependents();
        renderPlayers();
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
        $("size-label").textContent = def().sizeLabel || "Board size";   // boxes: "Boxes per side"
    }

    // clamp typed numbers once a field is left (typing "1" on the way to "12" must not snap)
    function clampInputs() {
        for (const f of fields) if (f.type === "int" && $(f.el).value !== "") $(f.el).value = String(readField(f));
        const lim = sizeLimits();
        const inp = $("set-size");
        inp.min = String(lim.min);
        if (inp.value !== "") inp.value = String(clamp(parseInt(inp.value, 10) || def().size.default, lim.min, lim.max));
        $("size-hint").textContent = `(${lim.min}–${lim.max})`;
        changed();
    }

    function selectGame(key, announce = true) {
        game = Games.has(key) ? key : Games.keys()[0];
        if (!supports(game)) game = Games.keys().find((k) => supports(k)) || game;   // this game doesn't take that many: the first that does
        const d = def();
        const shown = d.settings.map((s) => s.key);
        document.querySelectorAll(".game-card").forEach((c) => {
            c.classList.toggle("selected", c.dataset.game === game);
            const ok = supports(c.dataset.game);
            c.classList.toggle("unsupported", !ok);
            c.disabled = !ok || locked;
            c.title = ok ? "" : `Not for ${players} players`;
        });
        $("menu-tagline").textContent = d.tagline;
        document.querySelectorAll("#settings-modal [data-setting]").forEach((r) => { r.hidden = !shown.includes(r.dataset.setting); });
        fillSize();
        if (announce) changed(); else renderSummary();
    }

    // a number attached to a checkbox only counts while the box is checked
    function syncDependents() {
        for (const f of fields) if (f.with) $(idFor(f.with)).disabled = !$(f.el).checked;
    }
    function syncUi() {
        $("row-timer-custom").hidden = $("set-timer").value !== "custom";
        syncDependents();
        changed();
    }

    // any local change: persist, refresh the summary, tell the app (which tells the friends)
    function changed() {
        save();
        renderSummary();
        if (!silent) onChange(read());
    }

    // "6 × 6 · 5 in a row · 3 min timer · 15-chain wins" ("· 3 players" when more than two)
    function summary(cfg = read()) {
        const d = Games.get(cfg.game);
        const parts = [`${cfg.n} × ${cfg.n}`];
        if (cfg.players > 2) parts.push(`${cfg.players} players`);
        if (d.describeRules) parts.push(...d.describeRules(cfg));
        parts.push(cfg.timer > 0 ? `${Math.round(cfg.timer / 60 * 10) / 10} min timer` : "no timer");
        if (d.describeOptions) parts.push(...d.describeOptions(cfg));
        return parts.join(" · ");
    }
    function renderSummary() { $("settings-summary").textContent = summary(); }

    /* ---------- players (the lobby's segmented control, #28) ---------- */
    const playersText = (p) => (p.min === p.max ? `${p.min} players` : `${p.min} to ${p.max} players`);
    // the smallest count this room may be set to: never fewer seats than people sitting in them (#34)
    const floor = () => clamp(minPlayers, 2, maxPlayers);
    function renderPlayers() {
        document.querySelectorAll("#set-players button").forEach((b) => {
            const v = parseInt(b.dataset.players, 10);
            b.classList.toggle("selected", v === players);
            const kicks = v < floor();
            b.disabled = locked || kicks;
            b.title = kicks && !locked ? MIN_PLAYERS_HINT : "";
        });
    }
    function setPlayers(n) {
        players = clamp(parseInt(n, 10) || 2, floor(), 4);
        renderPlayers();
        selectGame(game, false);                       // grays out games that don't take that many (and moves off one)
        changed();
    }
    // how many seats the room already has somebody in (#34); the lobby calls this on every presence change
    function setMinPlayers(n) {
        minPlayers = clamp(parseInt(n, 10) || 2, 2, 4);
        if (players < floor()) players = floor();
        renderPlayers();
    }

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
            card.innerHTML = `<span class="game-preview ${key}">${tiles}</span><span class="game-name"></span><span class="game-desc"></span><span class="game-players"></span>`;
            card.querySelector(".game-name").textContent = d.title;
            card.querySelector(".game-desc").textContent = d.desc;
            card.querySelector(".game-players").textContent = playersText(d.players);
            card.addEventListener("click", () => { selectGame(key); onSelectGame(key); });
            picker.appendChild(card);
        }
    }

    // spectators only watch (#29): the picker, the players control and every settings input are disabled
    function setLocked(on) {
        locked = !!on;
        document.body.classList.toggle("settings-locked", locked);
        renderPlayers();
        document.querySelectorAll("#settings-modal input, #settings-modal select").forEach((el) => { el.disabled = locked; });
        if (!locked) syncDependents();
        $("settings-locked-hint").hidden = !locked;
        selectGame(game, false);
    }

    /* ---------- the room's bot (#36) ----------
       Offline "Against a bot" is a mode; in a room the bot is part of the config, so it
       travels in `lobby {s}` / `start {config}` / `state` and everybody sees it on its seat.
       It takes seat 1 by default, the seat opposite the one human in a two-seat room; a
       caller that needs the other side says so (#43: "Play from here" hands the human the
       seat that is to move, so the bot may end up on seat 0). Everything else reads the
       seat off `config.bot.seat`, never a constant. */
    const BOT_SEAT = 1;
    function normalizeBot(v) {
        if (!v || !v.id || !Bots.get(v.id)) return null;
        const seat = Number.isInteger(v.seat) && v.seat >= 0 && v.seat < 4 ? v.seat : BOT_SEAT;
        return { id: v.id, difficulty: v.difficulty, seat };
    }
    // pick / drop the room's bot; `announce` false writes it without telling the friends
    function setBot(choice, announce = true) {
        const next = normalizeBot(choice);
        if (JSON.stringify(next) === JSON.stringify(bot)) return;
        bot = next;
        if (announce) changed(); else { save(); renderSummary(); }
    }

    // "bot": you against one bot, so the players row is hidden and read() says 2
    function setMode(mode) {
        maxPlayers = mode === "bot" ? 2 : 4;
        $("row-players").hidden = mode === "bot";
        if (mode !== "online") bot = null;             // a room's bot never follows into offline play
        renderPlayers();
        renderSummary();
    }

    function open() { $("settings-modal").hidden = false; }
    function close() { clampInputs(); $("settings-modal").hidden = true; }

    function init(handlers) {
        onChange = handlers.onChange || onChange;
        onSelectGame = handlers.onSelectGame || onSelectGame;
        renderPicker();
        buildRows();
        $("btn-settings").addEventListener("click", open);
        $("btn-settings-done").addEventListener("click", close);
        $("settings-modal").addEventListener("click", (e) => { if (e.target === $("settings-modal")) close(); });
        document.querySelectorAll("#set-players button").forEach((b) => b.addEventListener("click", () => setPlayers(b.dataset.players)));
        for (const id of ["set-timer", "set-timer-custom"]) {
            $(id).addEventListener("change", syncUi);
            $(id).addEventListener("input", syncUi);
        }
        for (const f of fields) {
            if (f.type === "int") $(f.el).addEventListener("change", clampInputs);
            else { $(f.el).addEventListener("change", syncUi); $(f.el).addEventListener("input", syncUi); }
        }
        $("set-size").addEventListener("change", clampInputs);
        game = Games.keys()[0];
        load();
        renderPlayers();
        selectGame(game, false);
    }

    return { init, read, write, selectGame, setPlayers, setMinPlayers, setBot, summary, setMode, setLocked, supports, MIN_PLAYERS_HINT, BOT_SEAT, get bot() { return bot ? { ...bot } : null; }, get locked() { return locked; }, get minPlayers() { return minPlayers; }, get game() { return game; }, get players() { return players; }, get fields() { return fields.map((f) => f.key); } };
})();
