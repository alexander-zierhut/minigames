import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

test("build writes hashed assets and a rewritten index.html", () => {
    const dist = mkdtempSync(join(tmpdir(), "minigames-dist-"));
    try {
        execFileSync("node", [join(ROOT, "build.mjs")], { env: { ...process.env, SKIP_MINIFY: "1", DIST_DIR: dist }, stdio: "pipe" });
        const html = readFileSync(join(dist, "index.html"), "utf8");
        const assets = readdirSync(join(dist, "assets"));
        const js = assets.find((f) => /^app\.[0-9a-f]{10}\.js$/.test(f));
        const css = assets.find((f) => /^main\.[0-9a-f]{10}\.css$/.test(f));
        assert.ok(js && css, "hashed js + css present");
        assert.ok(html.includes(`assets/${js}`) && html.includes(`assets/${css}`));
        assert.ok(!/client\//.test(html), "no references to client/ remain");
        assert.equal((html.match(/<script /g) || []).length, 1, "exactly one script tag");
        // every texture the css references exists on disk
        const cssText = readFileSync(join(dist, "assets", css), "utf8");
        for (const m of cssText.matchAll(/url\("textures\/([^"]+)"\)/g)) {
            assert.ok(existsSync(join(dist, "assets", "textures", m[1])), `texture ${m[1]} exists`);
            assert.match(m[1], /\.[0-9a-f]{10}\.png$/, "texture is hashed");
        }
        // every sound the bundle references exists on disk, hashed; no client/sounds path survives
        const bundle0 = readFileSync(join(dist, "assets", js), "utf8");
        const sounds = [...bundle0.matchAll(/assets\/sounds\/([A-Za-z0-9_.-]+\.ogg)/g)].map((m) => m[1]);
        assert.ok(sounds.length >= 8, `sounds referenced from the bundle (${sounds.length})`);
        for (const f of sounds) { assert.ok(existsSync(join(dist, "assets", "sounds", f)), `sound ${f} exists`); assert.match(f, /\.[0-9a-f]{10}\.ogg$/); }
        assert.ok(!/client\/sounds\/[A-Za-z0-9_]/.test(bundle0), "sound paths rewritten");
        // icons and the web app manifest referenced from index.html are copied, with every manifest icon
        for (const m of html.matchAll(/href="([^"]+\.(?:ico|png|json))"/g)) assert.ok(existsSync(join(dist, m[1])), `${m[1]} copied to dist`);
        const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
        assert.equal(manifest.display, "standalone");
        for (const icon of manifest.icons) assert.ok(existsSync(join(dist, icon.src)), `manifest icon ${icon.src} in dist`);
        assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "a maskable icon for Android");
        // bundle contains every client script and parses
        const bundle = readFileSync(join(dist, "assets", js), "utf8");
        for (const g of ["ChainGame", "FiveGame", "Clock", "Net", "Peer"]) assert.ok(bundle.includes(g), `bundle contains ${g}`);
        execFileSync("node", ["--check", join(dist, "assets", js)]);
        // build is deterministic: same input -> same hashes
        const dist2 = mkdtempSync(join(tmpdir(), "minigames-dist-"));
        execFileSync("node", [join(ROOT, "build.mjs")], { env: { ...process.env, SKIP_MINIFY: "1", DIST_DIR: dist2 }, stdio: "pipe" });
        assert.deepEqual(readdirSync(join(dist2, "assets")).sort(), assets.sort());
        rmSync(dist2, { recursive: true, force: true });
    } finally {
        rmSync(dist, { recursive: true, force: true });
    }
});
