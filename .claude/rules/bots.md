---
paths:
  - "client/bots.js"
  - "client/bots/**"
  - "client/winchance.js"
  - "client/bot-persona.js"
  - "client/dev.js"
  - "client/opponent.js"
  - "scripts/headless.mjs"
  - "scripts/benchmark.mjs"
  - "scripts/calibrate.mjs"
  - "scripts/puzzles/**"
  - "tests/puzzles/**"
  - "tests/unit/bots.test.mjs"
  - "tests/unit/winchance.test.mjs"
  - "tests/unit/calibrate.test.mjs"
  - "tests/unit/puzzles.test.mjs"
  - "tests/unit/persona.test.mjs"
  - "tests/unit/dev.test.mjs"
  - "docs/bots.md"
---

# Bots: framework, budgets, benchmark, calibration, puzzles

The bot registry and toolset, node budgets, rule variants, the benchmark and calibration, the puzzle sets and their solvers, the persona, the developer panel, and the lessons every evaluator taught. The core context is `AGENTS.md`; `docs/bots.md` is the longer reference.

## Bots (`client/bots.js`, `client/bots/<id>/`)

Bots are pure and headless: no DOM, only the game's rules module + the toolset. The same
code runs in the browser and in Node (`scripts/headless.mjs` loads util, rules, bots.js and
every bot folder into a bare VM — script list parsed from `index.html`).

