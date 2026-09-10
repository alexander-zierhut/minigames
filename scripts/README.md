# scripts/

Development tools that are never deployed (the deploy uploads `dist/` only).

- `puzzles/<game>/solver.mjs` — proves the perfect move(s) of a position (see each folder's README for the guarantee).
- `puzzles/<game>/generate.mjs` — regenerates `tests/puzzles/<game>/puzzles.json` deterministically (`npm run puzzles`).
- `puzzles/verify.mjs` — solver-independent one-ply re-proof of the tactical puzzles + the blind-random baseline (`npm run puzzles:verify`).
- `screenshots.mjs` — screenshot tour of every screen and skin on desktop and phone for visual checks.

- `headless.mjs` — loads util + rules + bots into a bare Node VM (used by every headless test and tool).
- `puzzles/runner.mjs` — replays a puzzle and grades a bot on a puzzle set.
- `benchmark.mjs` — series vs Random + puzzle score → `client/bots/<id>/benchmark.js` (`npm run benchmark`).
