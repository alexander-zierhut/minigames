#!/usr/bin/env node
/* Build: writes dist/ with one hashed JS bundle (all client scripts in index.html
   order, minified with esbuild when available; sound paths rewritten), one hashed CSS
   file (all client stylesheets in index.html order, texture urls rewritten), hashed
   textures, hashed sounds and a rewritten index.html. Hashed filenames = cache busting: index.html is served with
   no-cache, assets are immutable. Env: DIST_DIR (default dist/), SKIP_MINIFY=1. */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, basename, extname } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const DIST = process.env.DIST_DIR || join(ROOT, "dist");
const ASSETS = "assets";
const ROOT_EXTRAS = ["favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "manifest.json", "changelog.json", "robots.txt"];
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
const hashedName = (file, buf) => `${basename(file, extname(file))}.${hash(buf)}${extname(file)}`;
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, ASSETS, "textures"), { recursive: true });
mkdirSync(join(DIST, ASSETS, "sounds"), { recursive: true });

let html = read("index.html");

/* ---- textures: hash each file, remember the mapping ---- */
const texMap = {};
for (const f of readdirSync(join(ROOT, "client/textures"))) {
    const buf = readFileSync(join(ROOT, "client/textures", f));
    texMap[f] = hashedName(f, buf);
    writeFileSync(join(DIST, ASSETS, "textures", texMap[f]), buf);
}

/* ---- sounds: hash each file (referenced from client/lib/sound.js as client/sounds/<name>.ogg) ---- */
const soundMap = {};
for (const f of existsSync(join(ROOT, "client/sounds")) ? readdirSync(join(ROOT, "client/sounds")) : []) {
    const buf = readFileSync(join(ROOT, "client/sounds", f));
    soundMap[f] = hashedName(f, buf);
    writeFileSync(join(DIST, ASSETS, "sounds", soundMap[f]), buf);
}

/* ---- css: concatenate in index.html order, rewrite texture urls, hash ---- */
const linkTags = [...html.matchAll(/<link rel="stylesheet" href="(client\/[^"]+)">\n?/g)];
if (linkTags.length === 0) throw new Error("no client stylesheet links found in index.html");
let css = linkTags.map((m) => read(m[1])).join("\n");
css = css.replace(/url\("\.\.\/textures\/([^"]+)"\)/g, (m, f) => {
    if (!texMap[f]) throw new Error(`CSS references unknown texture ${f}`);
    return `url("textures/${texMap[f]}")`;
});
const cssName = hashedName("main.css", css);
writeFileSync(join(DIST, ASSETS, cssName), css);

/* ---- js: concatenate in index.html order, minify ---- */
const scriptTags = [...html.matchAll(/<script src="(client\/[^"]+)"><\/script>\n?/g)];
if (scriptTags.length === 0) throw new Error("no client script tags found in index.html");
let bundle = scriptTags.map((m) => read(m[1])).join("\n;\n");
bundle = bundle.replace(/client\/sounds\/([A-Za-z0-9_.-]+)/g, (m, f) => {
    if (!soundMap[f]) throw new Error(`JS references unknown sound ${f}`);
    return `${ASSETS}/sounds/${soundMap[f]}`;
});
if (!process.env.SKIP_MINIFY) {
    const local = join(ROOT, "node_modules", ".bin", "esbuild");
    const [cmd, pre] = existsSync(local) ? [local, []] : ["npx", ["--yes", "esbuild@0.24.2"]];
    try {
        const minified = execFileSync(cmd, [...pre, "--minify", "--target=es2019", "--log-level=warning"],
            { input: bundle, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
        if (minified.trim().length > 0) bundle = minified;
    } catch (e) {
        console.warn("esbuild not available, shipping unminified bundle:", e.message.split("\n")[0]);
    }
}
const jsName = hashedName("app.js", bundle);
writeFileSync(join(DIST, ASSETS, jsName), bundle);

/* ---- index.html: one css link, one script tag, the version stamp ---- */
let version = new Date().toISOString().slice(0, 10);
let commit = "";
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, stdio: "pipe" }).toString().trim(); } catch (e) { /* not a git checkout */ }
if (commit) version = commit.slice(0, 7) + " " + version;
html = html.replace('<meta name="version" content="dev">', `<meta name="version" content="${version}">`);
html = html.replace(linkTags[0][0], `<link rel="stylesheet" href="${ASSETS}/${cssName}">\n`);
for (const m of linkTags.slice(1)) html = html.replace(m[0], "");
html = html.replace(scriptTags[0][0], `<script src="${ASSETS}/${jsName}"></script>\n`);
for (const m of scriptTags.slice(1)) html = html.replace(m[0], "");
html = html.replace(/^\s*<!-- (stylesheets|scripts) are concatenated[^\n]*\n/gm, "");
if (/client\//.test(html)) throw new Error("index.html still references client/ after rewrite");
writeFileSync(join(DIST, "index.html"), html);

/* ---- version.json: the same stamp next to index.html (#40). client/lib/update.js polls it
       on the title screen; the deploy uploads it with no-cache, so a page that has been open
       for a while notices a new build. ---- */
writeFileSync(join(DIST, "version.json"), JSON.stringify({ version, commit, builtAt: new Date().toISOString() }, null, 2) + "\n");

/* ---- root extras (icons) ---- */
for (const f of ROOT_EXTRAS) if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(DIST, f));

const size = (p) => (readFileSync(p).length / 1024).toFixed(1) + " KB";
console.log(`dist/index.html\ndist/${ASSETS}/${jsName}  ${size(join(DIST, ASSETS, jsName))}\ndist/${ASSETS}/${cssName}  ${size(join(DIST, ASSETS, cssName))}\n${Object.keys(texMap).length} textures, ${Object.keys(soundMap).length} sounds`);
