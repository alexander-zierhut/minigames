import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../../tools/headless.mjs";

const { Bots, Rules } = loadHeadless();
const cfg = { n: 4 };

test("random-chain: plays every legal cell eventually, never an illegal one, and only its own/empty cells", async () => {
    const rules = Rules.of("chain");
    const t = Bots.tools("chain", { seed: 3 });
    let state = rules.create(cfg, Rules.base(cfg));
    state = t.apply(state, 0); state = t.apply(state, 15);   // p0 owns 0, p1 owns 15; p0 to move
    const bot = Bots.create("random-chain", { seed: 11, me: 0 });
    const seen = new Set();
    for (let k = 0; k < 400; k++) {
        const i = await bot.move(t.clone(state));
        assert.notEqual(i, 15, "never the opponent's cell");
        assert.ok(rules.isLegal(state, i, 0));
        seen.add(i);
    }
    assert.equal(seen.size, 15, "all 15 legal cells were picked at least once");
});

test("random-chain: seed reproduces a whole game; different seeds differ", async () => {
    const play = async (seed) => (await Bots.playout("chain", cfg, [Bots.create("random-chain", { seed, me: 0 }), Bots.create("random-chain", { seed: seed + 1, me: 1 })], { maxMoves: 500 })).history;
    assert.deepEqual(await play(8), await play(8));
    assert.notDeepEqual(await play(8), await play(9));
});
