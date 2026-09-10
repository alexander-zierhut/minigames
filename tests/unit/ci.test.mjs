/* The CI matrix splits the e2e files into shards. A file that falls out of the split is a
   test that silently stops running, so the split is checked here: complete, disjoint,
   balanced, and it must place a file nobody measured yet. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { E2E_DIR, SIZES, estimate, listFiles, shardOf, shards, sizeOf } from "../../scripts/ci/shards.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const workflow = readFileSync(ROOT + ".github/workflows/ci.yml", "utf8");

test("shards: every e2e file lands in exactly one shard, for any shard count", () => {
    const files = listFiles();
    assert.ok(files.length >= 10, `found only ${files.length} e2e files`);
    for (const count of [1, 2, 3, 4, 5, 6]) {
        const lists = shards(files, count);
        assert.equal(lists.length, count);
        const all = lists.flat();
        assert.equal(all.length, files.length, `${count} shards: ${all.length} of ${files.length} files`);
        assert.deepEqual(JSON.parse(JSON.stringify([...all].sort())), JSON.parse(JSON.stringify(files)));
        for (const list of lists) assert.ok(list.length > 0, `${count} shards: an empty shard`);
    }
});

test("shards: balanced within a factor of 1.5 by the size table", () => {
    const files = listFiles();
    for (const count of [2, 3, 4, 5]) {
        const loads = shards(files, count).map(estimate);
        const max = Math.max(...loads), min = Math.min(...loads);
        assert.ok(max / min <= 1.5, `${count} shards are lopsided: ${loads.join(", ")}`);
    }
});

test("shards: deterministic, 1-based, out of range is an error", () => {
    const a = shardOf(2, 4), b = shardOf(2, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    assert.throws(() => shardOf(0, 4), /1\.\.4/);
    assert.throws(() => shardOf(5, 4), /1\.\.4/);
    assert.throws(() => shards(listFiles(), 0), /shard count/);
});

test("shards: a file nobody measured is estimated and placed, online files count as slow", () => {
    assert.ok(sizeOf("online-seats.test.mjs") > sizeOf("whatever.test.mjs"));
    assert.equal(sizeOf("mobile.test.mjs"), SIZES["mobile.test.mjs"]);
    const files = [...listFiles(), "online-seats.test.mjs", "zzz-new.test.mjs"];
    const lists = shards(files, 4);
    assert.equal(lists.flat().length, files.length);
    assert.ok(lists.some((l) => l.includes("online-seats.test.mjs")));
    assert.ok(lists.some((l) => l.includes("zzz-new.test.mjs")));
});

test("the size table only names files that exist", () => {
    const files = listFiles(E2E_DIR);
    for (const f of Object.keys(SIZES)) assert.ok(files.includes(f), `SIZES lists a gone file: ${f}`);
});

test("the workflow matrix matches the shard count the script is called with", () => {
    const env = /^\s*SHARDS:\s*(\d+)\s*$/m.exec(workflow);
    assert.ok(env, "ci.yml sets SHARDS");
    const count = Number(env[1]);
    const matrix = /shard:\s*\[([\d,\s]+)\]/.exec(workflow);
    assert.ok(matrix, "ci.yml has a shard matrix");
    const list = matrix[1].split(",").map((s) => Number(s.trim()));
    assert.deepEqual(JSON.parse(JSON.stringify(list)), JSON.parse(JSON.stringify(Array.from({ length: count }, (_, i) => i + 1))));
    assert.match(workflow, /name: e2e \$\{\{ matrix\.shard \}\}\/(\d+)/);
    assert.equal(Number(/name: e2e \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(workflow)[1]), count);
});

test("the gate job keeps the required check name 'test' and needs every test job", () => {
    assert.match(workflow, /^ {2}test:\n {4}name: test\n {4}needs: \[unit, e2e\]\n {4}if: always\(\)/m);
    for (const job of ["unit", "e2e"]) {
        const guard = new RegExp(`needs\\.${job}\\.result \\}\\}" = "success" \\] \\|\\| exit 1`);
        assert.match(workflow, guard, `the gate must fail when ${job} did not succeed`);
    }
    assert.match(workflow, /^ {2}deploy:\n {4}name: deploy\n {4}needs: \[unit, e2e\]/m);
});
