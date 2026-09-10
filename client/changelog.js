/* Changelog: the title screen's button opens #changelog-modal with changelog.json (root
   file, fetched on demand so the title screen stays light). Days newest first; the first
   SHOW_DAYS days are open, older ones sit behind "Show older" so the list stays usable at
   any length. Refs "#12", "PR #1", "commit abc1234" become new-tab GitHub links. */

"use strict";

const Changelog = (() => {
    const { $ } = Util;
    const REPO = "https://github.com/alexander-zierhut/minigames";
    const SHOW_DAYS = 7;
    const TYPE_LABEL = { feature: "New", improvement: "Better", fix: "Fixed", internal: "Internal" };
    let data = null;

    // "#12" -> issue, "PR #1" -> pull request, "commit abc1234" -> commit; anything else -> null
    function refUrl(ref) {
        let m;
        if ((m = /^#(\d+)$/.exec(ref))) return { url: `${REPO}/issues/${m[1]}`, label: `#${m[1]}` };
        if ((m = /^PR #(\d+)$/i.exec(ref))) return { url: `${REPO}/pull/${m[1]}`, label: `PR #${m[1]}` };
        if ((m = /^commit ([0-9a-f]{7,40})$/i.exec(ref))) return { url: `${REPO}/commit/${m[1]}`, label: m[1].slice(0, 7) };
        return null;
    }

    function entryEl(e) {
        const li = document.createElement("li");
        li.className = "cl-entry " + (e.type || "improvement");
        const tag = document.createElement("span");
        tag.className = "cl-type";
        tag.textContent = TYPE_LABEL[e.type] || e.type || "";
        const text = document.createElement("span");
        text.className = "cl-text";
        text.textContent = e.text;
        li.append(tag, text);
        for (const ref of e.refs || []) {
            const r = refUrl(ref);
            if (!r) continue;
            const a = document.createElement("a");
            a.href = r.url; a.target = "_blank"; a.rel = "noopener"; a.className = "cl-ref"; a.textContent = r.label;
            li.append(" ", a);
        }
        return li;
    }

    function render(doc) {
        const box = $("changelog-list");
        box.innerHTML = "";
        const days = (doc && doc.days) || [];
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
            for (const e of day.entries || []) ul.appendChild(entryEl(e));
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
        $("btn-changelog-done").addEventListener("click", close);
        $("changelog-modal").addEventListener("click", (e) => { if (e.target === $("changelog-modal")) close(); });
    }

    return { init, open, close, render, refUrl, SHOW_DAYS };
})();
