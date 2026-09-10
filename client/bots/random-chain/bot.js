/* Random — Chain React. Picks any legal move. The name says it all.
   Serves as the baseline every real bot is benchmarked against. */

"use strict";

Bots.register({
    id: "random-chain",
    name: "Random",
    baseline: true,                 // the benchmark opponent and the illegal-move fallback, never offered to players (#21)
    game: "chain",
    version: 1,
    description: "Plays a random legal move. Beating it is the least you can do.",
    difficulties: [{ id: "normal", label: "Normal" }],
    create(tools) {
        return {
            move(state) { return tools.pick(tools.legalMoves(state)); },
        };
    },
});
