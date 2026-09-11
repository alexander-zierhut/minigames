/* Five Wins — board view (stones, drop + winning-line jump), HUD model; registers the
   game. The smallest complete game: use it as the template for a new one. */

"use strict";

const FiveView = (() => {
    const { sleep } = Util;

    function build(board, state, config, onClick) {
        const cells = [];
        for (let i = 0; i < state.cells.length; i++) {
            const cell = document.createElement("div");
            cell.className = "stone";
            const marker = document.createElement("div");
            marker.className = "last-marker";
            cell.appendChild(marker);
            cell.addEventListener("click", () => onClick(i));
            board.appendChild(cell);
            cells.push(cell);
        }
        return cells;
    }

    // winning stones get .win and an index so they jump in a wave
    function renderCell(el, state, i) {
        const k = state.winLine.indexOf(i);
        el.classList.toggle("win", k >= 0);
        if (k >= 0) el.style.setProperty("--k", k);
    }

    function hud(state) {
        const rows = state.movesBy.map((_, p) => FiveRules.bestRow(state, p));
        return {
            round: `Move ${state.history.length + 1}`,
            drawHint: "no space left",
            line2: `best row ${rows.join(" · ")}`,
            players: rows.map((row, k) => ({
                stats: [["Stones", state.movesBy[k]], [state.dead && state.dead[k] ? "Out" : "Best row", state.dead && state.dead[k] ? `${state.winLen - 1} in a row` : row]],
                bar: row / state.winLen,
                barText: `${row} / ${state.winLen}`,
                leading: rows.every((o, j) => j === k || row > o),
            })),
        };
    }

    const summary = (state) => `${state.history.length} moves`;

    async function animateMove(ctx, i) {
        ctx.renderCell(i);
        ctx.cells[i].classList.add("drop");
        ctx.renderHud();
        await sleep(180);
    }

    return { build, renderCell, hud, summary, animateMove };
})();

const FiveGame = Games.register({
    key: "five",
    title: "Five Wins",
    tagline: "Place a stone anywhere, no gravity. First to get five in a row wins.",
    desc: "Five in a row, no gravity",
    preview: "0.110...0",
    size: { min: 5, max: 25, default: 11, presets: [9, 11, 13, 15, 19] },
    minSize: (cfg) => Math.max(5, cfg.winLen),     // the board can't be smaller than the row to win
    settings: [
        { key: "winLen", label: "In a row to win", type: "preset", presets: [3, 4, 5, 6, 7], def: 5, min: 3, max: 25,
          customLabel: "Custom stones (3–25)" },
        /* The Yavalath rule: one stone short of the winning row loses (the classic is 4 wins,
           3 loses). The row is named after what it does and follows the win length, because
           "Yavalath rule" told a player nothing (owner, 2026-09-11). */
        { key: "yavalath", label: (cfg) => `Lose when ${Math.max(2, (cfg.winLen || 5) - 1)} in a row`, type: "bool", def: false },
    ],
    // Learn (#41): the rules in one sentence each and a guided tutorial on a 9×9 board.
    // The scenarios come from the proven puzzle set (client/learn/five-scenarios.js).
    howto: {
        rules: [
            "Players take turns. On your turn you put one stone on any empty cell.",
            "There is no gravity: the whole board is open from the first move.",
            "Five stones of your colour in a row win, across, down or on either diagonal.",
            "More than five in a row counts as well.",
            "The game is a draw when the board is full, or when no row can be completed any more.",
            "The board size and the length of the winning row are settings, so four in a row on a small board works too.",
        ],
        tutorial: [
            {
                config: { n: 9, winLen: 5 },
                moves: [],
                text: "Five Wins is five stones in a row. There is no gravity, so you may click any empty cell. Start in the middle.",
                expect: [40],
            },
            {
                moves: [40, 20],
                text: "Your opponent answered on the upper left. Grow your row: put your next stone right beside the first one.",
                expect: [41],
            },
            {
                moves: [40, 20, 41, 21],
                text: "Two in a row. Your opponent is building a row of their own. Make yours three.",
                expect: [42],
            },
            {
                moves: [40, 20, 41, 21, 42, 19],
                text: "Three in a row with a free cell at each end is an open three, and it has to be answered. Your opponent kept building instead. Punish that and play your fourth stone.",
                expect: [39],
            },
            {
                moves: [40, 20, 41, 21, 42, 19, 39, 43],
                text: "Four in a row with both ends free cannot be stopped: one block still leaves the other end. Your opponent covered the right side, so finish the row on the left.",
                expect: [38],
            },
            {
                moves: [40, 20, 41, 21, 42, 19, 39, 43, 38],
                text: "Five in a row, the game is yours. Remember it works both ways: answer your opponent's open three before it becomes four.",
            },
        ],
    },
    describeRules: (cfg) => [`${cfg.winLen} in a row`],
    describeOptions: (cfg) => (cfg.yavalath ? [`${cfg.winLen - 1} in a row loses`] : []),
    rules: FiveRules,
    view: FiveView,
});
