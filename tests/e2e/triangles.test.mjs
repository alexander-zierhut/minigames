/* Triangles end to end: the picker card and the three settings rows, the board of pegs,
   bands and triangles, the two-click band (taking it back, the far end first), a claimed
   triangle in the HUD, a whole seeded game to its end with the overlay, the replay bar, a
   rematch, three on one device, a 360 × 780 phone (the lobby with five cards, the game, the
   result) and the bot stretching bands by itself. Moves go through the harness, which clicks
   the two pegs the view's `clicks` hook names. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.ev("Prefs.set({ name: 'Alex' })"); });
after(async () => { await B?.close(); await server?.close(); });

const count = (sel) => B.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const peg = (p) => B.ev(`document.querySelectorAll('#board > .peg')[${p}].click(); true`);
const pegClass = (p) => B.ev(`document.querySelectorAll('#board > .peg')[${p}].className`);
const pending = () => B.ev("TrianglesView.pending");
const band = (move) => B.ev(`JSON.stringify(TrianglesRules.decode(Match.engine.state, ${move}))`).then(JSON.parse);
// the tutorial's opening on n = 4: the left corner to the middle (pegs 15 and 18), an answer
// from the middle, the middle to the top right corner, a band that hands triangle 20 over,
// and the band over its third side
const FIRST = 573, OPENING = [702, 129, 345], CLAIM = 438;

test("lobby: the card, three dropdown rows of its own, the size in pegs per side and the summary", async () => {
    await B.click("#btn-local");
    assert.equal(await count(".game-card"), await B.ev("Games.keys().length"), "one picker card per registered game");
    assert.match(await B.ev("document.querySelector('.game-card[data-game=triangles]').textContent"), /Triangles/);
    await B.selectGame("triangles");
    assert.equal(await B.ev("document.querySelector('.game-card[data-game=triangles]').classList.contains('selected')"), true);
    assert.equal(await B.text("settings-summary"), "4 pegs per side · 21 tokens · no timer", "only what differs from the defaults, and the tokens");
    await B.click("#btn-settings");
    assert.equal(await B.text("size-label"), "Board size", "the shared row");
    assert.equal(await B.text("size-hint"), "(4–7)", "a 4-peg band needs 4 pegs per side");
    assert.deepEqual(JSON.parse(await B.ev("JSON.stringify([...document.querySelectorAll('#set-size option')].map(o => o.textContent))")),
        ["4 pegs per side", "5 pegs per side", "6 pegs per side", "Custom…"]);
    // its own rows: three dropdowns, every other game's rows hidden
    const rows = JSON.parse(await B.ev("JSON.stringify([...document.querySelectorAll('#game-settings .row')].filter(r => !r.hidden).map(r => r.id))"));
    assert.deepEqual(rows, ["row-band", "row-touch", "row-tokens"]);
    for (const id of ["set-band", "set-touch", "set-tokens"]) assert.equal(await B.ev(`document.getElementById('${id}').tagName`), "SELECT", `${id} is a dropdown`);
    assert.deepEqual(JSON.parse(await B.ev("JSON.stringify([...document.querySelectorAll('#set-band option')].map(o => [o.value, o.textContent]))")),
        [["3", "4 pegs"], ["2", "3 pegs"], ["0", "2 to 4 pegs"]]);
    assert.deepEqual(JSON.parse(await B.ev("JSON.stringify([...document.querySelectorAll('#set-tokens option')].map(o => o.textContent))")),
        ["Off", "10 tokens", "15 tokens", "21 tokens", "30 tokens", "Custom…"]);
    assert.equal(await B.ev("document.getElementById('set-touch').value"), "off", "bands go anywhere by default");
    // everything that differs shows in the summary, and Off writes no limit
    await B.setting("band", 2); await B.setting("touch", true); await B.setting("tokens", "off");
    assert.equal(await B.text("size-hint"), "(3–7)", "3-peg bands fit the smallest board");
    await B.click("#btn-settings-done");
    assert.equal(await B.text("settings-summary"), "4 pegs per side · 3-peg bands · no token limit · no timer · bands touch");
    assert.equal(await B.ev("JSON.stringify([Settings.read().band, Settings.read().touch, Settings.read().tokens])"), "[2,true,null]");
    await B.click("#btn-settings");
    await B.setting("tokens", 12);
    assert.equal(await B.ev("document.getElementById('set-tokens').value"), "custom", "a number that is no preset goes through Custom…");
    assert.equal(await B.ev("Settings.read().tokens"), 12);
    // back to the defaults for the games below
    await B.setting("band", 3); await B.setting("touch", false); await B.setting("tokens", 21); await B.setting("size", 4);
    await B.click("#btn-settings-done");
    assert.equal(await B.text("settings-summary"), "4 pegs per side · 21 tokens · no timer");
});

test("the board: 37 pegs, 90 bands and 54 triangles in a hexagon", async () => {
    await B.click("#btn-start");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.text("sign-title"), "TRIANGLES");
    assert.equal(await count("#board > .peg"), 37, "3m² + 3m + 1 pegs");
    assert.equal(await count("#board > .band"), 90, "9m² + 3m edges, the engine's cells");
    assert.equal(await count("#board > .tri"), 54, "6m² triangles");
    assert.equal(await count("#board > .tri.up") + await count("#board > .tri.down"), 54);
    assert.equal(await B.ev("document.getElementById('board').classList.contains('triangles')"), true);
    assert.equal(await count("#board > .band.can-place"), 90, "every edge lies on a legal first band");
    // the pegs sit on top: the last children of the board, after the bands
    assert.equal(await B.ev("document.getElementById('board').lastElementChild.classList.contains('peg')"), true);
    const b = JSON.parse(await B.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    const pegs = JSON.parse(await B.ev("JSON.stringify([...document.querySelectorAll('#board > .peg')].map(e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }))"));
    assert.ok(pegs.every(([x, y]) => x > b.left && x < b.right && y > b.top && y < b.bottom), "every peg on the board");
    assert.equal(new Set(pegs.map(([, y]) => Math.round(y))).size, 7, "seven rows of pegs");
    assert.equal(await B.text("p0-stat-0"), "0", "triangles in the HUD");
    assert.equal(await B.text("p0-stat-1"), "21", "tokens left");
    assert.equal(await B.text("game-stat-0"), "54", "triangles left");
});

test("the two-click band: pick a peg, take it back, then the far end first", async () => {
    const { a, b, len } = await band(FIRST);
    assert.deepEqual([a, b, len], [15, 18, 3], "the left corner to the middle");
    const start = (await B.state()).current;
    await peg(a);
    assert.equal(await pending(), a, "the first click picks the peg");
    assert.ok((await pegClass(a)).includes("pending"));
    assert.ok((await pegClass(b)).includes("target"), "the peg three steps away lights up");
    assert.ok(await count("#board > .peg.target") >= 2, "every peg a band can reach from it");
    assert.equal(await B.ev("document.getElementById('board').classList.contains('picking')"), true);
    assert.equal((await B.state()).history.length, 0, "nothing is played yet");
    // a peg that is no target and a band do nothing
    const off = await B.ev(`[...document.querySelectorAll('#board > .peg')].findIndex((e, i) => i !== ${a} && !e.classList.contains('target'))`);
    await peg(off);
    assert.equal(await pending(), a, "a peg out of reach keeps the pick");
    await B.ev("document.querySelectorAll('#board > .band')[0].click(); true");
    assert.equal(await pending(), a, "a band takes no clicks");
    // the same peg again takes it back
    await peg(a);
    assert.equal(await pending(), -1, "clicking it again takes the pick back");
    assert.equal(await count("#board > .peg.target"), 0);
    assert.equal(await count("#board > .peg.pending"), 0);
    assert.equal(await B.ev("document.getElementById('board').classList.contains('picking')"), false);
    // the far end first: the same band, one integer whatever the order
    await peg(b);
    assert.equal(await pending(), b);
    await peg(a);
    await B.idle();
    const st = await B.state();
    assert.equal(JSON.stringify(st.history), `[${FIRST}]`, "encoded as min * V + max");
    assert.equal(st.current, 1 - start, "the turn passes");
    assert.equal(await count("#board > .band.taken"), 3, "three edges covered");
    assert.equal(await count(`#board > .band.p${start}`), 3, "in the mover's colour");
    assert.equal(await count("#board > .band.last"), 3, "the last-move marker runs along the whole band");
    assert.equal(await count("#board > .peg.used"), 4, "four pegs carry the band");
    assert.equal(await pending(), -1);
    assert.equal(await B.text(`p${start}-stat-1`), "21", "no token placed yet");
});

test("closing a triangle: the token goes on it, the HUD counts it and the turn passes", async () => {
    for (const m of OPENING) await B.move(m);
    assert.equal(await count("#board > .tri.taken"), 0, "nothing claimed yet");
    const mover = (await B.state()).current;
    assert.equal(mover, await B.ev("Match.engine.config.startPlayer"), "four bands in: the first seat is to move again");
    const before = await B.text("game-stat-1");
    assert.ok(Number(before) >= 1, `a triangle is on the table (${before})`);
    await B.move(CLAIM);
    const st = await B.state();
    assert.equal(st.tris[20], mover, "the triangle belongs to whoever closed it");
    assert.equal(st.scores[mover], 1);
    assert.equal(st.current, 1 - mover, "no extra turn for claiming");
    assert.equal(await count("#board > .tri.taken"), 1);
    assert.equal(await B.ev(`document.querySelectorAll('#board > .tri')[20].classList.contains('p${mover}')`), true);
    assert.equal(await B.text(`p${mover}-stat-0`), "1", "triangles in the HUD");
    assert.equal(await B.text(`p${mover}-stat-1`), "20", "one token less to place");
    assert.equal(await B.text(`p${mover}-pct`), "1 / 21");
    assert.match(await B.text("mini-line2"), /^triangles \d+ · \d+$/);
    assert.equal(await B.text("game-stat-0"), "53", "triangles left");
    assert.equal(await B.ev("document.getElementById('game-box').classList.contains('hot')"), Number(await B.text("game-stat-1")) > 0, "the box is hot while something is on the table");
});

test("a whole seeded game runs to its end and shows the result", async () => {
    const r = await B.randomGame(400, 20261017);
    assert.equal(r.over, true, `the game finishes (${r.moves} moves)`);
    const st = await B.state();
    // 4 pegs per side with 4-peg bands: every edge lies on a band, so bands only run out once
    // all 54 triangles are claimed, and one of two seats reaches 21 first. This game always
    // ends on the tokens; the count and the tie are rendered in the three-seat test below.
    assert.equal(st.finishWhy.k, "why.triangles.all");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    assert.ok(st.scores[st.winner] >= 21, "the winner placed every token");
    assert.match(await B.text("overlay-sub"), /^All tokens placed!/);
    assert.match(await B.text("overlay-title"), /wins!$/);
    assert.match(await B.text("overlay-sub"), /\d+ of 54 triangles$/);
    assert.equal(await B.ev("document.getElementById('board').classList.contains('over')"), true);
    assert.equal(await count("#board > .band.can-place"), 0, "nothing playable once it is over");
    assert.deepEqual(B.errors, []);
});

test("replay bar: stepping back and forward moves the bands and the triangles with it", async () => {
    await B.click("#overlay-look");
    const st = await B.state();
    const moves = st.history.length;
    assert.equal(await B.text("replay-pos"), `Move ${moves} / ${moves}`);
    await B.click("#replay-first");
    assert.equal(await B.text("replay-pos"), `Move 0 / ${moves}`);
    assert.equal(await B.ev("Match.engine.previewPly"), 0);
    assert.equal(await count("#board > .band.taken"), 0, "an empty board again");
    assert.equal(await count("#board > .tri.taken"), 0);
    assert.equal(await count("#board > .peg.used"), 0);
    assert.equal(await count("#board > .band.locked"), 90, "a preview is never playable");
    await peg(15);
    assert.equal(await pending(), -1, "a peg click in a preview picks nothing");
    for (let k = 0; k < 6; k++) await B.click("#replay-next");
    assert.equal(await B.text("replay-pos"), `Move 6 / ${moves}`);
    const covered = await B.ev("Games.positionAt(Match.record(), 6).cells.filter(c => c >= 0).length");
    assert.equal(await count("#board > .band.taken"), covered, "the bands of the first six moves");
    await B.click("#replay-last");
    assert.equal(await B.ev("Match.engine.previewPly"), null, "the last move is the live position");
    assert.equal(await count("#board > .tri.taken"), st.tris.filter((t) => t >= 0).length);
    assert.equal((await B.state()).history.length, moves, "the finished game is untouched");
    await B.click("#result-fab");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
});

test("rematch starts a fresh board with the other player to start", async () => {
    const first = await B.ev("Match.engine.config.startPlayer");
    await B.click("#overlay-again");
    const st = await B.state();
    assert.equal(st.history.length, 0);
    assert.equal(JSON.stringify(st.scores), "[0,0]");
    assert.equal(st.current, 1 - first, "the starter alternates");
    assert.equal(await count("#board > .band.taken"), 0);
    assert.equal(await count("#board > .tri.taken"), 0);
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), true);
    await B.click("#btn-menu");
    assert.equal(await B.screen(), "screen-lobby");
});

test("three on one device: the turn runs over three seats until no band is left", async () => {
    await B.players(3);
    await B.click("#btn-settings");
    await B.setting("band", 2); await B.setting("tokens", "off"); await B.setting("size", 3);
    await B.click("#btn-settings-done");
    assert.equal(await B.text("settings-summary"), "3 pegs per side · 3 players · 3-peg bands · no token limit · no timer");
    await B.click("#btn-start");
    assert.equal(await count("#players .player"), 3);
    assert.equal(await count("#board > .peg"), 19);
    assert.equal(await count("#board > .tri"), 24);
    assert.equal(await B.ev("document.getElementById('p0-win-row').hidden"), true, "no win chance with three players");
    assert.equal(await B.text("p0-stat-1"), "0", "bands stretched instead of tokens left");
    const start = (await B.state()).current;
    for (let k = 1; k <= 3; k++) {
        const legal = JSON.parse(await B.ev("JSON.stringify(TrianglesRules.legalMoves(Match.engine.state))"));
        await B.move(legal[0]);
        assert.equal((await B.state()).current, (start + k) % 3, `seat ${(start + k) % 3} is next`);
    }
    const r = await B.randomGame(200, 7);
    assert.equal(r.over, true);
    const st = await B.state();
    assert.ok(["why.triangles.most", "why.triangles.tied"].includes(st.finishWhy.k), "without a token limit the game runs until no band is left");
    assert.equal(st.scores.reduce((a, b) => a + b, 0) <= 24, true);
    const sub = await B.text("overlay-sub");
    if (st.finishWhy.k === "why.triangles.tied") assert.match(sub, /^Tied!/);
    else assert.match(sub, new RegExp(`^${Math.max(...st.scores)} triangles?!`), "the count that won, as the overlay says it");
    assert.match(await B.text("overlay-title"), st.winner < 0 ? /^Draw!$/ : /wins!$/);
    assert.match(sub, /\d+ of 24 triangles$/);
    await B.click("#overlay-menu");
    await B.players(2);
    await B.click("#btn-settings");
    await B.setting("band", 3); await B.setting("tokens", 21); await B.setting("size", 4);
    await B.click("#btn-settings-done");
});

test("phone: the lobby with five cards, the board and the result fit 360 × 780 without scrolling", async () => {
    await B.emulate(360, 780);
    await B.ev("window.dispatchEvent(new Event('resize'))");
    assert.equal(await B.screen(), "screen-lobby");
    let s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "the local lobby with five game cards");
    assert.ok(await B.ev("[...document.querySelectorAll('#screen-lobby .game-name')].every(e => e.scrollWidth <= e.clientWidth + 1)"), "every game name whole");
    await B.screenshot("triangles-phone-lobby.png");
    await B.click("#btn-settings"); await B.setting("size", 6); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    await B.ev("window.dispatchEvent(new Event('resize'))");
    await B.waitFor("document.getElementById('board').getBoundingClientRect().width <= 352", { what: "board fitted to the phone" });
    s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "the game");
    const b = JSON.parse(await B.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    assert.ok(b.left >= 4 && b.right <= 356, `board leaves room for the turn outline (${b.left}..${b.right})`);
    // a peg is easy to hit: the element is the tap area (the stud is its ::before), at least 28 px across
    const hit = JSON.parse(await B.ev("JSON.stringify((() => { const r = document.querySelector('#board > .peg').getBoundingClientRect(); return { w: r.width, h: r.height }; })())"));
    assert.ok(hit.w >= 28 && hit.h >= 28, `a peg's tap area (${JSON.stringify(hit)})`);
    const legal = JSON.parse(await B.ev("JSON.stringify(TrianglesRules.legalMoves(Match.engine.state))"));
    const { a } = await band(legal[0]);
    await peg(a);
    assert.equal(await pending(), a);
    assert.ok((await B.noScroll()).y, "no scrolling with a peg picked");
    await B.screenshot("triangles-phone.png");
    await peg(a);
    const r = await B.randomGame(400, 360);
    assert.equal(r.over, true);
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "the result overlay");
    await B.screenshot("triangles-phone-result.png");
    await B.click("#overlay-menu");
    // the biggest board (Custom… 7): the pegs sit 25 px apart and still get a 28 px tap area
    await B.click("#btn-settings"); await B.setting("size", 7); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    await B.ev("window.dispatchEvent(new Event('resize'))");
    await B.waitFor("document.querySelectorAll('#board > .peg').length === 127 && document.getElementById('board').getBoundingClientRect().width <= 352", { what: "the 7-peg board fitted to the phone" });
    s = await B.noScroll();
    assert.deepEqual(s, { x: true, y: true, screen: true }, "the game on 7 pegs per side");
    const pegs7 = JSON.parse(await B.ev(`JSON.stringify((() => {
        const b = document.getElementById('board').getBoundingClientRect();
        const r = [...document.querySelectorAll('#board > .peg')].map((e) => e.getBoundingClientRect());
        const cx = r.map((x) => x.left + x.width / 2);
        return { min: Math.min(...r.map((x) => Math.min(x.width, x.height))), inside: cx.every((x) => x >= b.left && x <= b.right) };
    })())`));
    assert.ok(pegs7.min >= 28, `a peg's tap area on 7 pegs per side (${pegs7.min} px)`);
    assert.ok(pegs7.inside, "every peg on the board");
    await B.click("#btn-menu");
    await B.click("#btn-settings"); await B.setting("size", 4); await B.click("#btn-settings-done");
    await B.emulate(1400, 900);
});

test("against a bot: Bot stretches bands by itself", async () => {
    await B.click("#btn-lobby-back");
    await B.click("#btn-bot");
    await B.selectGame("triangles");
    assert.match(await B.text("btn-opponent"), /Bot/);
    await B.click("#btn-start");
    assert.equal(await B.text("p1-name"), "Bot");
    assert.equal(await B.text("p0-name"), "Alex");
    const mine = () => B.waitFor("!Match.engine.state.busy && (Match.engine.state.current === 0 || Match.engine.state.over)", { timeout: 30000, what: "my turn or the end" });
    // the cursor over a peg that starts a band, read in one go with whose turn it is
    const cursor = () => B.ev(`(() => {
        const s = Match.engine.state, peg = document.querySelector('#board > .peg:not(.dead)');
        return (s.busy ? "busy" : s.current) + ":" + (peg ? getComputedStyle(peg).cursor : "none");
    })()`);
    const cursors = new Set();
    for (let k = 0; k < 6; k++) {
        await mine();
        const st = await B.state();
        if (st.over) break;
        assert.equal(st.movesBy[1], k, "the bot answered every band");
        cursors.add(await cursor());
        const legal = JSON.parse(await B.ev("JSON.stringify(TrianglesRules.legalMoves(Match.engine.state))"));
        await B.move(legal[0]);
        cursors.add(await cursor());
    }
    assert.ok(cursors.has("0:pointer"), `a pointer on my turn (${[...cursors]})`);
    assert.ok(![...cursors].some((c) => /^(1|busy):pointer$/.test(c)), `no pointer while the bot thinks or a band animates (${[...cursors]})`);
    assert.ok(cursors.has("1:not-allowed"), `not-allowed while the bot thinks (${[...cursors]})`);
    await mine();
    const st = await B.state();
    assert.ok(st.movesBy[1] >= 5, `the bot stretched bands (${st.movesBy[1]})`);
    assert.equal(st.history.length, st.movesBy[0] + st.movesBy[1]);
    assert.ok(st.cells.some((c) => c === 1), "its bands are on the board in its colour");
    assert.deepEqual(B.errors, [], "no page errors");
    assert.deepEqual(B.failedRequests, [], "no failed requests");
});
