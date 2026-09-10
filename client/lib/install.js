/* "Add to home screen" (Android Chrome and other Chromium browsers: beforeinstallprompt).
   The title screen's #btn-install exists only where installing works: it is shown when the
   browser offers the prompt, hidden again after installing or when already running as an
   installed app. iOS Safari has no prompt, so it never shows there (owner's wish). */

"use strict";

const Install = (() => {
    const { $, toast } = Util;
    let prompt = null;

    function init() {
        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            prompt = e;
            $("btn-install").hidden = window.matchMedia("(display-mode: standalone)").matches;
        });
        $("btn-install").addEventListener("click", async () => {
            if (!prompt) return;
            const p = prompt;
            prompt = null;
            $("btn-install").hidden = true;
            try { await p.prompt(); } catch (e) { /* dismissed */ }
        });
        window.addEventListener("appinstalled", () => { $("btn-install").hidden = true; toast("Installed — find it on your home screen"); });
    }

    return { init, get offered() { return !!prompt; } };
})();
