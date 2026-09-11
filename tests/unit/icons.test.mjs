/* The line icons (client/lib/icons.js): every [data-icon] in index.html names a known icon
   and gets its SVG, Icons.set swaps one, and rows built later get theirs from the observer. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom } from "./dom.mjs";

test("every data-icon in the page is a known icon and is drawn as an SVG", async () => {
    const w = loadDom(); const d = w.document; const Icons = w.eval("Icons");
    const used = [...new Set([...d.querySelectorAll("[data-icon]")].map((e) => e.dataset.icon))];
    assert.ok(used.length >= 15, `the page uses a good number of icons (${used.length})`);
    for (const name of used) assert.ok(Icons.names().includes(name), `unknown icon "${name}"`);
    Icons.apply();
    assert.ok([...d.querySelectorAll("[data-icon]")].every((e) => e.querySelector("svg.ico")), "each one holds its SVG");
    // no emoji left where an icon belongs (the reactions bar and the bot persona are content, not icons)
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const el of d.querySelectorAll(".gear-icon, .corner-icon, .btn.icon, .bot-detail-icon, #gear, .lp-act")) assert.ok(!emoji.test(el.textContent), `emoji left in ${el.id || el.className}`);
    // set() swaps the icon of an element
    const el = d.createElement("span");
    Icons.set(el, "eye"); assert.equal(el.dataset.icon, "eye"); assert.equal(el.querySelectorAll("svg").length, 1);
    Icons.set(el, "eye-off"); assert.equal(el.dataset.icon, "eye-off"); assert.equal(el.querySelectorAll("svg").length, 1, "one SVG, not two");
    assert.equal(Icons.svg("nothing-like-this").innerHTML, "", "an unknown name draws nothing and throws nothing");
    // an element added later is filled in by the observer
    const late = d.createElement("i"); late.dataset.icon = "check"; d.body.appendChild(late);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(late.querySelector("svg.ico"), "the observer fills nodes added later");
    w.close();
});
