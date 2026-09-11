---
paths:
  - "client/app.js"
  - "index.html"
  - "client/css/**"
  - "client/settings.js"
  - "client/prefs.js"
  - "client/skins.js"
  - "client/learn.js"
  - "client/learn/**"
  - "client/changelog.js"
  - "client/reactions.js"
  - "client/chat.js"
  - "client/lib/sound.js"
  - "client/lib/replays.js"
  - "client/lib/analysis.js"
  - "client/lib/update.js"
  - "client/lib/install.js"
  - "client/lib/preload.js"
  - "client/lib/log.js"
  - "scripts/learn/**"
  - "tests/unit/learn.test.mjs"
  - "tests/unit/prefs.test.mjs"
  - "tests/unit/sound.test.mjs"
  - "tests/unit/chat.test.mjs"
  - "tests/unit/reactions.test.mjs"
  - "tests/unit/replays.test.mjs"
  - "tests/unit/analysis.test.mjs"
  - "tests/unit/update.test.mjs"
  - "tests/unit/changelog.test.mjs"
  - "tests/e2e/*.test.mjs"
---

# UI: screens, flow, settings, preferences, Learn, replays

The title screen, the lobby and the game screen, the install button and version updates, settings and preferences, skins, sounds, the Learn section, replay files, the store and the analysis panel, chat and reactions. The core context is `AGENTS.md`.

## Install as an app (Android)

