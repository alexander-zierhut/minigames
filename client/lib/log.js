/* The event log in the HUD (#log): newest line first, the last MAX_LINES kept, the box
   scrolls on desktop and shows the last two lines on phones. Line classes: p<k> (player
   colour), x (highlight), chat (a chat line: bold name + text, see chat.js). A line is
   added as a message descriptor ({ k, …params }, rendered by I18n.msg) and keeps it, so
   `relabel()` can say every line again in a new language (#47); chat lines are content
   and stay as they are. */

"use strict";

const Log = (() => {
    const MAX_LINES = 40;

    // one line into the box with that id; `name` (chat) is rendered bold before the text
    function line(id, text, cls, name) {
        const el = Util.$(id);
        if (!el) return null;
        const div = document.createElement("div");
        if (cls) div.className = cls;
        if (name !== undefined) {
            const b = document.createElement("b");
            b.textContent = name + ": ";
            div.appendChild(b);
            div.appendChild(document.createTextNode(text));    // textContent only: never HTML
        } else div.textContent = text;
        el.prepend(div);
        while (el.children.length > MAX_LINES) el.lastChild.remove();
        return div;
    }

    function add(msg, cls) {
        const text = I18n.msg(msg);
        const div = line("log", text, cls);
        if (div && msg && typeof msg === "object") div.dataset.msg = JSON.stringify(msg);   // kept for relabel
        Bus.emit("log", { text, msg, cls });
    }
    // the language changed: every line that knows its descriptor is said again
    function relabel(id = "log") {
        const el = Util.$(id);
        if (!el) return;
        for (const div of el.children) if (div.dataset.msg) div.textContent = I18n.msg(JSON.parse(div.dataset.msg));
    }

    // a chat line in the game log
    const chat = (name, text, cls) => line("log", text, cls, name);

    // a new game clears the HUD log but keeps the conversation
    function clear(id = "log", keepChat = id === "log") {
        const el = Util.$(id);
        if (!el) return;
        if (!keepChat) { el.innerHTML = ""; return; }
        for (const child of [...el.children]) if (!child.classList.contains("chat")) child.remove();
    }

    return { add, chat, clear, line, relabel, MAX_LINES };
})();
