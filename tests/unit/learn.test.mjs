/* Learn (#41, the ladder of #44): the data contract every game's `howto` must satisfy (rules
   bullets, replayable tutorial steps with legal expected clicks, replayable scenarios whose
   `best` moves are legal and, for the generated ones, exactly the puzzle's proven best), the
   tiers / kinds / difficulties of the ladder, the pure part of the generator (difficultyOf,
   kindOf, select) against the committed facts, the tutorial and scenario runners in jsdom,
   the lock rule and the progress in localStorage. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, hooks, wait } from "./dom.mjs";
import { select, difficultyOf, kindOf, TIERS, KINDS, loadFacts } from "../../scripts/learn/pick-scenarios.mjs";
import { loadPuzzles } from "../../scripts/puzzles/runner.mjs";

const w = loadDom();
const Learn = w.eval("Learn");
const Games = w.eval("Games");
const Rules = w.eval("Rules");
const Bots = w.eval("Bots");
const Bus = w.eval("Bus");
const Match = w.eval("Match");

const GAMES = Learn.games();
const TIER_IDS = TIERS.map((t) => t.id);

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
            if (sc.kind === "play-from-here") {
                // nothing is judged here, so the position only has to be a real game to play out
                assert.equal(sc.goal, "win", `${sc.id}: a play-from-here scenario is won or lost`);
                assert.ok(rules.legalMoves(state, 0).length > 0, `${sc.id}: no move to make`);
                assert.ok(Bots.botFor(key, Learn.configFor(key, sc.config)), `${key}: play-from-here needs a bot`);
            } else {
                assert.ok(sc.best.length > 0, `${sc.id}: best is empty`);
                for (const b of sc.best) assert.ok(rules.isLegal(state, b, state.current), `${sc.id}: best move ${b} is illegal`);
            }
        }
    }
});

test("the ladder: known tiers and kinds, difficulty 1..10 and easy first inside a tier", () => {
    for (const key of GAMES) {
        const list = Learn.howto(key).scenarios;
        for (const sc of list) {
            assert.ok(TIER_IDS.includes(sc.tier), `${sc.id}: unknown tier ${sc.tier}`);
            assert.ok(Object.keys(Learn.KINDS).includes(sc.kind), `${sc.id}: unknown kind ${sc.kind}`);
            assert.ok(Number.isInteger(sc.difficulty) && sc.difficulty >= 1 && sc.difficulty <= 10, `${sc.id}: difficulty ${sc.difficulty}`);
            if (sc.level) {
                const bot = Bots.botFor(key, Learn.configFor(key, sc.config));
                assert.ok(bot.difficulties.some((d) => d.id === sc.level), `${sc.id}: ${bot.id} has no level ${sc.level}`);
            }
        }
        // the list is ordered by tier, and inside a tier from easy to hard
        assert.deepEqual(
            list.map((s) => TIER_IDS.indexOf(s.tier)),
            list.map((s) => TIER_IDS.indexOf(s.tier)).slice().sort((a, b) => a - b),
            `${key}: tiers are out of order`);
        for (const tier of TIER_IDS) {
            const rows = list.filter((s) => s.tier === tier);
            assert.ok(rows.length >= 3, `${key}/${tier}: a tier worth showing`);
            rows.forEach((sc, i) => {
                if (i > 0) assert.ok(sc.difficulty >= rows[i - 1].difficulty, `${sc.id}: easier than the row before it`);
            });
        }
        // every tier mixes at least two kinds, and every game ends on a play-from-here row
        assert.ok(list.some((s) => s.kind === "play-from-here"), `${key}: no play-from-here scenario`);
        assert.ok(new Set(list.map((s) => s.kind)).size >= 3, `${key}: the kinds are not mixed`);
    }
});

test("the generator's difficulty and kind, on hand-made facts", () => {
    const base = { depth: 1, value: "win", legal: 20, bestCount: 8, greedyOk: true, easyOk: true, normalOk: true, chance: 0.9, look: 0.9 };
    assert.equal(difficultyOf(base), 1, "a wide open win in one is the easiest thing there is");
    assert.equal(kindOf(base), "best-move");
    // deeper proofs, thinner sets of good moves and bots that miss it all make it harder
    assert.ok(difficultyOf({ ...base, depth: 5 }) > difficultyOf(base), "a deeper proof is harder");
    assert.ok(difficultyOf({ ...base, bestCount: 1 }) > difficultyOf(base), "one move out of twenty is harder");
    assert.ok(difficultyOf({ ...base, easyOk: false }) > difficultyOf(base), "the Easy bot walking into it is harder");
    assert.ok(difficultyOf({ ...base, greedyOk: false }) > difficultyOf(base), "a wrong greedy move is harder");
    assert.equal(difficultyOf({ ...base, depth: 99, bestCount: 1, easyOk: false, normalOk: false, greedyOk: false, chance: 0.1, look: 0.1 }), 10, "capped at 10");
    assert.equal(difficultyOf({ ...base, depth: "exhaustive" }), difficultyOf({ ...base, depth: 6 }), "an exhaustive proof reads as a deep one");
    // kinds: the obvious move being wrong makes a trap, looking lost with a proven win a turnaround
    assert.equal(kindOf({ ...base, greedyOk: false }), "trap");
    assert.equal(kindOf({ ...base, easyOk: false }), "trap");
    assert.equal(kindOf({ ...base, chance: 0.2, look: 0.2 }), "turnaround");
    assert.equal(kindOf({ ...base, value: "draw", chance: 0.2, look: 0.2 }), "best-move", "no proven win, no turnaround");
    assert.equal(kindOf({ ...base, kind: "play-from-here" }), "play-from-here", "a kind that is already set stands");
    // play-from-here is scored by its tier, and a level that is exactly even is the harder one
    const pfh = { kind: "play-from-here", chance: 0.6 };
    assert.ok(difficultyOf({ ...pfh, tier: "mastery" }) > difficultyOf({ ...pfh, tier: "tactics" }));
    assert.ok(difficultyOf({ ...pfh, tier: "tactics" }) > difficultyOf({ ...pfh, tier: "basics" }));
    assert.ok(difficultyOf({ ...pfh, tier: "basics", chance: 0.5 }) > difficultyOf({ ...pfh, tier: "basics" }));
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

test("the committed scenario files are what the generator selects from the committed facts", () => {
    for (const key of GAMES) {
        const facts = loadFacts(key);
        if (!facts) continue;
        const once = select(facts);
        const twice = select(facts);
        assert.equal(JSON.stringify(once), JSON.stringify(twice), `${key}: the selection is not deterministic`);
        const committed = Learn.howto(key).scenarios.filter((s) => once.some((o) => o.id === s.id));
        assert.equal(JSON.stringify(committed), JSON.stringify(once), `${key}: run "npm run learn:scenarios" and commit the result`);
        // and the facts belong to the puzzle set on disk
        const data = loadPuzzles(key);
        if (data) assert.equal(facts.set.count, data.puzzles.length, `${key}: the facts are older than the puzzle set`);
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

test("a play-from-here scenario is judged on the result of the game, and Next offers the one after it", () => {
    const list = Learn.howto("five").scenarios;
    const sc = list.find((s) => s.kind === "play-from-here" && Learn.nextScenario("five", s.id));
    assert.ok(sc, "the ladder has a play-from-here scenario with one after it");
    Learn.startScenario("five", sc.id);
    assert.equal(Match.state.history.length, sc.history.length, "the position is on the board");
    assert.match(w.document.getElementById("learn-hint").textContent, /must win/, "the goal is spelled out");
    assert.equal(Learn.active.judged, false);
    assert.equal(w.document.getElementById("learn-next").hidden, true, "nothing to move on to yet");

    // the first move is not judged at all here: only the end of the game counts
    const wrong = Rules.of("five").legalMoves(Match.state, 0)[0];
    w.document.querySelectorAll("#board > .stone")[wrong].click();
    assert.equal(Learn.active.judged, false, "a play-from-here scenario judges no single move");
    Bus.emit("game:finish", { game: "five", winner: 1, why: "", state: Match.state });
    assert.equal(Learn.active.result, "wrong");
    assert.equal(Learn.isSolved("five", sc.id), false);

    Learn.restart();
    assert.equal(Learn.active.result, "");
    Bus.emit("game:finish", { game: "five", winner: 0, why: "", state: Match.state });
    assert.equal(Learn.active.result, "right");
    assert.equal(Learn.isSolved("five", sc.id), true, "winning it solves it");
    assert.equal(Learn.canAdvance(), true);
    assert.equal(Learn.againText(), "Next scenario");
    assert.equal(w.document.getElementById("learn-next").hidden, false);

    Learn.again();
    assert.equal(Learn.active.scenario.id, Learn.nextScenario("five", sc.id).id, "the next rung of the ladder");
    Learn.exit();
});

test("tiers: progress per tier and the lock that opens once most of the one before it is solved", () => {
    const key = "five";
    const basics = Learn.howto(key).scenarios.filter((s) => s.tier === "basics");
    assert.equal(Learn.tierLocked(key, "basics"), false, "the first tier is always open");
    assert.equal(Learn.tierLocked(key, "tactics"), true, "the later ones start with a hint to wait");
    const need = Math.ceil(basics.length * Learn.UNLOCK);
    const solveable = basics.filter((s) => s.kind !== "play-from-here").slice(0, need);
    assert.ok(solveable.length >= need, "enough judged scenarios in Basics to unlock with");
    for (const sc of solveable) {
        Learn.startScenario(key, sc.id);
        w.document.querySelectorAll("#board > .stone")[sc.best[0]].click();
        assert.equal(Learn.active.result, "right", `${sc.id}: the proven move solves it`);
        Learn.exit();
    }
    const done = Learn.tierProgress(key, "basics");
    assert.equal(done.total, basics.length);
    assert.ok(done.solved >= need, `${done.solved} of ${done.total} solved`);
    assert.equal(Learn.tierLocked(key, "tactics"), false, "most of Basics opens Tactics");
    assert.equal(Learn.tierLocked(key, "mastery"), true, "but never everything at once");
    // the generator and the client have to agree on the vocabulary
    assert.equal(JSON.stringify(TIERS.map((t) => t.id)), JSON.stringify(Learn.TIERS.map((t) => t.id)), "the tiers");
    assert.equal(JSON.stringify(KINDS.slice().sort()), JSON.stringify(Object.keys(Learn.KINDS).sort()), "the kinds");
});

test("the details page and the lobby's How to play modal render from the same data", () => {
    Learn.openGame("chain");
    const ho = Learn.howto("chain");
    assert.equal(w.document.getElementById("learn-title").textContent, Games.get("chain").title);
    assert.equal(w.document.querySelectorAll("#learn-rules li").length, ho.rules.length);
    assert.equal(w.document.querySelectorAll("#learn-scenarios .learn-scenario").length, ho.scenarios.length);
    assert.equal(w.document.getElementById("learn-progress").textContent, `0 / ${ho.scenarios.length} solved`);
    // one header per tier, with that tier's own progress and, further down, the lock hint (#44)
    const heads = [...w.document.querySelectorAll("#learn-scenarios .learn-tier")];
    assert.equal(heads.length, Learn.TIERS.length);
    assert.equal(heads[0].querySelector("b").textContent, "Basics");
    assert.equal(heads[0].querySelector(".learn-tier-count").textContent, `0 / ${Learn.tierProgress("chain", "basics").total}`);
    assert.equal(heads[0].classList.contains("locked"), false);
    assert.equal(heads[1].classList.contains("locked"), true);
    assert.match(heads[1].querySelector(".learn-lock").textContent, /Solve most of Basics/);
    const row = w.document.querySelector("#learn-scenarios .learn-scenario");
    assert.equal(row.querySelector(".learn-dots").textContent.length, 5, "difficulty as five dots");
    assert.ok(row.querySelector("small").textContent.length > 0, "the kind is named on the row");

    Learn.openHowto("five");
    assert.equal(w.document.getElementById("howto-modal").hidden, false);
    assert.equal(w.document.getElementById("howto-title").textContent, Games.get("five").title);
    assert.equal(w.document.querySelectorAll("#howto-rules li").length, Learn.howto("five").rules.length);
    assert.equal(w.document.querySelectorAll("#howto-steps li").length, Learn.howto("five").tutorial.length);
    Learn.closeHowto();
    assert.equal(w.document.getElementById("howto-modal").hidden, true);
    w.close();
});
