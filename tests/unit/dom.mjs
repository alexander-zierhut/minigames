/* Loads index.html + the engine scripts into jsdom so the engines can be unit-tested
   against the real HUD markup. app.js is not loaded (it needs PeerJS, ResizeObserver…). */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCRIPTS = ["client/game.js", "client/five.js", "client/clock.js", "client/net.js"];

export function loadDom() {
    const html = readFileSync(ROOT + "index.html", "utf8").replace(/<script src="[^"]+"><\/script>/g, "");
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
    const w = dom.window;
    // Web Animations API is not in jsdom: resolve immediately
    w.Element.prototype.animate = function () { return { finished: Promise.resolve(), onfinish: null, cancel() {} }; };
    for (const f of SCRIPTS) {
        const el = w.document.createElement("script");
        el.textContent = readFileSync(ROOT + f, "utf8");
        w.document.body.appendChild(el);
    }
    return w;
}

export const NAMES = ["Cyan", "Amber"];

export function hooks(extra = {}) {
    const calls = { turns: [], busy: [], finish: null, moves: [] };
    const h = {
        get names() { return NAMES; },
        mayPlay: () => true,
        turnHint: () => "to move",
        onTurn: (p) => calls.turns.push(p),
        onBusy: (b) => calls.busy.push(b),
        onFinish: (w, why) => { calls.finish = { winner: w, why }; },
        onMoveApplied: (i, me) => calls.moves.push([i, me]),
        ...extra,
    };
    return { h, calls };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
