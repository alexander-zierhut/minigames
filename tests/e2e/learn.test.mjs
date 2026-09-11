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
    const total = await B.ev("Learn.howto('chain').scenarios.length");
    assert.ok(total >= 20, "the ladder is more than a handful of positions (#44)");
    assert.equal(await B.ev("document.querySelector('#learn-games .game-card .game-players').textContent"), `0 / ${total} scenarios`);
});

test("a game's details page shows the rules, the tutorial and the scenarios", async () => {
    await B.click("#learn-games .game-card[data-game=chain]");
    assert.equal(await B.screen(), "screen-learn-game");
    assert.equal(await B.text("learn-title"), "Chain React");
    assert.ok(await B.ev("document.querySelectorAll('#learn-rules li').length >= 5"), "rule bullets");
    assert.equal(await B.ev("document.getElementById('btn-learn-tutorial').hidden"), false);
    const rows = await B.ev("document.querySelectorAll('#learn-scenarios .learn-scenario').length");
    assert.equal(rows, await B.ev("Learn.howto('chain').scenarios.length"));
    assert.equal(await B.text("learn-progress"), `0 / ${rows} solved`);
    // the ladder: one header per tier with its own progress, a lock hint on the later ones (#44)
    const heads = await B.ev("[...document.querySelectorAll('#learn-scenarios .learn-tier')].map(h => h.querySelector('b').textContent).join(',')");
    assert.equal(heads, "Basics,Tactics,Mastery");
    assert.equal(await B.ev("document.querySelector('#learn-scenarios .learn-tier .learn-tier-count').textContent"),
        `0 / ${await B.ev("Learn.tierProgress('chain', 'basics').total")}`);
    assert.equal(await B.ev("document.querySelectorAll('#learn-scenarios .learn-tier.locked').length"), 2, "Tactics and Mastery wait");
    assert.equal(await B.ev("document.querySelectorAll('#learn-scenarios .learn-lock').length"), 0, "no note about solving the tier before");
    assert.equal(await B.ev("document.querySelector('#learn-scenarios .learn-scenario .learn-dots').textContent.length"), 5, "difficulty dots");
    // the tiers are folded until the tutorial is done; a header opens its tier
    assert.ok(await B.ev("[...document.querySelectorAll('#learn-scenarios .learn-scenario')].every(r => r.hidden)"), "every tier collapsed before the tutorial");
    await B.click("#learn-scenarios .learn-tier[data-tier='basics']");
    assert.equal(await B.ev("document.querySelectorAll('#learn-scenarios .learn-scenario:not([hidden])').length"), await B.ev("Learn.tierProgress('chain', 'basics').total"), "Basics opened");
    await B.click("#learn-scenarios .learn-tier[data-tier='basics']");
    assert.ok(await B.ev("[...document.querySelectorAll('#learn-scenarios .learn-scenario')].every(r => r.hidden)"), "and folded again");
    // the details page scrolls as a whole (#43), never sideways and never in inner boxes
    const fit = await B.noScroll();
    assert.equal(fit.x, true, "the details page never scrolls sideways");
    assert.ok(await B.ev("['learn-rules', 'learn-scenarios'].every(id => { const e = document.getElementById(id); return e.scrollHeight <= e.clientHeight + 1; })"),
        "the rules and the scenarios are shown whole");
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

    // the explanation folds away so the whole board can be seen, and stays folded (#43)
    assert.equal(await B.ev("document.getElementById('learn-hide').hidden"), false, "a scenario can be folded away");
    assert.equal(await B.text("learn-hide"), "Hide");
    await B.click("#learn-hide");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('learn-text')).display"), "none", "the explanation is gone");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('learn-hint')).display") !== "none", true, "the one hint line stays");
    assert.equal(await B.text("learn-hide"), "Show");
    await B.click("#learn-hide");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('learn-text')).display") !== "none", true, "Show brings it back");
    await B.click("#learn-hide");                       // fold it again: the choice is remembered

    await B.click("#learn-retry");
    assert.equal(await B.ev("Learn.folded"), true, "still folded after Retry");
    assert.equal(await B.text("learn-hide"), "Show");
    await B.click("#learn-hide");
    assert.equal(await B.ev("FiveGame.state.history.length"), sc.history.length, "Retry sets the position up again");
    assert.equal(await B.ev("Learn.active.judged"), false);
    assert.equal(await B.text("learn-hint"), "Your move: find the best one.");

    await cell(sc.best[0]);
    await B.waitFor("Learn.active.judged", { timeout: 10000, what: "the move judged" });
    assert.match(await B.text("learn-hint"), /^Right!/);
    assert.equal(await B.ev(`Learn.isSolved('five', ${JSON.stringify(sc.id)})`), true);

    await B.click("#learn-back");
    assert.equal(await B.screen(), "screen-learn-game");
    assert.match(await B.text("learn-progress"), /^1 \/ \d+ solved$/);
    assert.equal(await B.ev("document.querySelector('#learn-scenarios .learn-scenario .gear-icon').dataset.icon"), "check", "the solved mark");
    // the progress survives a reload
    await B.goto(server.url);
    await B.click("#btn-learn");
    await B.click("#learn-games .game-card[data-game=five]");
    assert.match(await B.text("learn-progress"), /^1 \/ \d+ solved$/);
});

