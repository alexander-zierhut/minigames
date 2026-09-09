/* Emoji reactions (YouTube-live style trash talk). The bar (#react-bar, top-right)
   starts collapsed; #react-layer is placed by place() right next to the board when
   there is room (desktop), else in the free strip above/below the full-width board on
   phones — never over the board, never off-screen. Spam is allowed on purpose. */

"use strict";

const Reactions = (() => {
    const { $ } = Util;
    const SEND_EVERY = 120, ACCEPT_EVERY = 100, MAX_ON_SCREEN = 14, LAYER_WIDTH = 60;
    let lastMine = 0, lastTheirs = 0;
    let allowed = new Set();
    let onSend = () => {};

    function init(handlers) {
        onSend = handlers.onSend || onSend;
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

    // drop a small element that pops in, tumbles down the layer and fades out
    function show(e, theirs, color) {
        const layer = $("react-layer");
        while (layer.children.length > MAX_ON_SCREEN) layer.firstChild.remove();
        const el = document.createElement("div");
        const isChip = e.length <= 3 && /^[A-Z]+$/.test(e);
        el.className = "react-float" + (isChip ? " chip" : "") + (theirs ? " theirs" : "");
        el.textContent = e;
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
        ], { duration: 1900, easing: "cubic-bezier(.2,.6,.3,1)", fill: "forwards" }).onfinish = () => el.remove();
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

    return { init, receive, place };
})();
