#!/usr/bin/env node
// Splits the end-to-end test files into balanced shards for the CI matrix.
//
// CI runs the e2e files in parallel jobs ("shards"): every shard is its own runner and
// still runs its files one at a time (a Chrome-heavy file next to another one on a
// 2-core runner is what made the suite flaky before). The point of this script is that
// the shards take roughly the same time, because the longest shard decides the wall
// clock of the whole workflow.
//
//   node scripts/ci/shards.mjs 2 4     -> the files of shard 2 of 4, space separated
//   node scripts/ci/shards.mjs         -> all shards with their estimated seconds
//
// Sizes are measured seconds on the GitHub runner (wall clock per file, Chrome start
// included). A file that is not in the table still lands in a shard: it is estimated by
// its name, so a new e2e file needs no change here. Refresh the numbers when a file
// grows a lot: `gh run view <id> --log` prints a duration per test.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const E2E_DIR = join(ROOT, "tests", "e2e");

/** Measured wall-clock seconds per file on the 2-core GitHub runner. */
export const SIZES = {
    "online-edge.test.mjs": 80,
    "online.test.mjs": 65,
    "prefs.test.mjs": 40,
    "online-spectate.test.mjs": 32,
    "replays.test.mjs": 30,        // #43 added the analysis and a room against the bot
    "local-flow.test.mjs": 28,
    "boxes.test.mjs": 28,
    "isolation.test.mjs": 24,
    "settings.test.mjs": 20,
    "dist.test.mjs": 20,
    "update.test.mjs": 18,
    "learn.test.mjs": 18,
    "party.test.mjs": 17,
    "bot.test.mjs": 15,
    "skins.test.mjs": 13,
    "online-party.test.mjs": 11,
    "mobile.test.mjs": 7,
};

/** A file nobody measured yet: online files need at least two browsers, so assume slow. */
export const GUESS_ONLINE = 45;
export const GUESS_OTHER = 25;

export function sizeOf(file) {
    if (file in SIZES) return SIZES[file];
    return file.startsWith("online") ? GUESS_ONLINE : GUESS_OTHER;
}

export function listFiles(dir = E2E_DIR) {
    return readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
}

/**
 * Longest-processing-time first: the biggest file goes to the shard that is emptiest so
 * far. Deterministic (ties break by name), so two jobs of the same run agree without
 * talking to each other, and every file lands in exactly one shard.
 */
export function shards(files, count) {
    if (!Number.isInteger(count) || count < 1) throw new Error(`bad shard count: ${count}`);
    const lists = Array.from({ length: count }, () => []);
    const load = new Array(count).fill(0);
    const sorted = [...files].sort((a, b) => sizeOf(b) - sizeOf(a) || a.localeCompare(b));
    for (const f of sorted) {
        let k = 0;
        for (let i = 1; i < count; i++) if (load[i] < load[k]) k = i;
        lists[k].push(f);
        load[k] += sizeOf(f);
    }
    return lists.map((list) => list.sort());
}

export function shardOf(n, count, dir = E2E_DIR) {
    if (!Number.isInteger(n) || n < 1 || n > count) throw new Error(`shard ${n} is not 1..${count}`);
    return shards(listFiles(dir), count)[n - 1];
}

export function estimate(list) {
    return list.reduce((s, f) => s + sizeOf(f), 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const [a, b] = process.argv.slice(2);
    const count = Number(b || 4);
    if (a === undefined) {
        const all = shards(listFiles(), count);
        all.forEach((list, i) => {
            console.log(`shard ${i + 1}/${count}  ~${estimate(list)}s  ${list.join(" ")}`);
        });
    } else {
        const list = shardOf(Number(a), count);
        if (!list.length) throw new Error(`shard ${a}/${count} is empty: use fewer shards`);
        console.log(list.map((f) => `tests/e2e/${f}`).join(" "));
    }
}
