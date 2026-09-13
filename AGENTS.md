# ALZlper's Minigames — agent context

Read this before touching anything. It is the core: what the site is, the files and
who owns what, the rules that apply to every change and the API contracts. The detail
lives in topic files under `.claude/rules/`, which Claude Code loads by itself when the
files you work on match their `paths:` header; any other agent opens them by hand.
**Read the topic file before touching its area:**

| Topic file | Read it before touching | What is in it |
| --- | --- | --- |
| `.claude/rules/games.md` | `client/games.js`, `client/games/**`, `client/match.js`, a new game | the engine, the rules and view contracts, game records, the rules of all four games, board / HUD layout, Bus events, seats and premoves, **how to add a new game** |
| `.claude/rules/online.md` | `client/room.js`, `client/lib/net.js`, `client/session.js`, the online e2e suites | the room protocol, presence, seats, spectators, TURN, desync, every message, the PeerJS gotchas |
| `.claude/rules/bots.md` | `client/bots.js`, `client/bots/**`, `client/winchance.js`, `scripts/puzzles/**`, `scripts/benchmark.mjs`, `scripts/calibrate.mjs` | the bot framework, budgets, benchmark, calibration, puzzles, persona, the dev panel, the evaluator lessons |
| `.claude/rules/ui.md` | `client/app.js`, `client/lobby.js`, `client/review.js`, `client/replay-list.js`, `index.html`, `client/css/**`, settings, preferences, skins, sounds, Learn, replays, chat, reactions | the screens and the flow, every modal, the Learn section, replay files and analysis |
| `.claude/rules/testing.md` | `tests/**`, `.github/**`, `build.mjs`, `scripts/ci/**` | build and deploy, the unit and e2e suites file by file, the CI shards, the agent workflow |

Keep all of it accurate: when you change behaviour, protocol keys, files or events,
update the matching section in the matching file.

## What this is

