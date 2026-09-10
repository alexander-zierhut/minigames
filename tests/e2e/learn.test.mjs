/* Learn (#41): the offline academy. Title -> Learn -> a game's details page -> the guided
   tutorial (highlight, wrong click, right click, finish) and a scenario against the bot
   (wrong move -> Retry, right move -> ✓). Plus the lobby's "How to play" modal, which
   closes when a game starts, and a phone check that none of the new screens scrolls. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.ev("Prefs.set({ name: 'Alex' })"); });
after(async () => { await B?.close(); await server?.close(); });

const stepNo = () => B.text("learn-step");
const cell = (i) => B.ev(`document.querySelectorAll('#board > .cell, #board > .stone, #board > .slab, #board > .edge')[${i}].click(); true`);

test("the title screen offers Learn, and it lists every game that teaches something", async () => {
    assert.equal(await B.screen(), "screen-menu");
    assert.equal(await B.ev("document.getElementById('btn-learn').hidden"), false);
    await B.click("#btn-learn");
    assert.equal(await B.screen(), "screen-learn");
    const cards = await B.ev("[...document.querySelectorAll('#learn-games .game-card')].map(c => c.dataset.game).join(',')");
    assert.match(cards, /chain/);
    assert.match(cards, /five/);
    assert.match(cards, /boxes/);
    assert.equal(await B.ev("document.querySelector('#learn-games .game-card .game-players').textContent"), "0 / 8 scenarios");
});

test("a game's details page shows the rules, the tutorial and the scenarios", async () => {
    await B.click("#learn-games .game-card[data-game=chain]");
    assert.equal(await B.screen(), "screen-learn-game");
    assert.equal(await B.text("learn-title"), "Chain React");
    assert.ok(await B.ev("document.querySelectorAll('#learn-rules li').length >= 5"), "rule bullets");
    assert.equal(await B.ev("document.getElementById('btn-learn-tutorial').hidden"), false);
    assert.equal(await B.ev("document.querySelectorAll('#learn-scenarios .learn-scenario').length"), 8);
    assert.equal(await B.text("learn-progress"), "0 / 8 solved");
    assert.equal((await B.noScroll()).screen, true, "the details page fits");
});

test("the tutorial: the highlighted cell, a wrong click hints, the right one advances, Next finishes", async () => {
    await B.click("#btn-learn-tutorial");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.ev("document.getElementById('learn-panel').hidden"), false);
    assert.equal(await B.ev("document.body.classList.contains('learn')"), true);
    assert.equal(await B.ev("getComputedStyle(document.getElementById('game-controls')).display"), "none", "no rematch inside a lesson");
    assert.equal(await B.text("p0-name"), "Alex", "you keep your own name, so every log line reads properly");
    assert.equal(await B.text("p1-name"), "Opponent", "nobody sits at the other seat in a tutorial");
    assert.match(await B.ev("document.querySelector('#log > div').textContent"), /^New game\. Alex starts\./);
    assert.equal(await B.ev("getComputedStyle(document.querySelector('#p-0 .win-bar')).display"), "none", "no win chance in a tutorial");
    const steps = await B.ev("Learn.howto('chain').tutorial.length");
    assert.equal(await stepNo(), `Step 1 / ${steps}`);
    assert.equal(await B.ev("document.querySelectorAll('#board > .cell.hint').length"), 1, "exactly one cell is highlighted");
    const want = await B.ev("Learn.active.hints[0]");

    // a wrong click plays nothing and says what to do
    const wrong = await B.ev(`[...Array(ChainGame.state.cells.length).keys()].find(i => i !== ${want})`);
    await cell(wrong);
    assert.equal(await B.ev("ChainGame.state.history.length"), 0, "nothing played");
    assert.equal(await B.text("learn-hint"), "Try the highlighted cell.");
    assert.equal(await stepNo(), `Step 1 / ${steps}`);

    // the highlighted one plays and steps on
    await cell(want);
    await B.waitFor(`document.getElementById('learn-step').textContent === 'Step 2 / ${steps}'`, { timeout: 15000, what: "step 2" });
    assert.equal(await B.ev("ChainGame.state.history.length"), 1);

    // walk the rest: click what a step asks for, press Next where it does not
    for (let guard = 0; guard < 30; guard++) {
        const done = await B.ev("!Learn.active || Learn.active.i >= Learn.active.steps.length");
        if (done) break;
        const at = await B.ev("Learn.active.i");
        const expect = await B.ev("(Learn.active.steps[Learn.active.i].expect || [])[0] ?? -1");
        if (expect >= 0) {
            await cell(expect);
            await B.waitFor(`!Learn.active || Learn.active.i !== ${at}`, { timeout: 60000, what: "the step after a click" });
        } else {
            await B.click("#learn-next");
        }
    }
    assert.equal(await B.ev("Learn.active.i"), steps, "the tutorial reached its end");
    assert.equal(await B.ev("document.getElementById('learn-next').hidden"), true, "no Next past the end");
    assert.equal(await B.text("learn-step"), "Done");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true, "a tutorial never shows the result card");
    assert.equal(await B.ev("Learn.tutorialDone('chain')"), true);

    await B.click("#learn-back");
    assert.equal(await B.screen(), "screen-learn-game");
    assert.equal(await B.ev("document.getElementById('learn-panel').hidden"), true);
    assert.match(await B.text("learn-tutorial-hint"), /finished this tutorial/);
});

test("Käsekästchen tutorial: the highlighted line, and closing a box keeps you on turn", async () => {
    await B.click("#btn-learn-back");
    await B.click("#learn-games .game-card[data-game=boxes]");
    assert.equal(await B.text("learn-title"), "Käsekästchen");
    await B.click("#btn-learn-tutorial");
    assert.equal(await B.screen(), "screen-game");
    const steps = await B.ev("Learn.howto('boxes').tutorial.length");
    assert.equal(await stepNo(), `Step 1 / ${steps}`);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.hint').length"), 1, "one line is highlighted");
    // a line that is not the highlighted one plays nothing
    const want = await B.ev("Learn.active.hints[0]");
    await cell(await B.ev(`[...Array(BoxesGame.state.cells.length).keys()].find(i => i !== ${want})`));
    assert.equal(await B.ev("BoxesGame.state.history.length"), 0, "nothing drawn");
    assert.equal(await B.text("learn-hint"), "Try the highlighted cell.");
    // walk the lesson; at the last step the box of the step before is closed and it is still your turn
    for (let guard = 0; guard < 20; guard++) {
        if (await B.ev("!Learn.active || Learn.active.i >= Learn.active.steps.length")) break;
        const at = await B.ev("Learn.active.i");
        if (at === steps - 1) {
            const st = await B.state();
            assert.equal(st.scores[0], 1, "the box you closed is yours");
            assert.equal(st.boxes[0], 0);
            assert.equal(st.current, 0, "and it is still your turn");
            assert.equal(await B.ev("document.querySelectorAll('#board > .box.taken').length"), 1);
            assert.equal(await B.ev("document.querySelectorAll('#board > .edge.hint').length"), 2, "two safe lines are offered");
        }
        const expect = await B.ev("(Learn.active.steps[Learn.active.i].expect || [])[0] ?? -1");
        if (expect >= 0) {
            await cell(expect);
            await B.waitFor(`!Learn.active || Learn.active.i !== ${at}`, { timeout: 60000, what: "the step after a click" });
        } else {
            await B.click("#learn-next");
        }
    }
    assert.equal(await B.ev("Learn.active.i"), steps, "the lesson reached its end");
    assert.equal(await B.text("learn-step"), "Done");
    assert.equal(await B.ev("Learn.tutorialDone('boxes')"), true);
    await B.click("#learn-back");
    assert.equal(await B.screen(), "screen-learn-game");
});

test("a scenario: the position is loaded, a wrong move offers Retry, the right one marks it solved", async () => {
    await B.click("#btn-learn-back");
    await B.click("#learn-games .game-card[data-game=five]");
    const sc = JSON.parse(await B.ev("JSON.stringify(Learn.howto('five').scenarios[0])"));
    await B.click("#learn-scenarios .learn-scenario");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.ev("Match.mode"), "bot");
    assert.equal(await B.ev("FiveGame.state.history.length"), sc.history.length, "the position is on the board");
    assert.equal(await B.ev("FiveGame.state.current"), 0, "you are to move");
    assert.equal(await B.text("p1-name"), "Bot");
    assert.match(await B.text("learn-text"), new RegExp(sc.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(await B.text("learn-hint"), "Your move: find the best one.");

    // a legal move that is not one of the proven best ones
    const wrong = await B.ev(`FiveRules.legalMoves(FiveGame.state, 0).find(i => !${JSON.stringify(sc.best)}.includes(i))`);
    await cell(wrong);
    await B.waitFor("Learn.active.judged", { timeout: 10000, what: "the move judged" });
    assert.match(await B.text("learn-hint"), /^Not this one\./);
    assert.equal(await B.ev("Learn.isSolved('five', Learn.active.scenario.id)"), false);

    await B.click("#learn-retry");
    assert.equal(await B.ev("FiveGame.state.history.length"), sc.history.length, "Retry sets the position up again");
    assert.equal(await B.ev("Learn.active.judged"), false);
    assert.equal(await B.text("learn-hint"), "Your move: find the best one.");

    await cell(sc.best[0]);
    await B.waitFor("Learn.active.judged", { timeout: 10000, what: "the move judged" });
    assert.match(await B.text("learn-hint"), /^Right!/);
    assert.equal(await B.ev(`Learn.isSolved('five', ${JSON.stringify(sc.id)})`), true);

    await B.click("#learn-back");
    assert.equal(await B.screen(), "screen-learn-game");
    assert.equal(await B.text("learn-progress"), "1 / 8 solved");
    assert.equal(await B.ev("document.querySelector('#learn-scenarios .learn-scenario .gear-icon').textContent"), "✓");
    // the progress survives a reload
    await B.goto(server.url);
    await B.click("#btn-learn");
    await B.click("#learn-games .game-card[data-game=five]");
    assert.equal(await B.text("learn-progress"), "1 / 8 solved");
});

test("isolation: a tutorial step takes the two-step click as one expected move", async () => {
    await B.click("#btn-learn-game-back");
    assert.equal(await B.screen(), "screen-learn");
    assert.match(await B.ev("[...document.querySelectorAll('#learn-games .game-card')].map(c => c.dataset.game).join(',')"), /isolation/);
    await B.click("#learn-games .game-card[data-game=isolation]");
    assert.equal(await B.text("learn-title"), "Isolation");
    const steps = await B.ev("Learn.howto('isolation').tutorial.length");
    await B.click("#btn-learn-tutorial");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await stepNo(), `Step 1 / ${steps}`);
    const slab = (i) => B.ev(`document.querySelectorAll('#board > .slab')[${i}].click(); true`);
    const want = await B.ev("Learn.active.hints[0]");
    assert.ok(await B.ev(`document.querySelectorAll('#board > .slab')[${want}].classList.contains('hint')`), "the tile to step onto is highlighted");

    // a move here is two clicks: the first one only picks the step, nothing is played yet
    await slab(want);
    assert.equal(await B.ev("IsolationView.pending"), want, "the step is picked");
    assert.equal(await B.ev("IsolationGame.state.history.length"), 0, "nothing played");
    // the second click breaks a tile and submits the whole move, so the step goes on
    const gone = await B.ev("IsolationGame.state.cells.findIndex((c, i) => c === -1 && i !== IsolationView.pending)");
    await slab(gone);
    await B.idle();
    assert.equal(await B.ev("IsolationGame.state.history.length"), 1, "one move, both halves");
    assert.equal(await B.ev("IsolationGame.state.cells[" + gone + "]"), -2, "the tile is broken");
    await B.waitFor(`document.getElementById('learn-step').textContent === 'Step 2 / ${steps}'`, { what: "the step advanced" });

    // step 2 wants a tile next to the other pawn: anything else is refused, like a wrong cell
    const before = await B.ev("IsolationGame.state.history.length");
    const to = await B.ev("IsolationRules.steps(IsolationGame.state, 0)[0]");
    const bad = await B.ev("IsolationGame.state.cells.findIndex((c, i) => c === -1 && !Learn.active.hints.includes(i) && i !== IsolationRules.steps(IsolationGame.state, 0)[0])");
    await slab(to); await slab(bad);
    assert.equal(await B.ev("IsolationGame.state.history.length"), before, "the wrong move plays nothing");
    assert.equal(await B.text("learn-hint"), "Try the highlighted cell.");
    assert.equal(await stepNo(), `Step 2 / ${steps}`);
    // one of the highlighted tiles is taken
    const good = await B.ev("Learn.active.hints.find(i => i !== IsolationRules.steps(IsolationGame.state, 0)[0])");
    await slab(to); await slab(good);
    await B.idle();
    assert.equal(await B.ev("IsolationGame.state.history.length"), before + 1);
    await B.waitFor(`document.getElementById('learn-step').textContent === 'Step 3 / ${steps}'`, { what: "step 3" });
    await B.click("#learn-back");
    assert.equal(await B.screen(), "screen-learn-game");
    assert.deepEqual(B.errors, [], "no page exceptions");
});

test("the lobby's How to play modal opens and closes again when a game starts", async () => {
    await B.click("#btn-learn-game-back");
    await B.click("#btn-learn-back");
    assert.equal(await B.screen(), "screen-menu");
    await B.click("#btn-local");
    await B.selectGame("five");
    assert.equal(await B.ev("document.getElementById('btn-howto').hidden"), false);
    await B.click("#btn-howto");
    assert.equal(await B.ev("document.getElementById('howto-modal').hidden"), false);
    assert.equal(await B.text("howto-title"), "Five Wins");
    assert.ok(await B.ev("document.querySelectorAll('#howto-rules li').length >= 5"));
    assert.ok(await B.ev("document.querySelectorAll('#howto-steps li').length >= 3"), "the tutorial steps as text");
    await B.click("#btn-howto-done");
    assert.equal(await B.ev("document.getElementById('howto-modal').hidden"), true);
    await B.click("#btn-howto");
    await B.click("#btn-start");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.ev("document.getElementById('howto-modal').hidden"), true, "a starting game closes it");
    assert.equal(await B.ev("document.getElementById('learn-panel').hidden"), true, "no lesson panel in a normal game");
    await B.click("#btn-menu");
    await B.click("#btn-lobby-back");
});

test("phone 360×780: the Learn screens and a lesson never scroll", async () => {
    await B.emulate(360, 780);
    await B.click("#btn-learn");
    let s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "learn list");
    await B.click("#learn-games .game-card[data-game=five]");
    s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "five details");
    await B.click("#btn-learn-game-back");
    await B.click("#learn-games .game-card[data-game=chain]");
    s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "chain details");
    assert.ok(await B.ev("document.getElementById('btn-learn-game-back').getBoundingClientRect().bottom <= innerHeight"),
        "Back is reachable without scrolling the card (the two lists scroll instead)");
    await B.click("#btn-learn-tutorial");
    s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "the tutorial");
    assert.ok(await B.ev("document.getElementById('learn-panel').getBoundingClientRect().bottom <= innerHeight"), "the panel is on screen");
    await B.click("#learn-back");
    await B.emulate(1400, 900);
    assert.deepEqual(B.errors, [], "no page exceptions");
});
