/* Preferences: what this device likes, never shared with the room (the name is the one
   exception: it travels with the handshake) and never part of a game's config — the name
   others see (#35), the look (delegated to Skins), the sound volume and which sound
   categories play, whether a room's code is hidden on entry (streaming, #19), whether
   every connection is relayed so nobody learns this device's IP (#30). The
   "⚙ Settings & Feedback" button (#prefs-btn) in the top-left corner of every screen
   opens #prefs-modal. Stored in localStorage["chainreact.prefs"]; app.js and the sound
   module read Prefs.get().

   The modal has two levels (#32): a menu with one row per section (its current state as
   a one-line summary) and one panel per section. Phones show one of the two at a time
   (a row opens its panel, "‹ Back" returns to the menu), desktop shows the menu as a
   left column beside the open panel. A new section is a nav row plus a .prefs-section
   panel in index.html and one entry in SECTIONS here. */

"use strict";

const Prefs = (() => {
    const { $ } = Util;
    const KEY = "chainreact.prefs";
    const CATEGORIES = ["moves", "explosions", "results", "turn", "reactions", "chat"];
    const NAME_MAX = 16;                              // a name has to fit the seat cards and the HUD
    // the pool the first visit picks from (#35): short, fun, neutral, no colours (the seats
    // have colours of their own) — also the deterministic names of the other seats on one device
    const DEFAULT_NAMES = [
        "Pixel", "Blaze", "Comet", "Nova", "Echo", "Mochi", "Otto", "Luna", "Bolt", "Ziggy",
        "Pepper", "Frost", "Milo", "Pico", "Sunny", "Dash", "Kiwi", "Jinx", "Tofu", "Bingo",
        "Quill", "Wasabi", "Nimbus", "Pluto", "Cosmo", "Fizz", "Gizmo", "Waffle", "Turbo", "Pixie",
        "Nacho", "Domino", "Sprocket", "Hazel", "Juno", "Rocket", "Panda", "Noodle", "Maple", "Zeppo",
    ];
    const DEFAULTS = {
        name: "",                                     // what the others see; empty = the picked default below
        defaultName: "",                              // the name drawn on the first visit (the fallback of an empty name)
        volume: 30,                                   // master volume in %, quiet by default
        soundSet: "auto",                             // "auto" (follows the look) | "classic" | "mc"
        sounds: Object.fromEntries(CATEGORIES.map((c) => [c, true])),
        hideCode: false,                              // enter rooms with the code hidden (lobby, HUD, address bar)
        hideCodeAsked: false,                         // the one-time question when the code is first hidden was answered
        winGraph: true,                               // the win-chance line graph in the replay analysis panel (#43)
        privateIp: false,                             // relay every connection through TURN: nobody in the room sees my IP (#30)
        muteSpectators: false,                        // spectators' chat lines and reactions never show on this device
        developer: false,                             // the developer info panel (#31)
    };
    // the modal's sections, in the order of the nav rows (#prefs-nav-<key>, .prefs-section[data-section=<key>])
    const SECTIONS = ["profile", "look", "sound", "streaming", "developer", "feedback"];
    const LOOK_LABELS = { classic: "Classic", mcboard: "Blocks board", mc: "Blocks" };
    const SET_LABELS = { auto: "Follow the look", classic: "Classic", mc: "Blocks" };
    let section = null;                               // the open section (null = the menu, phones only)
    let onChange = () => {};
    let context = () => ({});                         // app.js: where the user is right now (for feedback)
    const REPO_ISSUES = "https://github.com/alexander-zierhut/minigames/issues/new";

    // a name as it may be shown and sent: no line breaks, no runs of spaces, at most 16 characters
    /* A name is at most NAME_MAX characters AND no wider than NAME_MAX letters "n" in the
       greeting field's font (the owner: "AAAAAAAAAAAAAAAA" is much wider than "iiiiiiiiiiiiiiii"
       and must still fit the UI). `measureName(text)` renders the text in a hidden span and
       reads its width; where that cannot be measured (jsdom, no DOM) it returns null and only
       the character limit applies. `fitName(s, measure)` is the pure cut, testable with a fake. */
    let ruler = null;
    function measureName(text) {
        try {
            if (!ruler) {
                ruler = document.createElement("span");
                ruler.setAttribute("aria-hidden", "true");
                ruler.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-weight:800;font-size:14px;font-family:inherit";
                document.body.appendChild(ruler);
            }
            ruler.textContent = text;
            const w = ruler.getBoundingClientRect().width;
            return w > 0 ? w : null;
        } catch (e) { return null; }
    }
    function fitName(s, measure = measureName) {
        s = s.slice(0, NAME_MAX);
        const budget = s ? measure("n".repeat(NAME_MAX)) : null;
        if (!budget) return s;
        while (s.length > 1 && measure(s) > budget) s = s.slice(0, -1).trimEnd();
        return s;
    }
    const cleanName = (s) => fitName(String(s == null ? "" : s).replace(/\s+/g, " ").trim());
    const randomName = () => DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];

    function merge(saved) {
        const p = { ...DEFAULTS, ...(saved || {}), sounds: { ...DEFAULTS.sounds, ...((saved && saved.sounds) || {}) } };
        p.defaultName = cleanName(p.defaultName) || randomName();
        p.name = cleanName(p.name) || p.defaultName;   // clearing the field falls back to the drawn default
        p.volume = Util.clamp(parseInt(p.volume, 10) || 0, 0, 100);
        if (!["auto", "classic", "mc"].includes(p.soundSet)) p.soundSet = "auto";
        for (const c of CATEGORIES) p.sounds[c] = !!p.sounds[c];
        p.hideCode = !!p.hideCode;
        p.hideCodeAsked = !!p.hideCodeAsked;
        p.winGraph = !!p.winGraph;
        p.privateIp = !!p.privateIp;
        p.muteSpectators = !!p.muteSpectators;
        p.developer = !!p.developer;
        return p;
    }

    const stored = Util.load(localStorage, KEY);
    let prefs = merge(stored);
    // first visit: the drawn name is kept from now on, so it never changes again by itself
    if (!stored || !stored.name) Util.save(localStorage, KEY, prefs);

    const get = () => prefs;

    /* The names of the seats when everybody plays on this device (#35): seat 0 is me, the
       others take the first default names that are not mine. Pure and deterministic, so a
       local game always shows the same, different names. */
    const seatNames = (count = 4) => [prefs.name, ...DEFAULT_NAMES.filter((n) => n !== prefs.name)].slice(0, count);

    // change one or more preferences: { volume, soundSet, sounds: { chat: false } }
    function set(patch) {
        prefs = merge({ ...prefs, ...patch, sounds: { ...prefs.sounds, ...((patch && patch.sounds) || {}) } });
        Util.save(localStorage, KEY, prefs);
        fill();
        onChange(prefs);
    }

    // form <- prefs
    function fill() {
        if (!$("pref-volume")) return;
        if ($("pref-name")) $("pref-name").value = prefs.name;
        if ($("menu-name")) {
            $("menu-name").value = prefs.name;                       // the title screen's greeting shows the same name
            const budget = measureName("n".repeat(NAME_MAX));        // and is exactly as wide as the widest name allowed
            if (budget) $("menu-name").style.width = `${Math.ceil(budget) + 22}px`;   // + padding and border
        }
        $("pref-volume").value = String(prefs.volume);
        $("pref-volume-val").textContent = prefs.volume === 0 ? "off" : `${prefs.volume} %`;
        $("pref-soundset").value = prefs.soundSet;
        for (const c of CATEGORIES) { const el = $("pref-snd-" + c); if (el) el.checked = prefs.sounds[c]; }
        if ($("pref-win-graph")) $("pref-win-graph").checked = prefs.winGraph;
        if ($("pref-hide-code")) $("pref-hide-code").checked = prefs.hideCode;
        if ($("pref-private-ip")) $("pref-private-ip").checked = prefs.privateIp;
        if ($("pref-mute-spectators")) $("pref-mute-spectators").checked = prefs.muteSpectators;
        if ($("pref-developer")) $("pref-developer").checked = prefs.developer;
        $("prefs-modal").classList.toggle("muted", prefs.volume === 0);
        renderCreatorButton();
        renderNav();
    }

    // content creator mode = every option of that section on; the button toggles all of them
    const CREATOR = ["hideCode", "privateIp", "muteSpectators"];     // the options the content creator button switches
    const creatorMode = () => CREATOR.every((k) => prefs[k]);
    function renderCreatorButton() {
        const b = $("pref-creator-mode");
        if (!b) return;
        const on = creatorMode();
        b.textContent = on ? "Turn off content creator mode" : "Turn on content creator mode";
        b.classList.toggle("primary", !on);
    }

    /* ---------- the two levels (#32) ---------- */
    // one line describing a section's current state, for its menu row (pure)
    function sectionSummary(key) {
        const p = prefs;
        if (key === "profile") return p.name;
        if (key === "look") return (LOOK_LABELS[typeof Skins !== "undefined" ? Skins.current : "classic"] || LOOK_LABELS.classic) + (p.winGraph ? "" : " · no win graph");
        if (key === "sound") return p.volume === 0 ? "off" : `${p.volume} % · ${SET_LABELS[p.soundSet]}`;
        if (key === "streaming") return creatorMode() ? "on" : CREATOR.some((k) => p[k]) ? "partly on" : "Best for streaming";
        if (key === "developer") return p.developer ? "on" : "off";
        if (key === "feedback") return "Report a problem";
        return "";
    }

    // the menu rows: summary text and which one is open
    function renderNav() {
        for (const key of SECTIONS) {
            const sum = $("prefs-sum-" + key);
            if (sum) sum.textContent = sectionSummary(key);
            const row = $("prefs-nav-" + key);
            if (row) row.classList.toggle("selected", key === section);
        }
    }

    // show one section's panel (null = back to the menu; on desktop both panes show anyway)
    function showSection(key) {
        section = SECTIONS.includes(key) ? key : null;
        for (const el of document.querySelectorAll("#prefs-panes .prefs-section")) el.hidden = el.dataset.section !== section;
        $("prefs-card").classList.toggle("on-section", section !== null);
        renderNav();
    }

    // phones show one level at a time; desktop (the two-pane layout) opens a section right away
    const onePane = () => !!(window.matchMedia && window.matchMedia("(max-width: 899px)").matches);

    // prefs <- form
    function readForm() {
        const sounds = {};
        for (const c of CATEGORIES) { const el = $("pref-snd-" + c); if (el) sounds[c] = el.checked; }
        set({
            name: $("pref-name") ? $("pref-name").value : prefs.name,
            volume: parseInt($("pref-volume").value, 10), soundSet: $("pref-soundset").value, sounds,
            winGraph: !!($("pref-win-graph") && $("pref-win-graph").checked),
            hideCode: !!($("pref-hide-code") && $("pref-hide-code").checked),
            privateIp: !!($("pref-private-ip") && $("pref-private-ip").checked),
            muteSpectators: !!($("pref-mute-spectators") && $("pref-mute-spectators").checked),
            developer: !!($("pref-developer") && $("pref-developer").checked),
        });
    }

    function open() { showSection(onePane() ? null : section || SECTIONS[0]); fill(); $("prefs-modal").hidden = false; }
    function close() { $("prefs-modal").hidden = true; }

    // a GitHub "new issue" link with the situation prefilled (no room code, no chat text)
    function feedbackUrl() {
        const ctx = context() || {};
        const meta = document.querySelector('meta[name="version"]');
        const lines = [
            "**What happened / what would you like?**", "", "", "",
            "---", "_Filled in automatically:_", "",
            ...Object.entries({
                Screen: ctx.screen, Name: ctx.name, Mode: ctx.mode, Game: ctx.game, Settings: ctx.settings, Players: ctx.players,
                Seat: ctx.seat, Spectator: ctx.spectator, Bot: ctx.bot, Connection: ctx.net,
                Look: ctx.look, Sound: ctx.sound, Viewport: `${window.innerWidth}×${window.innerHeight}`,
                Version: meta ? meta.content : "dev", Browser: navigator.userAgent,
            }).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `- ${k}: ${v}`),
            ...(ctx.log && ctx.log.length ? ["", "Last log lines:", "```", ...ctx.log, "```"] : []),
        ];
        const title = `Feedback from the ${ctx.screen || "app"} screen`;
        return `${REPO_ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(lines.join("\n"))}`;
    }

    function init(handlers) {
        onChange = (handlers && handlers.onChange) || onChange;
        context = (handlers && handlers.context) || context;
        $("prefs-btn").addEventListener("click", open);
        $("pref-feedback").addEventListener("click", () => window.open(feedbackUrl(), "_blank", "noopener"));
        $("btn-prefs-done").addEventListener("click", close);
        $("prefs-modal").addEventListener("click", (e) => { if (e.target === $("prefs-modal")) close(); });
        $("pref-volume").addEventListener("input", readForm);
        $("pref-soundset").addEventListener("change", readForm);
        for (const c of CATEGORIES) { const el = $("pref-snd-" + c); if (el) el.addEventListener("change", readForm); }
        for (const id of ["pref-win-graph", "pref-hide-code", "pref-private-ip", "pref-mute-spectators", "pref-developer"]) if ($(id)) $(id).addEventListener("change", readForm);
        // content creator mode: every option of that section on or off, in one tap
        if ($("pref-creator-mode")) $("pref-creator-mode").addEventListener("click", () => {
            const on = !creatorMode();
            set(Object.fromEntries(CREATOR.map((k) => [k, on])));
            Util.toast(on ? "Content creator mode is on." : "Content creator mode is off.");
        });
        if ($("pref-name")) $("pref-name").addEventListener("change", readForm);   // on blur / Enter, so typing is never cut mid-word
        if ($("menu-name")) $("menu-name").addEventListener("change", () => set({ name: $("menu-name").value }));   // the greeting's field, same rules
        for (const key of SECTIONS) { const row = $("prefs-nav-" + key); if (row) row.addEventListener("click", () => showSection(key)); }
        $("btn-prefs-back").addEventListener("click", () => showSection(null));
        $("prefs-panes").addEventListener("click", renderNav);        // the look buttons are Skins', the row summary is ours
        showSection(onePane() ? null : SECTIONS[0]);
        fill();
    }

    return {
        init, get, set, open, close, feedbackUrl, cleanName, fitName, seatNames, CATEGORIES, SECTIONS, DEFAULT_NAMES, NAME_MAX, showSection, sectionSummary,
        get isOpen() { return !$("prefs-modal").hidden; }, get section() { return section; },
    };
})();
