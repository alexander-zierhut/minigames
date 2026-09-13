/* The generic HUD: sign, turn box, one card per seat, the game's info box and the result
   overlay. A game supplies a model (`view.hud(state)`), nothing else:

     { round: "Round 3",                                  the sign's subtitle / the phone's round label
       players: [{ stats: [[label, value], …], bar: 0..1, barText, leading }],   one per seat
       box?: { stats: [[label, value], …], hot? },        an extra info box (chain: the chain counters)
       line2?: string | [[label, value], …],              second line of the phone turn box
       drawHint?: text under "Draw" }

   The win bars belong to WinChance, which writes them itself. */

"use strict";

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
