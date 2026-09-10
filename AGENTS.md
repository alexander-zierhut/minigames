# ALZlper's Minigames — agent context

Read this before touching anything. It describes how the site is built, the decisions
already made with the owner, the traps that cost time before, and a step-by-step guide
for adding a new game (the most likely future task). Keep it accurate: when you change
behaviour, protocol keys, files or events, update the matching section here.

## What this is

A static site with nostalgic minigames the owner played on a Minecraft server in
2015: **Chain React** and **Five Wins** (gomoku without gravity), for two to four
players (plus spectators) in one room. Hosted as
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
| `client/lib/log.js` | `Log` | the HUD event log (`add`, `chat`, `clear`, 40 lines) |
| `client/lib/clock.js` | `Clock` | chess clock for N players |
| `client/lib/net.js` | `Net` | PeerJS room transport |
| `client/lib/preload.js` | `Preload` | first-visit texture preload with `#loader` bar |
| `client/lib/sound.js` | `Sound` | Bus events → sound cues; synthesized Classic set, Blocks files (see Sounds) |
| `client/lib/install.js` | `Install` | "Add to home screen" button (beforeinstallprompt) |
| `client/games/rules.js` | `Rules` | base state, turn passing, the **pure game loop** (`create/step/eliminate/apply/replay`) shared by the engine, bots and scripts |
| `client/games.js` | `Games`, `Engine`, `Hud` | registry, the engine shell every game shares, the generic HUD renderer |
| `client/games/chain-rules.js` | `ChainRules` | Chain React rules, pure (no DOM) |
| `client/games/chain.js` | `ChainView`, `ChainGame` | Chain React board/animation/HUD model + registration (settings rows declared here) |
| `client/games/five-rules.js` | `FiveRules` | Five Wins rules, pure |
| `client/games/five.js` | `FiveView`, `FiveGame` | Five Wins view + registration (smallest game: the template) |
| `client/bots.js` | `Bots` | bot registry, the toolset bots play with, headless playout, win-chance estimator |
| `client/winchance.js` | `WinChance` | win-chance bars: a Bus observer of `game:new` / `game:position` (no engine or game knows it) |
| `client/bots/<id>/bot.js` | (registers) | one folder per bot: `bot.js`, generated `benchmark.js`, `bot.test.mjs` |
| `client/skins.js` | `Skins` | look per device: body class, player names |
| `client/prefs.js` | `Prefs` | per-device preferences ("⚙ Settings & Feedback" top-left): look, sound volume / categories, hide the room code, keep my IP private, feedback link |
| `client/settings.js` | `Settings` | settings form ↔ config; the game rows are **built from the game definitions**; picker cards, persistence, summary |
| `client/opponent.js` | `Opponent` | the bot modal: one bot per game, called "Bot" (`Opponent.NAME`), its scores and the difficulty; choice per game |
| `client/bot-persona.js` | `BotPersona` | a bot seat's sparse emoji reactions, drawn from seeded weighted pools |
| `client/changelog.js` | `Changelog` | the title screen's changelog modal (`changelog.json`; technical entries behind a toggle) |
| `client/reactions.js` | `Reactions` | emoji reactions bar + floating layer |
| `client/chat.js` | `Chat` | room chat: the input row under the HUD log, limits, lines into the log, Bus `chat` |
| `client/session.js` | `Session` | the room session in sessionStorage (survives a refresh) |
| `client/match.js` | `Match` | **the table**: mode, my seat, seats per player, the active engine, the clock, the bot seat, deferred work while a move animates |
| `client/room.js` | `Room` | **the online room**: protocol handlers, presence, seat assignment, sync/desync, rematch votes, net box + banner, session save |
| `client/app.js` | (none) | screens, the lobby, the flow (start / rematch / back / leave), wiring, boot |

