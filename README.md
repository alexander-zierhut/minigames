# ALZlper's Minigames

Two nostalgic minigames for two to four players in one static page: **Chain React** (fill a cell, it
explodes into its neighbours, take the whole board) and **Five Wins** (five in a row, no
gravity). Live at https://minigames.alzlper.com/.

Static site, no backend, no framework. Create a room once, share the link, then pick
games and settings together in the room lobby; rematch or switch games without new links.

## Play

- **On one device:** two to four people share a screen or phone, or play against the
  bot (one per game, pick the difficulty; the numbers shown are its win rate against a
  random player and its puzzle score).
- **Online:** one player creates a room and shares the link (or the 5-letter code).
  Everybody typing the same code also works; a room seats two, three or four players
  (the *Players* setting). Uses PeerJS: the public PeerJS broker only brokers the
  handshake, then the game runs peer to peer (the room's host relays between guests).
  Anyone who joins when every seat is taken watches as a spectator, and the lobby's
  spectate-link button (👀 next to "Share link") invites people to watch on purpose.
  A page refresh, leaving and coming back by the same link, even the room creator
  leaving — the room survives as long as one player is in it, and everybody keeps
  their seat, their colour and their name.

Online and against the bot you can already click your answer while the other side is
thinking: the premove is marked on the board and played the moment it is your turn
(clicking the same cell again takes it back).

The number of players (two, three or four) is picked right in the lobby and can never be
set below the people already sitting in the room; the settings
(board size, animation speed, chess-style timer, chain-win rule, stones in a row) are
shared live in the room lobby; anyone can change them. The ⚙ button in
the top-left corner holds the per-device preferences: your name (a short one is picked for
you on the first visit, change it under Profile; up to 16 characters, everyone in the room
sees it), the look (Classic, Blocks board,
Blocks) and the sounds (volume, categories; the Classic look uses synthesized cues, the
Blocks looks pixel block, explosion and level-up sounds). Emoji reactions for
trash talk are in the top-right corner; a room chat lives under the game log (phones:
behind the ☰ button). When a game is over, "Look at board" opens a replay bar to step
through it move by move, in step with everyone else in the room.

The title screen has a Changelog (from `changelog.json`, kept current with every change).
On Android the title screen offers "Add to home screen" so it runs like an installed app
(web app manifest; no service worker, no offline mode).

## Develop & test

```
npm install        # dev tools only (jsdom, esbuild)
npm run dev        # http://localhost:8000 (needs php) — or any static file server
npm test           # unit tests (jsdom + pure rules) and end-to-end tests (headless Chrome)
npm run build      # hashed bundle in dist/
```

CI runs the whole suite on every push and pull request; `main` deploys only after a
green run and requires the check to merge. `AGENTS.md` documents the architecture, the
room protocol and how to add a game.

## Layout

- `index.html` — markup, templates, and the ordered list of stylesheets and scripts
- `client/lib/` — `util`, `bus` (events), `log`, `clock`, `net` (PeerJS rooms), `preload`, `sound`, `install`
- `client/games/rules.js` — the pure game loop (`Rules.create / step / eliminate / apply / replay`) every headless path shares
- `client/games.js` — game registry, the engine shell every game shares, the generic HUD (rendered from a model the game returns)
- `client/games/` — per game: pure `<key>-rules.js`, `<key>.js` (view + registration incl. its settings rows), `<key>.css`
- `client/bots.js`, `client/bots/<id>/` — bot registry + toolset; one folder per bot with its tests and benchmark score; `client/winchance.js` shows the bars
- `scripts/` — `headless.mjs` (rules + bots in Node), `benchmark.mjs` (`npm run benchmark`), puzzle solvers, verify, screenshots
- `client/match.js` (the table: seats, engine, clock, bot seat), `client/room.js` (online protocol, presence, sync), `client/session.js`, `client/app.js` (screens, lobby, flow)
- `client/skins.js` (the look), `client/prefs.js` (⚙ per-device preferences incl. your name), `client/settings.js`, `client/opponent.js`, `client/reactions.js`, `client/chat.js`, `client/changelog.js`
- `client/lib/sound.js`, `client/sounds/` — sound cues (synthesized Classic set, the Blocks .ogg files)
- `client/css/` — base tokens, menu/lobby, game screen, the Blocks skins
- `client/textures/` — 16×16 block textures used by the Blocks skins
- `tests/unit`, `tests/e2e`, `build.mjs`, `.github/workflows/ci.yml`
