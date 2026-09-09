import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../tools/headless.mjs";

const { Bots, Rules } = loadHeadless();
const cfg = { n: 5, winLen: 4 };

test("random-five: only empty cells, roughly uniform over 2000 picks", async () => {
    const rules = Rules.of("five");
    const t = Bots.tools("five", { seed: 1 });
    let state = rules.create(cfg, Rules.base(cfg));
    state = t.apply(state, 12);                                // p0 took the centre; p1 (the bot) to move
    const bot = Bots.create("random-five", { seed: 21, me: 1 });
    const counts = new Map();
    for (let k = 0; k < 2000; k++) {
        const i = await bot.move(t.clone(state));
        assert.notEqual(i, 12); assert.ok(rules.isLegal(state, i, 1));
        counts.set(i, (counts.get(i) || 0) + 1);
    }
    assert.equal(counts.size, 24);
    for (const c of counts.values()) assert.ok(c > 40 && c < 130, `no cell starved or favoured (${c})`);
});

test("random-five: seed reproduces a whole game; different seeds differ", async () => {
    const play = async (seed) => (await Bots.playout("five", cfg, [Bots.create("random-five", { seed, me: 0 }), Bots.create("random-five", { seed: seed + 1, me: 1 })])).history;
    assert.deepEqual(await play(8), await play(8));
    assert.notDeepEqual(await play(8), await play(9));
});
