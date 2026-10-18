/* The minimum every game must have ("What every game must have" in
   .claude/rules/games.md): checked for every registered game, so a new game that forgets
   one of them fails here instead of in the owner's hands. Data-driven: no game is named
   in this file, everything comes from Games.keys(). What the framework gives every game
   for free (rooms, replays, the clock, spectators) is not checked here; this file checks
   what a game has to bring itself. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { loadDom, wait } from "./dom.mjs";
import { SIZES } from "../../scripts/ci/shards.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const HTML = readFileSync(ROOT + "index.html", "utf8");
const w = loadDom();
const Games = w.eval("Games"), Bots = w.eval("Bots"), Learn = w.eval("Learn"), I18n = w.eval("I18n"), Rules = w.eval("Rules"), Sound = w.eval("Sound");
const KEYS = Games.keys();
const E2E = readdirSync(ROOT + "tests/e2e").filter((f) => f.endsWith(".test.mjs"));

test("there are games to check", () => {
    assert.ok(KEYS.length >= 1);
});

for (const key of KEYS) {
    const def = Games.get(key);

    test(`${key}: two to four players where the rules allow, and premoves on`, () => {
        assert.ok(def.players.min <= 2 && def.players.max >= 2, "at least two players");
        assert.ok(def.players.max <= 4, "the HUD, the colours and the rooms have four seats");
        assert.notEqual(def.premove, false, "premoves are part of every game (#37): a two-click move composes on `can-premove`");
    });

    test(`${key}: every move names its cells (the last, best-move and premove markers)`, () => {
        const r = Rules.of(key);
        const s = Rules.create({ game: key, n: def.size.default, players: 2, startPlayer: 0 }, key);
        const moves = r.legalMoves(s, s.current).slice(0, 40);
        assert.ok(moves.length > 0, "a fresh game has legal moves");
        for (const m of moves) {
            const cell = r.cellOf ? r.cellOf(s, m) : m;
            const cells = r.cellsOf ? r.cellsOf(s, m) : [cell];
            assert.ok(Number.isInteger(cell) && cell >= 0 && cell < s.cells.length, `cellOf(${m}) is a cell`);
            assert.ok(cells.includes(cell), `cellsOf(${m}) contains cellOf(${m})`);
            assert.ok(cells.every((c) => Number.isInteger(c) && c >= 0 && c < s.cells.length), `cellsOf(${m}) are cells`);
            // a move that changes several cells names all of them (a band's edges, a step and
            // its broken tile), so the premove marker shows the whole move; the tile a piece
            // leaves (still the mover's before the move) is not part of it
            const t = Rules.create({ game: key, n: def.size.default, players: 2, startPlayer: 0 }, key);
            const before = t.cells.slice(), owned = t.cells.map((_, i) => r.ownerOf(t, i));
            const mover = t.current;
            Rules.step(r, t, m);
            const changed = t.cells.map((c, i) => (c !== before[i] && owned[i] !== mover ? i : -1)).filter((i) => i >= 0);
            assert.ok(changed.every((i) => cells.includes(i)), `cellsOf(${m}) = [${cells}] covers the cells the move changes [${changed}]`);
        }
    });

    /* The premove the way a player sets it: while the friend is to move, click the move with
       the view's own clicks (a two-click view must compose it on `can-premove`), see it marked
       on every cell of the move, and see it played the moment the friend's move arrives. This
       is the check that fails for a view that only listens on `can-place`. */
    test(`${key}: a premove is composed with the view's clicks while the friend moves, marked and played`, async () => {
        const dw = loadDom(); const M = dw.eval("Match"); const R = dw.eval("Rules"); const r = R.of(key);
        const cfg = { game: key, n: def.size.default, players: 2, timer: 0 };
        for (const s of def.settings) cfg[s.key] = s.def;
        M.reset("online", 0);
        for (let g = 1; g <= 4 && !(M.state && M.state.current === 1 && M.running); g++) M.start(cfg, g);
        assert.equal(M.state.current, 1, "a game where the friend (seat 1) moves first");
        const s = M.state;
        // a move of mine that is still legal after one move of the friend's
        let mine = -1, theirs = -1;
        for (const f of r.legalMoves(s, 1).slice(0, 20)) {
            const t = R.replay(M.engine.record());
            R.step(r, t, f);
            if (t.over || t.current !== 0) continue;
            mine = r.legalMoves(s, 0).find((m) => r.isLegal(t, m, 0));
            if (mine !== undefined) { theirs = f; break; }
            mine = -1;
        }
        assert.ok(mine >= 0, "a move for me that survives the friend's move");
        const cells = [...dw.document.querySelectorAll("#board > *")].filter((el) => el.querySelector(":scope > .last-marker"));
        assert.equal(cells.length, s.cells.length, "one cell element per cell (BoardView.cells)");
        assert.ok(cells.some((el) => el.classList.contains("can-premove")), "the engine paints `can-premove` while the friend moves");
        assert.ok(!cells.some((el) => el.classList.contains("can-premove") && el.classList.contains("locked")), "a premove cell is never `locked`");
        const view = dw.eval("Games").get(key).view;              // this window's view, which built the board
        const els = view.clicks ? view.clicks(s, mine) : [cells[mine]];
        for (const el of els) el.click();
        assert.equal(M.premove, mine, "the view's clicks set the premove (a two-click view composes it on `can-premove`)");
        assert.equal(s.history.length, 0, "nothing is played on the friend's turn");
        const marked = cells.map((el, i) => (el.classList.contains("premove") ? i : -1)).filter((i) => i >= 0);
        assert.deepEqual([...M.engine.cellsOf(mine)].sort((a, b) => a - b), marked, "every cell of the move carries `premove`");
        await M.engine.play(theirs);
        for (let k = 0; k < 500 && (M.state.busy || M.state.history.length < 2); k++) await wait(10);
        assert.deepEqual([...M.state.history], [theirs, mine], "the premove followed the friend's move");
        assert.equal(M.premove, -1);
        dw.eval("Clock.setup(0)"); dw.close();
    });

    test(`${key}: a real bot with four levels, an evaluator, a benchmark and a calibration, plus a random baseline`, () => {
        const bots = Bots.forGame(key);
        assert.ok(bots.some((b) => b.baseline), "a random baseline (random-<key>)");
        const bot = Bots.botFor(key, {});
        assert.ok(bot && !bot.baseline, "Bots.botFor offers a real bot, not the baseline");
        assert.equal(bot.difficulties.length, 4, "four difficulties");
        assert.equal(typeof bot.evaluate, "function", "evaluate(state, tools) feeds the win chance and the analysis");
        assert.ok(Bots.benchmarkOf(bot.id, {}), "a committed benchmark.js (npm run benchmark)");
        assert.ok(Bots.calibrationOf(bot.id, {}), "a calibration (npm run calibrate)");
        assert.ok(existsSync(`${ROOT}client/bots/${bot.id}/bot.test.mjs`), "a bot test in its folder");
    });

    test(`${key}: a solver-proven puzzle set`, () => {
        const file = `${ROOT}tests/puzzles/${key}/puzzles.json`;
        assert.ok(existsSync(file), `tests/puzzles/${key}/puzzles.json`);
        assert.ok(existsSync(`${ROOT}tests/puzzles/${key}/solver.test.mjs`), "the solver's own test");
    });

    test(`${key}: Learn has rule bullets, a tutorial and the generated ladder`, () => {
        const ho = Learn.howto(key);
        assert.ok(ho.rules.length >= 1, "rule bullets");
        assert.ok(ho.tutorial.length >= 1, "a tutorial");
        assert.ok(ho.scenarios.length >= 1, "scenarios");
        assert.ok(HTML.includes(`<script src="client/learn/${key}-scenarios.js"></script>`), `client/learn/${key}-scenarios.js is loaded`);
    });

    test(`${key}: its texts in every language`, () => {
        const codes = I18n.codes();
        assert.ok(codes.length >= 6, "six languages");
        for (const code of codes) {
            const dict = I18n.dict(code);
            for (const k of [def.title, def.tagline, def.desc]) assert.ok(typeof dict[k] === "string" && dict[k].length > 0, `${code}: ${k}`);
        }
    });

    test(`${key}: a unit suite, an e2e suite and its place in the CI shards`, () => {
        assert.ok(existsSync(`${ROOT}tests/unit/${key}.test.mjs`), `tests/unit/${key}.test.mjs`);
        const own = `${key}.test.mjs`;
        if (E2E.includes(own)) {
            assert.ok(SIZES[own] > 0, `scripts/ci/shards.mjs SIZES names ${own}`);
            return;
        }
        // the first two games predate their own suites: the shared suites play them by key
        const by = E2E.filter((f) => new RegExp(`selectGame\\(["']${key}["']\\)|game: ["']${key}["']`).test(readFileSync(`${ROOT}tests/e2e/${f}`, "utf8")));
        assert.ok(by.length >= 3, `tests/e2e/${own}, or the shared suites play it (${by.join(", ") || "none"})`);
    });
}

test("the generic sound cues cover every game's move", () => {
    assert.ok(Sound.map("game:move", { cell: 0, player: 0 }, ["local", "bot"]), "game:move sounds");
    assert.ok(Sound.map("game:finish", { winner: 0 }, ["local", "bot"]), "game:finish sounds");
});

test.after(() => { w.eval("Clock.setup(0)"); w.close(); });
