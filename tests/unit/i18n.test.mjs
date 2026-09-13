/* Translations (#47): the module itself (lookup, plurals, placeholders, descriptors, the
   browser's language, the writing direction), every language file carrying exactly the
   English key set with the same placeholders and no em dash, the static markup keyed to
   the very texts it shows, the bots' texts reachable by key, and the lint that keeps every
   user-facing string in the client out of the code and in the language files. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadDom } from "./dom.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;

// the dictionaries straight from the files, without a DOM
function dicts() {
    const out = {};
    for (const f of readdirSync(join(ROOT, "client/lang")).filter((f) => f.endsWith(".js"))) {
        const src = readFileSync(join(ROOT, "client/lang", f), "utf8");
        new Function("I18n", src)({ add: (code, dict) => { out[code] = dict; } });
    }
    return out;
}
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const words = (s) => String(s).replace(/\{\w+\}/g, "").trim();

test("every language carries exactly the English keys, with the same placeholders, plural forms and no em dash", () => {
    const all = dicts();
    const en = all.en;
    assert.ok(en && Object.keys(en).length > 500, "English is the source");
    const codes = Object.keys(all);
    for (const code of ["en", "de", "es", "fr", "ja", "ar"]) assert.ok(all[code], `${code} is spoken`);
    for (const code of codes) {
        const d = all[code];
        const missing = Object.keys(en).filter((k) => !(k in d));
        const extra = Object.keys(d).filter((k) => !(k in en));
        assert.deepEqual(missing, [], `${code}: keys missing`);
        assert.deepEqual(extra, [], `${code}: keys that English does not have`);
        for (const [k, v] of Object.entries(d)) {
            const e = en[k];
            const values = typeof v === "object" ? Object.values(v) : [v];
            if (typeof e === "object") {
                assert.equal(typeof v, "object", `${code}: ${k} is a plural entry in English`);
                assert.ok(typeof v.other === "string", `${code}: ${k} needs the "other" form`);
                for (const [cat, form] of Object.entries(v)) {
                    assert.ok(["zero", "one", "two", "few", "many", "other"].includes(cat), `${code}: ${k} has an unknown plural category ${cat}`);
                    assert.equal(placeholders(form), placeholders(e.other), `${code}: ${k}.${cat} carries the English placeholders`);
                }
            } else {
                assert.equal(typeof v, "string", `${code}: ${k} is a plain text in English`);
                assert.equal(placeholders(v), placeholders(e), `${code}: ${k} carries the English placeholders`);
            }
            for (const text of values) {
                assert.ok(!/—/.test(text), `${code}: ${k} has an em dash (#24)`);
                assert.ok(!/(?<![\d}])–|–(?![\d{])/.test(text), `${code}: ${k} uses an en dash outside a number range (#24)`);
                assert.ok(!/minecraft/i.test(text), `${code}: ${k} names the block game`);
                assert.ok(words(text).length > 0 || words(e.other || e).length === 0, `${code}: ${k} is empty`);
            }
        }
    }
});

test("I18n: lookup, fallback, plurals, placeholders, descriptors, detection and direction", () => {
    const w = loadDom(); const I18n = w.eval("I18n");
    assert.equal(I18n.lang, "en", "English until init picks a language");
    assert.equal(I18n.t("menu.create"), "Create room");
    assert.equal(I18n.t("no.such.key"), "no.such.key", "an unknown key shows itself");
    assert.equal(I18n.t("lobby.spectators", { count: 1 }), "1 spectator watching");
    assert.equal(I18n.t("lobby.spectators", { count: 3 }), "3 spectators watching");
    assert.equal(I18n.t("log.newGame", { name: "Robin" }), "New game. Robin starts.");
    assert.equal(I18n.msg({ k: "why.five.row", n: 5 }), "5 in a row!", "a descriptor from the rules");
    assert.equal(I18n.msg("Out of time!"), "Out of time!", "an older record's text passes through");
    assert.equal(I18n.msg({ k: "learn.text.play", level: { k: "level.easy" } }), "Win this game from here against the Easy bot. A draw is not enough.", "a descriptor inside a descriptor");
    assert.equal(I18n.detect(["fr-CH", "en"]), "fr");
    assert.equal(I18n.detect(["pt-BR", "de-AT"]), "de");
    assert.equal(I18n.detect(["pt-BR"]), "en", "an unknown language falls back to English");
    assert.equal(I18n.detect([]), "en");
    assert.equal(I18n.init("de"), "de");
    assert.equal(I18n.t("menu.create"), "Raum erstellen");
    assert.equal(w.document.documentElement.lang, "de"); assert.equal(w.document.documentElement.dir, "ltr");
    assert.equal(w.document.getElementById("btn-create").textContent, "Raum erstellen", "the markup follows");
    assert.equal(I18n.init("ar"), "ar");
    assert.equal(w.document.documentElement.dir, "rtl", "Arabic reads right to left");
    assert.equal(I18n.init("ja"), "ja");
    assert.ok(I18n.t("lobby.spectators", { count: 2 }).includes("2"), "Japanese has one plural form and still counts");
    assert.equal(I18n.init("auto"), "en", "jsdom speaks English");
    assert.equal(I18n.init("xx"), "en", "an unknown preference means the browser's choice");
    assert.ok(I18n.flag("de").querySelector("rect"), "a flag is an SVG");
    w.close();
});

test("the static markup: every text and every title / placeholder / aria-label is keyed to the English text it shows", () => {
    const w = loadDom(); const d = w.document; const en = dicts().en;
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const roots = [d.body, ...[...d.querySelectorAll("template")].map((t) => t.content)];
    const offenders = [];
    for (const root of roots) {
        const walker = d.createTreeWalker(root, w.NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = norm(node.textContent);
            if (!/\p{L}{2,}/u.test(text)) continue;                       // symbols, numbers, "…"
            const el = node.parentElement;
            if (["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) continue;
            if (el.closest("#react-bar")) continue;                         // the reaction chips are content
            const key = el.dataset.i18n;
            if (!key) { offenders.push(`text "${text}" in <${el.tagName.toLowerCase()} id="${el.id}"> has no data-i18n`); continue; }
            if (el.children.length) offenders.push(`<${el.tagName.toLowerCase()} data-i18n="${key}"> holds child elements that the text would replace`);
            if (en[key] === undefined) offenders.push(`data-i18n="${key}" is not a key`);
            else if (norm(String(en[key])) !== text) offenders.push(`data-i18n="${key}" shows "${text}" but English says "${en[key]}"`);
        }
        for (const [attr, data] of [["title", "data-i18n-title"], ["placeholder", "data-i18n-placeholder"], ["aria-label", "data-i18n-aria"]]) {
            for (const el of root.querySelectorAll(`[${attr}]`)) {
                const text = norm(el.getAttribute(attr));
                if (!/\p{L}{2,}/u.test(text)) continue;
                const key = el.getAttribute(data);
                if (!key) { offenders.push(`${attr}="${text}" on #${el.id} has no ${data}`); continue; }
                if (en[key] === undefined) offenders.push(`${data}="${key}" is not a key`);
                else if (norm(String(en[key])) !== text) offenders.push(`${data}="${key}" says "${text}" but English says "${en[key]}"`);
            }
        }
    }
    assert.deepEqual(offenders, []);
    w.close();
});

test("the bots' texts are reachable by key: a description per bot and a name per difficulty", () => {
    const w = loadDom(); const Bots = w.eval("Bots"); const en = dicts().en;
    for (const b of Bots.list()) {
        assert.ok(typeof en[`bot.${b.id}.desc`] === "string", `bot.${b.id}.desc`);
        for (const dd of b.difficulties) assert.ok(typeof en[`level.${dd.id}`] === "string", `level.${dd.id}`);
    }
    w.close();
});

/* The lint. A user-facing string literal in the client is one that holds two words with
   letters (a sentence, a label); such literals belong in client/lang/*.js and reach the code
   as keys. Left out: the vendored PeerJS, the language files themselves, the developer
   panel (dev.js, English by design) and the bots (headless; their texts reach the UI
   through `bot.<id>.desc` / `level.<id>`). Lines that need an English literal (a CSS
   selector, an error for the console) are known by their shape, anything else by an
   `// i18n-ignore` comment or an `i18n-ignore-start` … `i18n-ignore-end` block. */
