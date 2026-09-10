/* Changelog: the title screen's button opens #changelog-modal with changelog.json (root
   file, fetched on demand so the title screen stays light). Days newest first; the first
   SHOW_DAYS days are open, older ones sit behind "Show older" so the list stays usable at
   any length. Refs "#12", "PR #1", "commit abc1234" become new-tab GitHub links.
   Two audiences (#27): by default only entries that change the game for players are
   listed; the "Show technical changes too" toggle (per device, off by default) adds the
   `internal` entries and those flagged `technical: true` (cosmetic and under-the-hood). */

"use strict";

const Changelog = (() => {
    const { $ } = Util;
    const REPO = "https://github.com/alexander-zierhut/minigames";
    const SHOW_DAYS = 7;
    const TYPE_LABEL = { feature: "New", improvement: "Better", fix: "Fixed", internal: "Internal" };
    const TOGGLE_KEY = "chainreact.changelog";             // { technical: bool }
    let data = null;
    let showTechnical = !!((Util.load(localStorage, TOGGLE_KEY) || {}).technical);

    // an entry only the curious want: internal work, or flagged technical (cosmetic / tooling)
    const technical = (e) => e.type === "internal" || !!e.technical;

    // "#12" -> issue, "PR #1" -> pull request, "commit abc1234" -> commit; anything else -> null
    function refUrl(ref) {
        let m;
        if ((m = /^#(\d+)$/.exec(ref))) return { url: `${REPO}/issues/${m[1]}`, label: `#${m[1]}` };
        if ((m = /^PR #(\d+)$/i.exec(ref))) return { url: `${REPO}/pull/${m[1]}`, label: `PR #${m[1]}` };
        if ((m = /^commit ([0-9a-f]{7,40})$/i.exec(ref))) return { url: `${REPO}/commit/${m[1]}`, label: m[1].slice(0, 7) };
        return null;
    }

    // one entry: a head line (type badge + GitHub links), the text on the line below
    function entryEl(e) {
        const li = document.createElement("li");
        li.className = "cl-entry " + (e.type || "improvement");
        const head = document.createElement("div");
        head.className = "cl-head";
        const tag = document.createElement("span");
        tag.className = "cl-type";
        tag.textContent = TYPE_LABEL[e.type] || e.type || "";
        head.appendChild(tag);
        for (const ref of e.refs || []) {
            const r = refUrl(ref);
            if (!r) continue;
            const a = document.createElement("a");
            a.href = r.url; a.target = "_blank"; a.rel = "noopener"; a.className = "cl-ref"; a.textContent = r.label;
            head.appendChild(a);
        }
        const text = document.createElement("div");
        text.className = "cl-text";
        text.textContent = e.text;
        li.append(head, text);
        return li;
    }

    // all = include the technical entries (default: the toggle's state); days left empty are skipped
    function render(doc, all = showTechnical) {
        const box = $("changelog-list");
        box.innerHTML = "";
        const days = ((doc && doc.days) || [])
            .map((day) => ({ date: day.date, entries: (day.entries || []).filter((e) => all || !technical(e)) }))
            .filter((day) => day.entries.length > 0);
        if (days.length === 0) { box.textContent = "No entries yet."; return; }
        const older = document.createElement("div");
        older.className = "cl-older";
        older.hidden = true;
        days.forEach((day, i) => {
            const sec = document.createElement("section");
            sec.className = "cl-day";
            const h = document.createElement("h2");
            h.textContent = day.date;
            const ul = document.createElement("ul");
            for (const e of day.entries) ul.appendChild(entryEl(e));
            sec.append(h, ul);
            (i < SHOW_DAYS ? box : older).appendChild(sec);
        });
        if (older.children.length) {
            const more = document.createElement("button");
            more.className = "btn small ghost";
            more.id = "changelog-more";
            more.textContent = `Show older (${older.children.length} more days)`;
            more.addEventListener("click", () => { older.hidden = false; more.remove(); });
            box.append(more, older);
        }
    }

    async function open() {
        $("changelog-modal").hidden = false;
        if (!data) {
            $("changelog-list").textContent = "Loading…";
            try {
                const res = await fetch(new URL("changelog.json", location.href), { cache: "no-cache" });
                if (!res.ok) throw new Error(res.status);
                data = await res.json();
            } catch (e) {
                $("changelog-list").textContent = "Couldn't load the changelog.";
                return;
            }
        }
        render(data);
    }
    function close() { $("changelog-modal").hidden = true; }

    function init() {
        $("btn-changelog").addEventListener("click", open);
        $("changelog-tech").checked = showTechnical;
        $("changelog-tech").addEventListener("change", () => {
            showTechnical = $("changelog-tech").checked;
            Util.save(localStorage, TOGGLE_KEY, { technical: showTechnical });
            if (data) render(data);
        });
        $("btn-changelog-done").addEventListener("click", close);
        $("changelog-modal").addEventListener("click", (e) => { if (e.target === $("changelog-modal")) close(); });
    }

    return { init, open, close, render, refUrl, technical, SHOW_DAYS, get showTechnical() { return showTechnical; } };
})();
