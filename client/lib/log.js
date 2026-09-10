/* The event log in the HUD (#log): newest line first, the last MAX_LINES kept, the box
   scrolls on desktop and shows the last two lines on phones. Line classes: p<k> (player
   colour), x (highlight), chat (a chat line: bold name + text, see chat.js). */

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

    function add(text, cls) {
        line("log", text, cls);
        Bus.emit("log", { text, cls });
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

    return { add, chat, clear, line, MAX_LINES };
})();
