/* Chat + log: lines in both boxes with the sender's colour, limits (length, rate),
   text only, nothing sent offline, Bus events, chat survives a new game. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, wait } from "./dom.mjs";

function setup({ online = true, me = 0 } = {}) {
    const w = loadDom(); const d = w.document;
    const C = w.eval("Chat"), Bus = w.eval("Bus"), L = w.eval("Log");
    const sent = [], events = [];
    Bus.on("chat", (e) => events.push(e));
    let isOnline = online;
    C.init({ online: () => isOnline, me: () => me, name: (s) => (s >= 0 ? ["Cyan", "Amber", "Lime", "Rose"][s] : "Spectator"), onSend: (t) => { sent.push(t); return true; } });
    return { w, d, C, L, Bus, sent, events, setOnline: (v) => { isOnline = v; } };
}
const lines = (d, id = "log") => [...d.getElementById(id).children].map((el) => ({ text: el.textContent, cls: el.className }));

test("log: newest first, MAX_LINES kept, chat lines in both boxes, HTML never interpreted", () => {
    const { w, d, L } = setup();
    for (let k = 0; k < 50; k++) L.add(`line ${k}`, "x");
    assert.equal(d.getElementById("log").children.length, L.MAX_LINES);
    assert.equal(d.getElementById("log").firstChild.textContent, "line 49", "newest on top of the DOM (column-reverse shows it at the bottom)");
    L.chat("Amber", "<img src=x onerror=alert(1)> & <b>bold</b>", "chat p1");
    for (const id of ["log", "lobby-log"]) {
        const el = d.getElementById(id).firstChild;
        assert.equal(el.className, "chat p1", id);
        assert.equal(el.querySelector("img"), null, "no element created from the text");
        assert.equal(el.querySelector("b").textContent, "Amber: ");
        assert.equal(el.textContent, "Amber: <img src=x onerror=alert(1)> & <b>bold</b>");
    }
    L.room("Amber joined.");
    assert.equal(d.getElementById("lobby-log").firstChild.className, "x");
    assert.equal(d.getElementById("log").firstChild.className, "chat p1", "room events stay in the lobby log");
    w.close();
});

test("send: trimmed, cut to 200 chars, one per 300 ms, shown in my colour, sent, on the Bus", async () => {
    const { w, d, C, sent, events } = setup({ me: 1 });
    assert.equal(C.send("   "), false, "empty is not sent");
    assert.equal(C.send("  hello   there  "), true);
    assert.equal(sent[0], "hello there");
    assert.equal(lines(d)[0].text, "Amber: hello there");
    assert.equal(lines(d)[0].cls, "chat p1");
    assert.equal(lines(d, "lobby-log")[0].text, "Amber: hello there", "mirrored into the lobby box");
    assert.equal(events[0].mine, true); assert.equal(events[0].from, 1); assert.equal(events[0].text, "hello there");
    assert.equal(C.send("too fast"), false, "rate limited");
    await wait(C.SEND_EVERY + 20);
    assert.equal(C.send("x".repeat(500)), true);
    assert.equal(sent[1].length, C.MAX_LEN);
    assert.equal(C.count, 2);
    w.close();
});

test("receive: sender's seat colour, spectators neutral, garbage ignored, rate limited", async () => {
    const { w, d, C, events } = setup();
    assert.equal(C.receive({ text: "hi", from: 1 }), true);
    assert.equal(lines(d)[0].text, "Amber: hi"); assert.equal(lines(d)[0].cls, "chat p1");
    assert.equal(events[0].mine, false); assert.equal(events[0].from, 1);
    assert.equal(C.receive({ text: "spam", from: 1 }), false, "a second line within 300 ms is dropped");
    await wait(C.SEND_EVERY + 20);
    assert.equal(C.receive({ text: 12345, from: "x" }), true, "non-strings are stringified, unknown seats are neutral");
    assert.equal(lines(d)[0].text, "Spectator: 12345"); assert.equal(lines(d)[0].cls, "chat x");
    await wait(C.SEND_EVERY + 20);
    assert.equal(C.receive({ text: "<script>alert(1)</script>", from: 0 }), true);
    assert.equal(d.getElementById("log").querySelector("script"), null);
    await wait(C.SEND_EVERY + 20);
    assert.equal(C.receive(null), false);
    assert.equal(C.receive({ from: 0 }), false);
    w.close();
});

test("offline nothing is sent and the rows are disabled; the game log keeps chat across a new game", () => {
    const { w, d, C, L, sent, setOnline } = setup({ online: false });
    assert.equal(d.getElementById("chat-input").disabled, true);
    assert.equal(C.send("hello"), false);
    assert.equal(sent.length, 0);
    assert.equal(d.body.classList.contains("online"), false);
    C.enable(true); setOnline(true);
    assert.equal(d.getElementById("chat-input").disabled, false);
    assert.equal(d.body.classList.contains("online"), true);
    // Enter in the input sends and clears it
    const input = d.getElementById("lobby-chat-input");
    input.value = "via enter";
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
    assert.equal(sent[0], "via enter"); assert.equal(input.value, "");
    L.add("New game. Cyan starts.", "p0");
    L.clear();
    assert.equal(lines(d).map((l) => l.text).join("|"), "Cyan: via enter", "chat survives, game lines go");
    L.clear("lobby-log");
    assert.equal(d.getElementById("lobby-log").children.length, 0);
    w.close();
});
