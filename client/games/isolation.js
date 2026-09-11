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
    preview: "0.#.#.#.1",                  // two pawns, three tiles already broken (# = hole)
    size: { min: 5, max: 12, default: 7, presets: [5, 7, 9, 11] },
    players: { min: 2, max: 4 },
    premove: false,                       // a move is two clicks: a premove would need both of them
    settings: [],
    /* Learn (#41). A tutorial step's `expect` holds whole moves, and an Isolation move is the
       encoded pair `to * cells + removed` — so the gate only fires on the second click, and
       every step names its `highlight` cells itself instead of letting them default to
       `expect`. The positions below are proven: the last step's move really traps. */
    howto: {
        rules: [
            "Every player has one pawn. Yours starts in the middle of the top edge.",
            "A turn is two clicks: step onto one of the up to eight tiles around your pawn, then break away any tile that is still there.",
            "You may only step onto a tile that still exists and has nobody on it.",
            "You may break any tile nobody stands on, anywhere on the board, the one you just left included.",
            "Whoever cannot step when their turn comes is trapped and out. With two players that ends the game.",
            "With three or four players the others play on and the last one standing wins.",
            "There are no draws: every move breaks a tile, so somebody runs out of room.",
        ],
        tutorial: [
            {
                config: { n: 5 },
                moves: [],
                text: "You are the pawn at the top, your opponent sits at the bottom. A turn takes two clicks. First step: click the highlighted tile next to your pawn. Then click any other tile to break it away.",
                expect: [200, 201, 202, 203, 204, 205, 206, 207, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 223, 224],
                highlight: [8],
            },
            {
                moves: [87, 409, 183, 565, 49, 402],
                text: "Breaking tiles far away changes nothing. Take room away from the other pawn instead: step wherever you like, then break one of the highlighted tiles, the ones your opponent could step on.",
                expect: [10, 11, 17, 20, 21, 22, 135, 136, 142, 145, 146, 147, 160, 161, 167, 170, 171, 172, 185, 186, 192, 195, 196, 197],
                highlight: [10, 11, 17, 20, 21, 22],
            },
            {
                moves: [87, 409, 183, 565, 49, 402, 171, 504],
                text: "Your opponent is in the corner with one single tile left to step on. Step anywhere you like and break that tile.",
                expect: [16, 41, 141, 191, 266, 291],
                highlight: [16],
            },
            {
                moves: [87, 409, 183, 565, 49, 402, 171, 504, 16],
                text: "Trapped, and the game is yours. Watch your own room while you take theirs: the pawn with more tiles around it usually wins the race.",
            },
        ],
    },
    rules: IsolationRules,
    view: IsolationView,
});