Stylesheets, in order: `client/css/base.css` (tokens, player colour variables, buttons,
inputs, modal, toast, loader) → `client/css/menu.css` (title, lobby, picker, settings,
changelog) → `client/css/game.css` (game layout, generic board, HUD incl. the generic
`.game-box`, overlay, banner, reactions) → `client/css/skin-mc.css` (Blocks board part
shared by both textured skins + Blocks UI part) → `client/games/chain.css` →
`client/games/five.css` (each game's board, classic first, then its textured-skin rules).

Other: `client/textures/*.png` — 16×16 Mojang block textures from the owner's own
1.12.2 jar (personal use; the textured skins stay opt-in). Only textures referenced from
CSS are kept. `client/sounds/*.ogg` — Minecraft sounds from the owner's own installation
(`~/.minecraft/assets/indexes/*.json` maps `minecraft/sounds/<path>.ogg` to
`~/.minecraft/assets/objects/<hash[0:2]>/<hash>`; personal use), only the files
`Sound.FILES` references. `README.md` is the short public readme; `CLAUDE.md` just imports this file.
`server/` (a 2022 PHP stub) was deleted; don't bring it back.

### Who owns what (the layering, top to bottom)

```
app.js      screens + lobby + flow            knows Match, Room, Settings, Opponent, …
Room        online protocol, presence, sync   knows Match (engine, seats), Net, Settings, Clock, Chat
Match       table: seats, engine, clock, bot  knows Games (engines), Clock, Bots, Opponent, BotPersona
Games/Engine/Hud   one engine per game        knows Rules, Log, Bus, the game's view; never the app
rules.js    pure loop                         knows nothing (no DOM, no settings, no Bus)
observers   WinChance, Sound, BotPersona      listen to the Bus only
```

A game plugs in at the bottom: rules + view + registration. Everything above is generic
and must stay that way — if a change needs `if (game === "chain")` anywhere above the
engine, put the behaviour into the game definition instead (HUD model, settings list,
summary parts, Bus events).

## Changelog (`changelog.json`, always kept up to date)

**Rule: every commit with a user-visible change adds an entry to `changelog.json` (root),
in the same commit.** Newest day first: `{ days: [{ date: "YYYY-MM-DD", entries: [{ type:
feature | improvement | fix | internal, text, refs: ["#12", "PR #1", "commit abc1234"] }] }] }`.
Write the text for players (what changed for them, one sentence), and link the issue / PR
/ commit in `refs` — `client/changelog.js` turns them into new-tab GitHub links and renders
the file into `#changelog-modal` from the title screen's 📜 button (fetched on demand,
first 7 days open, older days behind "Show older", so any length works). Internal-only
changes get `type: internal` or no entry. **Two audiences (#27):** the modal's "Show
technical changes too" toggle (`#changelog-tech`, off by default, remembered in
`localStorage["chainreact.changelog"]`) is the only way to see `internal` entries and
entries flagged `technical: true`; days left empty are skipped. **Flag generously** — the
owner wants the default list short: layout and spacing, naming, tooling, fixes of UI
glitches, and "meta" features (preferences, feedback link, the changelog itself) are all
technical. Unflagged = a rule or default that changes play, a new way to play (rooms,
spectators, chat, sounds, bots, home screen), or a fix that changes what happens in a game. No em dashes in texts (#24). `tests/unit/changelog.test.mjs` validates the
file (dates descending, known types, resolvable refs).

## Install as an app (Android)

`manifest.json` (name, `standalone`, navy theme/background, icons 192/512 "any" + a
`maskable` 512 with the artwork inside the safe zone for Android's adaptive icons) is
linked from `index.html` and copied by the build (`ROOT_EXTRAS`). The title screen's
`#btn-install` ("📲 Add to home screen") is hidden until the browser fires
`beforeinstallprompt` (Android Chrome and other Chromium browsers; never on iOS Safari,
which has no prompt — the owner wants the button only where it works), then calls
`prompt()` and hides itself; `appinstalled` toasts. The icon set (favicon, apple-touch,
192/512, maskable) is generated: a navy rounded tile with a 2×2 Chain React board, a cyan
and an amber glowing block with lamp dots — regenerate all sizes together if it changes.
No service worker (nothing is cached; the deploy's hashed assets handle freshness).

## Build & deploy

- `npm run build` (= `node build.mjs`) writes `dist/`: `index.html` + `assets/app.<hash>.js`
  (all client scripts in `index.html` order, esbuild-minified when available) +
  `assets/main.<hash>.css` (all stylesheets concatenated, `../textures/x.png` rewritten
  to hashed names) + `assets/textures/<name>.<hash>.png` + `assets/sounds/<name>.<hash>.ogg`
  (every `client/sounds/<file>` string in the JS bundle is rewritten to the hashed path —
  that is how `Sound.FILES` finds them) + the icon files. Hashes are content hashes →
  cache busting by filename. Env: `DIST_DIR`, `SKIP_MINIFY=1`.
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
  `Create room` + `Join room` (`#join-panel` with the code field appears on Join room) and
  under them the muted hint `#menu-online-hint` ("One room for up to 4 players, plus
  spectators." — the seat count itself is picked in the lobby, #28),
  section *Offline* with `Local multiplayer` (`#btn-local`) and `Against a bot`
  (`#btn-bot`), the foot with `#btn-install` (see Install) and `#btn-changelog`. No Look
  control here (owner: only in the preferences, #9). Never scrolls on a phone. The ⚙
  preferences button floats top-left on every screen.
- **Lobby** (`#screen-lobby`), same screen for local and online (`Match.mode`), in **three
  calm blocks** separated by a hairline (`.lobby-group`, one `border-top`), then one primary
  action:
  1. **Head** (`.lobby-head`): the kind label (`#lobby-kind`: "Room" / "Local game" /
     "Against a bot"), the room code (`#lobby-code`) with its hide / show eye button
     (`#btn-hide-code`, online only, see "Hidden room code") and — online only — one row of
     share actions (`#lobby-share`): the primary `Share link` (`#btn-share`) plus two small
     icon buttons, 📋 `#btn-copy-code` and 👀 `#btn-share-spectate` (both carry `title` +
     `aria-label`), so the three actions are not three equal buttons.
  2. **Group "Players"** (`#group-players`, hidden against a bot because everything in it
     is): the **Players** row (`#row-players`: the label plus the segmented `#set-players`
     with 2 / 3 / 4, #28 — in the lobby so everyone sees the room takes up to four; hidden
     against a bot by `Settings.setMode`; a count below the seats people already sit in is
     disabled, #34), one `.lobby-player` card per seat from
     `#tpl-lobby-player` (online only; as many as the *Players* control says; the name, a
     small `(you)` in `.lp-you`, and `#lp-<k>-status` "connected" / "not here yet" /
     "ready"; an absent seat gets `.absent` = a dashed, muted placeholder card; the card
     wraps its status onto a second line rather than cutting a long name off), and the
     notes `#lobby-status` / `#lobby-spectators` ("N spectator(s) watching"). **The coming
     seat controls go here**: "Watch instead" / "Take this seat" on the seat cards, and
     "Against a bot instead" while a two-player room waits, both under `#lobby-players`.
  3. **Group "Game"** (`#group-game`): the picker (one `.game-card[data-game]` per
     registered game, built by `Settings.init`; each card says "2 to 4 players" and a game
     that doesn't take the chosen count is grayed out, `.unsupported` + `disabled`, #28),
     its tagline (`#menu-tagline`), the *Opponent* row in bot mode (`#btn-opponent`) and
     the settings summary button (`#btn-settings` → `#settings-modal`).
  Then `.lobby-foot`: `Start game` (`#btn-start`, the one big primary button, its text also
  says why it is disabled) and a quiet text button `Leave room` / `Back` (`#btn-lobby-back`,
  class `btn quiet`). No chat in the lobby (#15) — chat lives in the game HUD only. The
  whole card must fit 360×780 without scrolling in all three looks (`mobile.test.mjs`,
  screenshots `mobile-lobby-<skin>.png`).
- **Game** (`#screen-game`): board + HUD ("hut"). Result overlay: `Rematch`, `Look at
  board` (hides it and opens the replay bar), `Change game` (→ lobby). The HUD has
  `Rematch` and `Back to room` too. `renderRematch()` in app.js is the only writer of the
  Rematch buttons' texts (Spectating / Rematch / Waiting… / Accept rematch).
- **Replay bar** (`#replay-bar`, #38): after "Look at board" a fixed one-row bar holds
  `|◀ ◀ "Move 12 / 30" (#replay-pos) ▶ ▶|` and the `#result-fab` "Show result" button
  (which lives inside the bar, so hiding the bar hides both). Every step calls
  `showReplay(ply, announce)` in app.js → `engine.preview(ply)`; the last ply turns the
  preview off (live position). `←`/`→` step, `Home`/`End` jump to the ends (ignored while
  an input has focus). `hideReplay()` (new game, rematch, back to room, leave, "Show
  result") drops the preview. Desktop: bottom centre; phones: above the HUD, `fitBoard`
  publishes `--hut-h` = the strip the HUD takes so the bar never covers its controls.
  Online, every step sends `review {ply}` so the whole room looks at the same move.
- `Match.mode` ∈ `local | bot | online`. Bot mode is the offline lobby with an extra
  *Opponent* row (`#btn-opponent` → `#bot-modal`). **One bot per game (#21)**, called
  "Bot" wherever a player sees it (`Opponent.NAME`; `Bots.botFor(game)` picks it): the
  modal is one step (description, scores, difficulty, Cancel / Play). Picking a game does
  **not** open it (#12): the default is the middle difficulty; the row shows the choice.
  You are seat 0, the bot seat 1.
- `phase` (app.js) ∈ `menu | lobby | game` — Room reads it through its `phase()` handler.
  `Match.gameNo` increments per started game (local too); `Match.startPlayerFor(g,
  players) = (g - 1) % players` → seat 0 starts game 1, then the next seat, round-robin.
  `Settings.setMode(mode)` is called on every mode change (`local` / `bot` / `online`):
  against a bot the lobby's *Players* row is hidden and the config says 2.
- The flow functions in app.js — `startGame(cfg, gameNo)`, `startFromLobby()`,
  `requestRematch()`, `backToLobby(announce)`, `leaveRoom()`, `openLocalLobby(withBot)` —
  are the only places that switch screens. Room calls `startGame` / `backToLobby` through
  its handlers when the protocol says so; Match never switches screens.

## Settings (`client/settings.js`)

Form in `#settings-modal` (opened from the lobby summary, closed by Done / backdrop;
number inputs are clamped on `change` and on close, never on `input`, so typing "12"
doesn't snap at "1"). Persisted in `localStorage["chainreact.settings"]` together with
`sizeFor` (remembered board size per game). Inputs have `autocomplete="off"` (Firefox
restores form values on reload).

- Shared rows (in index.html): board size (limits and default from the game's `size` +
  optional `minSize(cfg)`: chain 3–12, default 6; five 5–25, default 11 since #16 — a size
  remembered in `sizeFor` wins over the default; `cfg` holds every game field's current
  value), timer per player (Off default / 1 / 3 / 5 / 10 min / custom minutes). **Players**
  is not in the modal: it is the lobby's segmented control (`#set-players`, 2 default / 3 /
  4, `Settings.setPlayers(n)` / `Settings.players`; hidden and forced to 2 against a bot,
  #28). Every game declares `players: { min, max }` (default 2–4, `Games.register` fills
  it in); `Settings.supports(key)` says whether the selected count fits, the picker grays
  the others out and `selectGame` moves off an unsupported game to the first that fits.
  **Nobody may be pushed out of a seat (#34):** `Settings.setMinPlayers(n)` (called by
  `renderLobby` with `Room.online ? Room.occupiedSeats() : 2`) disables every smaller
  count (`title` = `Settings.MIN_PLAYERS_HINT`, "Someone would lose their seat. They have
  to leave the room first."), and `read()` / `write()` / `setPlayers()` lift the count to
  that floor, so the host never starts a game with fewer seats than people. A locked
  control (`setLocked`, #29) stays fully disabled; both paths share `renderPlayers()`.
- **Game rows are generated** into `#game-settings` from every registered game's
  `settings` list (`Settings.init` → `buildRows`). A setting is
  `{ key, label, type: "int" | "select" | "bool", def, min?, max?, unit?, options?, with? }`;
  `options` = `[[value, label], …]` for a select, `with` = a second `int` field in the same
  row that is enabled only while the checkbox is on (chain's `chainRule` + `chainLen`).
  The row is `<label class="row" id="row-<key>" data-setting="<key>">`, the input
  `#set-<key>`, key lowercased (`set-winlen`, `set-chainrule`, `set-chainlen`). A row is
  shown when the selected game's list contains its key. `#game-settings` is
  `display: contents`, so the generated rows space exactly like the fixed ones and hidden
  rows take no gap (#26). Today: five `winLen` (3–25,
  default 5, also the board's minimum), chain `speed` (Slow 1100 / Normal 750 / Fast 350
  ms) and `chainRule`/`chainLen` (win on N explosions, off by default, N default 15;
  owner dislikes the rule but wanted it available).
- `Settings.read()` returns the **config** a game starts with: `{ game, players, n,
  timer, timerSel, timerCustom, …every game field of every game }` (all fields travel so
  a mirrored settings message is complete for any game the room may pick). Engines get it
  as `config` (plus `startPlayer`) and read only what they need.
- Summary text: `n × n` · (`N players` when more than two) · `describeRules(cfg)` parts ·
  timer · `describeOptions(cfg)` parts (e.g. "7 × 7 · 5 in a row · 3 min timer",
  "4 × 4 · 3 players · no timer · 15-chain wins").
- Any change → `onChange(config)` → app sends `lobby {s}` to the friends (`Room.settingsChanged`).
  `Settings.write` runs silently (no echo) when applying the friends' settings.
- The **look is not a setting** (see Skins).

## Preferences (`client/prefs.js`, per device — the ⚙ button)

`#prefs-btn` (class `corner-btn`, a pill fixed top-left on every screen: "⚙ Settings &
Feedback" on desktop, "⚙ Settings" on phones via `.corner-long` / `.corner-short`, #25)
opens `#prefs-modal`: the **Look** control (the only `.skin-seg`, full width, no extra
label, #22; kept in sync by `Skins`), the **Sound** rows (master volume slider
`#pref-volume`, default 30 %; sound set `#pref-soundset`: follow the look / Classic /
Blocks; one checkbox per category `#pref-snd-<cat>`, categories in `Prefs.CATEGORIES` =
moves, explosions, results, turn, reactions, chat), **Streaming** (`#pref-hide-code`:
enter rooms with the code hidden, #19; `#pref-private-ip` "Keep my IP always private":
every connection is relayed through TURN, #30 — read by `Net` when the peer is created,
so it takes effect on the next room), **Feedback**. Stored in
`localStorage["chainreact.prefs"]` (`Prefs.get()` → `{ volume, soundSet, sounds: {…},
hideCode, privateIp }`, `Prefs.set(patch)` merges, clamps, persists, refills the form and calls
`onChange`). The modal is roomier than the settings one (`.prefs-rows` gap 14 px, 16 px
and 540 px wide on desktop, #25).
Never sent to the room, never part of `Settings.read()`. Layout rules: on phones
(`max-width: 899px`) `#screen-menu`/`#screen-lobby` get `padding-top: 56px` and
`#board-wrap` `padding-top: 52px` so cards and the board start below the two corner
buttons (⚙ left, 😜 right); `fitBoard` subtracts the wrapper's padding. `#net-banner`
already sits at 58px on phones. The MC skin restyles `.corner-btn` like `#react-toggle`.

- **Feedback** (#8): `#pref-feedback` in the preferences opens a GitHub "new issue" page
  (`Prefs.feedbackUrl()`) with the situation prefilled from `Prefs.init({ context })` in
  app.js: screen, mode, game, settings summary, players, seat, spectator, bot, connection,
  look, sound, viewport, `<meta name="version">` (build.mjs stamps the git hash + date;
  "dev" unbundled), browser, last 5 log lines — never the room code or chat text.

## Skins (`client/skins.js`, per device)

**Naming (owner's decision):** the textured looks are called **"Blocks board"** and
**"Blocks"** in every user-facing text (buttons, sound-set option, README, promotion) — the
word "Minecraft" must not appear in the UI or in public texts. Internal keys, CSS classes
and storage values stay `mcboard` / `mc` / `skin-mc*` for compatibility; this file may
still say "MC" when describing the origin of the textures.

One `.skin-seg` control, in the preferences modal only (`Skins.init` wires every
instance it finds, so more could be added), stored in `localStorage["chainreact.skin"]`, never
sent to the friend, never in the settings modal. The DOM is identical for every skin; a
body class switches the CSS and `Skins.names()` gives the player names.
- **Classic** (default, owner's favourite — don't touch its look): dark navy UI, cyan vs
  amber, rounded cells, lamps as dots. Names "Cyan"/"Amber"/"Lime"/"Rose".
- **MC board** (`body.skin-mcboard`): classic UI, Minecraft textures on the board, flying
  pieces, sparks, HUD player blocks and picker previews. Names "Diamond"/"Gold"/
  "Emerald"/"Redstone".
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
(`skin-mc.css`: diamond / gold / emerald / redstone blocks, matching glass). Glows use
`color-mix()`.

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
| `play(i) → Promise<bool>` | A move by the current player (own click, relayed friend move, bot). `false` if busy/illegal. Sets busy, `rules.place`, emits `game:move`, `hooks.onMoveApplied`, `await view.animateMove(ctx, i, me)`, `rules.conclude` → `finish` or next turn (`game:position`, `game:turn`, `hooks.onTurn`). Bails out if `state.over` became true during the animation. |
| `replay(history, outs = [])` | `Rules.apply` on the live state — the same `step`/`eliminate` the instant path uses — then renders and finishes or emits `game:position` + calls `onTurn`. Determinism here keeps every client in sync; `replay([], outs)` applies a flag fall one missed. |
| `finish(winner, why)` | Ends the game (also called for flag falls / remote timeouts): logs, renders, `Hud.overlay(...)` (title, `why` + `view.summary(state)`), emits `game:position` + `game:finish`, calls `onBusy(false)`, `onFinish`. |
| `eliminate(p, why)` | `Rules.eliminate` + "X is out." in the log (3+ players); the turn passes if it was theirs, the last one standing wins — with two players that simply ends the game ("Amber wins! Out of time!"). Returns false when nothing changed. |
| `abandon()` | Marks a running game over without a result (Back to room). |
| `hash()` | 32-bit fingerprint of cells/current/over/winner/movesBy/out; equal on clients that are in sync (used by `move`/`sync`). |
| `record()` | The game as data: `{ game, config, history, outs, over, winner, why }` — see "Game records". |
| `render()` | No-op until a board exists. Renders the shown position (the preview if there is one, else the live state): every cell (shared classes `p<k>`, `taken`, `last`, `can-place`/`locked`, then `view.renderCell`) and the HUD from `view.hud(...)`. |
| `isLegal(i, player)` | Pure check via the rules. |
| `preview(ply)` | **View only** (#38, the replay bar): show the position after `ply` moves (`Rules.replay(record(), ply)`) instead of the live one and re-render; `null` (or a `ply` at / past the end) goes back to the live position. Returns the new `previewPly`. It never touches the live state, the record, `hash()`, the session or the Bus, and while it is on every cell is `locked` and clicks are dropped, so a preview can never leak into play or into what the friends receive. |
| `previewPly` (getter) | How many moves the shown position has, `null` when the live position is shown. |

Hooks (built once in `Match`, the engine never sees the app): `names` (getter → names for
the current skin, bot seats show the bot's name), `mayPlay(p)` (may this device move for p
now: local seat + `live()`), `turnHint(p)`, `onCellClick(i)`, `onMoveApplied(i, p)`,
`onTurn(p)`, `onBusy(bool)`, `onFinish(winner, why)`. Tests build their own (`tests/unit/dom.mjs`).

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
**view-only** position next to the untouched live game, so "look at past games" later only
needs to keep records and step `ply` — still no engine change.
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
as the bar. MC skins: quartz tiles on obsidian, diamond/gold blocks as stones; hover
keeps the texture (no background transition on textured tiles — a flicker bug once).

## Board / HUD layout rules

- **Whose turn**: `#board.turn-p<k>` → 4px outline in the active colour. `fitBoard`
  subtracts 10px so the outline is never clipped on a full-width phone board.
- **Win chance** (`client/winchance.js`, an observer — no engine or game code involved):
  every player card has a `.win-bar` ("62 % win"). On `game:new` WinChance picks
  `Bots.estimator(game)` when the game has two players → `{ bot, stages, at(state, nodes) }`:
  the strongest registered bot that offers `evaluate(state, tools)` (a RAW score from
  player 0's view, ±Infinity when decided, deterministic for a node budget, may be async)
  mapped through the bot's **calibration** (`Bots.calibration(id, { scale, shift, brier,
  swing, … })` in its benchmark.js, fitted from seeded self-play by `scripts/calibrate.mjs`
  = `npm run calibrate`, also run by the benchmark; `Bots.toProbability` clamps to
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
- **Last move**: every cell has a `.last-marker` child; the engine adds `.last` to the
  newest history cell. Chain: static thin white border at the cell edge. Five: static
  white ring, **red** on the textured skins (white is invisible on quartz). Owner: no marker
  animation. Hidden while a chain cell primes/booms and once the game is over
  (`#board.over`).
- Board size = min(wrapper width, height) − 10 → `--board` (`fitBoard` in app.js, on
  resize and when `#hut` resizes). The page must **never scroll** on mobile: the HUD sits
  below the board in a compact two-row form (controls behind ☰); desktop shows the full
  HUD beside the board (sign, stats, game box, log, controls). `.players` is a 2-column
  grid, so 3–4 seats make two rows (the board shrinks accordingly on phones).
  `body.game-<key>` lets CSS target one game; `#board` gets the game key as class.

## Online play (`client/lib/net.js` + protocol in `client/room.js`)

- Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; `normalizeCode` maps O→0,
  I/L→1. Peer id = `chainreact-v1-<CODE>`.
- **Transport role**: whoever claims the room peer id is `host`; on `unavailable-id` the
  others become `guest` and dial the host — so "Create room" and "both type the same
  code" share `Net.open(code, handlers, preferredRole)`. The host keeps **one
  DataConnection per guest** (`conns`, each `{ c, id: "c<n>", seat, meta, lastPong }`):
  `Net.send(obj)` broadcasts from the host (guests send to the host), `Net.sendTo(id,
  obj)` / `Net.sendExcept(id, obj)` address one guest / all but one, `Net.peers` lists
  `{ id, seat, meta, open, silent }`, `Net.setSeat(id, seat)` tags a connection with the
  seat the app assigned. `Net.connected` = at least one open connection (host) / the
  host connection (guest). Handlers get the connection id: `onOpen(role, id)`,
  `onClose(reason, id)`, `onMessage(msg, id)` (`"host"` on a guest); `admit(meta,
  peers)` lets the app decide whether a newcomer may join. `handlers.preferHost` (a former
  host refreshing) retries the claim 4× before giving in. A guest whose dials hit
  `peer-unavailable` twice **takes over** the room id (`claimHost`), so the room lives
  on as long as anyone is in it and a host who left can come back by the same link (it
  then joins as guest). Roles can therefore swap; the app never derives seats from them.
- **Seats** (`Match.me`, player number 0…`players`−1, −1 = none) are sticky for a room
  visit: creator = 0, session restore = saved seat, a joining guest gets one from the
  host. Handshake on every (re)connect: guest → `hello {seat, spectate, rematch}` (seat
  −1 = none) → host assigns (`msg.seat` if it is < `players` and free, else the first
  free seat, else −1), tags the connection (`Net.setSeat`), answers `state {you, phase,
  settings, config, g, rematch}` to that guest (+ `sync` in a game) and a `roster` to
  everyone → the guest takes `you`, mirrors settings, starts/continues the game, answers
  `sync`. `rematch: true` = "I pressed Rematch while you were away": the host counts the
  vote and passes it on as a `rematch` message, so a request never gets lost. The
  number of seats is `config.players` (`playersNow()`: the running game's, else the
  settings'); when the *Players* setting changes the host **reseats** (`reseat`): seats ≥
  `players` are taken away (`state {you: -1}`), people without a seat get a free one.
- **Presence** (`presentSeats()`): the host derives it from its connections (an open
  connection with that seat, not in Room's `left` set), guests from the host's `roster
  {present[], spectators, left[]}` message (sent on every change: hello, close, leave,
  reseat). `allHere()` = every seat filled and my connection up; `live()` = `!online ||
  allHere()` gates input and the clock (`syncLive()` pauses/resumes on every presence
  change). Start needs `allHere()` ("Waiting for your friend…" with two seats, else
  "Waiting for N more player(s)…"). The in-game banner (`updateBanner`) says who is
  missing (2 players: the classic "Your friend left the room…" / "seems to be away"
  texts; more: "Waiting for Lime, Rose (left the room). The game resumes when everyone
  is back."). Texts use `who(seat)` = "Your friend" with two seats, else the colour name.
- **Accepting a guest** (`accept` in net.js): the guest's dial carries `metadata {seat,
  spectate}`; once the data channel is open the host answers `welcome` (the guest
  attaches only then) or `full`. A dial with a seat that an existing connection holds
  replaces that connection (the same person back after a refresh). Otherwise the app's
  `admit(meta)` decides (`admitGuest`: a free seat exists, or the seat it names is free,
  or it wants to spectate); refused newcomers get `full` — unless some connection has
  stopped answering pings (> 6 s): that stale one is dropped in the newcomer's favour.
  **The same peer id dialling again always replaces its old connection** (newest wins): a
  guest whose first dial stalled retries after 8 s, and without this the host counted one
  spectator twice on the slow CI runner (a seat-less dial is not deduped by seat).
  `Net.peer` is exposed for that e2e check only.
  `full` is not final on the guest: it shows "This room is full…" (status `error`) and
  quietly redials every 5 s, because the "friend" may be its own stale connection the
  host hasn't noticed as dead yet (a slow CI machine hit exactly that). Connection
  handlers check the entry is still in `conns` (guest: `conn === c`) so a replaced
  connection's close is ignored. A dial that gets no data channel within 8 s is closed
  and retried.
- **Relay**: `onMessage` on the host stamps every guest message with `from` = the
  connection's seat and forwards the types in `RELAY` (`move, chat, react, tolobby,
  rematch, timeout, lobby, review`) to the other guests (`Net.sendExcept`) before handling
  them itself; messages the host originates carry `from: Match.me` (`netSend`). So every
  message everywhere says which seat sent it (−1 = a spectator). `sync` is pairwise
  (host ↔ one guest: `sendSyncTo` on hello, broadcast `sendSync` after a rematch or when
  the host wants everyone's state), `state`/`roster` come from the host only.
- A former host whose id was taken over while its tab slept (`unavailable-id` with
  `everConnected`) joins as guest at once; only a fresh page (refresh) retries the claim.
- **Newest intent wins** (`Room.rev`): every phase change (start, rematch, back to room)
  bumps a room-state revision on both sides. `hello` and `state` carry `rev, phase,
  config, g`; a host whose guest reports a higher `rev` adopts the guest's phase before
  answering (`adoptRoomState`), a guest follows the host when `rev` is equal or higher.
  So "one tab died, the other went back to the room / started a rematch, the tab comes
  back" never drags anybody back into a stale game, whoever ends up hosting. The
  revision is part of the session, so a refresh keeps it.
- **Desync detection** (`Game.hash()`: FNV-1a over cells/current/over/winner/movesBy/out):
  `move` carries the sender's hash before the move, `sync` the sender's hash. A move
  whose hash doesn't match is not applied; a sync is requested instead. `applySync`:
  identical prefix + longer history → the short side replays the tail; a prefix
  mismatch, a hash mismatch at equal length, or the host still lacking moves the guest
  already sent (`syncSentAt`) → `resolveDesync`: the host just re-sends its sync,
  the guest rebuilds the game from the host's history (`rebuiltAt` remembers the
  attempt). A second mismatch at the same point → both back to the room with a toast,
  never two different games.
- Share link = `<page URL without query>?room=CODE`; `?room=` on load auto-joins;
  `history.replaceState` keeps `?room=` (and `&spectate=1` for a spectator) in the URL
  while in a room. Spectate link = `?room=CODE&spectate=1` (see Spectators).
- **Hidden room code** (#19, streamers): `Room.hideCode(on)` / `Room.codeHidden` — the
  lobby code and the HUD net box show `•••••` (`Room.codeText()`), `setUrlRoom` drops
  `?room=` from the address bar, the session stores `codeHidden`, and the boot rejoins a
  hidden room from the session alone (no `?room=` needed; a visible room still needs the
  matching `?room=`). `Net.code`, the share / spectate links and `Copy code` are untouched
  — hiding is display only, per device, never sent to the room. The lobby's eye button
  (`#btn-hide-code`, 👁 / 🙈) toggles it; `Prefs.hideCode` makes new rooms start hidden
  (`Room.enter(code, preferHost, seat, spectate, hidden = Prefs.get().hideCode)`).
- Messages (JSON over reliable DataConnections; every message carries `from` = the
  sender's seat; game messages carry `g` = gameNo): `hello {seat, spectate, rev, phase,
  config, g, rematch}`, `state {you, settings, rev, phase, config, g, rematch}` (host →
  one guest), `roster {present, spectators, left}` (host → all), `welcome`/`full`
  (transport level, host → guest on accept/reject), `lobby {s}` (settings changed;
  relayed; the host reseats), `start {config, g}` (host started), `start-request` (a
  guest asks; host is authoritative), `tolobby` (anyone; abandons a running game;
  relayed), `sync {g, history, outs, clocks, h}` (on (re)connect / on gaps: the shorter
  side replays the missing tail + eliminations; deferred with `Match.whenIdle(…, "sync")` while
  animating), `move {i, n, g, h}` (`n` = history length before the move; queued in
  Room's `incoming`, applied when idle and `n` matches, else a sync is requested;
  relayed), `timeout {p, g}` (only the owner of the flagged clock decides — clocks drift;
  relayed; deferred through `Match.flagged` → `whenIdle` while animating; → `engine.eliminate`), `rematch
  {g}` (every seat must press: Room's `votes`; relayed; the overlay button shows
  "Waiting for opponent…" / "Waiting for others… (k/N)" / "Accept rematch"), `review
  {ply, g}` (#38: I am looking at the position after `ply` moves of the finished game;
  relayed; receivers in the same finished game show the same ply and open the replay bar,
  spectators included), `react
  {e}` (relayed; dot in the sender's colour), `chat {text}` (relayed, see Chat), `leave`
  (sent 250 ms before closing; the app treats that seat as gone at once — Start is
  disabled before the connection actually drops; the host tells the others via
  `roster.left`), `ping`/`pong` every 3 s per connection, 12 s silence → that connection
  is dropped → the guest redials. `rematch` with `g <= gameNo` is ignored (duplicates).
  Handlers live in `HANDLERS` in room.js and receive `(msg, id)`; the state they keep is the `r` object at the top of room.js (`rev, roster, left, netDetail, votes, incoming, syncSentAt, rebuiltAt`) — everything about *who sits where* is `Match`.
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
  meanwhile is ignored) with `Net.peerConfig(servers, relayOnly)`: **"Keep my IP always
  private"** (#30, `handlers.relayOnly()` = `Prefs.privateIp`) sets `iceTransportPolicy:
  "relay"`, so this side offers relay candidates only and nobody in the room learns its IP
  (the other side may still connect directly to the relay; only my own preference relays
  my side). `Net.iceInfo` = `{ relayOnly, turn, servers }` of the current peer; relay
  demanded but no TURN entry in the list (Metered unreachable) → status `error` with
  `NO_RELAY_TEXT` on every dial. The e2e `online` suite verifies the selected candidate
  pair is `relay` on the host's side through `getStats()`. After 3 dials whose data channel never opened while the host is
  registered (`channelFailures`, or repeated `webrtc` errors) the status becomes `error`
  with a plain hint to try Wi‑Fi.
- **Guest dial handshake**: the guest listens for data from the start (under load the
  host's first message can arrive before the guest's own `open` event) and attaches once
  the channel is open *and* the host sent `welcome` (a host `ping` counts too).
- Statuses: `idle, connecting, waiting, connected, reconnecting, signaling, error`.
  `signaling` = broker socket dropped (tab suspended); an established DataConnection
  keeps working without the broker → no in-game banner for it. The host is `connected`
  while at least one guest is; losing the last one → `reconnecting`, losing one of
  several keeps `connected` (the banner then comes from presence, not from the status).
  `everConnected` picks the wording ("isn't here yet" vs "seems to be away");
  `ERROR_TEXT` maps PeerJS error types to plain sentences. `visibilitychange`/`online` →
  `Net.retryNow()`. The HUD net box shows "Waiting for N…" when seats are empty (3+).
- Page refresh: `sessionStorage["chainreact.session"]` = code, me (seat), spectator,
  role, gameNo, rev, phase, config, history, outs, clocks, codeHidden. With a matching
  `?room=` (or a hidden code) the board is rebuilt from it (`replay(history, outs)`), then
  the handshake fills in the rest.
- Takeover with several guests: every guest that misses the host twice tries to claim
  the id; one wins, the others get `unavailable-id` and dial it. The new host keeps its
  own seat, hands the others theirs back on `hello`, and a spectator that happens to
  win the claim stays a spectator (`onRole` gives seat 0 only to a seatless non-spectator).

### Spectators (`Match.spectator`, seat −1)

Nobody is turned away: `admitGuest` always says yes, so whoever joins when every seat is
taken becomes a spectator (the host's `hello` finds no free seat → `state {you: -1}`),
and the **Spectate link** (`?room=CODE&spectate=1`, `#btn-share-spectate` in the lobby)
makes someone a spectator on purpose even with a free seat (`hello {spectate: true}`;
`reseat` never hands such a connection a seat, a plain-link spectator gets one when a
seat frees up or *Players* grows). Spectators get everything the host sends (`state`,
`roster`, `sync`, relayed `move`/`chat`/`react`/…): they see the board live with every
cell `locked` (`makeSeats` → all seats `remote`, `mayPlay` false), "spectating" as the
turn hint, "Spectating" in the HUD net box, on the lobby's Start button and on both
Rematch buttons (disabled; a rematch request never shows them the overlay prompt), can
chat ("Spectator: …", class `chat x`) and react (white dot), and step through a finished
game with the replay bar for themselves (their `review` never reaches anyone else). `#lobby-spectators` shows
"N spectator(s) watching" from `roster.spectators`. The session stores `spectator`, so a
refresh keeps spectating; `metadata {spectate}` goes with every dial. The sound module
hears a neutral `over` for them. A spectator that wins a host takeover stays seatless.
**Spectators only watch (#29):** the host refuses `Room.PLAYERS_ONLY` messages (`move,
timeout, rematch, tolobby, lobby, start-request, review`) from a seatless connection before
relaying (`Room.accepts(msg, seat)`; a refused `lobby` gets the host's settings back so the
sender's view is corrected) — the same veto path also drops a `lobby` message whose
`s.players` is below `Room.occupiedSeats()` (`Room.keepsSeats(msg, occupied)`, pure), so a
stale or forged message cannot take anybody's seat (#34). `Settings.setLocked(true)` (from `renderLobby`) disables the
picker, the players control and every settings input (`body.settings-locked`,
`#settings-locked-hint`), and in the game the spectator's HUD button says "Leave room"
(leaves the room instead of sending everyone `tolobby`) while the overlay's "Change game"
is hidden (`renderRematch`, re-run on every seat change through `Room.setSeat` →
`onVotes`). Chat and reactions stay allowed.
The old "room is full" answer only remains in net.js for an app that refuses newcomers.

### Gotchas already hit
- Host: the `connection` event fires before the data channel is open → attach on
  `c.on("open")` (or `c.open`), else the first `send` is silently dropped.
- `peer.destroy()` emits `close` synchronously → peer handlers check they still belong
  to the current peer (`bindPeer`), otherwise a demoted host re-scheduled its claim.
- `Room.enter` → `Match.reset("online", …)` clears config/gameNo (a leftover local config once
  made the host skip starting).
- `engine.render()` runs from net callbacks; the engine guards it until a board exists.
- Headless tests: pick the CDP target with `type === "page"`; disable the cache.
- The starter rotates per started game in a lobby, offline too: an e2e test that starts
  its Nth game must not assume seat 0 starts (`party.test.mjs` reads `state.current`).
- Eliminations are not moves: they live in `state.outs` with the history length they
  happened at, never inside `history` (five's `conclude` reads the last history entry,
  `move.n` counts moves). `sync`, the session and `replay` carry them separately.
- The host stamps `from` on every guest message before relaying; guests never trust a
  `from` they wrote themselves. A relayed `lobby` change makes the host reseat, so a
  guest reducing *Players* can drop another guest to spectator — by design.
- `Room.leave` shuts the transport down 250 ms later (so the `leave` message goes out);
  `Room.enter` cancels that timer — otherwise leaving and creating a room within 250 ms
  killed the new room (`Net.open` already closes the old one). The hide-code e2e does that.
- `pkill -f <pattern>` kills your own shell if the pattern is in the command line.

## Events (`Bus`)

Fire-and-forget notifications for observers (WinChance, Sound, BotPersona subscribe here;
the log emits too so a chat could mirror it). Current events and payloads (`game` = the
game key everywhere):
`game:new {game, config, state}`, `game:move {game, cell, player}` (a piece was placed,
before its animation), `game:position {game, state}` (**the settled position changed**:
new game, a move settled, replay, elimination, end — the one event a position observer
needs), `game:turn {game, player, state}` (after a move settled and the turn passed; not
on replay), `game:finish {game, winner, why, state}`, `chain:prime {cells, player, ms}`
(full cells start blinking; `ms` = how long), `chain:explode {cells, player, chain}` (one
wave), `reaction {emoji, theirs}`, `chat {text, from, mine}` (a chat line was shown),
`log {text, cls}`. A game may add its own events (`<key>:…`) for sounds and observers.

## Sounds (`client/lib/sound.js`)

`Sound.init({ seats, player })` subscribes to the Bus; `seats()` returns the seat kinds
(`Match.seats.map(s => s.kind)`) and is the only thing the module knows about the game.
- **Mapping** (`Sound.map(event, data, kinds)`, pure): `game:move` → `place`;
  `chain:prime` → `prime` (the fuse, stopped after `ms`); `chain:explode` → `explode`
  (gain and pitch grow a little with the chain length); `game:finish` → `win` / `lose`
  from the local human's perspective (`Sound.me(kinds)`: exactly one local seat among
  non-local ones — online or against a bot; otherwise −1 → neutral `over`, also for a
  draw; local two-on-one-device and spectators therefore hear `over`); `game:turn` →
  `turn` only when the seat is local and someone else (friend/bot) just moved; `reaction`
  → `reaction` (theirs a bit lower); `chat` → `chat` for other people's lines only.
- **Gate**: `Prefs.volume` (0 = silent; gain = `(volume/100)^1.6`) and the category of the
  cue (`Sound.CATEGORY`: place → moves, prime/explode → explosions, win/lose/over →
  results, turn → turn, reaction → reactions, chat → chat). What passes lands in
  `Sound.log` (last 30 `{ name, set, at }`, the e2e hook) and goes to the player.
- **Sets**: `Sound.set` = `Prefs.soundSet` or, on `auto`, `classic` for the Classic look and
  `mc` for both Minecraft looks. `classic` synthesizes everything with WebAudio (short
  tones and filtered noise, deterministic noise buffer); `mc` plays `Sound.FILES`
  (stone1 = place, fuse = prime, explode1 = explode, levelup = win, anvil_land = lose,
  bass = over, pling = turn, pop = reaction, orb = chat), fetched + decoded lazily
  (all preloaded on unlock when the set is `mc`; a cue whose file isn't decoded yet is
  skipped, never delayed).
- **Autoplay rule**: the `AudioContext` is created on the first `pointerdown`/`keydown`/
  `touchstart` (`Sound.unlocked`); until then cues are logged but inaudible. Tests
  dispatch a `PointerEvent("pointerdown")` on `window`. `Sound.state` = the context state.
  A page without `AudioContext` (jsdom) never throws — the player is a no-op.
- "Play a test sound" in the preferences modal plays `turn`. The whole module is
  fail-safe: any player exception is swallowed.

## Seats, bots and more players (`client/match.js`)

`Match.seats[p] = { kind }` is built per game by `makeSeats`: `local` (this device moves for
it), `remote` (a friend) or `bot`. The engine hooks live in Match: `mayPlay(p)` = local seat
+ `live()`; `onTurn(p)` calls `botTurn(p)` for a bot seat: after `THINK_MS` (350 ms, so it
doesn't feel instant) it asks the bot instance for a move on a **clone** of the state,
re-checks that the same game is still on that turn (`running`, `gameNo`, busy, over), falls
back to a random legal move if the bot throws or answers illegally, then `engine.play(i)`
like a click. `Match.names` shows "Bot" (`Opponent.NAME`) on its seat. Player count is
`config.players` (2–4 from the settings; 2 against a bot): rules, `Rules.pass`, `Clock`,
HUD and lobby cards are written for N, the CSS has colours and textures for 4 seats, the
host relays. "Play on this device" with 3–4 people = all seats `local`; a flag fall
eliminates the seat (`Match.flagged(p)` → `engine.eliminate`), with two players it ends
the game as before.

`Match.whenIdle(fn, key?)` runs `fn` now if no move animates, else once the engine is idle
(a key replaces an older entry with the same key): Room defers a `sync` there, flag falls
are deferred there, and `onIdle()` (Room drains its move queue) runs after the deferred work.
`Match.start(cfg, gameNo)` / `stop()` / `reset(mode, me, spectator)` / `setSeat(me,
spectator)` / `record()` / `syncClock()` are what app.js and Room call.

## Bots (`client/bots.js`, `client/bots/<id>/`)

Bots are pure and headless: no DOM, only the game's rules module + the toolset. The same
code runs in the browser and in Node (`scripts/headless.mjs` loads util, rules, bots.js and
every bot folder into a bare VM — script list parsed from `index.html`).

- **Registry**: `Bots.register({ id, name, game, version, description, difficulties:
  [{ id, label }, …], create(tools), baseline? })` (validated: slug id, ≥ 1 difficulty,
  create fn, boolean `baseline`). `Bots.get/list/forGame(game)`, `Bots.benchmarkOf(id)`.
  **One bot per game (#21):** `Bots.botFor(game)` = the best-rated bot without `baseline`
  (Creeper, Sensei), or — while a game has no real bot yet — its Random baseline, so
  "Against a bot" always works. The Random bots are `baseline: true`: the benchmark and
  calibration opponent and the illegal-move fallback, never offered to players and not
  benchmarked themselves (no `benchmark.js`). Players see every bot as "Bot"; the ids and
  `name`s stay for the code, the benchmark output and the docs. Rules modules register themselves
  (`Rules.register("chain", ChainRules)` → `Rules.of(key)`) so bots find them without the
  DOM-bound engine.
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
  move — depth, value, a `forced` note — and the deadline that counted its nodes; both
  bots report, `Match.botInfo` collects it with the move, the time and the budget for the
  dev panel, #31). Rules modules are also reachable directly (`tools.rules`: chain `tally`,
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
- **Benchmark** (`npm run benchmark` = `scripts/benchmark.mjs [id…]`): every real bot
  (not the baselines) plays a seeded series against the Random bot of its game (chain 100 games 6×6, five 200 games
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
  estimate, color })` in `Match.start` (bot mode), `detach()` in `Match.stop` / `reset`. Listens
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

## Chat (`client/chat.js`) and the logs (`client/lib/log.js`)

- `Log.line(id, text, cls, name?)` prepends one line (newest first in the DOM; the box
  is `column-reverse`, so the newest shows at the bottom), keeps `Log.MAX_LINES` = 40.
  `Log.add(text, cls)` → `#log` + Bus `log`; `Log.chat(name, text, cls)` → `#log` (bold
  `name: ` + text, class `chat p<k>` / `chat x`). `Log.clear()` (new game) removes
  everything but `.chat` lines, so the conversation survives a rematch. Text goes in via
  `textContent` only — never HTML. The lobby log (`#lobby-log`, `Log.room`) was removed
  with the lobby chat (#15); join/leave show on the seat cards and in `#lobby-status`.
- **Row**: `#chat-row` (`#chat-input` + `#chat-send`) under the HUD log — the only chat
  input (#15). `Chat.enable(online)` toggles `body.online` and the inputs' `disabled`; the
  row only renders while online (`body.online`). Desktop: the HUD log scrolls
  (`max-height: 150px; overflow-y: auto`), the row sits under it. Phones: the log shows
  its last two lines (40px) and the chat row is behind ☰ (`#hut.show-controls`). The
  lobby card is tighter on phones (gap 8, padding 16, smaller seat cards) so an online
  lobby with four seat cards fits 360×780.
- **Rules**: `Chat.send(text)` trims and collapses whitespace, cuts to `Chat.MAX_LEN` =
  200, allows one line per `Chat.SEND_EVERY` = 300 ms, refuses when not online, shows
  my line at once in my colour, emits Bus `chat {text, from, mine: true}` and calls
  `onSend(text)` → `Room.say(text)` = `Net.send({ t: "chat", text, from: Match.me })`. `Chat.receive(msg)`
  applies the same length and rate limits (one accepted per 300 ms), colours the line
  with `msg.from` (−1 / unknown → "Spectator", class `x`) and emits `chat {…, mine:
  false}` (the sound module pings for other people's lines only). Enter in either input
  sends. Nobody echoes a line back to its sender.

## Emoji reactions (`client/reactions.js`)

`#react-bar` top-right, starts collapsed behind the 😜 toggle; emojis 😂 🔥 💀 🤡 😱 👏 👍
😎 🫡 😄 🥰 😲 😔 👋 🚨 🤖 + "L"/"EZ"/"GG" chips (the bar's own box never catches taps —
`pointer-events: none` except the list and the toggle — and the toggle sits on the top
edge next to ⚙, #7/#13; the expanded list stops 124px short of the left edge). `Reactions.place()` (called after every `fitBoard`) puts `#react-layer` **right
next to the board** when there is ≥ 66px of space (desktop), else in the free strip
above the full-width board (or below it if that's bigger) — never over the board, never
off-screen. Emojis drift right → left while falling the layer's height (wobble, fade,
max 14 on screen). **Speed follows the rate** (#17): `Reactions.durationFor(recent)` with
`recent` = reactions shown (own + received alike) in the last `RATE_WINDOW` 3 s before
this one: 0 → `SLOW_MS` 4000 (a lone reaction can be seen), 1 → `MEDIUM_MS` 2800, ≥ 2 →
`FAST_MS` 1900 (spam stays quick); no randomness beyond the wobble. Spam is allowed on
purpose (~8/s; the receiver accepts one per 100 ms and only values from its own button
set). Friend's reactions get a dot in their colour. `#net-banner` sits at 58px on phones so it stays clear of the toggle.

## Tests (`npm test` = unit + e2e; CI runs both before every deploy and on every PR)

- **Unit** (`npm run test:unit`, Node's built-in runner, `tests/unit/*.test.mjs` +
  `client/bots/**/*.test.mjs`; `bots.test.mjs` = framework + bot conformance, see Bots):
  `rules.test.mjs` runs the pure rules in a bare `vm` context (no DOM; 2- and 3-player
  rotation, elimination, legalMoves, draw). `dom.mjs` loads `index.html` + every client
  script except `app.js` into jsdom (script list parsed from index.html; `Element.animate`
  polyfilled) for `framework.test.mjs` (`Rules.step/apply/replay` == engine play, the
  generic HUD from the model, settings rows generated from the definitions, Match seats /
  bot seat / `whenIdle` / `record`, Session), `chain.test.mjs` (caps, waves, board-decided
  stop, win, chain rule, replay == play, hooks, HUD), `five.test.mjs`, `clock.test.mjs`
  (call `C.setup(0)` + `w.close()` at the end or the interval keeps the file alive),
  `net.test.mjs` (codes), `prefs.test.mjs` (defaults, clamping, persistence, form wiring),
  `sound.test.mjs` (event → cue mapping with a fake player, perspective, prefs gate, sound
  sets), `chat.test.mjs` (log boxes, limits, HTML safety, offline, chat survives a new
  game), `reactions.test.mjs` (float duration from the recent rate with a mocked clock,
  own + received, rate limits), `winchance.test.mjs` (frozen while animating, stages,
  smoothing), `replay.test.mjs` (#38: the engine's view-only preview — the position after n
  plies, HUD and board classes, locked cells, no Bus events, the live state / record / hash
  untouched, `preview(null)`), `persona.test.mjs`, `changelog.test.mjs`, `calibrate.test.mjs`, `puzzles.test.mjs`,
  `party.test.mjs` (3–4 players: `out`/`remaining`/pass in the pure rules, engine
  `eliminate` + `replay(history, outs)` == live play, two-player flag fall, settings
  players row / bot mode, the min-players floor and `Room.keepsSeats` of #34),
  `build.test.mjs` (`SKIP_MINIFY=1 DIST_DIR=<tmp>`; hashed names, icons, deterministic).
  Cross-realm arrays: compare via `JSON.stringify`, not `deepStrictEqual`.
- **E2E** (`npm run test:e2e`, `tests/e2e/*.test.mjs`): `harness.mjs` starts a static
  server (port 0) and headless Chrome via CDP (no Playwright; Node 22 `WebSocket`/`fetch`;
  Chrome from `$CHROME` or `google-chrome`). Helpers: `goto` (waits for scripts + the
  preloader), `ev`, `click/set/check/text`, `move(i)`/`idle()`, `state()`, `randomGame()`,
  `noScroll()`, `emulate(w,h)`, `screenshot(name)` (to `tests/e2e/shots/`, git-ignored;
  uploaded as artifact on CI failure), `waitFor`. Specs: `local-flow` (incl. the replay bar: step first / prev / next / last, the label, the
  last-move marker, a click in a preview plays nothing, "Show result" and a rematch close
  it), `settings`,
  `prefs` (⚙ on every screen, look sync, persistence, sounds: locked until a gesture,
  cues logged in order, mc files fetched, mute; phone: clear of cards/board/😜,
  landscape), `skins` (computed styles per skin), `mobile` (360×780: title, local lobby,
  an online-shaped lobby with four seats in every skin — share row on one line with
  `Share link` wider than the two icon buttons, the two groups, seat names never cut off,
  no scroll, screenshots `mobile-lobby-<skin>.png` — game, overlay, replay bar above the HUD), `online` (two browsers through
  the real PeerJS broker: join by link, settings mirror, guest start, move sync,
  reactions, chat both ways (colour, text only, HUD input), guest refresh, tolobby,
  switch game, rematch, host refresh, replay of a finished game stepped from both sides,
  guest leave +
  rejoin, host leave → guest takes over → host returns as guest, hide the room code:
  bullets + bare URL + copy still works + refresh rejoins hidden + the preference;
  `SKIP_ONLINE=1` skips),
  `online-edge` (third player → spectator, players stay connected, a duplicate dial from the
  same peer replaces the old connection; both refresh in the lobby; guest closes the
  tab mid-game without goodbye and returns by link; rematch asked while the friend was
  away; host's tab dies, guest goes back to the room, host returns → both in the lobby;
  a corrupted guest board is rebuilt from the host; a board that keeps differing sends
  both back to the room; both type the same new code at once), `party` (offline: four
  on one device with rotation and alternating starter, three in Chain React with
  elimination by the rules and the MC textures of seats 2/3, bot mode = 2 players),
  `online-spectate` (**three browsers**: a third joins a running two-player game as a
  spectator — locked board, moves arrive, chat as "Spectator", refresh keeps spectating,
  follows a rematch, spectate link with a free seat, leaving drops the count),
  `online-party` (**three browsers**: players 3, seats 1 and 2, start waits for
  everyone, moves by every seat relayed to everyone, chat/reaction colours, a guest
  refresh restores seat + board, rematch by every seat, one Back to room moves all, the
  players control cannot drop below the people in the room and the host refuses a forged
  `lobby` that tries it, #34),
  `bot` (offline vs bot: the one-step modal with scores and difficulty, "Bot" in the HUD, bot moves by itself, rematch), `dist` (built bundle: hashed assets only,
  preloader, playable, hashed sound files fetched after the audio unlock). Files run 2 at a time; each launches its own Chrome. `B.blank()`
  navigates to about:blank (a closed tab); outline colours transition for .25s → wait
  before reading computed styles. Any new join/rejoin behaviour gets a scenario in
  `online-edge` — the owner wants joining to feel rock solid.

## Folders that are never deployed

`docs/` (`docs/bots.md` = bot system reference and the list of current bots — keep it in
step with the code), `scripts/` (headless loader, puzzle runner, benchmark, puzzle solvers/generators,
verify, screenshot tour), `tests/`. The deploy uploads `dist/`
only; `build.mjs` bundles nothing outside `index.html`'s tags and `client/textures`.

## API at a glance (what a change must keep working)

Every global is an IIFE in `client/`; these are the contracts other code relies on.

| Global | Public surface |
| --- | --- |
| `Util` | `$`, `sleep`, `clamp`, `restartClass`, `load/save/remove(storage, key[, value])`, `fromTemplate(id, k)`, `toast` |
| `Bus` | `on(event, fn) → off`, `off`, `emit(event, data)` — events listed in "Events" |
| `Log` | `add(text, cls)`, `chat(...)`, `clear()`; 40 lines, `#log` only |
| `Clock` | `setup(seconds, onFlag, players)`, `setActive`, `pause`, `resume`, `stop`, `snapshot`, `restore`, `isEnabled` |
| `Net` | `open(code, handlers, preferredRole)`, `send`, `sendTo/sendExcept` (host), `leave`, `retryNow`, `randomCode`, `normalizeCode`; getters `code, role, status, connected, peers`; handlers `onStatus, onRole, onOpen, onClose, onMessage, preferHost, metadata(), admit` |
| `Install` | `init()`, `offered` |
| `Rules` | `base(config)`, `pass(state, alive)`, `remaining`, `index`, `inside`, `register(key, rules)`, `of(key)`, **`create(config[, rules])`, `step(rules, state, i) → result|null`, `eliminate(state, p, why)`, `apply(rules, state, history, outs) → applied`, `replay(record, ply) → state`** (`rules` = module or key) |
| rules module | `create, ownerOf, isLegal, legalMoves, place, settle, conclude, estimate` (+ game helpers) — pure |
| `Games` / engine | `register(def)`, `get/has/keys`, `positionAt(record, ply)`; engine `state, config, previewPly, newGame, play, replay, preview, finish, eliminate, abandon, render, isLegal, hash, record` |
| `Hud` | `build(players, title)`, `render(state, hooks, model)`, `overlay(name, winner, sub)` |
| `WinChance` | Bus-driven; `display`, `estimator`, `REFINE_MS`, `SMOOTH`, `DECIDED` |
| `Bots` | `register, get, list, forGame, botFor(game), create(id, {me, difficulty, seed, players, budget}), tools(game, opts), playout, rng, validate, benchmark/benchmarkOf, calibration/calibrationOf, estimator(game) → {bot, stages, at(state, nodes), quick}, toProbability(raw, cal), ESTIMATE_STAGES` |
| bot definition | `id, name, game, version, description, difficulties [{id, label, nodes}], create(tools) → {move(state)}, evaluate?(state, tools) → raw, baseline?` |
| `BotPersona` | `attach({bot, seat, game, state, estimate, color, delays?, cooldownMs?})`, `detach()`, `POOLS` |
| `Skins` | `init({onChange})`, `set(key)`, `names()`, `current` |
| `Settings` | `init({onChange, onSelectGame})`, `read()`, `write(cfg)`, `selectGame(key, announce)`, `summary(cfg)`, `setMode(mode)`, `setPlayers(n)`, `setMinPlayers(n)`, `setLocked(on)`, `supports(key)`, `MIN_PLAYERS_HINT`, `game`, `players`, `minPlayers`, `locked`, `fields` |
| `Prefs` | `init({onChange, context})`, `get() → {volume, soundSet, sounds, hideCode, privateIp}`, `set(patch)`, `open/close`, `feedbackUrl()`, `CATEGORIES`, `isOpen` |
| `Opponent` | `init({onDone})`, `open(game)`, `current(game) → {id, difficulty, def}`, `summary(game)`, `NAME` ("Bot") |
| `Reactions` | `init({onSend})`, `receive(emoji, color)`, `place()`, `durationFor(recent)` |
| `Chat` | `init(...)`, `send`, `receive(msg)`, `enable(on)` (see chat section) |
| `Sound` | `Bus`-driven; `play(cue)` for tests, unlock on first gesture |
| `Changelog` | `init()`, `open/close`, `render(doc[, all])`, `refUrl(ref)`, `technical(entry)`, `showTechnical`, `SHOW_DAYS` |
| `Preload` | `textures()` |
| `Session` | `save(data)`, `load()`, `clear()` (shape incl. `codeHidden`) |
| `Match` | `init(handlers)`, `start(cfg, gameNo)`, `stop()`, `reset(mode, me, spectator)`, `setSeat(me, spectator)`, `record()`, `flagged(p)`, `whenIdle(fn, key)`, `syncClock()`, `startPlayerFor`, `playerColor`, `isLocal/isBot`; getters `engine, state, names, running, mode, me, spectator, seats, config, gameNo, bot`; `THINK_MS` |
| `Room` | `init(handlers)`, `enter(code, preferHost, seat, spectate, hidden)`, `leave()`, `roomLink`, `hideCode(on)`, `codeText()`, `newGame()`, `bump()`, `save()`, `render()`, `startFromLobby(cfg)`, `requestRematch()`, `rematchWaitText()`, `sendMove(i)`, `sendSync()`, `reseat()`, `settingsChanged(cfg)`, `say(text)`, `react(e)`, `tolobby()`, `review(ply)`, `onIdle/onChanged/onFlag` (Match handlers), `presentSeats/missingSeats/occupiedSeats/allHere/live/who/two/playersNow/turnHint`, `accepts(msg, seat)`, `keepsSeats(msg, occupied)`, `PLAYERS_ONLY`; getters `rev` (settable), `spectators`, `votes`, `votedMyself`, `online`, `isHost`, `codeHidden` |

Node-side (`scripts/`): `loadHeadless()` (util + rules + bots in a VM), `puzzles/runner.mjs`
(`loadPuzzles`, `positionOf`, `evaluateBot`), `benchmark.mjs`, `calibrate.mjs`
(`collect`, `fitLogistic`, `metrics`, `calibrate`), `puzzles/<game>/solver.mjs` +
`generate.mjs`, `puzzles/verify.mjs`, `screenshots.mjs`.

Protocol messages (host relays everything to the other guests): `hello, state, welcome/full
(transport), lobby, start, start-request, tolobby, sync, move, timeout, rematch, review,
react, chat, roster, leave, ping/pong` — fields in "Online play".

## Lessons learned (keep these in mind before "improving" things)

- **Win chance / evaluators.** A shallow fixed-depth search in Chain React evaluates
  "the side to move has the initiative" and flips every turn (odd/even horizon effect).
  What fixed it: even depths only, counting only fully completed depths, averaging the
  last completed depths, and full quiescence over forced explosions before any leaf is
  scored; blending odd and even depths or "last depth only" made it worse. In Five Wins the
  zigzag came from a static penalty for facing an open three; extending the search through
  the forced defence instead removed it. Measure the *mover bias* (mean of p − average of
  neighbours, per side to move) separately from the raw swing: proven wins that the weaker
  self-play bots then throw away are legitimate 100→0 changes.
- **Calibrate, don't guess.** Both bots' own logistic scales were 3–4× too steep compared
  with what self-play outcomes support (Creeper 10 → 31, Sensei 300 → 1166). The flatter,
  data-fitted curve is what makes the number calm and honest; it lives in benchmark.js and
  is regenerated by the benchmark. Brier scores: chain 0.21, five 0.006 (deterministic
  self-play is very predictable — don't read that as "perfect").
- **Never evaluate mid-animation**; freeze the display while `state.busy`, refresh once
  per settled move, refine in the background with node budgets (deterministic across
  devices; wall-clock budgets would make two online clients disagree).
- **Determinism is a feature of the tests, not a hope.** Seeded RNG everywhere (bots,
  personas, e2e random play via `Bots.rng`, pinned bot seed through sessionStorage),
  node budgets instead of time, generous timing margins, `waitFor` over `sleep`. Cross-realm
  objects from jsdom/vm: compare via `JSON.stringify`, get globals with `w.eval("Name")`.
- **CI runner is a 2-core box.** Random debugging ports collided between parallel e2e
  files and a third Chrome didn't come up under load: Chrome now picks its own port
  (`DevToolsActivePort`), launches retry once, and CI runs e2e files one at a time.
  Diagnostics on timeouts (page state + screenshot) turned "flaky" into "explainable".
- **PeerJS ordering.** The first data message can arrive before the guest's own `open`
  event under load; `destroy()` emits `close` synchronously; a "room full" verdict can be
  the guest's own stale connection — handshake `welcome`/`full`, listen before `open`,
  never treat `full` as final, replace connections that stopped answering pings.
- **Benchmark files must reproduce byte for byte** (seeded series, fixed budgets, the
  stamp-preserving check reading only its own statement); otherwise the workflow opens
  no-op PRs. Run `node scripts/benchmark.mjs` after any bot/rules change and commit.
- **Puzzle sets are only as good as their solver's guarantee.** Both solvers are exhaustive
  or threat-proven and re-solve every puzzle in their tests; `puzzles/verify.mjs` re-proves
  the tactical ones with an independent one-ply check. When a rule changes (the dead-board
  draw), the solver must learn it and the set must be regenerated.
- **Agents.** Parallel agents work well when each owns a folder (bot folders, puzzle
  folders) or a worktree branch (cross-cutting issues); give them the contract up front,
  forward what a finished agent learned to the ones still running, and expect to merge
  and re-verify yourself. A worktree created from the wrong base wastes a whole run —
  check `git log -1` in it first.
- **Mobile layout bugs are usually stacking/overlap**, not events: an invisible flex
  container (the collapsed reaction list) swallowed taps on the ⚙ button.

- **Refactor lessons (2026-09-10, the big one).** The e2e suite made a full restructure safe:
  850-line app.js → Match (table) + Room (protocol) + a 230-line app.js, the chain-only
  HUD box and settings rows out of index.html into the game definitions, win chance out of
  the engine into a Bus observer, one pure `Rules.step` for every path that resolves a
  move. What to keep doing: replace *state scattered across a big object* with modules that
  own their state and expose getters; let observers subscribe to `game:position` instead of
  threading calls through the engine; describe game-specific UI as data (HUD model,
  settings list) and render it generically; when a queue of "do this once idle" appears
  (pendingSync, pendingOuts, incoming), one `whenIdle(fn, key)` replaces them. Test ids that
  encode game words (`p0-cells`) become generic (`p0-stat-0`) — update tests, don't keep
  legacy ids alive in the framework.

## Owner preferences

- Writes English and German; either is fine in replies.
- Wants things to look nice; approved: classic skin, HUD contrast, explosion, compact
  mobile HUD, unified dark MC UI, settings modal, room flow. Keep mobile non-scrolling.
  Layout need not be pixel-perfect, behaviour and texts must not change unasked. No em
  dashes in any user-facing text (#24): rewrite the sentence instead.
- Prefers several small JS files over one big one; no framework.
- Friends only (up to four in a room, plus spectators) — no matchmaking, no accounts, no
  own server.

---

# How to add a new game (step by step)

A game is three files (pure rules, view + registration, CSS) plus two tags in
`index.html`, and usually a bot folder. Everything else is the framework and is generic:
rooms and the host relay for 2–4 seats, lobby sync of the settings, start / rematch /
back to room, reconnect + replay from the game record, session restore, the chess
clock and flag falls, spectators, chat, reactions, sounds for the generic events, the
bot seat, the bot persona, the win-chance bars, the generic HUD (stat rows, info box,
phone line), skins and player colours, the picker card, the settings rows, the benchmark
and puzzle tooling. **A game never touches app.js, room.js, match.js, games.js, settings.js
or index.html's HUD markup.** If it seems to need to, extend the definition contract
instead (and this file).

Copy Five Wins (`five-rules.js`, `five.js`, `five.css`, `random-five`, `sensei-five`) — it
is the smallest complete game.

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

`Rules.step(rules, state, i)` = place + settle + conclude is the **only** way any
framework code resolves a move (engine replay, bots' `tools.apply`, playout, puzzle
runner, calibration, a future replay viewer), so keep the three functions pure and
deterministic and never resolve anything outside them. A move must be a single integer
(encode from/to as `from * n*n + to` if needed): `move`, `sync`, the session and the
record assume `history` is an array of numbers. Player numbers are 0…players-1;
names/colours come from the skin. **Must work for 2, 3 and 4 players** (rotation via
`Rules.pass`, eliminations via `state.out`) — the *Players* setting applies to every game.

## 2. View + registration `client/games/<key>.js`

Expose `<Name>View` with:

| Function | Contract |
| --- | --- |
| `build(board, state, config, onClick)` | Create one element per cell inside `board` (append a `<div class="last-marker">` child to each), wire `click → onClick(i)`, return the element array. Set CSS vars you need (chain sets `--speed`). |
| `renderCell(el, state, i)` | Game-specific classes only (the engine already set `p<k>`, `taken`, `last`, `can-place`, `locked`). |
| `hud(state)` | **Data only** — return the HUD model, the framework renders it: `{ round: "Move 3", players: [{ stats: [[label, value], …], bar: 0..1, barText, leading }], box?: { stats: [[label, value], …], hot? }, line2?: "text" | [[label, value], …], drawHint? }`. One `players` entry per seat (`state.players`, 2–4). `box` is an extra info box on desktop (chain's chain counters); `line2` the phone turn box's second line. Never write DOM here. |
| `summary(state)` | Second line of the result overlay ("12 moves"). |
| `animateMove(ctx, i, player) → Promise` | Show the move. `ctx` gives `state`, `cells`, `board()`, `names()`, `renderCell(i)`, `renderHud()`, `render()`. Use the rules' own step functions for anything that changes state so the instant path (`settle`) stays identical. Return early if `state.over` after an `await`. Emit your own `Bus` events (`<key>:…`) for sounds / observers. |

Then register:

```js
const <Name>Game = Games.register({
    key: "<key>", title: "Nice Name",
    tagline: "One sentence under the picker.", desc: "Short card subtitle",
    preview: "...01....",                   // 9 chars: "." empty, digit = player
    size: { min: 5, max: 19, default: 9 },  // board-size input limits
    minSize: (cfg) => 5,                    // optional, may depend on the game fields (five: winLen)
    players: { min: 2, max: 4 },            // optional (default 2–4): the picker grays the card out otherwise (#28)
    settings: [                             // the game's rows in #settings-modal, built by settings.js
        { key: "winLen", label: "In a row to win", type: "int", min: 3, max: 25, def: 5, unit: "stones" },
        { key: "speed", label: "Animation speed", type: "select", def: 750, options: [[1100, "Slow"], [750, "Normal"]] },
        { key: "rule", label: "Optional rule", type: "bool", def: false, with: { key: "ruleN", type: "int", min: 1, max: 9, def: 3, unit: "x" } },
    ],
    describeRules: (cfg) => [],             // optional summary parts before the timer ("5 in a row")
    describeOptions: (cfg) => [],           // optional summary parts after the timer ("15-chain wins")
    rules: <Name>Rules, view: <Name>View,
});
```

The picker card, the settings rows (`#row-<key>` / `#set-<key>`, lowercased) and the
config keys (`config.<key>` on both sides of a room, persisted per device) all come from
this entry — no HTML to add. Keep the picker at ≤ 2 cards per row (`.game-picker` grid is
`1fr 1fr`; with 3+ games consider `repeat(auto-fit, minmax(150px, 1fr))`) and re-check
the 360×780 lobby doesn't scroll.

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
after `five.js` and before `bots.js`. Build, the unit-test loader and the headless loader
(`scripts/headless.mjs` matches `games/<key>-rules.js`) pick them up from there.

## 5. Sounds (optional)

The generic events (`game:move`, `game:turn`, `game:finish`, reactions, chat) already
sound. For your own events add a case to `Sound.map` (event → cue), a synthesized cue to
`SYNTH`, a file to `Sound.FILES` for the Blocks set and a category in `Prefs.CATEGORIES`
only if none fits. Keep `Sound.map` pure (it is unit-tested with a fake player).

## 6. A bot (expected for every game — the win chance and "Against a bot" depend on it)

1. `client/bots/random-<key>/bot.js` (copy `random-five`, change `game`) — the benchmark
   baseline; add `"random-<key>"` to `BASELINE` and a series to `SERIES` in
   `scripts/benchmark.mjs`, and a series in `scripts/calibrate.mjs`.
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
   → `tests/puzzles/<key>/puzzles.json` (≥ 100 proven positions); `tests/unit/puzzles.test.mjs`
   picks the set up and grades every bot. Never make a threshold a build requirement.

## 7. Checklist before calling it done

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
- No `Runtime.exceptionThrown` in either browser. Update this file (files table, rules
  section for the game, events if you added any), `README.md`, `docs/bots.md` (bot list)
  and `changelog.json`.
