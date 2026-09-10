/* Learn (#41): the data contract every game's `howto` must satisfy (rules bullets,
   replayable tutorial steps with legal expected clicks, replayable scenarios whose `best`
   moves are legal and, for the generated ones, exactly the puzzle's proven best), the
   tutorial and scenario runners in jsdom, the progress in localStorage and the fact that
   the committed scenario files are what scripts/learn/pick-scenarios.mjs produces. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks, wait } from "./dom.mjs";
import { pick } from "../../scripts/learn/pick-scenarios.mjs";
import { loadPuzzles } from "../../scripts/puzzles/runner.mjs";

const w = loadDom();
const Learn = w.eval("Learn");
const Games = w.eval("Games");
const Rules = w.eval("Rules");
const Match = w.eval("Match");

const GAMES = Learn.games();

test("every game that appears in Learn brings rules bullets", () => {
    assert.ok(GAMES.length >= 2, "chain and five teach something");
    for (const key of GAMES) {
        const ho = Learn.howto(key);
        assert.ok(ho.rules.length >= 3, `${key}: at least a handful of rule bullets`);
        for (const line of ho.rules) {
            assert.equal(typeof line, "string");
            assert.ok(line.trim().length > 10, `${key}: "${line}" is not a sentence`);
            assert.ok(!/[—–]/.test(line), `${key}: no em dashes in user text (#24)`);
            assert.ok(!/minecraft/i.test(line), `${key}: the looks are called Blocks`);
        }
    }
});

test("tutorial steps replay, and every expected click is legal for the player to move", () => {
    for (const key of GAMES) {
        const ho = Learn.howto(key);
        assert.ok(ho.tutorial.length >= 3, `${key}: a tutorial worth the name`);
        assert.ok(ho.tutorial[0].config, `${key}: the first step names the config`);
        let config = null;
        ho.tutorial.forEach((step, i) => {
            const where = `${key} step ${i + 1}`;
            assert.equal(typeof step.text, "string");
            assert.ok(step.text.length > 20, `${where}: says something`);
            assert.ok(!/[—–]/.test(step.text), `${where}: no em dashes (#24)`);
            if (step.config) config = step.config;
            const full = Learn.configFor(key, config);
            const rules = Rules.of(key);
            const state = Rules.create(full, key);
            const moves = step.moves || [];
            for (const m of moves) {
                assert.equal(state.over, false, `${where}: the setup ends the game early`);
                assert.ok(rules.isLegal(state, m, state.current), `${where}: setup move ${m} is illegal`);
                Rules.step(rules, state, m);
            }
            if (!step.expect) return;
            assert.equal(state.over, false, `${where}: waits for a click in a finished game`);
            for (const cell of step.expect) {
                assert.ok(rules.isLegal(state, cell, state.current), `${where}: expected cell ${cell} is not legal`);
            }
            for (const cell of step.highlight || []) {
                assert.ok(cell >= 0 && cell < state.cells.length, `${where}: highlight ${cell} is off the board`);
            }
        });
    }
});

test("scenarios replay to their position, best moves are legal and you are to move", () => {
    for (const key of GAMES) {
        const list = Learn.howto(key).scenarios;
        assert.ok(list.length >= 5, `${key}: enough scenarios to train on`);
        const ids = new Set();
        for (const sc of list) {
            assert.ok(!ids.has(sc.id), `${key}: duplicate scenario id ${sc.id}`);
            ids.add(sc.id);
            assert.ok(sc.title && sc.text, `${sc.id}: title and text`);
            assert.ok(!/[—–]/.test(`${sc.title} ${sc.text}`), `${sc.id}: no em dashes (#24)`);
            assert.equal(sc.toMove, 0, `${sc.id}: a scenario always puts you in seat 0`);
            const rules = Rules.of(key);
            const state = Rules.create(Learn.configFor(key, sc.config), key);
            for (const m of sc.history) {
                assert.equal(state.over, false, `${sc.id}: history continues past the end`);
                assert.ok(rules.isLegal(state, m, state.current), `${sc.id}: illegal history move ${m}`);
                Rules.step(rules, state, m);
            }
            assert.equal(state.over, false, `${sc.id}: the position is already decided`);
            assert.equal(state.current, sc.toMove, `${sc.id}: seat ${sc.toMove} is not to move`);
            assert.ok(sc.best.length > 0, `${sc.id}: best is empty`);
            for (const b of sc.best) assert.ok(rules.isLegal(state, b, state.current), `${sc.id}: best move ${b} is illegal`);
        }
    }
});

test("scenarios taken from a puzzle set keep the solver's proven best moves", () => {
    for (const key of GAMES) {
        const data = loadPuzzles(key);
        if (!data) continue;
        const byId = new Map(data.puzzles.map((p) => [p.id, p]));
        let matched = 0;
        for (const sc of Learn.howto(key).scenarios) {
            const puzzle = byId.get(sc.id);
            if (!puzzle) continue;                       // a hand-written scenario
            matched++;
            assert.equal(JSON.stringify(sc.best), JSON.stringify(puzzle.best), `${sc.id}: best differs from the puzzle`);
            assert.equal(JSON.stringify(sc.history), JSON.stringify(puzzle.history), `${sc.id}: history differs`);
            assert.equal(JSON.stringify(sc.config), JSON.stringify(puzzle.config), `${sc.id}: config differs`);
            assert.equal(sc.toMove, puzzle.toMove);
        }
        assert.ok(matched >= 5, `${key}: the generated set should be in there`);
    }
});

test("the committed scenario files are what the pick script produces (deterministic)", () => {
    for (const key of GAMES) {
        const data = loadPuzzles(key);
        if (!data) continue;
        const once = pick(data);
        const twice = pick(data);
        assert.equal(JSON.stringify(once), JSON.stringify(twice), `${key}: the pick is not deterministic`);
        const committed = Learn.howto(key).scenarios.filter((s) => once.some((o) => o.id === s.id));
        assert.equal(JSON.stringify(committed), JSON.stringify(once), `${key}: run "npm run learn:scenarios" and commit the result`);
    }
});

/* ---------- the runners ---------- */

