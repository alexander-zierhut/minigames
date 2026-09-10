# Sensei — Five Wins bot

A real gomoku engine for any board size (5–25) and win length (3–25), pure and headless
(`bot.js`, one classic script, registers as `sensei-five`). Four levels:

| id | label | thinkMs | search |
| --- | --- | --- | --- |
| `easy` | Easy | 30 | takes a win in one, blocks a four 75 % of the time, otherwise a greedy pick by cell potential with seeded noise (weighted among the best 1–3 candidates, sometimes anything near a stone) |
| `normal` | Normal | 150 | alpha-beta depth 2, 10 candidates per node, exact handling of fours and open threes |
| `hard` | Hard | 600 | iterative deepening to depth 4, 12 candidates, root threat search (8 fours / 4 threats) |
| `very-hard` | Very hard | 1500 | iterative deepening until the budget ends (cap 24), 12 candidates, root threat search (16 fours / 10 threats), VCF below the leaves, the chosen move is re-checked against an enemy threat sequence |

In the app the budget is the level's `thinkMs`; tests and the benchmark pass a node budget
(`ms: Infinity`) and get identical moves on every machine. `d.tick()` is called once per
searched node (alpha-beta node or threat-search node). Hard / Very hard `await tools.yield()`
every 2 000 nodes.

## How it works

**Board** (`Board`): `Int8Array` cells plus, for every line of length ≥ winLen (rows, columns,
both diagonals), a record per player: completion cells (filling one finishes ≥ L in a row;
"fours"), three-cells (filling one creates two completion cells on that line; an open or
broken three), four-makers (filling one creates a completion cell), all as bit masks, and
the *window sum* Σ over L-windows without an enemy stone of `WS[stones missing]`
(`WS = [100000, 250, 70, 12, 2, 1]`). `make`/`unmake` re-scan only the 4 lines through the
stone and keep totals (`F`, `T`, `S`, lines with three-cells `TL`, lines with four-makers
`MK`), a Zobrist hash, neighbour counts (radius 2) and a per-cell *potential* (the window sum
a cell would have after being filled, per player) that drives move ordering. All of this is
proven against `FiveRules` in `bot.test.mjs`.

**Search** (`Searcher`): negamax alpha-beta with iterative deepening, transposition table
(2¹⁶ entries), killer moves and history. Forced situations are exact: own completion cell →
win; two distinct enemy completion cells → loss; exactly one → the block is the only move and
costs no depth. When the enemy has three-cells the reply set is restricted to own four-makers,
own three-cells and cells that leave the threatened line without a three-cell (anything else
loses to the open four). Otherwise the K best cells within distance 2 of a stone by
potential (attack + defence). Leaves are evaluated statically: window-sum difference, +3000
for an own three-cell (open four next move), −1000 / −2500 for one / two enemy three-lines.
Mate scores carry the distance (`WIN − ply`), so the fastest win is preferred.

**Threat search**: `vcf` (victory by continuous fours) and `vct` (fours and threes; the
defender may only counter with a four or really defend) return the exact number of plies to
the win. At the root they are iterated 1, 2, … threats so the fastest forcing win is found
first; the main search then only looks for a still faster win. VCT gets 40 % of the budget
(nodes or time), so the main search always runs.

**Win chance** (`estimate(state)`): player 0's chance from the static features of the
position (terminal → 1 / 0 / 0.5; a completion cell for the side to move or two for the
other side dominate; then three-cells, then the window-sum difference through a logistic
curve). Deterministic, ~0.2 ms at 15×15.

## Numbers (20 000-node budget, see `bot.test.mjs` / `benchmark.js`)

- vs Random (9×9, 100 games, both colours): 100 %, avg 12 moves.
- Puzzles (`tests/puzzles/five`, 144): Easy 96, Normal 137, Hard 143, Very hard 144.
  Test thresholds: 30 / 70 / 85 / 92 %.
- Per move at 20 000 nodes on this dev machine: ≈ 150 ms at 9×9, ≈ 200 ms at 15×15
  (≈ 8–10 µs per node).

## Known weaknesses

- 9×9 with sound defence is drawish: Very hard cannot beat Normal on 9×9 even with 100 000
  nodes (all draws); it wins on 11×11 and larger.
- At an *equal* node budget Hard and Very hard are close; what makes Very hard stronger in
  the app is its 2.5× longer think time. Between the two levels the first player usually
  wins on 15×15 — the defence sees a long threat sequence only a few moves before it is
  forced.
- The evaluation is pattern-based, not tuned by self-play; opening play is by potential only
  (no book).
- Very long win lengths (≥ 15) make every window nearly worthless (`WS` is 0 beyond 5
  missing stones), so the play there is mostly tactical.
