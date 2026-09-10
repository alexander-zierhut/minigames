/* New version deployed while the page was open (#40).

   The build stamps the running version into <meta name="version"> and writes the same
   stamp to version.json next to index.html (deployed uncached). This module polls that
   file while the player sits on the title screen, and shows a small notice with a Reload
   button when the deployed version differs from the running one. Nothing here ever
   interrupts a lobby or a game: the check only runs on the title screen, and a result
   that arrives elsewhere is remembered until the title screen shows again.

   Idle clients update themselves: once the notice has been visible for AUTO_MS without a
   click or a key press, the page reloads once by itself. The unbundled dev page has the
   version "dev" and never polls, so local development and the tests stay quiet. Every
   failure (offline, 404, timeout, garbage) is silent. */

"use strict";

const Update = (() => {
    const { $ } = Util;
    const EVERY_MS = 180000;        // poll every 3 minutes while on the title screen
    const TIMEOUT_MS = 4000;        // give up on a slow answer
    const MIN_GAP_MS = 20000;       // do not re-check on every trip back to the title

    let AUTO_MS = 20000;          // notice visible this long without interaction -> reload (writable for tests)
    let url = "version.json";
    let current = "dev";
    let onTitle = () => false;
    let reload = () => location.reload();

    let available = false, latest = "", reloaded = false, checking = null, lastCheck = 0;
    let timer = null, autoTimer = null, wired = false;

    /* Is the deployed stamp another build than the running one? Any two different
       non-empty stamps count; "dev" (unbundled) is never compared. */
    function isNewer(running, next) {
        if (typeof running !== "string" || typeof next !== "string") return false;
        const a = running.trim(), b = next.trim();
        if (!a || !b || a === "dev" || b === "dev") return false;
        return a !== b;
    }

    /* Fetch version.json (uncached, time-boxed) and remember a newer version. A check that
       is already in flight is shared, so the poll, a screen change and a caller waiting for
       the answer never make two requests. */
    function check() {
        if (checking) return checking;
        checking = run().then((r) => { checking = null; return r; }, () => { checking = null; return false; });
        return checking;
    }

    async function run() {
        if (available || current === "dev" || typeof fetch !== "function") return false;
        lastCheck = Date.now();
        let abortTimer = null;
        try {
            const opts = { cache: "no-store" };
            if (typeof AbortController === "function") {
                const ctl = new AbortController();
                opts.signal = ctl.signal;
                abortTimer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
            }
            const res = await fetch(url, opts);
            if (!res || res.ok === false) return false;
            const doc = await res.json();
            const version = doc && typeof doc.version === "string" ? doc.version : "";
            if (!isNewer(current, version)) return false;
            latest = version;
            available = true;
            render();
            return true;
        } catch (e) {
            return false;                       // offline, 404, timeout, not JSON: stay quiet
        } finally {
            if (abortTimer !== null) clearTimeout(abortTimer);
        }
    }

    /* The screen changed (app.js calls this from show()): show or hide the notice and,
       on the title screen, look for a new version. */
    function screenChanged() {
        render();
        if (onTitle() && !available && Date.now() - lastCheck > MIN_GAP_MS) check();
    }

    function render() {
        const el = $("update-notice");
        if (!el) return;
        const show = available && !!onTitle();
        el.hidden = !show;
        if (show) arm(); else disarm();
    }

    /* Reload by itself after AUTO_MS on the title screen; any interaction postpones it. */
    function arm() {
        if (reloaded) return;
        if (autoTimer !== null) clearTimeout(autoTimer);
        autoTimer = setTimeout(() => { autoTimer = null; if (available && onTitle() && !reloaded) doReload(); }, AUTO_MS);
    }
    function disarm() {
        if (autoTimer !== null) clearTimeout(autoTimer);
        autoTimer = null;
    }
    function postpone() { if (autoTimer !== null) arm(); }

    function doReload() {
        if (reloaded) return;
        reloaded = true;
        disarm();
        try { reload(); } catch (e) { /* nothing else to do */ }
    }

    function init(opts = {}) {
        url = opts.url || url;
        const meta = document.querySelector('meta[name="version"]');
        current = (opts.current !== undefined ? opts.current : meta ? meta.content : "dev") || "dev";
        onTitle = opts.onTitle || onTitle;
        if (opts.reload) reload = opts.reload;
        available = false; latest = ""; reloaded = false; lastCheck = 0; checking = null;
        if (!wired) {
            wired = true;
            $("btn-update-reload").addEventListener("click", doReload);
            for (const e of ["pointerdown", "keydown"]) window.addEventListener(e, postpone, true);
            document.addEventListener("visibilitychange", () => { if (!document.hidden) screenChanged(); });
        }
        stop();
        if (current !== "dev") timer = setInterval(() => { if (onTitle() && !available) check(); }, EVERY_MS);
        screenChanged();
    }

    function stop() {
        if (timer !== null) clearInterval(timer);
        timer = null;
        disarm();
    }

    return {
        init, check, isNewer, screenChanged, stop,
        get available() { return available; },
        get latest() { return latest; },
        get current() { return current; },
        get AUTO_MS() { return AUTO_MS; },
        set AUTO_MS(ms) { AUTO_MS = ms; },
        get reload() { return reload; },
        set reload(fn) { reload = fn; },
        EVERY_MS, TIMEOUT_MS,
    };
})();
