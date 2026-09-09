/* Sounds. Subscribes to the Bus events and turns them into short cues: placing a block,
   the fuse and the blast of a chain reaction, win / lose / game over from the local
   human's perspective, "your turn" when it becomes my move against a friend or a bot,
   a pop per reaction, a ping per chat line.

   Two sets: "classic" is synthesized with WebAudio (no files); "mc" plays the real
   Minecraft sounds in client/sounds/ (owner's own installation, personal use). The set
   follows the look unless Prefs.soundSet says otherwise. Volume and per-category
   switches come from Prefs. Browsers refuse audio before a user gesture, so the
   AudioContext is created on the first pointerdown/keydown and nothing plays until then.

   Sound.init({ seats, player }) — seats() → kinds per seat ("local" | "remote" | "bot"),
   from which the perspective is derived; player (tests) replaces the WebAudio player. */

"use strict";

const Sound = (() => {
    const FILES = {                                       // mc set; build.mjs rewrites these paths
        place: "client/sounds/stone1.ogg",
        prime: "client/sounds/fuse.ogg",
        explode: "client/sounds/explode1.ogg",
        win: "client/sounds/levelup.ogg",
        lose: "client/sounds/anvil_land.ogg",
        over: "client/sounds/bass.ogg",
        turn: "client/sounds/pling.ogg",
        reaction: "client/sounds/pop.ogg",
        chat: "client/sounds/orb.ogg",
    };
    const CATEGORY = { place: "moves", prime: "explosions", explode: "explosions", win: "results", lose: "results", over: "results", turn: "turn", reaction: "reactions", chat: "chat" };
    const LOG_MAX = 30;
    const log = [];                                       // last cues that passed the gate (tests, diagnostics)
    let seats = () => [];
    let player = null;

    /* ---------- perspective: who is "me" on this device ---------- */
    // exactly one local seat among others (online, bot) → that seat; else -1 (local
    // two-on-one-device, spectating, no game)
    function me(kinds) {
        const local = kinds.map((k, p) => (k === "local" ? p : -1)).filter((p) => p >= 0);
        return local.length === 1 && kinds.length > 1 ? local[0] : -1;
    }

    /* ---------- event → cue (pure; unit-tested) ---------- */
    function map(event, data, kinds) {
        const d = data || {};
        switch (event) {
            case "game:move": return { name: "place" };
            case "chain:prime": return { name: "prime", until: d.ms || 450 };
            case "chain:explode": {
                const n = Math.max(1, Math.min(d.chain || 1, 12));
                return { name: "explode", gain: 0.8 + n * 0.04, rate: 1 - n * 0.02 + (d.cells ? Math.min(d.cells.length, 6) * 0.01 : 0) };
            }
            case "game:finish": {
                const my = me(kinds);
                if (d.winner < 0 || my < 0) return { name: "over" };
                return { name: d.winner === my ? "win" : "lose" };
            }
            case "game:turn": {
                const p = d.player;
                if (kinds[p] !== "local" || !kinds.some((k) => k !== "local")) return null;   // only when a friend or bot just moved
                return { name: "turn" };
            }
            case "reaction": return { name: "reaction", rate: d.theirs ? 0.9 : 1.05 };
            case "chat": return d.mine ? null : { name: "chat" };
            default: return null;
        }
    }

    const setName = () => {
        const pref = typeof Prefs !== "undefined" ? Prefs.get().soundSet : "auto";
        if (pref !== "auto") return pref;
        return typeof Skins !== "undefined" && Skins.current !== "classic" ? "mc" : "classic";
    };
    const volume = () => (typeof Prefs !== "undefined" ? Prefs.get().volume : 30);
    const enabled = (name) => {
        if (typeof Prefs === "undefined") return true;
        const p = Prefs.get();
        return p.volume > 0 && p.sounds[CATEGORY[name]] !== false;
    };

    // the gate every cue passes: prefs, then the player; remembered in the log
    function play(name, opts = {}) {
        if (!player || !FILES[name] || !enabled(name)) return false;
        const cue = { name, set: setName(), gain: Math.pow(volume() / 100, 1.6) * (opts.gain || 1), rate: opts.rate || 1, until: opts.until || 0, url: FILES[name] };
        log.push({ name, set: cue.set, at: Date.now() });
        if (log.length > LOG_MAX) log.shift();
        try { player.play(cue); } catch (e) { /* audio is never worth an exception */ }
        return true;
    }

    function handle(event, data) {
        const cue = map(event, data, seats() || []);
        if (cue) play(cue.name, cue);
    }

    /* ---------- the WebAudio player: synth (classic) + decoded files (mc) ---------- */
    function webAudioPlayer() {
        const AC = typeof AudioContext !== "undefined" ? AudioContext : (typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null);
        let ctx = null;
        const buffers = {};                               // url -> AudioBuffer | "loading" | "failed"
        let unlocked = false;

        function unlock() {
            if (!AC || ctx) return;
            try { ctx = new AC(); } catch (e) { return; }
            unlocked = true;
            if (ctx.state === "suspended") ctx.resume().catch(() => {});
            if (setName() === "mc") preload();
        }
        function preload() {
            for (const url of Object.values(FILES)) load(url);
        }
        function load(url) {
            if (!ctx || buffers[url] || typeof fetch !== "function") return;
            buffers[url] = "loading";
            fetch(new URL(url, location.href).href)
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
                .then((buf) => new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)))
                .then((decoded) => { buffers[url] = decoded; })
                .catch(() => { buffers[url] = "failed"; });
        }

        function master(gain, t) {
            const g = ctx.createGain();
            g.gain.setValueAtTime(gain, t);
            g.connect(ctx.destination);
            return g;
        }
        // a note: oscillator sweeping f0 → f1 over dur seconds with a quick attack / decay
        function tone(t, { type = "sine", f0, f1 = f0, dur, gain, attack = 0.005 }) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f0, t);
            o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(gain, t + attack);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g).connect(ctx.destination);
            o.start(t); o.stop(t + dur + 0.02);
        }
        // filtered noise burst: low-pass sweeping lp0 → lp1
        function noise(t, { dur, lp0 = 800, lp1 = 150, gain, type = "lowpass", q = 0.7 }) {
            const len = Math.ceil(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buf.getChannelData(0);
            let seed = 0x2545f491;                        // deterministic noise (no Math.random)
            for (let i = 0; i < len; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 4294967296) * 2 - 1; }
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const f = ctx.createBiquadFilter();
            f.type = type; f.Q.value = q;
            f.frequency.setValueAtTime(lp0, t);
            f.frequency.exponentialRampToValueAtTime(Math.max(20, lp1), t + dur);
            const g = ctx.createGain();
            g.gain.setValueAtTime(gain, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            src.connect(f).connect(g).connect(ctx.destination);
            src.start(t); src.stop(t + dur + 0.02);
        }
        const SYNTH = {
            place: (t, v, r) => tone(t, { f0: 520 * r, f1: 380 * r, dur: 0.09, gain: v * 0.9 }),
            prime: (t, v, r, until) => noise(t, { dur: Math.max(0.15, until / 1000), lp0: 3500, lp1: 2500, gain: v * 0.35, type: "bandpass", q: 2 }),
            explode: (t, v, r) => { noise(t, { dur: 0.38, lp0: 1200 * r, lp1: 120, gain: v * 1.2 }); tone(t, { f0: 95 * r, f1: 38, dur: 0.28, gain: v * 1.1, attack: 0.01 }); },
            win: (t, v) => [523, 659, 784, 1047].forEach((f, k) => tone(t + k * 0.11, { type: "triangle", f0: f, dur: 0.32, gain: v * 0.8 })),
            lose: (t, v) => { tone(t, { type: "triangle", f0: 392, f1: 370, dur: 0.28, gain: v * 0.8 }); tone(t + 0.26, { type: "triangle", f0: 262, f1: 200, dur: 0.5, gain: v * 0.8 }); },
            over: (t, v) => { tone(t, { type: "triangle", f0: 440, dur: 0.22, gain: v * 0.7 }); tone(t + 0.24, { type: "triangle", f0: 440, dur: 0.34, gain: v * 0.7 }); },
            turn: (t, v) => { tone(t, { f0: 880, dur: 0.07, gain: v * 0.8 }); tone(t + 0.13, { f0: 1175, dur: 0.11, gain: v * 0.8 }); },
            reaction: (t, v, r) => tone(t, { f0: 300 * r, f1: 900 * r, dur: 0.08, gain: v * 0.7 }),
            chat: (t, v) => tone(t, { f0: 1320, f1: 1250, dur: 0.16, gain: v * 0.5 }),
        };

        function play(cue) {
            if (!ctx || cue.gain <= 0) return;
            const t = ctx.currentTime + 0.005;
            if (cue.set === "mc") {
                const buf = buffers[cue.url];
                if (!buf) { load(cue.url); return; }
                if (typeof buf === "string") return;      // still loading / failed: skip this one
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.playbackRate.value = cue.rate;
                src.connect(master(cue.gain, t));
                src.start(t);
                if (cue.until) src.stop(t + cue.until / 1000);
                return;
            }
            const fn = SYNTH[cue.name];
            if (fn) fn(t, cue.gain, cue.rate, cue.until);
        }

        return { play, unlock, get unlocked() { return unlocked; }, get state() { return ctx ? ctx.state : "none"; } };
    }

    function init(handlers) {
        seats = (handlers && handlers.seats) || seats;
        player = (handlers && handlers.player) || webAudioPlayer();
        for (const ev of ["game:move", "chain:prime", "chain:explode", "game:finish", "game:turn", "reaction", "chat"]) Bus.on(ev, (data) => handle(ev, data));
        if (player.unlock && typeof window !== "undefined") {
            const once = () => { player.unlock(); };
            for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, once, { capture: true, passive: true });
        }
        if (typeof Util !== "undefined" && Util.$("pref-test-sound")) Util.$("pref-test-sound").addEventListener("click", () => play("turn"));
    }

    return {
        init, map, play, handle, me, FILES, CATEGORY,
        get set() { return setName(); },
        get log() { return log.slice(); },
        get unlocked() { return !!(player && player.unlocked); },
        get state() { return player && player.state ? player.state : "none"; },
    };
})();
