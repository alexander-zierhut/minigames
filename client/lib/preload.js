/* First-visit texture preload. Browsers fetch CSS background images only once an
   element uses them, so the Minecraft textures would pop in on the first click.
   Every image url in the stylesheets is fetched up front, with a progress bar
   (#loader) if that takes more than a moment. Never blocks longer than 6 s. */

"use strict";

const Preload = (() => {
    function imageUrls() {
        const urls = new Set();
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }   // cross-origin sheet
            const base = sheet.href || location.href;
            for (const rule of rules) {
                for (const m of (rule.cssText || "").matchAll(/url\(["']?([^"')]+\.(?:png|jpg|webp|gif))["']?\)/g)) {
                    try { urls.add(new URL(m[1], base).href); } catch (e) { /* skip */ }
                }
            }
        }
        return [...urls];
    }

    function textures() {
        const list = imageUrls();
        if (list.length === 0) return Promise.resolve();
        const { $ } = Util;
        let done = 0;
        const showTimer = setTimeout(() => { $("loader").hidden = false; }, 120);   // no flash when cached
        const update = () => {
            $("loader-fill").style.width = Math.round(done / list.length * 100) + "%";
            $("loader-text").textContent = `Loading textures… ${done}/${list.length}`;
        };
        update();
        const one = (url) => new Promise((resolve) => {
            const img = new Image();
            img.onload = img.onerror = () => { done++; update(); resolve(); };
            img.src = url;
        });
        const all = Promise.all(list.map(one));
        const cap = new Promise((resolve) => setTimeout(resolve, 6000));
        return Promise.race([all, cap]).then(() => { clearTimeout(showTimer); $("loader").hidden = true; });
    }

    return { textures };
})();