test("a trap scenario: the greedy move is refused, the proven one solves it (#44)", async () => {
    // the greedy move is the one the game's own heuristic likes best: exactly what the trap punishes
    const sc = JSON.parse(await B.ev(`JSON.stringify(Learn.howto('five').scenarios.find(s => s.kind === 'trap'))`));
    assert.ok(sc, "the five ladder has a trap");
    await B.click(`#learn-scenarios .learn-scenario[data-scenario="${sc.id}"]`);
    assert.equal(await B.screen(), "screen-game");
    assert.match(await B.text("learn-kind"), /Trap$/, "the panel names tier and kind");
    assert.equal((await B.text("learn-step")).length, 5, "and shows the difficulty as dots");
    assert.match(await B.text("learn-text"), /obvious move loses/);

    const greedy = await B.ev(`(() => {
        const s = FiveGame.state, best = [];
        let top = -Infinity, move = -1;
        for (const i of FiveRules.legalMoves(s, 0)) {
            const c = Rules.replay({ game: 'five', config: Match.config, history: [...s.history, i], outs: [] });
            const e = FiveRules.estimate(c);
            if (e > top + 1e-9) { top = e; move = i; }
        }
        return move;
    })()`);
    assert.ok(!sc.best.includes(greedy), "the greedy move really is not one of the proven ones");
    await cell(greedy);
    await B.waitFor("Learn.active.judged", { timeout: 10000, what: "the greedy move judged" });
    assert.match(await B.text("learn-hint"), /^Not this one\./);
    assert.equal(await B.ev(`Learn.isSolved('five', ${JSON.stringify(sc.id)})`), false);

    await B.click("#learn-retry");
    await cell(sc.best[0]);
    await B.waitFor("Learn.active.judged", { timeout: 10000, what: "the proven move judged" });
    assert.match(await B.text("learn-hint"), /^Right!/);
    assert.equal(await B.ev(`Learn.isSolved('five', ${JSON.stringify(sc.id)})`), true);
    await B.click("#learn-back");
});

test("a play-from-here scenario: win the game, and the overlay offers Retry or the next one (#44)", async () => {
    const sc = JSON.parse(await B.ev(`JSON.stringify(Learn.howto('five').scenarios.find(s => s.kind === 'play-from-here'))`));
    assert.ok(sc, "the five ladder ends its tiers with a game to play out");
    await B.click(`#learn-scenarios .learn-scenario[data-scenario="${sc.id}"]`);
    assert.equal(await B.screen(), "screen-game");
    assert.match(await B.text("learn-kind"), /Play from here$/);
    assert.equal(await B.text("learn-hint"), "You must win this one. A draw is not enough.", "the goal is explained up front");
    assert.equal(await B.ev("Match.bot.difficulty"), sc.level, "played out against the level its tier asks for");
    assert.equal(await B.ev("Learn.active.judged"), false);

    // a single move settles nothing here: only the end of the game counts
    const first = await B.ev("FiveRules.legalMoves(FiveGame.state, 0)[0]");
    await cell(first);
    await B.idle();
    assert.equal(await B.ev("Learn.active.judged"), false, "no move is judged in a play-from-here scenario");

    // losing it: the overlay offers Retry
    await B.ev("FiveGame.finish(1, 'Bot line.'); true");
    assert.match(await B.text("learn-hint"), /^The bot held/);
    assert.equal(await B.ev(`Learn.isSolved('five', ${JSON.stringify(sc.id)})`), false);
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    assert.equal(await B.text("overlay-again"), "Retry");

    await B.click("#overlay-again");
    assert.equal(await B.ev("FiveGame.state.history.length"), sc.history.length, "Retry sets the position up again");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), true);

    // winning it: solved, and the overlay leads on to the next scenario
    await B.ev("FiveGame.finish(0, 'Five in a row!'); true");
    assert.match(await B.text("learn-hint"), /^You won it/);
    assert.equal(await B.ev(`Learn.isSolved('five', ${JSON.stringify(sc.id)})`), true);
    assert.equal(await B.text("overlay-again"), "Next scenario");
    await B.click("#overlay-again");
    assert.equal(await B.ev("Learn.active.scenario.id"), await B.ev(`Learn.nextScenario('five', ${JSON.stringify(sc.id)}).id`));
    await B.click("#learn-back");
    assert.equal(await B.screen(), "screen-learn-game");
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

