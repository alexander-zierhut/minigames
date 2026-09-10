# Warden — Isolation bot

A searching bot for **Isolation** (n×n tiles 5–12, two to four pawns), pure and headless
(`bot.js`, one classic script, registers as `warden-isolation`). A move is one integer,
`to * n * n + removed`: step onto one of the up to 8 neighbouring tiles that still exists and
is free, then break any remaining tile nobody stands on.

| id | label | nodes | search |
| --- | --- | --- | --- |
| `easy` | Easy | 2 000 | depth 1 with 6 broken-tile candidates per step; picks with seeded spread among the moves within 220 points of the best |
| `normal` | Normal | 10 000 | alpha-beta depth 2, 8 candidates |
| `hard` | Hard | 30 000 | iterative deepening to depth 4, 10 candidates |
| `very-hard` | Very hard | 100 000 | iterative deepening until the budget ends (cap 14), 12 candidates |

The budget is always a node budget (the level's `nodes` in the app, `ms: Infinity`; 2 000 /
20 000 in tests and the benchmark), so every machine gets identical moves. `d.tick()` runs
once per searched node; Hard and Very hard `await tools.yield()` between deepening
iterations.

## How it works

**Board** (`Board`): an `Int8Array` per tile (`-2` broken, `-1` free, `>= 0` the pawn of that
seat) plus the pawn positions, a `trapped` flag per seat and a precomputed 8-neighbour list.
`make`/`unmake` move one pawn and break one tile in place (breaking the tile the pawn just
left works out of the box, the hole is written last). `advance` passes the turn exactly the
way the rules do: whoever cannot step **when their turn comes** is trapped and out, and the
last one standing wins, so the search sees the game that is actually played.

**Search**: paranoid alpha-beta — the seat we play for maximises, every other seat minimises
— with iterative deepening and the previous iteration's best move first. The raw branching
factor is 8 steps × every free tile, far too much, so the generator keeps every step but only
the broken tiles that matter: the free tiles within Chebyshev distance 2 of an opponent
(distance 1 first, because breaking next door is what shrinks somebody), the tile the pawn
leaves behind, capped per difficulty. Moves are ordered by how open the destination is plus
how close the broken tile is to an opponent, with ties broken by move id, so nothing depends
on the machine.

**Evaluation** (from the playing seat's view): a **Voronoi** count — one multi-source BFS
with king steps gives every free tile to the pawn that reaches it first, tiles reached at the
same distance by two pawns belong to nobody — as `territory`, plus `mobility` (free
neighbours) and a small tempo term. Territory is also the right measure once the board falls
apart: a pawn alone in its region owns exactly the tiles it can still reach, which is how long
it can survive. Trapping somebody scores `WIN - ply`, so a faster trap beats a slower one.

## Win chance (`evaluate`)

`evaluate(state, tools)` returns a raw score from **player 0's** view, `±Infinity` when the
position is proven. It runs the same search with a narrower generator (4 broken-tile
candidates, which buys a ply or two) and **averages two searches**: the real position, and
the same position with the other seat to move. Any minimax value carries a tempo artefact —
with the mover choosing last a position looks better for them than with the mover choosing
first — and in Isolation that made the bar jump by 30 points every single move. The pair is
symmetric by construction, so what is left is the position rather than whose turn it is. Both
halves always run to the same depth; a proven result for the real position wins outright
(`±Infinity`), a proven result for the hypothetical half is worth a large finite number.
Budgets up to 4 000 nodes answer synchronously (the HUD's first stage), longer ones return a
Promise and breathe between plies.

Measured on the calibration self-play (`npm run calibrate`): the systematic offset dropped
from shift 464 to 271 and the mean move-to-move change from **32 % to 11.7 %** when the root
learned to minimise for the other seat and the two halves were averaged; Brier 0.206,
calibrated scale ≈ 693.

## Numbers

`benchmark.js` (generated, `npm run benchmark warden-isolation`): **100 % vs Random** over
100 seeded 7×7 games at Very hard, **198/200 puzzles** (blind random picking scores 20.8 %).
Per level on the puzzle set at a 20 000-node budget: Easy 68.5 %, Normal 90 %, Hard 97 %,
Very hard 99 %; every `win-in-1` and every `avoid-trap` puzzle is solved at every level.

## Tests

`bot.test.mjs`: takes an immediate trap at every level, never walks into one when a safe move
exists, beats Random in a seeded series as either seat, a stronger level is never worse than a
weaker one, same seed and budget give the same move, the puzzle thresholds above, and the
evaluator's contract (`±Infinity` when decided, deterministic per budget, a walled-in pawn
scores negative). The shared conformance suite in `tests/unit/bots.test.mjs` covers legality,
determinism and speed for every difficulty.
