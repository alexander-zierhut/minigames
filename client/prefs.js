/* Preferences: what this device likes, never shared with the room and never part of a
   game's config — the look (delegated to Skins), the sound volume and which sound
   categories play. The ⚙ button (#prefs-btn) in the top-left corner of every screen
   opens #prefs-modal. Stored in localStorage["chainreact.prefs"]; app.js and the sound
   module read Prefs.get(). */

"use strict";

const Prefs = (() => {
    const { $ } = Util;
    const KEY = "chainreact.prefs";
    const CATEGORIES = ["moves", "explosions", "results", "turn", "reactions", "chat"];
    const DEFAULTS = {
        volume: 30,                                   // master volume in %, quiet by default
        soundSet: "auto",                             // "auto" (follows the look) | "classic" | "mc"
        sounds: Object.fromEntries(CATEGORIES.map((c) => [c, true])),
    };
    let prefs = merge(Util.load(localStorage, KEY));
    let onChange = () => {};
    let context = () => ({});                         // app.js: where the user is right now (for feedback)
    const REPO_ISSUES = "https://github.com/alexander-zierhut/minigames/issues/new";

    function merge(saved) {
        const p = { ...DEFAULTS, ...(saved || {}), sounds: { ...DEFAULTS.sounds, ...((saved && saved.sounds) || {}) } };
        p.volume = Util.clamp(parseInt(p.volume, 10) || 0, 0, 100);
        if (!["auto", "classic", "mc"].includes(p.soundSet)) p.soundSet = "auto";
        for (const c of CATEGORIES) p.sounds[c] = !!p.sounds[c];
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
        $("prefs-modal").classList.toggle("muted", prefs.volume === 0);
    }
    // prefs <- form
    function readForm() {
        const sounds = {};
        for (const c of CATEGORIES) { const el = $("pref-snd-" + c); if (el) sounds[c] = el.checked; }
        set({ volume: parseInt($("pref-volume").value, 10), soundSet: $("pref-soundset").value, sounds });
    }

    function open() { fill(); $("prefs-modal").hidden = false; }
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
        fill();
    }

    return { init, get, set, open, close, feedbackUrl, CATEGORIES, get isOpen() { return !$("prefs-modal").hidden; } };
})();
