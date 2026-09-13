/* Languages (#47) in a real browser: the page opens in the browser's language, the switch in
   the preferences changes everything at once (no reload, the modal stays open) and survives a
   reload, Arabic reads right to left with
   the board kept left to right, and, the one that matters for the future: in EVERY language,
   on a phone and on a desktop, no button, label, row or HUD text wraps onto a second line or
   runs out of its box. A translation that is too long fails here, not on a player's screen. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser } from "./harness.mjs";

let server, B;
before(async () => { server = await startServer(); B = await launchBrowser(); await B.goto(server.url); });
after(async () => { await B?.close(); await server?.close(); });

const LANGS = ["en", "de", "es", "fr", "ja", "ar"];
/* Everything that has to stay on one line: buttons, headings, row labels, the seat cards,
   the options rows, the HUD's stat rows and turn box, the replay bar, the learn ladder's
   heads. Hints, taglines, lesson texts and the sentence next to a checkbox may wrap, so
   they are not here. A picker card's description, the options rows' summaries (a few parts
   joined by dots) and a scenario's title in the learn ladder are designed for two lines,
   never three. */
const ONE_LINE = [
    ".btn", ".section-title", ".title.small", ".menu-hello", ".lobby-row-label", ".lobby-row-note", ".lobby-head .label", "#lobby-code",
    ".settings-summary > span:not(.invite-text):not(.gear-icon):not(.chev):not(.learn-sc-text):not(#settings-summary):not(#opponent-summary)", ".invite-text b", ".prefs-nav-name", ".prefs-nav-sum",
    ".row > span:first-child", ".seg button", ".dd-button", ".dd-option", ".game-name", ".game-players",
    ".lp-name", ".lp-status", ".stat", ".turn-name", ".turn-hint", ".sign-title", ".sign-sub", "#mini-line2", "#round-mini",
    "#replay-pos", ".replay-title", "#replay-count", "#replay-page", ".learn-tier b", ".learn-tier-count", ".learn-kind", ".learn-step",
    ".learn-scenario small", ".bot-badge", ".skin-label", "#howto-summary",
].join(", ");
const TWO_LINES = ".game-desc, #settings-summary, #opponent-summary, .learn-scenario b";

const setLanguage = async (code) => { await B.ev(`Prefs.set({ language: ${JSON.stringify(code)} }); true`); await B.goto(server.url); };
// every screen of a walk is checked, and one assertion at its end names every text that broke
let found = [];
const check = async (where) => {
    for (const bad of await B.overflows(ONE_LINE)) found.push({ where, ...bad });
    for (const bad of await B.overflows(TWO_LINES, 2)) found.push({ where, ...bad });
};
const assertClean = () => { const list = found; found = []; assert.deepEqual(list, [], "a text wraps or overflows"); };

test("the language follows the browser, the switch in the preferences changes everything at once and sticks", async () => {
    assert.equal(await B.ev("I18n.lang"), "en", "headless Chrome speaks English");
    assert.equal(await B.text("btn-create"), "Create room");
    await B.click("#prefs-btn");
    await B.click("#prefs-nav-look");
    assert.equal(await B.text("prefs-sum-look"), "Classic · English", "the Look row names the language");
    await B.click("#pref-language-button");
    assert.equal(await B.ev("document.querySelectorAll('#pref-language .dd-option').length"), 7, "Automatic plus six languages");
    assert.ok(await B.ev("!!document.querySelector('#pref-language .dd-option[data-language=de] svg.flag')"), "every row carries a flag");
    await B.click("#pref-language .dd-option[data-language=de]");
    // live: no reload, the preferences stay open on the same section, every text is German at once
    assert.equal(await B.ev("I18n.lang"), "de");
    assert.equal(await B.ev("document.documentElement.lang"), "de");
    assert.equal(await B.ev("Prefs.isOpen && Prefs.section"), "look", "the preferences stay open where they were");
    assert.equal(await B.text("prefs-sum-look"), "Klassisch · Deutsch", "the row summary follows");
    assert.equal(await B.ev("document.querySelector('#pref-language-button .dd-label').textContent"), "Deutsch");
    assert.equal(await B.text("btn-create"), "Raum erstellen", "the title screen behind the modal is German");
    assert.equal(await B.ev("document.querySelector('#screen-lobby .game-card[data-game=five] .game-name').textContent"), "Fünf gewinnt", "the picker cards are rebuilt");
    assert.equal(await B.ev("document.querySelector('#set-timer option[value=custom]').textContent"), "Benutzerdefiniert…", "the settings' options are rewritten");
    await B.click("#btn-prefs-done");
    // and it sticks across a reload
    await B.goto(server.url);
    assert.equal(await B.ev("I18n.lang"), "de");
    assert.equal(await B.text("btn-create"), "Raum erstellen");
    assert.equal(await B.text("btn-local"), "Lokales Spiel", "the whole title screen is German");
    await B.click("#btn-local");
    assert.equal(await B.text("lobby-kind"), "Lokales Spiel");
    assert.match(await B.text("settings-summary"), /Timer|Kein Timer/i, "the settings summary is German");
    assert.equal(await B.ev("document.querySelector('.game-card[data-game=five] .game-name').textContent"), "Fünf gewinnt", "a game's title is translated, its key stays");
    await B.click("#btn-start");
    assert.match(await B.text("log"), /Neues Spiel/, "the log speaks German");
    await B.click("#btn-menu"); await B.click("#btn-lobby-back");
    assert.deepEqual(B.errors, []);
});

