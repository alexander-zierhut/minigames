/* Isolation — board view (tiles, pawns, the two-step click), HUD model; registers the game.

   A move is two clicks: the first one picks the tile to step onto (it turns into the
   `.pending` tile and every removable tile lights up), the second one picks the tile to
   remove and submits the encoded move `to * cells + removed`. Clicking the pending tile
   again takes the choice back; anything else does nothing. The first click is only
   accepted on a tile the engine marked `can-place`, so a preview, a friend's turn and a
   spectator are handled by the framework, not here. */

"use strict";

const IsolationView = (() => {
    const { sleep } = Util;
    const SLIDE_MS = 260;                 // the pawn's step
    const DROP_MS = 300;                  // the tile falling away

    let cells = [];                       // the tile elements of the running game
    let pending = -1;                     // the tile picked by the first click (-1 = none)
    let pendingAt = -1;                   // history length when it was picked (a friend's move drops it)
    let pendingFor = -1;                  // the seat it was picked for
    let base = [];                        // what the engine last painted per cell: 0 plain, 1 can-place, 2 locked

    // is the choice still about the position on the screen?
    function keepPending(state) {
        if (pending >= 0 && (state.history.length !== pendingAt || state.current !== pendingFor || state.over)) pending = -1;
        return pending;
    }
    // may this tile be removed once the pawn stepped onto `pending`?
    const removable = (state, i) => i !== pending
        && (state.cells[i] === IsolationRules.FREE || i === state.pawns[state.current]);

    function build(board, state, config, onClick) {
        cells = [];
        base = [];
        pending = -1; pendingAt = -1; pendingFor = -1;
        for (let i = 0; i < state.cells.length; i++) {
            const slab = document.createElement("div");
            slab.className = "slab";
            const marker = document.createElement("div");
            marker.className = "last-marker";
            const pawn = document.createElement("i");
            pawn.className = "pawn";
            slab.append(marker, pawn);
            slab.addEventListener("click", () => click(state, i, onClick));
            board.appendChild(slab);
            cells.push(slab);
        }
        return cells;
    }

    function click(state, i, onClick) {
        keepPending(state);
        if (pending < 0) {
            // step 1: only where the framework says this device may play (can-place)
            if (!cells[i] || !cells[i].classList.contains("can-place")) return;
            pending = i; pendingAt = state.history.length; pendingFor = state.current;
            paint(state);
            return;
        }
        if (i === pending) { pending = -1; paint(state); return; }      // take it back
        if (!removable(state, i)) return;
        const move = IsolationRules.encode(state, pending, i);
        pending = -1;
        paint(state);
        onClick(move);
    }

    // step 2 is on: the picked tile plus every tile that may still be broken
    function overlay(el, state, i) {
        el.classList.toggle("pending", i === pending);
        el.classList.toggle("can-place", removable(state, i));
        el.classList.toggle("locked", !removable(state, i) && i !== pending);
    }
    // step 2 is off again: back to what the engine painted (the steps of the pawn)
    function restore(el, i) {
        el.classList.remove("pending");
        el.classList.toggle("can-place", base[i] === 1);
        el.classList.toggle("locked", base[i] === 2);
    }
    // after a click changed the choice; the engine is not involved, nothing of the game moved
    function paint(state) {
        const on = keepPending(state) >= 0;
        for (let i = 0; i < cells.length; i++) if (cells[i]) (on ? overlay(cells[i], state, i) : restore(cells[i], i));
    }

    function renderCell(el, state, i) {
        el.classList.toggle("hole", state.cells[i] === IsolationRules.HOLE);
        el.classList.remove("dropping", "stepping");
        base[i] = el.classList.contains("can-place") ? 1 : el.classList.contains("locked") ? 2 : 0;
        if (keepPending(state) >= 0) overlay(el, state, i); else el.classList.remove("pending");
    }

    function hud(state) {
        const free = state.movesBy.map((_, p) => IsolationRules.mobility(state, p));
        return {
            round: `Move ${state.history.length + 1}`,
            drawHint: "nobody is left",
            line2: `free moves ${free.join(" · ")}`,
            players: free.map((m, k) => ({
                stats: [["Moves", state.movesBy[k]], [state.trapped[k] ? "Out" : "Free moves", state.trapped[k] ? "trapped" : m]],
                bar: state.trapped[k] ? 0 : m / 8,
                barText: state.trapped[k] ? "trapped" : `${m} / 8`,
                leading: !state.trapped[k] && free.every((o, j) => j === k || m > o),
            })),
        };
    }

    const summary = (state) => `${state.history.length} moves`;

    // the pawn slides from the tile it left, the removed tile falls away
    async function animateMove(ctx, move, player) {
        const state = ctx.state;
        const from = state.lastFrom, to = state.pawns[player], gone = state.lastRemoved;
        ctx.render();
        const pawn = cells[to] && cells[to].querySelector(".pawn");
        if (pawn && cells[from]) {
            const a = cells[from].getBoundingClientRect(), b = cells[to].getBoundingClientRect();
            const dx = Math.round(a.left - b.left), dy = Math.round(a.top - b.top);
            if (dx || dy) {
                cells[to].classList.add("stepping");
                pawn.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
                    { duration: SLIDE_MS, easing: "cubic-bezier(.3,0,.2,1)" });
            }
        }
        if (cells[gone]) cells[gone].classList.add("dropping");
        await sleep(SLIDE_MS);
        if (cells[to]) cells[to].classList.remove("stepping");
        await sleep(DROP_MS - SLIDE_MS);
        if (cells[gone]) cells[gone].classList.remove("dropping");
    }

    return { build, renderCell, hud, summary, animateMove, get pending() { return pending; } };
})();

const IsolationGame = Games.register({
    key: "isolation",
    title: "Isolation",
    tagline: "Step one tile, then break one away. Whoever cannot move is trapped.",
    desc: "Break the floor, trap the rest",
    preview: "0...#...1",
    size: { min: 5, max: 12, default: 7 },
    players: { min: 2, max: 4 },
    premove: false,                       // a move is two clicks: a premove would need both of them
    settings: [],
    rules: IsolationRules,
    view: IsolationView,
});
