/* Chess-style clock: every player has the same budget, only the current player's
   clock runs. The app pauses it while animations run and while the friend is away.
   Elements: #clock-<k> inside the HUD player cards (missing ones are skipped). */

"use strict";

const Clock = (() => {
    let remaining = [];     // ms per player
    let active = -1;        // player whose clock is running, -1 = none
    let paused = true;
    let lastTick = 0;
    let timer = null;
    let onFlag = null;      // (player) => void
    let enabled = false;

    function fmt(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(s / 60);
        const r = String(s % 60).padStart(2, "0");
        if (ms < 10000 && ms > 0) return `${m}:${r}.${Math.floor((ms % 1000) / 100)}`;
        return `${m}:${r}`;
    }

    function render() {
        remaining.forEach((ms, k) => {
            const el = Util.$(`clock-${k}`);
            if (!el) return;
            el.hidden = !enabled;
            if (!enabled) return;
            el.textContent = fmt(ms);
            el.classList.toggle("running", active === k && !paused);
            el.classList.toggle("low", ms < 20000);
        });
    }

    function tick() {
        if (paused || active < 0) return;
        const now = performance.now();
        remaining[active] -= now - lastTick;
        lastTick = now;
        if (remaining[active] <= 0) {
            remaining[active] = 0;
            const flagged = active;
            stop();
            if (onFlag) onFlag(flagged);
            return;
        }
        render();
    }

    // seconds <= 0 disables the clock (hidden, never flags)
    function setup(seconds, flagHandler, players = 2) {
        enabled = seconds > 0;
        remaining = new Array(players).fill(seconds * 1000);
        onFlag = flagHandler;
        active = -1;
        paused = true;
        if (timer) clearInterval(timer);
        timer = enabled ? setInterval(tick, 100) : null;
        render();
    }

    function setActive(player) {
        if (!enabled) return;
        active = player;
        lastTick = performance.now();
        render();
    }

    function pause() {
        if (!enabled || paused) return;
        tick();
        paused = true;
        render();
    }

    function resume() {
        if (!enabled || !paused) return;
        paused = false;
        lastTick = performance.now();
        render();
    }

    function stop() {
        paused = true;
        active = -1;
        render();
    }

    function snapshot() { return remaining.slice(); }
    function restore(values) { if (values) remaining = values.slice(); render(); }

    return { setup, setActive, pause, resume, stop, snapshot, restore, isEnabled: () => enabled };
})();