- **Registry**: `Bots.register({ id, name, game, version, description, difficulties:
  [{ id, label }, …], create(tools), baseline? })` (validated: slug id, ≥ 1 difficulty,
  create fn, boolean `baseline`). `Bots.get/list/forGame(game)`, `Bots.benchmarkOf(id)`.
  **One bot per game (#21):** `Bots.botFor(game, config)` = the best-rated bot without
  `baseline` that `supports(config)` (an optional predicate on the config for rule variants
  a bot does not know; `Bots.supports(id, config)`. **No bot declares it today**: Sensei
  learned the Yavalath rule and names it through `variant` instead, see the next point. It
  stays the way a future game ships a bot for its plain rules first), or — while a game has
  no real bot for those rules — its Random baseline, so
  "Against a bot" always works. `Bots.estimator(game, config)` filters the same way
  (`WinChance` passes `game:new`'s config, `Match.setupBot` / `Opponent.current(game, cfg)`
  / `Opponent.open(game, cfg)` the lobby's settings). The Random bots are `baseline: true`: the benchmark and
  calibration opponent and the illegal-move fallback, never offered to players and not
  benchmarked themselves (no `benchmark.js`). Players see every bot as "Bot"; the ids and
  `name`s stay for the code, the benchmark output and the docs. Rules modules register themselves
  (`Rules.register("chain", ChainRules)` → `Rules.of(key)`) so bots find them without the
  DOM-bound engine.
- **Rule variants**: a bot that plays a variant well enough for its own numbers names
  it with `variant(config) → key | null` (Sensei: `yavalath`). The benchmark then runs a
  second seeded series and grades a second puzzle set for it and stores both under
  `variants: { <key>: { score, games, avgMoves, puzzles } }` inside the same
  `Bots.benchmark(id, result)` statement; `scripts/calibrate.mjs` fits a second logistic
  under `variants: { <key>: { scale, shift, … } }`. `Bots.benchmarkOf(id, config)` /
  `Bots.calibrationOf(id, config)` overlay the variant on the base entry (so `version`,
  `commit` and `at` stay the base's) and `Bots.variantOf(id, config)` names it, which is how
  the bot modal's badges, `Opponent.summary` and the win chance follow the room's rules. The
  series live in `VARIANTS` in `scripts/benchmark.mjs` and `scripts/calibrate.mjs`.
- **Instance**: `Bots.create(id, { me, difficulty, seed, players, budget })` → `{ def,
  tools, difficulty, move(state) }`. `create(tools)` runs once per game and may keep state
  (caches, opening books); `move(state)` returns a cell index or a Promise of one.
- **Budgets** (the reason a level is exactly as strong everywhere and tests stay
  deterministic): every difficulty declares `nodes` (an integer ≤ 1 000 000, default
  2 000; Creeper 2 000 / 10 000 / 30 000 / 100 000, Sensei … / 60 000 — Very hard is
  ~0.15 s resp. ~0.5 s on a desktop). `tools.budget = { ms: Infinity, nodes }` **everywhere**
  — the app uses the level's nodes, the conformance tests and the benchmark pass 2 000
  resp. 20 000 — so a searching bot gives identical answers on any machine; there is no
  wall-clock budget in the app any more (owner: difficulty must never depend on the
  device). `ms` still exists in the toolset for a caller that wants a time cap. Bots take
  `const d = tools.deadline()` per move and `d.tick()` per searched node, stop when it
  returns true (iterative deepening keeps the last finished depth), and `await
  tools.yield()` every few thousand nodes on long levels so the page stays responsive.
- **Toolset** (`Bots.tools(game, opts)`): `game, rules, me, players, difficulty, seed`,
  seeded `random()/randInt/pick/shuffle` (mulberry32: same seed → same game, which is how
  random bots are unit-tested), `legalMoves(state, p)`, `isLegal`, `clone`,
  `apply(state, i)` (place + settle + conclude on a copy → the position after the move,
  with `over/winner`), `outcome(state)`, `opponents(p)`, `deadline(ms)` for time-boxed
  search, `report(info)` / `last` / `lastDeadline` (what the bot tells about its last
  move — depth, value, a `forced` note — and the deadline that counted its nodes; every
  real bot reports, `Match.botInfo` collects it with the move, the time and the budget for the
  dev panel, #31). Rules modules are also reachable directly (`tools.rules`: chain `tally`,
  `readyCells`…; five `lineThrough`, `bestRow`). Add generic helpers here, game-specific
  analysis in the rules module — never in a bot.
- **Playout**: `Bots.playout(game, config, seats, { maxMoves })` runs a full headless game
  (seats = instances or `state → move` functions) → `{ over, winner, moves, history }`.
- **Tests**: `tests/unit/bots.test.mjs` covers the framework (registry and validation, the
  seeded rng, the toolset, `playout`) and holds a **conformance suite every registered bot
  must pass** for every difficulty, all of it at the fixed 2 000-node budget: only legal
  moves and the same move for the same seed in 300 seeded random positions on the first
  level and 60 on every other (plus 120 per rule variant the bot says it plays), and full
  games finished as either colour against Random at an average under 250 ms per move. Each
  bot folder has its own `bot.test.mjs` (the glob `client/bots/**/*.test.mjs`) for what makes
  that bot that bot (Random: covers every legal cell, roughly uniform, seed reproduces a
  whole game). A real bot's tests should prove strength facts: beats Random by a margin,
  blocks an open four, takes a win in one, never worse than depth-1 greedy, etc. (VM realm:
  compare arrays via `JSON.stringify`.)
- **Benchmark** (`npm run benchmark` = `scripts/benchmark.mjs [id…]`): every real bot
  (not the baselines) plays a seeded series against the Random bot of its game (chain 6×6,
  five 9×9, isolation 7×7, boxes 4×4,
  both colours, highest difficulty) → score = win rate in % (draw = ½) plus
  `games, opponent, avgMoves, version, commit, at` (60 chain / 100 five / 100 isolation /
  60 boxes games, 20 000-node
  budget per move so the series is deterministic), written to
  `client/bots/<id>/benchmark.js` (`Bots.benchmark(id, result)`; `at/commit` kept when the
  numbers didn't change so a re-run never diffs). Those files are listed in `index.html`,
  so the score is baked into the page; `Opponent` shows it ("47 % vs Random") in the
  picker and the lobby summary. `.github/workflows/benchmark.yml` runs it on pushes to
  `main` that touch `client/bots/**` (not the benchmark files), `bots.js`, the rules or the
  tools, and opens an auto-merging PR (branch `bot-benchmark`) with the new files (branch
  protection needs the `test` check, so a direct push isn't possible; auto-merge is
  enabled on the repo and Actions may create PRs). The numbers stay the yardstick for
  future versions of a bot (a bot near 100 % is compared on puzzles and self-play).
- **UI**: `Opponent` (client/opponent.js) renders `#bot-modal` in one step (#21): icon,
  `#bot-name` "Bot", `#bot-desc` (the bot's description), `#bot-badges` ("vs Random" and
  "puzzles" or "not rated"; no rating boilerplate text), a *Parameters* box with the
  `#bot-difficulty` control — hidden with one level — and its hint ("Easy: searches up to
  2 000 positions per move."),
  Cancel, Play. Default per game = middle difficulty (`Math.floor((n-1)/2)`); remembered
  `{ id, difficulty }` per game in `localStorage["chainreact.bots"]`;
  `Opponent.current(game)` / `summary(game)` ("Bot · Normal · 100 % vs Random · 100 %
  puzzles") / `Opponent.NAME`.
- **Persona** (`client/bot-persona.js`): `BotPersona.attach({ bot, seat, game, state,
  estimate, color, post })` wherever `Match` runs a bot seat (offline or the room's bot),
  `detach()` in `Match.stop` / `reset`; `post` decides how a reaction is shown (default
  `Reactions.receive`; in a room `Match` also relays it, #36). Listens
  to `game:new` (👋), `game:turn`/`game:move` (judges the human's move once it settled:
  praise when the bot's chance drops ≥ 15 points and the move was among the best, a
  surprised/teasing face when the move was among the worst 25 % and helped the bot ≥ 10
  points; "EZ" once when its chance ≥ 90 %, 😔 once when ≤ 12 %), `game:finish` ("GG",
  then a happy or a gracious face). Every moment draws from a weighted pool
  (`BotPersona.POOLS`: strong 👍 45 / 👏 25 / 🔥 15 / 🫡 15, blunder 😲 40 / 🤡 20 / 💀 20 /
  😂 20, ez EZ / 😎, sad 😔 / 😱, won 😄 / 😎 / 🥰, lost 😔 / 👏 / 🫡; hello and GG fixed) so
  it isn't the same every game — the owner found the fixed 🚨/😲 mapping automated; a
  good move gets a thumbs-up, a blunder a bit of trolling. One reaction per 6 s, ≤ 8 per
  game, seeded from the bot's seed (`Bots.rng(seed ^ 0xc0ffee)`, the pick uses the same
  rng), 0.5–1.4 s delay, posted via `Reactions.receive` in the bot's colour. Tests pass
  `delays`/`cooldownMs` overrides and assert against the pools.

- **Puzzles = perfect-move test sets** (`tests/puzzles/<game>/puzzles.json`, one folder per
  set; a **rule variant** gets its own folder `tests/puzzles/<game>-<variant>` whose `game`
  is still the rules key, with `variant` named in the file and the flags in every puzzle's
  `config` — `five-yavalath`, 124 positions on 6×6 to 9×9 with winLen 4): positions whose
  best move(s) were PROVEN by a solver (`scripts/puzzles/<game>/solver.mjs`, exhaustive
  minimax / proven threat search; the five solver knows the Yavalath rule and caps its threat
  proof at 3 plies there, where it is complete without any candidate restriction), generated
  deterministically by
  `scripts/puzzles/<game>/generate.mjs` (`npm run puzzles`, the variant as an argument:
  `node scripts/puzzles/five/generate.mjs yavalath`) into `puzzles.json` (`{ game, variant?, generated, solver, puzzles: [{ id, config, history, toMove, best,
  value, depth, tags, note }] }`; `history` replays from an empty board, `best` = all
  optimal moves, `value` from the mover's view, tags like `win-in-1`, `must-block`,
  `avoid-loss`, `win-in-2`, `endgame-exhaustive`, and for the Yavalath set `avoid-three`
  (a move that makes winLen - 1 is on the board) and `forced-three` (after the best move
  every reply of the opponent loses); note the sets differ slightly: chain's
  `avoid-loss` means "loses to the immediate reply", five's "loses by force", isolation's
  set is all endgames — no draws exist there, so `best` is every move that keeps the win and
  `avoid-trap` means every other move hands over an immediate trap, and the boxes
  set is all `endgame-exhaustive` with its own structural tags `take-box`, `double-deal`,
  `safe-move`, `sacrifice` and `best` = the lines that reach the best final box difference). Each test
  folder has `solver.test.mjs` (the solver on hand-made positions + the set's consistency,
  re-solving every puzzle), each script folder a README with the guarantee and the limits.
  `scripts/puzzles/verify.mjs` (`npm run puzzles:verify`) re-proves the tactical puzzles
  with a solver-independent one-ply check and prints the blind-random baseline. `scripts/puzzles/runner.mjs` replays a puzzle (`positionOf`) and grades a bot
  (`evaluateBot` → solved/total/pct, per tag, failures; `runner.mjs`'s `puzzleSets()` lists
  the folders and `setConfig(data)` the rules a set is graded with); `tests/unit/puzzles.test.mjs`
  checks every set (≥ 100, replayable, legal best moves) and prints every bot's score; the
  benchmark stores it as `puzzles: { solved, total, pct, chance }` in `benchmark.js`
  (`chance` = what random picking scores on that set — small boards have few legal
  moves, so Random gets 23.2 % on the chain set, 20.8 % on the isolation one and 28.9 % on
  the boxes one, against 5.7 % on five; read scores
  against it). **No test and no
  workflow ever requires 100 % or any fixed puzzle score to pass the build or deploy**
  (owner's rule): the shared test only checks the sets, real bots assert their own
  thresholds on `evaluateBot` in `bot.test.mjs`, set below the level they actually reach.
  The owner's view: puzzles are the right yardstick while bots are weak; once bots are
  strong, head-to-head series matter more — both numbers are kept and both show in the
  picker badge and the lobby summary. A natural next step once there are several real
  bots: a round-robin "battle of bots" (every bot vs every other, both colours) with an
  Elo-style rating instead of only "vs Random".

### How to add a bot
1. `client/bots/<id>/bot.js` with `Bots.register({...})` — copy `random-five`. Use
   `tools.random`, never `Math.random` (tests and the benchmark rely on seeds). Long
   searches: check `tools.deadline(...)` or return a Promise that yields via `setTimeout`.
2. `client/bots/<id>/bot.test.mjs` with the facts that make the bot good (see above).
3. Two script tags in `index.html` right after the `<!-- bots: <game> -->` anchor line:
   `bot.js` and `benchmark.js` (create an empty `benchmark.js` until the first run; a
   `baseline: true` bot has none).
4. `npm run benchmark <id>` locally (or let the workflow do it) — commit `benchmark.js`.
   A game has **one** playable bot (#21): a better bot replaces the old folder rather than
   sitting next to it; variants are difficulties / parameters of that bot.
5. `npm test`; the conformance suite, the puzzle grading and the e2e bot flow run
   automatically. Add `evaluateBot` thresholds (per tag if useful) to the bot's tests.

## Developer info (`client/dev.js`, #31)

"Show developer info" in the preferences (`Prefs.developer`) shows `#dev-panel`, a `<pre>`
fixed bottom-left (`pointer-events: none`, never in the way), refreshed every second
(`Dev.EVERY_MS`) from `Dev.snapshot()`: **network** (`Net.status/role`, `Net.transport` =
broker socket state, dial attempts, channel failures; `Net.iceInfo` = relay-only / TURN in
the list / server count; `Net.stats()` = every connection with seat, open, silent, pong age
and its WebRTC route from `getStats()`: local → remote candidate type, protocol, RTT,
bytes), **performance** (fps and worst frame from a `requestAnimationFrame` counter, JS heap
where the browser exposes it, board size, cells, the last move's animation time from
`game:move` → `game:position`), **bot** (`Match.botInfo`: id, difficulty, node budget, last
move, ms, nodes searched, depth / value / forced note from `tools.report`) and the
**win-chance** estimator's last stage (`WinChance.info`). `Dev.format(snapshot)` is pure
(unit-tested); the e2e `bot` and `online` suites check the panel's bot section and a relay
route respectively.

## Lessons learned

- **Win chance and evaluators: budget a measurement pass into every new game.** It is never
  right the first time and every game failed differently, so plan for swing, mover bias and
  Brier from seeded self-play before calling a bar done. Measure the *mover bias* (mean of
  p − the average of its neighbours, per side to move) separately from the raw swing: proven
  wins that the weaker self-play bots then throw away are legitimate 100→0 changes. What the
  four games taught, in order:
  - **Chain React: parity.** A shallow fixed-depth search evaluates "the side to move has the
    initiative" and flips every turn (odd/even horizon effect, side-to-move bias ±0.039).
    What fixed it: even depths only, counting only fully completed depths, averaging the last
    completed depths, and full quiescence over forced explosions before any leaf is scored;
    blending odd and even depths or "last depth only" made it worse. Bias ±0.008, swing 0.05.
  - **Five Wins: a static threat penalty.** The zigzag came from a ±1000 penalty for facing an
    open three. Extending the search through the forced defence instead (forced fours cost no
    depth, an open-three extension through the restricted defence set, VCF/VCT on long
    budgets) removed it: move-to-move change 0.166 → 0.031, bias ±0.006.
  - **Isolation: a minimax value carries a tempo artefact.** The bar flipped 85 → 53 → 90
    every single move. Two causes: the root maximised even when the *other* seat was to move
    (a plain bug in an evaluator that is asked about any position, not only its own turn), and
    `max min` at one ply parity is systematically better for the mover than `min max` at the
    other. The fix that worked: search the position **and** the same position with the other
    seat to move, at the same depth, and average the two — symmetric by construction — plus a
    narrower move generator for the estimator to buy a ply. Swing 32 % → 11.7 %, shift
    464 → 271.
  - **Dots and Boxes: a budget-dependent proof is a jump generator.** The bar jumped between
    43 % and 72 % on quiet moves and then between a proven 100 % and an unproven 60 % on the
    next one. The endgame proof ran on *the caller's* node budget, and whether a 30-line
    search finishes is not monotone in the lines left, so the same position read 43 % at the
    HUD's 2 000-node stage and 100 % at the 60 000-node one. Fix: one cap of its own
    (`EVAL_NODES`) for every stage, plus a null-window probe that only proves the *sign* of
    the final box difference (`exactWinner`, two probes sharing one table), which lifted the
    share of 5 × 5 endgames proven at 30 000 nodes from 91 % to 95 % and 7 × 7 to 100 %, so
    the proof arrives once and stays. Ask the proof the cheapest question you can.
  - **Dots and Boxes: test the term, don't assume it.** The score also added a tempo term (who
    has to open first, from the parity of the safe lines) worth up to four boxes, which
    flipped whenever a move made several lines unsafe. Textbook dots-and-boxes theory, and
    measured against seeded self-play, self-play with 12 % random moves and games against
    Random, always with a symmetric fit, it predicted **no better than the plain box lead**
    out of sample; neither did Monte-Carlo rollouts of the rest of the game with the bot's own
    chain policy (they only look convincing on the games their own policy played). So it is
    gone: until the endgame is proven, Dots and Boxes has no honest signal beyond the boxes on
    the table, and `evaluate` returns `(boxes 0 - boxes 1) / (boxes still open + 1)`,
    symmetric and independent of who is to move. Undecided move-to-move change 4.9 % → 0.18 %,
    undecided flips over 15 points 45 of 253 → 0 of 234, mover bias −0.009 → 0.000, stage
    disagreements 12 of 120 → 0 (5 × 5; 7 × 7 went 5.6 % → 0.8 % and 100 of 567 → 0). Being
    right about *nothing* beats being nervous about everything.
  - **Calibrate, don't guess.** Every bot's own logistic scale was 3–4× too steep compared
    with what self-play outcomes support (Creeper 10 → 31.3, Sensei 300 → 1166). The flatter,
    data-fitted curve is what makes the number calm and honest; it lives in `benchmark.js`
    and is regenerated by the benchmark. Brier scores: chain 0.21, five 0.006, isolation
    0.206, boxes 0.177 (deterministic self-play is very predictable — don't read the 0.006 as
    "perfect").
  - **A calibration needs undecided positions *with different scores*, and a symmetric
    evaluator needs a symmetric fit.** Fencer solves 4 × 4 endgames exactly, so nearly every
    self-play sample came back ±Infinity, the logistic had fewer than 20 finite points and
    `calibrate` silently returned null (no `Bots.calibration` line in `benchmark.js`). A 5 × 5
    series fixed the count but not the content: 95 % of its finite samples were a plain raw 0,
    because on that board every position in which a box has already been won is proven anyway,
    and the fit collapsed to a step (scale 0.002). The series runs on 7 × 7 now. Mirroring the
    seats negates a symmetric score, so raw 0 must be 50 %, but the series is not neutral
    (every fifth game is played against Random, always on seat 1) and the fit happily leans a
    couple of points toward that seat: `symmetric: true` on the series in
    `scripts/calibrate.mjs` fits the samples together with their mirrors and pins the shift at
    0. Check the benchmark output for the "win chance: scale …" part after adding a bot, and
    look at the scale itself: a value orders of magnitude away from your raws means the fit
    found no spread, not a confident bot.
  - **Never evaluate mid-animation**; freeze the display while `state.busy`, refresh once per
    settled move, refine in the background with node budgets (deterministic across devices;
    wall-clock budgets would make two online clients disagree).
  - **Rewriting an evaluator means bumping the bot's `version`** (cached replay analyses are
    stamped with it, #43) and re-running `npm run learn:scenarios`, because the ladder's
    "play it out" positions are picked by win chance.

- **Benchmark files must reproduce byte for byte** (seeded series, fixed budgets, the
  stamp-preserving check reading only its own statement); otherwise the workflow opens
  no-op PRs. Run `node scripts/benchmark.mjs` after any bot/rules change and commit.

- **Prove a search reduction, don't reason about it.** "If a capture is available, take it"
  looks obviously right in dots and boxes and is **wrong**: eating a chain to the end hands
  control away, which is the whole point of the "all but two" sacrifice. Only a capture that
  leaves no new three-sided box behind is provably free. The boxes solver ships a
  reduction-free brute force next to the fast engine and the test compares the two on 80
  positions — that is what turned "I think this is safe" into a checked fact.
- **Puzzle sets are only as good as their solver's guarantee.** Every solver (chain, five
  with and without the Yavalath rule, isolation, boxes) is exhaustive or threat-proven and
  re-solves every puzzle in its own test; `puzzles/verify.mjs` re-proves
  the tactical ones with an independent one-ply check. When a rule changes (the dead-board
  draw), the solver must learn it and the set must be regenerated.