test("Arabic reads right to left; the board, the previews and the clocks stay left to right", async () => {
    await setLanguage("ar");
    assert.equal(await B.ev("document.documentElement.dir"), "rtl");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('btn-create')).direction"), "rtl");
    await B.click("#btn-local");
    assert.equal(await B.ev("getComputedStyle(document.querySelector('.game-preview')).direction"), "ltr", "a preview tile is not mirrored");
    await B.click("#btn-start");
    assert.equal(await B.ev("getComputedStyle(document.getElementById('board')).direction"), "ltr", "cell 0 stays top left");
    const first = await B.ev("document.querySelector('#board > .cell').getBoundingClientRect().left");
    const last = await B.ev("[...document.querySelectorAll('#board > .cell')].pop().getBoundingClientRect().left");
    assert.ok(first < last, "the first cell is left of the last one");
    await B.click("#btn-menu"); await B.click("#btn-lobby-back");
    assert.deepEqual(B.errors, []);
});

for (const code of LANGS) {
    for (const [view, w, h] of [["phone", 360, 780], ["desktop", 1400, 900]]) {
        test(`${code} on a ${view}: no label wraps, no text overflows, the fixed screens do not scroll`, async () => {
            await B.emulate(w, h);
            await setLanguage(code);
            assert.equal(await B.ev("I18n.lang"), code);
            // the title screen and its join panel
            await check(`${code}/${view} title`);
            if (view === "phone") assert.deepEqual(await B.noScroll(), { x: true, y: true, screen: true }, `${code}: the title screen fits a phone`);
            await B.click("#btn-join-open"); await check(`${code}/${view} join panel`); await B.click("#btn-join-open");
            // the preferences, every section
            await B.click("#prefs-btn");
            for (const section of ["profile", "look", "sound", "streaming", "developer", "feedback"]) {
                await B.click(`#prefs-nav-${section}`);
                await check(`${code}/${view} preferences ${section}`);
                if (section === "look") { await B.click("#pref-language-button"); await check(`${code}/${view} language menu`); await B.click("#pref-language-button"); }
                if (view === "phone") await B.click("#btn-prefs-back");
            }
            await B.click("#btn-prefs-done");
            // the local lobby with every game, the settings modal, the How to play modal
            await B.click("#btn-local");
            for (const game of await B.ev("JSON.stringify(Games.keys())").then(JSON.parse)) {
                await B.selectGame(game);
                await check(`${code}/${view} lobby (${game})`);
                await B.click("#btn-settings"); await check(`${code}/${view} settings (${game})`); await B.click("#btn-settings-done");
            }
            if (view === "phone") assert.deepEqual(await B.noScroll(), { x: true, y: true, screen: true }, `${code}: the local lobby fits a phone`);
            await B.click("#btn-howto"); await check(`${code}/${view} how to play`); await B.click("#btn-howto-done");
            await B.players(4); await check(`${code}/${view} lobby with four seats`); await B.players(2);
            // against a bot: the opponent row and the bot modal
            await B.click("#btn-lobby-back"); await B.click("#btn-bot");
            await check(`${code}/${view} bot lobby`);
            await B.click("#btn-opponent"); await check(`${code}/${view} bot modal`); await B.click("#btn-bot-cancel");
            // a game to the end: the HUD, the overlay, the replay bar and the analysis panel
            await B.selectGame("five");
            await B.click("#btn-settings"); await B.setting("size", 5); await B.setting("winlen", 4); await B.click("#btn-settings-done");
            await B.click("#btn-lobby-back"); await B.click("#btn-local"); await B.selectGame("five"); await B.click("#btn-start");
            await check(`${code}/${view} game HUD`);
            if (view === "phone") assert.deepEqual(await B.noScroll(), { x: true, y: true, screen: true }, `${code}: the game screen fits a phone`);
            for (const i of [0, 5, 1, 6, 2, 7, 3]) await B.move(i);
            await check(`${code}/${view} result overlay`);
            await B.click("#overlay-look");
            await B.waitFor("!document.getElementById('replay-bar').hidden", { what: "the replay bar" });
            await check(`${code}/${view} replay bar`);
            await B.click("#btn-menu"); await B.click("#btn-lobby-back");
            // the replays screen and the Learn pages
            await B.click("#btn-replays");
            await B.waitFor("document.querySelectorAll('#replay-list .replay-item').length >= 1", { what: "the replay in the list" });
            await check(`${code}/${view} replays`);
            await B.click("#replay-filter-button"); await check(`${code}/${view} replays filter menu`); await B.click("#replay-filter-button");
            await B.click("#btn-replays-back");
            await B.click("#btn-learn"); await check(`${code}/${view} learn list`);
            for (const game of await B.ev("JSON.stringify(Learn.games())").then(JSON.parse)) {
                await B.click(`#screen-learn .game-card[data-game=${game}]`); await check(`${code}/${view} learn page (${game})`);
                await B.ev("[...document.querySelectorAll('.learn-tier:not(.open)')].forEach((h) => h.click()); true");   // every tier's rows
                await check(`${code}/${view} learn ladder (${game})`);
                await B.click("#btn-learn-game-back");
            }
            await B.click("#screen-learn .game-card[data-game=chain]");
            await B.click("#btn-learn-tutorial"); await check(`${code}/${view} tutorial panel`);
            await B.click("#learn-back"); await B.click("#btn-learn-game-back"); await B.click("#btn-learn-back");
            assert.deepEqual(B.errors, []);
            assertClean();
        });
    }
}

test("back to English at the end", async () => {
    await B.emulate(1400, 900);
    await setLanguage("auto");
    assert.equal(await B.ev("I18n.lang"), "en");
});
