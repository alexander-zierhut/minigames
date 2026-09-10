# Creeper — Chain React bot

A searching bot for Chain React with four levels. Pure and headless: it only sees the
game state and the toolset (`Bots.tools`), never the DOM, so it runs identically in the
browser and in Node. Under a node budget the same seed gives the same move on any
machine; `tools.random` is used only for Easy's noise.

| Level | id | thinkMs | search |
| --- | --- | --- | --- |
| Easy | `easy` | 30 | one ply on the static evaluation; 30 % random moves, otherwise one of the best three (seeded) |
| Normal | `normal` | 150 | alpha-beta to 2 plies + quiescence |
| Hard | `hard` | 600 | iterative deepening to 4 plies + quiescence, yields to the page |
| Very hard | `veryhard` | 1500 | iterative deepening as deep as the budget allows (depth 60 cap), yields to the page |

In the app the budget is the level's `thinkMs`; tests and the benchmark pass a node
budget (2 000 / 20 000 nodes). At 20 000 nodes on 6×6 (four games each, desktop):
Easy 0.1 ms, Normal 0.5 ms, Hard 10 ms (max 19), Very hard 22 ms per move (max 29),
≈ 1 µs per node, reaching 4–5 plies plus quiescence. Very hard's 1.5 s therefore
covers hundreds of thousands of nodes even on a mid-range phone.

## Engine

- **Rules on typed arrays** (`applyInto`): `cnt`/`own` per cell, incremental wave
  resolution (only touched cells are re-checked for the next wave), cell counts per player
  kept as landings happen so the "board decided" stop and the takeover win are free. The
  chain rule (`config.chainRule`/`chainLen`) is honoured. `bot.test.mjs` proves it identical
  to `ChainRules.place + settle + conclude` on 3 500 random moves (3×3 … 8×8, chain rule
  on and off): cells, side to move, over, winner.
- **Evaluation** (side-to-move relative, one unit ≈ one piece). Per owned cell: its
  pieces; if an enemy *critical* cell (one piece from exploding) is next to it, the cell is
  *exposed* and costs `2 + pieces` (+2 more if it is critical itself: it then explodes for
  the enemy); otherwise a safe corner is worth +3, an edge +2, and a safe critical cell
  gets +1 per own critical neighbour (chain potential). A "safe critical cell is a threat"
  bonus was tried and removed: it double-counts the opponent's exposure penalty and lost
  64 % of self-play games against the version without it.
- **Search**: negamax alpha-beta, iterative deepening, transposition table (Zobrist keys
  over cells + side to move + "both have moved" — sound because the piece count grows by
  one every move, so no position repeats), killer moves, history heuristic, static move
  ordering (explosions first, biggest captures and chains first; moves next to an enemy
  critical cell last), principal variation search and late move reductions for quiet
  moves, and a 3-ply quiescence search over explosive captures (stand-pat, then only own
  critical cells with an enemy neighbour). Terminal positions are mate-distance scores, so
  the fastest win / longest defence is preferred and iterative deepening stops once a
  forced result is found. The root keeps the last completed depth (or the best of a
  partial iteration once its first move — the previous best — finished).
- **Budget**: `tools.deadline()` per move, `tick()` on every searched node (regular and
  quiescence). Hard and Very hard `await tools.yield()` every ~2 000 nodes (checked after
  each root move).

## Win chance (`evaluate`)

`evaluate(state, tools)` → raw score for **player 0** (0 = even, positive = player 0
better, ±Infinity = decided by rule or proven by the search), in the evaluation's units
(≈ pieces of advantage). The framework maps it to a probability with a calibration fitted
from self-play (`scripts/calibrate.mjs`); a clear advantage is about **S ≈ 10** units
(maximum-likelihood scale on ten Normal-vs-Normal games at 12 000 nodes: 10; at 2 000 and
60 000 nodes: 9).

Built for stability, because a small odd-depth search always credits the side to move and
that side alternates — the old 600-node estimate zigzagged by ±4 points every move:

- iterative deepening over **even depths only**; only fully completed depths count and the
  result is the mean of the last three (depth 0 = the root's quiescence value, so
  2 000 nodes on 6×6 blend depths 0 and 2, 12 000 nodes 0/2/4, 60 000 nodes up to 6);
- a **10-ply quiescence** over explosive captures at every leaf (no hanging chain in the
  static evaluation), no late-move reductions;
- the node budget is honoured exactly (`tools.deadline()`, one tick per node, no clock), so
  both online clients compute the same number; above 5 000 nodes the search yields to the
  page every 2 000 nodes and returns a Promise, below that a plain number;
- terminal positions are exact, a proven forced win/loss is ±Infinity (an immediate
  takeover for the side to move is always found), an empty board is 0, mirror images
  negate exactly.

Measured on the same ten games (six seeded random plies, then Creeper Normal vs Normal on
6×6, 679 positions), p = logistic(raw / 10), mean |Δp| between consecutive positions:

| | all steps | undecided steps | mover bias | ms/position |
| --- | --- | --- | --- | --- |
| old `estimate` (600 nodes) | 0.0563 | 0.0548 | ±0.039 | 0.5 |
| `evaluate` 2 000 nodes | 0.0503 | 0.0437 | ±0.016 | 1.8 |
| `evaluate` 12 000 nodes | 0.0579 | 0.0427 | ±0.008 | 15 |
| `evaluate` 60 000 nodes | 0.0549 | 0.0365 | ±0.006 | 59 |

"Undecided" = neither position is a proven win; the mover bias is the mean of
p − (p_before + p_after)/2 by side to move. The "all steps" number does not fall because
the judge proves forced wins that a depth-2 Normal bot then throws away — a real
100 → 0 swing (and ±Infinity by contract), not a jumpy evaluator; the finite part gets
calmer with every stage. Blending odd and even depths (bias back to ±0.048), a
tempo-neutral leaf (mover's and opponent's quiescence averaged: swing 0.11) and a
3-ply quiescence (0.084) were tried and rejected. `bot.test.mjs` re-measures this and
asserts all steps < 0.065, undecided < 0.05, bias < 0.02.

## Numbers (node budgets, deterministic)

See `benchmark.js` (generated by `npm run benchmark creeper-chain`) for the score vs
Random and the puzzle score of Very hard. `bot.test.mjs` prints the per-level puzzle
scores on `tests/puzzles/chain/puzzles.json` (159 proven puzzles, chance 23.2 %,
Random 22 %) and the head-to-head results; its thresholds sit below the measured values.

## Known weaknesses

- The evaluation is hand-tuned (self-play matches at 20 000 nodes, 100 games per
  variant); no opening knowledge, no board-symmetry folding in the table.
- Very hard is horizon-limited on big boards (10×10+): at 1.5 s it sees fewer plies there
  and the static evaluation carries more weight.
- Quiescence only looks at the mover's explosive captures; a long-range double threat
  beyond the horizon can still surprise it.
- The win chance is as strong as its 2–6 plies: in wild endgames it proves wins the
  players do not see, so the HUD can legitimately jump between 100 % and 0 % when weak
  players blunder them away.
- Two players only (the app fixes `players` at 2); with a different seat count it plays
  the toolset's fallback.
