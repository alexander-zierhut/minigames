---
paths:
  - "client/app.js"
  - "client/lobby.js"
  - "client/review.js"
  - "client/replay-list.js"
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
  - "client/lib/icons.js"
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

The title screen, the lobby and the game screen, the install button and version updates,
settings and preferences, skins, sounds, the Learn section, replay files, the store and the
analysis panel, chat and reactions. The core context is `AGENTS.md`.

## Who paints what

| Module | Owns |
| --- | --- |
| `client/app.js` | the screens (`show(name)`, `phase`), board fitting, the flow (`startGame`, `startFromLobby`, `requestRematch`, `backToLobby`, `leaveRoom`, `openLocalLobby`, `watchReplay`, `closeReplay`, `playFromHere`), the Rematch buttons (`renderRematch`), saving replays, the boot and every `init(...)` |
| `client/lobby.js` (`Lobby`) | the lobby screen (`render()`), the Invite modal, the copy confirmations, the seat buttons, the Opponent and How-to-play rows |
| `client/review.js` (`Review`) | the replay bar and the analysis panel after a game and in the replay viewer |
| `client/replay-list.js` (`ReplayList`) | the replays screen (filters, pages, watch / save / delete, open a file) |
| `client/learn.js` (`Learn`) | the two Learn screens, the lesson panel in the HUD, the How-to-play modal |
| `client/settings.js`, `client/prefs.js`, `client/opponent.js`, `client/changelog.js` | one modal each |

app.js is the only screen switcher: Room, Learn and ReplayList ask for a screen through
the `show` handler they get; Match never switches screens. `show()` puts the screen back at
its top, tells `Update` (the notice lives on the title screen only) and `Room.updateBanner`
(the banner shows in the lobby and in a game only), fits the board on the game screen and
renders the lobby when it opens.

## Flow: title → room lobby → game (the "party" model)

One room, one link, the whole evening.

- **Title** (`#screen-menu`): the greeting `.menu-hello` "Hello [name]!" whose `#menu-name`
  field is the very same name preference as Profile in ⚙ (see Preferences); section
  *Online* with `Create room` + `Join room` (`#join-panel` with the code field appears on
  Join room) and the hint `#menu-online-hint`; section *Offline* with `Local multiplayer`
  (`#btn-local`) and `Against a bot` (`#btn-bot`); the foot with `Learn to play`
  (`#btn-learn`) and `Replays` (`#btn-replays`) over the quiet pills `#btn-install` (see
  Install) and `Changelog` (`#btn-changelog`). Above the card sits `#update-notice` (see
  Version updates). Never scrolls on a phone. The ⚙ preferences button floats top-left on
  every screen.
