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
    P.set({ soundSet: "mc" });
    const saved = JSON.parse(w.localStorage.getItem("chainreact.prefs"));
    assert.equal(saved.volume, 0); assert.equal(saved.soundSet, "mc"); assert.equal(saved.sounds.chat, false);
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
    assert.equal(changes.length, 2);
    // open / close
    assert.equal(P.isOpen, false);
    d.getElementById("prefs-btn").click();
    assert.equal(P.isOpen, true);
    d.getElementById("btn-prefs-done").click();
    assert.equal(P.isOpen, false);
    w.close();
});
