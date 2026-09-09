# ALZlper's Minigames — agent context

Read this before touching anything. It captures how the site works, the decisions
already made with the owner, the traps that cost time before, and a step-by-step guide
for adding a new game (the most likely future task).

## What this is

A static site with nostalgic two-player minigames the owner played on a Minecraft
server in 2015: **Chain React** (screenshot `2015-07-02_17.19.52.png` in the repo root)
and **Five Wins** (gomoku without gravity). Hosted as plain files on S3 at
`https://minigames.alzlper.com/` (GitHub: `alexander-zierhut/minigames`, remote `github`;
the old `origin` points at the owner's Gitea) — the code must never assume that URL; share links
are built from `location.href`.

No build step, no bundler, no backend, no framework. Vanilla JS in classic scripts
(not ES modules), loaded in this order in `index.html`:
`vendor/peerjs.min.js` → `game.js` → `five.js` → `clock.js` → `net.js` → `app.js`.
Each file exposes one global (`ChainGame`, `FiveGame`, `Clock`, `Net`) via an IIFE.
`app.js` wires everything and holds the active engine in a local `Game` variable.

Local dev: `php -S 127.0.0.1:8000 -t .` from the repo root `/workspace/Development/private/minigames` (port 8080 is taken on the
owner's machine by something unrelated). Any static file server works; the source runs
unbundled straight from `index.html` + `client/`.

## Build & deploy

- `node build.mjs` (or `npm run build`) writes `dist/`: `index.html` +
  `assets/app.<hash>.js` (all client scripts concatenated in `index.html` order, minified
  with esbuild via `npx` when available) + `assets/main.<hash>.css` (texture urls
  rewritten) + `assets/textures/<name>.<hash>.png`. Hashes are content hashes → cache
  busting by filename. `dist/` is git-ignored.
- `.github/workflows/ci.yml` runs the test suite on every push/PR; on `main` the deploy
  job follows a green test job: build, then
  `aws s3 sync` the assets with `Cache-Control: public, max-age=31536000, immutable`,
  then `index.html` with `no-cache`, then delete old hashed assets. Target: Scaleway
  Object Storage bucket `minigames.alzlper.com`, region `nl-ams`, endpoint
  `https://s3.nl-ams.scw.cloud`. Credentials come from repo secrets `SCW_ACCESS_KEY` /
  `SCW_SECRET_KEY`: a **non-expiring API key of the IAM application `minigames-website`**
  (id `300c3839-68e5-4fc9-9a66-9321af7ffe1e`, policy `minigames-website-policy` =
  ObjectStorageFullAccess on project `zierhut-p` 829778ff…), same pattern as the owner's
  other sites (e.g. `alexzierhut-website`). The bucket policy has three statements:
  owner user id full access, deploy application full access, `*` GetObject.
- Bucket is in website mode (index + error document `index.html`), same policy shape as
  the owner's other sites (`alzlper.com`, `blog.alzlper.com`). DNS: CNAME the domain to
  `minigames.alzlper.com.s3-website.nl-ams.scw.cloud` (TLS via Scaleway Edge Services).
- Adding a new client script: put its `<script src="client/…">` tag in `index.html` —
  the build picks up all `client/` script tags in order; nothing else to configure.

## Files

- `index.html` — screens as `<section class="screen">`: `#screen-menu`, `#screen-lobby`,
  `#screen-game`; plus `#settings-modal`, `#overlay` (result), `#result-fab`,
  `#react-bar`/`#react-layer`, `#net-banner`, `#toast`.
- `client/app.js` — game registry (`GAMES`), skins (`SKINS`), settings, screens, room
  lobby, hooks into the engine, online protocol, reactions, session restore, `fitBoard`.
- `client/game.js` — `ChainGame` engine (rules, DOM board, explosion animation, replay).
- `client/five.js` — `FiveGame` engine (same interface, gomoku).
- `client/clock.js` — `Clock`: chess clock (setup/setActive/pause/resume/stop/snapshot/restore).
- `client/net.js` — `Net`: PeerJS room transport (open/send/leave/retryNow + status callbacks).
- `client/main.css` — classic skin (default) → desktop media query → picker/five/fab →
  "Minecraft BOARD" block (shared by both MC skins) → "Minecraft UI" block → reactions.
- `client/textures/*.png` — 16×16 Mojang block textures from the owner's own 1.12.2 jar
  (personal use; MC skins stay opt-in "so I don't get sued").
- `client/vendor/peerjs.min.js` — PeerJS 1.5.4, vendored (no CDN at runtime).
- `README.md` — short public readme. `CLAUDE.md` just imports this file.
- `server/` (a 2022 PHP Ratchet stub) was deleted as unused. Don't bring it back.

## Flow: title → room lobby → game (the "party" model)

Owner asked for this explicitly after playtesting ("we sent 3–4 links just to try
things"). One room, one link, the whole evening.

- **Title screen** (`#screen-menu`): title "ALZlper's Minigames" (owner's MC name),
  section *Online* with `Create room` + `Join room` (the code field `#join-panel` only
  appears after pressing Join room), section *Offline* with `Play on this device`, and
  the global **Look** (skin) segmented control. Nothing else. Must never scroll on a phone.
- **Lobby** (`#screen-lobby`) is the same screen for local and online (`app.mode`):
  room code + Share/Copy (online only), player cards (online only), game picker
  (`.game-card[data-game]`), settings summary button → `#settings-modal`, `Start game`,
  `Leave room`/`Back`.
- **Game** (`#screen-game`): board + HUD ("hut"). After a game the result overlay offers
  `Rematch` (same config), `Look at board` (hides overlay, `#result-fab` brings it back),
  `Change game` (→ lobby). The HUD has `Rematch` and `Back to room` too.
- `app.phase` ∈ `menu | lobby | game`. `app.gameNo` increments per started game (local
  too). `startPlayerFor(g) = (g + 1) % 2` → host (player 0) starts game 1, then alternate.

### Shared lobby state (online)
- Any settings change by either player (`settingsChanged()`) sends `lobby {s}`; the
  receiver writes it into its form via `writeSettings()` with `app.applyingRemote = true`
  so it doesn't echo back. A toast says "Settings updated by your friend".
- Starting is **host-authoritative**: host's Start sends `start {config, g}` and starts;
  the guest's Start sends `start-request`, the host then starts. Start is disabled until
  the friend is connected.
- `tolobby` from either side brings both back to the lobby (a running game is abandoned).
- On every (re)connect the host sends `state {phase, settings, config, g}` — the single
  source of truth for a (re)joining guest: lobby → mirror settings; game → start that
  game if not already in it, then exchange `sync`.

## Settings

Live in `#settings-modal` (opened from the lobby's summary button, closed by Done or
backdrop click; number inputs are clamped on close / `change`, never on `input`, so
typing "12" doesn't snap at "1"). Persisted in `localStorage["chainreact.settings"]`
(inputs have `autocomplete="off"` because Firefox restores form values on reload).
- Board size: free number, per-game min/max from the registry, remembered per game in
  `sizeFor`. Chain 3–12 (default 6), Five 5–25 (default 9; min = win length).
- Animation speed (chain only): Slow 1100 / Normal 750 / Fast 350 ms → `--speed`.
- Timer per player: Off (default) / 1 / 3 / 5 / 10 min / custom minutes.
- Win on a long chain (chain only, off by default; owner dislikes it but wanted it):
  N explosions, default 15.
- In a row to win (five only): 3–25, default 5.
- `readSettings()` returns the config object that becomes `app.config` for a game.
  The **skin is NOT a setting** — see below.

## Skins (three, per device)

Global `#skin-seg` control on the title screen, stored in `localStorage["chainreact.skin"]`,
never sent to the friend, never in the settings modal (owner asked for both).
- **Classic** (default; owner's favourite — don't touch its look): dark navy UI, cyan vs
  amber, rounded cells, lamps as dots. Names "Cyan"/"Amber".
- **MC board** (`body.skin-mcboard`): classic UI, Minecraft textures on the board, flying
  pieces, sparks, HUD player blocks and picker previews. Names "Diamond"/"Gold".
- **Minecraft** (`body.skin-mc`): board part + full MC-style UI: dimmed dirt background,
  dark-oak plank panels with black border, near-black inner boxes, MC stone buttons
  (gray face, black outline, light top-left / dark bottom-right bevel, blue hover), black
  text fields with gray outline, white text with MC drop shadow, yellow `#ffff55` titles.
  Owner rejected the earlier light-wood "sign" look as unreadable — keep it dark/unified.
- In `main.css` the "Minecraft BOARD" section uses `:is(.skin-mc, .skin-mcboard)` and is
  shared; the "Minecraft UI" section is `.skin-mc` only. The DOM is identical for all
  skins; colours come from CSS vars (`--c0/--c1` player colours, `--panel`, `--line`…).
  `SKINS` in `app.js` maps skin → player names + body class.

## Chain React rules (agreed with the owner)

- Two players alternate. A move = place one piece in an empty cell or one you own.
- Cell capacity = number of orthogonal neighbours: corner 2, edge 3, inner 4. When
  `count >= cap` the cell explodes: loses `cap` pieces, gives one to each neighbour,
  converting them to the mover's colour.
- Explosions resolve **wave by wave**: all cells at/over capacity explode together, all
  landings apply, then the next wave. Chain length = explosions in one move.
- Win: after both moved at least once, the opponent has zero cells. The chain loop also
  stops as soon as the board is single-coloured (`boardDecided()`), else it loops forever.
- Optional chain-win rule and chess clock (see Settings). The clock pauses during
  explosion animations and while disconnected; flag fall = loss.

### Visual layout (matches the screenshot)
Each cell is a 3×3 block: corners glass, centre glass when empty / owner's block when
owned, and **lamps only on sides that have a neighbour** (glass otherwise). Lit lamps =
piece count. Cells are separated by an obsidian gap; `--gap-f`/`--pad-f` in block units:
mobile gap 0.5 / rim 0, desktop (`min-width: 900px and min-aspect-ratio: 1/1`) gap 1 /
rim 1 (owner asked: thinner only on mobile).

### Explosion animation (owner loves it — don't dumb it down)
Per wave in `resolveChainAnimated`: 1. **prime** (`.prime`, cells blink white like lit
TNT, `speed*0.6`) → 2. **blast** (`.boom` flash + ring, `#board.shake`, 16 debris sparks
via Web Animations API in `spawnDebris`) → 3. **fly** (`.fly` sprites arc with rotation,
`speed*1.25`) → 4. **land** (`.land` pulse) + `speed*0.35` pause. First version was "way
too fast"; owner wanted it "wuchtiger" like TNT — current tuning is approved.
`replay(history)` applies moves instantly with the same rule functions (`detonate`,
`land`, `concludeMove`). Animated and instant paths must stay identical or online
clients desync.

## Five Wins rules

n×n board. Place anywhere on an empty cell. `winLen` **or more** in a row (4 directions)
wins; winning stones get `.win` + a per-stone `--k` index and jump in a wave
(`stone-jump`) — owner asked for the "blocks jumping" from MC. Full board = draw
(`finish(-1, …)`, overlay "Draw!"). HUD shows stones placed and each player's best row
as the bar. MC skins: quartz tiles (`quartz_block_side.png`) on obsidian, diamond/gold
blocks as stones. Hover must keep the texture (no background transition on textured
tiles — a flicker bug once).

## Board / HUD layout rules

- **Whose turn**: engines toggle `turn-p0`/`turn-p1` on `#board` in `renderHut`; CSS draws
  a 4px outline in the active colour. `fitBoard` subtracts 10px so the outline is never
  clipped, even on a full-width phone board.
- **Last move**: every cell/stone has a `.last-marker` child; the engine adds `.last` to
  the cell of the newest `history` entry. Chain: static thin white border at the cell
  edge (owner: no animation). Five: pulsing ring — white on classic, **red** on the MC
  skins (white was invisible on quartz). Hidden while a chain cell primes/booms.
- **Skin control** exists twice (title screen and lobby) as `.skin-seg`; `applySkin`
  syncs all instances.

Board size is computed in `fitBoard()` (app.js) as min(wrapper width, height) → `--board`.
The page must **never scroll** on mobile (vertically or horizontally): the HUD sits below
the board in a compact two-row form, controls behind the ☰ button; desktop shows the
full HUD beside the board (sign, stats, log, controls). HUD elements are shared by all
games; engines write their own labels into `#lbl-cells-k`, `#lbl-pieces-k`,
`#mini-line2`; `#sign-title` comes from the registry; `body.game-<key>` classes let CSS
hide game-specific boxes (e.g. `body.game-five .chain-box`). `#board` gets the game key
as class (`chain` / `five`).

## Online play (PeerJS)

- Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; `normalizeCode` maps
  O→0, I/L→1. Peer id = `chainreact-v1-<CODE>`.
- Whoever claims the room peer id first is host; on `unavailable-id` the other becomes
  guest — so "Create room" and "both type the same code" share `Net.open`. With
  `preferHost` (page refresh of a former host) the claim is retried 4× first.
- Share link = `<page URL without query>?room=CODE`; `?room=` on load auto-joins;
  `history.replaceState` keeps `?room=` in the URL while in a room.
- Protocol (JSON over one reliable DataConnection; game messages carry `g` = gameNo):
  `state`, `lobby`, `start`, `start-request`, `tolobby` (room flow, above);
  `sync {g, history, clocks}` on (re)connect / on gaps (receiver replays the missing
  tail; deferred in `app.pendingSync` while animating);
  `move {i, n, g}` (`n` = history length before the move; queued in `app.incoming`,
  applied when idle and `n` matches, else request a sync);
  `timeout {p}` (only the owner of the flagged clock decides, clocks drift);
  `rematch {g}` (both must press); `react {e}`; `leave` (sent 250 ms before closing);
  `ping`/`pong` every 3 s, 12 s silence → lost → redial.
- Statuses: `idle, connecting, waiting, connected, reconnecting, signaling, error`.
  `signaling` = broker socket dropped (tab suspended). An established DataConnection
  keeps working without the broker → no in-game banner for it; the lobby cares.
  `everConnected` picks wording ("isn't here yet" vs "seems to be away"); `ERROR_TEXT`
  maps PeerJS error types to plain sentences. `visibilitychange`/`online` → `retryNow()`;
  a destroyed peer is re-created (host re-claims its id).
- Page refresh: `sessionStorage["chainreact.session"]` = code, role, gameNo, phase,
  config, history, clocks. With matching `?room=` the board is rebuilt from it, then
  the host's `state` + `sync` fill in the rest.

### Gotchas already hit
- Host: the `connection` event fires before the data channel is open → attach on
  `c.on("open")` (or `c.open`), else the first `send` is silently dropped.
- `enterRoom` must reset `app.config`/`gameNo` (a leftover local config once made the
  host skip starting).
- `Game.render()` runs from net callbacks; engines guard it until a board exists.
- Headless tests: pick the CDP target with `type === "page"`; disable the cache
  (PHP's server sends no cache headers, Chrome heuristically caches JS).
- `pkill -f <pattern>` kills your own shell if the pattern is in the command line; use
  `pkill -f "[c]r-A"` style or just new ports/profiles.

## Emoji reactions

`#react-bar` top-right, always starts collapsed behind the 😜 toggle; emojis + "L"/"EZ"/
"GG" chips. `#react-layer` is positioned by `placeReactionLayer()` (called from
`fitBoard`): **right next to the board** when there is ≥ 66px of space (desktop), else in
the free strip above the full-width board (or below it if that's bigger) — never over
the board, never off-screen (owner's rules). Emojis drift slightly right → left while
falling the layer's height. `floatReaction()` drops a small element (~2 s,
wobble, fade, max 14 on screen). Spam is allowed on purpose (~8/s; receiver accepts one
per 100 ms and only values from its own set). Friend's reactions get a dot in their
colour. `#net-banner` sits at 58px on phones so it stays clear of the toggle.

## Tests (`npm test` = unit + e2e; CI runs both before every deploy and on every PR)

- **Unit** (`npm run test:unit`, Node's built-in runner, `tests/unit/*.test.mjs`): the
  engines run inside jsdom with the real `index.html` markup (`tests/unit/dom.mjs` loads
  game/five/clock/net scripts, polyfills `Element.animate`). Covers chain rules (caps,
  waves, board-decided stop, win, chain rule, replay == play), five rules (all line
  directions, winLen, gap fill, draw, replay), clock (active/pause/flag/restore), room
  codes, and the build (`SKIP_MINIFY=1 DIST_DIR=<tmp> node build.mjs`, hashed names,
  deterministic). Cross-realm arrays: compare via `JSON.stringify`, not `deepStrictEqual`.
  Clock tests must call `C.setup(0)` + `w.close()` or the interval keeps the file alive.
- **E2E** (`npm run test:e2e`, `tests/e2e/*.test.mjs`): `harness.mjs` starts a static
  server (port 0) and headless Chrome via CDP (no Playwright; Node 22 global
  `WebSocket`/`fetch`; Chrome path from `$CHROME` or `google-chrome`). Helpers: `goto`
  (waits for scripts + texture preloader), `ev`, `click/set/check`, `move(i)`/`idle()`,
  `state()`, `randomGame()`, `noScroll()`, `emulate(w,h)`, `screenshot(name)` (to
  `tests/e2e/shots/`, git-ignored; uploaded as artifact on CI failure). Specs:
  `local-flow` (menu → lobby → both games → overlay/look/rematch/change game),
  `settings` (clamping, rows, persistence, timer pause), `skins` (computed styles per
  skin), `mobile` (360×780: no scroll, outline visible, reactions inside viewport,
  stacked overlay buttons), `online` (two browsers through the real PeerJS broker:
  join by link, settings mirror, guest start, move sync, reactions, refresh resync,
  tolobby, switch game, rematch, leave; `SKIP_ONLINE=1` skips), `dist` (built bundle:
  hashed assets only, preloader, playable). Files run 2 at a time; each launches its
  own Chrome on a random port. Outline colours transition for .25s → wait before
  reading computed styles.
- **CI** (`.github/workflows/ci.yml`): job `test` (npm ci → unit → e2e) on push to
  `main`, PRs and manual; job `deploy` `needs: test` and only runs for pushes to `main`.
  Branch protection on `main` requires the `test` status check (strict) for merging
  PRs; admins are not enforced so the owner can still push directly.

## Owner preferences

- Writes English and German; either is fine in replies.
- Wants things to look nice; approved: classic skin, HUD contrast, explosion, compact
  mobile HUD, unified dark MC UI, settings modal, room flow. Keep mobile non-scrolling.
- Prefers several small JS files over one big one.
- Two friends only — no matchmaking, no accounts, no own server.

---

# How to add a new game (step by step)

Adding a game touches exactly four places: a new engine file, one registry entry, the
picker card in the lobby, and CSS for the board. Everything else (rooms, lobby sync,
start/rematch/tolobby, reconnect + replay, clock, reactions, session restore, skins,
HUD) is generic and keeps working if the engine honours the interface below.

## 1. Engine file `client/<key>.js`

Copy `client/five.js` as the template (it is the smallest complete engine) and expose a
global `<Name>Game` IIFE returning:

```js
return { state, newGame, play, replay, finish, render, isLegal, log };
```

| Member | Contract |
| --- | --- |
| `state` | Plain object, read by app.js: `n`, `current` (0/1), `busy`, `over`, `winner` (-1 draw), `history` (array of move ids in play order), `movesBy [a,b]`. Add whatever else you need. |
| `newGame(config, hooks)` | Reset state from `config` (`n`, `startPlayer`, plus your own keys from settings), set `--n` CSS var, build the board DOM inside `#board` (set `board.className = "<key>"`), clear `#log`, hide `#overlay`, log "New game. X starts.", `render()`, call `hooks.onTurn(state.current)`. |
| `play(i) → Promise` | The move entry point (own click or opponent's relayed move). Return `false` if `busy` or illegal. Set `busy = true` + `hooks.onBusy(true)`, apply the move, `hooks.onMoveApplied(i, me)`, animate, then either `finish(...)` or switch `current`, `busy = false`, `hooks.onBusy(false)`, `render()`, `hooks.onTurn(current)`. Bail out early if `state.over` became true during an await (the friend may have left / gone to the lobby). |
| `replay(history)` | Apply moves **instantly** (no awaits) with the exact same rule functions `play` uses; then `render()`, and `finish` or `hooks.onTurn`. Used after reconnect / refresh. Determinism here is what keeps two clients in sync. |
| `finish(winner, why)` | `over = true`, `busy = false`, log, `render()`, fill `#overlay-block` (class `p0`/`p1`/`draw`), `#overlay-title`, `#overlay-sub`, show `#overlay`, then `hooks.onBusy(false)` and `hooks.onFinish(winner, why)`. app.js also calls this directly for clock flag falls and remote timeouts. |
| `render()` | Must no-op until the board exists (`if (!hooks.names \|\| cellEls.length !== state.cells.length) return;`). Renders every cell and the HUD (see 4). Called by app.js on skin change, net status change, sync. |
| `isLegal(i, player)` | Pure check, no side effects. app.js uses it before sending a move and when validating the opponent's move. |
| `log(msg, cls)` | Prepend a line to `#log` (classes `p0`, `p1`, `x`), keep ≤ 6. Copy from five.js. |

Hooks the engine receives (all optional but use them): `names` (getter → `[name0, name1]`
for the current skin), `mayPlay(p)` (false when online and it's not my colour → mark
cells `locked` instead of `can-place`), `turnHint(p)` ("your move" / "waiting…"),
`onCellClick(i)` (attach to each cell — app.js decides whether to play and sends the
move online), `onMoveApplied`, `onTurn(p)`, `onBusy(bool)`, `onFinish`.

Rules of thumb:
- A move must be a single integer `i` (cell index). If your game needs more (e.g. from/to),
  encode it into one integer (`from * n*n + to`) — `move`, `sync` and the session all
  assume `history` is an array of numbers.
- Keep animations inside `play`; keep `state.busy` true while they run (the clock pauses
  on `onBusy(true)`, incoming opponent moves are queued until `onBusy(false)`).
- Never read settings directly; everything comes in through `config`.
- Player 0 vs 1 only. Colours/names come from the skin, not the game.

## 2. Registry entry in `client/app.js`

```js
<key>: {
    title: "Nice Name",
    tagline: "One sentence shown under the picker.",
    engine: <Name>Game,
    sizeMin: 5, sizeMax: 19, defaultSize: 9,   // board-size input limits
    hasSpeed: false,      // show the animation-speed row
    hasChainRule: false,  // show the chain-win row
    hasWinLen: false,     // show the "in a row to win" row (min board size = winLen)
},
```

If the game needs its own setting: add a `<label class="row" id="row-<x>">` to
`#settings-modal` in `index.html`, read it in `readSettings()`, write it in
`writeSettings()` (that's what mirrors it to the friend), hide/show the row in
`selectGame()` via a new `hasX` flag, and mention it in `renderSummary()` and
`describe()`-style texts if useful. Because `readSettings()` output *is* the config,
the engine sees it as `config.<x>` on both sides automatically.

## 3. Picker card in `index.html` (inside `#game-picker` in the lobby)

```html
<button class="game-card" data-game="<key>">
    <span class="game-preview <key>"> <i></i>×9 with some <i class="p0"></i>/<i class="p1"></i> </span>
    <span class="game-name">Nice Name</span>
    <span class="game-desc">Short subtitle</span>
</button>
```

The 3×3 preview is pure CSS; add `.game-preview.<key> i { … }` if the default square
tiles don't fit (five uses circles). Keep the picker at ≤ 2 cards per row (the grid is
`1fr 1fr`; with 3+ games consider `repeat(auto-fit, minmax(150px, 1fr))`) and re-check
that the lobby still doesn't scroll on a 360×780 phone.

## 4. HUD labels and CSS

- In your `renderHut()` write: `#round-label` and `#round-mini` (e.g. "Move 12"),
  `#turn-box` class `turn-box p<current>` (+ ` busy`), `#turn-name`, `#turn-hint`
  (use `hooks.turnHint`), per player `#p{k}-name`, `#lbl-cells-{k}` / `#p{k}-cells`,
  `#lbl-pieces-{k}` / `#p{k}-pieces`, `#p{k}-bar` width + `#p{k}-pct` text, classes
  `leading`/`active` on `#p-{k}`, and `#mini-line2` (second line on the mobile HUD).
  The chain-stats box is chain-only: hide it with `body.game-<key> .chain-box
  { display: none !important; }`.
- Board CSS: `#board.<key>` grid layout (see `#board.five`) using `--board` and `--n`;
  cell classes of your choice (five uses `.stone`, chain `.cell`/`.tile`). Provide the
  classic look first, then add `:is(.skin-mc, .skin-mcboard) …` rules in the
  "Minecraft BOARD" section (textures for empty/p0/p1, no rounded corners, pixelated).
  Do **not** put background transitions on textured tiles.
- If a game needs a new texture, extract it from `~/.minecraft/versions/1.12.2/1.12.2.jar`
  (`assets/minecraft/textures/blocks/<name>.png`, 16×16) into `client/textures/` and add
  a `--tex-<x>` var in the `.skin-mc, .skin-mcboard` block.
- `body.game-<key>` is set by `startGame`; use it for any game-specific HUD tweaks.

## 5. Script tag and load order

Add `<script src="client/<key>.js"></script>` after `five.js` and before `clock.js` in
`index.html` (the engine global must exist before `app.js` builds `GAMES`).

## 6. Checklist before calling it done

- Local: lobby → pick game → Start → play to a win **and** to a draw (if possible) →
  overlay shows the right text → Rematch → Back to room → switch to another game.
- Online with two headless browsers (see testing recipe): guest sees the host's picker
  change; guest presses Start; moves sync both ways; guest refreshes mid-game and gets the
  board back via `replay`; both press Rematch; one presses Back to room.
- Timer on: clock pauses during your animations, flag fall ends the game on both sides.
- Phone viewport 360×780: lobby, game and result overlay don't scroll; HUD labels fit.
- All three skins: board readable, MC textures don't flicker on hover.
- No `Runtime.exceptionThrown` in either browser. Update this file (registry, rules,
  any new protocol/config keys) and `README.md`.