- **Version updates** (`client/lib/update.js`, #40): while the title screen shows, `Update`
  fetches `version.json` (`cache: "no-store"`, 4 s cap) on load, whenever the tab becomes
  visible and every `Update.EVERY_MS` (3 min), and compares it with the running
  `<meta name="version">` (`Update.isNewer(running, latest)`: two different non-empty
  stamps, never "dev", so the unbundled dev page and the tests never poll). A different
  stamp sets `Update.available` and shows `#update-notice` ("A new version is ready." plus
  `#btn-update-reload`). `Update.screenChanged()` hides the notice away from the title
  screen and shows it again on the way back. After `Update.AUTO_MS` (20 s) with the notice
  up and no click or key press the page reloads itself once (`Update.reload`, replaceable
  in tests); every failure (offline, 404, timeout, garbage) is silent.
- **Lobby** (`#screen-lobby`, `Lobby.render()`), the same screen for local play, against a
  bot and a room (`Match.mode`), in three blocks and one primary action:
  1. **Head** (`.lobby-head`): the kind label (`#lobby-kind`: "Online room" / "Local game" /
     "Against a bot") over `.lobby-head-row`, one line whose items are vertically centred:
     the room code (`#lobby-code`; "You vs bot" / "Same device" offline; "Watching" for a
     spectate-link viewer, class `as-word`) with, online only, the primary `#btn-invite`
     "Invite" beside it (`#lobby-share`), and the seat count (`#row-players`, the segmented
     `#set-players` 2 / 3 / 4). **Where the count lives depends on the mode** and
     `Lobby.render` moves the one control: in a room on that line (phones put it under the
     code), offline in its own section `#group-count` over the game, and against a bot
     nowhere (`Settings.setMode` hides it). Online `#screen-lobby.online` makes the code a
     button: **a tap copies the invite link** (the spectate link for a viewer) and the code
     turns green (`.copied`) for `Lobby.DONE_MS` (1.4 s); the text never changes, so
     nothing moves.
     Invite opens **`#invite-modal`**: the code again (`#invite-code`, hidden for a viewer)
     and four `.settings-summary.invite-row` rows with an icon, a label and a one-line
     explanation: `#btn-share` "Share link", `#btn-copy-code` "Copy room code",
     `#btn-share-spectate` "Copy a link for spectators" and `#btn-hide-code` "Hide the room
     code" / "Show the room code" (`#hide-code-label`, the eye / eye-off icon; see "Hidden
     room code" in `online.md`). Hiding the code **the first time on a device** opens
     `#hide-code-ask` ("Hide the room code in every new room from now on?"): "Always hide
     it" sets the `hideCode` preference, "Just this room" hides this one; both remember
     `Prefs.hideCodeAsked`, and showing the code never asks. A viewer sees only the
     spectator row. `startGame` and `leaveRoom` close the modal (`Lobby.closeInvite`). A
     row that copied something says so **on itself**: its icon becomes a check and its
     border turns green (`.done`) for `DONE_MS` (`flashDone`); the phone's share sheet and
     the fallback prompt say it themselves and do not flash.
  2. **The seats** (`#group-players`, a room's only): the heading `#row-seats-label`
     "Players" with `#lobby-spectators` "N spectator(s) watching" as its note; one
     `.lobby-player` card per seat from `#tpl-lobby-player` (as many as the *Players*
     control says; the name, `(you)` in `.lp-you`, `#lp-<k>-status` "connected" / "not here
     yet" / "ready"; an absent seat gets `.absent`). The seat controls sit **inside the
     card they act on** (`.lp-act`; `Lobby.render` parks them in the hidden `#seat-actions`
     and moves the shown ones into the cards, so the ids never change): `#btn-watch` "Watch
     instead" on my own card, `#btn-take-seat` "Sit here" on the first empty card for a
     spectator (disabled without a free seat, #39), `#btn-room-bot` "Add a bot" on the empty
     card of a two-seat room and `#btn-room-bot-off` "Remove the bot" on the bot's card
     (#36). Under the cards only the transient `#lobby-status` ("X left the room.", cleared
     once everyone is back). Connection trouble never shows as a line here: it goes on the
     Start button in two words and into the sticky `#net-banner` (see "Where a status is
     shown" in `online.md`).
  3. **Group "Game"** (`#group-game`): the picker (one `.game-card[data-game]` per
     registered game, built by `Settings.init`; each card says "2 to 4 players" and a game
     that doesn't take the chosen count is `.unsupported` + `disabled`, #28), the empty
     `#menu-tagline` line (kept as space by the owner's wish), then the **Options** heading
     over up to three `.settings-summary` rows: `#btn-howto` (→ `#howto-modal`, the
     selected game's rule bullets and tutorial steps as text, closed by `startGame`),
     `#btn-opponent` (in bot mode and while a room has a bot, → `#bot-modal`) and
     `#btn-settings` (→ `#settings-modal`).
  Then `.lobby-foot`: `#btn-start` (the one big primary button; its text says why it is
  disabled: "Spectating", the connection trouble's two words, "Waiting for your friend…" /
  "Waiting for N more players…", "Start game (asks the host)") and `#btn-lobby-back`
  ("Leave room" / "Back"). No chat in the lobby. The card fits 360×780 for a local or a
  two-seat room; four seats with every control shown are taller, and then **the screen
  scrolls, never the card** (that is the rule everywhere: `.menu-card` has no `max-height`
  and no `overflow`, the screens and `.modal` use `safe center` alignment with
  `overflow-y: auto`; the HUD log and the replays dropdown menu are the two boxes that
  still scroll by design). `Lobby.render` is called by `show("lobby")`, by Room on every
  presence / seat / settings change (the `renderLobby` handler), by Skins and Prefs (a new
  look or name) and by Settings and Opponent in bot mode.
- **Game** (`#screen-game`): board + HUD ("hut"). Result overlay (`#overlay`): `Rematch`
  (`#overlay-again`), `Look at board` (`#overlay-look`, hides it and opens the replay bar),
  `Change game` (`#overlay-menu`). The HUD has `Rematch` (`#btn-restart`) and `Back to room`
  (`#btn-menu`) too, phones behind ☰ (`#gear`). `renderRematch()` in app.js is the only
  writer of those texts: Spectating / Rematch / Waiting… / Accept rematch; "Back to
  replays" while a replay is watched; a lesson's own "Retry" / "Next scenario" / "Start
  over" and "Back to Learn" while `Learn.active`.
- **Replay bar** (`#replay-bar`, `Review`, #38): after "Look at board" a fixed one-row bar
  holds `|◀ ◀ "Move 12 / 30" (#replay-pos) ▶ ▶| ▶▶` and `#result-fab` "Show result" (inside
  the bar, so hiding the bar hides both). Every step is `Review.show(ply, announce, auto)`
  → `engine.preview(ply)`; the last ply turns the preview off (live position). `←`/`→`
  step, `Home`/`End` jump to the ends (ignored while an input has focus). `Review.hide()`
  (new game, rematch, back to room, leave, "Show result") drops the preview. `▶▶`
  (`#replay-play`, #43) walks from the shown move to the last one and becomes `❚❚`:
  pressing it at the last move starts over at move 0, reaching the end stops by itself,
  and any step by hand pauses. The pace is `Replays.playback({ ply, total, seek, ms })`, a
  pure state machine (`Replays.STEP_MS` 900 ms, timers injectable). Online, every step
  sends `review {ply, play}` so the whole room looks at the same move: `play: true` makes
  the other side start **its own** timer from that move (`Review.follow`, Room's `onReview`
  handler), a plain `review {ply}` pauses and jumps. Desktop: bottom centre; phones: above
  the HUD, `fitBoard` publishes `--hut-h` (the strip the HUD takes) and `--dock-h` (the
  height of `#replay-dock`, the fixed column that carries the bar and the analysis panel
  above it) so neither covers the board.
- **Replays** (`#screen-replays`, `ReplayList`, #42): the list of the games this device
  played (`Replays.store`, newest first), a **tool, not a small card**: 860 px wide on
  desktop, the head row holds the title and `#btn-replay-upload` "Open a replay file" (the
  hidden `#replay-file` input, `accept` `.replay,.json`: parse → migrate → validate → save
  → watch). **Filters** in `.replay-tools`: the game **dropdown** (`#replay-filter`, #43:
  `.dropdown` = a `.dd-button` showing the picked game's small preview tile and title, and
  a `.dd-menu` of `.dd-option[data-filter]` rows, "All games" first; a click next to it or
  Escape closes it; only this screen uses `.dropdown`, because a `<select>` cannot show the
  tiles), the segmented `#replay-kind` (All / Bot / No bot; a game counts as a bot game when
  `Replays.summary(doc).bot` says so: `meta.mode === "bot"` or a room whose `config.bot`
  seats one), the name search `#replay-search` and the date range `#replay-from` /
  `#replay-to` (`type="date"`, inclusive, local calendar days through `Replays.dayOf`). All
  of it is `Replays.filter(items, { game, kind, search, from, to })` over `store.list({})`;
  `#replay-count` says "12 replays" or "3 of 12 replays". The rows come in **pages** of
  `ReplayList.PAGE` = 10 (`#replay-pager` with `#replay-page-prev` "‹ Newer",
  `#replay-page` "Page 1 of 2", `#replay-page-next` "Older ›", hidden with one page; every
  filter change goes back to page 1). One `.replay-item` per row from `#tpl-replay` (the
  small preview tile, the title "Five Wins · 5 × 5", the sub line "date · names · result ·
  moves") with **Watch** / a download icon (`ReplayList.download`) / a trash icon.
  `.replay-body` keeps a minimum height and `#replays-hint` is the centred **empty state**
  ("No replays yet…" or "No replay matches…"); `#replays-note` warns when the browser has
  no IndexedDB. **Nothing scrolls inside the card**: the screen scrolls, the pagination
  bounds the height, `#btn-replays-back` sits at the bottom.
  **Watching one** (`watchReplay(doc)` / `closeReplay()` in app.js): `Match.watch(doc)`
  puts the record on the game screen with `Match.mode === "replay"`, every seat `watch`
  (nobody may play, no clock, no bot, no premove, no room), the names from the file
  (app.js's `seatNames()` returns `replayDoc.players`), and the replay bar opens at move 0
  through `Review.show`. Games are saved automatically in app.js's `saveReplay(finished)`:
  from Match's `onFinish` when a game ends, and from `backToLobby` / `leaveRoom` for a game
  left half way (`result.over: false`); a replay of a replay is never saved, a lesson is
  not saved, and the same game saved twice keeps one entry (the id is a content hash).
  Online every device saves its own copy, spectators included; nothing about replays
  travels through the room.
- `Match.mode` ∈ `local | bot | online | replay`. Bot mode is the offline lobby with the
  *Opponent* row. **One bot per game (#21)**, called "Bot" wherever a player sees it
  (`Opponent.NAME`; `Bots.botFor(game, cfg)` picks it): the modal is one step (description,
  scores, difficulty, Cancel / Play). Picking a game does **not** open it (#12): the default
  is the middle difficulty; the row shows the choice. Offline you are seat 0 and the bot sits
  on seat 1 unless the config names the seat (`config.bot.seat`, which is how "Play from
  here" (#43) and a Learn scenario seat it; `Settings.BOT_SEAT` 1 is only the default a
  room's bot is filled with). **A room can play a bot too (#36)**, see "The room's bot" in
  `online.md`.
- **Learn** (`#screen-learn`, `#screen-learn-game`, #41): see the "Learn section" chapter.
  Lessons themselves run on `#screen-game`.
- `phase` ∈ `menu | lobby | game | replays | learn | learn-game` (the list `SCREENS`, one
  `#screen-<name>` each); Room reads it through its `phase()` handler and only ever cares
  about `game` / `lobby`. `Match.gameNo` increments per started game (local too);
  `Match.startPlayerFor(g, players) = (g - 1) % players` → seat 0 starts game 1, then the
  next seat, round-robin. `Settings.setMode(mode)` is called on every mode change
  (`local` / `bot` / `online`): against a bot the *Players* row is hidden and the config
  says 2. `startGame(cfg, gameNo, prefix)` closes How to play and Invite, drops any replay
  and preview, `Room.newGame()`, `Match.start`, replays the `prefix` ("Play from here"),
  renders the Rematch buttons, shows the game and `Room.render()`s. Room calls `startGame` /
  `backToLobby` through its handlers when the protocol says so.

## Settings (`client/settings.js`)

Form in `#settings-modal` (opened from the lobby summary, closed by Done / backdrop;
number inputs are clamped on `change` and on close, never on `input`, so typing "12"
doesn't snap at "1"). Persisted in `localStorage["chainreact.settings"]` together with
`sizeFor` (remembered board size per game). Inputs have `autocomplete="off"`.

- **Every control is a dropdown**, the timer's shape: a few values that work well, "Off"
  where the setting can be off, and "Custom…", which reveals a number row (`.row-custom`,
  `#row-<key>-custom` with `#set-<key>-custom`) right under it. Units are part of the option
  text ("15 explosions") or of the custom row's label.
- Shared rows (in index.html): board size (`#set-size`, options built per game by
  `fillSize` from `size.presets` inside the limits `size` + optional `minSize(cfg)`: chain
  3–12 default 6, five 5–25 default 11, isolation 5–12 default 7, boxes 2–10 default 5; the
  label `#size-label` is "Board size" for every game, `#size-hint` the range; a size
  remembered in `sizeFor` wins over the default), timer per player (`#set-timer`: Off / 1 /
  3 / 5 / 10 min / custom minutes in `#set-timer-custom`). **Players** is not in the modal:
  it is the lobby's segmented control (`#set-players`, `Settings.setPlayers(n)` /
  `Settings.players`; hidden and forced to 2 against a bot, #28). Every game declares
  `players: { min, max }` (default 2–4); `Settings.supports(key)` says whether the selected
  count fits, the picker grays the others out and `selectGame` moves off an unsupported
  game. **Nobody may be pushed out of a seat (#34):** `Settings.setMinPlayers(n)` (called by
  `Lobby.render` with `Room.online ? Room.occupiedSeats() : 2`) disables every smaller count
  (`title` = `Settings.MIN_PLAYERS_HINT`), and `read()` / `write()` / `setPlayers()` lift
  the count to that floor. A locked control (`setLocked`, #29) stays fully disabled.
- **Game rows are generated** into `#game-settings` from every registered game's
  `settings` list (`Settings.init` → `buildRows`). A setting is
  `{ key, label, type: "select" | "bool" | "preset", def, min?, max?, options?, presets?,
  off?, startOff?, suffix?, customLabel?, flag? }`; `label` may be a **function of the
  current config**, re-read on every change and on a game switch (`syncLabels`), which is
  how five's Yavalath row says "Lose when 4 in a row". The types: `select` (`options` =
  `[[value, label], …]`), `bool` (an Off / On dropdown) and **`preset`** (`presets:
  [numbers]`, optional `off` label with `startOff`, `suffix` for the option text, `min` /
  `max` / `def` and `customLabel` for the Custom row). A preset may name a **`flag`**: one
  control then writes two config keys, which is how chain's "Win on a long chain" row sets
  `chainRule` on or off and `chainLen` to the number, leaving the config shape (and every
  replay) as it was. The row is `<label class="row" id="row-<key>" data-setting="<key>">`,
  the input `#set-<key>`, key lowercased. A row is shown when the selected game's list
  contains its key; `#game-settings` is `display: contents`, so hidden rows take no gap.
  Today: five `winLen` (a preset 3/4/5/6/7, default 5, also the board's minimum) and
  `yavalath` (Off / On); chain `speed` (Slow 1100 / Normal 750 / Fast 350 ms) and the
  `chainLen` preset with the `chainRule` flag (Off, or 10 / 15 / 20 / 30 explosions, or a
  custom number). Isolation and Dots and Boxes declare none.
- `Settings.read()` returns the **config** a game starts with: `{ game, players, n, timer,
  timerSel, timerCustom, bot, …every game field of every game }` (all fields travel so a
  mirrored settings message is complete for any game the room may pick). `bot` (#36) is
  `null` or `{ id, difficulty, seat }` (`Settings.setBot(choice[, announce])` /
  `Settings.bot`, cleared by `setMode` for anything but `online` and by `Room.leave`); it is
  deliberately **not** part of the summary text, the lobby's *Opponent* row shows it.
- Summary text: `n × n` · (`N players` when more than two) · `describeRules(cfg)` parts ·
  timer · `describeOptions(cfg)` parts (e.g. "7 × 7 · 5 in a row · 3 min timer").
- Any change → `onChange(config)` → app sends `lobby {s}` to the friends
  (`Room.settingsChanged`). `Settings.write` runs silently (no echo) when applying the
  friends' settings. `selectGame(key, announce, resetSize)`: `resetSize` takes the size the
  game remembers instead of what is picked (true when the game really changes and when a
  config arrives, false for the re-renders that only gray out cards).
- The **look is not a setting** (see Skins).

## Icons (`client/lib/icons.js`)

Every icon in the UI is a monochrome 24 × 24 line drawing stroked in `currentColor` (no
emoji as icons; emoji stay for the reactions and the bot persona, which are content).
`<span data-icon="book"></span>` gets its SVG (`svg.ico`, 1.1 em), a `MutationObserver`
fills nodes added later (cloned templates, rows built by scripts), `Icons.set(el, name)`
swaps one, `Icons.svg(name)` builds a bare element, `Icons.names()` lists them. Names in
use: settings, phone, eye, eye-off, copy, monitor, share, book, bot, download, trash, user,
palette, volume, video, wrench, chat, target, alert, refresh, flag, check, menu.
`tests/unit/icons.test.mjs` checks every `data-icon` in the page is known and that no
emoji is left where an icon belongs.

## Preferences (`client/prefs.js`, per device — the ⚙ button)

`#prefs-btn` (class `corner-btn`, a pill fixed top-left on every screen) opens `#prefs-modal`.

**Two levels (#32)**: a **menu** (`#prefs-nav`) with one row per section (`#prefs-nav-<key>`:
icon, name, `#prefs-sum-<key>` = `Prefs.sectionSummary(key)`, chevron) and one **panel** per
section (`#prefs-panes` → `.prefs-section[data-section=<key>]`). Sections in order:
`Prefs.SECTIONS` = profile, look, sound, streaming (shown as "Content Creator"; the key
stays `streaming` for the stored preferences and the ids), developer, feedback.
`Prefs.showSection(key)` opens one (`null` = the menu), `Prefs.section` says which is open;
the card carries `on-section` while one is. On **phones** (`max-width: 899px`) exactly one
level shows: the modal opens on the menu, a row opens its panel with `#btn-prefs-back`, Done
(`#btn-prefs-done`) closes from anywhere, and every section fits 360×780 without scrolling.
On **desktop** `.prefs-body` is a two-pane grid: the menu is the left column (the open row
`selected`; the menu keeps its own height, `align-self: start`) and the open section sits
beside it in a card of its own (`.prefs-section` with a `.section-title` heading);
`open()` selects the first section right away. A too tall modal scrolls as a whole.
**Adding a section = one nav row + one `.prefs-section` panel in index.html + one entry in
`SECTIONS`** (and a `sectionSummary` case).

The sections hold: **Profile** (#35: `#pref-name`, `maxlength` 16, written back on
`change`), **Look** (the only `.skin-seg`, kept in sync by `Skins`) plus `#pref-win-graph`
("Win chance graph in replays", on by default, #43), **Sound** (`#pref-volume`, default
30 %; `#pref-soundset`: follow the look / Classic / Blocks; one checkbox per category
`#pref-snd-<cat>`, `Prefs.CATEGORIES` = moves, explosions, results, turn, reactions, chat;
`#pref-test-sound`), **Content Creator** (the primary button `#pref-creator-mode` "Turn on
content creator mode" sets every option of the section at once, `CREATOR` = hideCode,
privateIp, muteSpectators, and once all are on reads "Turn off content creator mode" as a
plain button; the menu row's summary is "Best for streaming", "partly on" or "on";
`#pref-hide-code` enter rooms with the code hidden, #19; `#pref-private-ip` "Keep my IP
always private": every connection relayed through TURN, #30, read by `Net` when the peer
is created; `#pref-mute-spectators` "Hide chat and reactions from spectators", see
`Room.hides` in `online.md`), **Developer** (`#pref-developer`: the info panel, #31) and
**Feedback**. Stored in `localStorage["chainreact.prefs"]` (`Prefs.get()` → `{ name,
defaultName, volume, soundSet, sounds, winGraph, hideCode, hideCodeAsked, privateIp,
muteSpectators, developer }`; `Prefs.set(patch)` merges, clamps, persists, refills the form,
re-renders the menu rows and calls `onChange`).

**The name (#35)** is the one preference that leaves the device. `Prefs.cleanName(s)`
collapses whitespace, trims and cuts to `Prefs.NAME_MAX` = 16 characters **and** to the
width of 16 letters "n" in the greeting field's bold 14 px font (`Prefs.fitName(s,
measure)`, measured with a hidden span; where nothing can be measured, jsdom, only the count
applies); every name that arrives from the room goes through it too and only ever into the
DOM as `textContent`. On the **first visit** one of the ~40 short names in
`Prefs.DEFAULT_NAMES` is drawn, stored as `defaultName` **and** as `name`, and persisted at
once; clearing the field falls back to that drawn name. `Prefs.seatNames(count)` = the
seats when everybody plays on one device: me first, then the first default names that are
not mine (pure and deterministic). The title screen's `#menu-name` is a second field for the
same preference (`Prefs.fill` writes both, sized to the width budget of a name). app.js
compares `p.name` in `onChange` and only then calls `Room.nameChanged()` and re-renders.
Nothing else here is sent to the room, and none of it is part of `Settings.read()`.

Layout: on phones `#screen-menu` / `#screen-lobby` get `padding-top: 56px` and `#board-wrap`
`padding-top: 52px` so cards and the board start below the two corner buttons (⚙ left, 😜
right); `fitBoard` subtracts the wrapper's padding; `#net-banner` sits at 58px.

- **Feedback** (#8): `#pref-feedback` opens a GitHub "new issue" page (`Prefs.feedbackUrl()`)
  with the situation prefilled from `Prefs.init({ context })` in app.js: screen, name, mode,
  game, settings summary, players, seat, spectator, bot, connection, look, sound, viewport,
  `<meta name="version">` (build.mjs stamps the git hash + date; "dev" unbundled), browser,
  last 5 log lines — never the room code or chat text.

## Skins (`client/skins.js`, per device)

**Naming (owner's decision):** the textured looks are called **"Blocks board"** and
**"Blocks"** in every user-facing text; the word "Minecraft" must not appear in the UI or in
public texts. Internal keys, CSS classes and storage values stay `mcboard` / `mc` /
`skin-mc*`.

One `.skin-seg` control, in the preferences modal only (`Skins.init` wires every instance
it finds), stored in `localStorage["chainreact.skin"]`, never sent to the friend, never in
the settings modal. The DOM is identical for every skin; a body class switches the CSS and
**nothing else** (the look has no player names of its own since #35).
- **Classic** (default, owner's favourite — don't touch its look): dark navy UI, cyan vs
  amber, rounded cells, lamps as dots.
- **Blocks board** (`body.skin-mcboard`): classic UI, block textures on the board, flying
  pieces, sparks, HUD player blocks and picker previews.
- **Blocks** (`body.skin-mc`): board part + full block-style UI: dimmed dirt background,
  dark-oak plank panels with black border, near-black inner boxes, stone buttons (gray face,
  black outline, bevel, blue hover), black text fields, white text with drop shadow, yellow
  `#ffff55` titles. Owner rejected an earlier light-wood look as unreadable — keep it dark.

### Player colours in CSS (how 4 seats stay cheap)
`base.css` defines `--c<k>`, `--c<k>-dark/-light/-bg` for seats 0–3 and the rules
`.p<k>, .turn-p<k> { --pc … --pc-bg }` plus `--block` (the shiny radial gradient). Every
other rule uses `var(--pc)` etc. and never a seat number: a cell with class `p1`, a
`.player` card, a `.log` line, `#board.turn-p0`… all pick up their own colour. The engine
also adds `taken` to owned cells so "owned" styling doesn't need `:is(.p0,.p1,…)`. The
textured skins do the same with `--tex-p` / `--tex-glass-p` (`skin-mc.css`: diamond / gold /
emerald / redstone blocks, matching glass). Glows use `color-mix()`.

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
the recorded result, because the rules may have grown since. `idFor(doc)` is a content
hash, so the same game saved twice is one entry; `fileName(doc)` →
`chain-2026-09-10-2130.minigames.replay` (`Replays.EXT`; the content is JSON and older
`.json` files open too), `when(iso)` the list's date, `dayOf(iso)` its local calendar day,
`summary(doc, id)` one list row (with `bot`) and `filter(items, { game, kind, search, from,
to })` the list's filters.

**Rule when the format changes:** bump `VERSION`, add `MIGRATIONS[old]` (one step per
version, chained), and put a sample of the **old** version in `tests/replays/` next to the
new one. `tests/unit/replays.test.mjs` plays every `tests/replays/v*.json` and fails when a
version has no sample or no migration; the `bad-*.json` files there must stay refused.

`Replays.store` keeps the documents in IndexedDB (db `chainreact`, `DB_VERSION` 2, store
`replays`, keyed by id, indexes `game` and `playedAt`, the oldest dropped past 200):
`save(doc)`, `list({ game })` (newest first, summaries), `get(id)`, `remove(id)`, `clear()`,
`persistent()` — all async and fail-safe: without IndexedDB (private mode, jsdom) it falls
back to memory for the visit and `persistent()` says false. The same database has a
**second object store `analysis`** (#43, `store.analysis.get/put/remove/clear`) keyed by
the same `idFor(doc)`; it is derived data, so it never enters the replay document and goes
away with the replay it belongs to. Adding another store means bumping `DB_VERSION` and
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
bars use, at the fixed budget `Analysis.NODES` (12 000), and the best move from
`Bots.botFor(game, config)` at its strongest level up to `Analysis.BOT_NODES` (30 000),
seeded 1, one instance per seat. **Node budgets, never wall clock**, so the same game always
gets the same numbers. `loss` = the win-chance points a move gave away against the bot's
move (from the mover's own view; 0 when the bot would have played it); the seat a ply
belongs to is the `current` of the position **before** it, never the ply's parity, so Dots
and Boxes counts every move for the right player; `perfect` = the bot's move **or** `loss <=
Analysis.TOLERANCE` (3 points). `Analysis.MISTAKE` 10 and `Analysis.BLUNDER` 20 name the
rest. With 3 or 4 players there is no estimator: no `loss`, no graph, only `best === played`
counts.

**The score of a seat** (0…100):

```
accuracy = perfect moves / moves of that seat
score    = 100 × (0.6 × accuracy + 0.4 × max(0, 1 − average loss / 50))
         = 100 × accuracy                    when there is no win chance (3–4 players)
```

The run yields to the page between plies (`breathe`), reports progress, stops when the panel
is closed (`cancelled`) and gives up after `Analysis.MAX_MS` / `MAX_PLIES` with
`partial: true`. A partial result is **never cached**. Finished results go into the
`analysis` store under the replay's id, stamped with `{ bot, version, nodes, botNodes }`:
`Analysis.load(id, stamp)` returns nothing when any of them changed, so a new bot version or
a new budget re-analyses instead of showing old numbers.

**2. The panel** (`#replay-panel`) hangs above the replay bar in `#replay-dock`, in the
replay viewer **and** after a live game (never during a Learn lesson). `Review.init` wires
it (`Analysis.init({ onSeek, onPlayFrom })`); `Review.show` opens it on the first step
(`Analysis.open(doc, { canPlayFrom })`, a cached result appears at once), `Review.render`
asks `Analysis.at(ply)` for the cell to mark and hands it to `Match.mark(i)`, which puts
`.best-move` on that cell through the engine's `cellClass` hook (premove first, then the
best move, then Learn's highlight; a game whose moves are not plain cell ids is asked with
`engine.cellOf`), `Review.hide` tears it down. The panel shows, for the move that led to the
shown position: the verdict (`Perfect move` / `Best was 12 (4 % lost)` / `Mistake: …` /
`Blunder: …`, colour-coded), the win chance before and after it, the **win-chance line
graph** (inline SVG, one line per seat, a marker at the shown ply, a click jumps to that
move; two players only, and only while the `winGraph` preference is on) and one row per
seat with the score, `perfect / total`, blunders and mistakes. `#btn-analyse` starts a run
that was cancelled, `#analysis-progress` is the progress bar while it runs. Phones start
collapsed (the head row only) and `#an-toggle` opens the body; desktop always shows it.

**Play from here** (`#btn-play-from-here`, two-player replays only, offered in the viewer):
`playFromHere(ply)` in app.js starts an **offline bot game** (`Match.reset("bot")`, like
"Against a bot"; until #52 it opened an online room, which greeted the player with "Waiting
for your friend…" and left them in a room lobby): the human takes the seat that is to move
at the shown position and the bot the other one through `config.bot = { id, difficulty,
seat }`, which `Match.makeSeats` honours offline too. `Match.gameNo` is set so that
`startPlayerFor` gives the recorded game's starter, and the moves up to `ply` travel as the
**start prefix**: `startGame(cfg, gameNo, prefix)` replays `{ history, outs }` into the fresh
game right after `Match.start` (a room's `start {config, g, prefix}` carries a prefix the
same way, so the path stays generic). While such a game runs (`continued` in app.js) the HUD's
`#btn-menu` and the overlay's `#overlay-menu` say "Back to replays" and go through
`closeReplay()`, which keeps the game left half way like every other exit; Rematch stays and
plays a fresh game against the same bot on the same seats.

## Sounds (`client/lib/sound.js`)

`Sound.init({ seats, player })` subscribes to the Bus; `seats()` returns the seat kinds
(`Match.seats.map(s => s.kind)`) and is the only thing the module knows about the game.
- **Mapping** (`Sound.map(event, data, kinds)`, pure): `game:move` → `place`;
  `chain:prime` → `prime` (the fuse, stopped after `ms`); `chain:explode` → `explode`
  (gain and pitch grow a little with the chain length); `boxes:capture` → a second, brighter
  `place`; `game:finish` → `win` / `lose` from the local human's perspective
  (`Sound.me(kinds)`: exactly one local seat among non-local ones — online or against a
  bot; otherwise −1 → neutral `over`, also for a draw); `game:turn` → `turn` only when the
  seat is local and someone else just moved; `reaction` → `reaction` (theirs a bit lower);
  `chat` → `chat` for other people's lines only.
- **Gate**: `Prefs.volume` (0 = silent; gain = `(volume/100)^1.6`) and the category of the
  cue (`Sound.CATEGORY`: place → moves, prime/explode → explosions, win/lose/over →
  results, turn → turn, reaction → reactions, chat → chat). What passes lands in
  `Sound.log` (last 30 `{ name, set, at }`, the e2e hook) and goes to the player.
- **Sets**: `Sound.set` = `Prefs.soundSet` or, on `auto`, `classic` for the Classic look and
  `mc` for both textured looks. `classic` synthesizes everything with WebAudio; `mc` plays
  `Sound.FILES` (stone1 = place, fuse = prime, explode1 = explode, levelup = win, anvil_land
  = lose, bass = over, pling = turn, pop = reaction, orb = chat), fetched + decoded lazily
  (all preloaded on unlock when the set is `mc`; a cue whose file isn't decoded yet is
  skipped, never delayed).
- **Autoplay rule**: the `AudioContext` is created on the first `pointerdown`/`keydown`/
  `touchstart` (`Sound.unlocked`); until then cues are logged but inaudible. Tests
  dispatch a `PointerEvent("pointerdown")` on `window`. A page without `AudioContext`
  (jsdom) never throws — the player is a no-op. The whole module is fail-safe.

## Learn section (`client/learn.js`, #41, #44)

An offline academy per game, **entirely data driven**: everything a game teaches lives in
its definition under `howto`, so a new game adds data and no code here.

```js
howto: {
  rules:     ["one short sentence per rule", …],                   // details page + the lobby modal
  tutorial:  [{ text, config?, moves?, expect?, highlight? }, …],  // a guided lesson on a real board
  scenarios: [{ id, title, text, config, history, toMove: 0, best: [cells], tags?,
                tier, kind, difficulty, level, goal? }, …],        // the ladder, #44
}
```

- **Tutorial step**: a position (`config` + `moves`, replayed instantly) plus what to say
  about it. `config` carries over from the step before (the framework fills every missing
  setting from the game's `settings` defaults through `Learn.configFor`, and always forces
  `players: 2`, `timer: 0`). With `expect: [cells]` the step waits for one of those clicks;
  any other click plays nothing and the panel says "Try the highlighted cell." Without
  `expect` a **Next** button advances. `highlight` defaults to `expect` and paints the cells
  with the class `hint`. **`expect` holds whole moves, not cells**: for a game that packs
  more than a cell id into its move integer (Isolation) the gate fires on the click that
  *completes* the move, and such a game names its `highlight` cells itself. After the last
  step the panel says the lesson is done and the game is remembered as finished.
- **Scenario**: a real game against the game's bot from `history` (`Match.reset("bot")` +
  `Match.start` + `engine.replay`), so `toMove` must be 0. Every scenario carries `tier`
  (`basics | tactics | mastery`), `kind`, `difficulty` (1..10) and `level` (the bot
  difficulty id it is played out against; `Learn.scenarioConfig` puts it into `config.bot`,
  the same door the room's bot uses; an unknown level or a game without a bot falls back to
  the Opponent choice). `Learn.howto` fills every missing field in (`tier: "basics"`, `kind:
  "best-move"`, `difficulty: 3`) and sorts the list tier by tier.
  - `best-move` / `trap` / `turnaround`: the **first** move is judged against `best`: in it →
    "Right!" and the scenario counts as solved, otherwise "Not this one." plus **Retry**. The
    game plays on either way; winning it afterwards adds "You won it." (a bonus).
  - `play-from-here` (`goal: "win"`): no move is judged. The panel says "You must win this
    one. A draw is not enough." and `game:finish` decides: `winner === 0` solves it.
  A solved scenario offers the next rung: `Learn.canAdvance()` / `again()` / `againText()`
  drive both the panel's Next button and the overlay's primary button (`renderRematch`).
- **Tiers and the lock**: `Learn.TIERS` (basics, tactics, mastery), `tierProgress(game,
  tier)` → `{ solved, total }`, `tierLocked(game, tier)` = the tier before it is less than
  `Learn.UNLOCK` (60 %) solved. A locked tier is only shown with a muted header; every row
  still starts when tapped (the lock is a nudge, not a wall). **Folding**: each tier is a
  card, collapsed by default; `tierOpen(game, tier)` opens the first tier that is not fully
  solved, and none while the game's tutorial is not done yet. A header click (`toggleTier`)
  overrides that for the visit; `markSolved` / `markTutorial` forget the overrides.
- **Where the scenarios come from**: `tests/puzzles/<game>/puzzles.json` is proven but never
  deployed, so `scripts/learn/pick-scenarios.mjs` (`npm run learn:scenarios`) builds the
  ladder in **two stages** and writes `client/learn/<game>-scenarios.js`, a classic script
  calling `Learn.scenarios(game, [...])`. A puzzle folder that holds a **rule variant**
  (`tests/puzzles/five-yavalath`) is skipped.
  1. **Facts** (slow, needs the bots): for every usable puzzle (`toMove === 0`, no
     `startPlayer`, a value that is not already lost) the proof `depth`, `legal` /
     `bestCount`, whether the game's own **greedy** move is optimal (one ply, the best
     `rules.estimate` after the move), whether the **Easy** and the **Normal** bot answer
     with an optimal move, the searched win chance (12 000 nodes) and the static `look`.
     Plus 3 **play-from-here** positions from seeded self-play at the Hard level (the first
     position in the 40–70 % window where **the state says seat 0 is to move** and your
     chance is 45–70 %). Written to `scripts/learn/facts/<game>.json` and committed.
  2. **Select** (pure, re-run by the unit test): `difficultyOf(f)` = 1 + proof depth
     (capped) + how thin the good moves are + 1 if the greedy move is wrong + 1.5 if Easy
     misses it + 1 if Normal misses it + 1 if you look behind, clamped to 1..10; a
     play-from-here row is scored by its tier. `kindOf(f)` = `turnaround` (a proven win
     where either view is ≤ 35 %), else `trap` (the greedy move or Easy's move is not
     optimal), else `best-move`. `select` cuts the sorted candidates into three bands the
     size of the tier quotas (6 / 8 / 8 rows, one of them the tier's play-from-here
     position), mixes the kinds inside each tier and writes titles and texts.
  Deterministic (a re-run never diffs; `--facts-only` / `--keep-facts` split the stages).
  Hand-written scenarios in `howto.scenarios` are concatenated in front and land in Basics;
  their `best` has to be right (the test only checks that it is legal).
- **Screens**: `#screen-learn` (one `.game-card` per game that teaches something, with "k /
  n scenarios") → `#screen-learn-game` (title, tagline, the rule bullets, "Start tutorial"
  (`#btn-learn-tutorial`, hint `#learn-tutorial-hint`), then the scenario rows **grouped by
  tier**: one `.learn-tier-box` card per tier with a `.learn-tier` header button (chevron,
  the tier name, "3 / 8", the tier's one-line text; `open` / `locked` classes,
  `aria-expanded`) and, while open, one `.learn-scenario` row per scenario with the kind's
  icon (check once solved), the title, the kind's label and the difficulty as five dots
  (`Learn.dots`); folded rows are `hidden`), Back). Desktop (`min-width: 900px`, landscape):
  a **two-column grid** 980 px wide, Rules and the Tutorial block left, the ladder right.
  The details page scrolls as a whole (the card centred with `margin: auto`). Progress lives
  in `localStorage["chainreact.learn"]` = `{ tutorials: { chain: true }, solved: { five:
  [ids] } }`, per device.
- **A lesson runs on the normal game screen** with `#learn-panel` as the first block of the
  HUD (`#learn-kind`, `#learn-step`, `#learn-text`, `#learn-hint`, `#learn-next` /
  `#learn-retry` / `#learn-back`). A **scenario** carries `#learn-hide` (`Learn.fold(on)` /
  `Learn.folded`, class `folded`, kept in `sessionStorage["chainreact.learnpanel"]`) that
  folds the explanation away; a **tutorial** measures the longest of its step texts
  (`sizeText`) and gives `#learn-text` that `min-height`, so a longer step never moves the
  board. There is **no new `Match.mode`**: a tutorial is a plain `local` table (every seat
  is this device, so premoves never appear) and a scenario a plain `bot` table;
  `Learn.active` is the flag the rest of the app checks. `body.learn` hides the HUD's
  Rematch / Back to room row, `body.learn-tutorial` also hides the win bars. A tutorial keeps
  the result overlay hidden; a scenario shows it with the lesson's buttons.
- **How Learn reaches the board**: two `Match.init` handlers, wired in app.js, keep the
  table generic — `beforeMove(i, p)` (false consumes the click: the tutorial's gate) and
  `cellClass(i)` (the `hint` class, the same door the premove marker uses). Advancing after
  a correct click listens to the Bus (`game:position`, then `Learn.STEP_MS` = 450 ms).
  Seat names come from `Learn.names(base)`: a tutorial renames seat 1 to "Opponent", a
  scenario changes nothing (Match already calls a bot seat "Bot").

## Chat (`client/chat.js`) and the logs (`client/lib/log.js`)

- `Log.line(id, text, cls, name?)` prepends one line (newest first in the DOM; the box
  is `column-reverse`, so the newest shows at the bottom), keeps `Log.MAX_LINES` = 40.
  `Log.add(text, cls)` → `#log` + Bus `log`; `Log.chat(name, text, cls)` → `#log` (bold
  `name: ` + text, class `chat p<k>` / `chat x`). `Log.clear()` (new game) removes
  everything but `.chat` lines, so the conversation survives a rematch. Text goes in via
  `textContent` only — never HTML.
- **Row**: `#chat-row` (`#chat-input` + `#chat-send`) under the HUD log, the only chat
  input. `Chat.enable(online)` toggles `body.online` and the inputs' `disabled`; the row
  only renders while online. Desktop: the HUD log scrolls (`max-height: 150px`), the row
  sits under it. Phones: the log shows its last two lines and the chat row is behind ☰
  (`#hut.show-controls`).
- **Rules**: `Chat.send(text)` trims and collapses whitespace, cuts to `Chat.MAX_LEN` =
  200, allows one line per `Chat.SEND_EVERY` = 300 ms, refuses when not online, shows
  my line at once in my colour, emits Bus `chat {text, from, mine: true}` and calls
  `onSend(text)` → `Room.say(text)`. `Chat.receive(msg)` applies the same limits, colours
  the line with `msg.from` (−1 / unknown → "Spectator", class `x`) and emits `chat {…,
  mine: false}` (the sound module pings for other people's lines only). Enter in either
  input sends. Nobody echoes a line back to its sender.

## Emoji reactions (`client/reactions.js`)

`#react-bar` top-right, starts collapsed behind the 😜 toggle; emojis 😂 🔥 💀 🤡 😱 👏 👍
😎 🫡 😄 🥰 😲 😔 👋 🚨 🤖 + "L"/"EZ"/"GG" chips (the bar's own box never catches taps —
`pointer-events: none` except the list and the toggle). **The bar is a column**: the toggle
on top (CSS `order: -1`) and the list right under it, right-aligned and 206px wide, so it
wraps at five emojis per row and never reaches across the ⚙ button; collapsed it is
invisible and takes no taps. `Reactions.place()` (called after every `fitBoard`) puts
`#react-layer` **right next to the board** when there is ≥ 66px of space (desktop), else in
the free strip above the full-width board or below it if that strip is bigger — never over
the board, never off-screen. Emojis drift right → left while falling the layer's height
(wobble, fade, max 14 on screen). **Speed follows the rate** (#17): `Reactions.durationFor(recent)`
with `recent` = reactions shown (own + received alike) in the last `RATE_WINDOW` 3 s: 0 →
`SLOW_MS` 4000, 1 → `MEDIUM_MS` 2800, ≥ 2 → `FAST_MS` 1900. Spam is allowed on purpose
(~8/s; the receiver accepts one per 100 ms and only values from its own button set). **Who
sent it (#33):** every float carries `--react-color`, the sender's seat colour (received:
what `Room` / `BotPersona` pass to `receive(e, color)`; own: the `color()` handler
`Reactions.init` gets — app.js gives `Match.playerColor` of my seat, white while spectating,
the player to move when everyone shares one device). `game.css` turns it into a light
`drop-shadow` next to the usual dark shadow, and a friend's reaction still gets the small dot
in their colour.

## Lessons learned

- **Mobile layout bugs are usually stacking/overlap**, not events: an invisible flex
  container (the collapsed reaction list) swallowed taps on the ⚙ button.
- **One module per screen.** app.js grew to 800 lines twice; both times the fix was to give
  each screen its own module with `init(handlers)` and one `render()`, and to leave app.js
  the flow. A screen module never switches screens itself: it asks through a handler.