test("phone 360×780: the Learn list and a lesson never scroll, the details page scrolls as a whole", async () => {
    await B.emulate(360, 780);
    await B.click("#btn-learn");
    let s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "learn list");
    // the details page is the one screen that scrolls as a whole (#43): the lists inside
    // it stay whole, the page never scrolls sideways and everything is reachable
    for (const game of JSON.parse(await B.ev("JSON.stringify(Learn.games())"))) {
        if (await B.screen() === "screen-learn-game") await B.click("#btn-learn-game-back");
        await B.click(`#learn-games .game-card[data-game=${game}]`);
        s = await B.noScroll();
        assert.equal(s.x, true, `${game} details: no sideways scrolling`);
        assert.equal(s.y, true, `${game} details: the page itself does not scroll`);
        assert.ok(await B.ev("['learn-rules', 'learn-scenarios'].every(id => { const e = document.getElementById(id); return e.scrollHeight <= e.clientHeight + 1; })"),
            `${game} details: the rules and the scenarios are not boxes that scroll`);
        assert.ok(await B.ev("document.querySelector('#screen-learn-game .menu-card').getBoundingClientRect().top >= 50"),
            `${game} details: the card starts below the ⚙ button`);
        // the bottom is reachable by scrolling the screen
        await B.ev("(() => { const s = document.getElementById('screen-learn-game'); s.scrollTop = s.scrollHeight; return true; })()");
        assert.ok(await B.ev("document.getElementById('btn-learn-game-back').getBoundingClientRect().bottom <= innerHeight + 1"),
            `${game} details: Back is reachable at the bottom of the page`);
    }
    await B.screenshot("mobile-learn-game.png");

    /* A longer step text must not push the board around (#43): the board keeps its rect
       from step to step. Played for every game that has a tutorial, whatever a move of it
       looks like: `cellOf` says which cell to click first, and a game whose move encodes
       two clicks (Isolation) takes the second half of the pair as the second one. */
    const boardRect = () => B.ev("JSON.stringify((r => ({ left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }))(document.getElementById('board').getBoundingClientRect()))");
    async function stepOn() {
        const at = await B.ev("Learn.active.i");
        const move = await B.ev("(Learn.active.steps[Learn.active.i].expect || [])[0] ?? -1");
        if (move < 0) { await B.click("#learn-next"); return; }
        const first = await B.ev(`Match.engine.cellOf(${move})`);
        await cell(first);
        if (first !== move) await cell(move % (await B.ev("Match.state.cells.length")));
        await B.waitFor(`Learn.active.i !== ${at}`, { timeout: 60000, what: "the next step" });
    }
    for (const game of JSON.parse(await B.ev("JSON.stringify(Learn.games().filter(k => Learn.howto(k).tutorial.length >= 3))"))) {
        if (await B.screen() === "screen-learn-game") await B.click("#btn-learn-game-back");
        await B.click(`#learn-games .game-card[data-game=${game}]`);
        await B.click("#btn-learn-tutorial");
        s = await B.noScroll();
        assert.deepEqual(s, { x: true, y: true, screen: true }, `${game}: the tutorial`);
        assert.ok(await B.ev("document.getElementById('learn-panel').getBoundingClientRect().bottom <= innerHeight"), `${game}: the panel is on screen`);
        assert.equal(await B.ev("document.getElementById('learn-hide').hidden"), true, `${game}: a tutorial has nothing to fold away`);
        const rect = await boardRect();
        await B.screenshot(`mobile-learn-${game}-step1.png`);
        for (let k = 0; k < 2; k++) {
            await stepOn();
            await B.idle();
            assert.equal(await boardRect(), rect, `${game}: the board did not move at step ${await B.ev("Learn.active.i + 1")}`);
            await B.screenshot(`mobile-learn-${game}-step${k + 2}.png`);
        }
        await B.click("#learn-back");
    }
    await B.click("#btn-learn-game-back");
    await B.emulate(1400, 900);
    assert.deepEqual(B.errors, [], "no page exceptions");
});