`manifest.json` (name, `standalone`, navy theme/background, icons 192/512 "any" + a
`maskable` 512 with the artwork inside the safe zone for Android's adaptive icons) is
linked from `index.html` and copied by the build (`ROOT_EXTRAS`). The title screen's
`#btn-install` ("Add to home screen" with the phone icon) is hidden until the browser fires
`beforeinstallprompt` (Android Chrome and other Chromium browsers; never on iOS Safari,
which has no prompt — the owner wants the button only where it works), then calls
`prompt()` and hides itself; `appinstalled` toasts. The icon set (favicon, apple-touch,
192/512, maskable) is generated: a navy rounded tile with a 2×2 Chain React board, a cyan
and an amber glowing block with lamp dots — regenerate all sizes together if it changes.
No service worker (nothing is cached; the deploy's hashed assets handle freshness).

## Flow: title → room lobby → game (the "party" model)

One room, one link, the whole evening (owner's request after "we sent 3–4 links just
to try things").

- **Title** (`#screen-menu`): title "ALZlper's Minigames", under it the greeting
  `.menu-hello` "Hello [name]! Welcome to some fun games." whose `#menu-name` field
  (`.name-inline`) is the very same name preference as Profile in ⚙ (#35: `Prefs.fill`
  writes both fields, a `change` on either goes through `Prefs.set`, so the drawn default
  name shows from the first visit and the two never disagree; the old boilerplate tagline
  is gone; the field is sized by `Prefs.fill` to exactly the width budget of a name (16
  letters "n" plus padding, see "The name"), and phones drop the welcome sentence),
  section *Online* with
  `Create room` + `Join room` (`#join-panel` with the code field appears on Join room) and
  under them the muted hint `#menu-online-hint` ("One room for up to 4 players, plus
  spectators." — the seat count itself is picked in the lobby, #28),
  section *Offline* with `Local multiplayer` (`#btn-local`) and `Against a bot`
  (`#btn-bot`) in one row, then the foot (`.menu-foot`, #43): one row of two equal buttons,
  `Learn to play` (`#btn-learn`, #41) and `Replays` (`#btn-replays`, #42), both `.btn.big`
  like the offline row so all four buttons share one height, over the quiet
  pills `#btn-install` (see Install) and `Changelog` (`#btn-changelog`) in `.foot-quiet`
  (14 px of margin above it, and the card's bottom padding is 22 px to match). Learn, Replays and
  Changelog carry no icon any more; only the install pill kept its phone icon. **Above the card**
  (#43), as its own banner inside `#screen-menu` — which is therefore the one screen laid
  out as a column — sits `#update-notice` (see "Version updates"). No Look
  control here (owner: only in the preferences, #9). Never scrolls on a phone. The ⚙
  preferences button floats top-left on every screen.
- **Version updates** (`client/lib/update.js`, #40): while the title screen shows, `Update`
  fetches `version.json` (`cache: "no-store"`, 4 s cap) on load, whenever the tab becomes
  visible and every `Update.EVERY_MS` (3 min), and compares it with the running
  `<meta name="version">` (`Update.isNewer(running, latest)`: two different non-empty
  stamps, never "dev", so the unbundled dev page and the tests never poll). A different
  stamp sets `Update.available` and shows `#update-notice` ("A new version is ready." plus
  `#btn-update-reload`). **Only on the title screen**: `app.js`'s `show()` calls
  `Update.screenChanged()`, which hides the notice in the lobby and in a game and shows it
  again on the way back, so a result that arrives elsewhere simply waits. After
  `Update.AUTO_MS` (20 s) with the notice up and no click or key press the page reloads
  itself once (`Update.reload`, replaceable in tests); every failure (offline, 404,
  timeout, garbage) is silent.
- **Lobby** (`#screen-lobby`), same screen for local and online (`Match.mode`), in **three
  calm blocks** separated by a hairline (`.lobby-group`, one `border-top`), then one primary
  action:
  1. **Head** (`.lobby-head`): the kind label (`#lobby-kind`: "Room" / "Local game" /
     "Against a bot"), the room code (`#lobby-code`) with — online only — one primary
     button `#btn-invite` "Invite" beside it (`#lobby-share` in `.room-code-row`). It opens **`#invite-modal`**: the code
     again (`#invite-code`, hidden for a spectate-link viewer), and four
     `.settings-summary.invite-row` rows with an icon, a label and a one-line explanation:
     `#btn-share` "Share link", `#btn-copy-code` "Copy room code", `#btn-share-spectate`
     "Copy a link for spectators" and `#btn-hide-code` "Hide the room code" / "Show the
     room code" (`#hide-code-label`, the eye / eye-off icon on its `.gear-icon`, see
     "Hidden room code" in `online.md`; hiding the code **the first time on a device** opens
     `#hide-code-ask`, "Hide the room code in every new room from now on?", whose "Always
     hide it" sets the `hideCode` preference and whose "Just this room" only hides this one;
     both remember `Prefs.hideCodeAsked`, so it never asks again, and showing the code never
     asks). A viewer sees only the spectator row. `startGame`
     and `leaveRoom` close it. The owner's brief (2026-09-11): every action carries a word,
     the room reads like the other lobbies.
  2. **Group "Players"** (`#group-players`, hidden against a bot because everything in it
     is): the **Players** row (`#row-players`: the label plus the segmented `#set-players`
     with 2 / 3 / 4, #28 — in the lobby so everyone sees the room takes up to four; hidden
     against a bot by `Settings.setMode`; a count below the seats people already sit in is
     disabled, #34; the row also carries `#lobby-spectators` "N spectator(s) watching" as
     its note and, while seat cards show, a hairline under it), one `.lobby-player` card per seat from
     `#tpl-lobby-player` (online only; as many as the *Players* control says; the name, a
     small `(you)` in `.lp-you`, and `#lp-<k>-status` "connected" / "not here yet" /
     "ready"; an absent seat gets `.absent` = a dashed, muted placeholder card; the card
     wraps its status onto a second line rather than cutting a long name off). The seat
     controls sit **inside the card they act on** (`.lp-act`, a full-width line under the
     name; `renderLobby` parks them in the hidden `#seat-actions` and moves the shown ones
     into the cards, so the ids never change): `#btn-watch` "Watch instead" on my own card,
     `#btn-take-seat` "Sit here" on the first empty card for a spectator (disabled without a
     free seat, #39), `#btn-room-bot` "Add a bot" on the empty card of a two-seat room and
     `#btn-room-bot-off` "Remove the bot" on the bot's card (#36). Under the cards only the
     transient note `#lobby-status` ("X left the room.", cleared once everyone is back).
     Connection trouble never shows as a line here: it goes on the Start button in two words
     and into the sticky `#net-banner` at the top (see "Where a status is shown" in
     `online.md`).
  3. **Group "Game"** (`#group-game`): the picker (one `.game-card[data-game]` per
     registered game, built by `Settings.init`; each card says "2 to 4 players" and a game
     that doesn't take the chosen count is grayed out, `.unsupported` + `disabled`, #28),
     an empty line where its tagline used to be (`#menu-tagline`, `.lobby-gap`, kept as
     space by the owner's wish; the tagline still shows in Learn and in Replays), then the
     **Options** heading (a second `.lobby-row` label) over up to three `.settings-summary`
     rows (icon in a fixed 26 px column so the texts line up, the text in white taking the
     width, the chevron at the right edge); the foot's padding (`#screen-lobby .lobby-foot`,
     20 px) gives the same space before Start: the *How to play* row (`#btn-howto` → `#howto-modal`,
     #41: the selected game's rule bullets and its tutorial steps as plain text; reading
     only, so nobody has to leave the room, and `startGame` closes it), the *Opponent* row
     (`#btn-opponent`, in bot mode and while a room has a bot, #36) and
     the settings summary button (`#btn-settings` → `#settings-modal`).
  Then `.lobby-foot`: `Start game` (`#btn-start`, the one big primary button, its text also
  says why it is disabled) and a quiet text button `Leave room` / `Back` (`#btn-lobby-back`,
  class `btn quiet`). No chat in the lobby (#15) — chat lives in the game HUD only. The
  card fits 360×780 for a local or a two-seat room; four seats with every seat control
  shown are taller than that and then **the screen scrolls, never the card** (`mobile.test.mjs`,
  screenshots `mobile-lobby-<skin>.png`). That is the rule everywhere since 2026-09-11:
  `.menu-card` has no `max-height` and no `overflow`, the screens and `.modal` use
  `safe center` alignment with `overflow-y: auto`, and the changelog list, the How to play
  modal and the preferences body have no inner scroll box either (the HUD log and the
  replays dropdown menu are the two boxes that still scroll by design).
- **Game** (`#screen-game`): board + HUD ("hut"). Result overlay: `Rematch`, `Look at
  board` (hides it and opens the replay bar), `Change game` (→ lobby). The HUD has
  `Rematch` and `Back to room` too. `renderRematch()` in app.js is the only writer of the
  Rematch buttons' texts (Spectating / Rematch / Waiting… / Accept rematch).
- **Replay bar** (`#replay-bar`, #38): after "Look at board" a fixed one-row bar holds
  `|◀ ◀ "Move 12 / 30" (#replay-pos) ▶ ▶| ▶▶` and the `#result-fab` "Show result" button
  (which lives inside the bar, so hiding the bar hides both). Every step calls
  `showReplay(ply, announce, auto)` in app.js → `engine.preview(ply)`; the last ply turns the
  preview off (live position). `←`/`→` step, `Home`/`End` jump to the ends (ignored while
  an input has focus). `hideReplay()` (new game, rematch, back to room, leave, "Show
  result") drops the preview. `▶▶` (`#replay-play`, #43) walks from the shown move to the
  last one and becomes `❚❚`: pressing it at the last move starts over at move 0, reaching
  the end stops by itself, and any step by hand pauses. The pace lives in
  `Replays.playback({ ply, total, seek, ms })`, a pure state machine (`REPLAY_STEP_MS` =
  `Replays.STEP_MS` 900 ms, timers injectable, unit-tested with fakes).
  Online, every step sends `review {ply, play}` so the whole room looks at the same move:
  `{ ply, play: true }` makes the other side start **its own** timer from that move, so
  playing through a game together costs one message and not one per step, and a plain
  `review {ply}` (or `play: false`) pauses and jumps.
  Desktop: bottom centre; phones: above the HUD, `fitBoard`
  publishes `--hut-h` = the strip the HUD takes so the bar never covers its controls.
  The bar and the analysis panel above it (`#replay-panel`, #43, see "Replay analysis")
  live in `#replay-dock`, the fixed column that
  carries the position; `fitBoard` publishes its height as `--dock-h` and phones give
  `#board-wrap` that much bottom padding, so the board never disappears behind the panel.
- **Replays** (`#screen-replays`, #42): the title screen's `Replays` button opens the list of
  the games this device played (`Replays.store`, newest first). It is a **tool, not a small
  card** (regular players collect a lot of games): 860 px wide on desktop, the head row
  holds the title and `#btn-replay-upload` "Open a replay file" (opens the hidden
  `#replay-file` input, `accept` `.replay,.json`: parse → migrate → validate → save → watch),
  the title and tagline are left-aligned. **Filters** in `.replay-tools`: the game
  **dropdown** (`#replay-filter`, built by app.js, #43: `.dropdown` = a `.dd-button` showing
  the picked game's small preview tile and its title, and a `.dd-menu` of
  `.dd-option[data-filter]` rows, "All games" first and then one per registered game, each
  with its tile; a click next to it or Escape closes it. `.dropdown` lives in `menu.css` and
  only this screen uses it, because a plain `<select>` cannot show the tiles), the segmented
  `#replay-kind` (All / Bot / No bot; a game counts as a bot game when `summary.bot` says so:
  `meta.mode === "bot"` or a room whose `config.bot` seats one, which "Play from here" does),
  the name search `#replay-search` (part of any player's name, case-insensitive) and a date
  range `#replay-from` / `#replay-to` (`type="date"`, inclusive, compared as local calendar
  days through `Replays.dayOf`). All of it is one pure function, `Replays.filter(items, {
  game, kind, search, from, to })`, applied to `store.list({})`; `#replay-count` says
  "12 replays" or "3 of 12 replays". The found rows come in **pages** of `REPLAY_PAGE` = 10
  (`#replay-pager` with `#replay-page-prev` "‹ Newer", `#replay-page` "Page 1 of 2",
  `#replay-page-next` "Older ›", hidden with one page; every filter change goes back to
  page 1). One `.replay-item` per row from `#tpl-replay` (the game's small preview tile
  from `previewTile`, then the title "Five Wins · 5 × 5" and the sub line "date · names ·
  result · moves" from `Replays.summary`) with **Watch** / a download icon (save as a file) / a trash icon (delete). `.replay-body` keeps a minimum height (300 px, phones 220 px) and
  `#replays-hint` is the centred, dashed **empty state** ("No replays yet…" or "No replay
  matches…"); `#replays-note` above the list warns when the browser has no IndexedDB and
  the list only lasts for this visit. **Nothing scrolls inside the card**: like the Learn
  details page the screen scrolls (`align-items: flex-start`, the card `margin: auto`), the
  pagination bounds the height, and `Back` sits at the bottom.
  **Watching one** (`watchReplay(doc)` / `closeReplay()` in app.js): `Match.watch(doc)`
  puts the record on the normal game screen with `Match.mode === "replay"`, every seat
  `watch` (nobody may play, no clock, no bot, no premove, no room), the names from the file
  (app.js's `seatNames()` returns `replayDoc.players`), and the replay bar opens at move 0
  through the very same `showReplay`. `renderRematch` hides both Rematch buttons and turns
  `#btn-menu` / `#overlay-menu` into "Back to replays". Games are saved automatically in
  `saveReplay(finished)`: from Match's `onFinish` when a game ends, and from `backToLobby` /
  `leaveRoom` for a game left half way (`result.over: false`); a replay of a replay is never
  saved, and the same game saved twice keeps one entry (the id is a hash of its content).
  Online every device saves its own copy, spectators included; nothing about replays travels
  through the room.
- `Match.mode` ∈ `local | bot | online | replay`. Bot mode is the offline lobby with an extra
  *Opponent* row (`#btn-opponent` → `#bot-modal`). **One bot per game (#21)**, called
  "Bot" wherever a player sees it (`Opponent.NAME`; `Bots.botFor(game, cfg)` picks it): the
  modal is one step (description, scores, difficulty, Cancel / Play). Picking a game does
  **not** open it (#12): the default is the middle difficulty; the row shows the choice.
  Offline you are seat 0 and the bot sits on seat 1; everywhere else the seat is whatever
  `config.bot.seat` says (`Settings.BOT_SEAT` 1 is only the default it is filled with), which
  is how "Play from here" (#43) can seat the bot on 0. **A room can play a bot too (#36)**,
  see "The room's bot" in `online.md`.
- **Learn** (`#screen-learn`, `#screen-learn-game`, #41): see the "Learn section" chapter.
  Lessons themselves run on `#screen-game`.
- `phase` (app.js) ∈ `menu | lobby | game | replays | learn | learn-game` (the list
  `SCREENS`, one `#screen-<name>` each) — Room reads it through its `phase()` handler and
  only ever cares about `game` / `lobby`.
  `Match.gameNo` increments per started game (local too); `Match.startPlayerFor(g,
  players) = (g - 1) % players` → seat 0 starts game 1, then the next seat, round-robin.
  `Settings.setMode(mode)` is called on every mode change (`local` / `bot` / `online`):
  against a bot the lobby's *Players* row is hidden and the config says 2.
- The flow functions in app.js — `startGame(cfg, gameNo)`, `startFromLobby()`,
  `requestRematch()`, `backToLobby(announce)`, `leaveRoom()`, `openLocalLobby(withBot)`,
  `openReplays()`, `watchReplay(doc)`, `closeReplay()` — are the only places that switch
  screens. Room calls `startGame` / `backToLobby` through
  its handlers when the protocol says so, Learn through its `show` / `exit` handlers;
  Match never switches screens. While `Learn.active`, `requestRematch()` and
  `backToLobby()` hand over to `Learn.restart()` / `Learn.exit()`, `renderRematch()`
  writes the lesson's own overlay texts ("Retry" / "Start over", "Back to Learn") and
  `saveReplay` keeps quiet (a lesson is not a game worth a replay).

## Settings (`client/settings.js`)

Form in `#settings-modal` (opened from the lobby summary, closed by Done / backdrop;
number inputs are clamped on `change` and on close, never on `input`, so typing "12"
doesn't snap at "1"). Persisted in `localStorage["chainreact.settings"]` together with
`sizeFor` (remembered board size per game). Inputs have `autocomplete="off"` (Firefox
restores form values on reload).

- Shared rows (in index.html): board size (limits and default from the game's `size` +
  optional `minSize(cfg)`: chain 3–12, default 6; five 5–25, default 11 since #16; boxes
  2–10, default 5 — a size
  remembered in `sizeFor` wins over the default; `cfg` holds every game field's current
  value; the row's label is `#size-label`, "Board size" unless the game declares its own
  `sizeLabel`, e.g. boxes "Boxes per side"), timer per player (Off default / 1 / 3 / 5 / 10 min / custom minutes). **Players**
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
  rows take no gap (#26). Today: five `winLen` (3–25, default 5, also the board's minimum)
  and `yavalath` (the Yavalath rule, off by default, see "Five Wins rules" in `games.md`); chain `speed`
  (Slow 1100 / Normal 750 / Fast 350 ms) and `chainRule`/`chainLen` (win on N explosions,
  off by default, N default 15; owner dislikes the rule but wanted it available). Isolation
  and Käsekästchen declare none: the shared board-size row is all they need.
- `Settings.read()` returns the **config** a game starts with: `{ game, players, n,
  timer, timerSel, timerCustom, bot, …every game field of every game }` (all fields travel so
  a mirrored settings message is complete for any game the room may pick). `bot` (#36) is
  `null` or `{ id, difficulty, seat }` (`seat` filled from the choice, `Settings.BOT_SEAT` 1
  when it names none; every reader takes it from `config.bot.seat`, never from the constant):
  `Settings.setBot(choice[, announce])` /
  `Settings.bot`, cleared by `setMode` for anything but `online` and by `Room.leave`, so it
  belongs to one room and never leaks into offline play. It is deliberately **not** part of
  the summary text: the lobby's *Opponent* row shows it. Engines get it
  as `config` (plus `startPlayer`) and read only what they need.
- Summary text: `n × n` · (`N players` when more than two) · `describeRules(cfg)` parts ·
  timer · `describeOptions(cfg)` parts (e.g. "7 × 7 · 5 in a row · 3 min timer",
  "4 × 4 · 3 players · no timer · 15-chain wins").
- Any change → `onChange(config)` → app sends `lobby {s}` to the friends (`Room.settingsChanged`).
  `Settings.write` runs silently (no echo) when applying the friends' settings.
- The **look is not a setting** (see Skins).

## Icons (`client/lib/icons.js`)

Every icon in the UI is a monochrome 24 × 24 line drawing stroked in `currentColor`
(owner: no emoji as icons; emoji stay for the reactions and the bot persona, which are
content). `<span data-icon="book"></span>` gets its SVG (`svg.ico`, 1.1 em, `[data-icon]`
is `inline-flex`), a `MutationObserver` fills nodes added later (cloned templates, rows
built by scripts), `Icons.set(el, name)` swaps one, `Icons.svg(name)` builds a bare
element, `Icons.names()` lists them. Names in use: settings, phone, eye, eye-off, copy,
monitor, share, book, bot, download, trash, user, palette, volume, video, wrench, chat,
target, alert, refresh, flag, check, menu. Learn's `KINDS` name their icon, the replay
rows' buttons and the lobby rows carry `data-icon` in the markup. `tests/unit/icons.test.mjs`
checks every `data-icon` in the page is known and that no emoji is left where an icon
belongs.

## Preferences (`client/prefs.js`, per device — the ⚙ button)

`#prefs-btn` (class `corner-btn`, a pill fixed top-left on every screen, "⚙ Settings &
Feedback" **everywhere** — the short phone label of #25 is gone (#43), phones only get a
slightly smaller pill so it and the 😜 toggle never meet at 360 px) opens `#prefs-modal`.

**Two levels (#32)**, because the list had grown too long: a **menu** (`#prefs-nav`) with
one row per section (`#prefs-nav-<key>`, styled like the lobby's `.settings-summary`: icon,
name, `#prefs-sum-<key>` = `Prefs.sectionSummary(key)` describing the current state,
chevron) and one **panel** per section (`#prefs-panes` → `.prefs-section[data-section=<key>]`,
`.prefs-rows` inside). Sections in order: `Prefs.SECTIONS` = profile, look, sound, streaming
(shown as "Content Creator"; the key stays `streaming` for the stored preferences and the
ids), developer, feedback. `Prefs.showSection(key)` opens one (`null` = the menu),
`Prefs.section` says which is open; the card carries `on-section` while one is.
On **phones** (`max-width: 899px`) exactly one level shows: the modal opens on the menu, a
row opens its panel with a "‹ Back" button (`#btn-prefs-back`), Done (`#btn-prefs-done`)
closes from anywhere, and every single section fits 360×780 without scrolling. On
**desktop** (`min-width: 900px`) `.prefs-body` is a two-pane grid: the menu is the left
column (each row a small grid: the emoji in the first column spanning both lines and
vertically centred, the name and the summary in the second, so they share one left edge;
the open row `selected`, no chevron) and the open section sits beside it **in a card of its
own** (`.prefs-section`: `--bg2` background, border, its `.section-title` a 17 px bold
heading with a hairline under it), so nothing is ever two taps away; `open()` selects the
first section right away. Both columns end on the same line (`align-items: stretch`, the
section `flex: 1`, the menu rows `flex: 1 0 auto`). A too tall modal scrolls as a whole
(the `.modal` backdrop), never `.prefs-body`. Phones keep the plain form without the card.
**Adding a section = one nav row + one `.prefs-section` panel in index.html + one entry in
`SECTIONS`** (and a `sectionSummary` case); nothing else knows about them.

The sections hold: **Profile** (#35: the text field `#pref-name`, `maxlength` 16, written
back on `change` so typing is never cut mid-word, hint "Shown to the others in the room.";
the menu row's summary is the current name; the title screen's `#menu-name` is a second
field for the same preference), the **Look** control (the only `.skin-seg`,
full width, no extra label, #22; kept in sync by `Skins`) plus `#pref-win-graph`
("Win chance graph in replays", on by default, #43: the line graph in the analysis panel,
two-player games only), the **Sound** rows (master volume slider
`#pref-volume`, default 30 %; sound set `#pref-soundset`: follow the look / Classic /
Blocks; one checkbox per category `#pref-snd-<cat>`, categories in `Prefs.CATEGORIES` =
moves, explosions, results, turn, reactions, chat), **Content Creator** (key `streaming`:
the primary button `#pref-creator-mode` "Turn on content creator mode" sets every option of
the section at once (`CREATOR` = hideCode, privateIp, muteSpectators) and, once all are on, reads "Turn off content creator mode" as a plain
secondary button that clears them again (`creatorMode()` in prefs.js, re-rendered by
`fill()`; the menu row's summary is "Best for streaming", "partly on" or "on");
`#pref-hide-code`: enter rooms with the code hidden, #19; `#pref-private-ip` "Keep my IP
always private": every connection is relayed through TURN, #30 — read by `Net` when the
peer is created, so it takes effect on the next room; `#pref-mute-spectators` "Hide chat
and reactions from spectators": spectators' lines and emojis are never shown on this
device, see `Room.hides` in `online.md`), **Developer** (`#pref-developer`: the info panel,
#31) and **Feedback**. Stored in
`localStorage["chainreact.prefs"]` (`Prefs.get()` → `{ name, defaultName, volume, soundSet,
sounds: {…}, winGraph, hideCode, hideCodeAsked, privateIp, muteSpectators, developer }`, `Prefs.set(patch)` merges, clamps, persists,
refills the form, re-renders the menu rows and calls `onChange`). The modal is roomier than the
settings one (`.prefs-rows` gap 14 px, 16 px and 760 px wide on desktop for the two panes,
#25, #32).

**The name (#35)** is the one preference that leaves the device: `Prefs.cleanName(s)`
(collapse whitespace, trim, cut to `Prefs.NAME_MAX` = 16 characters **and** to the width of
16 letters "n" in the greeting field's bold 14 px font, measured with a hidden span:
`Prefs.fitName(s, measure)`; where nothing can be measured, jsdom, only the count applies)
cleans everything on the way in
**and** every name that arrives from the room (it is somebody else's text; it only ever goes
into the DOM as `textContent`). On the **first visit** one of the ~40 short names in
`Prefs.DEFAULT_NAMES` is drawn at random, stored as `defaultName` **and** as `name`, and
persisted at once, so it never changes again by itself; clearing the field falls back to that
drawn name. `Prefs.seatNames(count)` = the seats when everybody plays on one device: me first,
then the first default names that are not mine (pure and deterministic, which is what the
tests rely on). app.js compares `p.name` in `onChange` and only then calls `Room.nameChanged()`
and re-renders, so dragging the volume slider sends nothing.
Nothing else here is sent to the room, and none of it is part of `Settings.read()`. Layout rules: on phones
(`max-width: 899px`) `#screen-menu`/`#screen-lobby` get `padding-top: 56px` and
`#board-wrap` `padding-top: 52px` so cards and the board start below the two corner
buttons (⚙ left, 😜 right); `fitBoard` subtracts the wrapper's padding. `#net-banner`
already sits at 58px on phones. The MC skin restyles `.corner-btn` like `#react-toggle`.

- **Feedback** (#8): `#pref-feedback` in the preferences opens a GitHub "new issue" page
  (`Prefs.feedbackUrl()`) with the situation prefilled from `Prefs.init({ context })` in
  app.js: screen, name, mode, game, settings summary, players, seat, spectator, bot, connection,
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
body class switches the CSS and **nothing else**: since #35 the look has no player names of
its own (the old Cyan/Amber and Diamond/Gold sets are gone), everyone brings their own name
from the preferences and the seats keep their colours.
- **Classic** (default, owner's favourite — don't touch its look): dark navy UI, cyan vs
  amber, rounded cells, lamps as dots.
- **MC board** (`body.skin-mcboard`): classic UI, Minecraft textures on the board, flying
  pieces, sparks, HUD player blocks and picker previews.
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

## Replays: files, the store and the analysis (#42, #43)

A game record (`games.md`, "Game records") becomes a replay document, is kept on the device
and can be analysed. The replays screen itself is under "Flow" above.

### Replay files and the store (`client/lib/replays.js`, #42)

A **replay** is that record plus who played it and when, in a versioned document:

```
{ format: "alzlper-minigames-replay", version: 1, game, config, history, outs,
  result: { over, winner, why }, players: [name per seat],
  meta: { playedAt (ISO), mode: "local" | "bot" | "online", gameNo, appVersion } }
```

`Replays.fromRecord(record, names, mode, { finished, playedAt })` builds one,
`Replays.parse(text)` reads a file (JSON → `migrate` → `validate` → `{ ok, doc }` or
`{ ok: false, error }`, the error being the sentence the player is shown).
`migrate(doc)` walks `MIGRATIONS[v]` up to the current `VERSION` (a file of a newer version
is refused, never guessed at); `validate(doc)` checks the shape, that the game is registered
and that every move replays with the game's own rules — it deliberately does **not** compare
the recorded result, because the rules may have grown since and the file stays the record of
what happened. `idFor(doc)` is a content hash, so the same game saved twice (a refresh into a
finished game, the same file opened again) is one entry; `fileName(doc)` →
`chain-2026-09-10-2130.minigames.replay` (`Replays.EXT`; the content is still JSON and
older `.json` files open too), `when(iso)` the list's date, `dayOf(iso)` its local calendar
day, `summary(doc, id)` one list row (with `bot`, see the replays screen) and
`filter(items, { game, kind, search, from, to })` the list's filters.

**Rule when the format changes:** bump `VERSION`, add `MIGRATIONS[old]` (one step per
version, chained), and put a sample of the **old** version in `tests/replays/` next to the
new one. `tests/unit/replays.test.mjs` plays every `tests/replays/v*.json` and fails when a
version has no sample or no migration; the `bad-*.json` files there must stay refused.

`Replays.store` keeps the documents in IndexedDB (db `chainreact`, `DB_VERSION` 2, store
`replays`, keyed by id, indexes `game` and `playedAt`, the oldest dropped past 200):
`save(doc)`, `list({ game })` (newest first, summaries), `get(id)`, `remove(id)`, `clear()`,
`persistent()` — all async and fail-safe: without IndexedDB (private mode, jsdom) it falls
back to memory for the visit and `persistent()` says false, which is what the screen's hint
tells the player. The same database has a **second object store `analysis`** (#43,
`store.analysis.get/put/remove/clear`) keyed by the same `idFor(doc)`; it is derived data,
so it never enters the replay document (whose shape is pinned per version by
`tests/replays/v*.json`) and it goes away with the replay it belongs to (`remove`, `clear`
and the 200-entry trim drop both). Adding another store means bumping `DB_VERSION` and
creating it in `openDb`'s `onupgradeneeded` without touching the existing ones.

### Replay analysis (`client/lib/analysis.js`, #43)

What the win chance did over a game, what the bot would have played at every move, a score
per seat, and the panel that shows it. Two halves in one file, kept apart on purpose:

**1. The computation is pure and headless.** `Analysis.analyse(doc, opts)` takes a replay
document or any game record, walks its positions with `Rules.replay` / `Rules.apply` and
returns plain data:

```
{ game, players, nodes, bot: { id, version, nodes } | null,
  chances: [P(seat 0 wins) per ply 0…N] | null,          // null with 3–4 players
  moves: [{ ply, player, played, best, loss, perfect }], // one per move played
  scores: [{ player, score, moves, perfect, avgLoss, blunders, mistakes }],
  partial }                                              // true = it stopped early
```

Everything it needs is injectable (`estimator`, `bot`, `nodes`, `onProgress(done, total)`,
`cancelled()`, `breathe()`, `maxMs`), which is how the unit tests run it instantly with
fakes. By default the win chance comes from the same `Bots.estimator(game, config)` the live
bars use, at the fixed budget `Analysis.NODES` (12 000, the estimator's middle stage), and
the best move from `Bots.botFor(game, config)` at its strongest level up to
`Analysis.BOT_NODES` (30 000), seeded 1, one instance per seat. **Node budgets, never wall
clock**, so the same game always gets the same numbers. `loss` = the win-chance points a move
gave away against the bot's move (`estimator.at` on both resulting positions, from the
mover's own view; 0 when the bot would have played it); the seat a ply belongs to is the
`current` of the position **before** it, never the ply's parity, so Käsekästchen (where
closing a box means moving again) counts every move for the right player; `perfect` = the
bot's move **or**
`loss <= Analysis.TOLERANCE` (3 points), which is what keeps a second good move from looking
like an error. `Analysis.MISTAKE` 10 and `Analysis.BLUNDER` 20 name the rest. With 3 or 4
players there is no estimator, so there is no `loss`, no graph and no win chance: only
`best === played` counts.

**The score of a seat** (0…100, one number, deliberately simple):

```
accuracy = perfect moves / moves of that seat
score    = 100 × (0.6 × accuracy + 0.4 × max(0, 1 − average loss / 50))
         = 100 × accuracy                    when there is no win chance (3–4 players)
```

The run yields to the page between plies (`breathe`), reports progress, stops when the panel
is closed (`cancelled`) and gives up after `Analysis.MAX_MS` / `MAX_PLIES` with
`partial: true`. A partial result is **never cached** (it would differ from run to run).
Finished results go into the `analysis` store under the replay's id, stamped with
`{ bot, version, nodes, botNodes }`: `Analysis.load(id, stamp)` returns nothing when any of
them changed, so a new bot version or a new budget re-analyses instead of showing old numbers.

**2. The panel** (`#replay-panel`) hangs above the replay bar in `#replay-dock`, in the
replay viewer **and** after a live game (never during a Learn lesson: a lesson is not a game
to judge). `Analysis.init({ onSeek, onPlayFrom })` wires it once
(it never steps the board itself), `Analysis.open(doc, { canPlayFrom })` shows it and starts
the analysis by itself (a cached result appears at once), `Analysis.at(ply)` re-renders it for
the shown position and returns the cell to mark, `Analysis.close()` tears it down. app.js
calls those three from `showReplay` / `hideReplay` and passes the marked cell to
`Match.mark(i)`, which puts a `.best-move` class on that cell through the engine's
`cellClass` hook, exactly the way the premove marker gets there (that hook paints one class:
premove first, then the best move, then whatever the app asks for, e.g. Learn's highlight; a
game whose moves are not plain cell ids is asked for the cell with `engine.cellOf`). The panel shows, for the
move that led to the shown position: the verdict (`Perfect move` / `Best was 12 (4 % lost)` /
`Mistake: …` / `Blunder: …`, colour-coded), the win chance before and after it, the
**win-chance line graph** (inline SVG, one line per seat, a marker at the shown ply, a click
jumps to that move; two players only, and only while the `winGraph` preference is on) and one
row per seat with the score, `perfect / total`, blunders and mistakes. `#btn-analyse` starts a
run that was cancelled, `#analysis-progress` is the progress bar while it runs. Phones start
collapsed (the head row only) and `#an-toggle` opens the body; desktop always shows it.

**Play from here** (`#btn-play-from-here`, two-player replays only, offered in the viewer):
`playFromHere(ply)` in app.js opens a **room** (like "Create room", so the spectate link keeps
working), the human taking the seat that is to move at the shown position and the bot the
other one (`Settings.setBot({ …Opponent.current, seat })`; the bot seat is read from
`config.bot.seat` everywhere, `Settings.BOT_SEAT` 1 is only the default). `Match.gameNo` is
set so that `startPlayerFor` gives the recorded game's starter, and the moves up to `ply`
travel as the **start prefix**: `startGame(cfg, gameNo, prefix)` replays `{ history, outs }`
into the fresh game right after `Match.start`, and the room's `start {config, g, prefix}`
carries it. Anyone who joins later needs nothing new: the prefix is part of `state.history`,
so the usual `sync` (and the session on a refresh) already has it.

## Sounds (`client/lib/sound.js`)

`Sound.init({ seats, player })` subscribes to the Bus; `seats()` returns the seat kinds
(`Match.seats.map(s => s.kind)`) and is the only thing the module knows about the game.
- **Mapping** (`Sound.map(event, data, kinds)`, pure): `game:move` → `place`;
  `chain:prime` → `prime` (the fuse, stopped after `ms`); `chain:explode` → `explode`
  (gain and pitch grow a little with the chain length); `boxes:capture` → a second, brighter
  `place` (category moves, no new asset); `game:finish` → `win` / `lose`
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

## Learn section (`client/learn.js`, #41, #44)

An offline academy per game, and — like the HUD model and the settings rows — **entirely
data driven**: everything a game teaches lives in its definition under `howto`, so a new
game adds data and no code here.

```js
howto: {
  rules:     ["one short sentence per rule", …],                   // details page + the lobby modal
  tutorial:  [{ text, config?, moves?, expect?, highlight? }, …],  // a guided lesson on a real board
  scenarios: [{ id, title, text, config, history, toMove: 0, best: [cells], tags?,
                tier, kind, difficulty, level, goal? }, …],        // the ladder, #44
}
```

- **Tutorial step**: a position (`config` + `moves`, replayed instantly) plus what to say
  about it. `config` carries over from the step before, so only the first step needs one
  (the framework fills every missing setting from the game's `settings` defaults through
  `Learn.configFor`, and always forces `players: 2`, `timer: 0`). With `expect: [cells]`
  the step waits for one of those clicks; any other click plays nothing and the panel says
  "Try the highlighted cell." Without `expect` a **Next** button advances. `highlight`
  defaults to `expect` and paints the cells with the class `hint` (a pulsing accent
  outline). **`expect` holds whole moves, not cells** — for a game that packs more than a
  cell id into its move integer (Isolation's `to * cells + removed`) the gate therefore fires
  on the click that *completes* the move, and such a game names its `highlight` cells itself
  instead of letting them default to `expect`. Nothing in the runner changes for it. A step's `moves` may jump anywhere: the chain tutorial replays 18 moves to set
  up its chain reaction. After the last step the panel says the lesson is done and the
  game is remembered as finished.
- **Scenario**: a real game against the game's bot from `history` (`Match.reset("bot")` +
  `Match.start` + `engine.replay`), so `toMove` must be 0 (you are always seat 0, the bot
  seat 1). Since #44 every scenario carries `tier` (`basics | tactics | mastery`), `kind`,
  `difficulty` (1..10) and `level` (the bot difficulty id it is played out against —
  `Learn.scenarioConfig` puts it into `config.bot`, the same door the room's bot uses, so
  `Match` needs no idea of Learn; an unknown level or a game without a bot falls back to the
  Opponent choice). `Learn.howto` fills every missing field in (`tier: "basics"`,
  `kind: "best-move"`, `difficulty: 3`) and sorts the list tier by tier, so a hand-written
  scenario stays valid.
  - `best-move` / `trap` / `turnaround`: the **first** move is judged against `best` (all
    optimal moves): in it → "Right!" and the scenario counts as solved, otherwise "Not this
    one." plus **Retry**, which sets the position up again. The game plays on either way,
    and winning it afterwards adds a "You won it." to the panel (a bonus, never required).
  - `play-from-here` (`goal: "win"`): no move is judged at all. The panel says "You must win
    this one. A draw is not enough." and the Bus's `game:finish` decides: `winner === 0`
    solves it, anything else (the bot wins, or a draw) says "The bot held this one."
  A solved scenario offers the next rung: `Learn.canAdvance()` / `again()` / `againText()`
  drive both the panel's Next button ("Next scenario") and the overlay's primary button,
  which app.js's `renderRematch` fills from `Learn.againText()` ("Retry" / "Next scenario" /
  "Start over").
- **Tiers and the lock**: `Learn.TIERS` (basics, tactics, mastery), `tierProgress(game,
  tier)` → `{ solved, total }`, `tierLocked(game, tier)` = the tier before it is less than
  `Learn.UNLOCK` (60 %) solved. A locked tier is only shown with a muted header (no note,
  the owner had it removed) — every row still starts when it is tapped, by the owner's rule
  that the lock is a nudge, not a wall. **Folding**: each tier is a card that is collapsed
  by default; `tierOpen(game, tier)` opens the first tier that is not fully solved, and
  none while the game's tutorial is not done yet, so the page always shows where to go
  next. A header click (`toggleTier`) overrides that for the visit, and `markSolved` /
  `markTutorial` forget the overrides so the rule decides again after any progress.
- **Where the scenarios come from**: `tests/puzzles/<game>/puzzles.json` is proven but
  never deployed, so `scripts/learn/pick-scenarios.mjs` (`npm run learn:scenarios`) builds
  the ladder in **two stages** and writes `client/learn/<game>-scenarios.js`, a classic
  script calling `Learn.scenarios(game, [...])`. A puzzle folder that holds a **rule
  variant** (`variant` in the file, `tests/puzzles/five-yavalath`) is skipped before the
  facts are collected: Learn teaches a game, not one of its optional rules.
  1. **Facts** (needs the bots, a few seconds per game): for every usable puzzle (`toMove
     === 0`, a config that does not start somebody else (`startPlayer`: a Learn table is
     always game 1, so seat 0 starts) and a value that is not already lost) it stores the proof `depth`, `legal` / `bestCount`, whether
     the game's own **greedy** move is optimal (one ply, the best `rules.estimate` after the
     move, so it needs no game-specific code at all — for chain that is the move taking the
     most cells, for five the one extending your longest row, for boxes the one grabbing the
     boxes), whether the **Easy** and the **Normal** bot answer with an optimal move,
     the searched win chance (`Bots.estimator` at 12 000 nodes) and the static `look`
     (`rules.estimate`). Plus 3 **play-from-here** positions from seeded self-play at the
     Hard level (a seeded random 6-ply opening makes each seed a different game; the first
     position in the 40–70 % window where **the state says seat 0 is to move** — never the
     ply's parity, Käsekästchen lets a seat move twice — and your chance is 45–70 %).
     Written to `scripts/learn/facts/<game>.json` (never deployed) and committed.
  2. **Select** (pure, and that is what the unit test re-runs): `difficultyOf(f)` =
     1 + proof depth (`(depth-1)/2`, capped at 4; a proof without a ply count reads as 6)
     + how thin the good moves are (share ≤ 5 % → 2, ≤ 15 % → 1.5, ≤ 35 % → 1) + 1 if the
     greedy move is wrong + 1.5 if Easy misses it + 1 if Normal misses it + 1 if you look
     behind, rounded and clamped to 1..10; a play-from-here row is scored by its tier
     (basics 4 / tactics 7 / mastery 9, +1 when the position is nearly even). `kindOf(f)` =
     `turnaround` (a proven win where either view is ≤ 35 %), else `trap` (the greedy move
     or the Easy bot's move is not optimal), else `best-move`. `select` sorts the
     candidates by difficulty, cuts them into three bands the size of the tier quotas
     (6 / 8 / 8 rows, one of them the tier's play-from-here position), takes each band kind
     by kind so a tier is never eight of the same thing, sorts each tier from easy to hard
     again and writes the titles ("Win in one
     move", "Spot the trap", "Behind, but winning", "Play it out", numbered inside the tier)
     and texts.
  All four games have their ladder (22 rows each: 6 / 8 / 8).
  It is deterministic (a re-run never diffs; `--facts-only` and `--keep-facts` split the two
  stages), the generated files are committed and listed in `index.html`, and the unit test
  re-runs `select` on the committed facts and compares. Hand-written scenarios (with a
  `text` explaining the idea) may sit in the definition's `howto.scenarios`; they are simply
  concatenated in front of the generated ones and land in Basics. Their `best` has to be
  right — the test only checks that it is legal.
- **Screens**: `#screen-learn` (one `.game-card` per game that teaches something, with
  "k / n scenarios") → `#screen-learn-game` (title, tagline, the rule bullets, "Start
  tutorial", then the scenario rows **grouped by tier**: one `.learn-tier-box` card per
  tier with a `.learn-tier` header button (chevron, the tier name, its "3 / 8" and the
  tier's one-line `text` from `Learn.TIERS`; `open` / `locked` classes, `aria-expanded`)
  and, while the tier is open, one row per scenario with the kind's icon (✓ once solved),
  the title, the kind's label and the difficulty as five dots (`Learn.dots`); folded rows
  are `hidden`), Back). On desktop (`min-width: 900px` and landscape) the card is a
  **two-column grid** 980 px wide: title and tagline across the top, Rules and the Tutorial
  block on the left (the rules row is `auto`, the tutorial row `1fr`, so the tutorial sits
  right under the rules), the scenario ladder on the right, Back centred underneath. The
  details page is **the one screen that scrolls** (#43, the replays screen does the same
  now): the lists are shown whole (no box inside a box that scrolls) and the page carries
  them, its card centred with `margin: auto` so its top never leaves the screen; `show()`
  in app.js puts every screen back at its top when it opens. Progress lives in
  `localStorage["chainreact.learn"]` = `{ tutorials: { chain: true }, solved: { five: [ids] } }`,
  per device, never sent anywhere.
- **A lesson runs on the normal game screen** with `#learn-panel` as the first block of the
  HUD (kind, "Step 2 / 6", the text, a hint line, Next / Retry / Back to Learn). Two rules
  keep it out of the way (#43): a **scenario** carries a small `Hide` / `Show` button
  (`#learn-hide` → `Learn.fold(on)` / `Learn.folded`, class `folded` on the panel, kept in
  `sessionStorage["chainreact.learnpanel"]` for the visit) that folds the explanation away
  so the whole board shows, the one hint line staying; and a **tutorial** measures the
  longest of its step texts (`sizeText`, on the real element, re-measured per step and on a
  resize) and gives `#learn-text` that `min-height`, so a longer step never changes the
  panel's height and moves the board. There is
  **no new `Match.mode`**: a tutorial is a plain `local` table (every seat is this device,
  which is also why premoves never appear) and a scenario a plain `bot` table; `Learn.active`
  is the flag the rest of the app checks. `body.learn` hides the HUD's Rematch / Back to
  room row, `body.learn-tutorial` also hides the win bars (noise next to the steps). A
  tutorial keeps the result overlay hidden; a scenario shows it with the lesson's buttons
  (Retry or "Next scenario", and "Back to Learn").
- **How Learn reaches the board**: two `Match.init` handlers, wired in app.js, keep the
  table generic — `beforeMove(i, p)` (false consumes the click: that is the tutorial's gate)
  and `cellClass(i)` (the `hint` class, the same door the premove marker uses). Advancing
  after a correct click listens to the Bus (`game:position`, then `Learn.STEP_MS` = 450 ms
  so the move can be seen) instead of hooking into the engine. Seat names come from
  `Learn.names(base)`: a tutorial renames seat 1 to "Opponent" and leaves your own name
  alone (so "Alex starts." still reads properly), a scenario changes nothing (Match already
  calls a bot seat "Bot").

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
edge next to ⚙, #7/#13). **The bar is a column (#43)**: the toggle on top (CSS `order: -1`,
it comes second in the DOM) and the list right under it, right-aligned and 206px wide, so
it wraps at five emojis per row and never reaches left across the ⚙ button; collapsed it
is invisible and takes no taps. `Reactions.place()` (called after every `fitBoard`) puts `#react-layer` **right
next to the board** when there is ≥ 66px of space (desktop), else in the free strip
above the full-width board (at its left edge, where the open list is not) or below it if
that strip is bigger — never over the board, never
off-screen. Emojis drift right → left while falling the layer's height (wobble, fade,
max 14 on screen). **Speed follows the rate** (#17): `Reactions.durationFor(recent)` with
`recent` = reactions shown (own + received alike) in the last `RATE_WINDOW` 3 s before
this one: 0 → `SLOW_MS` 4000 (a lone reaction can be seen), 1 → `MEDIUM_MS` 2800, ≥ 2 →
`FAST_MS` 1900 (spam stays quick); no randomness beyond the wobble. Spam is allowed on
purpose (~8/s; the receiver accepts one per 100 ms and only values from its own button
set). **Who sent it (#33):** every float carries `--react-color`, the sender's seat colour
(received: what `Room`/`BotPersona` pass to `receive(e, color)`, own: the `color()` handler
`Reactions.init` gets — app.js gives `Match.playerColor` of my seat, white while
spectating, the player to move when everyone shares one device; a missing or throwing
handler falls back to white). `game.css` turns it into a light
`drop-shadow(0 0 6px var(--react-color))` next to the usual dark shadow (chips get a
matching `box-shadow`), and a friend's reaction still gets the small dot in their colour.
`#net-banner` sits at 58px on phones so it stays clear of the toggle.

## Lessons learned

- **Mobile layout bugs are usually stacking/overlap**, not events: an invisible flex
  container (the collapsed reaction list) swallowed taps on the ⚙ button.
