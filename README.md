# ALZlper's Minigames

Two nostalgic minigames for two to four players in one static page: **Chain React** (fill a cell, it
explodes into its neighbours, take the whole board) and **Five Wins** (five in a row, no
gravity). Live at https://minigames.alzlper.com/.

Static site, no backend, no framework. Create a room once, share the link, then pick
games and settings together in the room lobby; rematch or switch games without new links.

## Play

- **On one device:** two to four people share a screen or phone, or play against a bot
  (pick the bot and difficulty per game; the number shown is its win rate against the
  Random bot).
- **Online:** one player creates a room and shares the link (or the 5-letter code).
  Everybody typing the same code also works; a room seats two, three or four players
  (the *Players* setting). Uses PeerJS: the public PeerJS broker only brokers the
  handshake, then the game runs peer to peer (the room's host relays between guests).
  Anyone who joins when every seat is taken watches as a spectator, and the lobby's
  "Spectate link" invites people to watch on purpose. A page refresh, leaving
  and coming back by the same link, even the room creator leaving — the room survives
  as long as one player is in it, and everybody keeps their colour.

Settings (players, board size, animation speed, chess-style timer, chain-win rule,
stones in a row) are shared live in the room lobby; anyone can change them. The ⚙ button in
the top-left corner holds the per-device preferences: the look (Classic, MC board,
Minecraft) and the sounds (volume, categories; the Classic look uses synthesized cues,
the Minecraft looks the real block, TNT and level-up sounds). Emoji reactions for
trash talk are in the top-right corner; a room chat lives under the game log (phones:
behind the ☰ button) and in the lobby.

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
- `client/lib/` — `util`, `bus` (events), `log`, `clock`, `net` (PeerJS rooms), `preload`
- `client/games.js` — game registry, the engine shell every game shares, HUD renderer
- `client/games/` — per game: pure `<key>-rules.js`, `<key>.js` (view + registration), `<key>.css`
- `client/bots.js`, `client/bots/<id>/` — bot registry + toolset; one folder per bot with its tests and benchmark score
- `scripts/` — `headless.mjs` (rules + bots in Node), `benchmark.mjs` (`npm run benchmark`), puzzle solvers, verify, screenshots
- `client/skins.js`, `client/prefs.js` (⚙ per-device preferences), `client/settings.js`, `client/reactions.js`, `client/app.js` (flow, room protocol)
- `client/lib/sound.js`, `client/sounds/` — sound cues (synthesized Classic set, Minecraft .ogg files)
- `client/css/` — base tokens, menu/lobby, game screen, Minecraft skins
- `client/textures/` — 16×16 block textures used by the Minecraft skins
- `tests/unit`, `tests/e2e`, `build.mjs`, `.github/workflows/ci.yml`
