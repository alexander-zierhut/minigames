# Bots — system, API and the current bots

Bots play the offline "Play against a bot" mode. This document is the reference for the
bot system; `AGENTS.md` holds the project-wide context and `docs/` is never deployed.

## 1. Architecture in one picture

```
client/games/<key>-rules.js   pure rules (create / isLegal / legalMoves / place / settle / conclude, estimate)
        │                     registered via Rules.register(key, module) → Rules.of(key)
        ▼
client/bots.js                Bots.register · Bots.create · Bots.tools · Bots.playout · Bots.estimator
        │
        ├── client/bots/<id>/bot.js         one folder per bot: definition + create(tools) → { move(state) }
        │   client/bots/<id>/bot.test.mjs   the bot's own proof of strength
        │   client/bots/<id>/benchmark.js   generated: Bots.benchmark(id, { score, puzzles, … }) (real bots only)
        │
        ├── client/match.js                 bot seat: hooks.onTurn → botTurn → bot.move(clone) → engine.play(i)
        ├── client/winchance.js             win-chance bars from Bots.estimator (a Bus observer)
        ├── client/opponent.js              the bot modal (one bot per game, shown as "Bot": difficulty, scores), choice per game
        │
        ├── scripts/headless.mjs              loads util + rules + bots into a bare Node VM (no DOM)
        ├── scripts/puzzles/runner.mjs               replay a puzzle, grade a bot on a puzzle set
        ├── scripts/benchmark.mjs             series vs Random + puzzle score → benchmark.js
        └── scripts/puzzles/<key>/          solver + generator of the proven puzzle sets
            tests/puzzles/<key>/puzzles.json
```

Bots are **pure and headless**: no DOM, no timers of their own, no `Math.random`. The same
file runs in the browser (as a seat) and in Node (tests, benchmark, puzzles).

## 2. Registering a bot

```js
Bots.register({
    id: "blast-chain",                 // folder name: [a-z0-9-], unique
    name: "Blast",                     // for the code, the benchmark output and the docs; players see "Bot" (#21)
    game: "chain",                     // "chain" | "five" — one game per bot
    version: 1,                        // bump when the play changes (kept in benchmark.js)
    description: "One sentence for the bot modal.",
    // baseline: true,                 // only the Random bots: benchmark opponent + fallback, never offered, not benchmarked
    difficulties: [                    // ≥ 1, shown as a segmented control when > 1
        { id: "easy",     label: "Easy",      thinkMs: 30 },
        { id: "normal",   label: "Normal",    thinkMs: 150 },
        { id: "hard",     label: "Hard",      thinkMs: 600 },
        { id: "insane",   label: "Very hard", thinkMs: 1500 },   // thinkMs ≤ 5000: phones
    ],
    create(tools) {                    // once per game; may keep state (caches, books)
        return { move(state) { /* … */ return cellIndex; } };   // or a Promise of it
    },
    estimate(state, tools) {           // optional: P(player 0 wins), 0..1, cheap, deterministic
        /* … */
    },
});
```

`Bots.validate(def)` throws with a clear message for a malformed definition. Registration
order = display order.

## 3. The toolset (`tools` given to `create` and `estimate`)

| Member | Meaning |
| --- | --- |
| `game`, `rules` | game key and the pure rules module (all its functions are fair game: chain `tally`, `readyCells`, `detonate`, `land`; five `lineThrough`, `bestRow`) |
| `me`, `players` | the bot's seat and the number of seats |
| `difficulty`, `seed` | the chosen difficulty id; the seed of this instance |
| `budget` | `{ ms, nodes }` per move — see §4 |
| `random()`, `randInt(n)`, `pick(arr)`, `shuffle(arr)` | seeded (mulberry32) — the only randomness a bot may use |
| `legalMoves(state, p = state.current)` | cell ids |
| `isLegal(state, i, p)` | pure check |
| `clone(state)` | deep copy (JSON) |
| `apply(state, i)` | position after `i` by the current player on a copy (`Rules.step` = place + settle + conclude; sets `over`/`winner`/`finishWhy`) |
| `outcome(state)` | `{ over, winner }` (`winner` null while running, -1 draw) |
| `opponents(p = me)` | the other seats |
| `deadline(ms = budget.ms)` | `{ expired(), tick(n = 1), left(), nodes() }` — expires on time **or** on `budget.nodes` |
| `yield()` | `await tools.yield()` lets the page breathe (every ~2 000 nodes on long levels) |

