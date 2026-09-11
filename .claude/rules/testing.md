---
paths:
  - "tests/**"
  - "build.mjs"
  - "package.json"
  - ".github/**"
  - "scripts/ci/**"
  - "scripts/screenshots.mjs"
---

# Build, deploy, tests, CI and the agent workflow

The build and the deploy workflow, the unit and e2e suites file by file, how CI shards them, and what parallel agents taught. The core context is `AGENTS.md`.

## Build & deploy

- `npm run build` (= `node build.mjs`) writes `dist/`: `index.html` + `assets/app.<hash>.js`
  (all client scripts in `index.html` order, esbuild-minified when available) +
  `assets/main.<hash>.css` (all stylesheets concatenated, `../textures/x.png` rewritten
  to hashed names) + `assets/textures/<name>.<hash>.png` + `assets/sounds/<name>.<hash>.ogg`
  (every `client/sounds/<file>` string in the JS bundle is rewritten to the hashed path —
  that is how `Sound.FILES` finds them) + the icon files + **`version.json`** (#40:
  `{ version, commit, builtAt }`, `version` = the very stamp that goes into
  `<meta name="version">`, `commit` = the full sha; `dev` unbundled). Hashes are content
  hashes → cache busting by filename. Env: `DIST_DIR`, `SKIP_MINIFY=1`.
- `.github/workflows/ci.yml` runs on push to `main`, on PRs and manually, **in parallel
  jobs**: `unit` (npm ci → `npm run test:unit`, the build test included) and `e2e`,
  a matrix of `SHARDS` = 4 shard jobs. Every shard checks out, `npm ci` (with the
  setup-node npm cache) and runs its own list of e2e files
  (`node scripts/ci/shards.mjs <shard> <SHARDS>`, see Tests) with
  `node --test --test-concurrency=1 --test-timeout=300000`, so a shard still runs one
  Chrome-heavy file at a time; `fail-fast: false` keeps a flaky online shard from
  cancelling the others, and each shard uploads its `E2E_SHOTS` folder as
  `e2e-screenshots-<n>` on failure. A tiny gate job **literally named `test`**
  (`needs: [unit, e2e]`, `if: always()`) fails unless both results are `success`: that is
  the check branch protection requires, so the jobs above can be renamed or resharded
  without touching the repository settings. Wall clock: about 2 minutes instead of 7 to 10.
  Job `deploy` (`needs: [unit, e2e]`, pushes to `main` only): build, `aws s3 sync`
  assets with `Cache-Control: public, max-age=31536000, immutable`, root files with
  1-day cache, `index.html` **and `version.json`** with `no-cache` (both uploaded one by
  one), then `--delete` sync of stale files that excludes `version.json` so its
  no-cache header cannot be overwritten.
  Bucket `minigames.alzlper.com`, region `nl-ams`, endpoint `https://s3.nl-ams.scw.cloud`.
  Credentials: repo secrets `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` = non-expiring API key of
  IAM application `minigames-website` (id `300c3839-68e5-4fc9-9a66-9321af7ffe1e`, policy
  `minigames-website-policy` = ObjectStorageFullAccess on project `zierhut-p`
  829778ff…), same pattern as the owner's other sites. Bucket policy: owner user full
  access, that application full access, `*` GetObject. Website mode (index + error
  document `index.html`); DNS CNAME to `minigames.alzlper.com.s3-website.nl-ams.scw.cloud`.
- Branch protection on `main` requires the `test` check for PRs (admins not enforced,
  so the owner can push directly) — that is the gate job above, never a real test job.

## Tests (`npm test` = unit + e2e; CI runs both before every deploy and on every PR)

### Unit (`npm run test:unit`)

`node --test` over `tests/unit/**/*.test.mjs` + `client/bots/**/*.test.mjs`. Two loaders do
the heavy lifting: `tests/unit/dom.mjs` puts `index.html` and every client script except
`app.js` into jsdom (the script list is parsed from index.html, `Element.animate` is
polyfilled) and hands out fake hooks, and `scripts/headless.mjs` loads util, rules and the
bots into a bare `vm` with no DOM at all. Cross-realm arrays: compare via `JSON.stringify`,
not `deepStrictEqual`, and get globals with `w.eval("Name")`. A file that starts a timer
(`clock`, `update`) must stop it and call `w.close()`, or the runner never exits.

