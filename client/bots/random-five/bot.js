/* Random — Five Wins. Puts a stone on any empty cell. The name says it all.
   Serves as the baseline every real bot is benchmarked against. */

"use strict";

Bots.register({
    id: "random-five",
    name: "Random",
    baseline: true,                 // the benchmark opponent and the illegal-move fallback, never offered to players (#21)
    game: "five",
    version: 1,
    description: "Places a stone on a random empty cell. Beating it is the least you can do.",
    difficulties: [{ id: "normal", label: "Normal" }],
    create(tools) {
        return {
            move(state) { return tools.pick(tools.legalMoves(state)); },
        };
    },
});
