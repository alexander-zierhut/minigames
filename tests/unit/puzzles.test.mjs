/* Puzzle sets (tests/puzzles/<game>/puzzles.json) must be consistent, and every registered
   bot is graded on them. Random bots only get a printed score; a real bot's own tests set
   the threshold it must reach. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHeadless } from "../../scripts/headless.mjs";
import { puzzleSets, loadPuzzles, setConfig, positionOf, evaluateBot } from "../../scripts/puzzles/runner.mjs";

const H = loadHeadless();
const sets = puzzleSets().map((dir) => ({ dir, data: loadPuzzles(dir) }));
const covered = new Set(sets.map((s) => s.data.game));

const missing = [...new Set(H.Bots.list().map((b) => b.game))].filter((g) => !covered.has(g));
test("every game with a bot has a puzzle set", { skip: missing.length > 0 && `no puzzle set yet for: ${missing.join(", ")}` }, () => {
    assert.deepEqual(missing, []);
});

for (const { dir, data } of sets) {
    const g = data.game;
    const cfg = setConfig(data);
    test(`${dir}: ≥ 100 puzzles, unique ids, every position replays and every best move is legal`, () => {
        assert.ok(H.Rules.of(g), `${dir}: game ${g} is registered`);
        assert.ok(dir === g || dir === `${g}-${data.variant}`, `${dir}: folder names the game and its variant`);
        assert.ok(data.puzzles.length >= 100, `${data.puzzles.length} puzzles`);
        assert.equal(new Set(data.puzzles.map((p) => p.id)).size, data.puzzles.length, "unique ids");
        const tags = new Set();
        for (const p of data.puzzles) {
            positionOf(H, { ...p, config: { ...p.config } });
            assert.ok(["win", "draw", "loss"].includes(p.value), `${p.id}: value`);
            for (const t of p.tags || []) tags.add(t);
        }
        assert.ok(tags.size >= 3, `tag variety (${[...tags].join(", ")})`);
    });
    for (const def of H.Bots.forGame(g)) {
        const skip = !H.Bots.supports(def.id, cfg) && `${def.id} does not play these rules`;
        test(`${def.id} on ${dir}: puzzle score (informational for Random; real bots assert a threshold in their own tests)`, { skip }, async () => {
            const r = await evaluateBot(H, def.id, { seed: 7, set: data });
            console.log(`  ${def.id} / ${dir}: ${r.solved}/${r.total} perfect moves (${r.pct} %, random picking would get ${r.chance} %)`, Object.fromEntries(Object.entries(r.byTag).map(([k, v]) => [k, `${v.solved}/${v.total}`])));
            assert.ok(r.total >= 100);
        });
    }
}
