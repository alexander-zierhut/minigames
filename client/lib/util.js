/* Small helpers shared by every module: DOM lookup, timing, clamping, fail-safe web
   storage, <template> cloning and the toast. No state except the toast timer. */

"use strict";

const Util = (() => {
    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

    // remove + re-add a class so its CSS animation plays again
    function restartClass(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
    }

    // JSON in web storage; every call is fail-safe (private mode, quota, storage disabled)
    function load(storage, key) {
        try { return JSON.parse(storage.getItem(key) || "null"); } catch (e) { return null; }
    }
    function save(storage, key, value) {
        try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
    function remove(storage, key) {
        try { storage.removeItem(key); } catch (e) { /* ignore */ }
    }

    // clone a <template>; every "{k}" in its markup becomes the player number k
    function fromTemplate(id, k) {
        const wrap = document.createElement("div");
        wrap.innerHTML = $(id).innerHTML.replace(/\{k\}/g, k).trim();
        return wrap.firstElementChild;
    }

    let toastTimer = null;
    function toast(msg) {
        const el = $("toast");
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
    }

    return { $, sleep, clamp, restartClass, load, save, remove, fromTemplate, toast };
})();
