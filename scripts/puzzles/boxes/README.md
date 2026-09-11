# Dots and Boxes puzzles

Test positions for **Dots and Boxes** (dots and boxes: n × n boxes, a move draws one of the
2n(n+1) lines, closing a box wins it and gives you another turn, the game runs until every
line is drawn and the most boxes wins) whose perfect move(s) are **proven** by an exhaustive
solver, so bots can be graded on how many perfect moves they find.

```
node scripts/puzzles/boxes/generate.mjs        # regenerates puzzles.json (≈ 1 min, deterministic)
node --test tests/puzzles/boxes/solver.test.mjs
node scripts/puzzles/verify.mjs boxes          # solver-independent re-proof of the tactical tags
```

Files: `solver.mjs` (the solver), `generate.mjs` (seeded playouts → `puzzles.json`),
`../../../tests/puzzles/boxes/puzzles.json` (the data), `solver.test.mjs`.

## Format

```json
{ "game": "boxes", "generated": "YYYY-MM-DD", "solver": "…",
  "puzzles": [ { "id": "boxes-0001", "config": { "n": 4 }, "history": [ … ],
                 "toMove": 0, "best": [17], "value": "win", "depth": 14,
                 "tags": ["endgame-exhaustive", "take-box"], "note": "…" } ] }
```

- `history`: every line drawn from the empty board, in play order (player 0 draws first,
  and a player who closed a box draws again). Replaying it with `BoxesRules` gives a
  position that is not over with `state.current === toMove`.
  Line numbering: the n(n+1) horizontal lines first, row-major (`h(r, c) = r * n + c`,
  r = 0…n, c = 0…n-1), then the n(n+1) vertical ones (`v(r, c) = n(n+1) + r * (n+1) + c`,
  r = 0…n-1, c = 0…n). Box `r * n + c` is closed by `h(r,c)`, `h(r+1,c)`, `v(r,c)`, `v(r,c+1)`.
- `best`: **every** line that reaches the best possible final box difference for the mover,
  sorted. Not "every line that still wins": the yardstick is the exact final margin, so a
  bot that wins by less is not counted as perfect on that puzzle.
- `value`: `win` / `draw` / `loss` of the whole game from the mover's view, counting the
  boxes already won plus the boxes best play still gets. Positions where the mover is lost
  are kept (unlike the other games): the perfect move is still a fact, and holding a lost
  position to the smallest margin is exactly what the endgame is about.
- `depth`: the number of undrawn lines, which is how far the exhaustive search had to go.
  Never below 6, so no puzzle is trivially over.
- Every puzzle has at least one legal line that is worse than `best`, and the difference is
  real: either the best line beats every other by **two boxes or more**, or the others throw
  the result away (win becomes draw or loss). No two puzzles are the same position under the
  8 board symmetries and the same score difference.

## What the solver guarantees

`solveExhaustive(board)` in `solver.mjs` searches the remaining game **to the last line** and
returns the game-theoretic value, every optimal line and the exact value of every legal line.
There is no static evaluation and no depth limit, so nothing here is a heuristic.

1. **Turn-independent values.** Closing a box keeps the mover on turn, so the value of the
   rest of the game is "boxes for whoever moves next minus boxes for the other one" and
   depends on the set of undrawn lines alone. That makes a transposition table with one
   entry per subset of undrawn lines correct (the mask of lines drawn since the root, so up
   to 30 undrawn lines fit an int32) and it is what makes the search fast.
2. **One exact reduction.** A capture is *free* when the line closes a box and leaves no
   other open box with three sides behind (its second box is missing, already closed, closed
   by the same line, or still has at most one side). Taking a free box is always at least as
   good as anything else: the mover keeps the turn either way, so leaving it costs the tempo
   nothing and hands a box over. Captures that *do* open the next box are never forced,
   which is exactly the "all but two" decision, and the search branches on it.
3. **Proved, not assumed.** `solveBrute` in the same file solves a position with no table,
   no pruning and no forced captures at all. `solver.test.mjs` compares the two engines on
   80 seeded positions with 7 to 9 undrawn lines (value and the complete set of optimal
   lines) and re-solves every puzzle of the set. `scripts/puzzles/verify.mjs` re-proves the
   structural tags with the real rules and no solver at all.
4. **Reach.** A 2 × 2 board (12 lines) is solved from empty in a few thousand nodes: the
   first player wins it 3 boxes to 1. A 3 × 3 board (24 lines) is solved from empty in about
   9 million nodes and 5 seconds: whoever starts **loses** it 3 boxes to 6. Endgames of
   4 × 4 and 5 × 5 with up to ~24 undrawn lines take milliseconds.

Everything is deterministic: no randomness in the solver, `Bots.rng` (seeded mulberry32) in
the generator, ties broken by line number.

## Tags

| tag | meaning |
| --- | --- |
| `endgame-exhaustive` | solved to the last line: the value and `best` are game-theoretic facts (every puzzle has this) |
| `take-box` | a box is on the table and every optimal line closes one |
| `double-deal` | a box is on the table and every optimal line **declines** it: giving two boxes away to keep control is worth more |
| `safe-move` | no box on the table, and the optimal lines are the ones that hand nothing over while others do |
| `sacrifice` | every line opens something (a loony position): the art is conceding as little as possible |
| `avoid-loss` | the position is not lost and every line outside `best` loses the game |

Board mix: 2 × 2 (whole boards), 3 × 3 (endgames plus a deep pass of up to 24 undrawn
lines, which is nearly the whole board), 4 × 4 and 5 × 5 endgames. Both colours to move,
kept within 6 of each other. Per-board tag caps keep the mix even.

## Limits — what is NOT covered

- Openings of 4 × 4 and larger boards. A 4 × 4 board has 40 lines and a 5 × 5 board 60; only
  positions with at most 22 undrawn lines are exhausted, so the set is an endgame and
  late-middlegame set. The long-chain strategy of the opening is not represented.
- `best` means "reaches the best final margin". A bot that wins the game but by fewer boxes
  scores 0 on that puzzle. `moveValues` inside the solver knows the finer picture, but the
  set only ships the optimal lines.
- Only two players. The rules run for three and four, but the value of a position is not
  turn-independent then, and "perfect play" with three players is not a single number.
- The generator samples seeded playouts whose policy takes free boxes and mostly plays safe
  lines, so the positions look like real games but are not a uniform sample of all positions.
