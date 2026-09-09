/* The event log in the HUD (#log): newest line first, a handful of lines kept.
   Line classes: p<k> (player colour), x (highlight). A chat would add lines here too. */

"use strict";

const Log = (() => {
    const MAX_LINES = 6;

    function add(text, cls) {
        const el = Util.$("log");
        if (!el) return;
        const line = document.createElement("div");
        if (cls) line.className = cls;
        line.textContent = text;
        el.prepend(line);
        while (el.children.length > MAX_LINES) el.lastChild.remove();
        Bus.emit("log", { text, cls });
    }

    function clear() {
        const el = Util.$("log");
        if (el) el.innerHTML = "";
    }

    return { add, clear };
})();
