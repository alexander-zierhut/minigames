---
paths:
  - "client/games.js"
  - "client/games/**"
  - "client/match.js"
  - "client/css/game.css"
  - "client/css/skin-mc.css"
  - "tests/unit/rules.test.mjs"
  - "tests/unit/framework.test.mjs"
  - "tests/unit/chain.test.mjs"
  - "tests/unit/five.test.mjs"
  - "tests/unit/isolation.test.mjs"
  - "tests/unit/boxes.test.mjs"
  - "tests/unit/party.test.mjs"
  - "tests/unit/premove.test.mjs"
  - "tests/unit/replay.test.mjs"
---

# Games: engine, rules, records, adding a game

The engine contract every game plugs into, the HUD model, the game record, the rules of Chain React, Five Wins, Isolation and Dots and Boxes, the board / HUD layout rules, the Bus events, the table (`match.js`: seats, bots, premoves) and the step-by-step guide for a new game. The core context is `AGENTS.md`.

## Game engine interface (`client/games.js`)

`Games.register(def)` creates an engine from `def.rules` + `def.view` and stores the
definition (`Games.get(key)`, `Games.has`, `Games.keys()` in registration order; the first
registered game is the default; `Games.positionAt(record, ply)` = `Rules.replay`). Match
holds the active engine (`Match.engine`) and, like everything else, only uses:

