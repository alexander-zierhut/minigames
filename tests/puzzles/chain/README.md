# Chain React puzzles

Positions from Chain React whose perfect moves are **proven** by a solver, so bots can be
graded on how many of them they find. Consumed by the shared runner `tools/puzzles.mjs`
(`evaluateBot`), which replays each `history` with the real `ChainRules` and checks whether
the bot's move is in `best`.

Files:

- `solver.mjs` — `solve(state, { depth, nodes })` for a `ChainRules` state (2 players,
  chain rule off). Pure, no DOM; re-implements the rules on typed arrays for speed
  (`solver.test.mjs` checks them against the real module on thousands of random moves).
- `generate.mjs` — `node tests/puzzles/chain/generate.mjs [--verbose]` rebuilds
  `puzzles.json` deterministically (seeded playouts + hand-crafted positions, fixed node
  budgets, no wall-clock decisions). ~30 s on a laptop. The `generated` date is kept when
  the puzzles did not change, so a re-run never creates a diff.
- `puzzles.json` — the set (159 puzzles: 3×3, 4×4, 5×5, 6×6; both colours to move).
- `solver.test.mjs` — `node --test tests/puzzles/chain/solver.test.mjs` (< 2 s).

## What the solver guarantees

`solve` returns `{ value, best, depth, exhaustive, nodes, losesNow }` from the point of
view of the player to move, or `null` when nothing could be proven. It never guesses.

- `value: "win"` — the mover has a forced win. `depth` is the number of plies of the
  **fastest** forced win (1 = the move ends the game now, 3 = "win in 2", 5 = "win in 3").
  `best` is every move that forces the win in exactly `depth` plies.
- `value: "loss"` — every move loses by force. `depth` is how many plies the mover can
  hold out with the best defence; `best` is every move that survives that long.

"Perfect move" therefore means *fastest forced win* (or *longest defence*). A bot that
picks a slower win is marked wrong on that puzzle. This stricter definition is what makes
the result provable with a depth-limited search: "no faster win exists" only needs the
tree inside the horizon, whereas "no other move wins at all" would need the whole game.

Why a bounded search is a proof here:

1. A move adds one piece and explosions only move pieces around, so the number of pieces
   on the board grows by one per move: a position can never repeat, the game is a finite
   DAG and cannot cycle, and a settled board holds at most `sum(cap − 1)` pieces
   (3×3: 15, 4×4: 32, 5×5: 55, 6×6: 84) — a hard bound on the game length. This also makes
   a transposition table keyed by the cells alone sound.
2. The only way a game ends (chain rule off) is "the opponent owns no cell", the mover
   always keeps at least one cell, and there are no draws.
3. The search is negamax/alpha-beta with mate-distance scores (`±(MATE − ply)`) and
   `0` for "not resolved within the horizon". A node can only score non-zero if **every**
   line below it inside the horizon ends in a terminal position — a single unresolved leaf
   scores 0, which beats every loss and loses to every win, so it blocks the proof. A
   non-zero root score is therefore a proof, and because the horizon-limited game is solved
   exactly, the reported distance is the true fastest win / longest defence. With
   `depth: Infinity` every leaf is terminal ("exhaustive"). Transposition entries carrying
   a mate score are reused at any depth; entries scoring 0 only for searches of at most
   the same depth.
4. If the node budget runs out, or the root scores 0, the result is `null`.

`solver.test.mjs` additionally checks the search against a plain brute-force minimax
(no pruning, no table) on random 3×3/4×4 endgames: value, plies and the complete best set
must agree, and any depth-limited proof must agree with the exhaustive truth.

## Puzzle format

```json
{ "game": "chain", "generated": "YYYY-MM-DD", "solver": "…",
  "puzzles": [ { "id": "chain-0001", "config": { "n": 3, "chainRule": false },
                 "history": [0, 1], "toMove": 0, "best": [0], "value": "win", "depth": 1,
                 "tags": ["win-in-1", "endgame-exhaustive", "opening"], "note": "…" } ] }
```

`history` is the full move list from the empty board (player 0 starts); `toMove` is the
player to move; `best` lists every perfect move; `depth` is in plies (see above).

## Tags

| tag | meaning |
| --- | --- |
| `win-in-N` | the mover forces a win in N of their own moves (`depth` = 2N − 1 plies); `win-in-1` = the move ends the game now |
| `avoid-loss` | every move outside `best` allows an immediate takeover by the opponent, and no best move does; the best moves are not immediate wins themselves |
| `delay-loss` | the position is lost; `best` are the moves that hold out the longest |
| `endgame-exhaustive` | solved to the end of the game with no depth limit (3×3 and 4×4) |
| `opening` | at most 4 moves played and solved exhaustively (3×3 only) |

Only positions where at most half of the legal moves are perfect are kept (a puzzle where
everything is right grades nothing). Positions equal under one of the 8 board symmetries
are kept once. Per board size, tag and colour to move there is a quota so the set stays
mixed.

## Limits

- Two players, `chainRule: false` only (the solver throws otherwise).
- Exhaustive solving is practical on 3×3 from the empty board (~100 k nodes) and on 4×4
  from about move 12 on; 5×5 and 6×6 puzzles come from a 4-ply horizon (wins up to 5
  plies, losses up to 4 plies), so they are tactical endgames, not openings. Anything not
  proven within the node budget is skipped, never included.
- "Best" means fastest win / longest defence — a slower winning move counts as a miss.
- `generate.mjs` is deterministic given the plan constants in the file; changing a budget
  or seed changes the set (regenerate and commit `puzzles.json`).
