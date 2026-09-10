/* Look ("skin"): a per-device choice, never sent to the friend and never a game setting.
   The DOM is identical for every skin; a body class switches the CSS and nothing else.
   Player names are no longer part of the look (#35): everyone picks their own name in the
   preferences (Prefs.name) and the seats keep their colours. */

"use strict";

const Skins = (() => {
    const KEY = "chainreact.skin";
    const SKINS = {
        classic: { cls: "" },                         // owner's favourite: don't touch
        mcboard: { cls: "skin-mcboard" },             // classic UI, Minecraft board
        mc: { cls: "skin-mc" },                       // unified dark Minecraft UI
    };
    let current = "classic";
    let onChange = () => {};

    function apply(key) {
        if (!SKINS[key]) key = "classic";
        current = key;
        for (const s of Object.values(SKINS)) if (s.cls) document.body.classList.remove(s.cls);
        if (SKINS[key].cls) document.body.classList.add(SKINS[key].cls);
        document.querySelectorAll(".skin-seg button").forEach((b) => b.classList.toggle("selected", b.dataset.skin === key));
    }

    function set(key) {
        apply(key);
        Util.save(localStorage, KEY, current);
        onChange(current);
    }

    function init(handlers) {
        onChange = handlers.onChange || onChange;
        apply(Util.load(localStorage, KEY) || "classic");
        document.querySelectorAll(".skin-seg button").forEach((b) => b.addEventListener("click", () => set(b.dataset.skin)));
    }

    return { init, set, get current() { return current; } };
})();
