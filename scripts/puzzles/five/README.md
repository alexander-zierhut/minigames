# Five Wins puzzles

Test positions for **Five Wins** (gomoku without gravity: n×n board, `winLen` **or more**
in a row in one of four directions wins; a full board is a draw, and so is a *dead* board
where no window of `winLen` cells is free of enemy stones for either side — #18) whose
perfect move(s) are computed by an algorithm, so bots can be graded on how many perfect
moves they find.

```
node scripts/puzzles/five/generate.mjs         # regenerates puzzles.json (≈ 2 min, deterministic)
node --test tests/puzzles/five/solver.test.mjs
```

Files: `solver.mjs` (the solver), `generate.mjs` (seeded playouts + hand-crafted positions →
`puzzles.json`), `puzzles.json` (the data), `solver.test.mjs`.

## Format

```json
{ "game": "five", "generated": "YYYY-MM-DD", "solver": "…",
  "puzzles": [ { "id": "five-0001", "config": { "n": 9, "winLen": 5 }, "history": [ … ],
                 "toMove": 0, "best": [32], "value": "win", "depth": 5,
                 "tags": ["win-in-3"], "note": "…" } ] }
```

- `history`: every move from the empty board (cell id = `y * n + x`, player 0 moves first);
  replaying it with `FiveRules` gives a position that is not over with `state.current ===
  toMove`.
- `best`: **every** optimal move, sorted. For a win: all moves that force the win in the
  fewest plies. For a draw: all moves that hold the draw.
- `value`: from the mover's perspective. Only `win` and `draw` puzzles are included (lost
  positions have no meaningful "perfect move").
- `depth`: plies until the forced result (`1` = wins on the spot, `3` = win-in-2, `5` =
  win-in-3, …) or the string `"exhaustive"` for draws.
- Every puzzle has at least one legal move that is worse than `best` (a mistake is possible),
  and no two puzzles are the same position up to the 8 board symmetries.

## What the solver guarantees

`solve(state, options)` in `solver.mjs` only ever returns **proven** results; when it cannot
prove anything the value is `"unknown"` and such positions never become puzzles.

1. **Threat search** (`proveWin`, runs first): proves a forced win for the side to move
   within ≤ 5 plies. The root tries every legal move and the defender always has its
   complete set of non-losing replies (all empty cells; or, when the attacker can complete
   a line next move, exactly the block / an own immediate win — every other reply loses on
   the spot, which is a rule of the game, not a heuristic). Only the attacker's *later*
   moves are restricted to cells in an enemy-free window that already holds ≥ winLen-3 own
   stones. A win at ply 5 needs the attacker's move at ply 3 to create two completion
   cells at once (otherwise the single one is blocked), which requires exactly such
   windows, so nothing within 5 plies can be missed. Hence for `depth ≤ 5`, `best` is the
   complete set of fastest winning moves and "no win within 5 plies" is a proven fact.
2. **Exhaustive alpha-beta negamax** (`solveExhaustive`): searches every line to a win, a
   loss or a draw (a full board, or a dead board — `Board.dead()` keeps a count of the
   windows still free of enemy stones per side, so the rules' early draw ends a line at
   the same move it ends the real game) — there is no static evaluation and no depth
   limit, so the result is the game-theoretic value. Scores carry the distance to the result, so the root
   returns the fastest wins. Exact pruning only: a side that can complete a line does so;
   a side facing two enemy completion cells has lost; facing one, its only non-losing move
   is that cell. A transposition table keyed by the exact board (no hashing collisions)
   makes it fast enough for boards with ≲ 25–30 empty cells. After the solve, every legal
   move is classified exactly (win/draw/loss) via null-window probes → `moveValues`, which
   the generator uses for the "a mistake is possible" filter and the `avoid-loss` tag. A
   node budget aborts the search on boards that are too open (→ `"unknown"`).

Both engines agree on won positions (checked in `solver.test.mjs` and asserted during
generation). Everything is deterministic: no randomness in the solver, `Bots.rng` (seeded
mulberry32) in the generator, ordering ties broken by cell id.

## The Yavalath variant (`tests/puzzles/five-yavalath`)

`node scripts/puzzles/five/generate.mjs yavalath` writes a second, independent set for the
rule where `winLen` still wins but a stone whose longest line is exactly `winLen - 1` loses
for its owner (`config.yavalath`, 6×6 to 9×9 with `winLen` 4). The same solver produces it:
`Board.suicidal(i, p)` says whether a cell would make that losing row, such moves are never
generated (they end the game at once, so they can only be optimal when nothing else is
left), a side with no safe move has lost on the spot, and a *forced block* on such a cell
loses too, which is the winning idea of the game.

The guarantee is narrower in one place: the threat search proves at most **3** plies there
(`MAX_PROOF_YAV`), because only at that depth is it complete without the attacker's
candidate restriction (root: every legal move, defender: every legal reply, attacker at ply
2: only an immediate completion). Everything deeper comes from the exhaustive engine, which
knows the rule the same way. Two extra tags: `avoid-three` (a move that makes the losing row
is on the board and no best move is one) and `forced-three` (after the best move every reply
the opponent has left loses). `scripts/puzzles/verify.mjs` re-proves both without the solver.

## Tags

| tag | meaning |
| --- | --- |
| `win-in-1` | the mover can complete a line now (`depth` 1) |
| `prefer-win` | … while the opponent also threatens to complete one: take the win, don't block |
| `must-block` | the opponent has exactly one completion cell and the mover no own win: the block is the only move that does not lose on the spot (value may be draw or win) |
| `win-in-2` / `win-in-3` / `win-in-N` | forced win in N own moves (`depth` 2N-1) |
| `double-threat` | win-in-2 by creating two completion cells with one move (open four / double four) |
| `draw` | best play holds the draw (exhaustively solved); other moves are worse |
| `avoid-loss` | every move outside `best` loses by force (and it is not a trivial must-block) |
| `endgame-exhaustive` | solved exhaustively: value and `best` are game-theoretic facts |

Board mix: 5×5/4, 6×6/4, 6×6/5, 7×7/4, 7×7/5, 8×8/5, 9×9/5; both colours to move (the
generator keeps the counts within 6 of each other). Per-board tag caps keep the mix even.

## Limits — what is NOT covered

- Big, open boards (7×7 and larger with > ~20–30 empty cells) are only covered by the
  threat search, i.e. only as **win** puzzles with `depth ≤ 5`. Draws, must-blocks and
  longer forced wins on such boards are not provable here and are not included: the
  "must-block" puzzles come from boards small/full enough to exhaust, so their value is
  known (a must-block on a big board would have an unknown value after the block).
- Forced wins deeper than 5 plies only appear when the board was exhausted (`win-in-4`,
  `win-in-5` on small boards); the threat search never claims anything beyond 5 plies and
  never claims a draw or a loss.
- `best` for a win means *fastest* win. A bot that plays a slower forced win is not
  counted as "perfect" on that puzzle (`moveValues` from `solveExhaustive` tells win/draw/loss
  per move when finer grading is wanted).
- Positions where the mover is lost are excluded, as are positions where every legal move
  is optimal.
- Generation samples every 2nd/3rd position of seeded playouts and takes ≤ 2 puzzles per
  game, so the set is diverse but not a uniform sample of "realistic" positions.
