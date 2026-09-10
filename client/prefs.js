/* Preferences: what this device likes, never shared with the room and never part of a
   game's config — the look (delegated to Skins), the sound volume and which sound
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
    const DEFAULTS = {
        volume: 30,                                   // master volume in %, quiet by default
        soundSet: "auto",                             // "auto" (follows the look) | "classic" | "mc"
        sounds: Object.fromEntries(CATEGORIES.map((c) => [c, true])),
        hideCode: false,                              // enter rooms with the code hidden (lobby, HUD, address bar)
        privateIp: false,                             // relay every connection through TURN: nobody in the room sees my IP (#30)
        developer: false,                             // the developer info panel (#31)
    };
    // the modal's sections, in the order of the nav rows (#prefs-nav-<key>, .prefs-section[data-section=<key>])
    const SECTIONS = ["look", "sound", "streaming", "developer", "feedback"];
    const LOOK_LABELS = { classic: "Classic", mcboard: "Blocks board", mc: "Blocks" };
    const SET_LABELS = { auto: "Follow the look", classic: "Classic", mc: "Blocks" };
    let section = null;                               // the open section (null = the menu, phones only)
    let prefs = merge(Util.load(localStorage, KEY));
    let onChange = () => {};
    let context = () => ({});                         // app.js: where the user is right now (for feedback)
    const REPO_ISSUES = "https://github.com/alexander-zierhut/minigames/issues/new";

    function merge(saved) {
        const p = { ...DEFAULTS, ...(saved || {}), sounds: { ...DEFAULTS.sounds, ...((saved && saved.sounds) || {}) } };
        p.volume = Util.clamp(parseInt(p.volume, 10) || 0, 0, 100);
        if (!["auto", "classic", "mc"].includes(p.soundSet)) p.soundSet = "auto";
        for (const c of CATEGORIES) p.sounds[c] = !!p.sounds[c];
        p.hideCode = !!p.hideCode;
        p.privateIp = !!p.privateIp;
        p.developer = !!p.developer;
        return p;
    }

    const get = () => prefs;

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
        $("pref-volume").value = String(prefs.volume);
        $("pref-volume-val").textContent = prefs.volume === 0 ? "off" : `${prefs.volume} %`;
        $("pref-soundset").value = prefs.soundSet;
        for (const c of CATEGORIES) { const el = $("pref-snd-" + c); if (el) el.checked = prefs.sounds[c]; }
        if ($("pref-hide-code")) $("pref-hide-code").checked = prefs.hideCode;
        if ($("pref-private-ip")) $("pref-private-ip").checked = prefs.privateIp;
        if ($("pref-developer")) $("pref-developer").checked = prefs.developer;
        $("prefs-modal").classList.toggle("muted", prefs.volume === 0);
        renderNav();
    }

    /* ---------- the two levels (#32) ---------- */
    // one line describing a section's current state, for its menu row (pure)
    function sectionSummary(key) {
        const p = prefs;
        if (key === "look") return LOOK_LABELS[typeof Skins !== "undefined" ? Skins.current : "classic"] || LOOK_LABELS.classic;
        if (key === "sound") return p.volume === 0 ? "off" : `${p.volume} % · ${SET_LABELS[p.soundSet]}`;
        if (key === "streaming") {
            const on = [p.hideCode && "Code hidden", p.privateIp && "IP private"].filter(Boolean);
            return on.length ? on.join(" · ") : "off";
        }
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
            volume: parseInt($("pref-volume").value, 10), soundSet: $("pref-soundset").value, sounds,
            hideCode: !!($("pref-hide-code") && $("pref-hide-code").checked),
            privateIp: !!($("pref-private-ip") && $("pref-private-ip").checked),
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
                Screen: ctx.screen, Mode: ctx.mode, Game: ctx.game, Settings: ctx.settings, Players: ctx.players,
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
        for (const id of ["pref-hide-code", "pref-private-ip", "pref-developer"]) if ($(id)) $(id).addEventListener("change", readForm);
        for (const key of SECTIONS) { const row = $("prefs-nav-" + key); if (row) row.addEventListener("click", () => showSection(key)); }
        $("btn-prefs-back").addEventListener("click", () => showSection(null));
        $("prefs-panes").addEventListener("click", renderNav);        // the look buttons are Skins', the row summary is ours
        showSection(onePane() ? null : SECTIONS[0]);
        fill();
    }

    return {
        init, get, set, open, close, feedbackUrl, CATEGORIES, SECTIONS, showSection, sectionSummary,
        get isOpen() { return !$("prefs-modal").hidden; }, get section() { return section; },
    };
})();
