# Triangles puzzles

Test positions for **Triangles** (a hexagonal pegboard with n pegs per side, a move
stretches one band in a straight line across pegs, every small triangle whose last side it
covers goes to the mover, the turn always passes, the game runs until no band may be
stretched any more and the most triangles wins) whose perfect band(s) are **proven** by an
exhaustive solver, so bots can be graded on how many perfect moves they find.

```
node scripts/puzzles/triangles/generate.mjs        # regenerates puzzles.json (about 10 s, deterministic)
node --test tests/puzzles/triangles/solver.test.mjs # about 20 s
node scripts/puzzles/verify.mjs triangles          # solver-independent re-proof of the structural tags
```

Files: `solver.mjs` (the solver), `generate.mjs` (seeded playouts → `puzzles.json`),
`../../../tests/puzzles/triangles/puzzles.json` (the data), `solver.test.mjs`.

## Format

```json
{ "game": "triangles", "generated": "YYYY-MM-DD", "solver": "…",
  "puzzles": [ { "id": "triangles-0001", "config": { "n": 4, "band": 3, "touch": false, "tokens": 0 },
                 "history": [ … ], "toMove": 0, "best": [549, 775], "value": "draw",
                 "margin": 0, "depth": 12, "tags": ["endgame-exhaustive", "claim", "avoid-loss"], "note": "…" } ] }
```

- `config`: one rule set for the whole set, every key written out: `band: 3` (4-peg bands,
  the box rules), `touch: false` (the default: a band may go anywhere, as the real players
  lay them) and **`tokens: 0`** (no token limit). The solver's key is exact only without a limit, and
  `Learn.configFor` fills a missing key with the settings default (21 tokens), so the keys
  are never left out. `n` is 4 (the physical board, 37 pegs) or 5 (61 pegs).
- `history`: every band from the empty board, in play order, each one integer
  `min(a, b) * V + max(a, b)` (peg indices, see `client/games/triangles-rules.js` for the
  numbering). Replaying it with `TrianglesRules` gives a position that is not over with
  seat 0 to move; `toMove` is always 0 (a Learn table always seats you first).
- `best`: **every** band that reaches the best possible final triangle difference for the
  mover, sorted. Not "every band that still wins": the yardstick is the exact final margin.
- `value`: `win` / `draw` / `loss` of the whole game from the mover's view, counting the
  triangles already claimed plus what best play still gets. `margin` is that exact final
  difference (mover minus the other side), so `value` is its sign.
- `depth`: the most plies the rest of the game can still last (a search over every line,
  no pruning). Between 8 and 14 in this set.
- Every puzzle has a legal band outside `best`, and the difference is real: either the best
  band beats every other by **two triangles or more**, or the others throw the result away
  (win becomes draw or loss). No two puzzles are the same position under the 12 symmetries
  of the hexagon with the same score difference.

## What the solver guarantees

`solveExhaustive(board)` in `solver.mjs` searches the rest of the game **to the last band**
and returns the game-theoretic value, every optimal band and the exact value of every legal
band. There is no static evaluation and no depth limit, so nothing here is a heuristic.

1. **Values that depend on the covered edges alone.** Without a token limit a closed
   triangle is always claimed at once, a peg counts as touched exactly when it touches a
   covered edge, and claiming gives no extra turn. So the rest of the game is worth
   "triangles for the side to move minus triangles for the other one" whatever the scores
   are, and one transposition entry per set of covered edges is exact (the key is the
   edges covered since the root, up to 52 of them in one double). With a token limit the
   race to the limit depends on the scores, so `Board.fromState` refuses `tokens > 0`, and
   it refuses three or four players (no single number is "perfect play" then).
2. **Its own board.** The solver keeps a compact board (typed arrays, make / unmake) with
   its own copy of the numbering and never edits a rules state: the rules memoise their
   legal bands per state object. The search orders claims first, then the bands that hand
   the least over; ordering and pruning change the speed, never the result.
