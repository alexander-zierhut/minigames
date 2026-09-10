/* Bot persona: reacts with emojis at the right moments, sparsely, deterministically. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom, wait } from "./dom.mjs";

function setup(seed, estimate) {
    const w = loadDom();
    const [Bots, Rules, BotPersona, Reactions, Bus] = ["Bots", "Rules", "BotPersona", "Reactions", "Bus"].map((n) => w.eval(n));   // top-level consts are not window properties
    const sent = [];
    Reactions.receive = (e, color) => sent.push(e + (color ? "" : "?"));
    const rules = Rules.of("five");
    const cfg = { n: 7, winLen: 4 };
    const state = rules.create(cfg, Rules.base(cfg));
    const bot = Bots.create("random-five", { seed, me: 1 });
    BotPersona.attach({ bot, seat: 1, game: "five", state: () => state, estimate, color: "var(--c1)", delays: { min: 0, max: 0 }, cooldownMs: 0 });
    return { w, Bus, BotPersona, bot, state, rules, sent };
}

test("waves at the start, says GG at the end, and stops after the game (detach)", async () => {
    const { w, Bus, BotPersona, sent } = setup(3, () => 0.5);
    Bus.emit("game:new", { game: "five" });
    await wait(5);
    assert.equal(JSON.stringify(sent), '["👋"]');
    Bus.emit("game:finish", { game: "five", winner: 0, why: "x" });
    await wait(5);
    assert.ok(sent.includes("GG"), `GG at the end (${sent})`);
    BotPersona.detach();
    Bus.emit("game:new", { game: "five" });
    await wait(5);
    assert.equal(sent.filter((e) => e === "👋").length, 1, "nothing after detach");
    w.close();
});

const of = (w, pool) => w.eval("BotPersona").POOLS[pool].map((e) => e[0]);

test("👍 (or applause) for a strong human move, EZ when it is about to win, 😔 when losing; never for its own moves", async () => {
    // the bot (seat 1) thinks player 0 is winning once cell 10 is taken by player 0
    const estimate = (st) => (st.cells[10] === 0 ? 0.95 : 0.3);
    const { w, Bus, bot, state, rules, sent } = setup(11, estimate);
    Bus.emit("game:new", { game: "five" }); await wait(5);
    Bus.emit("game:turn", { game: "five", player: 0 });          // human to move: position remembered
    rules.place(state, 10, 0); rules.settle(state, 0); rules.conclude(state, 0);
    Bus.emit("game:move", { game: "five", cell: 10, player: 0 });
    Bus.emit("game:turn", { game: "five", player: 1 });          // settled: judge the move
    await wait(5);
    const praise = [...of(w, "strong"), ...of(w, "sad")];
    assert.ok(sent.some((e) => praise.includes(e)), `strong move noticed (${sent})`);
    assert.equal(sent.some((e) => of(w, "blunder").includes(e)), false, "a strong move is not a blunder");
    assert.equal(sent.includes("🚨"), false, "no siren any more: a good move gets a thumbs-up, not an alarm");
    // the bot's own move never triggers anything
    const before = sent.length;
    rules.place(state, 20, 1); rules.settle(state, 1); rules.conclude(state, 1);
    Bus.emit("game:move", { game: "five", cell: 20, player: 1 });
    Bus.emit("game:turn", { game: "five", player: 0 });
    await wait(5);
    assert.equal(sent.length, before);
    // now the bot thinks it is winning big: EZ once
    const winning = setup(1, () => 0.05);                       // p0 5 % -> bot 95 %
    winning.Bus.emit("game:new", { game: "five" }); await wait(5);
    winning.Bus.emit("game:turn", { game: "five", player: 0 });
    winning.rules.place(winning.state, 3, 0); winning.rules.settle(winning.state, 0); winning.rules.conclude(winning.state, 0);
    winning.Bus.emit("game:move", { game: "five", cell: 3, player: 0 });
    winning.Bus.emit("game:turn", { game: "five", player: 1 }); await wait(5);
    winning.Bus.emit("game:turn", { game: "five", player: 0 });
    winning.rules.place(winning.state, 4, 0); winning.rules.settle(winning.state, 0); winning.rules.conclude(winning.state, 0);
    winning.Bus.emit("game:move", { game: "five", cell: 4, player: 0 });
    winning.Bus.emit("game:turn", { game: "five", player: 1 }); await wait(5);
    assert.equal(winning.sent.filter((e) => of(winning.w, "ez").includes(e)).length, 1, `EZ (or 😎) exactly once (${winning.sent})`);
    winning.w.close();
});

test("a blunder gets a surprised or teasing face; the pools vary with the seed, thumbs-up is the usual praise", async () => {
    // the human's move on cell 10 hands the bot a 90 % chance while every alternative leaves it at 50 %
    // (the persona speaks with probability .6 there, so a few seeds are tried; all seeded → deterministic)
    const blunder = (st) => (st.cells[10] === 0 ? 0.1 : 0.5);
    const teased = {};
    for (let seed = 1; seed <= 12; seed++) {
        const { w, Bus, state, rules, sent } = setup(seed, blunder);
        Bus.emit("game:new", { game: "five" }); await wait(2);
        Bus.emit("game:turn", { game: "five", player: 0 });
        rules.place(state, 10, 0); rules.settle(state, 0); rules.conclude(state, 0);
        Bus.emit("game:move", { game: "five", cell: 10, player: 0 });
        Bus.emit("game:turn", { game: "five", player: 1 }); await wait(2);
        assert.equal(sent.some((e) => of(w, "strong").includes(e)), false, `a blunder is not praised (seed ${seed}: ${sent})`);
        for (const e of sent) if (of(w, "blunder").includes(e)) teased[e] = (teased[e] || 0) + 1;
        w.close();
    }
    assert.ok(Object.keys(teased).length >= 2, `blunders noticed with varied faces (${JSON.stringify(teased)})`);
    // over many seeds the strong-move reaction varies, with 👍 the most common
    const strong = (st) => (st.cells[10] === 0 ? 0.95 : 0.3);
    const seen = {};
    for (let seed = 1; seed <= 40; seed++) {
        const g = setup(seed, strong);
        g.Bus.emit("game:new", { game: "five" }); await wait(2);
        g.Bus.emit("game:turn", { game: "five", player: 0 });
        g.rules.place(g.state, 10, 0); g.rules.settle(g.state, 0); g.rules.conclude(g.state, 0);
        g.Bus.emit("game:move", { game: "five", cell: 10, player: 0 });
        g.Bus.emit("game:turn", { game: "five", player: 1 }); await wait(2);
        for (const e of g.sent) if (of(g.w, "strong").includes(e)) seen[e] = (seen[e] || 0) + 1;
        g.w.close();
    }
    const kinds = Object.keys(seen);
    assert.ok(kinds.length >= 3, `varied praise across seeds (${JSON.stringify(seen)})`);
    assert.ok(seen["👍"] >= 5 && seen["👏"] >= 3, `thumbs-up and applause are the usual praise (${JSON.stringify(seen)})`);
});

test("sparse: cooldown and per-game cap hold, same seed same reactions", async () => {
    const run = async (seed) => {
        const { w, Bus, sent } = setup(seed, () => 0.5);
        Bus.emit("game:new", { game: "five" });
        for (let k = 0; k < 20; k++) Bus.emit("game:finish", { game: "five", winner: 1, why: "x" });
        await wait(5);
        w.close();
        return sent;
    };
    const a = await run(5), b = await run(5);
    assert.equal(JSON.stringify(a), JSON.stringify(b), "deterministic per seed");
    assert.ok(a.length <= 8, `at most 8 per game (${a.length})`);
    const w = loadDom(); const [BotPersona, Bots, Rules, Bus, Reactions] = ["BotPersona", "Bots", "Rules", "Bus", "Reactions"].map((n) => w.eval(n)); const sent = [];
    Reactions.receive = (e) => sent.push(e);
    const cfg = { n: 5, winLen: 4 }; const state = Rules.of("five").create(cfg, Rules.base(cfg));
    BotPersona.attach({ bot: Bots.create("random-five", { seed: 1, me: 1 }), seat: 1, game: "five", state: () => state, estimate: () => 0.5, color: "x", delays: { min: 0, max: 0 } });
    Bus.emit("game:new", { game: "five" }); Bus.emit("game:finish", { game: "five", winner: 1, why: "x" });
    await wait(5);
    assert.equal(sent.length, 1, "with the real 6 s cooldown a GG right after the wave is skipped");
    w.close();
});
