/* changelog.json is data players read: it must stay well-formed, and every ref must link. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadDom } from "./dom.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const doc = JSON.parse(readFileSync(ROOT + "changelog.json", "utf8"));

test("changelog.json: days newest first, valid dates, known types, non-empty texts, resolvable refs", () => {
    const w = loadDom(); const C = w.eval("Changelog");
    assert.ok(doc.days.length >= 2);
    let prev = null;
    for (const day of doc.days) {
        assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/, day.date);
        if (prev) assert.ok(day.date < prev, `${day.date} after ${prev}: newest first`);
        prev = day.date;
        assert.ok(day.entries.length > 0, `${day.date} has entries`);
        for (const e of day.entries) {
            assert.ok(["feature", "improvement", "fix", "internal"].includes(e.type), `${day.date}: type ${e.type}`);
            assert.ok(typeof e.text === "string" && e.text.trim().length > 10, `${day.date}: text`);
            for (const r of e.refs || []) assert.ok(C.refUrl(r), `${day.date}: ref "${r}" must be #N, PR #N or commit <sha>`);
        }
    }
    assert.equal(C.refUrl("#14").url, "https://github.com/alexander-zierhut/minigames/issues/14");
    assert.equal(C.refUrl("PR #1").url, "https://github.com/alexander-zierhut/minigames/pull/1");
    assert.equal(C.refUrl("commit abc1234").label, "abc1234");
    assert.equal(C.refUrl("nonsense"), null);
    w.close();
});

test("render: days as sections, links open in a new tab, older days behind 'Show older'", () => {
    const w = loadDom(); const C = w.eval("Changelog"); const d = w.document;
    const many = { days: Array.from({ length: C.SHOW_DAYS + 3 }, (_, i) => ({ date: `2026-01-${String(20 - i).padStart(2, "0")}`, entries: [{ type: "fix", text: `entry ${i} of the day`, refs: ["#1", "commit 1234567", "bad"] }] })) };
    C.render(many);
    const list = d.getElementById("changelog-list");
    assert.equal(list.querySelectorAll(".cl-day").length, C.SHOW_DAYS + 3);
    assert.equal(list.querySelectorAll(":scope > .cl-day").length, C.SHOW_DAYS, "first days open");
    assert.equal(list.querySelector(".cl-older").hidden, true);
    assert.match(d.getElementById("changelog-more").textContent, /3 more days/);
    d.getElementById("changelog-more").click();
    assert.equal(list.querySelector(".cl-older").hidden, false);
    const links = [...list.querySelectorAll("a.cl-ref")];
    assert.equal(links.length, (C.SHOW_DAYS + 3) * 2, "only resolvable refs become links");
    assert.ok(links.every((a) => a.target === "_blank" && a.rel === "noopener"));
    C.render({ days: [] });
    assert.equal(list.textContent, "No entries yet.");
    w.close();
});
