/* Random — Isolation. Steps to a random free neighbour and breaks a random tile.
   Serves as the baseline every real bot is benchmarked against. */

"use strict";

Bots.register({
    id: "random-isolation",
    name: "Random",
    baseline: true,                 // the benchmark opponent and the illegal-move fallback, never offered to players (#21)
    game: "isolation",
    version: 1,
    description: "Steps anywhere it may and breaks any tile. Beating it is the least you can do.",
    difficulties: [{ id: "normal", label: "Normal" }],
    create(tools) {
        return {
            move(state) { return tools.pick(tools.legalMoves(state)); },
        };
    },
});
