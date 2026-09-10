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

**Threat search**: `vcf` (victory by continuous fours) and `vct` return the exact number
of plies to the win. At the root they are iterated 1, 2, … threats so the fastest forcing
win is found first; the main search then only looks for a still faster win. VCT gets 40 % of
the budget (nodes or time), so the main search always runs. The bot's own `vct` plays
four-makers and open-four-makers only (the defender may only counter with a four or really
defend); with `searcher.threeMakers = true` (the win-chance evaluator) it also plays
`Board.threeMakers` — cells that create a new open three — and so finds three-three forks
and three-then-four-three sequences. That flag is off for the playing levels, so their moves
are unchanged.

**Dead board** (#18): every line record also counts its windows still free of the opponent
(`Board.ow`, totals `OW`); `OW[0] === OW[1] === 0` is the rules' dead-board draw and a
terminal draw for the evaluator's search.

## Win chance (`evaluate(state, tools)`)

A raw score from **player 0's** point of view (0 = even, > 0 player 0 better, ±Infinity =
decided), in the window-sum units of the search evaluation; the framework fits the logistic
(`scripts/calibrate.mjs`). A **clear advantage is about S = 300** units (an unanswered open
three is worth ≈ 200, an unanswered four ≈ 250 per window); the test's fixed logistic uses
`p = 1 / (1 + exp(-raw / 300))`. Every call honours `tools.budget.nodes` (`d.tick()` per
searched node, no wall clock), so both online clients get the same number.

- **Terminal**: a five on the board → ±Infinity, a full or dead board → 0, the empty board → 0.
- **Every budget** (synchronous, ≈ 0.6 ms at 9×9 and ≈ 0.9 ms at 15×15 with 2 000 nodes): a
  depth-2 alpha-beta from the side to move (`Evaluator.search`, 10 candidates, 20 at the
  root) in which forced situations cost no depth — an own completion cell wins, two enemy
  ones lose, one is blocked — an own three-cell at a quiet node wins (open four next move),
  and a leaf facing an open three extends up to 4 plies (the restricted defence set) instead
  of scoring a penalty. Leaves are pure material (`S[p] − S[q]`) plus a tempo of 24 for the
  side to move. Mate scores become ±Infinity. If the budget ends during the search the
  depth-0 value (forced fours only) counts.
- **Budgets above 5 000 nodes** (a Promise; `tools.yield()` every 2 000 nodes): the rest of
  the budget goes to threat searches — VCF, then VCT with three-makers for the side to move
  (a win = ±Infinity), then VCT for the other side as if it were to move. That last one only
  decides the game if every possible defence of the side to move still loses (re-checked
  with the full threat depth): facing an open three the restricted reply set is complete, otherwise
  every empty cell that shares a window with a stone is tried (a cell without any potential
  cannot matter), best first. Running out of budget is "unknown" (the finite score stands),
  never a verdict. `Evaluator.verdict` says which case applied (test hook).
- Instances are pooled per board shape (`busy` while a background stage awaits a yield), so
  a quick call never shares buffers with a pending refinement.

Why it is calm: the old `estimate()` scored "faces an open three" as −1 000 and "must
block a four" as a fixed −1.5 logits, so the HUD jumped whenever a threat appeared and fell
back when it was blocked (mean |Δp| 0.166 between consecutive positions of Normal-vs-Normal
games, 243 jumps > 0.25 in 630 transitions — 480 under the dead-board rule). Resolving
threats by search and scoring only material leaves 0.031 at 2 000 nodes, 0.032 at 12 000
and 0.034 at 60 000 (6 / 8 / 10 jumps; the extra ones at the long budgets are forced wins
found earlier that the depth-2 bots then did not play), with a side-to-move bias of ±0.006.
The framework calibration (`node scripts/calibrate.mjs sensei-five`, 40 self-play games,
12 000 nodes) fits scale ≈ 1 166, shift ≈ −62, Brier 0.006, swing 0.9 %.

## Numbers (20 000-node budget, see `bot.test.mjs` / `benchmark.js`)

- Win chance (`evaluate`), 10 seeded Normal-vs-Normal games on 9×9, p = σ(raw / 300):
  mean |Δp| 0.031 / 0.032 / 0.034 at 2 000 / 12 000 / 60 000 nodes (old estimate: 0.166).
  Per position on this dev machine: 2 000 nodes ≈ 0.6 ms (9×9) / 0.9 ms (15×15), max 5 /
  9 ms; 12 000 ≈ 45 / 84 ms; 60 000 ≈ 177 / 353 ms (the long stages spend their whole
  budget on the defence re-check in threat-rich positions; the yields keep the page responsive).

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