| Member | Contract |
| --- | --- |
| `state` (getter) | Current state object: `n, players, current, round, history, movesBy, out, outs, busy, over, winner (-1 = draw/none), finishWhy, cells` + game keys (chain: `chainNow, chainBest, explosions, chainRule, chainLen`; five: `winLen, winLine`). `out[p]` = eliminated from outside the rules (flag fall), `outs` = those eliminations in order `{ p, at: history length then, why }`. |
| `config` (getter) | The config the running game was started with (incl. `startPlayer`). |
| `newGame(config, hooks)` | Builds state via `Rules.create`, board DOM via `view.build`, sets `body.game-<key>`, the sign title and `#board`'s class, HUD cards via `Hud.build(players, title)`, clears the log, hides the overlay, logs "New game. X starts.", emits `game:new` + `game:position`, renders, calls `hooks.onTurn`. |
| `play(i) → Promise<bool>` | A move by the current player (own click, relayed friend move, bot). `false` if busy/illegal. Sets busy, `rules.place`, emits `game:move`, `hooks.onMoveApplied`, `await view.animateMove(ctx, i, me)`, `rules.conclude` → `finish` or next turn (`game:position`, `game:turn` **only when the turn really changed hands** — Dots and Boxes keeps the mover on turn after a closed box, and then no `game:turn` is emitted, so sounds and observers do not fire twice — then `hooks.onTurn`, which always runs). Bails out if `state.over` became true during the animation. |
| `replay(history, outs = [])` | `Rules.apply` on the live state — the same `step`/`eliminate` the instant path uses — then renders and finishes or emits `game:position` + calls `onTurn`. Determinism here keeps every client in sync; `replay([], outs)` applies a flag fall one missed. |
| `finish(winner, why)` | Ends the game (also called for flag falls / remote timeouts): logs, renders, `Hud.overlay(...)` (title, `why` + `view.summary(state)`), emits `game:position` + `game:finish`, calls `onBusy(false)`, `onFinish`. |
| `eliminate(p, why)` | `Rules.eliminate` + "X is out." in the log (3+ players); the turn passes if it was theirs, the last one standing wins — with two players that simply ends the game ("X wins! Out of time!"). Returns false when nothing changed. |
| `abandon()` | Marks a running game over without a result (Back to room). |
| `hash()` | 32-bit fingerprint of cells/current/over/winner/movesBy/out; equal on clients that are in sync (used by `move`/`sync`). |
| `record()` | The game as data: `{ game, config, history, outs, over, winner, why }` — see "Game records". |
| `render()` | No-op until a board exists. Renders the shown position (the preview if there is one, else the live state): every cell (shared classes `p<k>`, `taken`, `last` (the cell of `cellOf(last move)`), `can-place`/`locked` (from the optional rules function `canPlay(state, i, player)` when the game has one, else `isLegal` — Isolation's move needs two clicks, so `canPlay` says which tiles *start* a move), then the one class `hooks.cellClass(i)` asks for, then `view.renderCell`), then **`view.renderBoard(state)` if the view has one** (a board part that is not a cell: Dots and Boxes paints its boxes there), and the HUD from `view.hud(...)`. |
| `isLegal(i, player)` | Pure check via the rules. |
| `cellOf(move)` | The board cell a move belongs to. Games whose move is not a plain cell id say so through the optional rules function `cellOf(state, move)` (Isolation: a move is `to * cells + removed`, and the cell is `to`); everything else keeps the identity. Used for the `last` marker and by `Match` for the premove marker. |
| `preview(ply)` | **View only** (#38, the replay bar): show the position after `ply` moves (`Rules.replay(record(), ply)`) instead of the live one and re-render; `null` (or a `ply` at / past the end) goes back to the live position. Returns the new `previewPly`. It never touches the live state, the record, `hash()`, the session or the Bus, and while it is on every cell is `locked` and clicks are dropped, so a preview can never leak into play or into what the friends receive. |
| `previewPly` (getter) | How many moves the shown position has, `null` when the live position is shown. |

Hooks (built once in `Match`, the engine never sees the app): `names` (getter → the name of
whoever sits in each seat, #35; bot seats show the bot's name), `mayPlay(p)` (may this device move for p
now: local seat + `live()`), `turnHint(p)`, `cellClass(i)` (one extra class the table wants
on that cell, `""` for none — that is how the premove marker and Learn's `hint` get on the
board without any game knowing it), `onCellClick(i)`, `onMoveApplied(i, p)`, `onTurn(p)`,
`onBusy(bool)`, `onFinish(winner, why)`. Tests build their own (`tests/unit/dom.mjs`).

### HUD (`Hud`, generic — a game only supplies a model)

`Hud.build(players, title)` clones `#tpl-player` per seat (ids `p-{k}`, `p{k}-name`,
`p{k}-you`, `clock-{k}`, `p{k}-stats` (the stat rows), `p{k}-bar`, `p{k}-pct`,
`p{k}-win-row/-win/-win-pct`); it rebuilds only when the seat count changes and builds 2
cards at load. `Hud.render(state, hooks, model)` writes round label, turn box
(`.turn-box p<k> [busy]`), `#board` classes `turn-p<k>` / `over`, turn name/hint, and per
player the stat rows, the bar and `leading`/`active`; `#game-box` (rows `#game-stat-<j>`,
class `hot`) when the model has a `box`, else hidden; `#mini-line2`. The model comes from
`view.hud(state)`:

```
{ round: "Round 3",                                   // sign subtitle / phone round label
  players: [{ stats: [[label, value], …], bar: 0..1, barText, leading }],   // one per seat, any number of stats
  box?: { stats: [[label, value], …], hot? },        // an extra info box (chain: chain counters; first value highlighted)
  line2?: "text" | [[label, value], …],             // second line of the phone turn box (values bold)
  drawHint?: "no space left" }                       // under "Draw" when the game is drawn
```

`Hud.overlay(name, winner, sub)` fills the result overlay. Player stat rows get ids
`p{k}-stat-<j>` (tests read them). The win bars are not part of the model: `WinChance`
writes them itself (see Board / HUD layout rules).

### Game records (replay-ready)

A game is fully described by its **record** `{ game, config, history, outs }` (+ `over,
winner, why` once finished; `Match.record()` adds `gameNo` and `clocks`). `config` carries
`n`, `players`, `startPlayer` and the game's own keys. `Rules.replay(record, ply)` (=
`Games.positionAt`) rebuilds the position after any number of moves without the DOM;
`engine.newGame(config, hooks)` + `engine.replay(history.slice(0, ply), outs)` shows it on
the board. The session (`Session`) and the `sync` message are that record. The replay bar
(#38) is exactly that: `engine.preview(ply)` renders `Rules.replay(record(), ply)` as a
**view-only** position next to the untouched live game.
Rule: **anything that changes the position must be a history entry or an `outs` entry**
(never a side channel), and `Rules.step` must stay the single way a move is resolved.

## Chain React rules (agreed with the owner; `chain-rules.js`)

- Players alternate. A move = one piece in an empty cell or one you own.
- Cell capacity = orthogonal neighbours: corner 2, edge 3, inner 4. `count >= cap` →
  the cell explodes: loses `cap` pieces (empty → unowned), gives one to each neighbour,
  converting them to the mover's colour.
- Waves: all full cells explode together (`readyCells` → `detonate`, which also counts
  the chain), all landings apply (`land`), repeat. `settle` does that instantly; the view
  interleaves the same steps with animation. The loop stops when nothing is full, when
  the board is decided (`boardDecided`: everyone has moved and ≤ 1 owner is left — it
  would loop forever otherwise) or when the chain rule is reached.
- `conclude`: chain rule win → "Chain reaction of N explosions!"; else once everyone has
  moved and only one player is `alive` (owns a cell, or hasn't moved yet; never a
  `state.out` player) → that player wins "Took over the whole board!"; else `Rules.pass`
  (eliminated players are skipped — a player who lost every cell with 3+ players, and
  `out` players).
- Clock pauses during animations and while somebody is away; flag fall = loss (with 3+
  players: out, the others play on — `Rules.remaining`, `Engine.eliminate`).

### Visual layout (`chain.js`, matches the 2015 screenshot)
Each cell is a 3×3 block: corners glass, centre glass when empty / owner's block when
owned, **lamps only on sides that have a neighbour** (glass otherwise). Lit lamps =
piece count. Cells sit on an obsidian gap; `--gap-f`/`--pad-f` in block units: mobile
gap 0.5 / rim 0, desktop (`min-width: 900px and min-aspect-ratio: 1/1`) gap 1 / rim 1
(owner: thinner only on mobile).

### Explosion animation (owner loves it — don't dumb it down)
`ChainView.animateMove` per wave: 1. **prime** (`.prime`, full cells blink like lit TNT,
`speed*0.6`) → 2. **blast** (`.boom` flash + ring, `#board.shake`, 16 debris sparks via
Web Animations API in `spawnDebris`) → 3. **fly** (`.fly` sprites arc with rotation,
`speed*1.25`) → 4. **land** (`.land` pulse) + `speed*0.35` pause. Speed comes from
`config.speed` (view state, not rules) and is also set as `--speed`. The tuning is
approved ("wuchtiger" like TNT).

## Five Wins rules (`five-rules.js`)

n×n board (default 11×11). Place on any empty cell. `winLen` **or more** in a row (4
directions) wins; winning stones get `.win` + `--k` and jump in a wave (`stone-jump`,
the MC blocks jumping). Draw (`winner -1`, overlay "Draw!"): a full board ("The board
is full."), or — #18 — a **dead board**: after every move `conclude` checks
`canWin(state, p)` for every player still in (`Rules.remaining`) — a window of `winLen`
cells in one of the 4 directions holding only that player's stones or empties; none for
anybody → "No line can be completed any more." (O(cells × 4 × winLen), pure and
deterministic, so online clients and `replay` agree; the puzzle solver mirrors it as
`Board.dead()`). With 3–4 players the turn
rotates (`Rules.pass`) and the first line wins; when everyone else is `out` the last
player wins ("Everyone else is out."). HUD: stones placed, best row
as the bar. **Yavalath rule** (`config.yavalath`, its settings row named after what it does, "Lose when N-1 in a row", summary "N in a
row loses"): a stone whose longest line is exactly `winLen - 1` loses for its owner unless
it also made `winLen` (the losing line is shown as `winLine`); with two players the other
one wins ("3 in a row loses!"), with three or four the loser is `state.dead[p]` (the rules'
own alive list for `Rules.pass` / `Rules.remaining`, exposed as `FiveRules.alive(state)`;
eliminations inside the rules, not `outs`) and the last one standing wins. The HUD shows
"Out · 3 in a row" on a dead seat. **Sensei plays the rule**: its board records the
"suicide cells" per line and player, the move generator drops them, a forced block on one
of them is a terminal loss and the VCF/VCT threat searches use exactly that as the winning
idea ("you must block, and the block makes three"). It is benchmarked and calibrated for
the rule separately (`variants.yavalath` in its `benchmark.js`, its own proven puzzle set
`tests/puzzles/five-yavalath`), so `Bots.botFor("five", cfg)` and `Bots.estimator("five",
cfg)` pick Sensei with the variant's numbers. MC skins: quartz tiles on obsidian, diamond/gold blocks as stones; hover
keeps the texture (no background transition on textured tiles — a flicker bug once).

## Isolation rules (`isolation-rules.js`)

The pen-and-paper Isola. n×n tiles (5–12, default 7), one pawn per seat. Start positions:
the middle of the top edge (seat 0), of the bottom edge (1), of the left edge (2) and of the
right edge (3), so 2, 3 and 4 players all start symmetrically.

- A turn is **two steps that count as one move**: step onto one of the up to 8 neighbouring
  tiles that still exists and is free, then break any remaining tile nobody stands on (the
  tile you just left included, and not necessarily near you).
- Both steps are **one integer** so history, `sync`, the session, the record, the replay bar
  and `Rules.replay` need no change: `move = to * (n * n) + removed`
  (`IsolationRules.encode/decode`). `cells[i]` holds everything: `-2` = broken (a hole),
  `-1` = a free tile, `>= 0` = the tile that seat's pawn stands on; `state.pawns[p]` is the
  same information indexed by seat.
- Whoever **cannot step when their turn comes** is trapped and out. That is decided in
  `conclude` (never earlier: being locked in on somebody else's turn means nothing), inside
  the rules like five's Yavalath rule: `state.trapped[p]` is the rules' own alive list for
  `Rules.pass` / `Rules.remaining`, not an `outs` entry. With two players that ends the game
  ("Trapped!"), with three or four the rest play on and the last one standing wins
  ("Everyone else is trapped."). There are no draws.
- HUD: moves played and the pawn's current mobility ("Free moves", the bar out of 8, "trapped"
  on a seat that is out); `line2` = "free moves 5 · 3"; the overlay says how many moves.
  `estimate` (until the bot answers) compares Voronoi territory and mobility.
- The view owns the **two-step click** (`IsolationView`): the first click on a tile the engine
  marked `can-place` (via `IsolationRules.canPlay`) becomes `.pending` and lights every
  breakable tile in red, the second one submits `onClick(to * cells + removed)`, a click on the
  pending tile takes it back, anything else does nothing. The overlay is painted by the view
  alone (it remembers what the engine last painted per cell and restores it), so nothing of
  the framework knows about it. `animateMove` slides the pawn from `state.lastFrom` (Web
  Animations) and drops the broken tile away (`.dropping`, 300 ms).
- Premoves are off for this game (`premove: false` in the definition, honoured by `Match`):
  one click is not a move here.
- Board: `.slab` per tile (the element is the pit, `::before` the tile face, `::after` the
  highlight ring, `i.pawn` the pawn), so a broken tile really looks like a hole. Blocks looks:
  quartz tiles on obsidian, the seat's block as the pawn.
- Learn (#41): `howto` in the definition brings the rule bullets and a four-step tutorial on a
  5×5 board (step, break near the other pawn, spring the trap); its `expect` lists whole
  encoded moves and every step names its own `highlight` cells. The scenarios come from the
  puzzle set through `npm run learn:scenarios`.

## Dots and Boxes rules (`boxes-rules.js`)

The school-exercise-book game (Käsekästchen in German, renamed for the UI on 2026-09-11;
the key stays `boxes`). n × n boxes (the shared *Board size* row, 2–10,
default 5), so (n+1)² dots and **2n(n+1) lines** — and the lines are the cells:
`state.cells` is one entry per line (the owner who drew it, -1 = not drawn, so `ownerOf`
colours it), while `state.n` is the boxes per side. Nothing in the framework assumes
`cells.length === n * n` (the engine only compares `cells.length` with its element list, and
`--n` is set from `state.n`), which is why a game whose cells are not a square grid needs no
framework change beyond the `renderBoard` hook.

**Line numbering (binding for history, sync, replay, the record and the puzzle sets):** the
n(n+1) horizontal lines first, row-major — `h(r, c) = r * n + c`, r = 0…n (dot rows),
c = 0…n-1 — then the n(n+1) vertical ones — `v(r, c) = n(n+1) + r * (n+1) + c`, r = 0…n-1,
c = 0…n. Box `r * n + c` is closed by `h(r,c)`, `h(r+1,c)`, `v(r,c)` and `v(r,c+1)`
(`BoxesRules.edgesOf(n, b)` / `boxesOf(n, e)`).

- A move draws one undrawn line. Every box whose fourth side it draws goes to the mover
  (one line can close two), `state.boxes[b]` = the owner, `state.scores[p]` counts them and
  `state.lastBoxes` remembers what the last move closed (the view pops them).
- **Closing at least one box means another turn**: `settle` sets `state.again` and `conclude`
  returns `null` **without** `Rules.pass`, so the same seat is still `state.current`. Only a
  move that closes nothing passes the turn (`Rules.pass`, which skips `out` seats).
- The game runs until **every line is drawn**: most boxes wins ("12 boxes!"), a tie for the
  most is a draw (`winner -1`, "Tied!", HUD hint "same number of boxes"). Nothing ends early,
  even when the result is already decided (the owner's school rules); the win chance is
  allowed to show 100 % there because the bot proves it.
- 2 to 4 players, nobody is eliminated by the rules; a flag fall uses the generic
  `state.out` path and an `out` seat cannot win the count.
- Analysis helpers the bots and the win chance build on (pure, in the rules module):
  `sides(state, b)`, `captures(state, e)`, `capturingMoves`, `safeMoves` (lines that leave no
  box on three sides), `isFreeCapture` (a capture that hands nothing over) and
  `chainFrom(state, b)` (the run of boxes hanging off a capturable one, `{ boxes, loop }`).
- `estimate` (the fallback win chance): boxes won plus who is under pressure (a player to
  move with no safe line has to open something).
- **Learn** (#41): `howto.rules` plus a five-step lesson on a 2 × 2 board (draw a line, keep
  building, play a safe line, close the box you were given, notice that it is still your
  turn); the scenarios are generated from the proven puzzle set, and its tags
  (`take-box`, `sacrifice`, `double-deal`, `safe-move`) are in `pick-scenarios.mjs`'s
  `TAGS` list with the titles a player reads.

### View (`boxes.js`)
One CSS grid of (2n+1) × (2n+1) tracks: thin `--bx-line` tracks for the dot rows/columns,
wide `--bx-cell` (5 × line) tracks for the boxes, `--bx-pad` rim, all from `--board` and
`--n`. The DOM order is dots, then boxes, then the lines, so the lines sit on top and
`#board > .edge` is in line-index order (the e2e harness clicks by index). `.edge.h` /
`.edge.v` carry a `::before` that widens the hit area **across** the bar (percentages resolve
against the element, so it never grows along its length) — that is what makes a line easy to
tap on a phone. `animateMove`: `.ink` draws the line in, then `settle`, then `.won` pops each
closed box; the Bus event `boxes:capture` goes out for the sound. The boxes are not cells, so
they are painted by **`view.renderBoard(state)`**, the one hook this game added to the engine.
HUD model: per seat "Boxes" / "Lines" with the bar = boxes / n², an info box
("Boxes left" / "On the table", `hot` while a box is capturable), `line2` "boxes 3 · 2",
`summary` "13 of 25 boxes". Blocks looks: quartz dots, the player's block texture tiled along
a drawn line, the matching stained glass as a closed box.

## Board / HUD layout rules

- **Whose turn**: `#board.turn-p<k>` → 4px outline in the active colour. `fitBoard`
  subtracts 10px so the outline is never clipped on a full-width phone board.
- **Win chance** (`client/winchance.js`, an observer — no engine or game code involved):
  every player card has a `.win-bar` ("62 % win"). On `game:new` WinChance picks
  `Bots.estimator(game, config)` when the game has two players → `{ bot, stages, at(state, nodes) }`:
  the strongest registered bot that offers `evaluate(state, tools)` (a RAW score from
  player 0's view, ±Infinity when decided, deterministic for a node budget, may be async)
  mapped through the bot's **calibration** (`Bots.calibration(id, { scale, shift, brier,
  swing, … })` in its benchmark.js, fitted from seeded self-play by `scripts/calibrate.mjs`
  = `npm run calibrate`, also run by the benchmark; a series may say `symmetric: true`, which
  fits the samples together with their mirrors so an evaluator that negates when the seats are
  swapped maps raw 0 to exactly 50 %; `Bots.toProbability` clamps to
  0.5–99.5 %, only decided positions show 100/0); else the rules module's `estimate`
  heuristic. On every `game:position` (a settled position: new game, move settled, replay,
  elimination, end — **never during an animation**) it runs the stages of
  `Bots.ESTIMATE_STAGES` node budgets (2 000 quick + 12 000 + 60 000 in the background,
  stopped after 5 s or when the next position comes) so the bar shows a number at once and
  refines it; node budgets, not wall-clock, so both online clients see the same values (a
  slow phone just shows them later). Display **smoothing**: a new value is blended with a
  third of the previous move's value, except when either is ≥ 90 % or ≤ 10 % and never
  once the game is over (owner: "a four in a row may show 99 %"). Phones show only the
  win bar (`#hut .stat-bar` hidden), desktop shows the game's stat bar and the win bar.
  Rows are hidden with 3–4 players. Tests: `tests/unit/winchance.test.mjs`, `calibrate.test.mjs`.
- **Premove** (#37): the premoved cell gets the class `premove` (from `hooks.cellClass`) →
  `#board > .premove` in `game.css`: a dashed outline of `--premove-w` (2–4 px with the
  board size) inset into the cell, in `--premove` = my seat's colour, which `Match` writes
  on `#board` when a game starts or a seat changes. Static (owner: no marker animation);
  on the textured looks `skin-mc.css` adds a dark inset backing so the dashes read on
  quartz and glass (it is hidden behind chain's tiles, where the outline alone carries).
- **Last move**: every cell has a `.last-marker` child; the engine adds `.last` to the
  newest history cell. Chain: static thin white border at the cell edge. Five and Isolation: static
  white ring, **red** on the textured skins (white is invisible on quartz); for Isolation the
  engine asks the rules' `cellOf` where the move happened (the tile stepped onto). Owner: no marker
  animation. Hidden while a chain cell primes/booms and once the game is over
  (`#board.over`).
- Board size = min(wrapper width, height) − 10 → `--board` (`fitBoard` in app.js, on
  resize and when `#hut` resizes). The page must **never scroll** on mobile: the HUD sits
  below the board in a compact two-row form (controls behind ☰); desktop shows the full
  HUD beside the board (sign, stats, game box, log, controls). `.players` is a 2-column
  grid, so 3–4 seats make two rows (the board shrinks accordingly on phones).
  `body.game-<key>` lets CSS target one game; `#board` gets the game key as class.

## Events (`Bus`)

Fire-and-forget notifications for observers (WinChance, Sound, BotPersona subscribe here;
the log emits too so a chat could mirror it). Current events and payloads (`game` = the
game key everywhere):
`game:new {game, config, state}`, `game:move {game, cell, player}` (a piece was placed,
before its animation), `game:position {game, state}` (**the settled position changed**:
new game, a move settled, replay, elimination, end — the one event a position observer
needs), `game:turn {game, player, state}` (after a move settled and the turn **passed to somebody
else**; not on replay, and not when a game leaves the mover on turn), `game:finish {game, winner, why, state}`, `chain:prime {cells, player, ms}`
(full cells start blinking; `ms` = how long), `chain:explode {cells, player, chain}` (one
wave), `boxes:capture {boxes, player, score}` (Dots and Boxes: a move closed one or two boxes),
`reaction {emoji, theirs}`, `chat {text, from, mine}` (a chat line was shown),
`log {text, cls}`. A game may add its own events (`<key>:…`) for sounds and observers.

## Seats, bots and more players (`client/match.js`)

`Match.seats[p] = { kind }` is built per game by `makeSeats`: `local` (this device moves for
it), `remote` (a friend) or `bot`. The engine hooks live in Match: `mayPlay(p)` = local seat
+ `live()`; `onTurn(p)` calls `botTurn(p)` for a bot seat: after `THINK_MS` (350 ms, so it
doesn't feel instant) it asks the bot instance for a move on a **clone** of the state,
re-checks that the same game is still on that turn (`running`, `gameNo`, busy, over), falls
back to a random legal move if the bot throws or answers illegally, then `engine.play(i)`
like a click. **Names (#35)**: `Match.init({ names })` gets the seat names from app.js
(`Room.names()` online, `Prefs.seatNames()` offline) and `Match.names` shows "Bot"
(`Opponent.NAME`) on a bot seat — in a room on every device, not only on the one running it
(#36: `Room.names()` names the room's bot seat too, `Match.refreshSeats()` rebuilds the seats
and the instance when hosting changes, `hostsBot()` says whether this device runs it).
Player count is
`config.players` (2–4 from the settings; 2 against a bot): rules, `Rules.pass`, `Clock`,
HUD and lobby cards are written for N, the CSS has colours and textures for 4 seats, the
host relays. "Play on this device" with 3–4 people = all seats `local`; a flag fall
eliminates the seat (`Match.flagged(p)` → `engine.eliminate`), with two players it ends
the game as before.

**Premoves (#37, `Match.premove`)** exist only where somebody else moves in between: this
device holds exactly one `local` seat (`mySeat()`), so against a bot or online with a seat,
never in local multiplayer, never for a spectator and never for a game whose definition says
`premove: false` (Isolation, where a move takes two clicks). A click while a non-local seat is to
move does not fall through any more: `onCellClick` remembers the cell (the same cell takes
it back, another one moves it, no legality check yet), `hooks.cellClass` marks it and
`turnHint` appends " · premove set". When `onTurn` names my seat, `firePremove` clears it
and plays it through the very same path as a click (`onLocalMove` + `Game.play`, so the
room, the session and the sounds see no difference) unless the position moved on: over,
busy, not my turn any more, not `mayPlay` or no longer legal, in which case it is dropped.
It is deferred with `whenIdle(…, "premove")`, and cleared on a new game, `stop()`,
`reset()`, a seat change and the end of a game. Nothing about it travels to the room.

**Fair play while the clock is paused (#43 follow-up, 2026-09-11):** in a **timed online
game**, a connection problem stops the clocks for everyone (`live()` → `syncClock`), so the
position is hidden as long as it lasts — otherwise the player whose connection dropped
keeps thinking for free. `Match.syncClock()` toggles `body.board-covered` (`covered()`:
running, not over, online, I hold a seat, `Clock.isEnabled()`, not `live()`); `game.css`
blurs `#board` and shows `#board-cover` ("The board is hidden while the clock is paused.").
Without a timer nothing is covered (there is nothing to gain), and a spectator, a replay and
a lesson never are. Nothing about the state changes: it is one class over the board.

`Match.whenIdle(fn, key?)` runs `fn` now if no move animates, else once the engine is idle
(a key replaces an older entry with the same key): Room defers a `sync` there, flag falls
are deferred there, and `onIdle()` (Room drains its move queue) runs after the deferred work.
`Match.start(cfg, gameNo)` / `watch(record)` / `stop()` / `reset(mode, me, spectator)` /
`setSeat(me, spectator)` / `record()` / `syncClock()` are what app.js and Room call.
`watch(record)` is the replay viewer's table (#42): mode `replay`, seats all `watch`, clock
off, no bot, the record replayed instantly onto the board.

## Lessons learned

- **A move that keeps the mover on turn changes framework assumptions, not the framework.**
  Dots and Boxes (a closed box means another turn) needed exactly three small things: a
  `view.renderBoard` hook for board parts that are not cells, `game:turn` only when the turn
  really changed hands (otherwise every captured box played the "your turn" ping and woke the
  persona), and its own board sizes in `size.presets`. Everything else — rooms, sync,
  replay, premoves, clocks, spectators, the HUD — worked unchanged, including a board whose
  `cells.length` is 2n(n+1) rather than n².

# How to add a new game (step by step)

A game is three files (pure rules, view + registration, CSS) plus two tags in
`index.html`, and usually a bot folder. Everything else is the framework and is generic:
rooms and the host relay for 2–4 seats, lobby sync of the settings, start / rematch /
back to room, reconnect + replay from the game record, session restore, the chess
clock and flag falls, spectators, chat, reactions, premoves, the replay bar, the replay list
and replay files, the replay analysis (a game with a bot and an `estimate` gets win chances,
best moves and scores for nothing), sounds for the generic events,
the bot seat, the bot persona, the win-chance bars, the generic HUD (stat rows, info box,
phone line), skins and player colours, the picker card, the settings rows, the Learn
section (rules page, tutorial runner, scenarios), the benchmark and puzzle tooling. **A game never touches app.js, room.js, match.js, games.js, settings.js
or index.html's HUD markup.** If it seems to need to, extend the definition contract
instead (and this file).

Copy Five Wins (`five-rules.js`, `five.js`, `five.css`, `random-five`, `sensei-five`) — it
is the smallest complete game. Isolation is the example of a game whose move is not a plain
cell id (an encoded integer, two clicks, `cellOf` / `canPlay` / `premove: false`).

## 1. Rules `client/games/<key>-rules.js` (pure — no DOM, no settings, no Bus)

Expose a global `<Name>Rules` with these functions and register it (`Rules.register("<key>", <Name>Rules)`):

| Function | Contract |
| --- | --- |
| `create(config, base)` | Return `Object.assign(base, { cells, …your keys })`. `base` comes from `Rules.base(config)` (n, players, current, round, history, movesBy, out, outs, busy, over, winner, finishWhy). Read your own keys from `config` (they arrive from `Settings.read()` on both sides, plus `startPlayer`). |
| `ownerOf(state, i)` | Owner of cell i (-1 = none). Drives the shared `p<k>`/`taken` classes. |
| `isLegal(state, i, player)` | Pure; `false` when `state.over`. |
| `legalMoves(state, player)` | Array of cell ids (bots, tests, the random fallback). |
| `place(state, i, player)` | Apply the move: `history.push(i)`, `movesBy[player]++`, your board change. |
| `settle(state, player)` | Resolve everything that follows a placement instantly (chain waves; no-op for five). |
| `conclude(state, player)` | Return `{ winner, why }` (winner -1 = draw) or `Rules.pass(state[, alive])` and return `null`. Respect `state.out` (eliminated seats): use `Rules.remaining(state)` / `Rules.pass`, which skip them; with 3–4 players decide what "everyone else is out" means (five: the last one wins). |
| `estimate(state)` | Optional heuristic P(player 0 wins) in 0..1 for the win chance until a bot offers `evaluate` (see step 6). |
| `cellOf(state, move)` | Optional. The board cell a move belongs to, when a move packs more than a cell id into its integer (Isolation: `to * cells + removed` → `to`). The engine uses it for the `last` marker and exposes it as `engine.cellOf`, which is how `Match` marks a premove. Default: the move itself. |
| `canPlay(state, i, player)` | Optional. May this player *start* a move on cell `i`? Drives `can-place` / `locked`, so a game whose move needs two clicks still highlights the right cells. Default: `isLegal`. |

`Rules.step(rules, state, i)` = place + settle + conclude is the **only** way any
framework code resolves a move (engine replay, bots' `tools.apply`, playout, puzzle
runner, calibration, a future replay viewer), so keep the three functions pure and
deterministic and never resolve anything outside them. A move must be a single integer
(encode from/to as `from * n*n + to` if needed): `move`, `sync`, the session and the
record assume `history` is an array of numbers. The cells need not be an n × n grid at all —
Dots and Boxes's cells are the 2n(n+1) lines between the dots while `state.n` stays the boxes
per side — as long as `state.cells` is one entry per playable move. Player numbers are 0…players-1;
names come from the players (Prefs / the room), colours from the seat number. **Must work for 2, 3 and 4 players** (rotation via
`Rules.pass`, eliminations via `state.out`) — the *Players* setting applies to every game.

## 2. View + registration `client/games/<key>.js`

Expose `<Name>View` with:

| Function | Contract |
| --- | --- |
| `build(board, state, config, onClick)` | Create one element per cell inside `board` (append a `<div class="last-marker">` child to each), wire `click → onClick(i)`, return the element array. Set CSS vars you need (chain sets `--speed`). |
| `renderCell(el, state, i)` | Game-specific classes only (the engine already set `p<k>`, `taken`, `last`, `can-place`, `locked`). |
| `renderBoard(state)` | **Optional.** Called once per render, after every cell: paint the parts of the board that are not cells (Dots and Boxes's boxes; its cells are the lines). It gets the *shown* position, so a replay-bar preview is painted too. |
| `hud(state)` | **Data only** — return the HUD model, the framework renders it: `{ round: "Move 3", players: [{ stats: [[label, value], …], bar: 0..1, barText, leading }], box?: { stats: [[label, value], …], hot? }, line2?: "text" | [[label, value], …], drawHint? }`. One `players` entry per seat (`state.players`, 2–4). `box` is an extra info box on desktop (chain's chain counters); `line2` the phone turn box's second line. Never write DOM here. |
| `summary(state)` | Second line of the result overlay ("12 moves"). |
| `animateMove(ctx, i, player) → Promise` | Show the move. `ctx` gives `state`, `cells`, `board()`, `names()`, `renderCell(i)`, `renderHud()`, `render()`. Use the rules' own step functions for anything that changes state so the instant path (`settle`) stays identical. Return early if `state.over` after an `await`. Emit your own `Bus` events (`<key>:…`) for sounds / observers. |

Then register:

```js
const <Name>Game = Games.register({
    key: "<key>", title: "Nice Name",
    tagline: "One sentence under the picker.", desc: "Short card subtitle",
    preview: "...01....",                   // 9 chars: "." empty, digit = player, "#" hole, a/b/c (A/B/C) = 1..3 pieces of player 0 (1); Games.previewClass / previewTile draw it everywhere
    size: { min: 5, max: 19, default: 9 },  // board-size input limits
    size: { min: 5, max: 19, default: 9, presets: [5, 7, 9, 11] },   // `presets` fills the board-size dropdown
    minSize: (cfg) => 5,                    // optional, may depend on the game fields (five: winLen)
    players: { min: 2, max: 4 },            // optional (default 2–4): the picker grays the card out otherwise (#28)
    premove: false,                         // optional (default true): off when one click is not a whole move (#37)
    settings: [                             // the game's rows in #settings-modal, built by settings.js
        // every control is a dropdown: presets, "Off" where it applies, and "Custom…" with a number row
        { key: "winLen", label: "In a row to win", type: "preset", presets: [3, 4, 5, 6], def: 5, min: 3, max: 25, customLabel: "Custom stones (3–25)" },
        { key: "speed", label: "Animation speed", type: "select", def: 750, options: [[1100, "Slow"], [750, "Normal"]] },
        { key: "rule", label: "Optional rule", type: "bool", def: false },                 // an Off / On dropdown
        { key: "ruleN", flag: "rule", label: "Win on N", type: "preset", off: "Off", startOff: true, presets: [10, 15], suffix: " x", def: 15, min: 1, max: 99 },
    ],
    describeRules: (cfg) => [],             // optional summary parts before the timer ("5 in a row")
    describeOptions: (cfg) => [],           // optional summary parts after the timer ("15-chain wins")
    howto: { rules: [], tutorial: [], scenarios: [] },   // the Learn data (#41), see step 7
    rules: <Name>Rules, view: <Name>View,
});
```

The picker card, the settings rows (`#row-<key>` / `#set-<key>`, lowercased) and the
config keys (`config.<key>` on both sides of a room, persisted per device) all come from
this entry — no HTML to add. `.game-picker` is a fixed `1fr 1fr` grid, so the four games
today fill exactly two rows; what buys the room on a phone is the lobby's own media query
(`max-width: 899px` in `menu.css`: a tighter `.lobby-card`, `.lobby-card .game-card` padding
8 px, a 56 px preview and the `.game-players` line hidden) and `.game-name` never wrapping
(a second line makes the whole row of cards taller; a name too long for a card is cut with
an ellipsis instead, checked by `mobile.test.mjs`). A fifth game adds a third row, so
re-check the phone lobby every time.

**Beyond six games the picker has to change shape** (thought through on 2026-09-11, when the
lobby was rebuilt; nothing to do yet): a grid of cards does not survive eight or more. The
plan, in the order it should happen:
1. **The lobby stops being the picker.** The Game section shows the *chosen* game as one row
   (its tile, its name, a chevron) like How to play and Settings; tapping it opens a picker
   modal. The lobby then has a constant height whatever the catalogue does, and the modal is
   free to be as long as it likes and to scroll.
2. **The picker modal sorts itself**: the games this device played most recently first (the
   replay store already knows), then the rest. A search field once the list passes a screen.
   The player-count filter stays what it is (a game that does not take the chosen count is
   grayed out, #28).
3. **Sections, not one flat list**, if the catalogue grows in kinds rather than in number:
   "Place and line up" (Five Wins), "Take the board" (Chain React), "Trap and block"
   (Isolation, Dots and Boxes). A game names its own section in its definition, exactly the way
   it names its settings rows today, so nothing above the definition learns about games.
4. **The learn list and the replays filter follow for free**: both build themselves from
   `Games.keys()` and `Games.previewTile`, so they only need the same sort and search.
What must not happen: game-specific code above the definition (`if (game === "chain")`), a
second place that lists games, or a lobby whose height depends on the catalogue.

## 3. CSS `client/games/<key>.css`

`#board.<key>` grid (see `#board.five`) using `--board` and `--n`; your cell classes
(five uses `.stone`, chain `.cell` + `.tile`). Colours via `var(--pc)`, `var(--pc-dark)`,
`var(--block)` on `.taken` cells — never a seat number (four seats have colours and
textures already). Then the textured-skin rules under `:is(.skin-mc, .skin-mcboard)`
(textures via `var(--tex-p)`, no rounded corners, `image-rendering: pixelated`, **no
background transitions on textured tiles**). New texture: extract from
`~/.minecraft/versions/1.12.2/1.12.2.jar` (`assets/minecraft/textures/blocks/<name>.png`,
16×16) into `client/textures/` and add a `--tex-<x>` var in `skin-mc.css`. Game-specific
HUD styling (rare) goes under `body.game-<key> …`.

## 4. Tags in `index.html`

`<link rel="stylesheet" href="client/games/<key>.css">` after `five.css`;
`<script src="client/games/<key>-rules.js">` and `<script src="client/games/<key>.js">`
after the last game and before `bots.js` (and add the rules module to the tuple
`scripts/headless.mjs` returns, plus a `CONFIGS` entry in `tests/unit/bots.test.mjs` so the
bot conformance suite knows what board to use). Build, the unit-test loader and the headless loader
(`scripts/headless.mjs` matches `games/<key>-rules.js`) pick them up from there. Once the
game has generated Learn scenarios (step 7), one more tag:
`<script src="client/learn/<key>-scenarios.js">` next to the other scenario files.

## 5. Sounds (optional)

The generic events (`game:move`, `game:turn`, `game:finish`, reactions, chat) already
sound. For your own events add a case to `Sound.map` (event → cue), a synthesized cue to
`SYNTH`, a file to `Sound.FILES` for the Blocks set and a category in `Prefs.CATEGORIES`
only if none fits. Keep `Sound.map` pure (it is unit-tested with a fake player).

## 6. A bot (expected for every game — the win chance and "Against a bot" depend on it)

1. `client/bots/random-<key>/bot.js` (copy `random-five`, change `game`) — the benchmark
   baseline; add `"random-<key>"` to `BASELINE` and a series to `SERIES` in
   `scripts/benchmark.mjs`, and a series in `scripts/calibrate.mjs` (pick a board where
   plenty of positions are still *undecided*, or the calibration has nothing finite to fit).
2. A real bot `client/bots/<name>-<key>/bot.js` with difficulties (easy → very strong,
   node budgets `nodes` ≤ 1 000 000, phone-friendly: a second or two on a slow phone at
   the top level) and, ideally, `evaluate(state, tools)` — a raw score
   from player 0's view, deterministic per node budget, ±Infinity when decided. With it the
   win-chance bars use the bot (calibrated by the benchmark); without it the rules'
   `estimate` heuristic is used. See `docs/bots.md` for the toolset, the contract and the
   evaluator design guide (horizon effects, calibration, quiescence).
3. Tags after a new `<!-- bots: <key> -->` anchor line in `index.html`, tests in the bot
   folder, `npm run benchmark <id>` → commit `benchmark.js`. One playable bot per game
   (#21): players just see "Bot"; until it exists `Bots.botFor` offers the Random baseline
   (`baseline: true`, no benchmark file, never shown by name).
4. Puzzles (optional but valuable): `scripts/puzzles/<key>/solver.mjs` + `generate.mjs`
   → `tests/puzzles/<key>/puzzles.json` (≥ 100 proven positions), a README with the guarantee
   and the limits, `tests/puzzles/<key>/solver.test.mjs`, the generator in the `puzzles` npm
   script and a per-game branch in `scripts/puzzles/verify.mjs` if the generic tactical tags
   do not fit; `tests/unit/puzzles.test.mjs`
   picks the set up and grades every bot. Never make a threshold a build requirement.

## 7. Learn: rules, tutorial and scenarios (`howto` in the definition, #41)

The Learn section renders itself from the definition, so this is data only. Without a
`howto` the game simply does not appear in Learn (and "How to play" in the lobby is empty),
which is a poor first impression — write at least the rule bullets.

```js
howto: {
    // one short sentence per rule; they show on the details page and in the lobby modal
    rules: ["Players take turns…", "…", "…"],
    // a guided lesson on a real board; the first step names the config, later steps inherit it
    tutorial: [
        { config: { n: 4, speed: 350 }, moves: [], text: "Click the top left corner.", expect: [0] },
        { moves: [0], text: "Now the other colour: the far corner.", expect: [15] },
        { moves: [0, 15, 0], text: "It burst. Here is why…" },          // no `expect` = a Next button
    ],
    // optional hand-written training positions; `best` must really be the optimal moves
    scenarios: [{ id: "<key>-intro", title: "…", text: "…", config: { n: 9 }, history: [], toMove: 0, best: [40], tags: ["opening"] }],
}
```

Rules for the data (`tests/unit/learn.test.mjs` checks all of it): every step's `moves`
must be a legal sequence from an empty board, an `expect` cell must be legal for whoever is
to move there, `toMove` of a scenario is always 0 (you are seat 0, the bot seat 1), no em
dashes (#24). Missing settings are filled from the `settings` defaults, and `players: 2` /
`timer: 0` are forced, so a lesson config only names what matters.

Once the game has a puzzle set (step 6.4) **and** a bot, the whole ladder is generated:
`npm run learn:scenarios` builds ~22 scenarios per game in three tiers (Basics / Tactics /
Mastery), computes a difficulty per position, marks traps and turnarounds and adds one
"play from here" game per tier from seeded self-play, then writes
`scripts/learn/facts/<key>.json` (the measurements, committed, never deployed) and
`client/learn/<key>-scenarios.js`. Nothing in it is game specific: the greedy move comes
from the game's own `rules.estimate`, the levels from `Bots.botFor(<key>).difficulties`, the
self-play board from the biggest config in the puzzle set. Add the scenario file's
`<script>` tag to `index.html` next to the other ones and commit both files; the unit test
re-runs the pure selection stage and fails if the committed file is stale.
Hand-written scenarios still work and simply land in Basics (`tier`, `kind`, `difficulty`
are filled in), which is what a game without a puzzle set gets.

## 8. Checklist before calling it done

- Unit: rules in `tests/unit/rules.test.mjs` (no DOM; 2 and 3+ players, eliminations) and
  an engine spec like `five.test.mjs` (win, draw if possible, replay == play, HUD texts via
  `p{k}-stat-<j>`, win-chance rows for 2 players); a bot folder test; the conformance
  suite in `bots.test.mjs` passes for every difficulty.
- `Rules.replay` of the engine's `record()` equals the live state (`framework.test.mjs`
  shows how) — this is what reconnects, refreshes and the future replay viewer rely on.
- Local: lobby → pick game → Start → play to a win **and** a draw → overlay text →
  Rematch → Back to room → switch to another game. Against a bot: the picker lists the bots.
- Online with two headless browsers (`tests/e2e/online.test.mjs`): guest sees the host's
  picker change; guest presses Start; moves sync both ways; guest refresh gets the board
  back via `replay`; both press Rematch; one presses Back to room. With three
  (`online-party.test.mjs`) if the game's rules depend on the player count.
- Timer on: clock pauses during your animations, flag fall ends the game on both sides
  (3+ players: the seat is out, play continues).
- Phone viewport 360×780: lobby, game and result overlay don't scroll; HUD labels fit;
  the game box (if any) shows only on desktop.
- All three skins: board readable, textures don't flicker on hover.
- Learn: the game shows up in the Learn list, the rule bullets read well, the tutorial runs
  from the first step to the last and `tests/unit/learn.test.mjs` passes; `npm run
  learn:scenarios` once the puzzle set exists.
- No `Runtime.exceptionThrown` in either browser. Update this file (files table, rules
  section for the game, events if you added any), `README.md`, `docs/bots.md` (bot list)
  and `changelog.json`.
