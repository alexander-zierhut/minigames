/* Emoji reactions (YouTube-live style trash talk). The bar (#react-bar, top-right)
   starts collapsed; #react-layer is placed by place() right next to the board when
   there is room (desktop), else in the free strip above/below the full-width board on
   phones — never over the board, never off-screen. Spam is allowed on purpose.
   Speed (#17): a single, occasional reaction floats slowly (~4 s) so it can be seen;
   the faster people react, the faster the emojis fall (durationFor: 0 shown in the
   last 3 s → slow, 1 → medium, ≥ 2 → fast ~1.9 s, own and received alike).
   Colour (#33): every floating reaction carries `--react-color`, the sender's seat
   colour (received: the colour Room/BotPersona passes in, own: the `color()` handler),
   which game.css turns into a light glow so you can see at a glance who sent it. */

"use strict";

const Reactions = (() => {
    const { $ } = Util;
    const SEND_EVERY = 120, ACCEPT_EVERY = 100, MAX_ON_SCREEN = 14, LAYER_WIDTH = 60;
    const SLOW_MS = 4000, MEDIUM_MS = 2800, FAST_MS = 1900, RATE_WINDOW = 3000;
    let lastMine = 0, lastTheirs = 0;
    let shown = [];                                   // when the recent reactions (own + received) appeared
    let allowed = new Set();
    let onSend = () => {};
    let myColor = () => "#ffffff";                    // my seat's colour, for the glow on my own reactions (#33)

    // how long a reaction floats, from how many were shown in the last RATE_WINDOW ms
    // before it (pure; no randomness so both sides of a room behave alike)
    function durationFor(recent) {
        return recent <= 0 ? SLOW_MS : recent === 1 ? MEDIUM_MS : FAST_MS;
    }
    // reactions shown within the window before `now` (drops the older ones)
    function recent(now) {
        shown = shown.filter((t) => now - t < RATE_WINDOW && t <= now);
        return shown.length;
    }

    function init(handlers) {
        onSend = handlers.onSend || onSend;
        myColor = handlers.color || myColor;
        const buttons = [...document.querySelectorAll("#react-bar .react-list button")];
        allowed = new Set(buttons.map((b) => b.dataset.e));
        buttons.forEach((b) => b.addEventListener("click", () => send(b.dataset.e)));
        $("react-toggle").addEventListener("click", () => $("react-bar").classList.toggle("collapsed"));
    }

    function send(e) {
        const now = Date.now();
        if (now - lastMine < SEND_EVERY) return;       // ~8 per second is plenty of spam
        lastMine = now;
        show(e, false);
        onSend(e);
    }

    // a reaction from the friend: only known values, at most one per 100 ms
    function receive(e, color) {
        const now = Date.now();
        if (!allowed.has(e) || now - lastTheirs < ACCEPT_EVERY) return;
        lastTheirs = now;
        show(e, true, color);
    }

    // the sender's colour: the friend's seat for a received one, my own seat otherwise (#33)
    function colorOf(theirs, color) {
        if (theirs) return color || "#ffffff";
        let mine;
        try { mine = myColor(); } catch (err) { mine = null; }
        return mine || "#ffffff";
    }

    // drop a small element that pops in, tumbles down the layer and fades out
    function show(e, theirs, color) {
        const layer = $("react-layer");
        while (layer.children.length > MAX_ON_SCREEN) layer.firstChild.remove();
        const now = Date.now();
        const duration = durationFor(recent(now));
        shown.push(now);
        const el = document.createElement("div");
        const isChip = e.length <= 3 && /^[A-Z]+$/.test(e);
        el.className = "react-float" + (isChip ? " chip" : "") + (theirs ? " theirs" : "");
        el.textContent = e;
        el.style.setProperty("--react-color", colorOf(theirs, color));   // the glow that says who sent it (#33)
        if (theirs && color) el.style.setProperty("--their-color", color);
        layer.appendChild(el);
        const drift = -(14 + Math.random() * 12);           // start a bit right, end a bit left
        const wob = (Math.random() - 0.5) * 30;
        const fall = Math.max(30, layer.clientHeight - 24);
        el.animate([
            { transform: "translate(calc(-50% + 12px), 0) scale(.6) rotate(0deg)", opacity: 0 },
            { transform: `translate(calc(-50% + 8px), ${Math.round(fall * 0.15)}px) scale(1.15) rotate(${wob * 0.3}deg)`, opacity: 1, offset: 0.15 },
            { transform: `translate(calc(-50% + ${drift * 0.6}px), ${Math.round(fall * 0.6)}px) scale(1) rotate(${wob}deg)`, opacity: .85, offset: 0.6 },
            { transform: `translate(calc(-50% + ${drift}px), ${fall}px) scale(.9) rotate(${-wob * 0.5}deg)`, opacity: 0 },
        ], { duration, easing: "cubic-bezier(.2,.6,.3,1)", fill: "forwards" }).onfinish = () => el.remove();
        Bus.emit("reaction", { emoji: e, theirs: !!theirs });
    }

    // position the layer relative to the board (called after every board fit)
    function place() {
        const r = $("board").getBoundingClientRect();
        const layer = $("react-layer");
        if (r.width === 0) return;
        const spaceRight = window.innerWidth - r.right;
        if (spaceRight >= LAYER_WIDTH + 6) {                 // desktop: right next to the board
            layer.style.left = Math.round(r.right + 4) + "px";
            layer.style.top = Math.round(r.top) + "px";
            layer.style.height = Math.round(r.height) + "px";
            return;
        }
        const above = r.top - 56;                            // below the reaction toggle
        const below = $("hut").getBoundingClientRect().top - r.bottom;
        layer.style.left = Math.round(window.innerWidth - LAYER_WIDTH - 8) + "px";
        if (above >= 70 || above >= below) {
            layer.style.top = "56px";
            layer.style.height = Math.max(40, Math.round(above - 4)) + "px";
        } else {
            layer.style.top = Math.round(r.bottom + 4) + "px";
            layer.style.height = Math.max(40, Math.round(below - 8)) + "px";
        }
    }

    return { init, receive, place, durationFor, recent, SLOW_MS, MEDIUM_MS, FAST_MS, RATE_WINDOW };
})();
