/* Tiny event bus. Modules announce what happened; anyone may listen without the
   announcer knowing (the future sound module subscribes here, so does a chat log).
   Events in use are listed in AGENTS.md ("Events"). */

"use strict";

const Bus = (() => {
    const listeners = new Map();

    function on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => off(event, fn);
    }
    function off(event, fn) {
        const set = listeners.get(event);
        if (set) set.delete(fn);
    }
    function emit(event, data) {
        const set = listeners.get(event);
        if (!set) return;
        for (const fn of [...set]) fn(data);
    }

    return { on, off, emit };
})();