| File | What it covers |
| --- | --- |
| `rules.test.mjs` | the pure rules in a bare `vm`: `Rules.base` + `pass` rotation and rounds for 2 and 3 players; chain (legalMoves / place / settle / conclude, a player who lost every cell skipped, the chain rule); five (`lineThrough`, `bestRow`, win, full board and the dead board of #18); boxes (line numbering round trip, a closed box keeps the turn, one line closing two, the end and the tie, safe / capturing lines and `chainFrom`, three players, replay == play) |
| `framework.test.mjs` | `Rules.step/apply/replay` == engine play at any ply (`Games.positionAt`), the generic HUD built from the view's model, the settings rows generated from the definitions, Match seats per mode / a bot seat that moves by itself / `whenIdle` / `record()`, the room's bot in the config and its seat kinds per device (#36), the seat names of #35 through `Match.init({ names })` and `Room.names()`, the picker's player counts (#28), a spectator's locked settings and `Room.accepts` (#29), `Session` |
| `chain.test.mjs` | caps, waves, the board-decided stop, the win, the chain rule, replay == play, the hooks' order, the HUD and the last-move marker, the win chance |
| `five.test.mjs` | the registry (5–25, default 11 × 11 since #16, the win length is the minimum), lines in all 4 directions, `winLen` 6, longer than `winLen`, the full-board draw and the dead board (#18), replay == play, the HUD, the win chance, and the Yavalath rule with two and with three players plus Sensei's own benchmark numbers and calibration for it |
| `isolation.test.mjs` | first the pure rules in a bare `vm` (start positions, the encoded move, what is legal, the trap with 2 and 3 players, `estimate`), then the engine and the view: the registry (5–12, default 7, `premove: false`), the two-step click and taking it back, `can-place` on the tiles the pawn may step onto, the last marker on the tile stepped onto, the HUD rows, replay == play and the hash, the overlay, the win-chance rows, the picker card |
| `boxes.test.mjs` | the registry and its own size label, the dots / lines / boxes the view builds in line order, a closed box that keeps the turn box on the same player, two boxes with one line, the end and the tie, replay == play, the replay-bar preview, the HUD model and the game box, three on one device, the win chance (a solved endgame may say 100 %), `boxes:capture` and the `game:turn` that does not fire |
| `party.test.mjs` | 3–4 players: `out` / `remaining` / pass in the pure rules, engine `eliminate` + `replay(history, outs)` == live play, the two-player flag fall and one that arrives late via `replay([], outs)`, the settings players row and bot mode, the min-players floor and `Room.keepsSeats` (#34), the seat request a spectator may send while everything else stays vetoed (#39) |
| `replay.test.mjs` | (#38) the engine's view-only preview: the position after n plies, the HUD and board classes, locked cells, no Bus events, the live state / record / hash untouched, `preview(null)`, and a new game dropping it |
| `replays.test.mjs` | (#42) every sample in `tests/replays/` migrates, validates and plays to its recorded result; a sample and a migration exist for every version that ever was; the `bad-*` files stay refused with a reason; `fromRecord` round trips a finished and an unfinished game; file name (`.minigames.replay`), date and summary with its `bot` flag; the pure list filter by game, bot or not, name and local day range; the store (newest first, per game, one entry per game, in memory under jsdom); `Match.watch` |
| `analysis.test.mjs` | (#43) `analyse` with a fake estimator and a fake bot: the per-ply arrays, the tolerance that makes an equally good move perfect, the blunder, the score formula on hand-made rows, the progress calls, cancelling, three players (best moves but no win chance), an illegal bot answer left out, a game where one seat moves twice in a row; the analysis cache and its invalidation by bot / version / budget; `Replays.playback` with fake timers |
| `premove.test.mjs` | (#37) set / switch / take back, played through the normal path when the turn comes, dropped once it went illegal, never on one device or as a spectator, cleared by a new game / stop / the end, and the one clicked while the bot thinks |
| `learn.test.mjs` | (#41, #44) the `howto` contract for every registered game (rule bullets, tutorial steps that replay with legal expected clicks, scenarios that replay to `toMove` with legal `best`), the generated scenarios equal the puzzle set's proven `best` and the committed files equal a fresh `select()` on the committed facts, the ladder (known tiers and kinds, difficulty 1..10, easy first inside a tier) and `difficultyOf` / `kindOf` on hand-made facts; then the runners in jsdom: the tutorial's wrong click and Next, a scenario's Retry, a play-from-here scenario judged by `game:finish` with "Next scenario", the tier lock, the folded explanation and the localStorage progress |
| `winchance.test.mjs` | frozen while a move animates, then refined stage by stage; the smoothing; the estimator's choice (a bot with `evaluate` wins over the rules' `estimate`, calibration applied); Käsekästchen reading the same number at every stage |
| `bots.test.mjs` | the bot framework and the conformance suite every registered bot and difficulty must pass (see `bots.md`) |
| `calibrate.test.mjs` | `fitLogistic` recovers scale and shift from synthetic outcomes; `toProbability` keeps infinities exact, applies the calibration and clamps |
| `puzzles.test.mjs` | every folder under `tests/puzzles/`, rule variants included: at least 100 replayable puzzles with unique ids, legal best moves and some tag variety, plus every bot that supports that set's config graded on it (printed, never a threshold) |
| `persona.test.mjs` | the wave, GG and detach; praise for a strong human move, EZ and the sad face at the extremes, a teasing face for a blunder, never for its own moves; the cooldown, the per-game cap and the same reactions for the same seed |
| `prefs.test.mjs` | defaults, clamping, persistence and form wiring; the feedback URL without the room code; the sections of #32 (`showSection` / `section` / `sectionSummary` and the menu rows); the name of #35 (drawn from `DEFAULT_NAMES` and persisted at once, `cleanName`, the empty fallback, `seatNames`, the field and the Profile row) |
| `sound.test.mjs` | event to cue mapping with a fake player, the perspective (`Sound.me`), the prefs gate and the log, the sound sets and their files, and that the real player never throws without an `AudioContext` |
| `chat.test.mjs` | the log boxes, the limits, HTML never interpreted, offline nothing is sent, and chat surviving a new game |
| `reactions.test.mjs` | `durationFor` from the recent rate with a mocked clock, own and received counted together, the rate limits, and the sender's colour on every float (#33) |
| `clock.test.mjs` | a disabled clock, only the active one running, pause, the flag at zero, restore and the rendered text |
| `net.test.mjs` | room codes and their normalisation, the `refused` flag that tells a rate-limiting broker from a hiccup, the spectator peer id of #29 (a code of its own that no room code can produce, and no message carrying the room code), and the relay-only peer config of #30 |
| `dev.test.mjs` | (#31) `Dev.format` on a hand-made snapshot (network with a route per connection, performance, bot, win chance, and the offline and empty states), `enable()` through the preference, and the bot report and estimator stage that feed it |
| `update.test.mjs` | (#40) `isNewer`, a fake fetch, the notice on the title screen only, the flag surviving until it shows, the idle reload happening once with an injected `reload`, and silence on every failure |
| `icons.test.mjs` | every `data-icon` in the page names a known line icon and holds its SVG, no emoji left where an icon belongs, `Icons.set` swaps in place, the observer fills nodes added later |
| `changelog.test.mjs` | `changelog.json` itself (days newest first, valid dates, known types, resolvable refs) and the modal (days as sections, links in a new tab, "Show older", and the technical toggle of #27) |
| `build.test.mjs` | `SKIP_MINIFY=1 DIST_DIR=<tmp>`: hashed names, icons, a deterministic rebuild and `version.json` matching the meta stamp |
| `ci.test.mjs` | the e2e shard split: every file in exactly one shard for 1 to 6 shards, shards balanced within a factor of 1.5, an unmeasured file placed, the size table only naming files that exist, and `ci.yml`'s matrix and gate job matching the script |
| `client/bots/<id>/bot.test.mjs` | one per bot, the facts that make that bot that bot (see `bots.md`) |

`tests/puzzles/<game>/solver.test.mjs` (one per puzzle folder: the solver on hand-made
positions, an independent oracle where one is affordable, and the set's consistency by
re-solving every puzzle) is **not** in that glob and runs by hand:
`node --test tests/puzzles/<game>/solver.test.mjs`. It is slow (tens of seconds per folder)
and only matters when a solver or a rule changed.

### E2E (`npm run test:e2e`)

`tests/e2e/harness.mjs` starts a static server (port 0) and headless Chrome over CDP (no
Playwright; Node 22 `WebSocket` / `fetch`; Chrome from `$CHROME` or `google-chrome`).
Helpers: `goto` (waits for the scripts and the preloader), `ev`, `click/set/check/text`,
`move(i)` / `idle()` / `state()` / `randomGame()` (game-agnostic: they drive `Match.engine`,
click `#board > .cell, .stone, .edge` by cell index and take the legal moves from
`Rules.of(<the body's game- class>)`, so a new game needs no harness change), `noScroll()`,
`emulate(w, h)`, `upload(sel, path)` (CDP `DOM.setFileInputFiles`), `screenshot(name)` (into
`tests/e2e/shots/`, never committed, uploaded as an artifact when CI fails) and `waitFor`.
`B.blank()` navigates to about:blank (a closed tab). Outline colours transition for .25 s, so
wait before reading computed styles. Files run 2 at a time locally, each with its own Chrome;
`SKIP_ONLINE=1` skips the suites that need the broker.

| Spec | What it drives |
| --- | --- |
| `local-flow` | the title screen's sections and join panel, a local lobby, Chain React to the end, the overlay, "Look at board" with the replay bar (first / prev / next / last, the `#replay-pos` label, the last-move marker, a click in a preview playing nothing, "Show result" and a rematch closing it), a rematch that alternates the starter, back to room, Five Wins with 6 in a row and its jumping line, "Change game", leaving, the install button and the changelog modal |
| `settings` | the board size clamped per game, five's minimum following the win length, the Yavalath rule played out in a local game, the custom timer row and the chain rule, everything surviving a reload, and a timer that only runs for the player to move and pauses during animations |
| `prefs` | the button on title, lobby and game; the Content Creator button turning both of its options on and off with the row's summary following; the look applied and mirrored; volume, sound set and categories persisted and never in the room settings; sounds locked until a gesture, then logged in order (the Blocks files fetched, mute silencing); the feedback issue; the section menu of #32 (desktop two panes, phone menu to section to Back with nothing scrolling); the profile name of #35 drawn, kept across a reload and shown on the board; and the phone layout staying clear of the cards, the board and the reaction toggle (#7, #13) |
| `skins` | the computed styles per look (Classic dots and turn outline, Blocks board textures with a classic UI, the full Blocks restyle, quartz and the red last marker in Five Wins with no hover flicker) and that switching the look leaves the names alone (#35) |
| `mobile` | 360 × 780: the title screen and join panel, the local lobby and the settings modal, an online-shaped lobby with four seats in every look (one Invite button beside the code and the four labelled share rows stacked in its modal, the seat controls inside their seat cards and the spectator count in the Players heading, the two groups holding the right controls, seat names never cut off, the screen scrolling to Start while nothing scrolls inside the card, screenshots `mobile-lobby-<skin>.png`), the game with its compact HUD and visible board outline, the stacked result overlay, the replay bar above the HUD (#38) and the Isolation board with a step picked |
| `party` | offline with more than two: four on one device (settings row, summary, four HUD cards, rotation, no win chance), three in Chain React with elimination by the rules and the Blocks textures of seats 2 and 3, and bot mode forcing two players |
| `isolation` | the lobby listing Isolation and starting its default 7 × 7, the two-step click including taking it back, a whole seeded game to a trap with the overlay and the replay bar, three on one device with a trapped seat, and the bot moving by itself |
| `boxes` | the Käsekästchen card, its "Boxes per side" row and summary, the board of dots / lines / boxes, a closed box that keeps you on turn, a whole seeded game to the last line with the overlay texts, the replay bar, a rematch, three on one device, 360 × 780 without scrolling, and the bot drawing lines and closing boxes |
| `bot` | the one-step opponent modal with its scores and difficulty (Cancel keeps the choice, Play changes it), a game won against Easy with "Bot" in the HUD, a rematch that alternates the starter, the premove clicked while the bot thinks (#37), and both games ending up in the replays list |
| `learn` | (#41, #44) Learn from the title screen, the game list, a details page with its tier cards (folded before the tutorial, a header opening and closing one, no lock note), progress, the tutorial's highlighted cell / wrong click / right click / Next to the end for Chain React and for Käsekästchen (whose lesson also proves that a closed box leaves you on turn), a scenario with a wrong move, Retry and a check mark that survives a reload, a trap scenario where the greedy move is refused, a play-from-here scenario judged on the result with Retry resp. "Next scenario", an Isolation step where the first click only picks the tile, the lobby's How to play modal closing when a game starts, and 360 × 780 with no scroll |
| `replays` | (#42) a finished local game saved and surviving a reload in real IndexedDB, the list, watching one from move 0 to the end, saving one as a file and validating that file, opening `tests/replays/v1-chain.json` through the file input, the game filter, the bot / no-bot filter and the name search, pages of ten with the count of found replays and the date range, a refused file, deleting, and a 360 × 780 page that scrolls through the list with nothing scrolling inside the card; (#43) the analysis panel running by itself and judging every move (the verdict, the win-chance line, the per-seat scores, a click on the graph, Play to the end), the `.best-move` marker including an Isolation replay where it has to land on the tile a move steps onto, the panel collapsed on a phone (screenshots `mobile-replay-analysis*.png`) and "Play from here" opening a room against the bot from the shown position with a second browser watching it |
| `online` | two browsers through the real PeerJS broker: create and join by link, both names on the seat cards and the HUD and a rename that reaches the other side (#35), the settings mirrored both ways, a guest start, move sync and a wrong-turn move ignored, reactions and chat both ways (colour, text only, into the game log), a guest refresh, a guest premove played the moment the host has moved (#37), a timed game whose board is covered and whose clock stands still while the friend is gone, back to room and a game switch, the rematch handshake, a host refresh, the replay of a finished game stepped from both sides and played through with the synced Play / Pause (#38, #43), a guest leaving and coming back, a host leaving and returning as guest after the takeover, the hidden room code (#19) and the relay-only room of #30 |
| `online-edge` | a third person finding every seat taken and becoming a spectator while the players stay connected, a duplicate dial from the same peer replacing the old connection, both refreshing in the lobby, a guest closing its tab mid-game and returning by link, a rematch asked while the friend was away, the host's tab dying and nobody being pulled back into the stale game, a drifted board rebuilt from the host, a board that keeps differing sending both back to the room, and two people typing the same new code at once |
| `online-party` | **three browsers**: the host sets players 3, two guests take seats 1 and 2, Start waits for everyone, moves by every seat reach everyone, chat and reactions carry the sender's colour, a guest refresh restores seat and board, a rematch needs every seat, one Back to room moves all three, and the player count cannot drop below the people in the room, forged `lobby` included (#34) |
| `online-spectate` | **three browsers** (#29): a third watches a running game through the `?watch=` spectate link (locked board, every move arriving, the room code nowhere), its lobby offers only the spectate link and its chat says "Spectator", a refresh keeps it watching, a rematch takes it along, it never gets a seat (not with one free, not by forging a `hello`), it finds the room again after the host hands hosting over, and leaving drops the count and clears the link from the URL |
| `online-seats` | **three browsers** (#39): a third joins a full two-seat room and watches, the host steps back with "Watch instead", the spectator takes the free seat and plays the game against the guest, back in the lobby the roles swap again, and a refresh keeps every role |
| `online-bot` | **three browsers** (#36): alone in a two-seat room, "Against a bot instead" puts a bot on the empty seat, it plays and a spectate-link viewer sees its moves and reactions, a friend joining mid-game watches and gets the seat when the bot steps aside in the lobby, and the bot comes back when the friend leaves and keeps playing across a refresh of the host |
| `dist` | the built bundle: only hashed assets, the preloader, a playable game, the hashed sound files fetched after the audio unlock, and the built page polling its own `version.json` and staying quiet on the same build |
| `update` | (#40) the unbundled dev page never asking for `version.json`, a newer version showing the notice on the title screen and hiding it in the lobby, an idle title screen reloading itself once with `Update.reload` counted instead, and the notice still fitting 360 × 780 |

Any new join or rejoin behaviour gets a scenario in `online-edge`: the owner wants joining to
feel rock solid.

### How CI runs them

Not one long serial run but four shard jobs, each on its own runner and each running its
files one at a time. `scripts/ci/shards.mjs` owns the split: it lists
`tests/e2e/*.test.mjs`, sizes each file from a table of **measured seconds on the runner** (`SIZES`; a file that is not in it is
guessed, 45 s when its name starts with `online` because those need two or three browsers,
else 25 s) and hands them out longest-first to the emptiest shard, so a new e2e file lands
somewhere automatically and nothing has to be registered. `node scripts/ci/shards.mjs` prints
all shards with their estimate, `node scripts/ci/shards.mjs 2 4` the file list of shard 2
(that is what the workflow runs). Rooms use random codes, so two shards playing online at the
same time cannot collide. Refresh `SIZES` when a file grows a lot (`gh run view <id> --log`
has a duration per test); the numbers only steer the split, a wrong one costs balance, never
correctness.

## Lessons learned

- **Determinism is a feature of the tests, not a hope.** Seeded RNG everywhere (bots,
  personas, e2e random play via `Bots.rng`, pinned bot seed through sessionStorage),
  node budgets instead of time, generous timing margins, `waitFor` over `sleep`. Cross-realm
  objects from jsdom/vm: compare via `JSON.stringify`, get globals with `w.eval("Name")`.
- **CI runner is a 2-core box.** Random debugging ports collided between parallel e2e
  files and a third Chrome didn't come up under load: Chrome now picks its own port
  (`DevToolsActivePort`), launches retry once, and CI runs e2e files one at a time.
  Diagnostics on timeouts (page state + screenshot) turned "flaky" into "explainable".
  **Parallelism belongs between runners, not inside one**: four shard jobs, each
  still strictly serial, took CI from 7 to 10 minutes down to about 2 without bringing
  the old port and startup flakiness back. Balance the shards by measured seconds (the
  longest one is the wall clock) and keep a gate job under the name branch protection
  requires, so resharding never needs a settings change.

- **Agents.** Parallel agents work well when each owns a folder (bot folders, puzzle
  folders) or a worktree branch (cross-cutting issues); give them the contract up front,
  forward what a finished agent learned to the ones still running, and expect to merge
  and re-verify yourself. A worktree created from the wrong base wastes a whole run —
  check `git log -1` in it first.
- **Agents, the 2026-09-10/11 batch (12 issues, 2 new games, 8 agents in flight).** What
  scaled: one opus agent per issue in its own worktree, a shared preamble file with the
  owner's rules and the base commit, and **the agent merges `main` into its own branch**
  when main moved (it knows both sides of every conflict; the main session then only
  fast-forwards, runs the full suite, pushes, and closes the issue once CI deployed it).
  Order merges so that branches touching the same files land one after the other (both
  new games rewrote the e2e harness helpers and the replay validator: the second one
  merged after the first). Agent worktrees start from a stub commit, so `git merge main`
  is always the first step; a live agent's worktree is locked (`git worktree remove
  --force --force`). Two agents independently reported "pre-existing" e2e failures that
  were real bugs in a sibling's regexes — a test that waits on a regex written inside a JS
  string loses its escapes (`"\d"`); double them. The one flake seen in this batch:
  `replays` "a replay can be saved as a file" (download name null) on a loaded machine —
  and that was a real race, not the machine: the list's row buttons read the record from
  IndexedDB before they act, so an assertion on the next line runs before the click's
  handler has finished. **Wait for the outcome with `waitFor`** after any click whose
  handler awaits IndexedDB (fixed in commit 2af2eed).
