/* Game registry, engine shell and HUD — the framework side of a game.

   A game = pure rules (client/games/<key>-rules.js) + a view (board DOM, animation,
   HUD numbers; client/games/<key>.js) + a definition (title, size limits, settings rows,
   summary parts). Games.register(def) wraps them into an engine with one uniform
   interface, and everything else (rooms, lobby, clock, chat, win chance, bots, replay,
   session restore, sounds) works against that interface only:

     state (getter)   newGame(config, hooks)   play(i) -> Promise<bool>   replay(history, outs)
     finish(winner, why)   eliminate(p, why)   abandon()   render()   isLegal(i, player)
     hash()   record()   preview(ply)   previewPly (getter)

   Bus events the engine emits (payloads in AGENTS.md "Events"): game:new, game:move,
   game:turn, game:finish and game:position (the settled position changed — observers
   such as the win chance listen to this one only). */

"use strict";

const Games = (() => {
    const defs = {};
    const order = [];

    function register(def) {
        if (!def || !def.key || !def.rules || !def.view) throw new Error("Games.register: key, rules and view are required");
        const engine = Engine.create(def);
        // players: how many seats the game takes (#28); howto: the Learn data (rules, tutorial, scenarios, #41)
        defs[def.key] = { settings: [], players: { min: 2, max: 4 }, howto: { rules: [], tutorial: [], scenarios: [] }, ...def, engine };
        order.push(def.key);
        return engine;
    }
    const has = (key) => !!defs[key];
    const get = (key) => defs[has(key) ? key : order[0]];
    const keys = () => order.slice();

    return { register, has, get, keys, positionAt: Rules.replay };
})();

