/* Chess-style clock: each player has a fixed budget. Only the current player's clock
   runs, and it pauses while explosions animate. */

"use strict";

const Clock = (() => {
    let remaining = [0, 0];
    let active = -1;        // player whose clock is running, -1 = none
    let paused = true;
    let lastTick = 0;
    let timer = null;
    let onFlag = null;      // (player) => void
    let enabled = false;

    const $ = (id) => document.getElementById(id);

    function fmt(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(s / 60);
        const r = s % 60;
        if (ms < 10000 && ms > 0) return `${m}:${String(r).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
        return `${m}:${String(r).padStart(2, "0")}`;
    }

    function render() {
        for (let k = 0; k < 2; k++) {
            const el = $(`clock-${k}`);
            el.hidden = !enabled;
            if (!enabled) continue;
            el.textContent = fmt(remaining[k]);
            el.classList.toggle("running", active === k && !paused);
            el.classList.toggle("low", remaining[k] < 20000);
        }
    }

    function tick() {
        if (paused || active < 0) return;
        const now = performance.now();
        remaining[active] -= now - lastTick;
        lastTick = now;
        if (remaining[active] <= 0) {
            remaining[active] = 0;
            const p = active;
            stop();
            render();
            if (onFlag) onFlag(p);
            return;
        }
        render();
    }

    function setup(seconds, flagHandler) {
        enabled = seconds > 0;
        remaining = [seconds * 1000, seconds * 1000];
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
