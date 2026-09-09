#!/usr/bin/env node
/* Build: bundles the classic scripts into one hashed JS file, hashes CSS + textures,
   rewrites references and writes everything to dist/. No dependencies; esbuild is used
   for minification when available (npx), otherwise the bundle ships unminified.
   Hashed filenames = cache busting: index.html is served with no-cache, assets immutable. */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, basename, extname } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const DIST = process.env.DIST_DIR || join(ROOT, "dist");
const ASSETS = "assets";
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
const hashedName = (file, buf) => `${basename(file, extname(file))}.${hash(buf)}${extname(file)}`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, ASSETS, "textures"), { recursive: true });

let html = readFileSync(join(ROOT, "index.html"), "utf8");

/* ---- textures: hash each file, remember the mapping ---- */
const texMap = {};
for (const f of readdirSync(join(ROOT, "client/textures"))) {
    const buf = readFileSync(join(ROOT, "client/textures", f));
    const out = hashedName(f, buf);
    texMap[f] = out;
    writeFileSync(join(DIST, ASSETS, "textures", out), buf);
}

/* ---- css: rewrite texture urls, hash ---- */
let css = readFileSync(join(ROOT, "client/main.css"), "utf8");
css = css.replace(/url\("textures\/([^"]+)"\)/g, (m, f) => {
    if (!texMap[f]) throw new Error(`CSS references unknown texture ${f}`);
    return `url("textures/${texMap[f]}")`;
});
const cssName = hashedName("main.css", css);
writeFileSync(join(DIST, ASSETS, cssName), css);

/* ---- js: concatenate in the order index.html loads them ---- */
const scriptTags = [...html.matchAll(/<script src="(client\/[^"]+)"><\/script>\n?/g)];
if (scriptTags.length === 0) throw new Error("no client script tags found in index.html");
let bundle = scriptTags.map((m) => readFileSync(join(ROOT, m[1]), "utf8")).join("\n;\n");
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

/* ---- index.html: one css link, one script tag ---- */
html = html.replace(/<link href="client\/main.css" rel="stylesheet">/, `<link href="${ASSETS}/${cssName}" rel="stylesheet">`);
html = html.replace(scriptTags[0][0], `<script src="${ASSETS}/${jsName}"></script>\n`);
for (const m of scriptTags.slice(1)) html = html.replace(m[0], "");
if (/client\//.test(html)) throw new Error("index.html still references client/ after rewrite");
writeFileSync(join(DIST, "index.html"), html);

/* ---- optional extras ---- */
for (const f of ["favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "robots.txt"]) {
    if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(DIST, f));
}

const size = (p) => (readFileSync(p).length / 1024).toFixed(1) + " KB";
console.log(`dist/index.html\ndist/${ASSETS}/${jsName}  ${size(join(DIST, ASSETS, jsName))}\ndist/${ASSETS}/${cssName}  ${size(join(DIST, ASSETS, cssName))}\n${Object.keys(texMap).length} textures`);
