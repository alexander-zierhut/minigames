/* End-to-end harness: a static file server + headless Chrome driven over the DevTools
   protocol (no Playwright). Node >= 22 (global fetch + WebSocket). */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

export const ROOT = new URL("../../", import.meta.url).pathname;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// every board's cells in cell order (chain tiles, five stones, Käsekästchen lines) and
// the key of the running game, read off the body class
const CELLS = JSON.stringify("#board > .cell, #board > .stone, #board > .edge");
const GAME_KEY = "String(document.body.className.split(' ').find(c => c.startsWith('game-'))).slice(5)";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".ogg": "audio/ogg" };

/* ---------- static server ---------- */
export async function startServer(root = ROOT) {
    const server = createServer(async (req, res) => {
        try {
            let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
            if (path.endsWith("/")) path += "index.html";
            const file = join(root, path);
            if (!file.startsWith(root)) throw new Error("outside root");
            const st = await stat(file);
            const body = await readFile(st.isDirectory() ? join(file, "index.html") : file);
            res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
            res.end(body);
        } catch (e) {
            res.writeHead(404); res.end("not found");
        }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    return { url, close: () => new Promise((r) => server.close(r)) };
}

/* ---------- chrome ---------- */
function chromePath() {
    if (process.env.CHROME) return process.env.CHROME;
    for (const c of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
        try { return execSync(`command -v ${c}`, { stdio: "pipe" }).toString().trim(); } catch (e) { /* next */ }
    }
    throw new Error("no Chrome found; set CHROME=/path/to/chrome");
}

// Chrome picks a free debugging port itself (--remote-debugging-port=0) and writes it to
// DevToolsActivePort in the profile: no port collisions between parallel test files.
async function spawnChrome(profile, width, height) {
    let stderr = "";
    const proc = spawn(chromePath(), [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--disable-dev-shm-usage",
        `--user-data-dir=${profile}`, "--remote-debugging-port=0", `--window-size=${Math.max(width, 500)},${height}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (d) => { stderr += d; });
    const portFile = join(profile, "DevToolsActivePort");
    let target = null, port = 0;
    for (let i = 0; i < 240 && !target; i++) {          // up to 60 s: a 2-core CI runner with several Chromes up is slow
        try {
            if (!port && existsSync(portFile)) port = parseInt(readFileSync(portFile, "utf8").split("\n")[0], 10);
            if (port) {
                const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
                target = list.find((t) => t.type === "page");
            }
        } catch (e) { /* not up yet */ }
        if (!target) await sleep(250);
    }
    if (!target) { proc.kill("SIGKILL"); throw new Error("chrome did not start\n" + stderr.slice(-800)); }
    return { proc, target };
}

export async function launchBrowser({ width = 1400, height = 900, mobile = false } = {}) {
    const profile = mkdtempSync(join(tmpdir(), "minigames-chrome-"));
    let launched;
    try { launched = await spawnChrome(profile, width, height); }
    catch (e) { console.warn("chrome launch failed once, retrying:", e.message.split("\n")[0]); await sleep(2000); launched = await spawnChrome(profile, width, height); }
    const { proc, target } = launched;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    const errors = [], failedRequests = [], requests = [];
    ws.onmessage = (ev) => {
        const j = JSON.parse(ev.data);
        if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); return; }
        if (j.method === "Runtime.exceptionThrown") errors.push(j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text);
        if (j.method === "Runtime.consoleAPICalled" && j.params.type === "error") errors.push("console.error: " + j.params.args.map((a) => a.value ?? a.description).join(" "));
        if (j.method === "Network.responseReceived") { requests.push(j.params.response.url); if (j.params.response.status >= 400 && !/favicon\.ico$/.test(j.params.response.url)) failedRequests.push(`${j.params.response.status} ${j.params.response.url}`); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
        const i = ++id; pending.set(i, (j) => (j.error ? rej(new Error(j.error.message)) : res(j.result)));
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    if (mobile || width < 500) await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });

    const B = {
        errors, failedRequests, requests, width, height,
        async ev(expr) {
            const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error("page eval failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + "\n  expr: " + expr.slice(0, 200));
            return r.result.value;
        },
        async goto(url) {
            await send("Page.navigate", { url });
            // deterministic bots in tests: the app seeds a bot from sessionStorage["chainreact.botseed"] when present
            await send("Runtime.evaluate", { expression: "try { sessionStorage.setItem('chainreact.botseed', '4242'); } catch (e) {}" }).catch(() => {});
            for (let i = 0; i < 100; i++) {
                await sleep(200);
                try { if (await B.ev("typeof FiveGame !== 'undefined' && typeof Net !== 'undefined' && !!document.getElementById('btn-local')")) break; } catch (e) { /* not ready */ }
            }
            // wait for the texture preloader to finish
            for (let i = 0; i < 50; i++) { if (await B.ev("document.getElementById('loader').hidden")) break; await sleep(100); }
            await sleep(150);
        },
        // leave the app without any goodbye (closing the tab), keeping the browser for a later goto
        async blank() { await send("Page.navigate", { url: "about:blank" }); await sleep(300); },
        // pick a file in an <input type="file"> the way a person would (no OS dialog):
        // CDP sets the files, and Chrome fires `change` for it — if it ever doesn't, the
        // event is dispatched here so the test still tests the app, not the protocol.
        async upload(sel, path) {
            await B.ev(`(() => { window.__uploads = 0; document.querySelector(${JSON.stringify(sel)}).addEventListener("change", () => window.__uploads++, { once: true }); return true; })()`);
            await send("DOM.enable");
            const { root } = await send("DOM.getDocument", { depth: 1 });
            const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
            if (!nodeId) throw new Error("no file input " + sel);
            await send("DOM.setFileInputFiles", { files: [path], nodeId });
            for (let i = 0; i < 10 && !(await B.ev("window.__uploads")); i++) await sleep(100);
            if (!(await B.ev("window.__uploads"))) await B.ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new Event("change"))`);
        },
        async emulate(w, h) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true }); B.width = w; B.height = h; await sleep(200); },
        async screenshot(name) {
            const dir = process.env.E2E_SHOTS || join(ROOT, "tests", "e2e", "shots");
            if (!existsSync(dir)) execSync(`mkdir -p "${dir}"`);
            const r = await send("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(dir, name), Buffer.from(r.data, "base64"));
        },
        async waitFor(expr, { timeout = 15000, every = 150, what = expr } = {}) {
            const t0 = Date.now();
            for (;;) {
                let v = false;
                try { v = await B.ev(expr); } catch (e) { /* retry */ }
                if (v) return v;
                if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${what}\n  page: ${await B.diag()}`);
                await sleep(every);
            }
        },
        // what the page is doing right now (appended to timeout errors; a screenshot lands in E2E_SHOTS)
        async diag() {
            let info = "?";
            try {
                info = await B.ev(`JSON.stringify({ screen: document.querySelector('.screen:not([hidden])')?.id, net: typeof Net === 'undefined' ? null : { status: Net.status, role: Net.role, code: Net.code, connected: Net.connected }, lobby: document.getElementById('lobby-status')?.textContent, banner: document.getElementById('net-banner')?.hidden === false ? document.getElementById('net-banner-text').textContent : null, log: [...document.querySelectorAll('#log div')].map(d => d.textContent).slice(0, 3) })`);
                await B.screenshot(`timeout-${Date.now()}.png`);
            } catch (e) { /* page gone */ }
            return info;
        },
        // ---- game helpers ----
        click: (sel) => B.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("no element " + ${JSON.stringify(sel)}); e.click(); return true; })()`),
        set: (id, value) => B.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); return e.value; })()`),
        check: (id, on) => B.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.checked = ${!!on}; e.dispatchEvent(new Event("change")); return e.checked; })()`),
        text: (id) => B.ev(`document.getElementById(${JSON.stringify(id)}).textContent`),
        screen: () => B.ev("document.querySelector('.screen:not([hidden])')?.id"),
        // the running game, whatever it is: Match holds the active engine and the game key is
        // the body class, so a new game needs no change here
        engine: () => B.ev(`({ chain: 'ChainGame', five: 'FiveGame', boxes: 'BoxesGame' })[${GAME_KEY}]`),
        async cell(i) { await B.ev(`document.querySelectorAll(${CELLS})[${i}].click(); true`); },
        async idle() { await B.waitFor("!Match.engine.state.busy", { timeout: 60000, every: 40, what: "engine idle" }); },
        async move(i) { await B.cell(i); await B.idle(); },
        state: async () => JSON.parse(await B.ev("JSON.stringify(Match.engine.state)")),
        selectSkin: (k) => B.click(`.skin-seg button[data-skin=${k}]`),
        selectGame: (k) => B.click(`.game-card[data-game=${k}]`),
        players: (n) => B.click(`#set-players button[data-players="${n}"]`),     // the lobby's players control (#28)
        // seeded "random" legal play until the game is over: the same seed always produces the same game
        async randomGame(maxMoves = 400, seed = 12345) {
            return JSON.parse(await B.ev(`(async () => {
                const G = Match.engine, R = Rules.of(${GAME_KEY});
                let m = 0; const rnd = Bots.rng(${seed});
                while (!G.state.over && m < ${maxMoves}) {
                    const legal = R.legalMoves(G.state, G.state.current);
                    document.querySelectorAll(${CELLS})[legal[Math.floor(rnd() * legal.length)]].click(); m++;
                    await new Promise(r => { const t = setInterval(() => { if (!G.state.busy) { clearInterval(t); r(); } }, 30); });
                }
                return JSON.stringify({ over: G.state.over, moves: m, winner: G.state.winner });
            })()`));
        },
        noScroll: () => B.ev(`JSON.stringify({ x: document.documentElement.scrollWidth <= innerWidth, y: document.documentElement.scrollHeight <= innerHeight, screen: (() => { const s = document.querySelector('.screen:not([hidden])'); return s ? s.scrollHeight <= s.clientHeight + 1 : true; })() })`).then(JSON.parse),
        // Chrome may still be writing its profile for a moment after the kill: retry the
        // cleanup, and never fail a test file over a leftover temp directory (CI hit ENOTEMPTY)
        async close() {
            try { ws.close(); } catch (e) {}
            proc.kill("SIGKILL");
            await new Promise((r) => { proc.once("exit", r); setTimeout(r, 3000); });
            try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* a stray temp dir is harmless */ }
        },
    };
    return B;
}

/* ---------- online helpers ---------- */
export async function createRoom(host) {
    await host.click("#btn-create");
    await host.waitFor("Net.status === 'waiting'", { timeout: 30000, what: "host room ready" });
    return host.ev("Net.code");
}
export async function joinRoom(guest, baseUrl, code) {
    await guest.goto(`${baseUrl}?room=${code}`);
    await guest.waitFor("Net.connected", { timeout: 40000, what: "guest connected" });
}
export async function bothConnected(a, b) {
    await a.waitFor("Net.connected", { timeout: 40000, what: "a connected" });
    await b.waitFor("Net.connected", { timeout: 40000, what: "b connected" });
    await sleep(500);
}
export const ONLINE = !process.env.SKIP_ONLINE;
