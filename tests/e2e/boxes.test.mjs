/* Käsekästchen end to end: the lobby picks it, the board is dots / lines / boxes, closing a
   box keeps the turn, a whole seeded game ends with the overlay, rematch, the replay bar,
   three on one device, and a game against the bot. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); await B.ev("Prefs.set({ name: 'Alex' })"); });
after(async () => { await B?.close(); await server?.close(); });

// 3 × 3 lines: h(r, c) = r * 3 + c (0…11), v(r, c) = 12 + r * 4 + c (12…23); box 0 = 0, 3, 12, 13
const edges = () => B.ev("document.querySelectorAll('#board > .edge').length");

test("lobby: its own game card, size label and summary", async () => {
    await B.click("#btn-local");
    assert.equal(await B.ev("document.querySelectorAll('.game-card').length"), await B.ev("Games.keys().length"), "one picker card per registered game");
    await B.selectGame("boxes");
    assert.equal(await B.ev("document.querySelector('.game-card[data-game=boxes]').classList.contains('selected')"), true);
    assert.match(await B.text("menu-tagline"), /^Draw a line between two dots/);
    await B.click("#btn-settings");
    assert.equal(await B.text("size-label"), "Boxes per side");
    assert.equal(await B.text("size-hint"), "(2–10)");
    assert.equal(await B.ev("document.getElementById('game-settings').children.length ? [...document.querySelectorAll('#game-settings .row')].filter(r => !r.hidden).length : 0"), 0, "no rows of its own");
    await B.set("set-size", 3);
    await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /^3 × 3 · 9 boxes · no timer$/);
});

test("the board: dots, boxes and one line per move; drawing a line colours it", async () => {
    await B.click("#btn-start");
    assert.equal(await B.screen(), "screen-game");
    assert.equal(await B.text("sign-title"), "KÄSEKÄSTCHEN");
    assert.equal(await edges(), 24, "2n(n+1) lines");
    assert.equal(await B.ev("document.querySelectorAll('#board > .box').length"), 9);
    assert.equal(await B.ev("document.querySelectorAll('#board > .dot').length"), 16);
    assert.equal(await B.ev("getComputedStyle(document.getElementById('board')).display"), "grid");
    const start = (await B.state()).current;
    await B.move(0);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge')[0].classList.contains('taken')"), true);
    assert.equal(await B.ev(`document.querySelectorAll('#board > .edge')[0].classList.contains('p${start}')`), true);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.last').length"), 1);
    assert.equal((await B.state()).current, 1 - start, "a plain line passes the turn");
});

test("closing a box: it is yours, you go again, and the turn box stays on you", async () => {
    // box 0 needs lines 0 (drawn), 3, 12 and 13
    const st0 = await B.state();
    const mover = st0.current;
    await B.move(3); await B.move(12);                       // the other two sides, alternating
    const st = await B.state();
    assert.equal(st.current, mover, "back to the same player after two more lines");
    await B.move(13);                                        // closes box 0
    const after = await B.state();
    assert.equal(after.boxes[0], mover, "the box belongs to whoever closed it");
    assert.equal(after.scores[mover], 1);
    assert.equal(after.current, mover, "and that player draws again");
    assert.equal(await B.ev("document.getElementById('turn-box').className"), `turn-box p${mover}`);
    assert.equal(await B.ev("document.getElementById('board').classList.contains('turn-p" + mover + "')"), true);
    assert.equal(await B.ev("document.querySelectorAll('#board > .box.taken').length"), 1);
    assert.equal(await B.ev(`document.querySelectorAll('#board > .box')[0].classList.contains('p${mover}')`), true);
    assert.equal(await B.text(`p${mover}-stat-0`), "1", "boxes in the HUD");
    assert.match(await B.text("mini-line2"), /^boxes \d+ · \d+$/);
    assert.equal(await B.text("game-stat-0"), "8", "boxes left in the game box");
});

test("a whole seeded game runs to the last line and shows the result", async () => {
    const r = await B.randomGame(400, 20260910);
    assert.equal(r.over, true);
    const st = await B.state();
    assert.equal(st.history.length, 24, "every line drawn");
    assert.equal(st.scores[0] + st.scores[1], 9);
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
    if (st.winner < 0) {
        assert.equal(await B.text("overlay-title"), "Draw!");
        assert.match(await B.text("overlay-sub"), /^Tied!/);
    } else {
        assert.match(await B.text("overlay-title"), /wins!$/);
        assert.match(await B.text("overlay-sub"), /^\d+ boxes!/);
    }
    assert.match(await B.text("overlay-sub"), /\d+ of 9 boxes$/);
    assert.equal(await B.ev("document.getElementById('board').classList.contains('over')"), true);
    assert.deepEqual(B.errors, []);
});

test("replay bar: stepping back and forward moves the lines and the boxes with it", async () => {
    await B.click("#overlay-look");
    const moves = (await B.state()).history.length;
    assert.equal(await B.text("replay-pos"), `Move ${moves} / ${moves}`);
    await B.click("#replay-first");
    assert.equal(await B.text("replay-pos"), `Move 0 / ${moves}`);
    assert.equal(await B.ev("BoxesGame.previewPly"), 0);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.taken').length"), 0, "an empty board again");
    assert.equal(await B.ev("document.querySelectorAll('#board > .box.taken').length"), 0);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.locked').length"), 24, "a preview is never playable");
    for (let k = 0; k < 6; k++) await B.click("#replay-next");
    assert.equal(await B.text("replay-pos"), `Move 6 / ${moves}`);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.taken').length"), 6);
    await B.click("#replay-last");
    assert.equal(await B.ev("BoxesGame.previewPly"), null, "the last move is the live position");
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.taken').length"), 24);
    await B.click("#result-fab");
    assert.equal(await B.ev("document.getElementById('overlay').hidden"), false);
});

test("rematch starts a fresh board with the next player to start", async () => {
    const before = (await B.state()).history.length;
    await B.click("#overlay-again");
    const st = await B.state();
    assert.equal(st.history.length, 0);
    assert.equal(st.scores[0], 0); assert.equal(st.scores[1], 0);
    assert.ok(before > 0);
    assert.equal(await B.ev("document.querySelectorAll('#board > .edge.taken').length"), 0);
    assert.equal(await B.ev("document.getElementById('replay-bar').hidden"), true);
    await B.click("#btn-menu");
    assert.equal(await B.screen(), "screen-lobby");
});

test("three on one device: the rotation runs over three seats and a closed box still gives another turn", async () => {
    await B.players(3);
    await B.click("#btn-settings"); await B.set("set-size", 2); await B.click("#btn-settings-done");
    assert.match(await B.text("settings-summary"), /^2 × 2 · 3 players · 4 boxes · no timer$/);
    await B.click("#btn-start");
    assert.equal(await B.ev("document.querySelectorAll('#players .player').length"), 3);
    assert.equal(await B.ev("document.getElementById('p0-win-row').hidden"), true, "no win chance with three players");
    const start = (await B.state()).current;
    await B.move(0);
    assert.equal((await B.state()).current, (start + 1) % 3);
    await B.move(1);
    assert.equal((await B.state()).current, (start + 2) % 3);
    // 2 × 2: box 0 = lines 0, 2, 6, 7 (line 0 is already drawn)
    await B.move(2); await B.move(6);
    const mover = (await B.state()).current;
    await B.move(7);
    const st = await B.state();
    assert.equal(st.boxes[0], mover);
    assert.equal(st.current, mover, "the seat that closed it goes again");
    await B.click("#btn-menu");
    await B.players(2);
});

test("phone: the board and the HUD fit 360 × 780 without scrolling", async () => {
    await B.emulate(360, 780);
    await B.click("#btn-settings"); await B.set("set-size", 5); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    // the viewport changed while the game screen was hidden: nudge the layout the way a real
    // rotation would, then wait until the board has been fitted to the phone
    await B.ev("window.dispatchEvent(new Event('resize'))");
    await B.waitFor("document.getElementById('board').getBoundingClientRect().width <= 352", { what: "board fitted to the phone" });
    const s = await B.noScroll();
    assert.ok(s.x && s.y && s.screen, `no scrolling ${JSON.stringify(s)}`);
    const b = JSON.parse(await B.ev("JSON.stringify(document.getElementById('board').getBoundingClientRect())"));
    assert.ok(b.left >= 4 && b.right <= 356, `board leaves room for the turn outline (${b.left}..${b.right})`);
    // the lines are wide enough to hit on a phone: the hit area reaches into the boxes
    const hit = JSON.parse(await B.ev("JSON.stringify((() => { const e = document.querySelectorAll('#board > .edge')[0]; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e, '::before'); return { h: Math.round(r.height), w: Math.round(r.width), top: cs.top }; })())"));
    assert.ok(hit.w > hit.h * 2, `a horizontal line is a bar (${JSON.stringify(hit)})`);
    await B.screenshot("boxes-phone.png");
    await B.move(0);
    assert.ok((await B.noScroll()).y, "still no scrolling after a move");
    await B.click("#btn-menu");
    await B.emulate(1400, 900);
});

test("against a bot: it draws lines by itself and closes boxes", async () => {
    await B.click("#btn-lobby-back");
    await B.click("#btn-bot");
    await B.selectGame("boxes");
    assert.match(await B.text("opponent-summary"), /^Bot · Normal · 100 % vs Random · [\d.]+ % puzzles$/);
    await B.click("#btn-settings"); await B.set("set-size", 3); await B.click("#btn-settings-done");
    await B.click("#btn-start");
    assert.equal(await B.text("p1-name"), "Bot");
    assert.equal(await B.text("p0-name"), "Alex");
    const mine = async () => B.waitFor("!Match.engine.state.busy && (Match.engine.state.current === 0 || Match.engine.state.over)", { timeout: 30000, what: "my turn or the end" });
    for (let k = 0; k < 40; k++) {
        await mine();
        const st = await B.state();
        if (st.over) break;
        const legal = JSON.parse(await B.ev("JSON.stringify(Rules.of('boxes').legalMoves(Match.engine.state, 0))"));
        await B.cell(legal[0]);
        await B.idle();
    }
    const st = await B.state();
    assert.ok(st.movesBy[1] > 0, "the bot drew lines");
    assert.ok(st.scores[1] > 0, "and closed boxes");
    assert.equal(st.over, true);
    assert.match(await B.text("overlay-title"), /wins!$|^Draw!$/);
    assert.deepEqual(B.errors, []);
});
