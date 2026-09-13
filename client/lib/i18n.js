/* Translations (#47). Every user-facing text is a key looked up in the dictionary of the
   chosen language (client/lang/<code>.js registers one with I18n.add); English is the
   source of every key and the fallback for a missing one.

     I18n.t("lobby.waiting", { count: 2 })    a text, `{name}` placeholders filled from the
                                              params; a plural entry { one, other, … } is
                                              picked by Intl.PluralRules from `params.count`
     I18n.msg(m)                               a message descriptor { k, …params } from the
                                              pure rules (a game's "why"), or a plain string
                                              from an older record, rendered
     I18n.apply(root)                          fills every [data-i18n], [data-i18n-title],
                                              [data-i18n-placeholder] and [data-i18n-aria]
                                              element under root (the static markup)

   The language comes from the browser the first time (`detect`, the first of
   navigator.languages the site speaks) and can be overridden in the preferences; a
   switch reloads the page, so nothing has to re-render live. Arabic sets dir="rtl" on the
   document (the board and everything that has cell coordinates stays LTR through CSS). */

"use strict";

const I18n = (() => {
    // the languages the site speaks, with their own names (never translated); English first
    const LANGS = [
        { code: "en", name: "English", dir: "ltr" },
        { code: "de", name: "Deutsch", dir: "ltr" },
        { code: "es", name: "Español", dir: "ltr" },
        { code: "fr", name: "Français", dir: "ltr" },
        { code: "ja", name: "日本語", dir: "ltr" },
        { code: "ar", name: "العربية", dir: "rtl" },
    ];
    const DEFAULT = "en";
    const dicts = {};
    let lang = DEFAULT;
    let rules = null;                                    // Intl.PluralRules of the current language

    const has = (code) => LANGS.some((l) => l.code === code);
    const add = (code, dict) => { dicts[code] = { ...(dicts[code] || {}), ...dict }; };

    // the first language of the browser's list the site speaks ("de-AT" counts as "de")
    function detect(list = typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []) {
        for (const tag of list || []) {
            const code = String(tag || "").toLowerCase().split("-")[0];
            if (has(code)) return code;
        }
        return DEFAULT;
    }

    function pluralRules(code) {
        try { return new Intl.PluralRules(code); } catch (e) { return null; }
    }

    // pick the language: a code, or "auto" for the browser's choice; sets lang and dir on <html>
    function init(pref) {
        lang = has(pref) ? pref : detect();
        rules = pluralRules(lang);
        if (typeof document !== "undefined" && document.documentElement) {
            document.documentElement.lang = lang;
            document.documentElement.dir = LANGS.find((l) => l.code === lang).dir;
            apply(document);
        }
        return lang;
    }

    const lookup = (key) => {
        const d = dicts[lang];
        if (d && key in d) return d[key];
        const e = dicts[DEFAULT];
        return e && key in e ? e[key] : undefined;
    };
    // a param may itself be a descriptor ({ k, … }), rendered in place (a level name inside a sentence)
    const fill = (text, params) => String(text).replace(/\{(\w+)\}/g, (m, name) => (params && name in params ? render(params[name]) : m));
    const render = (v) => (v && typeof v === "object" && typeof v.k === "string" ? t(v.k, v) : v);

    /* The text for a key. A plural entry is an object keyed by CLDR category (one, other,
       …) picked from `params.count`; a category the language file leaves out falls back to
       `other`. An unknown key comes back as the key itself, so a typo is visible, never
       silent. */
    function t(key, params) {
        let v = lookup(key);
        if (v === undefined) return key;
        if (typeof v === "object") {
            const n = params && typeof params.count === "number" ? params.count : 0;
            const cat = rules ? rules.select(n) : (n === 1 ? "one" : "other");
            v = v[cat] !== undefined ? v[cat] : v.other;
        }
        return fill(v, params);
    }
    // a message from the pure rules ({ k, …params }), or a plain string kept from an older record
    const msg = (m) => (m && typeof m === "object" ? t(m.k, m) : (m == null ? "" : String(m)));

    // the static markup: data-i18n = the text, the -title / -placeholder / -aria variants an attribute
    const ATTRS = [["data-i18n-title", "title"], ["data-i18n-placeholder", "placeholder"], ["data-i18n-aria", "aria-label"]];
    function apply(root = document) {
        if (!root || !root.querySelectorAll) return;
        for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
        for (const [data, attr] of ATTRS) for (const el of root.querySelectorAll(`[${data}]`)) el.setAttribute(attr, t(el.getAttribute(data)));
    }

    /* A small flag per language for the language menu (an SVG, like every icon; simplified
       drawings, 3:2). Arabic is a language, not a country: it gets the green field with the
       white band of the most common choice. */
    const FLAGS = {
        en: '<rect width="30" height="20" fill="#012169"/><path d="M0 0 30 20M30 0 0 20" stroke="#fff" stroke-width="4"/><path d="M0 0 30 20M30 0 0 20" stroke="#c8102e" stroke-width="1.6"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#c8102e" stroke-width="3.2"/>',
        de: '<rect width="30" height="20" fill="#000"/><rect y="6.7" width="30" height="6.6" fill="#d00"/><rect y="13.3" width="30" height="6.7" fill="#ffce00"/>',
        es: '<rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/>',
        fr: '<rect width="10" height="20" fill="#0055a4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ef4135"/>',
        ja: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
        ar: '<rect width="30" height="20" fill="#006c35"/><rect x="7" y="8" width="16" height="1.6" fill="#fff"/><rect x="7" y="11" width="12" height="1.2" fill="#fff"/>',
    };
    function flag(code) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el.setAttribute("viewBox", "0 0 30 20");
        el.setAttribute("class", "flag");
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = FLAGS[code] || "";
        return el;
    }

    return {
        init, add, t, msg, apply, detect, has, flag, LANGS, DEFAULT,
        get lang() { return lang; },
        get dir() { return (LANGS.find((l) => l.code === lang) || LANGS[0]).dir; },
        get locale() { return lang; },
        dict: (code) => dicts[code] || null,
        codes: () => Object.keys(dicts),
    };
})();