`apply`/`clone` are convenient but slow (JSON): a searching bot keeps its own compact board
(typed arrays, make/unmake) and proves in its tests that it matches the real rules.

State shape (from `Rules.base` + the game's `create`): `n, players, current, round, history,
movesBy, busy, over, winner, finishWhy, cells` (chain: `[{ count, owner, cap }]`, plus
`chainRule, chainLen, chainNow, chainBest, explosions`; five: owner per cell -1/0/1, plus
`winLen, winLine`). Cell id = `y * n + x`. Five Wins ends in a draw not only on a full board
but as soon as no window of `winLen` cells is free of enemy stones for any player still in
(`FiveRules.canWin(state, p)`, #18) — a bot's own board model must mirror that or its
"engine equals the rules" tests and `apply()` will disagree at the end of drawn games.

## 4. Budgets: strong on a phone, deterministic in CI

Every difficulty declares `thinkMs`. `Bots.create(id, { difficulty, seed, me, budget })`
builds `tools.budget`:

| Caller | budget | why |
| --- | --- | --- |
| app (`botTurn`) | `{ ms: thinkMs, nodes: Infinity }` | real time on the player's device |
| conformance tests | `{ ms: Infinity, nodes: 2000 }` | same answers on any machine |
| benchmark, puzzle grading | `{ ms: Infinity, nodes: 20000 }` | numbers never drift → no diff, no PR |

Pattern for a searching bot:

```js
async move(state) {
    const d = tools.deadline();
    let best = firstLegal;
    for (let depth = 1; ; depth++) {
        const r = search(state, depth, d);      // calls d.tick() per node, aborts when it returns true
        if (r.aborted) break;                    // keep the last finished depth
        best = r.move;
        if (d.nodes() % 2000 === 0) await tools.yield();
    }
    return best;
}
```

The app adds a 350 ms pause before asking the bot, re-checks that the same game is still
on that turn when the answer arrives, and falls back to a random legal move if a bot
throws or answers illegally (logged in the HUD log).

## 5. Win chance (`evaluate` + calibration)

A bot may define `evaluate(state, tools) → raw score` from player 0's point of view
(0 = even, positive = player 0 better, ±Infinity = decided by rule or by a forced win the
search proved; draw = 0). Rules: honour `tools.budget.nodes` exactly like `move()` (no
wall clock — both online clients must get the same number), be cheap at 2 000 nodes (a few
ms), get better rather than jumpier with more nodes (even search depths, quiescence,
average of the last two depths), may return a Promise and yield on long budgets.

The framework does the rest: `scripts/calibrate.mjs` plays seeded self-play games, records
(raw, result) for every settled position and fits `p = σ((raw − shift) / scale)`; the
benchmark bakes `Bots.calibration(id, { scale, shift, brier, swing, samples })` into
`benchmark.js`. `Bots.estimator(game)` picks the strongest evaluating bot, applies its
calibration (`Bots.toProbability`, clamped to 0.5–99.5 %) and exposes `at(state, nodes)`;
the HUD calls it only when a move has settled, in node stages (2 000 → 12 000 → 60 000,
background, ≤ 5 s), with a light display smoothing outside decided territory. `swing`
(mean |Δp| between consecutive positions in self-play) is the number to watch: lower is
calmer.

## 6. Testing a bot

- **Conformance** (`tests/unit/bots.test.mjs`, automatic for every bot and difficulty):
  only legal moves in seeded random positions, identical move for identical seed, finishes
  full games as either colour against Random, average move < 250 ms at 2 000 nodes.
- **Own tests** (`client/bots/<id>/bot.test.mjs`, `npm run test:unit` picks them up): the
  facts that make the bot good — rules equivalence of its internal engine, hand-made
  tactical positions, `evaluateBot` thresholds on the puzzle sets (per difficulty, per
  tag), head-to-head via `Bots.playout` (beats Random by a margin, each level ≥ the
  previous). Thresholds must sit below what the bot really reaches; **no test may require
  100 %** and no test may gate the deploy on a fixed strength number.
- **Puzzles** (`tests/puzzles/<game>/puzzles.json`, proven by `scripts/puzzles/<game>/solver.mjs`):
  `evaluateBot(H, id, { difficulty, budget })` → `{ solved, total, pct, chance, byTag, failures }`.
  `chance` is what blind random picking scores on that set (chain 23 %, five 5.7 %).
  `npm run puzzles` regenerates the sets, `npm run puzzles:verify` re-proves the tactical
  ones without the solvers.
- **Benchmark** (`npm run benchmark [id]`): 60 (chain) / 100 (five) seeded games against
  Random at the highest difficulty, both colours, 20 000-node budget → win rate in %; plus
  the puzzle score. Written to `client/bots/<id>/benchmark.js`, shown in the bot modal and
  the lobby's Opponent row as "47 % vs Random · 22 % puzzles". `.github/workflows/benchmark.yml`
  reruns it when bots, rules or tools change and opens an auto-merging PR with the new
  files. Bots flagged `baseline: true` (the Random bots) are the opponents and are not
  benchmarked themselves.

**One bot per game (#21).** `Bots.botFor(game)` returns the game's real bot (the
best-rated one without `baseline`; while a game has none, its Random baseline), and every
player-facing place calls it "Bot" (`Opponent.NAME`, the HUD seat name). A stronger
engine replaces the folder instead of joining it; variants are difficulties or future
parameters (deliberate mistakes, styles) of that one bot. The benchmark and puzzle numbers
stay the yardstick between versions.

## 7. Headless playouts

```js
const H = loadHeadless();                                   // scripts/headless.mjs
const a = H.Bots.create("random-chain", { seed: 1, me: 0 });
const b = H.Bots.create("random-chain", { seed: 2, me: 1 });
const r = await H.Bots.playout("chain", { n: 6 }, [a, b], { maxMoves: 600 });
// r = { over, winner, moves, history, state }; seats may also be plain functions state => move
```

## 8. Current bots

| id | name | game | difficulties | what it does |
| --- | --- | --- | --- | --- |
| `random-chain` | Random | Chain React | Normal | any legal move; `baseline: true` (benchmark opponent, fallback; never offered) |
| `creeper-chain` | Creeper | Chain React | Easy 30 ms · Normal 150 ms · Hard 600 ms · Very hard 1500 ms | negamax alpha-beta with iterative deepening, Zobrist TT, killers/history, PVS + LMR, quiescence over explosive captures, on an Int8Array engine proven equal to the rules; evaluation = pieces + safe corner/edge bonus − exposure penalty, tuned by self-play. 100 % vs Random, 159/159 puzzles at Very hard (Easy 32 %, Normal 87 %, Hard 95 %). Provides the win chance (evaluate: even-depth iterative deepening with full explosion quiescence, mean of the last completed depths; calibrated scale ≈ 31, swing 2.2 %). See its README. |
| `random-five` | Random | Five Wins | Normal | any empty cell; `baseline: true` (benchmark opponent, fallback; never offered) |
| `sensei-five` | Sensei | Five Wins | Easy 30 ms · Normal 150 ms · Hard 600 ms · Very hard 1500 ms | Int8Array board with incremental line-pattern records (fours, threes, four-makers), alpha-beta negamax with iterative deepening, Zobrist TT, killers/history, exact forced-move handling (own four, enemy fours, open threes), VCF/VCT threat searches with exact mate distance; works for any board size and win length. 100 % vs Random, 154/154 puzzles at Very hard (Easy 69 %, Normal 98 %, Hard 100 %). Provides the win chance (evaluate: depth-2 search with forced fours free, open-three extension, VCF/VCT on long budgets; calibrated scale ≈ 1166, swing 0.9 %). 9×9 with sound defence is drawish; its edge grows on bigger boards. See its README. |

Each bot folder's README describes its search and evaluation; `benchmark.js` carries the
scores shown in the bot modal. Players see Creeper and Sensei as "Bot".

## 9. Persona: the bot's emojis

`client/bot-persona.js` makes a bot seat feel like a player without touching the bot: it
watches the Bus and posts sparse reactions in the bot's colour — a wave at the start,
"GG" at the end, "EZ" (or 😎) once when its win chance passes 90 %, 😔 (or 😱) once below
12 %, a thumbs-up / applause / 🔥 / 🫡 when the human found a move that costs the bot
≥ 15 points and was among the best options, a surprised or teasing face (😲 🤡 💀 😂)
when the human played one of the worst options, and a happy or gracious face after the
result. Each moment picks from a weighted pool (`BotPersona.POOLS`) with the seeded rng,
so two games never feel scripted the same way. It uses `tools.legalMoves`/`apply` and the
estimator, never more than one reaction per 6 s and eight per game, seeded from the bot's
seed. Nothing to implement per bot; a bot without `estimate` still waves and says GG (the
rules' fallback estimate drives the rest).

## 10. Adding a bot — checklist

1. `client/bots/<id>/bot.js` with `Bots.register({...})` (copy `random-five`).
2. `client/bots/<id>/bot.test.mjs` (see §6) and an empty `benchmark.js`.
3. Two script tags in `index.html` after the `<!-- bots: <game> -->` anchor.
4. `npm run benchmark <id>`, `npm test`.
5. A short README in the folder for anything non-obvious (evaluation terms, search tricks).

## 11. Designing an evaluator (what the win-chance work taught us)

The HUD's win chance is the most visible thing a bot does besides playing, and it is easy
to make it look nervous. The two evaluators went through this cycle; the numbers are from
seeded self-play at the 12 000-node stage.

| | Creeper (Chain React) | Sensei (Five Wins) |
| --- | --- | --- |
| first version | 600-node ~3-ply search, steep logistic | static patterns + a ±1000 penalty for facing an open three |
| symptom | 80 → 10 → 80 flips every turn (side-to-move bias ±0.039) | mean move-to-move change 0.166, 243 jumps > 0.25 in 10 games |
| what fixed it | even depths only, completed depths only, mean of the last three completed depths, 10-ply quiescence over explosive captures, proven results → ±∞ | depth-2 search where forced fours cost no depth, open-three extension through the restricted defence set instead of a penalty, VCF/VCT on long budgets, dead-board draw terminal |
| result | bias ±0.008, swing 0.05 (undecided 0.04) | swing 0.031, bias ±0.006 |
| own scale guess | 10 | 300 |
| calibrated scale | 31.3 (shift −5.5) | 1166 (shift −62) |
| Brier | 0.21 | 0.006 |
| ms per call (2k / 12k / 60k nodes) | 2 / 15 / 59 (6×6) | 0.6 / 45 / 177 (9×9), 0.9 / 84 / 353 (15×15) |

Rules of thumb:
1. Return a consistent raw score and let `scripts/calibrate.mjs` fit the curve; your own
   logistic will be too steep.
2. Remove side-to-move bias inside the search (even depths, quiescence); don't paper over
   it with display smoothing — the smoothing in the HUD is a third of the previous move,
   off in decided territory, and exists only to soften genuine re-evaluations.
3. Node budgets, never wall-clock, so both online clients compute identical numbers; the
   2 000-node call must be synchronous and cheap, longer ones async with `tools.yield()`.
4. Report ±Infinity only for proven results (rule-terminal or a complete forced line).
   "Budget exhausted" is unknown, never a verdict.
5. Measure before/after with the same seeded games; assert the swing and the bias in the
   bot's tests so a future tweak can't quietly bring the zigzag back.

