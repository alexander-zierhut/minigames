/* Five Wins — board view (stones, drop + winning-line jump), HUD numbers; registers
   the game. The smallest complete game: use it as the template for a new one. */

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
                stats: [["Stones", state.movesBy[k]], ["Best row", row]],
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
    size: { min: 5, max: 25, default: 9 },
    minSize: (cfg) => Math.max(5, cfg.winLen),     // the board can't be smaller than the row to win
    settings: ["winLen"],
    describeRules: (cfg) => [`${cfg.winLen} in a row`],
    rules: FiveRules,
    view: FiveView,
});