// app.js wires Learn into the screens and into the table exactly like this
const { h } = hooks();
Learn.init({ show: () => {}, exit: () => {} });
Match.init({
    names: () => Learn.names(h.names) || h.names,
    beforeMove: (i) => Learn.beforeMove(i),
    cellClass: (i) => Learn.cellClass(i),
    onLocalMove: (i) => Learn.onLocalMove(i),
});

test("the tutorial walks its steps: wrong click hints, the expected one advances", async () => {
    Learn.startTutorial("chain");
    const steps = Learn.howto("chain").tutorial;
    assert.equal(Learn.active.kind, "tutorial");
    assert.equal(w.document.getElementById("learn-panel").hidden, false);
    assert.ok(w.document.body.classList.contains("learn"));
    assert.equal(w.document.getElementById("learn-step").textContent, `Step 1 / ${steps.length}`);
    assert.equal(w.document.getElementById("learn-text").textContent, steps[0].text);

    const cells = () => w.document.querySelectorAll("#board > .cell");
    const expected = steps[0].expect[0];
    assert.ok(cells()[expected].classList.contains("hint"), "the expected cell is highlighted");

    // a wrong click plays nothing and says so
    const wrong = [...Array(16).keys()].find((i) => i !== expected);
    cells()[wrong].click();
    assert.equal(Match.state.history.length, 0, "nothing was played");
    assert.equal(w.document.getElementById("learn-hint").textContent, Learn.MISS);

    // the expected click plays and steps on (a chain reaction may animate for a while first)
    const clickAndWait = async (cell) => {
        const before = Learn.active.i;
        cells()[cell].click();
        for (let t = 0; t < 400 && Learn.active && Learn.active.i === before; t++) await wait(50);
    };
    await clickAndWait(expected);
    assert.equal(w.document.getElementById("learn-step").textContent, `Step 2 / ${steps.length}`);
    assert.equal(Match.state.history.length, 1);

    // a step without `expect` shows Next; walk the rest of the tutorial with it
    for (let guard = 0; guard < 40 && Learn.active && Learn.active.i < steps.length; guard++) {
        const step = steps[Learn.active.i];
        if (step.expect) await clickAndWait(step.expect[0]);
        else {
            assert.equal(w.document.getElementById("learn-next").hidden, false);
            w.document.getElementById("learn-next").click();
        }
    }
    assert.equal(Learn.active.i, steps.length, "the tutorial finished");
    assert.equal(w.document.getElementById("learn-next").hidden, true);
    assert.equal(Learn.tutorialDone("chain"), true, "and is remembered");

    Learn.exit();
    assert.equal(Learn.active, null);
    assert.equal(w.document.getElementById("learn-panel").hidden, true);
    assert.equal(w.document.body.classList.contains("learn"), false);
});

test("a scenario loads the position, judges the first move and Retry restores it", () => {
    const sc = Learn.howto("five").scenarios[0];
    Learn.startScenario("five", sc.id);
    assert.equal(Learn.active.kind, "scenario");
    assert.equal(Match.mode, "bot");
    assert.equal(Match.state.history.length, sc.history.length, "the position is on the board");
    assert.equal(Match.state.current, 0, "you are to move");
    assert.equal(Match.config.timer, 0, "a lesson is never timed");

    // a wrong move: the panel says so and Retry is offered
    const rules = Rules.of("five");
    const wrong = rules.legalMoves(Match.state, 0).find((i) => !sc.best.includes(i));
    w.document.querySelectorAll("#board > .stone")[wrong].click();
    assert.equal(Learn.active.result, "wrong");
    assert.equal(Learn.isSolved("five", sc.id), false);
    assert.equal(w.document.getElementById("learn-retry").textContent, "Retry");

    Learn.restart();
    assert.equal(Learn.active.result, "");
    assert.equal(Match.state.history.length, sc.history.length, "the position is back");

    // the proven move solves it and is remembered
    w.document.querySelectorAll("#board > .stone")[sc.best[0]].click();
    assert.equal(Learn.active.result, "right");
    assert.equal(Learn.isSolved("five", sc.id), true);
    const stored = JSON.parse(w.localStorage.getItem("chainreact.learn"));
    assert.ok(stored.solved.five.includes(sc.id), "kept in localStorage");
    Learn.exit();
});

test("the details page and the lobby's How to play modal render from the same data", () => {
    Learn.openGame("chain");
    const ho = Learn.howto("chain");
    assert.equal(w.document.getElementById("learn-title").textContent, Games.get("chain").title);
    assert.equal(w.document.querySelectorAll("#learn-rules li").length, ho.rules.length);
    assert.equal(w.document.querySelectorAll("#learn-scenarios .learn-scenario").length, ho.scenarios.length);
    assert.equal(w.document.getElementById("learn-progress").textContent, `0 / ${ho.scenarios.length} solved`);

    Learn.openHowto("five");
    assert.equal(w.document.getElementById("howto-modal").hidden, false);
    assert.equal(w.document.getElementById("howto-title").textContent, Games.get("five").title);
    assert.equal(w.document.querySelectorAll("#howto-rules li").length, Learn.howto("five").rules.length);
    assert.equal(w.document.querySelectorAll("#howto-steps li").length, Learn.howto("five").tutorial.length);
    Learn.closeHowto();
    assert.equal(w.document.getElementById("howto-modal").hidden, true);
    w.close();
});
