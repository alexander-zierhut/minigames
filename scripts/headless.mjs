/* Loads the DOM-free part of the client (util, the rules, the bots) into a bare VM context
   so Node tools and tests can drive games and bots without a browser. The script list
   comes from index.html and every registered rules module is handed out under its own
   global name (`ChainRules`, `FiveRules`, …), so a new game or bot is picked up by itself. */
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

export const ROOT = new URL("../", import.meta.url).pathname;
const HEADLESS = /^client\/(lib\/util\.js|games\/rules\.js|games\/[a-z0-9-]+-rules\.js|bots\.js|bots\/[a-z0-9-]+\/(bot|benchmark)\.js)$/;

export function headlessScripts() {
    const html = readFileSync(ROOT + "index.html", "utf8");
    return [...html.matchAll(/<script src="(client\/[^"]+)"><\/script>/g)].map((m) => m[1]).filter((f) => HEADLESS.test(f));
}

// "five" -> "FiveRules": the global a rules module defines
const rulesName = (key) => key.replace(/(^|-)([a-z])/g, (m, _, c) => c.toUpperCase()) + "Rules";

export function loadHeadless() {
    const ctx = vm.createContext({ document: undefined, console, setTimeout, clearTimeout, Date, Math, JSON });
    for (const f of headlessScripts()) {
        if (!existsSync(ROOT + f)) continue;                 // benchmark.js is generated; absent before the first run
        vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
    }
    const H = vm.runInContext("({ Util, Rules, Bots })", ctx);
    for (const key of H.Rules.keys()) H[rulesName(key)] = H.Rules.of(key);
    return H;
}
