/* The game registry. A game = pure rules (client/games/<key>-rules.js) + a view (board
   DOM, animation, HUD model; client/games/<key>.js) + a definition (title, sizes, settings
   rows, Learn data). Games.register(def) checks the definition, fills the optional parts in
   and wraps rules + view into an engine (client/games/engine.js). Everything above the
   engine reads games from here and never knows one by name. The definition contract is in
   .claude/rules/games.md "How to add a new game". */

"use strict";

const Games = (() => {
    const defs = {};
    const order = [];

    // what a definition may leave out
    const DEFAULTS = {
        settings: [],                                   // rows in the settings modal
        players: { min: 2, max: 4 },                    // how many seats the game takes (#28)
        premove: true,                                  // off when one click is not a whole move (#37)
        howto: { rules: [], tutorial: [], scenarios: [] },   // the Learn data (#41)
        describeRules: () => [],                        // summary parts before the timer ("5 in a row")
        describeOptions: () => [],                      // summary parts after the timer ("15-chain wins")
        minSize: null,                                  // (cfg) => the smallest board the game's settings allow
    };

    function validate(def) {
        const fail = (msg) => { throw new Error(`Games.register(${def && def.key}): ${msg}`); };
        if (!def || typeof def !== "object") fail("definition missing");
        if (!/^[a-z][a-z0-9-]*$/.test(def.key || "")) fail("key must be a slug");
        if (defs[def.key]) fail("registered twice");
        for (const k of ["title", "tagline", "desc"]) if (typeof def[k] !== "string" || !def[k]) fail(`${k} missing`);
        if (typeof def.preview !== "string" || def.preview.length !== 9) fail("preview must be nine characters");
        const s = def.size;
        if (!s || !Number.isInteger(s.min) || !Number.isInteger(s.max) || !Number.isInteger(s.default) || s.min > s.default || s.default > s.max) fail("size needs min <= default <= max");
        if (!def.rules || typeof def.rules.create !== "function" || typeof def.rules.conclude !== "function") fail("rules module missing");
        if (!def.view || typeof def.view.build !== "function" || typeof def.view.hud !== "function") fail("view module missing");
        if (def.settings !== undefined && !Array.isArray(def.settings)) fail("settings must be a list");
    }

    function register(def) {
        validate(def);
        const full = { ...DEFAULTS, ...def, size: { presets: [], ...def.size } };
        full.engine = Engine.create(full);
        defs[def.key] = full;
        order.push(def.key);
        return full.engine;
    }
    const has = (key) => !!defs[key];
    const get = (key) => defs[has(key) ? key : order[0]];
    const keys = () => order.slice();
    // a definition's texts are keys (#47): the title in the chosen language
    const title = (key) => I18n.t(get(key).title);

    /* The classes of one cell of a game's 3×3 picker preview (`def.preview`, nine
       characters): "." empty, a digit = that player's piece, "#" a hole (Isolation),
       "a" / "b" / "c" = player 0 with 1 / 2 / 3 pieces and "A" / "B" / "C" the same for
       player 1 (Chain React's lamps). The game's CSS draws them (`.game-preview.<key> i`). */
    function previewClass(ch) {
        if (/\d/.test(ch)) return "p" + ch;
        if (ch === "#") return "hole";
        const k = "abc".indexOf(ch.toLowerCase());
        if (k >= 0) return `${ch === ch.toLowerCase() ? "p0" : "p1"} n${k + 1}`;
        return "";
    }
    /* The tile itself, `span.game-preview.<key>` with nine `i` cells: the picker cards, the
       Learn list and the replays screen all build it here. `"all"` (the replays filter's
       "All games") is an empty board without a game class; `small` adds `.tiny`. */
    function previewTile(key, { small = false } = {}) {
        const el = document.createElement("span");
        el.className = "game-preview" + (small ? " tiny" : "") + (has(key) ? " " + key : "");
        const shape = has(key) ? get(key).preview : ".........";
        for (const ch of shape) {
            const i = document.createElement("i");
            i.className = previewClass(ch);
            el.appendChild(i);
        }
        return el;
    }

    return { register, has, get, keys, title, previewClass, previewTile, positionAt: Rules.replay };
})();
