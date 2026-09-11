/* Käsekästchen — board view (dots, edges, boxes), HUD model; registers the game.

   The board is one CSS grid of (2n+1) × (2n+1) tracks: thin "line" tracks for the dot rows
   and columns, wide tracks for the boxes. Dots go in first, then the boxes, then the edges,
   so the edges sit on top and `#board > .edge` is in edge-index order. `cells` (what the
   engine renders) are the edges; the boxes are painted by `renderBoard`, the view hook the
   engine calls once per render for a board part that is not a cell. */

"use strict";

const BoxesView = (() => {
    const { sleep } = Util;
    const DRAW_MS = 130;                      // the line draws itself in
    const POP_MS = 200;                       // a closed box pops
    let boxEls = [];                          // one element per box, in box order

    function build(board, state, config, onClick) {
        const n = state.n, H = BoxesRules.hCount(n);
        const cells = new Array(state.cells.length);
        boxEls = [];
        for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
            const dot = document.createElement("div");
            dot.className = "dot";
            dot.style.gridArea = `${2 * r + 1} / ${2 * c + 1}`;
            board.appendChild(dot);
        }
        for (let b = 0; b < n * n; b++) {
            const el = document.createElement("div");
            el.className = "box";
            el.style.gridArea = `${2 * ((b / n) | 0) + 2} / ${2 * (b % n) + 2}`;
            board.appendChild(el);
            boxEls.push(el);
        }
        for (let i = 0; i < state.cells.length; i++) {
            const horizontal = i < H;
            const row = horizontal ? 2 * ((i / n) | 0) + 1 : 2 * (((i - H) / (n + 1)) | 0) + 2;
            const col = horizontal ? 2 * (i % n) + 2 : 2 * ((i - H) % (n + 1)) + 1;
            const el = document.createElement("div");
            el.className = "edge " + (horizontal ? "h" : "v");
            el.style.gridArea = `${row} / ${col}`;
            const marker = document.createElement("div");
            marker.className = "last-marker";
            el.appendChild(marker);
            el.addEventListener("click", () => onClick(i));
            board.appendChild(el);
            cells[i] = el;
        }
        return cells;
    }

    // the engine already set p<k>/taken/last/can-place/locked; only the draw-in animation
    // is ours, and it must not survive into a replayed position
    function renderCell(el, state, i) {
        if (state.cells[i] === -1) el.classList.remove("ink");
    }

    // the boxes are not cells: repaint them whenever the engine renders the board
    function renderBoard(state) {
        for (let b = 0; b < boxEls.length; b++) {
            const owner = state.boxes[b];
            boxEls[b].className = "box" + (owner >= 0 ? ` taken p${owner}` : "");
        }
    }

    function hud(state) {
        const total = state.n * state.n;
        const best = Math.max(...state.scores);
        let free = 0;                                   // boxes anybody could close right now
        for (let b = 0; b < total; b++) if (state.boxes[b] === -1 && BoxesRules.sides(state, b) === 3) free++;
        return {
            round: `Move ${state.history.length + 1}`,
            drawHint: "same number of boxes",
            line2: `boxes ${state.scores.join(" · ")}`,
            box: { stats: [["Boxes left", total - state.scores.reduce((a, b) => a + b, 0)], ["On the table", free]], hot: free > 0 },
            players: state.scores.map((s, k) => ({
                stats: [["Boxes", s], ["Lines", state.movesBy[k]]],
                bar: total ? s / total : 0,
                barText: `${s} / ${total}`,
                leading: s === best && state.scores.every((o, j) => j === k || s > o),
            })),
        };
    }

    const summary = (state) => {
        const top = state.winner >= 0 ? state.scores[state.winner] : Math.max(...state.scores);
        return `${top} of ${state.n * state.n} boxes`;
    };

    async function animateMove(ctx, i, player) {
        const state = ctx.state;
        ctx.cells[i].classList.add("ink");
        ctx.renderCell(i);
        await sleep(DRAW_MS);
        if (state.over) return;
        BoxesRules.settle(state, player);                          // the same step the instant path uses
        ctx.render();
        if (!state.lastBoxes.length) return;
        Bus.emit("boxes:capture", { game: "boxes", boxes: state.lastBoxes.slice(), player, score: state.scores[player] });
        for (const b of state.lastBoxes) boxEls[b].classList.add("won");
        await sleep(POP_MS);
    }

    return { build, renderCell, renderBoard, hud, summary, animateMove };
})();

const BoxesGame = Games.register({
    key: "boxes",
    title: "Käsekästchen",
    tagline: "Draw a line between two dots. Close a box and it is yours, and you go again. Most boxes wins.",
    desc: "Close boxes, most wins",
    preview: "01.1.0.01",
    size: { min: 2, max: 10, default: 5, presets: [3, 4, 5, 6, 8] },
    settings: [],
    describeRules: (cfg) => [`${cfg.n * cfg.n} boxes`],
    /* Learn (#41): the rule bullets, and a hand-written lesson on a 2 × 2 board that walks
       through the four things the game is about — draw a line, keep the board safe, take
       the box you are given, and the extra turn that comes with it. The scenarios are
       generated from the proven puzzle set (client/learn/boxes-scenarios.js). */
    howto: {
        rules: [
            "The board is a grid of dots. On your turn you draw one line between two dots that sit next to each other.",
            "Draw the fourth side of a box and the box is yours.",
            "Closing a box gives you another turn, so one line can win several boxes in a row.",
            "A line that leaves a box with three sides hands that box to whoever moves next.",
            "The game ends when every line is drawn. Most boxes wins, the same number of boxes is a draw.",
            "The board is a setting: 2 to 10 boxes per side, five by default.",
        ],
        tutorial: [
            {
                config: { n: 2 },
                moves: [],
                text: "Käsekästchen is played on the lines between the dots, not on the boxes. Draw the top line of the box in the top left corner.",
                expect: [0],
            },
            {
                moves: [0, 5],
                text: "Your opponent answered at the bottom right. A single line changes nothing on its own, so keep going: draw the left side of the same box.",
                expect: [6],
            },
            {
                moves: [0, 5, 6, 11],
                text: "The top left box has two sides now. A third side would hand it to your opponent, so play a safe line instead: any of the highlighted ones leaves no box on three sides.",
                expect: [1, 4, 8, 9],
            },
            {
                moves: [0, 5, 6, 11, 1, 2],
                text: "Your opponent gave the box away: it has three sides. Close it.",
                expect: [7],
            },
            {
                moves: [0, 5, 6, 11, 1, 2, 7],
                text: "The box is yours and it is still your turn. That is why one careless line can cost a whole chain of boxes. Finish with a safe line: only two of them leave nothing on three sides.",
                expect: [4, 9],
            },
        ],
    },
    rules: BoxesRules,
    view: BoxesView,
});