/* ---------------- engine shell (shared by every game) ---------------- */
const Engine = (() => {
    function create(def) {
        const { rules, view } = def;
        let state = Object.assign(Rules.base({ n: 0 }), { cells: [] });
        let config = null;
        let hooks = {};
        let cells = [];             // one element per cell, same order as state.cells
        let shown = null;           // a replayed position shown instead of the live one (#38); null = live
        let extra = [];             // per cell: the class hooks.cellClass added last (premove marker, #37)
        const board = () => Util.$("board");

        // what the view gets to drive an animation
        const ctx = {
            get state() { return state; },
            get cells() { return cells; },
            board,
            names: () => hooks.names,
            renderCell: (i) => renderCell(i),
            renderHud: () => renderHud(),
            render: () => render(),
        };

        const emit = (event, data) => Bus.emit(event, { game: def.key, ...data });
        // the settled position changed (new game, move settled, replay, elimination, end)
        const settled = () => emit("game:position", { state });

        function newGame(cfg, h) {
            hooks = h || hooks;
            config = cfg;
            shown = null;
            state = Rules.create(cfg, rules);
            document.documentElement.style.setProperty("--n", state.n);
            document.body.className = document.body.className.replace(/\bgame-\S+/g, "").trim();
            document.body.classList.add("game-" + def.key);
            const el = board();
            el.className = def.key;
            el.innerHTML = "";
            cells = view.build(el, state, cfg, (i) => { if (!shown && hooks.onCellClick) hooks.onCellClick(i); });
            extra = [];
            Hud.build(state.players, def.title);
            Log.clear();
            Util.$("overlay").hidden = true;
            Log.add(`New game. ${hooks.names[state.current]} starts.`, "p" + state.current);
            emit("game:new", { config: cfg, state });
            render();
            settled();
            if (hooks.onTurn) hooks.onTurn(state.current);
        }

        function setBusy(busy) {
            state.busy = busy;
            if (hooks.onBusy) hooks.onBusy(busy);
        }

        // a move by whoever is current: own click, the friend's relayed move, a bot
        async function play(i) {
            if (state.busy || !rules.isLegal(state, i, state.current)) return false;
            const me = state.current;
            setBusy(true);
            rules.place(state, i, me);
            emit("game:move", { cell: i, player: me });
            if (hooks.onMoveApplied) hooks.onMoveApplied(i, me);
            await view.animateMove(ctx, i, me);          // resolves the move's consequences, animated
            if (state.over) return true;                 // finished from outside while animating
            const result = rules.conclude(state, me);    // winner, or the turn passed
            if (result) { finish(result.winner, result.why); return true; }
            setBusy(false);
            render();
            settled();
            // "the turn passed": a game where a move may keep the mover on turn (boxes:
            // closing a box) emits nothing here, so sounds and observers don't fire twice
            if (state.current !== me) emit("game:turn", { player: state.current, state });
            if (hooks.onTurn) hooks.onTurn(state.current);
            return true;
        }

        // apply moves instantly with the very same rule functions (reconnect, page refresh,
        // a replay viewer). `outs` = eliminations with the history length they happened at.
        function replay(history, outs = []) {
            const before = state.outs.length;
            Rules.apply(rules, state, history, outs);
            for (const o of state.outs.slice(before)) logOut(o.p, o.why);
            render();
            if (state.over) { finish(state.winner, state.finishWhy); return; }
            settled();
            if (hooks.onTurn) hooks.onTurn(state.current);
        }

        const logOut = (p, why) => { if (state.players > 2) Log.add(`${hooks.names[p]} is out. ${why}`, "p" + p); };

        function finish(winner, why) {
            state.over = true;
            state.busy = false;
            state.winner = winner;
            state.finishWhy = why;
            const names = hooks.names;
            const won = winner >= 0;
            Log.add(won ? `${names[winner]} wins! ${why}` : `Draw. ${why}`, won ? "p" + winner : "x");
            render();
            Hud.overlay(won ? names[winner] : null, winner, `${why}\n${view.summary(state)}`);
            settled();
            emit("game:finish", { winner, why, state });
            if (hooks.onBusy) hooks.onBusy(false);
            if (hooks.onFinish) hooks.onFinish(winner, why);
        }

        // a player is out without a move of the rules (flag fall: the local clock or a
        // friend's `timeout`). With two players that ends the game.
        function eliminate(p, why) {
            const was = state.current;
            if (!Rules.eliminate(state, p, why)) return false;
            logOut(p, why);
            if (state.over) { finish(state.winner, state.finishWhy); return true; }
            render();
            settled();
            if (state.current !== was && !state.busy) {
                emit("game:turn", { player: state.current, state });
                if (hooks.onTurn) hooks.onTurn(state.current);
            }
            return true;
        }

        // fingerprint of everything that matters for play; two clients in sync agree on it
        function hash() {
            const str = JSON.stringify([state.cells, state.current, state.over, state.winner, state.movesBy, state.out]);
            let h = 0x811c9dc5;                                        // FNV-1a, 32 bit
            for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
            return h;
        }

        // the game as data: enough to rebuild any position (Games.positionAt) or show it later
        function record() {
            return {
                game: def.key, config: config ? { ...config } : null,
                history: state.history.slice(), outs: state.outs.slice(),
                over: state.over, winner: state.over ? state.winner : null, why: state.over ? state.finishWhy : "",
            };
        }

        // stop a running game without a result (back to the room while playing)
        function abandon() {
            if (!state.over && state.history.length) state.over = true;
        }

        /* Look at the game move by move (#38, the replay bar): show the position after `ply`
           moves instead of the live one. View only — the live state, the record, the hash,
           the session and the Bus never learn about it, so a preview can never leak into
           play or into what the friends receive. `ply` null (or the full history) = live. */
        function preview(ply) {
            const total = state.history.length;
            shown = (ply === null || ply === undefined || ply >= total) ? null : Rules.replay(record(), Math.max(0, ply));
            render();
            return previewPly();
        }
        const previewPly = () => (shown ? shown.history.length : null);
        const position = () => shown || state;

        function render() {
            if (!hooks.names || cells.length === 0 || cells.length !== state.cells.length) return;
            for (let i = 0; i < cells.length; i++) renderCell(i);
            // a game whose board has parts that are not cells (boxes: the boxes themselves)
            // paints them here; every other game leaves the hook out
            if (view.renderBoard) view.renderBoard(position());
            renderHud();
        }

        // shared cell classes (owner, last move, may I play here, the table's own marker);
        // the view adds its own on top
        function renderCell(i) {
            const s = position();
            const el = cells[i];
            if (!el) return;
            const owner = rules.ownerOf(s, i);
            el.classList.remove("p0", "p1", "p2", "p3", "taken", "can-place", "locked", "last");
            if (owner >= 0) el.classList.add("p" + owner, "taken");
            if (s.history[s.history.length - 1] === i) el.classList.add("last");
            if (shown) el.classList.add("locked");                  // a preview is never playable
            else if (!s.over && !s.busy) {
                const mine = !hooks.mayPlay || hooks.mayPlay(s.current);
                if (mine && rules.isLegal(s, i, s.current)) el.classList.add("can-place");
                else el.classList.add("locked");
            }
            // one class the table may add without the game knowing about it (Match: "premove")
            if (extra[i]) { el.classList.remove(extra[i]); extra[i] = ""; }
            const add = hooks.cellClass ? hooks.cellClass(i) : "";
            if (add) { el.classList.add(add); extra[i] = add; }
            view.renderCell(el, s, i);
        }
        // in a preview the turn hint is neutral: "your move" would be a lie about a past position
        const previewHooks = () => ({ names: hooks.names, turnHint: () => "to move" });
        const renderHud = () => Hud.render(position(), shown ? previewHooks() : hooks, view.hud(position()));

        return {
            get state() { return state; },
            get config() { return config; },
            get previewPly() { return previewPly(); },
            newGame, play, replay, finish, eliminate, abandon, render, hash, record, preview,
            isLegal: (i, player) => rules.isLegal(state, i, player),
        };
    }

    return { create };
})();

