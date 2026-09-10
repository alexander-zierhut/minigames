# ALZlper's Minigames — agent context

Read this before touching anything. It describes how the site is built, the decisions
already made with the owner, the traps that cost time before, and a step-by-step guide
for adding a new game (the most likely future task). Keep it accurate: when you change
behaviour, protocol keys, files or events, update the matching section here.

## What this is

A static site with nostalgic two-player minigames the owner played on a Minecraft
server in 2015: **Chain React** and **Five Wins** (gomoku without gravity). Hosted as
plain files on Scaleway Object Storage at `https://minigames.alzlper.com/` (GitHub
`alexander-zierhut/minigames`, git remote `github`; the old `origin` points at the
owner's Gitea). The code must never assume that URL; share links are built from
`location.href`.

No framework, no backend, no bundler at development time. Vanilla JS in classic scripts
(not ES modules), each file an IIFE that defines exactly one global. The source runs
unbundled straight from `index.html` + `client/`; `build.mjs` concatenates for deploy.

Local dev: `npm run dev` (= `php -S 127.0.0.1:8000 -t .`; port 8080 is taken on the
owner's machine) or any static file server from the repo root.

## Files and load order

`index.html` lists the stylesheets and scripts; **build.mjs and the unit-test loader
read that list**, so adding a file = adding one tag there, nothing else to configure.

Scripts, in order (each defines the global named in brackets):

| File | Global | Role |
| --- | --- | --- |
| `client/vendor/peerjs.min.js` | `Peer` | PeerJS 1.5.4, vendored (no CDN at runtime) |
| `client/lib/util.js` | `Util` | `$`, `sleep`, `clamp`, `restartClass`, fail-safe storage `load/save/remove`, `fromTemplate`, `toast` |
| `client/lib/bus.js` | `Bus` | event bus `on/off/emit` (see Events) |
| `client/lib/log.js` | `Log` | the HUD event log (`add(text, cls)`, `clear()`, 6 lines) |
| `client/lib/clock.js` | `Clock` | chess clock for N players |
| `client/lib/net.js` | `Net` | PeerJS room transport |
| `client/lib/preload.js` | `Preload` | first-visit texture preload with `#loader` bar |
| `client/games/rules.js` | `Rules` | base state + turn passing shared by all rules modules |
| `client/games.js` | `Games`, `Engine`, `Hud` | registry, the engine shell every game shares, HUD renderer |
| `client/games/chain-rules.js` | `ChainRules` | Chain React rules, pure (no DOM) |
| `client/games/chain.js` | `ChainView`, `ChainGame` | Chain React board/animation/HUD numbers + registration |
| `client/games/five-rules.js` | `FiveRules` | Five Wins rules, pure |
| `client/games/five.js` | `FiveView`, `FiveGame` | Five Wins view + registration (smallest game: the template) |
| `client/bots.js` | `Bots` | bot registry, the toolset bots play with, headless playout |
| `client/bots/<id>/bot.js` | (registers) | one folder per bot: `bot.js`, generated `benchmark.js`, `bot.test.mjs` |
| `client/skins.js` | `Skins` | look per device: body class, player names |
| `client/settings.js` | `Settings` | settings form ↔ config, picker cards, persistence, summary |
| `client/opponent.js` | `Opponent` | bot picker modal (bot, difficulty, score), choice per game |
| `client/reactions.js` | `Reactions` | emoji reactions bar + floating layer |
| `client/app.js` | (none) | flow, room protocol, session restore, wiring, boot |

Stylesheets, in order: `client/css/base.css` (tokens, player colour variables, buttons,
inputs, modal, toast, loader) → `client/css/menu.css` (title, lobby, picker, settings)
→ `client/css/game.css` (game layout, generic board, HUD, overlay, banner, reactions)
→ `client/css/skin-mc.css` (Minecraft board part shared by both MC skins + Minecraft
UI part) → `client/games/chain.css` → `client/games/five.css` (each game's board,
classic first, then its MC-skin rules).

Other: `client/textures/*.png` — 16×16 Mojang block textures from the owner's own
1.12.2 jar (personal use; MC skins stay opt-in). Only textures referenced from CSS are
kept. `README.md` is the short public readme; `CLAUDE.md` just imports this file.
`server/` (a 2022 PHP stub) was deleted; don't bring it back.

## Build & deploy

- `npm run build` (= `node build.mjs`) writes `dist/`: `index.html` + `assets/app.<hash>.js`
  (all client scripts in `index.html` order, esbuild-minified when available) +
  `assets/main.<hash>.css` (all stylesheets concatenated, `../textures/x.png` rewritten
  to hashed names) + `assets/textures/<name>.<hash>.png` + the icon files. Hashes are
  content hashes → cache busting by filename. Env: `DIST_DIR`, `SKIP_MINIFY=1`.
- `.github/workflows/ci.yml`: job `test` (npm ci → unit → e2e) on push to `main`, PRs
  and manual; job `deploy` (`needs: test`, pushes to `main` only): build, `aws s3 sync`
  assets with `Cache-Control: public, max-age=31536000, immutable`, root files with
  1-day cache, `index.html` with `no-cache`, then `--delete` sync of stale files.
  Bucket `minigames.alzlper.com`, region `nl-ams`, endpoint `https://s3.nl-ams.scw.cloud`.
  Credentials: repo secrets `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` = non-expiring API key of
  IAM application `minigames-website` (id `300c3839-68e5-4fc9-9a66-9321af7ffe1e`, policy
  `minigames-website-policy` = ObjectStorageFullAccess on project `zierhut-p`
  829778ff…), same pattern as the owner's other sites. Bucket policy: owner user full
  access, that application full access, `*` GetObject. Website mode (index + error
  document `index.html`); DNS CNAME to `minigames.alzlper.com.s3-website.nl-ams.scw.cloud`.
- Branch protection on `main` requires the `test` check for PRs (admins not enforced,
  so the owner can push directly).

## Flow: title → room lobby → game (the "party" model)

One room, one link, the whole evening (owner's request after "we sent 3–4 links just
to try things").

- **Title** (`#screen-menu`): title "ALZlper's Minigames", section *Online* with
  `Create room` + `Join room` (`#join-panel` with the code field appears on Join room),
  section *Offline* with `Play on this device` and `Play against a bot`, and the global
  **Look** control. Never scrolls on a phone.
- **Lobby** (`#screen-lobby`), same screen for local and online (`app.mode`): room code +
  Share/Copy (online only), one `.lobby-player` card per seat from `#tpl-lobby-player`
  (online only), the game picker (one `.game-card[data-game]` per registered game, built
  by `Settings.init`), settings summary button → `#settings-modal`, Look control,
  `Start game`, `Leave room`/`Back`.
- **Game** (`#screen-game`): board + HUD ("hut"). Result overlay: `Rematch`, `Look at
  board` (hides it; `#result-fab` brings it back), `Change game` (→ lobby). The HUD has
  `Rematch` and `Back to room` too.
- `app.mode` ∈ `local | bot | online`. Bot mode is the offline lobby with an extra
  *Opponent* row (`#btn-opponent` → `#bot-modal`); clicking a game card there opens the
  picker for that game (`Settings.init({ onSelectGame })`). You are seat 0, the bot seat 1.
- `app.phase` ∈ `menu | lobby | game`; `app.gameNo` increments per started game (local
  too); `startPlayerFor(g) = (g - 1) % players` → seat 0 starts game 1, then alternate.

## Settings (`client/settings.js`)

Form in `#settings-modal` (opened from the lobby summary, closed by Done / backdrop;
number inputs are clamped on `change` and on close, never on `input`, so typing "12"
doesn't snap at "1"). Persisted in `localStorage["chainreact.settings"]` together with
`sizeFor` (remembered board size per game). Inputs have `autocomplete="off"` (Firefox
restores form values on reload).

- Shared rows: board size (limits from the game's `size` + optional `minSize(cfg)`),
  timer per player (Off default / 1 / 3 / 5 / 10 min / custom minutes).
- Game rows carry `data-setting="<key>"`; a row is shown when the selected game lists
  the key in its `settings` array. Today: `winLen` (five: 3–25, default 5, also the
  board's minimum), `speed` (chain: Slow 1100 / Normal 750 / Fast 350 ms), `chainRule`
  (chain: win on N explosions, off by default, N default 15; owner dislikes the rule but
  wanted it available). Game inputs are described once in `FIELDS`.
- `Settings.read()` returns the **config** a game starts with: `{ game, players: 2, n,
  timer, timerSel, timerCustom, winLen, speed, chainRule, chainLen }`. Engines get it as
  `config` (plus `startPlayer`) and read only what they need.
- Summary text: `n × n` · `describeRules(cfg)` parts · timer · `describeOptions(cfg)` parts
  (e.g. "7 × 7 · 5 in a row · 3 min timer", "4 × 4 · no timer · 15-chain wins").
- Any change → `onChange(config)` → app sends `lobby {s}` to the friend. `Settings.write`
  runs silently (no echo) when applying the friend's settings.
- The **look is not a setting** (see Skins).

## Skins (`client/skins.js`, per device)

`.skin-seg` control on the title screen and in the lobby (`Skins.init` wires both),
stored in `localStorage["chainreact.skin"]`, never sent to the friend, never in the
settings modal. The DOM is identical for every skin; a body class switches the CSS and
`Skins.names()` gives the player names.
- **Classic** (default, owner's favourite — don't touch its look): dark navy UI, cyan vs
  amber, rounded cells, lamps as dots. Names "Cyan"/"Amber" (seats 2/3: "Lime"/"Rose").
- **MC board** (`body.skin-mcboard`): classic UI, Minecraft textures on the board, flying
  pieces, sparks, HUD player blocks and picker previews. Names "Diamond"/"Gold".
- **Minecraft** (`body.skin-mc`): board part + full MC-style UI: dimmed dirt background,
  dark-oak plank panels with black border, near-black inner boxes, MC stone buttons
  (gray face, black outline, light top-left / dark bottom-right bevel, blue hover), black
  text fields, white text with MC drop shadow, yellow `#ffff55` titles. Owner rejected an
  earlier light-wood look as unreadable — keep it dark/unified.

### Player colours in CSS (how 4 seats stay cheap)
`base.css` defines `--c<k>`, `--c<k>-dark/-light/-bg` for seats 0–3 and the rules
`.p<k>, .turn-p<k> { --pc … --pc-bg }` plus `--block` (the shiny radial gradient). Every
other rule uses `var(--pc)` etc. and never a seat number: a cell with class `p1`, a
`.player` card, a `.log` line, `#board.turn-p0`… all pick up their own colour. The engine
also adds `taken` to owned cells (`.cell.taken`, `.stone.taken`) so "owned" styling
doesn't need `:is(.p0,.p1,…)`. MC skins do the same with `--tex-p` / `--tex-glass-p`
(`skin-mc.css`); seats 2/3 have no block textures yet. Glows use `color-mix()`.

## Game engine interface (`client/games.js`)

`Games.register(def)` creates an engine from `def.rules` + `def.view` and stores the
definition (`Games.get(key)`, `Games.has`, `Games.keys()` in registration order; the first
registered game is the default). app.js holds the active engine in `Game` and only uses:

| Member | Contract |
| --- | --- |
| `state` (getter) | Current state object: `n, players, current, round, history, movesBy, busy, over, winner (-1 = draw/none), finishWhy, cells` + game keys (chain: `chainNow, chainBest, explosions, chainRule, chainLen`; five: `winLen, winLine`). |
| `newGame(config, hooks)` | Builds state via `rules.create`, board DOM via `view.build`, HUD cards via `Hud.build(players)`, clears the log, hides the overlay, logs "New game. X starts.", renders, calls `hooks.onTurn`. |
| `play(i) → Promise<bool>` | A move by the current player (own click, relayed friend move). `false` if busy/illegal. Sets busy, `rules.place`, `hooks.onMoveApplied`, `await view.animateMove(ctx, i, me)`, `rules.conclude` → `finish` or next turn (`hooks.onTurn`). Bails out if `state.over` became true during the animation. |
| `replay(history)` | Applies moves instantly with `rules.place/settle/conclude` — the same functions the animated path uses — then renders and finishes or calls `onTurn`. Determinism here keeps two clients in sync. |
| `finish(winner, why)` | Ends the game (also called by app.js for flag falls / remote timeouts): logs, renders, fills `#overlay-*` (title, `why` + `view.summary(state)`), emits `game:finish`, calls `onBusy(false)`, `onFinish`. |
| `abandon()` | Marks a running game over without a result (Back to room). |
| `hash()` | 32-bit fingerprint of cells/current/over/winner/movesBy; equal on two clients that are in sync (used by `move`/`sync`). |
| `render()` | No-op until a board exists. Renders every cell (shared classes `p<k>`, `taken`, `last`, `can-place`/`locked`, then `view.renderCell`) and the HUD. |
| `isLegal(i, player)` | Pure check via the rules. |

Hooks app.js passes (`hooks` object in app.js): `names` (getter → names for the current
skin), `mayPlay(p)` (may this device move for p now: local seat + connected), `turnHint(p)`,
`onCellClick(i)`, `onMoveApplied(i, p)`, `onTurn(p)`, `onBusy(bool)`, `onFinish(winner, why)`.

`Hud.build(players)` clones `#tpl-player` per seat (ids `p-{k}`, `p{k}-name`, `p{k}-you`,
`clock-{k}`, `lbl-cells-{k}`, `p{k}-cells`, `lbl-pieces-{k}`, `p{k}-pieces`, `p{k}-bar`,
`p{k}-pct`); it rebuilds only when the seat count changes and builds 2 cards at load.
`Hud.render(state, hooks, model)` writes round label, turn box (`.turn-box p<k> [busy]`),
`#board` classes `turn-p<k>` / `over`, turn name/hint, and per player the two stats, bar
and `leading`/`active`. The model comes from `view.hud(state)` (see the guide).

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
  moved and only one player is `alive` (owns a cell, or hasn't moved yet) → that player
  wins "Took over the whole board!"; else `Rules.pass` (eliminated players are skipped —
  relevant only with 3+ players).
- Clock pauses during animations and while disconnected; flag fall = loss.

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

n×n board. Place on any empty cell. `winLen` **or more** in a row (4 directions) wins;
winning stones get `.win` + `--k` and jump in a wave (`stone-jump`, the MC blocks
jumping). Full board = draw (`winner -1`, overlay "Draw!"). HUD: stones placed, best row
as the bar. MC skins: quartz tiles on obsidian, diamond/gold blocks as stones; hover
keeps the texture (no background transition on textured tiles — a flicker bug once).

## Board / HUD layout rules

- **Whose turn**: `#board.turn-p<k>` → 4px outline in the active colour. `fitBoard`
  subtracts 10px so the outline is never clipped on a full-width phone board.
- **Win chance**: every player card has a `.win-bar` ("62 % win") fed by
  `Bots.estimator(game)` — the strongest registered bot that offers `estimate(state,
  tools)` (probability that player 0 wins; cheap, deterministic, exact when over), else the
  rules module's `estimate` heuristic (chain: material share; five: best rows²). Computed
  locally on every client from the same state, so both sides see the same numbers online
  too. Phones show only the win bar (`#hut .stat-bar` hidden), desktop shows the game's
  stat bar (cells % / best row) and the win bar. Only for 2 players.
- **Last move**: every cell has a `.last-marker` child; the engine adds `.last` to the
  newest history cell. Chain: static thin white border at the cell edge. Five: static
  white ring, **red** on MC skins (white is invisible on quartz). Owner: no marker
  animation. Hidden while a chain cell primes/booms and once the game is over
  (`#board.over`).
- Board size = min(wrapper width, height) − 10 → `--board` (`fitBoard` in app.js, on
  resize and when `#hut` resizes). The page must **never scroll** on mobile: the HUD sits
  below the board in a compact two-row form (controls behind ☰); desktop shows the full
  HUD beside the board (sign, stats, log, controls). `body.game-<key>` lets CSS hide
  game-specific boxes (`body.game-five .chain-box`); `#board` gets the game key as class.

## Online play (`client/lib/net.js` + protocol in `app.js`)

- Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; `normalizeCode` maps O→0,
  I/L→1. Peer id = `chainreact-v1-<CODE>`.
- **Transport role**: whoever claims the room peer id is `host`; on `unavailable-id` the
  other becomes `guest` and dials the host — so "Create room" and "both type the same
  code" share `Net.open(code, handlers, preferredRole)`. `handlers.preferHost` (a former
  host refreshing) retries the claim 4× before giving in. A guest whose dials hit
  `peer-unavailable` twice **takes over** the room id (`claimHost`), so the room lives
  on as long as anyone is in it and a host who left can come back by the same link (it
  then joins as guest). Roles can therefore swap; the app never derives seats from them.
- **Seats** (`app.me`, player number 0/1) are sticky for a room visit: creator = 0,
  session restore = saved seat, a joining guest gets one from the host. Handshake on
  every (re)connect: guest → `hello {seat, rematch}` (seat −1 = none) → host answers
  `state {you, phase, settings, config, g, rematch}` (+ `sync` in a game) → guest takes
  `you` (its old seat if free, else the free one), mirrors settings, starts/continues
  the game, answers `sync`. `rematch: true` = "I pressed Rematch while you were away"
  and is handled like a `rematch` message, so a request never gets lost.
- **Accepting a guest**: the guest's dial carries `metadata {seat}`; once the data
  channel is open the host answers `welcome` (the guest attaches only then) or `full`.
  A newcomer while a friend is connected gets `full` — unless it carries the connected
  friend's seat (that friend back on a new connection after a refresh) or the old
  connection has stopped answering pings (> 6 s): then the stale one is replaced.
  `full` is not final on the guest: it shows "This room is full…" (status `error`) and
  quietly redials every 5 s, because the "friend" may be its own stale connection the
  host hasn't noticed as dead yet (a slow CI machine hit exactly that). Connection
  handlers check `conn === c` so a replaced connection's close is ignored. A dial that
  gets no data channel within 8 s is closed and retried.
- A former host whose id was taken over while its tab slept (`unavailable-id` with
  `everConnected`) joins as guest at once; only a fresh page (refresh) retries the claim.
- **Newest intent wins** (`app.rev`): every phase change (start, rematch, back to room)
  bumps a room-state revision on both sides. `hello` and `state` carry `rev, phase,
  config, g`; a host whose guest reports a higher `rev` adopts the guest's phase before
  answering (`adoptRoomState`), a guest follows the host when `rev` is equal or higher.
  So "one tab died, the other went back to the room / started a rematch, the tab comes
  back" never drags anybody back into a stale game, whoever ends up hosting. The
  revision is part of the session, so a refresh keeps it.
- **Desync detection** (`Game.hash()`: FNV-1a over cells/current/over/winner/movesBy):
  `move` carries the sender's hash before the move, `sync` the sender's hash. A move
  whose hash doesn't match is not applied; a sync is requested instead. `applySync`:
  identical prefix + longer history → the short side replays the tail; a prefix
  mismatch, a hash mismatch at equal length, or the host still lacking moves the guest
  already sent (`app.syncSentAt`) → `resolveDesync`: the host just re-sends its sync,
  the guest rebuilds the game from the host's history (`app.rebuiltAt` remembers the
  attempt). A second mismatch at the same point → both back to the room with a toast,
  never two different games.
- Share link = `<page URL without query>?room=CODE`; `?room=` on load auto-joins;
  `history.replaceState` keeps `?room=` in the URL while in a room.
- Messages (JSON over one reliable DataConnection; game messages carry `g` = gameNo):
  `hello`, `state`, `welcome`/`full` (transport level, host → guest on accept/reject), `lobby {s}` (settings changed), `start {config, g}` (host started),
  `start-request` (guest asks; host is authoritative), `tolobby` (either side; abandons a
  running game), `sync {g, history, clocks}` (on (re)connect / on gaps: the shorter side
  replays the missing tail; deferred in `app.pendingSync` while animating), `move {i, n,
  g}` (`n` = history length before the move; queued in `app.incoming`, applied when idle
  and `n` matches, else a sync is requested), `timeout {p}` (only the owner of the
  flagged clock decides — clocks drift), `rematch {g}` (both must press), `react {e}`,
  `leave` (sent 250 ms before closing; the app then treats the friend as gone at once —
  Start is disabled before the connection actually drops), `ping`/`pong` every 3 s, 12 s
  silence → lost → the guest redials. `rematch` with `g <= gameNo` is ignored
  (duplicates). Handlers live in `HANDLERS` in app.js.
- **ICE servers / TURN** (`iceServers()` in net.js): STUN alone cannot connect two players
  who are both on mobile data (carrier-grade NAT; the owner hit this on the go). So every
  `open()` fetches the ICE list (STUN + TURN with credentials) from the owner's **Metered**
  account's credentials API (`alzlper.metered.live`, credential-scoped API key, free plan
  0.5 GB/month — plenty, a move is a few bytes; WebRTC relays only without a direct path),
  exactly as Metered documents for browser apps. Cached 20 min; on failure/timeout (4 s)
  STUN-only is used (tests and local dev work either way). The endpoint is stored in
  `RELAY_SRC` reversed + base64 (`relayUrl()`) so crawlers grepping for `turn:` or the key parameter
  don't harvest it; it is not a secret and the owner doesn't mind the free account —
  just don't publish it in an obvious place (no `turn.json`, no plain string). Metered has
  no domain restriction and the owner explicitly rejected a rotation workflow as unreliable.
  The Peer is created asynchronously (`createPeer`, guarded by `openGen` so a room left
  meanwhile is ignored). After 3 dials whose data channel never opened while the host is
  registered (`channelFailures`, or repeated `webrtc` errors) the status becomes `error`
  with a plain hint to try Wi‑Fi.
- **Guest dial handshake**: the guest listens for data from the start (under load the
  host's first message can arrive before the guest's own `open` event) and attaches once
  the channel is open *and* the host sent `welcome` (a host `ping` counts too).
- Statuses: `idle, connecting, waiting, connected, reconnecting, signaling, error`.
  `signaling` = broker socket dropped (tab suspended); an established DataConnection
  keeps working without the broker → no in-game banner for it. `everConnected` picks the
  wording ("isn't here yet" vs "seems to be away"); `ERROR_TEXT` maps PeerJS error types
  to plain sentences. `visibilitychange`/`online` → `Net.retryNow()`.
- Page refresh: `sessionStorage["chainreact.session"]` = code, me (seat), role, gameNo,
  phase, config, history, clocks. With a matching `?room=` the board is rebuilt from it
  (`replay`), then the handshake fills in the rest.
- Growing to 4 players: the host keeps one connection per guest and relays (see the
  comment at the top of net.js); the handshake already assigns seats per connection.

### Gotchas already hit
- Host: the `connection` event fires before the data channel is open → attach on
  `c.on("open")` (or `c.open`), else the first `send` is silently dropped.
- `peer.destroy()` emits `close` synchronously → peer handlers check they still belong
  to the current peer (`bindPeer`), otherwise a demoted host re-scheduled its claim.
- `enterRoom` resets `app.config`/`gameNo` (a leftover local config once made the host
  skip starting).
- `Game.render()` runs from net callbacks; the engine guards it until a board exists.
- Headless tests: pick the CDP target with `type === "page"`; disable the cache.
- `pkill -f <pattern>` kills your own shell if the pattern is in the command line.

## Events (`Bus`)

Fire-and-forget notifications for observers (a future sound module subscribes here;
the log emits too so a chat could mirror it). Current events and payloads:
`game:new {game, config}`, `game:move {game, cell, player}` (a piece was placed),
`game:turn {game, player}`, `game:finish {game, winner, why}`, `chain:explode {cells,
player, chain}` (one wave), `reaction {emoji, theirs}`, `log {text, cls}`.
Adding sounds = a new `client/sounds.js` with `Bus.on(...)` calls and one script tag.

## Seats, bots and more players

`app.seats[p] = { kind }` is built per game by `makeSeats`: `local` (this device moves for
it), `remote` (the friend) or `bot`. `hooks.mayPlay(p)` = local seat + connected;
`hooks.onTurn(p)` calls `botTurn(p)` for a bot seat: after `THINK_MS` (350 ms, so it doesn't
feel instant) it asks the bot instance for a move on a **clone** of the state, re-checks
that the same game is still on that turn (`gameNo`, phase, busy, over), falls back to a
random legal move if the bot throws or answers illegally, then `Game.play(i)` like a click.
`hooks.names` shows the bot's name on its seat. Player count is `config.players` (fixed at
2 by `Settings.read()`); rules, `Rules.pass`, `Clock`, HUD and lobby cards are written for
N, the CSS has colours for 4 seats, the protocol needs the relay described in net.js.

## Bots (`client/bots.js`, `client/bots/<id>/`)

Bots are pure and headless: no DOM, only the game's rules module + the toolset. The same
code runs in the browser and in Node (`scripts/headless.mjs` loads util, rules, bots.js and
every bot folder into a bare VM — script list parsed from `index.html`).

- **Registry**: `Bots.register({ id, name, game, version, description, difficulties:
  [{ id, label }, …], create(tools) })` (validated: slug id, ≥ 1 difficulty, create fn).
  `Bots.get/list/forGame(game)`, `Bots.benchmarkOf(id)`. Rules modules register themselves
  (`Rules.register("chain", ChainRules)` → `Rules.of(key)`) so bots find them without the
  DOM-bound engine.
- **Instance**: `Bots.create(id, { me, difficulty, seed, players, budget })` → `{ def,
  tools, difficulty, move(state) }`. `create(tools)` runs once per game and may keep state
  (caches, opening books); `move(state)` returns a cell index or a Promise of one.
- **Budgets** (the reason strong bots stay phone-friendly and tests stay deterministic):
  every difficulty may declare `thinkMs` (≤ 5000; the per-move time in the app, default
  50). `tools.budget = { ms, nodes }`: the app uses the time (`nodes: Infinity`), the
  conformance tests and the benchmark pass a **node budget** (`ms: Infinity`, 2 000 resp.
  20 000 nodes) so a searching bot gives identical answers on any machine. Bots take
  `const d = tools.deadline()` per move and `d.tick()` per searched node, stop when it
  returns true (iterative deepening keeps the last finished depth), and `await
  tools.yield()` every few thousand nodes on long levels so the page stays responsive.
- **Toolset** (`Bots.tools(game, opts)`): `game, rules, me, players, difficulty, seed`,
  seeded `random()/randInt/pick/shuffle` (mulberry32: same seed → same game, which is how
  random bots are unit-tested), `legalMoves(state, p)`, `isLegal`, `clone`,
  `apply(state, i)` (place + settle + conclude on a copy → the position after the move,
  with `over/winner`), `outcome(state)`, `opponents(p)`, `deadline(ms)` for time-boxed
  search. Rules modules are also reachable directly (`tools.rules`: chain `tally`,
  `readyCells`…; five `lineThrough`, `bestRow`). Add generic helpers here, game-specific
  analysis in the rules module — never in a bot.
- **Playout**: `Bots.playout(game, config, seats, { maxMoves })` runs a full headless game
  (seats = instances or `state → move` functions) → `{ over, winner, moves, history }`.
- **Tests** (all in `npm run test:unit`): `tests/unit/bots.test.mjs` covers the framework
  and a **conformance suite every registered bot must pass** for every difficulty: only
  legal moves in 300 seeded random positions, deterministic per seed, finishes full games
  as either colour, < 50 ms per move. Each bot folder has its own `bot.test.mjs` (the
  glob `client/bots/**/*.test.mjs`) for what makes that bot that bot (Random: covers every
  legal cell, roughly uniform, seed reproduces a whole game). A real bot's tests should
  prove strength facts: beats Random by a margin, blocks an open four, takes a win in one,
  never worse than depth-1 greedy, etc. (VM realm: compare arrays via `JSON.stringify`.)
- **Benchmark** (`npm run benchmark` = `scripts/benchmark.mjs [id…]`): every bot plays a
  seeded series against the Random bot of its game (chain 100 games 6×6, five 200 games
  9×9, both colours, highest difficulty) → score = win rate in % (draw = ½) plus
  `games, opponent, avgMoves, version, commit, at` (60 chain / 100 five games, 20 000-node
  budget per move so the series is deterministic), written to
  `client/bots/<id>/benchmark.js` (`Bots.benchmark(id, result)`; `at/commit` kept when the
  numbers didn't change so a re-run never diffs). Those files are listed in `index.html`,
  so the score is baked into the page; `Opponent` shows it ("47 % vs Random") in the
  picker and the lobby summary. `.github/workflows/benchmark.yml` runs it on pushes to
  `main` that touch `client/bots/**` (not the benchmark files), `bots.js`, the rules or the
  tools, and opens an auto-merging PR (branch `bot-benchmark`) with the new files (branch
  protection needs the `test` check, so a direct push isn't possible; auto-merge is
  enabled on the repo and Actions may create PRs). Random ≈ 50 % is the baseline.
- **UI**: `Opponent` (client/opponent.js) renders `#bot-modal` for the selected game: one
  `.bot-option` per bot (name, description, score badge or "not rated"), the `#bot-difficulty`
  segmented control (hidden with a single difficulty), remembers `{ id, difficulty }` per
  game in `localStorage["chainreact.bots"]`, `Opponent.current(game)` / `summary(game)`.

- **Puzzles = perfect-move test sets** (`tests/puzzles/<game>/puzzles.json`): positions whose
  best move(s) were PROVEN by a solver (`scripts/puzzles/<game>/solver.mjs`, exhaustive
  minimax / proven threat search), generated deterministically by
  `scripts/puzzles/<game>/generate.mjs` (`npm run puzzles`) into `puzzles.json` (`{ game, generated, solver, puzzles: [{ id, config, history, toMove, best,
  value, depth, tags, note }] }`; `history` replays from an empty board, `best` = all
  optimal moves, `value` from the mover's view, tags like `win-in-1`, `must-block`,
  `avoid-loss`, `win-in-2`, `endgame-exhaustive`; note the sets differ slightly: chain's
  `avoid-loss` means "loses to the immediate reply", five's "loses by force"). Each test
  folder has `solver.test.mjs` (the solver on hand-made positions + the set's consistency,
  re-solving every puzzle), each script folder a README with the guarantee and the limits.
  `scripts/puzzles/verify.mjs` (`npm run puzzles:verify`) re-proves the tactical puzzles
  with a solver-independent one-ply check and prints the blind-random baseline. `scripts/puzzles/runner.mjs` replays a puzzle (`positionOf`) and grades a bot
  (`evaluateBot` → solved/total/pct, per tag, failures); `tests/unit/puzzles.test.mjs`
  checks every set (≥ 100, replayable, legal best moves) and prints every bot's score; the
  benchmark stores it as `puzzles: { solved, total, pct, chance }` in `benchmark.js`
  (`chance` = what random picking scores on that set — small boards have few legal
  moves, so Random gets ~22 % on the chain set; read scores against it). **No test and no
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
   `bot.js` and `benchmark.js` (create an empty `benchmark.js` until the first run).
4. `npm run benchmark <id>` locally (or let the workflow do it) — commit `benchmark.js`.
5. `npm test`; the conformance suite, the puzzle grading and the e2e bot flow run
   automatically. Add `evaluateBot` thresholds (per tag if useful) to the bot's tests.

## Emoji reactions (`client/reactions.js`)

`#react-bar` top-right, starts collapsed behind the 😜 toggle; emojis + "L"/"EZ"/"GG"
chips. `Reactions.place()` (called after every `fitBoard`) puts `#react-layer` **right
next to the board** when there is ≥ 66px of space (desktop), else in the free strip
above the full-width board (or below it if that's bigger) — never over the board, never
off-screen. Emojis drift right → left while falling the layer's height (~2 s, wobble,
fade, max 14 on screen). Spam is allowed on purpose (~8/s; the receiver accepts one per
100 ms and only values from its own button set). Friend's reactions get a dot in their
colour. `#net-banner` sits at 58px on phones so it stays clear of the toggle.

## Tests (`npm test` = unit + e2e; CI runs both before every deploy and on every PR)

- **Unit** (`npm run test:unit`, Node's built-in runner, `tests/unit/*.test.mjs` +
  `client/bots/**/*.test.mjs`; `bots.test.mjs` = framework + bot conformance, see Bots):
  `rules.test.mjs` runs the pure rules in a bare `vm` context (no DOM; 2- and 3-player
  rotation, elimination, legalMoves, draw). `dom.mjs` loads `index.html` + every client
  script except `app.js` into jsdom (script list parsed from index.html; `Element.animate`
  polyfilled) for `chain.test.mjs` (caps, waves, board-decided stop, win, chain rule,
  replay == play, hooks, HUD), `five.test.mjs`, `clock.test.mjs` (call `C.setup(0)` +
  `w.close()` at the end or the interval keeps the file alive), `net.test.mjs` (codes),
  `build.test.mjs` (`SKIP_MINIFY=1 DIST_DIR=<tmp>`; hashed names, icons, deterministic).
  Cross-realm arrays: compare via `JSON.stringify`, not `deepStrictEqual`.
- **E2E** (`npm run test:e2e`, `tests/e2e/*.test.mjs`): `harness.mjs` starts a static
  server (port 0) and headless Chrome via CDP (no Playwright; Node 22 `WebSocket`/`fetch`;
  Chrome from `$CHROME` or `google-chrome`). Helpers: `goto` (waits for scripts + the
  preloader), `ev`, `click/set/check/text`, `move(i)`/`idle()`, `state()`, `randomGame()`,
  `noScroll()`, `emulate(w,h)`, `screenshot(name)` (to `tests/e2e/shots/`, git-ignored;
  uploaded as artifact on CI failure), `waitFor`. Specs: `local-flow`, `settings`,
  `skins` (computed styles per skin), `mobile` (360×780), `online` (two browsers through
  the real PeerJS broker: join by link, settings mirror, guest start, move sync,
  reactions, guest refresh, tolobby, switch game, rematch, host refresh, guest leave +
  rejoin, host leave → guest takes over → host returns as guest; `SKIP_ONLINE=1` skips),
  `online-edge` (third player → room full; both refresh in the lobby; guest closes the
  tab mid-game without goodbye and returns by link; rematch asked while the friend was
  away; host's tab dies, guest goes back to the room, host returns → both in the lobby;
  a corrupted guest board is rebuilt from the host; a board that keeps differing sends
  both back to the room; both type the same new code at once), `bot` (offline vs bot: picker with score, bot moves
  by itself, rematch), `dist` (built bundle: hashed assets only,
  preloader, playable). Files run 2 at a time; each launches its own Chrome. `B.blank()`
  navigates to about:blank (a closed tab); outline colours transition for .25s → wait
  before reading computed styles. Any new join/rejoin behaviour gets a scenario in
  `online-edge` — the owner wants joining to feel rock solid.

## Folders that are never deployed

`docs/` (`docs/bots.md` = bot system reference and the list of current bots — keep it in
step with the code), `scripts/` (headless loader, puzzle runner, benchmark, puzzle solvers/generators,
verify, screenshot tour), `tests/`. The deploy uploads `dist/`
only; `build.mjs` bundles nothing outside `index.html`'s tags and `client/textures`.

## Owner preferences

- Writes English and German; either is fine in replies.
- Wants things to look nice; approved: classic skin, HUD contrast, explosion, compact
  mobile HUD, unified dark MC UI, settings modal, room flow. Keep mobile non-scrolling.
  Layout need not be pixel-perfect, behaviour and texts must not change unasked.
- Prefers several small JS files over one big one; no framework.
- Two friends only — no matchmaking, no accounts, no own server.

---

# How to add a new game (step by step)

A game is three files (rules, view + registration, CSS) plus two tags in `index.html`.
Rooms, lobby sync, start/rematch/tolobby, reconnect + replay, clock, reactions, session
restore, skins, HUD cards, settings persistence and the picker are generic.

## 1. Rules `client/games/<key>-rules.js` (pure — no DOM, no settings)

Expose a global `<Name>Rules` returning these functions (copy `five-rules.js`):

| Function | Contract |
| --- | --- |
| `create(config, base)` | Return `Object.assign(base, { cells, …your keys })`. `base` comes from `Rules.base(config)` (n, players, current, round, history, movesBy, busy, over, winner, finishWhy). Read your own keys from `config` (they arrive from `Settings.read()` on both sides). |
| `ownerOf(state, i)` | Owner of cell i (-1 = none). Drives the shared `p<k>`/`taken` classes. |
| `isLegal(state, i, player)` | Pure; `false` when `state.over`. |
| `legalMoves(state, player)` | Array of cell ids (for bots and tests). |
| `place(state, i, player)` | Apply the move: `history.push(i)`, `movesBy[player]++`, your board change. |
| `settle(state, player)` | Resolve everything that follows a placement instantly (chain waves; no-op for five). |
| `conclude(state, player)` | Return `{ winner, why }` (winner -1 = draw) or `Rules.pass(state[, alive])` and return `null`. |

A move must be a single integer (encode from/to as `from * n*n + to` if needed): `move`,
`sync` and the session assume `history` is an array of numbers. Player numbers are
0…players-1; names/colours come from the skin.

## 2. View + registration `client/games/<key>.js`

Expose `<Name>View` with:

| Function | Contract |
| --- | --- |
| `build(board, state, config, onClick)` | Create one element per cell inside `board` (append a `<div class="last-marker">` child to each), wire `click → onClick(i)`, return the element array. Set CSS vars you need (chain sets `--speed`). |
| `renderCell(el, state, i)` | Game-specific classes only (the engine already set `p<k>`, `taken`, `last`, `can-place`, `locked`). |
| `hud(state)` | Return `{ round: "Move 3", players: [{ stats: [[label, value], [label, value]], bar: 0..1, barText, leading }], line2?, drawHint? }`; write your own extra HUD boxes here (chain writes `#chain-now` etc. and `#mini-line2`). |
| `summary(state)` | Second line of the result overlay ("12 moves"). |
| `animateMove(ctx, i, player) → Promise` | Show the move. `ctx` gives `state`, `cells`, `board()`, `names()`, `renderCell(i)`, `renderHud()`, `render()`. Use the rules' step functions for anything that changes state so the instant path (`settle`) stays identical. Return early if `state.over` after an `await`. Emit `Bus` events for sounds. |

Then register:

```js
const <Name>Game = Games.register({
    key: "<key>", title: "Nice Name",
    tagline: "One sentence under the picker.", desc: "Short card subtitle",
    preview: "...01....",                   // 9 chars: "." empty, digit = player
    size: { min: 5, max: 19, default: 9 },  // board-size input limits
    minSize: (cfg) => 5,                    // optional, may depend on cfg (five: winLen)
    settings: [],                           // data-setting keys of rows to show
    describeRules: (cfg) => [],             // optional summary parts before the timer
    describeOptions: (cfg) => [],           // optional summary parts after the timer
    rules: <Name>Rules, view: <Name>View,
});
```

The picker card is generated from this entry (no HTML to add). Keep the picker at ≤ 2
cards per row (`.game-picker` grid is `1fr 1fr`; with 3+ games consider
`repeat(auto-fit, minmax(150px, 1fr))`) and re-check the 360×780 lobby doesn't scroll.

A new setting: add a `<label class="row" data-setting="<key>">` to `#settings-modal`,
an entry in `FIELDS` in settings.js (`{ key, el, type: "int"|"bool", min, max, def }`),
list the key in the game's `settings`. It is read into the config, persisted, mirrored
to the friend and visible to the engine as `config.<key>` automatically.

## 3. CSS `client/games/<key>.css`

`#board.<key>` grid (see `#board.five`) using `--board` and `--n`; your cell classes
(five uses `.stone`, chain `.cell` + `.tile`). Colours via `var(--pc)`, `var(--pc-dark)`,
`var(--block)` on `.taken` cells — never a seat number. Then the MC-skin rules under
`:is(.skin-mc, .skin-mcboard)` (textures via `var(--tex-p)`, no rounded corners,
`image-rendering: pixelated`, **no background transitions on textured tiles**). Hide
HUD boxes you don't want with `body.game-<key> …`. New texture: extract from
`~/.minecraft/versions/1.12.2/1.12.2.jar` (`assets/minecraft/textures/blocks/<name>.png`,
16×16) into `client/textures/` and add a `--tex-<x>` var in `skin-mc.css`.

## 4. Tags in `index.html`

`<link rel="stylesheet" href="client/games/<key>.css">` after `five.css`;
`<script src="client/games/<key>-rules.js">` and `<script src="client/games/<key>.js">`
after `five.js` and before `skins.js`. Build and unit tests pick them up from there.

## 5. Checklist before calling it done

- Unit: rules in `tests/unit/rules.test.mjs` (no DOM) and an engine spec like
  `five.test.mjs` (win, draw if possible, replay == play, HUD texts).
- Local: lobby → pick game → Start → play to a win **and** a draw → overlay text →
  Rematch → Back to room → switch to another game.
- Online with two headless browsers (`tests/e2e/online.test.mjs`): guest sees the host's
  picker change; guest presses Start; moves sync both ways; guest refresh gets the board
  back via `replay`; both press Rematch; one presses Back to room.
- Timer on: clock pauses during your animations, flag fall ends the game on both sides.
- Phone viewport 360×780: lobby, game and result overlay don't scroll; HUD labels fit.
- All three skins: board readable, MC textures don't flicker on hover.
- No `Runtime.exceptionThrown` in either browser. Update this file and `README.md`.
