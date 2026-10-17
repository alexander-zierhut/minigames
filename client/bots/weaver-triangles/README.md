# Weaver: Triangles

One compact board and two searches on it. Which one answers depends only on the position and
the level's node budget, never on the clock, so a level plays exactly the same on every
device.

## The board

Typed arrays with make / unmake: covered edges, covered sides per triangle (three = claimed,
because a triangle is claimed the moment its third side is covered), covered edges per peg (a
peg is touched once one of its edges is covered, which is the rules' `touched[p] > 0`), the
scores, the seats that are out and the seat to move. The tables (bands of the allowed lengths,
the edges and pegs of every band, the triangles of every edge, the bands through every edge)
come from `TrianglesRules.geometry(n)` and are built once per board size and band rule.

`bot.test.mjs` proves it equal to the rules on seeded games under **every config the settings
can produce**: band length 4 / 3 / any, touch on and off, tokens Off (`null`), `0` and 21, two to
four seats. After every ply it compares the legal bands, what every band claims and hands over,
the scores, the covered edges, the seat to move, and whether and how the game ends.

**One band per position.** Bands that cover the same new edges lead to the same position
(same covered set, so the same claims and the same touched pegs), so the move list keeps one
of them:

- with any band length, a band with covered edges whose new edges form one run is the same
  move as the band over exactly that run, and that band is legal whenever the longer one is
  (the peg it shares with the covered part is touched); so only bands without covered edges,
  and 4-peg bands with just the middle edge covered, stay in the list;
- with one band length, a band without covered edges is the only one with its edge set, and
  the others go through a small hash of their new edges.

The test checks that the list holds every reachable position exactly once. On 7 pegs per side
with any band length this made Very hard about three times faster.

## 1. Exact endgame

With two players and at most **32 uncovered edges** Weaver first tries to solve the rest of the
game, on half the level's nodes.

- **Why one table entry per covered set is correct.** Every band passes the turn (claiming gives
  no extra turn) and which pegs are touched follows from the covered edges, so without a token
  limit the rest of the game from the mover's view depends on the covered edges alone. With a
  token limit the scores decide when it ends, so they join the key (mover's score, the other
  one's). The key is the bitmask of the edges covered since the root, kept as an exact integer.
- **The value** is the final triangle difference from the mover's view. Its sign is the result
  under both endings: a seat that reaches its token number is ahead at that moment (the other one
  has fewer than the limit), and once nothing may be stretched the bigger score wins.
- Alpha-beta negamax, fail-soft, claims first, then safe bands; nobody can gain more than the
  triangles still unclaimed, which cuts the null-window probes early.
- `bot.test.mjs` checks it against a plain full-width oracle through the real rules on 20 and
  more endgames under every band rule, with and without a token limit.

Cost on 4 pegs per side (21 tokens, bands that must touch), nodes for a full proof: median 5 000 and
88 % under 20 000 with 28 to 31 uncovered edges. Without a token limit the same board is harder
(no early end): 48 % under 20 000 with 20 to 23 edges left, 11 % with 24 to 27. When the proof
does not finish, alpha-beta answers with the nodes that are left.

## 2. Alpha-beta

Iterative deepening on `tools.deadline()` (`d.tick()` per node), the previous depth's best band
first. Negamax over two sides, me and everybody else as one: with two seats that is plain
minimax, with **three or four seats it is the paranoid scheme**, every other seat minimises my
lead over the best of them (max-n would need a vector per node and prunes far worse).

- **Move ordering**: claims first (the most triangles, the least handed over), then safe bands
  (that hand nothing over), then the rest by how little they hand over. A lazy selection picks
  the next band, since a cut-off usually comes after the first one or two.
- **Root rule**: while a safe band exists, Weaver never hands a triangle over (it keeps the claims
  and the safe bands). The exact search above is free to sacrifice on purpose.
- **Leaf**: my lead after the seat to move took its best claim with one band; when that claim
  reaches the token number it is scored as the win it is.
- An iteration in which every line reached the end of the game is a proof as well; the report
  says so.
- Ties are broken with the seeded rng (`tools.random`: the root list is shuffled before the
  stable sort by the ordering key), so two games against the same opponent differ while every
  seed reproduces.

`tools.report` gives `method` (exact, search, or forced when only one band is left), `depth`
(edges left for the proof, the finished depth for the search), `value`, the searched nodes and a
`forced` note ("only band", "proven win", "proven loss", "proven tie", "searched to the end").

Budgets of 20 000 nodes and more answer with a Promise and yield to the page about every 2 000
nodes, inside the tree and not only between root moves: the nodes near the root (alpha-beta
nodes with 3 or more plies left, 2 or more with three or four seats in, exact-search nodes with
more than 8 uncovered edges) run as generators that hand the node count up after every move, and
only the subtrees below them run as plain recursion. The paranoid search needs the lower cut-off:
the two plies after my band both belong to the other side, a max over a max that alpha-beta
cannot prune, so a plain depth-2 subtree cost b² nodes there (the whole Very hard budget without
a single yield on 6 or 7 pegs with three seats). Measured at Hard and Very hard over 4 to 7 pegs,
2 to 4 seats and every band rule: at most about 2 400 nodes between two yields with three or four
seats and about 4 400 with two (some 30 ms on a desktop), where one root move used to take up to
90 000. Same nodes in the same order, so the same moves; about 1 % slower. Smaller budgets answer
at once.

## 3. Win chance (`evaluate`)

From seat 0's point of view:

- A finished game, or a lead nobody can catch up with any more (`scores[0] > best other + left`,
  or the other way round): ±Infinity. That is a rule, not a guess.
- A **proven** endgame (two seats, at most 32 uncovered edges, null-window probes that ask only
  for the sign of the final difference, under `EVAL_NODES` = 20 000 nodes of its own at every HUD
  stage): ±Infinity for a win or a loss, 0 for a tie. The probes are asked from the mover's side
  in the same order whichever seat moves, so a position and its seat swap are proven together
  (before version 2 one of them sometimes ran out of nodes and the other did not).
- A seat to move that reaches its token number with its next band: ±Infinity.
- Otherwise the lead **smoothed along the predicted line**:
  `(lead now + 2 × lead after the mover's band + lead after the reply) / 4 / (triangles left + 1)`.
  Both bands come from the bot's own alpha-beta (the root rule included, the root list in the
  ordering key's order, no random tie-break) on `LINE_NODES` = 300 nodes each, again a cap of
  its own. Nothing else.

**Why.** Once the safe bands run out, every band claims what the last one handed over, so the
lead itself zigzags move after move. If the seat to move gains `g` with its band, then
"half of `g` for the mover" is exactly what keeps the number still through such a trade (the
average of the lead before and after the band). Version 1 used half of the *biggest* claim on
the table, and that is not the band people play: the biggest claim often hands more back, so
the players take one triangle at a time while two or three lie there, and the bar jumped by the
difference every move (seen at 3 : 3 with the old curve: 50, 81, 19, 68, 32, 92, 17 %). Half of
the band actually played next (known in hindsight) would cut the mover bias to 0.005; the short
search predicts that band well enough to get most of the way, and the 1 : 2 : 1 weights over two
plies take a little more.

**The measurement** (seeded games on 4 and 5 pegs per side, 4-peg
bands, touch off and on, 21 tokens and no limit, each as Weaver Normal against itself at 4 000
nodes, the same with 12 % random moves, and Weaver against Random: 24 series of 30 games, plus
the 30-game calibration series of `scripts/calibrate.mjs` on 4 and 5 pegs; 32 000 positions).
Every candidate was fitted with the symmetric logistic; *out of sample* = fitted on the even
games and scored on the odd ones and the other way round; *step*, *flips* (undecided steps over
15 points) and *mover bias* (mean of p minus the average of its neighbours, per side to move)
use one curve fitted on the calibration series, the way the app does:

| raw score | calibration series (4 pegs, 21 tokens, bands anywhere): Brier out / step / flips / bias | mean over 26 series: Brier out / flips / bias |
| --- | --- | --- |
| plain lead | 0.171 / 10.4 % / 205 of 637 / 0.104 | 0.1255 / 4 122 of 23 447 / 0.076 |
| lead + half the biggest claim (version 1) | 0.167 / 7.5 % / 128 of 615 / 0.060 | 0.1183 / 2 076 of 21 869 / 0.040 |
| claim-only quiescence (one greedy line, either side may stop) | 0.162 / 6.4 % / 156 of 610 / 0.036 | 0.1179 / 2 612 of 21 227 / 0.022 |
| half the predicted band | 0.166 / 4.2 % / 37 of 612 / 0.010 | 0.1174 / 1 130 of 21 476 / 0.022 |
| **the smoothed predicted line (version 2)** | **0.165 / 3.8 % / 29 of 610 / 0.003** | **0.1160 / 885 of 21 223 / 0.020** |
| hindsight: the bands actually played next | 0.162 / 3.6 % / 14 of 604 / 0.001 | 0.1129 / 429 of 20 581 / 0.001 |

Version 2 beat version 1 out of sample on 21 of the 26 series, tied on 4 (all against Random)
and lost on one (4 pegs, 21 tokens, bands anywhere, clean self-play: 0.1934 against 0.1919).
The remaining mover bias of the mean sits in the games with random bands, which nobody can
predict: 0.001 to 0.006 on clean self-play, about 0.02 with 12 % random moves, 0.03 to 0.05
against Random (where every candidate reads the same). Also measured and dropped:

- a full claim-only quiescence (every claim for both sides, alpha-beta with a table) is out of
  reach: claim lines run up to 83 bands, and at 20 000 nodes it gave up on 37 % of the
  positions;
- the same greedy line with forced claims (the mover must take what is there) was worse than
  the plain lead (Brier 0.138), and with the token win counted as everything left much worse;
- a 2-ply "claims minus the best answer" net term: worse than the plain lead;
- 300, 1 000 or 3 000 nodes for the prediction: the same within 0.0002 Brier, so 300;
- `/ √(triangles left + 1)` or "triangles still in play" under a token limit instead of
  `/ (triangles left + 1)`: within 0.0005 Brier, more flips;
- the average of the smoothed line and the claim-only line: Brier 0.1145 instead of 0.1160 but
  half again as many flips (1 341). Being calm is worth more than 0.0015.

The score is symmetric by construction (the search sees the same bands in the same order from
the mover's side whichever seat that is, so swapping the seats and the turn negates it; tested
on every position of the series), so `scripts/calibrate.mjs` fits it together with its mirror
(`symmetric: true`). The series runs on the default board (4 pegs per side, 21 tokens, bands
anywhere). Result: **scale 0.025, shift 0, Brier 0.165, swing 3.8 %** over 934 positions
(version 1: scale 0.03, Brier 0.167, swing 6.5 %). Every HUD stage gives the same value (646
positions on 4 and 5 pegs, no disagreement).

The bot test's measurement pass (ten seeded games, the calibrated bar at the HUD's middle
stage) runs on both rule sets:

| | Brier | mean undecided step | steps over 15 points | mover bias |
| --- | --- | --- | --- | --- |
| default (bands anywhere), version 1 | 0.169 | 7.9 % | 44 of 206 | 0.063 |
| default, **version 2** | **0.168** | **3.8 %** | **12 of 206** | **0.003** |
| bands must touch, version 1 | 0.117 | 4.1 % | 9 of 207 | 0.019 |
| bands must touch, **version 2** | **0.108** | **3.3 %** | **4 of 198** | **0.004** |

It fails above Brier 0.2, a mean step of 8 %, one flip in eight steps and a bias of 0.04.

Cost per call: 1.5 to 5 ms on average on 4 to 7 pegs, worst 43 ms (a proof on 4 pegs).

## 4. Levels and numbers

| level | nodes | ms per move, desktop (4 / 5 / 6 / 7 pegs per side) | worst |
| --- | --- | --- | --- |
| Easy | 2 000 | 3 / 3 / 5 / 7 | 22 |
| Normal | 10 000 | 12 / 14 / 17 / 22 | 51 |
| Hard | 30 000 | 47 / 60 / 62 / 70 | 209 (6 pegs) |
| Very hard | 100 000 | 150 / 188 / 250 / 242 | 299 / 446 / 659 / 1 046 |

(Three seeded self-play games per cell, 4-peg and any-length bands, 21 tokens and no limit,
eight runs in parallel on one desktop, so a little slower than alone.) Very hard stays at a
second or two on a slow phone, and the page keeps responding meanwhile. 100 % against Random
over the 60-game benchmark series (4 pegs per side, 21 tokens, bands anywhere); 156/160 proven
puzzles at the benchmark's 20 000-node budget, and at its own budgets Easy 87 %, Normal 93 %,
Hard 99 %, Very hard 100 % (random picking gets 35 %).

In games the levels are less far apart than on the puzzles. Seeded series on the default rules,
seats and the first move alternating:

| match | 4 pegs per side | 5 pegs per side |
| --- | --- | --- |
| Very hard against Easy | 172 of 200 (86 %) | 75 of 100 (75 %) |
| Very hard against Normal | 141 of 200 (70.5 %) | |
| Normal against Easy | 147 of 200 (73.5 %) | |
| Hard against Normal | 92 of 200 (46 %) | |

Hard is not measurably stronger than Normal in games (46 % ± 7), only on the puzzles (99 %
against 93 %).

## 5. Limits

- The exact search is a two-player tool (the "value depends on the covered set" argument needs
  exactly two sides). With three or four seats Weaver plays the paranoid search only.
- Without a token limit the proof reaches only the last 20 or so edges, and before that the
  search has no idea of the long-run parity of the safe bands; the win chance says so honestly
  and stays near the lead.
- The root rule never sacrifices while a safe band exists outside the proof's reach. That is a
  heuristic, not a theorem, and the exact search overrides it at the end.
- The predicted line is only as good as a 300-node search: when the player does something else
  (a human, Random) the bar moves by what really happened. About one undecided step in twenty
  still moves it by more than 15 points on the default board; the hindsight line shows that
  half of those would remain even with a perfect prediction.