A static site with nostalgic minigames: **Chain React** and **Five Wins** (gomoku without
gravity), which the owner played on a Minecraft server in 2015, **Isolation** (the
pen-and-paper Isola: step, then break a tile) and **Dots and Boxes** (the school-exercise-book
game), for two to four players (plus spectators) in one room. Hosted as plain files on
Scaleway Object Storage at `https://minigames.alzlper.com/` (GitHub
`alexander-zierhut/minigames`, git remote `github`; the old `origin` points at the
owner's Gitea). The code must never assume that URL; share links are built from
`location.href`.

No framework, no backend, no bundler at development time. Vanilla JS in classic scripts
(not ES modules), each file an IIFE that defines exactly one global. The source runs
unbundled straight from `index.html` + `client/`; `build.mjs` concatenates for deploy.

Local dev: `npm run dev` (= `php -S 127.0.0.1:8000 -t .`; port 8080 is taken on the
owner's machine) or any static file server from the repo root.

## Files and load order

`index.html` lists the stylesheets and scripts; **build.mjs, the unit-test loader and the
headless loader read that list**, so adding a file = adding one tag there.

Scripts, in order (each defines the global named in brackets):

| File | Global | Role |
| --- | --- | --- |
| `client/vendor/peerjs.min.js` | `Peer` | PeerJS 1.5.4, vendored (no CDN at runtime) |
| `client/lib/util.js` | `Util` | `$`, `sleep`, `clamp`, `restartClass`, fail-safe storage `load/save/remove`, `fromTemplate`, `toast` |
| `client/lib/i18n.js` | `I18n` | translations (#47): `t(key, params)`, plurals, message descriptors (`msg`), the static markup (`apply`), the browser's language (`detect`), the writing direction, the flags |
| `client/lang/<code>.js` | (registers) | one dictionary per language (`en` is the source of every key; `de`, `es`, `fr`, `ja`, `ar` carry the same set) |
| `client/lib/icons.js` | `Icons` | monochrome line icons in place of emoji: `[data-icon=name]` gets its SVG (an observer fills nodes added later), `Icons.set(el, name)`, `Icons.svg(name)`; reactions and the bot persona stay emoji |
| `client/lib/bus.js` | `Bus` | event bus `on/off/emit` (see Events in `.claude/rules/games.md`) |
| `client/lib/log.js` | `Log` | the HUD event log (`add`, `chat`, `clear`, 40 lines) |
| `client/lib/clock.js` | `Clock` | chess clock for N players |
| `client/lib/net.js` | `Net` | PeerJS room transport |
| `client/lib/preload.js` | `Preload` | first-visit texture preload with `#loader` bar |
| `client/lib/sound.js` | `Sound` | Bus events → sound cues; synthesized Classic set, Blocks files (see Sounds in `.claude/rules/ui.md`) |
| `client/lib/install.js` | `Install` | "Add to home screen" button (beforeinstallprompt) |
| `client/lib/replays.js` | `Replays` | replay files (format, version + migrations, validation), the IndexedDB store of the games this device played (#42) and the replay bar's Play / Pause pace (#43) |
| `client/lib/analysis.js` | `Analysis` | replay analysis (#43): win chance per move, the bot's best move, a score per seat, the cache in the `analysis` store, and the panel above the replay bar |
| `client/lib/update.js` | `Update` | polls `version.json` on the title screen, the "new version" notice and the idle reload (#40) |
| `client/games/rules.js` | `Rules` | the **pure game loop** (`create/step/eliminate/apply/replay`) shared by the engine, bots and scripts, the rules registry, and the building blocks a rules module uses (`base`, `pass`, `remaining`, `emptyCells`, `placeCell`, `decided`, `sigmoid`) |
| `client/games/hud.js` | `Hud` | the generic HUD renderer: sign, turn box, seat cards, info box, result overlay, from the model a view returns |
| `client/games/view.js` | `BoardView` | what every board view builds the same way: the cell elements with marker and click (`cells`), the HUD's `leading` flags |
| `client/games/engine.js` | `Engine` | the engine shell every game shares (`Engine.create(def)`): play, animate, replay, preview, hash, record |
| `client/games.js` | `Games` | the registry: `register(def)` validates a definition, fills the optional parts in and creates its engine; `get/has/keys`, the picker preview tile |
| `client/games/chain-rules.js` | `ChainRules` | Chain React rules, pure (no DOM) |
| `client/games/chain.js` | `ChainView`, `ChainGame` | Chain React board/animation/HUD model + registration (settings rows declared here) |
| `client/games/five-rules.js` | `FiveRules` | Five Wins rules, pure |
| `client/games/five.js` | `FiveView`, `FiveGame` | Five Wins view + registration (smallest game: the template) |
| `client/games/isolation-rules.js` | `IsolationRules` | Isolation rules, pure (a move is one encoded integer) |
| `client/games/isolation.js` | `IsolationView`, `IsolationGame` | Isolation view (the two-step click) + registration |
| `client/games/boxes-rules.js` | `BoxesRules` | Dots and Boxes rules, pure (lines as cells; the analysis helpers bots use) |
| `client/games/boxes.js` | `BoxesView`, `BoxesGame` | Dots and Boxes view (dots / lines / boxes, `renderBoard`) + registration |
| `client/bots.js` | `Bots` | bot registry, the toolset bots play with, headless playout, win-chance estimator |
| `client/winchance.js` | `WinChance` | win-chance bars: a Bus observer of `game:new` / `game:position` (no engine or game knows it) |
| `client/bots/<id>/bot.js` | (registers) | one folder per bot: `bot.js`, generated `benchmark.js`, `bot.test.mjs` |
| `client/skins.js` | `Skins` | look per device: body class only |
| `client/prefs.js` | `Prefs` | per-device preferences ("⚙ Settings & Feedback" top-left): the player's name (#35), look and language (#47), win-chance graph in replays (#43), sound volume / categories, hide the room code, keep my IP private, mute spectators, developer panel, feedback link |
| `client/settings.js` | `Settings` | settings form ↔ config; the game rows are **built from the game definitions**; picker cards, persistence, summary |
| `client/opponent.js` | `Opponent` | the bot modal: one bot per game, called "Bot" (`Opponent.NAME`), its scores and the difficulty; choice per game |
| `client/changelog.js` | `Changelog` | the title screen's changelog modal (`changelog.json`; technical entries behind a toggle) |
| `client/bot-persona.js` | `BotPersona` | a bot seat's sparse emoji reactions, drawn from seeded weighted pools |
| `client/reactions.js` | `Reactions` | emoji reactions bar + floating layer |
| `client/chat.js` | `Chat` | room chat: the input row under the HUD log, limits, lines into the log, Bus `chat` |
| `client/session.js` | `Session` | the room session in sessionStorage (survives a refresh) |
| `client/match.js` | `Match` | **the table**: mode, my seat, seats per player, the active engine, the clock, the bot seat, deferred work while a move animates |
| `client/learn.js` | `Learn` | the Learn section (#41): the two Learn screens, the guided tutorial, the scenarios, the progress, the lobby's "How to play" modal |
| `client/learn/<game>-scenarios.js` | (registers) | **generated** scenario ladder (`scripts/learn/pick-scenarios.mjs`, from the proven puzzle sets and seeded self-play) |
| `client/room.js` | `Room` | **the online room**: protocol handlers, presence, seat assignment, sync/desync, rematch votes, net box + banner, session save |
| `client/dev.js` | `Dev` | the developer info panel (#31): a snapshot of network, performance, bot and win chance, rendered by a pure `format` |
| `client/lobby.js` | `Lobby` | the lobby screen: `render()` paints head, seat cards, options and the Start button from Match / Room / Settings; the Invite modal and its copy confirmations |
| `client/review.js` | `Review` | the replay bar and the analysis panel after a game and in the replay viewer: `show(ply)` / `hide()`, Play / Pause, the room's `review` |
| `client/replay-list.js` | `ReplayList` | the replays screen: filters, pages, watch / save / delete, open a file |
| `client/app.js` | (none) | the screens and the flow (start / rematch / back / leave / watch a replay), wiring, boot |

Stylesheets, in order: `client/css/base.css` (tokens, player colour variables, buttons,
inputs, modal, toast, loader) → `client/css/menu.css` (title, lobby, picker, settings,
changelog, replays) → `client/css/game.css` (game layout, generic board, HUD incl. the generic
`.game-box`, overlay, banner, reactions) → `client/css/learn.css` (the Learn screens, the
lesson panel in the HUD, the `hint` cell) → `client/css/skin-mc.css` (Blocks board part
shared by both textured skins + Blocks UI part) → `client/games/chain.css` →
`client/games/five.css` → `client/games/isolation.css` → `client/games/boxes.css` (each
game's board, classic first, then its textured-skin rules).

Other: `client/textures/*.png` — 16×16 Mojang block textures from the owner's own
1.12.2 jar (personal use; the textured skins stay opt-in). Only textures referenced from
CSS are kept. `client/sounds/*.ogg` — Minecraft sounds from the owner's own installation
(`~/.minecraft/assets/indexes/*.json` maps `minecraft/sounds/<path>.ogg` to
`~/.minecraft/assets/objects/<hash[0:2]>/<hash>`; personal use), only the files
`Sound.FILES` references. `README.md` is the short public readme; `CLAUDE.md` just imports this file.
`server/` (a 2022 PHP stub) was deleted; don't bring it back.

### Who owns what (the layering, top to bottom)

```
app.js      screens + flow                   knows everything below; the only screen switcher
Lobby / Review / ReplayList   one screen each   know Match, Room, Settings, Opponent, Replays, Analysis, Learn
Room        online protocol, presence, sync   knows Match (engine, seats), Net, Settings, Clock, Chat
Learn       lessons: tutorial + scenarios     knows Match (start a table), Games (the howto data)
Match       table: seats, engine, clock, bot  knows Games (engines), Clock, Bots, Opponent, BotPersona
Games / Engine / Hud / BoardView  one engine per game   know Rules, Log, Bus, the game's view; never the app
rules.js    pure loop + building blocks       knows nothing (no DOM, no settings, no Bus)
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
the file into `#changelog-modal` from the title screen's `Changelog` button (fetched on
demand, first 7 days open, older days behind "Show older", so any length works). Internal-only
changes get `type: internal` or no entry. **Two audiences (#27):** the modal's "Show
technical changes too" toggle (`#changelog-tech`, off by default, remembered in
`localStorage["chainreact.changelog"]`) is the only way to see `internal` entries and
entries flagged `technical: true`; days left empty are skipped. **Flag generously** — the
owner wants the default list short: layout and spacing, naming, tooling, fixes of UI
glitches, and "meta" features (preferences, feedback link, the changelog itself) are all
technical. Unflagged = a rule or default that changes play, a new way to play (rooms,
spectators, chat, sounds, bots, home screen), or a fix that changes what happens in a game. No em dashes in texts (#24). `tests/unit/changelog.test.mjs` validates the
file (dates descending, known types, resolvable refs).

## Link previews and license

`index.html` carries a description meta and Open Graph / Twitter card tags; `og-image.png`
(1200×630, generated once with Pillow from `icon-512.png` plus the title text, copied by
the build via `ROOT_EXTRAS`) is the share image. The tags are the one place the site names
its own address (crawlers need absolute URLs; runtime share links still come from
`location.href`). Keep them free of em dashes and of the block game's name. `LICENSE` is a
custom source-available license: read, run locally, contribute, but no copies of the game
under another domain, name or platform, and the textures / sounds are not licensed at all.

## Folders that are never deployed

`docs/` (`docs/bots.md` = bot system reference and the list of current bots — keep it in
step with the code), `scripts/` (headless loader, puzzle runner, benchmark, puzzle solvers/generators,
`ci/shards.mjs` = the e2e shard split, `learn/pick-scenarios.mjs` + its committed
`learn/facts/<game>.json`,
verify, screenshot tour), `tests/` (incl. `tests/replays/`, the replay format samples). The deploy uploads `dist/`
only; `build.mjs` bundles nothing outside `index.html`'s tags and `client/textures`.

## API at a glance (what a change must keep working)

Every global is an IIFE in `client/`; these are the contracts other code relies on.

| Global | Public surface |
| --- | --- |
| `Util` | `$`, `sleep`, `clamp`, `restartClass`, `load/save/remove(storage, key[, value])`, `fromTemplate(id, k)`, `toast` |
| `I18n` | `init(pref) → code` (a code or `"auto"`), `add(code, dict)`, `t(key, params)`, `msg(descriptor | string)`, `apply(root)`, `detect(list)`, `has(code)`, `flag(code) → svg`, `LANGS [{code, name, dir}]`, `DEFAULT`; getters `lang`, `dir`, `locale`; `dict(code)`, `codes()` |
| `Bus` | `on(event, fn) → off`, `off`, `emit(event, data)` — events listed in "Events" in `.claude/rules/games.md` |
| `Log` | `add(msg, cls)` (a message descriptor `{ k, …params }` or a text; the line keeps the descriptor), `relabel()`, `chat(...)`, `clear()`; 40 lines, `#log` only |
| `Clock` | `setup(seconds, onFlag, players)`, `setActive`, `pause`, `resume`, `stop`, `snapshot`, `restore`, `isEnabled` |
| `Net` | `open(code, handlers, preferredRole)` (`"guest"` / `"spectator"`), `send`, `sendTo/sendExcept` (host), `setSeat(id, seat)`, `setMeta(id, patch)` (host), `hostSpectators(specCode)`, `leave`, `retryNow`, `randomCode`, `normalizeCode`, `PREFIX/SPEC_PREFIX`; getters `code, role, status, connected, peers, watching, iceInfo, transport, refused` (the broker keeps turning us away, a rate limit); handlers `onStatus, onRole, onOpen, onClose, onMessage, preferHost, metadata(), admit, relayOnly` |
| `Install` | `init()`, `offered` |
| `Update` | `init({url, current, onTitle, reload})`, `check()`, `isNewer(running, latest)`, `screenChanged()`, `stop()`; getters `available, latest, current`; writable `AUTO_MS`, `reload`; `EVERY_MS`, `TIMEOUT_MS` |
| `Rules` | `base(config)`, `pass(state, alive)`, `remaining`, `index`, `inside`, `emptyCells(state)`, `placeCell(state, i, p)`, `decided(state) → 1 / 0 / 0.5 / null`, `sigmoid(edge, k)`, `register(key, rules)`, `of(key)`, `keys()`, **`create(config[, rules])`, `step(rules, state, i) → result|null`, `eliminate(state, p, why)`, `apply(rules, state, history, outs) → applied`, `replay(record, ply) → state`** (`rules` = module or key) |
| rules module | `create, ownerOf, isLegal, legalMoves, place, conclude, estimate` (+ `settle` when a placement has consequences, + optional `cellOf(state, move)` / `canPlay(state, i, player)` for games whose move is not a plain cell id, + game helpers: chain `tally/readyCells/…`, five `lineThrough/bestRow/canWin`, isolation `steps/mobility/territory/encode/decode`, boxes `edgesOf/boxesOf/sides/captures/safeMoves/isFreeCapture/chainFrom`) — pure; a reason a game ends (`conclude`'s `why`, `eliminate`'s `why`) is a message descriptor `{ k: "why.…", …params }`, never a text |
| view module | `build, renderCell, hud, summary, animateMove` + optional `renderBoard(state)` (board parts that are not cells) |
| `BoardView` | `cells(board, count, onClick, decorate(el, i)) → elements` (marker and click included), `marker()`, `leading(values) → [bool per seat]` |
| `Games` | `register(def) → engine` (validates: key, title, tagline, desc, a 9-character preview, `size`, rules, view; fills `settings`, `players`, `premove`, `howto`, `describeRules`, `describeOptions`, `minSize`, `size.presets` in), `get/has/keys`, `title(key)` (translated), `previewClass(ch)`, `previewTile(key, {small})` (the one builder of the 3×3 picker tile), `positionAt(record, ply)` |
| engine | `state, config, previewPly, newGame, play, replay, preview, finish, eliminate, abandon, render, relabel` (the sign, the HUD and a shown result in the new language), `isLegal, cellOf, hash, record` |
| `Hud` | `build(players, title)`, `render(state, hooks, model)`, `overlay(name, winner, sub)` |
| `WinChance` | Bus-driven; `display`, `estimator`, `info`, `REFINE_MS`, `SMOOTH`, `DECIDED` |
| `Bots` | `register, get, list, forGame, botFor(game, config), supports(id, config), variantOf(id, config), create(id, {me, difficulty, seed, players, budget}), tools(game, opts), playout, rng, validate, benchmark/benchmarkOf(id, config), calibration/calibrationOf(id, config), estimator(game, config) → {bot, stages, at(state, nodes), quick}, toProbability(raw, cal), ESTIMATE_STAGES` |
| bot definition | `id, name, game, version, description, difficulties [{id, label, nodes}], create(tools) → {move(state)}, evaluate?(state, tools) → raw, supports?(config) → bool, variant?(config) → key, baseline?` |
| `BotPersona` | `attach({bot, seat, game, state, estimate, color, post?, delays?, cooldownMs?})`, `detach()`, `POOLS` |
| `Skins` | `init({onChange})`, `set(key)`, `current` |
| `Settings` | `init({onChange, onSelectGame})`, `read()`, `write(cfg)`, `selectGame(key, announce, resetSize?)`, `summary(cfg)`, `setMode(mode)`, `setPlayers(n)`, `setMinPlayers(n)`, `setBot(choice, announce?)`, `setLocked(on)`, `supports(key)`, `relabel()` (the cards, labels and options in the new language), `MIN_PLAYERS_HINT`, `BOT_SEAT`, `game`, `players`, `minPlayers`, `bot`, `locked`, `fields` |
| `Prefs` | `init({onChange, context})`, `get() → {name, defaultName, language, volume, soundSet, sounds, winGraph, hideCode, hideCodeAsked, privateIp, muteSpectators, developer}`, `set(patch)`, `open/close`, `feedbackUrl()`, `cleanName(s)`, `fitName(s, measure)`, `seatNames(count)`, `showSection(key)`, `sectionSummary(key)`, `CATEGORIES`, `SECTIONS`, `DEFAULT_NAMES`, `NAME_MAX`, `isOpen`, `section` (a language change in `set` calls `I18n.init` at once) |
| `Opponent` | `init({onDone(game, played)})`, `open(game, config, choice?)`, `current(game, config) → {id, difficulty, def}`, `summary(game, config, choice?)`, `relabel()`, `NAME` (getter, "Bot" in the chosen language) |
| `Reactions` | `init({onSend, color})`, `receive(emoji, color)`, `place()`, `durationFor(recent)` |
| `Chat` | `init(...)`, `send`, `receive(msg)`, `enable(on)` (see chat section) |
| `Sound` | `Bus`-driven; `play(cue)` for tests, unlock on first gesture |
| `Changelog` | `init()`, `open/close`, `render(doc[, all])`, `refUrl(ref)`, `technical(entry)`, `showTechnical`, `SHOW_DAYS` |
| `Preload` | `textures()` |
| `Learn` | `init({show, exit})`, `open()`, `openGame(key)`, `startTutorial(key)`, `startScenario(key, id)`, `restart()`, `exit()`, `howto(key) → {rules, tutorial, scenarios}`, `scenarios(game, list)` (the generated files register here), `games()`, `configFor(key, cfg)`, `names(base)`, `beforeMove(i)` / `cellClass(i)` / `onLocalMove(i)` (Match handlers), `openHowto(key)` / `closeHowto()`, `relabel()`, `isSolved(game, id)`, `markSolved(game, id)`, `tutorialDone(game)`, `fold(on)` (#43), `tierProgress(game, tier)`, `tierLocked(game, tier)`, `tierOpen(game, tier)` / `toggleTier(game, tier)` (the folded tier cards), `nextScenario(game, id)`, `canAdvance()`, `again()`, `againText()`, `dots(difficulty)`; getters `active` (`null` \| `{kind, game, …}`), `page`, `folded`; `STEP_MS`, `MISS`, `TIERS`, `KINDS`, `UNLOCK` |
| game definition | `key, title, tagline, desc` (keys of the language files), `preview` (9 chars, see `Games.previewClass`), `size: {min, max, default, presets?}`, `players?`, `premove?`, `minSize?(cfg)`, `settings?: [{key, label (a key, or a function of the config returning a text), type: "select" | "bool" | "preset", def, min?, max?, options? [[value, key]], presets?, off? (true), startOff?, unit? (a plural key), customLabel? (a key), flag?}]`, `describeRules?(cfg)`, `describeOptions?(cfg)` (return texts), `howto?` (keys), `rules`, `view` |
| game definition (Learn) | `howto: { rules: [], tutorial: [{text, config?, moves?, expect?, highlight?}], scenarios: [{id, title, text, config, history, toMove, best, tags?, tier, kind, difficulty, level, goal?}] }` (#41, #44) |
| `Session` | `save(data)`, `load()`, `clear()` (shape incl. `codeHidden`, `watch`, `spec`) |
| `Replays` | `FORMAT`, `VERSION`, `MIGRATIONS`, `EXT`, `migrate(doc)`, `validate(doc) → {ok, error}`, `parse(text) → {ok, doc, error}`, `fromRecord(record, names, mode, {finished, bot})`, `trimConfig(config, game)`, `idFor`, `fileName`, `when(iso)`, `dayOf(iso)`, `summary(doc, id)`, `filter(items, {game, kind, search, from, to})`, `store.{save, list({game}), get, remove, clear, persistent, analysis.{get, put, remove, clear}}` (async, IndexedDB with a memory fallback), `playback({ply, total, seek, ms, setTimer, clearTimer}) → {start, stop, toggle, playing}`, `STEP_MS` |
| `Analysis` | `init({onSeek, onPlayFrom})`, `open(doc, {canPlayFrom})`, `at(ply) → cell to mark`, `close()`, `run()`, `render()`, `analyse(doc, {estimator, bot, nodes, onProgress, cancelled, breathe, maxMs}) → result`, `scores(moves, players)`, `verdict(move)`, `positionsOf(record)`, `stampFor(doc)`, `load(id, stamp)`, `store(id, result)`, `NODES/BOT_NODES/TOLERANCE/MISTAKE/BLUNDER/MAX_PLIES`; getters `result`, `busy`, `progress`, `shown` |
| `Match` | `init(handlers)`, `start(cfg, gameNo)`, `watch(record)`, `stop()`, `reset(mode, me, spectator)`, `setSeat(me, spectator)`, `refreshSeats()`, `record()`, `flagged(p)`, `whenIdle(fn, key)`, `syncClock()`, `startPlayerFor`, `playerColor`, `mark(i)`, `isLocal/isBot`; getters `engine, state, names, running, mode, me, spectator, seats, config, gameNo, bot, botInfo, premove, marked`; `THINK_MS` |
| `Dev` | `init()`, `enable(on)`, `snapshot()`, `format(snapshot)` (pure), `refresh()`; getter `enabled`; `EVERY_MS` |
| `Room` | `init(handlers)`, `enter(code, { preferHost, seat, spectate, watch, spec, hidden })`, `leave()`, `roomLink(code?)`, `spectateLink()`, `hideCode(on)`, `codeText()`, `newGame()`, `bump()`, `save()`, `render()`, `startFromLobby(cfg, prefix?)`, `requestRematch()`, `rematchWaitText()`, `sendMove(i)`, `sendSync()`, `reseat()`, `seatFree()`, `watchInstead()`, `takeSeat(seat?)`, `enteredLobby()`, `botSeat()`, `settingsChanged(cfg)`, `hides(msg)` (a spectator's chat / reaction under the mute preference), `say(text)`, `react(e, seat?)`, `tolobby()`, `review(ply, play?)`, `onIdle/onChanged/onFlag` (Match handlers), `presentSeats/missingSeats/occupiedSeats/allHere/live/netTrouble(status) → null | {text, short}/who/two/playersNow/turnHint`, `names()`, `nameChanged()`, `accepts(msg, seat)`, `keepsSeats(msg, occupied)`, `PLAYERS_ONLY`; getters `rev` (settable), `spectators`, `votes`, `votedMyself`, `online`, `isHost`, `codeHidden`, `watching`, `spec` |
| `Lobby` | `init({names})`, `render()`, `closeInvite()`, `DONE_MS` |
| `Review` | `init({doc, onPlayFrom})`, `show(ply, announce, auto)`, `hide()`, `render()`, `follow(ply, play)` (the room's `review`), `total()`, `current()` |
| `ReplayList` | `init({show, watch})`, `open()`, `render()`, `relabel()`, `download(doc)`, `PAGE` |

Node-side (`scripts/`): `loadHeadless()` (util + rules + bots in a VM; every registered
rules module is handed out under its own global name), `puzzles/runner.mjs`
(`puzzleSets`, `loadPuzzles`, `setConfig`, `positionOf`, `evaluateBot`), `learn/pick-scenarios.mjs`
(`collectFacts(H, game)`, `loadFacts(game)`, `select(facts)`, `difficultyOf`, `kindOf`,
`greedyMove`, `TIERS`, `KINDS`, `writeAll({factsOnly, keepFacts})`), `benchmark.mjs`, `calibrate.mjs`
(`collect`, `fitLogistic`, `metrics`, `calibrate`), `puzzles/<game>/solver.mjs` +
`generate.mjs` (boxes: `solveExhaustive` / `solveBrute` / `canonical`, and its README has the
guarantee), `puzzles/verify.mjs` (generic tactical re-proof plus a per-game branch, boxes'
structural tags), `screenshots.mjs`, `ci/shards.mjs` (`listFiles`,
`sizeOf`, `shards(files, count)`, `shardOf(n, count)`, `estimate`, `SIZES`).

Protocol messages (host relays everything to the other guests): `hello, state, welcome/full
(transport), lobby, start, start-request, tolobby, sync, move, timeout, rematch, review,
seat, react, chat, roster, name, leave, ping/pong` — fields in "Online play" in `.claude/rules/online.md`; `seat`, `name`
and `roster` are the ones that never get relayed (host to all, or guest to host only).

## Lessons that apply everywhere

- **Refactor lessons (2026-09-10, the big one).** The e2e suite made a full restructure safe:
  850-line app.js → Match (table) + Room (protocol) + a small app.js, the chain-only
  HUD box and settings rows out of index.html into the game definitions, win chance out of
  the engine into a Bus observer, one pure `Rules.step` for every path that resolves a
  move. What to keep doing: replace *state scattered across a big object* with modules that
  own their state and expose getters; let observers subscribe to `game:position` instead of
  threading calls through the engine; describe game-specific UI as data (HUD model,
  settings list) and render it generically; when a queue of "do this once idle" appears
  (pendingSync, pendingOuts, incoming), one `whenIdle(fn, key)` replaces them. Test ids that
  encode game words (`p0-cells`) become generic (`p0-stat-0`) — update tests, don't keep
  legacy ids alive in the framework.
- **Refactor lessons (2026-09-13, the quality pass).** With the suites green a second
  restructure cost nothing: app.js split again into one module per screen (`Lobby`,
  `Review`, `ReplayList`) with the flow left in app.js; `games.js` split into the
  registry, the engine and the HUD; what every game repeated (cell building, the `leading`
  flags, empty-cell moves, the plain placement, the `estimate` prologue) moved into
  `BoardView` and `Rules`; `Games.register` validates and fills defaults so nothing above
  the definition has to check for an optional part; the headless loader hands rules
  modules out by name from the registry instead of a hard-coded list. Rule of thumb: a
  helper belongs in the framework once the second game writes it, and a module is too big
  once its header comment needs a list.

## Owner preferences

- Writes English and German; either is fine in replies.
- Wants things to look nice; approved: classic skin, HUD contrast, explosion, compact
  mobile HUD, unified dark MC UI, settings modal, room flow.
  Layout need not be pixel-perfect, behaviour and texts must not change unasked. No em
  dashes in any user-facing text (#24): rewrite the sentence instead.
- **The UI rules of the 2026-09-11 rebuild** (they hold for anything new; the details are in
  `.claude/rules/ui.md`):
  - **No emoji as an icon.** Every icon is a line icon from `client/lib/icons.js`
    (`[data-icon]`); emoji are content (the reactions bar, the bot persona).
  - **Every action carries a word.** No unlabelled icon button: a row says what it does and
    explains itself in a line under the label where it helps.
  - **Say it where it happened.** A copy or a switch confirms on the thing that was clicked
    (a check, a green edge, a green code), never in a toast at the other end of the screen.
  - **Every control in the settings is a dropdown**: a few values that work well, "Off"
    where it applies, and "Custom…", which reveals a number row.
  - **A card never scrolls inside itself.** When it is taller than the screen the page
    scrolls (`safe center` + `overflow-y: auto` on the screen and on `.modal`). Phones may
    scroll a room lobby; the local lobby still fits 360×780 and the game screen never scrolls.
  - **Nothing above the game definition knows a game by name.** A picker for eight games is
    planned in `.claude/rules/games.md` ("Beyond six games").
  - **Every text is a key (#47).** No user-facing string literal in the client: texts live
    in `client/lang/en.js` and the other language files, the markup carries `data-i18n`,
    a game's rules answer with descriptors. `tests/unit/i18n.test.mjs` enforces all of it
    on every deploy, and `tests/e2e/i18n.test.mjs` proves that no label wraps or overflows
    in any language on a phone and a desktop. A translation that is too long fails there.
- Prefers several small JS files over one big one; no framework.
- Friends only (up to four in a room, plus spectators) — no matchmaking, no accounts, no
  own server.