function literals(src) {
    const out = [];
    let i = 0, line = 1, prevSignificant = "";
    const push = (s, at) => out.push({ text: s, line: at });
    while (i < src.length) {
        const c = src[i], next = src[i + 1];
        if (c === "\n") { line++; i++; continue; }
        if (c === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
        if (c === "/" && next === "*") { const end = src.indexOf("*/", i + 2); const chunk = src.slice(i, end + 2); line += (chunk.match(/\n/g) || []).length; i = end + 2; continue; }
        if (c === '"' || c === "'" || c === "`") {
            const q = c, at = line; let j = i + 1, s = "";
            while (j < src.length && src[j] !== q) {
                if (src[j] === "\\") { s += src[j + 1]; j += 2; continue; }
                if (q === "`" && src[j] === "$" && src[j + 1] === "{") {          // skip an interpolation (depth-aware)
                    let depth = 1; j += 2;
                    while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; if (src[j] === "\n") line++; j++; }
                    s += " ";
                    continue;
                }
                if (src[j] === "\n") line++;
                s += src[j]; j++;
            }
            push(s, at);
            i = j + 1; prevSignificant = q;
            continue;
        }
        if (c === "/" && /[(,=:\[!&|?{};\n]|^$/.test(prevSignificant)) {                  // a regex literal
            let j = i + 1, cls = false;
            while (j < src.length && (cls || src[j] !== "/") && src[j] !== "\n") { if (src[j] === "\\") j++; else if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; j++; }
            i = j + 1; prevSignificant = "/"; continue;
        }
        if (!/\s/.test(c)) prevSignificant = c;
        i++;
    }
    return out;
}
const SENTENCE = /\p{L}{2,}[,.!?'’]?\s+\p{L}{2,}/u;                                   // two words with letters, a space between
const SAFE_LINE = /querySelector|matches\(|closest\(|cssText|new Error\(|fail\(|console\.|throw |i18n-ignore|\.className|className:|dataset\.|setAttribute\("(class|role|aria-(haspopup|expanded|selected))"|\.classList|addEventListener|"use strict"|https?:|\.replace\(|split\(|test\(|localStorage|sessionStorage|\bKEY\b|meta\[name/;
const SAFE_TEXT = /^(translate|rotate|scale|matrix)\(|\d(px|deg|ms|%)\b/;                        // CSS values (keyframes)
function lintFile(rel) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const lines = src.split("\n");
    const ignored = new Set();
    let on = false;
    lines.forEach((l, k) => { if (l.includes("i18n-ignore-start")) on = true; if (on) ignored.add(k + 1); if (l.includes("i18n-ignore-end")) on = false; });
    const bad = [];
    for (const { text, line } of literals(src)) {
        if (ignored.has(line)) continue;
        const plain = text.replace(/<[^>]*>/g, " ");                                  // markup templates: only their text counts
        if (!SENTENCE.test(plain) || SAFE_TEXT.test(plain)) continue;
        if (SAFE_LINE.test(lines.slice(Math.max(0, line - 2), line + 1).join("\n"))) continue;   // the line, give or take one
        bad.push(`${rel}:${line}: "${text.slice(0, 70)}"`);
    }
    return bad;
}
function clientFiles(dir = "client") {
    const out = [];
    for (const f of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${f}`;
        if (statSync(join(ROOT, rel)).isDirectory()) { if (!["client/vendor", "client/lang", "client/bots"].includes(rel)) out.push(...clientFiles(rel)); }
        else if (f.endsWith(".js") && rel !== "client/dev.js") out.push(rel);
    }
    return out;
}

test("no user-facing string literal lives in the client code: every sentence is a key of the language files", () => {
    const files = clientFiles();
    assert.ok(files.length > 30, "the client is scanned");
    const bad = files.flatMap(lintFile);
    assert.deepEqual(bad, [], "user-facing literals (move them to client/lang/en.js, or mark a deliberate one with // i18n-ignore)");
});
