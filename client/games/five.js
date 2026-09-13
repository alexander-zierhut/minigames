/* Five Wins — board view (stones, drop + winning-line jump), HUD model; registers the
   game. The smallest complete game: use it as the template for a new one. */

"use strict";

const FiveView = (() => {
    const { sleep } = Util;
    const { t } = I18n;

    const build = (board, state, config, onClick) => BoardView.cells(board, state.cells.length, onClick, (el) => { el.className = "stone"; });

    // winning stones get .win and an index so they jump in a wave
    function renderCell(el, state, i) {
        const k = state.winLine.indexOf(i);
        el.classList.toggle("win", k >= 0);
        if (k >= 0) el.style.setProperty("--k", k);
    }

    function hud(state) {
        const rows = state.movesBy.map((_, p) => FiveRules.bestRow(state, p));
        const leading = BoardView.leading(rows);
        return {
            round: t("hud.move", { n: state.history.length + 1 }),
            drawHint: t("game.five.hud.noSpace"),
            line2: t("game.five.hud.line2", { rows: rows.join(" · ") }),
            players: rows.map((row, k) => ({
                stats: [[t("game.five.hud.stones"), state.movesBy[k]], [t(state.dead[k] ? "game.five.hud.out" : "game.five.hud.bestRow"), state.dead[k] ? t("game.five.hud.inRow", { n: state.winLen - 1 }) : row]],
                bar: row / state.winLen,
                barText: `${row} / ${state.winLen}`,
                leading: leading[k],
            })),
        };
    }

    const summary = (state) => t("hud.moves", { count: state.history.length });

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
    title: "game.five.title",
    tagline: "game.five.tagline",
    desc: "game.five.desc",
    preview: "0.110...0",
    size: { min: 5, max: 25, default: 11, presets: [9, 11, 13, 15, 19] },
    minSize: (cfg) => Math.max(5, cfg.winLen),     // the board can't be smaller than the row to win
    settings: [
        { key: "winLen", label: "game.five.set.winLen", type: "preset", presets: [3, 4, 5, 6, 7], def: 5, min: 3, max: 25,
          customLabel: "game.five.set.winLenCustom" },
        /* The Yavalath rule: one stone short of the winning row loses (the classic is 4 wins,
           3 loses). The row is named after what it does and follows the win length, because
           "Yavalath rule" told a player nothing (owner, 2026-09-11). */
        { key: "yavalath", label: (cfg) => I18n.t("game.five.set.yavalath", { n: Math.max(2, (cfg.winLen || 5) - 1) }), type: "bool", def: false },
    ],
    // Learn (#41): the rules in one sentence each and a guided tutorial on a 9×9 board.
    // The scenarios come from the proven puzzle set (client/learn/five-scenarios.js).
    howto: {
        rules: ["game.five.rule.1", "game.five.rule.2", "game.five.rule.3", "game.five.rule.4", "game.five.rule.5", "game.five.rule.6"
        ],
        tutorial: [
            {
                config: { n: 9, winLen: 5 },
                moves: [],
                text: "game.five.tutorial.1",
                expect: [40],
            },
            {
                moves: [40, 20],
                text: "game.five.tutorial.2",
                expect: [41],
            },
            {
                moves: [40, 20, 41, 21],
                text: "game.five.tutorial.3",
                expect: [42],
            },
            {
                moves: [40, 20, 41, 21, 42, 19],
                text: "game.five.tutorial.4",
                expect: [39],
            },
            {
                moves: [40, 20, 41, 21, 42, 19, 39, 43],
                text: "game.five.tutorial.5",
                expect: [38],
            },
            {
                moves: [40, 20, 41, 21, 42, 19, 39, 43, 38],
                text: "game.five.tutorial.6",
            },
        ],
    },
    describeRules: (cfg) => [I18n.t("game.five.sum.row", { n: cfg.winLen })],
    describeOptions: (cfg) => (cfg.yavalath ? [I18n.t("game.five.sum.yavalath", { n: cfg.winLen - 1 })] : []),
    rules: FiveRules,
    view: FiveView,
});
