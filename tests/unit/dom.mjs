/* Loads index.html + every client script except app.js into jsdom, so the engines,
   HUD, clock, settings … can be unit-tested against the real markup. app.js is left
   out because it boots the app (PeerJS, ResizeObserver, texture preload). */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const HTML = readFileSync(ROOT + "index.html", "utf8");
export const SCRIPTS = [...HTML.matchAll(/<script src="(client\/[^"]+)"><\/script>/g)]
    .map((m) => m[1])
    .filter((f) => !f.includes("/vendor/") && f !== "client/app.js");

export function loadDom() {
    const html = HTML.replace(/<script src="[^"]+"><\/script>/g, "");
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

export const NAMES = ["Cyan", "Amber", "Lime", "Rose"];

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
