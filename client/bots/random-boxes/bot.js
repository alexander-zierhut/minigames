/* Random — Käsekästchen. Draws any undrawn line. The name says it all.
   Serves as the baseline every real bot is benchmarked against. */

"use strict";

Bots.register({
    id: "random-boxes",
    name: "Random",
    baseline: true,                 // the benchmark opponent and the illegal-move fallback, never offered to players (#21)
    game: "boxes",
    version: 1,
    description: "Draws a random line, box or no box. Beating it is the least you can do.",
    difficulties: [{ id: "normal", label: "Normal" }],
    create(tools) {
        return {
            move(state) { return tools.pick(tools.legalMoves(state)); },
        };
    },
});
