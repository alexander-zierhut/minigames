/* Game registry, engine shell and HUD.

   A game = pure rules (client/games/<key>-rules.js) + a view (board DOM, animation,
   HUD numbers; client/games/<key>.js) + a definition (title, size limits, settings).
   Games.register(def) wraps them into an engine with one uniform interface:

     state (getter)   newGame(config, hooks)   play(i) -> Promise<bool>   replay(history)
     finish(winner, why)   eliminate(p, why)   abandon()   render()   isLegal(i, player)   hash()

   app.js only ever talks to that interface, so adding a game never touches app.js. */

"use strict";

const Games = (() => {
    const defs = {};
    const order = [];

    function register(def) {
        const engine = Engine.create(def);
        defs[def.key] = { ...def, engine };
        order.push(def.key);
        return engine;
    }
    const has = (key) => !!defs[key];
    const get = (key) => defs[has(key) ? key : order[0]];
    const keys = () => order.slice();

    return { register, has, get, keys };
})();

/* ---------------- engine shell (shared by every game) ---------------- */
const Engine = (() => {
    function create(def) {
        const { rules, view } = def;
        let state = Object.assign(Rules.base({ n: 0 }), { cells: [] });
        let hooks = {};
        let cells = [];             // one element per cell, same order as state.cells
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

        function newGame(config, h) {
            hooks = h || hooks;
            state = rules.create(config, Rules.base(config));
            estimator = null;
            resetWinChance();
            document.documentElement.style.setProperty("--n", state.n);
            const el = board();
            el.className = def.key;
            el.innerHTML = "";
            cells = view.build(el, state, config, (i) => { if (hooks.onCellClick) hooks.onCellClick(i); });
            Hud.build(state.players);
            Log.clear();
            Util.$("overlay").hidden = true;
            Log.add(`New game. ${hooks.names[state.current]} starts.`, "p" + state.current);
            Bus.emit("game:new", { game: def.key, config });
            render();
            refreshWinChance();
            if (hooks.onTurn) hooks.onTurn(state.current);
        }

        function setBusy(busy) {
            state.busy = busy;
            if (hooks.onBusy) hooks.onBusy(busy);
        }

        // a move by whoever is current: own click, the friend's relayed move (or a bot)
        async function play(i) {
            if (state.busy || !rules.isLegal(state, i, state.current)) return false;
            const me = state.current;
            setBusy(true);
            rules.place(state, i, me);
            Bus.emit("game:move", { game: def.key, cell: i, player: me });
            if (hooks.onMoveApplied) hooks.onMoveApplied(i, me);
            await view.animateMove(ctx, i, me);          // resolves the move's consequences, animated
            if (state.over) return true;                 // finished from outside while animating
            const result = rules.conclude(state, me);    // winner, or the turn passed
            if (result) { finish(result.winner, result.why); return true; }
            setBusy(false);
            render();
            refreshWinChance();                          // the move has settled: now the chance may change
            Bus.emit("game:turn", { game: def.key, player: state.current });
            if (hooks.onTurn) hooks.onTurn(state.current);
            return true;
        }

        // apply moves instantly with the very same rule functions (reconnect, page refresh).
        // `outs` = eliminations (flag falls) with the history length they happened at; they
        // are replayed at the same point so every client passes the turn identically.
        function replay(history, outs = []) {
            const pending = outs.filter((o) => o && !state.out[o.p]).sort((a, b) => a.at - b.at);
            const applyOuts = () => { while (pending.length && pending[0].at <= state.history.length) { const o = pending.shift(); markOut(o.p, o.why); } };
            applyOuts();
            for (const i of history) {
                if (state.over) break;
                const me = state.current;
                if (!rules.isLegal(state, i, me)) break;
                rules.place(state, i, me);
                rules.settle(state, me);
                const result = rules.conclude(state, me);
                if (result) { state.over = true; state.winner = result.winner; state.finishWhy = result.why; }
                applyOuts();
            }
            render();
            if (state.over) finish(state.winner, state.finishWhy);
            else { refreshWinChance(); if (hooks.onTurn) hooks.onTurn(state.current); }
        }

        // the state change of an elimination (shared by eliminate and replay): skipped from
        // now on, the turn passes if it was theirs, the last one standing wins
        function markOut(p, why) {
            if (state.over || p < 0 || p >= state.players || state.out[p]) return false;
            state.out[p] = true;
            state.outs.push({ p, at: state.history.length, why });
            if (state.players > 2) Log.add(`${hooks.names[p]} is out. ${why}`, "p" + p);
            const left = Rules.remaining(state);
            if (left.length <= 1) { state.over = true; state.winner = left.length ? left[0] : -1; state.finishWhy = why; return true; }
            if (state.current === p) Rules.pass(state);
            return true;
        }

        function finish(winner, why) {
            state.over = true;
            state.busy = false;
            state.winner = winner;
            state.finishWhy = why;
            const names = hooks.names;
            const won = winner >= 0;
            Log.add(won ? `${names[winner]} wins! ${why}` : `Draw. ${why}`, won ? "p" + winner : "x");
            render();
            refreshWinChance();                          // exact now: 100 / 0 / 50
            Util.$("overlay-block").className = "overlay-block " + (won ? "p" + winner : "draw");
            Util.$("overlay-title").textContent = won ? `${names[winner]} wins!` : "Draw!";
            Util.$("overlay-sub").textContent = `${why}\n${view.summary(state)}`;
            Util.$("overlay").hidden = false;
            Bus.emit("game:finish", { game: def.key, winner, why });
            if (hooks.onBusy) hooks.onBusy(false);
            if (hooks.onFinish) hooks.onFinish(winner, why);
        }

        // a player is out without a move of the rules (flag fall; app.js calls this for the
        // local clock and for a friend's `timeout`). With two players that ends the game.
        function eliminate(p, why) {
            const was = state.current;
            if (!markOut(p, why)) return false;
            if (state.over) { finish(state.winner, state.finishWhy); return true; }
            render();
            if (state.current !== was && !state.busy) {
                Bus.emit("game:turn", { game: def.key, player: state.current });
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

        // stop a running game without a result (back to the room while playing)
        function abandon() {
            if (!state.over && state.history.length) state.over = true;
        }

        function render() {
            if (!hooks.names || cells.length === 0 || cells.length !== state.cells.length) return;
            for (let i = 0; i < cells.length; i++) renderCell(i);
            renderHud();
        }

        // shared cell classes (owner, last move, may I play here); the view adds its own
        function renderCell(i) {
            const el = cells[i];
            const owner = rules.ownerOf(state, i);
            el.classList.remove("p0", "p1", "p2", "p3", "taken", "can-place", "locked", "last");
            if (owner >= 0) el.classList.add("p" + owner, "taken");
            if (state.history[state.history.length - 1] === i) el.classList.add("last");
            if (!state.over && !state.busy) {
                const mine = !hooks.mayPlay || hooks.mayPlay(state.current);
                if (mine && rules.isLegal(state, i, state.current)) el.classList.add("can-place");
                else el.classList.add("locked");
            }
            view.renderCell(el, state, i);
        }

        /* Win chance (2 players): computed only when a move has settled — never while a move
           animates — in stages of growing node budgets (Bots.ESTIMATE_STAGES) so the bar shows a
           quick number first and refines it while nobody moves (deterministic budgets: both
           online clients see the same values). Display smoothing blends a new value with the
           previous move's value by a third, except in decided territory (≥ 90 % / ≤ 10 %). */
        const REFINE_MS = 5000, SMOOTH = 0.33, DECIDED = 0.9;
        let estimator = null;
        const win = { token: 0, display: null, prev: null, timer: null };
        function resetWinChance() { win.token++; win.display = null; win.prev = null; if (win.timer) clearTimeout(win.timer); }
        function showWinChance(p) {
            let shown = p;
            const undecided = (v) => v < DECIDED && v > 1 - DECIDED;
            if (!state.over && win.prev !== null && undecided(p) && undecided(win.prev)) shown = (1 - SMOOTH) * p + SMOOTH * win.prev;
            win.display = [shown, 1 - shown];
            renderHud();
        }
        function refreshWinChance() {
            if (!estimator) estimator = typeof Bots !== "undefined" ? Bots.estimator(def.key) : null;
            if (!estimator || state.players !== 2) return;
            win.token++;
            const token = win.token;
            if (win.timer) clearTimeout(win.timer);
            if (win.display) win.prev = win.display[0];              // the previous move's final value
            const started = Date.now();
            const stages = state.over ? [estimator.stages[0]] : estimator.stages;
            const apply = (k, p) => {
                if (token !== win.token || typeof document === "undefined" || !document) return;   // superseded, or the page is gone (tests)
                showWinChance(p);
                if (k + 1 < stages.length && !state.over && Date.now() - started < REFINE_MS) win.timer = setTimeout(() => run(k + 1), 0);
            };
            const run = (k) => {
                if (token !== win.token || state.busy) return;
                const r = estimator.at(state, stages[k]);
                if (r && typeof r.then === "function") r.then((p) => apply(k, p)).catch(() => {});
                else apply(k, r);                        // the quick stage is synchronous: the bar is right immediately
            };
            run(0);
        }
        function renderHud() {
            const model = view.hud(state);
            model.win = win.display;
            Hud.render(state, hooks, model);
        }

        return {
            get state() { return state; },
            newGame, play, replay, finish, eliminate, abandon, render, hash,
            isLegal: (i, player) => rules.isLegal(state, i, player),
        };
    }

    return { create };
})();

/* ---------------- HUD: player cards, turn box, round label ---------------- */
const Hud = (() => {
    const { $ } = Util;

    // one .player card per seat, cloned from #tpl-player (ids p{k}-name, clock-{k}, …)
    function build(players) {
        const box = $("players");
        if (box.children.length === players) return;
        box.innerHTML = "";
        for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-player", k));
        box.dataset.players = players;
    }

    /* model (from view.hud): { round: "Round 3", players: [{ stats: [[label, value], [label, value]],
       bar: 0..1, barText, leading }], line2?: text for the mobile HUD's second line };
       the engine adds win: [p0, p1] (win chance from Bots.estimator) */
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
            $(`lbl-cells-${k}`).textContent = m.stats[0][0];
            $(`p${k}-cells`).textContent = m.stats[0][1];
            $(`lbl-pieces-${k}`).textContent = m.stats[1][0];
            $(`p${k}-pieces`).textContent = m.stats[1][1];
            $(`p${k}-bar`).style.width = Math.round(m.bar * 100) + "%";
            $(`p${k}-pct`).textContent = m.barText;
            const win = model.win ? (k === 0 ? Math.round(model.win[0] * 100) : 100 - Math.round(model.win[0] * 100)) : null;   // win chance; the two always add to 100
            $(`p${k}-win-row`).hidden = win === null;
            if (win !== null) { $(`p${k}-win`).style.width = win + "%"; $(`p${k}-win-pct`).textContent = `${win} % win`; }
            $(`p-${k}`).classList.toggle("leading", !!m.leading);
            $(`p-${k}`).classList.toggle("active", !state.over && p === k);
        });
        if (model.line2 !== undefined) $("mini-line2").textContent = model.line2;
    }

    if ($("players")) build(2);     // default cards so the clock / net box have targets before a game
    return { build, render };
})();
