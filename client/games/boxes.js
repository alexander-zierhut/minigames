/* Dots and Boxes — board view (dots, edges, boxes), HUD model; registers the game.

   The board is one CSS grid of (2n+1) × (2n+1) tracks: thin "line" tracks for the dot rows
   and columns, wide tracks for the boxes. Dots go in first, then the boxes, then the edges,
   so the edges sit on top and `#board > .edge` is in edge-index order. `cells` (what the
   engine renders) are the edges; the boxes are painted by `renderBoard`, the view hook the
   engine calls once per render for a board part that is not a cell. */

"use strict";

const BoxesView = (() => {
    const { sleep } = Util;
    const { t } = I18n;
    const DRAW_MS = 130;                      // the line draws itself in
    const POP_MS = 200;                       // a closed box pops
    let boxEls = [];                          // one element per box, in box order

    function build(board, state, config, onClick) {
        const n = state.n, H = BoxesRules.hCount(n);
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
        return BoardView.cells(board, state.cells.length, onClick, (el, i) => {
            const horizontal = i < H;
            const row = horizontal ? 2 * ((i / n) | 0) + 1 : 2 * (((i - H) / (n + 1)) | 0) + 2;
            const col = horizontal ? 2 * (i % n) + 2 : 2 * ((i - H) % (n + 1)) + 1;
            el.className = "edge " + (horizontal ? "h" : "v");
            el.style.gridArea = `${row} / ${col}`;
        });
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
        const leading = BoardView.leading(state.scores);
        let free = 0;                                   // boxes anybody could close right now
        for (let b = 0; b < total; b++) if (state.boxes[b] === -1 && BoxesRules.sides(state, b) === 3) free++;
        return {
            round: t("hud.move", { n: state.history.length + 1 }),
            drawHint: t("game.boxes.hud.same"),
            line2: t("game.boxes.hud.line2", { list: state.scores.join(" · ") }),
            box: { stats: [[t("game.boxes.hud.left"), total - state.scores.reduce((a, b) => a + b, 0)], [t("game.boxes.hud.table"), free]], hot: free > 0 },
            players: state.scores.map((s, k) => ({
                stats: [[t("game.boxes.hud.boxes"), s], [t("game.boxes.hud.lines"), state.movesBy[k]]],
                bar: total ? s / total : 0,
                barText: `${s} / ${total}`,
                leading: leading[k],
            })),
        };
    }

    const summary = (state) => {
        const top = state.winner >= 0 ? state.scores[state.winner] : Math.max(...state.scores);
        return t("game.boxes.summary", { top, total: state.n * state.n });
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
    title: "game.boxes.title",
    tagline: "game.boxes.tagline",
    desc: "game.boxes.desc",
    preview: "01.1.0.01",
    size: { min: 2, max: 10, default: 5, presets: [3, 4, 5, 6, 8] },
    settings: [],
    describeRules: (cfg) => [I18n.t("game.boxes.sum.boxes", { n: cfg.n * cfg.n })],
    /* Learn (#41): the rule bullets, and a hand-written lesson on a 2 × 2 board that walks
       through the four things the game is about — draw a line, keep the board safe, take
       the box you are given, and the extra turn that comes with it. The scenarios are
       generated from the proven puzzle set (client/learn/boxes-scenarios.js). */
    howto: {
        rules: ["game.boxes.rule.1", "game.boxes.rule.2", "game.boxes.rule.3", "game.boxes.rule.4", "game.boxes.rule.5", "game.boxes.rule.6"
        ],
        tutorial: [
            {
                config: { n: 2 },
                moves: [],
                text: "game.boxes.tutorial.1",
                expect: [0],
            },
            {
                moves: [0, 5],
                text: "game.boxes.tutorial.2",
                expect: [6],
            },
            {
                moves: [0, 5, 6, 11],
                text: "game.boxes.tutorial.3",
                expect: [1, 4, 8, 9],
            },
            {
                moves: [0, 5, 6, 11, 1, 2],
                text: "game.boxes.tutorial.4",
                expect: [7],
            },
            {
                moves: [0, 5, 6, 11, 1, 2, 7],
                text: "game.boxes.tutorial.5",
                expect: [4, 9],
            },
        ],
    },
    rules: BoxesRules,
    view: BoxesView,
});
