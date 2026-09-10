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
        │   client/bots/<id>/benchmark.js   generated: Bots.benchmark(id, { score, puzzles, … })
        │
        ├── client/app.js                   bot seat: hooks.onTurn → botTurn → bot.move(clone) → Game.play(i)
        ├── client/opponent.js              picker UI (bot, difficulty, scores), choice per game
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
    name: "Blast",                     // shown in the picker and as the player name in the HUD
    game: "chain",                     // "chain" | "five" — one game per bot
    version: 1,                        // bump when the play changes (kept in benchmark.js)
    description: "One sentence for the picker card.",
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
| `apply(state, i)` | position after `i` by the current player on a copy: place + settle + conclude; sets `over`/`winner` |
| `outcome(state)` | `{ over, winner }` (`winner` null while running, -1 draw) |
| `opponents(p = me)` | the other seats |
| `deadline(ms = budget.ms)` | `{ expired(), tick(n = 1), left(), nodes() }` — expires on time **or** on `budget.nodes` |
| `yield()` | `await tools.yield()` lets the page breathe (every ~2 000 nodes on long levels) |

`apply`/`clone` are convenient but slow (JSON): a searching bot keeps its own compact board
(typed arrays, make/unmake) and proves in its tests that it matches the real rules.

State shape (from `Rules.base` + the game's `create`): `n, players, current, round, history,
movesBy, busy, over, winner, finishWhy, cells` (chain: `[{ count, owner, cap }]`, plus
`chainRule, chainLen, chainNow, chainBest, explosions`; five: owner per cell -1/0/1, plus
`winLen, winLine`). Cell id = `y * n + x`.

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

## 5. Win chance (`estimate`)

`Bots.estimator(game)` returns `state → P(player 0 wins)`: the strongest registered bot of
the game that defines `estimate` (by benchmark score), else the rules' heuristic. The HUD
shows it as "62 % win" for both players after every move, in every mode; online both
clients compute it from the same state. Requirements for `estimate`: deterministic, ≤ ~15 ms,
exact at terminal positions (1 / 0 / 0.5), roughly 0.5 on an empty board.

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
  `chance` is what blind random picking scores on that set (chain 23 %, five 5.5 %).
  `npm run puzzles` regenerates the sets, `npm run puzzles:verify` re-proves the tactical
  ones without the solvers.
- **Benchmark** (`npm run benchmark [id]`): 60 (chain) / 100 (five) seeded games against
  Random at the highest difficulty, both colours, 20 000-node budget → win rate in %; plus
  the puzzle score. Written to `client/bots/<id>/benchmark.js`, shown in the picker as
  "47 % vs Random · 22 % puzzles". `.github/workflows/benchmark.yml` reruns it when bots,
  rules or tools change and opens an auto-merging PR with the new files.

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
| `random-chain` | Random | Chain React | Normal | any legal move; the benchmark baseline |
| `creeper-chain` | Creeper | Chain React | Easy 30 ms · Normal 150 ms · Hard 600 ms · Very hard 1500 ms | negamax alpha-beta with iterative deepening, Zobrist TT, killers/history, PVS + LMR, quiescence over explosive captures, on an Int8Array engine proven equal to the rules; evaluation = pieces + safe corner/edge bonus − exposure penalty, tuned by self-play. 100 % vs Random, 159/159 puzzles at Very hard (Easy 32 %, Normal 87 %, Hard 95 %). Provides the win chance. See its README. |
| `random-five` | Random | Five Wins | Normal | any empty cell; the benchmark baseline |
| `sensei-five` | Sensei | Five Wins | Easy 30 ms · Normal 150 ms · Hard 600 ms · Very hard 1500 ms | Int8Array board with incremental line-pattern records (fours, threes, four-makers), alpha-beta negamax with iterative deepening, Zobrist TT, killers/history, exact forced-move handling (own four, enemy fours, open threes), VCF/VCT threat searches with exact mate distance; works for any board size and win length. 100 % vs Random, 144/144 puzzles at Very hard (Easy 69 %, Normal 95 %, Hard 99 %). Provides the win chance. 9×9 with sound defence is drawish; its edge grows on bigger boards. See its README. |

Each bot folder's README describes its search and evaluation; `benchmark.js` carries the
scores shown in the picker.

## 9. Adding a bot — checklist

1. `client/bots/<id>/bot.js` with `Bots.register({...})` (copy `random-five`).
2. `client/bots/<id>/bot.test.mjs` (see §6) and an empty `benchmark.js`.
3. Two script tags in `index.html` after the `<!-- bots: <game> -->` anchor.
4. `npm run benchmark <id>`, `npm test`.
5. A short README in the folder for anything non-obvious (evaluation terms, search tricks).