3. **Proved, not assumed.** `solver.test.mjs` proves the numbering equal to
   `TrianglesRules.geometry` for n = 3 to 7, the board equal to the rules through
   `Rules.step` on seeded games under every `band` and `touch` value (legal bands, claims,
   what a band hands over, covered edges, touched pegs, make / unmake leaving nothing
   behind), and the fast engine equal to **two oracles without a table**: `solveBrute`
   (the board with no table, no pruning, no ordering) and a plain search through the rules
   themselves, on 48 seeded positions of 4 to 7 plies (value, every optimal band and the
   value of every band). It re-solves every puzzle (value, margin, depth, `best` and the
   numbers in the note). `scripts/puzzles/verify.mjs` re-proves the structural tags with the
   rules' own helpers and no solver at all.
4. **Reach.** n = 3 with 4-peg bands is solved from the empty board in about 21 000 nodes
   (17 000 with touch on): whoever starts **loses** by 2 triangles (the plain brute force
   agrees, in about four minutes), and only 12 of its 24 triangles can ever be closed.
   Measured on the set (one core):

   | plies left (depth) | nodes, average | nodes, most | time, most |
   | --- | --- | --- | --- |
   | 8 | 730 | 820 | 0.6 ms |
   | 10 | 2 700 | 3 600 | 2 ms |
   | 12 | 9 500 | 15 000 | 8 ms |
   | 14 | 30 000 | 48 000 | 25 ms |

   Beyond the set, on seeded random games: 16 plies left take 0.15 to 0.5 million nodes
   (0.1 to 0.3 s), 18 plies 0.3 to 2.9 million (up to 1.8 s), and the whole board of n = 4
   (about 44 plies) is far out of reach. That is why the set stops at 14.

Everything is deterministic: no randomness in the solver, `Bots.rng` (seeded mulberry32) in
the generator, ties broken by band number.

## Tags

| tag | meaning |
| --- | --- |
| `endgame-exhaustive` | solved to the last band: the value and `best` are game-theoretic facts (every puzzle has this) |
| `claim` | every optimal band claims at least one triangle, and some legal band claims none |
| `safe-move` | every optimal band hands nothing over (no triangle goes from one covered side to two), and some legal band does |
| `sacrifice` | every legal band hands something over: the art is conceding as little as possible |
| `avoid-loss` | the position is not lost and every band outside `best` loses the game |

`claim` and `safe-move` may come together (claim with a band that opens nothing).

## Notes

The `note` is built from a small fixed set of sentences, so the Learn generator
(`scripts/learn/pick-scenarios.mjs`, `NOTE_SENTENCES`) can map each one to a key of the
language files:

- `Claim what is on the table.` (`claim`)
- `Play a band that hands nothing over.` (`safe-move`)
- `Every band opens something: concede as little as possible.` (`sacrifice`)
- `Every other band loses the game.` (`avoid-loss`)
- `Best play ends N triangle(s) ahead; every other band is at least M triangle(s) worse.`,
  with `behind` instead of `ahead`, or `Best play ends level; …` (always last): N is the
  margin, M how far the next best band falls short.

## The mix

The generator samples the tails of seeded playouts on n = 4 and n = 5 with three policies:
greedy (claim the most, then hand over the least, from the rules helpers, 8 % random
bands), mixed (35 % random bands) and plain random. Per board and policy it caps the share
of each value (wins 60 %, draws and losses 22 % each) and of the structural tags, and it
fails loudly when the set ends up below its minimum per tag and per value, or with fewer
than 15 wins that have exactly one best band, or fewer than 15 that have several (the
Learn ladder needs both). It prints the counts every run; the current set:

- 160 puzzles, 80 on n = 4 and 80 on n = 5
- tags: `claim` 73, `sacrifice` 53, `safe-move` 36, `avoid-loss` 29 (every puzzle
  `endgame-exhaustive`)
- values: 95 wins (25 with one best band, 70 with several), 27 draws, 38 losses
- depth 8 to 14 for wins and losses, 8 to 13 for draws

Blind random picking scores 35.3 % on the set: many positions have several optimal bands.

## Limits: what is NOT covered

- Openings and middle games. Only positions with at most 14 plies left are exhausted.
- One rule set: 4-peg bands anywhere (touch off), no token limit. The touch rule, other
  band lengths and the token race (the first to place every token wins) are not
  represented; the token race would need the scores in the key.
- `best` means "reaches the best final margin". A bot that wins the game but by fewer
  triangles scores 0 on that puzzle.
- Only two players.
- The positions come from seeded playouts, so they look like real games but are not a
  uniform sample of all positions.
