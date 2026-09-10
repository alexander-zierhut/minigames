/* Chat inside the room: an input line under the HUD log (phones: behind the ☰ controls)
   and one in the lobby. Lines land in both logs in the sender's colour and go through
   the Bus (`chat`) so sounds can react. Only online: the rows are hidden otherwise and
   nothing is ever sent. Limits: 200 characters, one message per 300 ms (both when
   sending and when accepting), text only (textContent, never HTML). */

"use strict";

const Chat = (() => {
    const { $ } = Util;
    const MAX_LEN = 200, SEND_EVERY = 300, ACCEPT_EVERY = 300;
    const ROWS = [["chat-input", "chat-send"], ["lobby-chat-input", "lobby-chat-send"]];
    let lastMine = 0, lastTheirs = 0;
    let handlers = { onSend: () => false, name: (seat) => `Player ${seat + 1}`, me: () => -1, online: () => false };
    let count = 0;                                          // lines shown (tests)

    const clean = (text) => String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
    const cls = (seat) => (seat >= 0 && seat < 4 ? `chat p${seat}` : "chat x");

    // my line: shown at once, then sent (the host relays it; nobody echoes it back)
    function send(text) {
        text = clean(text);
        const now = Date.now();
        if (!text || !handlers.online() || now - lastMine < SEND_EVERY) return false;
        lastMine = now;
        const me = handlers.me();
        Log.chat(handlers.name(me), text, cls(me));
        count++;
        Bus.emit("chat", { text, from: me, mine: true });
        handlers.onSend(text);
        return true;
    }

    // a line from someone else (`from` = their seat, -1 = a spectator)
    function receive(msg) {
        const text = clean(msg && msg.text);
        const now = Date.now();
        if (!text || now - lastTheirs < ACCEPT_EVERY) return false;
        lastTheirs = now;
        const from = Number.isInteger(msg.from) ? msg.from : -1;
        Log.chat(handlers.name(from), text, cls(from));
        count++;
        Bus.emit("chat", { text, from, mine: false });
        return true;
    }

    function submit(inputId) {
        const input = $(inputId);
        if (send(input.value)) input.value = "";
    }

    // the rows exist only while online (body.online drives the CSS; inputs are disabled otherwise)
    function enable(on) {
        document.body.classList.toggle("online", !!on);
        for (const [inputId, btnId] of ROWS) { $(inputId).disabled = !on; $(btnId).disabled = !on; }
    }

    function init(h) {
        handlers = { ...handlers, ...h };
        for (const [inputId, btnId] of ROWS) {
            $(inputId).maxLength = MAX_LEN;
            $(btnId).addEventListener("click", () => submit(inputId));
            $(inputId).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(inputId); } });
        }
        enable(false);
    }

    return { init, send, receive, enable, MAX_LEN, SEND_EVERY, get count() { return count; } };
})();