/* ---------------- HUD: sign, turn box, player cards, game box, overlay ---------------- */
const Hud = (() => {
    const { $ } = Util;

    // one .player card per seat, cloned from #tpl-player (ids p-{k}, p{k}-name, clock-{k}, p{k}-stats …)
    function build(players, title) {
        if (title !== undefined) $("sign-title").textContent = title.toUpperCase();
        const box = $("players");
        if (box.children.length === players) return;
        box.innerHTML = "";
        for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-player", k));
        box.dataset.players = players;
    }

    // label / value rows inside `box`, rebuilt only when the row count changes; ids `${prefix}-${j}`
    function statRows(box, stats, prefix) {
        if (box.children.length !== stats.length) {
            box.innerHTML = "";
            stats.forEach((_, j) => {
                const row = document.createElement("div");
                row.className = "stat";
                row.innerHTML = `<span></span><b id="${prefix}-${j}"></b>`;
                box.appendChild(row);
            });
        }
        stats.forEach(([label, value], j) => {
            const row = box.children[j];
            row.firstElementChild.textContent = label;
            row.lastElementChild.textContent = value;
        });
    }

    // "chain 5 / best 7": parts [[label, value], …] with bold values, or a plain string
    function miniLine(el, line2) {
        if (line2 === undefined) return;
        if (typeof line2 === "string") { el.textContent = line2; return; }
        el.innerHTML = "";
        line2.forEach(([label, value], j) => {
            if (j) el.appendChild(document.createTextNode(" / "));
            el.appendChild(document.createTextNode(label + " "));
            const b = document.createElement("b");
            b.textContent = value;
            el.appendChild(b);
        });
    }

    /* model (from view.hud(state)):
       { round: "Round 3",
         players: [{ stats: [[label, value], …], bar: 0..1, barText, leading }],   one per seat
         box?: { stats: [[label, value], …], hot? },   an extra info box (chain: the chain counters)
         line2?: string | [[label, value], …],         second line of the phone turn box
         drawHint?: text under "Draw" }                (the win bars belong to WinChance) */
    function render(state, hooks, model) {
        const names = hooks.names;
        const p = state.current;
        const draw = state.over && state.winner < 0;
        const roundText = state.over ? "Game over" : model.round;
        $("round-label").textContent = roundText;
        $("round-mini").textContent = roundText;
        $("turn-box").className = `turn-box p${p}` + (state.busy ? " busy" : "");
        const board = $("board");
        for (let k = 0; k < 4; k++) board.classList.toggle("turn-p" + k, !state.over && p === k);
        board.classList.toggle("over", state.over);
        $("turn-name").textContent = draw ? "Draw" : names[p];
        $("turn-hint").textContent = state.over
            ? (draw ? model.drawHint || "" : `${names[state.winner]} won`)
            : (hooks.turnHint ? hooks.turnHint(p) : "to move");
        model.players.forEach((m, k) => {
            $(`p${k}-name`).textContent = names[k];
            statRows($(`p${k}-stats`), m.stats, `p${k}-stat`);
            $(`p${k}-bar`).style.width = Math.round(m.bar * 100) + "%";
            $(`p${k}-pct`).textContent = m.barText;
            $(`p-${k}`).classList.toggle("leading", !!m.leading);
            $(`p-${k}`).classList.toggle("active", !state.over && p === k);
        });
        const box = $("game-box");
        box.hidden = !model.box;
        if (model.box) { statRows(box, model.box.stats, "game-stat"); box.classList.toggle("hot", !!model.box.hot); }
        miniLine($("mini-line2"), model.line2);
    }

    // the result overlay: `name` = the winner's name (null = draw), `sub` = why + the game's summary
    function overlay(name, winner, sub) {
        $("overlay-block").className = "overlay-block " + (name ? "p" + winner : "draw");
        $("overlay-title").textContent = name ? `${name} wins!` : "Draw!";
        $("overlay-sub").textContent = sub;
        $("overlay").hidden = false;
    }

    if ($("players")) build(2);     // default cards so the clock / net box have targets before a game
    return { build, render, overlay };
})();
