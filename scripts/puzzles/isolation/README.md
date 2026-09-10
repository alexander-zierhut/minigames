# Isolation puzzles

Test positions for **Isolation** (n×n tiles, one pawn per player: step to one of the up to
8 neighbouring tiles that still exists and is free, then break any remaining tile nobody
stands on; whoever cannot step when their turn comes is trapped and out) whose perfect
move(s) are computed by an algorithm, so bots can be graded on how many perfect moves they
find.

```
node scripts/puzzles/isolation/generate.mjs      # regenerates puzzles.json (≈ 30 s, deterministic)
node --test tests/puzzles/isolation/solver.test.mjs
node scripts/puzzles/verify.mjs isolation        # solver-independent one-ply re-proof
```

Files: `solver.mjs` (the solver), `generate.mjs` (seeded playouts → `puzzles.json`),
`../../../tests/puzzles/isolation/puzzles.json` (the data), `solver.test.mjs`.

## Format

```json
{ "game": "isolation", "generated": "YYYY-MM-DD", "solver": "…",
  "puzzles": [ { "id": "isolation-0001", "config": { "n": 6, "startPlayer": 0 },
                 "history": [ … ], "toMove": 0, "best": [1234, 1240],
                 "value": "win", "depth": 1,
                 "tags": ["endgame-exhaustive", "win-in-1", "trap-now"], "note": "…" } ] }
```

- A move is one integer, `to * n * n + removed` (`to` = the tile the pawn steps onto,
  `removed` = the tile it breaks; cell id = `y * n + x`).
- `history`: every move from the start position; replaying it with `IsolationRules` and the
  puzzle's `config` (the `startPlayer` matters) gives a position that is not over with
  `state.current === toMove`.
- `best`: **every** move that keeps the win, sorted. Isolation has no draws, so a slower
  win is still a win and counts as perfect; the set never contains a lost position, where
  "perfect move" would mean nothing.
- `value`: always `"win"` (from the mover's view).
- `depth`: `1` when *every* best move traps the opponent on the spot, otherwise the string
  `"exhaustive"` (the value is proven, the distance is not part of the data).
- Every puzzle has at least one legal move that loses (a mistake is possible), at most half
  of the legal moves are best, and no two puzzles are the same position up to the 8 board
  symmetries.

## What the solver guarantees

`solve(state, options)` / `solveExhaustive(board, options)` in `solver.mjs` only ever
return **proven** results; when the node budget runs out the value is `"unknown"` and such
positions never become puzzles.

Isolation cannot be drawn: every move breaks exactly one tile, so the game is finite, and
it ends the moment the player to move has no free neighbour left, which is a loss for
exactly that player. The solver therefore searches **every line to the end** with a plain
win/loss negamax. There is no static evaluation, no depth limit and no heuristic pruning,
so what comes back is the game-theoretic value. Two exact reductions make that affordable:

1. **Dead tiles are interchangeable.** A free tile that neither pawn's component holds
   (over the tiles that still exist, king steps, with both pawns counted as passable, which
   over-approximates reachability and therefore stays safe) can never be stepped on by
   anybody. Breaking it is a pure waste move, and two positions that differ only in *which*
   dead tile was broken are the same game: the reachable structure is identical and the
   number of waste moves left is the same. The search therefore offers exactly one
   representative dead tile. `solver.test.mjs` checks the premise on a walled board.
2. **Transposition table.** A position is fully described by the tiles that still exist,
   the two pawns and the side to move (the number of broken tiles fixes how far the game
   has come), and the values are plain booleans, so every solved position is reused.

The root is then classified over **all** legal moves, one win/loss search each against the
warm table, which is what makes `best` complete and `moveValues` exact.

`scripts/puzzles/verify.mjs isolation` re-proves the tactical puzzles without the solver:
a one-ply look-ahead through the real rules confirms that every `win-in-1` best move really
ends the game (and that no other move does), and that after every non-best move of an
`avoid-trap` puzzle the opponent can trap the mover at once.

## Tags

| tag | meaning |
| --- | --- |
| `endgame-exhaustive` | solved exhaustively: the value and `best` are game-theoretic facts (every puzzle) |
| `win-in-1` | every best move traps the other pawn on the spot (`depth` 1) |
| `trap-now` | the same positions, named after what you do: break the last tile the other pawn can reach |
| `avoid-trap` | every move outside `best` lets the opponent trap the mover on their very next move |
| `separated` | the pawns are in different components: nobody can reach the other any more and the rest is a race for room |

Board mix: 5×5, 6×6, 7×7 and 8×8, both seats to move (the generator keeps the counts within
5 of each other), 200 puzzles.

## Limits — what is NOT covered

- Only **endgames**. A position is solved once few enough tiles are left; on an open board
  the tree is far beyond exhaustion, so opening and middlegame judgement is not tested here
  (the benchmark series against Random is what covers that).
- Only positions the solver proves within `ACCEPT_NODES` (40 000 nodes ≈ 40 ms) are kept,
  so re-solving the whole set in the tests stays under a second. Harder endgames exist and
  are provable, they are simply left out.
- `best` is "every winning move", not "the fastest win": a bot that wins slowly is still
  counted as perfect. `moveValues` from `solveExhaustive` gives win/loss per move when a
  finer grading is wanted.
- Lost positions are excluded, as are positions where every legal move wins (nothing to get
  wrong) and positions where more than half of the legal moves are best.
- Generation samples the positions of seeded playouts (random, greedy and a mix) and takes
  at most 3 puzzles per game, so the set is diverse but not a uniform sample of "realistic"
  positions.
- Two players only. The solver does not know 3 or 4 seats.
