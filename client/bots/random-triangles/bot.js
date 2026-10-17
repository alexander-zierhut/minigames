/* Random: Triangles. Stretches any band it may. The name says it all.
   Serves as the baseline every real bot is benchmarked against. */

"use strict";

Bots.register({
    id: "random-triangles",
    name: "Random",
    baseline: true,                 // the benchmark opponent and the illegal-move fallback, never offered to players (#21)
    game: "triangles",
    version: 1,
    description: "Stretches a random band. Beating it is the least you can do.",
    difficulties: [{ id: "normal", label: "Normal" }],
    create(tools) {
        return {
            move(state) { return tools.pick(tools.legalMoves(state)); },
        };
    },
});
