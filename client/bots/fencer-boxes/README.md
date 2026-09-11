# Fencer — Dots and Boxes

Two engines in one bot. Which one answers depends only on how many lines are still undrawn,
never on the clock, so a level plays exactly the same on every device.

## 1. Exact endgame

With two players and at most **30 undrawn lines** Fencer solves the rest of the game.

- **Why one table entry per line set is correct.** Closing a box keeps the mover on turn, so
  the value of the remaining game is "boxes for whoever moves next minus boxes for the other
  one", and that depends on the set of undrawn lines alone, not on who is to move. The
  transposition table is therefore keyed by the bitmask of the lines drawn since the root
  (which is why 30 is the ceiling: the mask has to fit an int32).
- **Alpha-beta negamax**, fail-soft, captures searched first. A capturing line keeps the
  window on the same side (`value = boxes + search(alpha - boxes, beta - boxes)`); every
  other line flips it.
- **One exact reduction: free captures are forced.** A capture is *free* when the line closes
  a box and leaves no other open box with three sides behind. Taking it is never wrong,
  because the mover keeps the turn either way, so declining costs the tempo nothing and hands
  a box over. Captures that *do* open the next box are never forced, and that is exactly where
  the "all but two" double-dealing decision lives: the search branches and finds it by itself.
- **Cost.** A 5 × 5 endgame with 24 undrawn lines is a few thousand nodes; the same board with
  30 is usually under 20 000. The node budget of the chosen level decides how far it gets;
  when it runs out, chain play answers instead (which is what makes Easy easy).

The solver in `scripts/puzzles/boxes/solver.mjs` is an independent implementation of the same
idea, and `tests/puzzles/boxes/solver.test.mjs` proves it against a plain brute force with no
table, no pruning and no forced captures.

## 2. Chain play

For openings and middlegames the search cannot reach yet, in this order:

1. **Take every free box** (see above), one line at a time.
2. **All but two**: when only two boxes of the chain are left and the rest of the board is
   chains too (no safe line anywhere), draw the far line of the last box instead of taking.
   The other side gets both boxes with one line and then has to open the next chain, which is
   worth far more than two boxes. Loops are eaten instead of split; the exact search handles
   them once it reaches that far.
3. **Play a safe line** while one exists: the one that leaves fewest boxes on two sides
   (fewer chains started) and prefers the rim, so the board stays uncommitted.
4. **Loony positions** (every line opens something): open the chain that concedes the fewest
   boxes, measured by letting the other side cascade greedily.

Ties are broken with the seeded rng (`tools.random`), so two games against the same opponent
are not identical while everything stays reproducible per seed.

## 3. Win chance (`evaluate`)

From player 0's point of view:

- A majority of the boxes, or a finished game: ±Infinity (that is a rule, not a guess).
- A **proven** endgame: ±Infinity for a win or a loss, 0 for a tie. The bar is allowed to say
  100 % there because it is a fact.
- Otherwise the lead against what is still on the table: `(boxes 0 - boxes 1) / (boxes still
  open + 1)`. Nothing else.

Three properties, and the first two are what the rewrite was about (the bar used to
jump between 43 % and 72 % on quiet moves, and between a proven 100 % and an unproven 60 % on
the next one):

- **One node cap for every HUD stage.** The bar asks at 2 000, 12 000 and 60 000 nodes. Whether
  a 30-line endgame gets solved is *not* monotone in the lines left, so a budget-dependent
  proof made the same position read 43 % at the first stage and 100 % at the third. `evaluate`
  therefore ignores the caller's budget and always gives the proof `EVAL_NODES` (30 000).
- **The proof only asks for the sign.** A null-window probe ("is the mover's margin at least
  t?", `exactWinner`) proves who wins with a fraction of the nodes the full-window value needs;
  two probes share one table, so the second is nearly free. That lifts the share of endgames
  proven at 30 000 nodes from 91 % to 95 % on 5 × 5 and to 100 % on 7 × 7, which is what makes
  the proof arrive once and stay instead of coming and going.
- **No positional guess.** The old score added a term for who would have to open first (the
  parity of the safe lines). It was measured against seeded self-play, self-play with 12 %
  random moves and games against Random, always with a symmetric fit: it predicted no better
  than the plain box count, and neither did Monte-Carlo rollouts of the rest of the game with
  the chain policy above (those only look convincing on the games their own policy played, and
  were worse out of sample). Until the endgame is proven, Dots and Boxes has no honest signal
  beyond the boxes on the table.

The score is symmetric by construction (mirroring the seats negates it) and, while nothing is
proven, independent of who is to move, which is why `scripts/calibrate.mjs` fits it on the
samples *and their mirrors* (`symmetric: true` in `SERIES`): that pins 50 % at raw 0 instead of
letting the series' own seat prior tilt the curve. The series runs on **7 × 7**, because on
5 × 5 the exact search proves nearly every position in which a box has already been won and
95 % of the finite samples were a plain 0. Result: scale 0.118, shift 0, Brier 0.177, mean
move-to-move swing 1.2 % (was 3.9 %).

## 4. Levels and numbers

| level | nodes | what it means |
| --- | --- | --- |
| Easy | 2 000 | solves only small endgames; chain play carries the rest |
| Normal | 10 000 | most 5 × 5 endgames |
| Hard | 30 000 | |
| Very hard | 100 000 | the whole second half of a 5 × 5 game exactly |

100 % against Random over the 60-game benchmark series (4 × 4), 149/170 proven puzzles at the
benchmark's 20 000-node budget and 162/170 at its own Very hard budget, with take-box,
sacrifice and double-deal at 100 %.

## 5. Limits

- The exact search is a two-player tool (the turn-independent value argument needs exactly two
  sides). With three or four players Fencer plays chain play only, which is still sound.
- Loops are eaten rather than declined in chain play, so a big board with several loops is
  played slightly below best until the endgame search takes over.
- There is no opening theory: the long-chain parity rule is not implemented, only the safe-line
  heuristic that keeps the board uncommitted. The win chance says so honestly: it sits near
  50 % until a box is won or the endgame is proven.
