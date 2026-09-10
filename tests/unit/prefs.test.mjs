/* Preferences (⚙): per-device, defaults, clamping, persistence, form wiring. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom } from "./dom.mjs";

test("defaults: quiet volume, every sound category on, sound set follows the look", () => {
    const w = loadDom(); const P = w.eval("Prefs");
    const p = P.get();
    assert.equal(p.volume, 30);
    assert.equal(p.soundSet, "auto");
    assert.equal(JSON.stringify(P.CATEGORIES), JSON.stringify(["moves", "explosions", "results", "turn", "reactions", "chat"]));
    for (const c of P.CATEGORIES) assert.equal(p.sounds[c], true, c);
    assert.equal(p.hideCode, false, "rooms show their code unless asked (#19)");
    assert.equal(p.privateIp, false, "direct connections unless asked (#30)");
    assert.equal(p.developer, false, "no developer panel unless asked (#31)");
    w.close();
});

test("set merges, clamps and persists; a reload reads it back; garbage is ignored", () => {
    const w = loadDom(); const P = w.eval("Prefs");
    P.set({ volume: 250, sounds: { chat: false } });
    assert.equal(P.get().volume, 100, "clamped to 100");
    assert.equal(P.get().sounds.chat, false);
    assert.equal(P.get().sounds.moves, true, "other categories untouched");
    P.set({ volume: -5, soundSet: "nonsense" });
    assert.equal(P.get().volume, 0);
    assert.equal(P.get().soundSet, "auto", "unknown sound set falls back");
    P.set({ soundSet: "mc", hideCode: "yes", privateIp: 1 });
    assert.equal(P.get().hideCode, true, "coerced to a boolean");
    assert.equal(P.get().privateIp, true);
    const saved = JSON.parse(w.localStorage.getItem("chainreact.prefs"));
    assert.equal(saved.volume, 0); assert.equal(saved.soundSet, "mc"); assert.equal(saved.sounds.chat, false); assert.equal(saved.hideCode, true);
    w.close();
    // corrupt storage never throws (fail-safe Util.load/save)
    const w2 = loadDom(); const P2 = w2.eval("Prefs");
    w2.localStorage.setItem("chainreact.prefs", "{not json");
    assert.doesNotThrow(() => P2.set({ volume: 10 }));
    assert.equal(P2.get().volume, 10);
    w2.close();
});

test("init fills the form, form changes flow into the prefs and onChange", () => {
    const w = loadDom(); const P = w.eval("Prefs"); const d = w.document;
    const changes = [];
    P.init({ onChange: (p) => changes.push({ ...p }) });
    assert.equal(d.getElementById("pref-volume").value, "30");
    assert.equal(d.getElementById("pref-volume-val").textContent, "30 %");
    d.getElementById("pref-volume").value = "0";
    d.getElementById("pref-volume").dispatchEvent(new w.Event("input"));
    assert.equal(P.get().volume, 0);
    assert.equal(d.getElementById("pref-volume-val").textContent, "off");
    assert.ok(d.getElementById("prefs-modal").classList.contains("muted"));
    d.getElementById("pref-snd-turn").checked = false;
    d.getElementById("pref-snd-turn").dispatchEvent(new w.Event("change"));
    assert.equal(P.get().sounds.turn, false);
    d.getElementById("pref-hide-code").checked = true;
    d.getElementById("pref-hide-code").dispatchEvent(new w.Event("change"));
    assert.equal(P.get().hideCode, true);
    d.getElementById("pref-private-ip").checked = true;
    d.getElementById("pref-private-ip").dispatchEvent(new w.Event("change"));
    assert.equal(P.get().privateIp, true);
    assert.equal(changes.length, 4);
    // open / close
    assert.equal(P.isOpen, false);
    d.getElementById("prefs-btn").click();
    assert.equal(P.isOpen, true);
    d.getElementById("btn-prefs-done").click();
    assert.equal(P.isOpen, false);
    w.close();
});

test("feedback link: a GitHub new-issue URL with the situation prefilled, no room code", () => {
    const w = loadDom();
    const P = w.eval("Prefs");
    P.init({ context: () => ({ screen: "game", mode: "online", game: "five", settings: "9 × 9 · 5 in a row · no timer", players: 2, seat: 1, net: "connected as guest", look: "classic", sound: "auto 30 %", log: ["Cyan wins! 5 in a row!"] }) });
    const url = P.feedbackUrl();
    assert.ok(url.startsWith("https://github.com/alexander-zierhut/minigames/issues/new?title="));
    const body = decodeURIComponent(url.split("&body=")[1]);
    for (const part of ["- Screen: game", "- Mode: online", "- Game: five", "- Seat: 1", "- Connection: connected as guest", "- Version: dev", "Cyan wins!"]) assert.ok(body.includes(part), part);
    assert.ok(!/room|code/i.test(body.split("Last log")[0].replace("Version", "")), "no room code");
    let opened = null;
    w.window.open = (u) => { opened = u; return null; };
    w.document.getElementById("pref-feedback").click();
    assert.ok(opened && opened.includes("issues/new"));
    w.close();
});

test("sections (#32): the menu rows summarise their state, showSection opens one, Back returns", () => {
    const w = loadDom(); const P = w.eval("Prefs"); const d = w.document;
    P.init({});
    assert.equal(JSON.stringify(P.SECTIONS), JSON.stringify(["profile", "look", "sound", "streaming", "developer", "feedback"]));
    for (const key of P.SECTIONS) {
        assert.ok(d.getElementById("prefs-nav-" + key), "nav row for " + key);
        assert.ok(d.querySelector(`#prefs-panes .prefs-section[data-section="${key}"]`), "panel for " + key);
    }
    // the summaries describe the current state and land in the rows
    P.set({ name: "Robin" });
    assert.equal(P.sectionSummary("profile"), "Robin", "the profile row shows the name (#35)");
    assert.equal(d.getElementById("prefs-sum-profile").textContent, "Robin");
    assert.equal(P.sectionSummary("look"), "Classic");
    assert.equal(P.sectionSummary("sound"), "30 % · Follow the look");
    assert.equal(P.sectionSummary("streaming"), "off");
    assert.equal(P.sectionSummary("developer"), "off");
    assert.equal(P.sectionSummary("feedback"), "Report a problem");
    assert.equal(d.getElementById("prefs-sum-sound").textContent, "30 % · Follow the look");
    P.set({ volume: 0 });
    assert.equal(P.sectionSummary("sound"), "off", "muted");
    P.set({ volume: 55, soundSet: "mc" });
    assert.equal(P.sectionSummary("sound"), "55 % · Blocks");
    assert.equal(d.getElementById("prefs-sum-sound").textContent, "55 % · Blocks", "the row follows a change");
    P.set({ hideCode: true });
    assert.equal(P.sectionSummary("streaming"), "Code hidden");
    P.set({ privateIp: true });
    assert.equal(P.sectionSummary("streaming"), "Code hidden · IP private");
    P.set({ developer: true });
    assert.equal(P.sectionSummary("developer"), "on");
    w.eval("Skins").set("mc");
    assert.equal(P.sectionSummary("look"), "Blocks");
    w.eval("Skins").set("classic");
    // one panel at a time; the card marks that a section is open (phones hide the menu by it)
    P.showSection("sound");
    assert.equal(P.section, "sound");
    assert.equal(d.querySelector('#prefs-panes .prefs-section[data-section="sound"]').hidden, false);
    assert.equal(d.querySelector('#prefs-panes .prefs-section[data-section="look"]').hidden, true);
    assert.ok(d.getElementById("prefs-card").classList.contains("on-section"));
    assert.ok(d.getElementById("prefs-nav-sound").classList.contains("selected"));
    d.getElementById("prefs-nav-streaming").click();
    assert.equal(P.section, "streaming");
    assert.equal(d.getElementById("prefs-nav-sound").classList.contains("selected"), false);
    d.getElementById("btn-prefs-back").click();
    assert.equal(P.section, null, "back to the menu");
    assert.equal(d.getElementById("prefs-card").classList.contains("on-section"), false);
    assert.equal(d.querySelectorAll("#prefs-panes .prefs-section:not([hidden])").length, 0);
    P.showSection("nonsense");
    assert.equal(P.section, null, "an unknown section is the menu");
    w.close();
});

test("name (#35): a default from the list on the first visit, kept from then on", () => {
    const w = loadDom(); const P = w.eval("Prefs");
    const name = P.get().name;
    assert.ok(P.DEFAULT_NAMES.includes(name), "the first visit draws one of the default names: " + name);
    assert.equal(JSON.parse(w.localStorage.getItem("chainreact.prefs")).name, name, "persisted at once, so it never changes by itself");
    assert.equal(P.get().defaultName, name, "the drawn name is also the fallback of an empty one");
    assert.equal(P.DEFAULT_NAMES.length, new Set(P.DEFAULT_NAMES).size, "no duplicates in the pool");
    for (const n of P.DEFAULT_NAMES) assert.ok(n === P.cleanName(n) && n.length <= P.NAME_MAX, n);
    P.set({ volume: 40 });
    assert.equal(P.get().name, name, "an unrelated change never redraws the name");
    w.close();
});

test("name (#35): cleaned and cut to 16, an empty one falls back to the drawn default", () => {
    const w = loadDom(); const P = w.eval("Prefs");
    assert.equal(P.NAME_MAX, 16);
    assert.equal(P.cleanName("  Ali   ce \n"), "Ali ce", "trimmed, runs of whitespace collapsed");
    assert.equal(P.cleanName("abcdefghijklmnopqrstuvwxyz").length, 16, "cut to the maximum");
    assert.equal(P.cleanName(null), "");
    const drawn = P.get().defaultName;
    P.set({ name: "  Bo  " });
    assert.equal(P.get().name, "Bo");
    P.set({ name: "0123456789abcdefghij" });
    assert.equal(P.get().name, "0123456789abcdef");
    P.set({ name: "   " });
    assert.equal(P.get().name, drawn, "an empty name falls back to the name that was drawn");
    assert.equal(JSON.parse(w.localStorage.getItem("chainreact.prefs")).name, drawn, "persisted");
    w.close();
});

test("name (#35): the seats on one device are me plus the first default names that are not mine", () => {
    const w = loadDom(); const P = w.eval("Prefs");
    P.set({ name: "Robin" });
    const rest = P.DEFAULT_NAMES.filter((n) => n !== "Robin");
    assert.equal(JSON.stringify(P.seatNames(4)), JSON.stringify(["Robin", rest[0], rest[1], rest[2]]));
    assert.equal(JSON.stringify(P.seatNames(2)), JSON.stringify(["Robin", rest[0]]));
    assert.equal(JSON.stringify(P.seatNames(4)), JSON.stringify(P.seatNames(4)), "deterministic");
    // taking one of the default names for myself never puts it on two seats
    P.set({ name: P.DEFAULT_NAMES[1] });
    const seats = P.seatNames(4);
    assert.equal(seats[0], P.DEFAULT_NAMES[1]);
    assert.equal(new Set(seats).size, 4, "four different names");
    w.close();
});

test("name (#35): the form field fills from the prefs and writes back on change", () => {
    const w = loadDom(); const P = w.eval("Prefs"); const d = w.document;
    P.set({ name: "Robin" });
    const changes = [];
    P.init({ onChange: (p) => changes.push(p.name) });
    const input = d.getElementById("pref-name");
    assert.equal(input.value, "Robin");
    assert.equal(input.getAttribute("maxlength"), "16");
    assert.equal(input.getAttribute("autocomplete"), "off");
    input.value = "  Sam  ";
    input.dispatchEvent(new w.Event("change"));
    assert.equal(P.get().name, "Sam");
    assert.equal(input.value, "Sam", "the field shows the cleaned name");
    assert.equal(changes.at(-1), "Sam");
    w.close();
});

