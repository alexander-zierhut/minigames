/* The replays screen (#42): every game this device played (Replays.store), filtered by
   game, bot or not, a player's name and a date range, in pages; one can be watched, saved
   as a file or deleted, and a file somebody sent can be opened. app.js switches the screen
   and puts a replay on the board through the handlers of `init({ show, watch })`. */

"use strict";

const ReplayList = (() => {
    const { $, toast } = Util;
    const { t } = I18n;
    const PAGE = 10;                     // rows per page: the card never grows out of hand
    const f = { game: "all", kind: "all", search: "", from: "", to: "", page: 0 };   // the filters and the shown page
    let h = { show: () => {}, watch: () => {} };

    function open() {
        h.show("replays");
        renderFilter();
        render();
    }

    /* The game filter (#43): a small dropdown, because a plain <select> cannot show the
       games' preview tiles. The button says what is picked, the menu lists "All games"
       first and then every registered game with its own tile. */
    const filterLabel = (key) => (key === "all" ? t("replays.allGames") : Games.title(key));
    const previewTile = (key) => Games.previewTile(key, { small: true });
    function renderFilter() {
        const box = $("replay-filter");
        box.innerHTML = "";
        const button = document.createElement("button");
        button.className = "dd-button";
        button.id = "replay-filter-button";
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");
        const label = document.createElement("span");
        label.className = "dd-label";
        label.textContent = filterLabel(f.game);
        const chev = document.createElement("span");
        chev.className = "dd-chev";
        chev.textContent = "▾";
        button.append(previewTile(f.game), label, chev);
        button.addEventListener("click", () => openFilter(!box.classList.contains("open")));
        const menu = document.createElement("div");
        menu.className = "dd-menu";
        menu.setAttribute("role", "listbox");
        for (const key of ["all", ...Games.keys()]) {
            const opt = document.createElement("button");
            opt.className = "dd-option" + (key === f.game ? " selected" : "");
            opt.dataset.filter = key;
            opt.setAttribute("role", "option");
            opt.setAttribute("aria-selected", key === f.game ? "true" : "false");
            const name = document.createElement("span");
            name.className = "dd-label";
            name.textContent = filterLabel(key);
            opt.append(previewTile(key), name);
            opt.addEventListener("click", () => {
                const byKey = document.activeElement === opt;      // keyboard: keep the focus on the control
                f.game = key;
                f.page = 0;
                box.classList.remove("open");
                renderFilter();
                if (byKey) $("replay-filter-button").focus();
                render();
            });
            menu.appendChild(opt);
        }
        box.append(button, menu);
    }
    // open / close the filter menu (a click elsewhere and Escape close it too)
    function openFilter(on) {
        const box = $("replay-filter");
        box.classList.toggle("open", on);
        const button = box.querySelector(".dd-button");
        if (button) button.setAttribute("aria-expanded", on ? "true" : "false");
    }

    /* The list: every filter is applied to all the replays on this device, the count says
       how many were found, and the found ones come in pages of PAGE rows, newest first. */
    async function render() {
        const box = $("replay-list");
        const all = await Replays.store.list({});
        const found = Replays.filter(all, f);
        const pages = Math.max(1, Math.ceil(found.length / PAGE));
        f.page = Math.min(Math.max(0, f.page), pages - 1);
        const items = found.slice(f.page * PAGE, (f.page + 1) * PAGE);
        const kept = await Replays.store.persistent();
        const plural = (k) => t("replays.count", { count: k });
        $("replay-count").textContent = found.length === all.length ? plural(all.length) : t("replays.found", { found: found.length, all: plural(all.length) });
        $("replay-pager").hidden = pages <= 1;
        $("replay-page").textContent = t("replays.page", { page: f.page + 1, pages });
        $("replay-page-prev").disabled = f.page === 0;
        $("replay-page-next").disabled = f.page >= pages - 1;
        box.innerHTML = "";
        for (const r of items) {
            const el = Util.fromTemplate("tpl-replay", 0);
            el.dataset.id = r.id;
            el.prepend(previewTile(r.game));                     // the game's small tile in front of the text
            el.querySelector(".replay-title").textContent = `${r.title} · ${r.n} × ${r.n}` + (r.players.length > 2 ? ` · ${t("replays.players", { count: r.players.length })}` : "");
            el.querySelector(".replay-sub").textContent = [Replays.when(r.playedAt), r.players.join(` ${t("replays.vs")} `), r.resultText, t("replays.moves", { count: r.moves })].join(" · ");
            box.appendChild(el);
        }
        const note = $("replays-note");
        note.textContent = kept ? "" : t("replays.noStore");
        note.hidden = !note.textContent;
        const hint = $("replays-hint");
        hint.textContent = all.length === 0 ? t("replays.empty") : found.length === 0 ? t("replays.noMatch") : "";
        hint.hidden = !hint.textContent;
    }

    // save a replay as a file (a Blob the browser downloads under the replay's own name)
    function download(doc) {
        try {
            const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = Replays.fileName(doc);
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (e) { toast(t("replays.cantSave")); }
    }

    // a filter changed: back to the first page
    const refilter = (patch) => { Object.assign(f, patch, { page: 0 }); render(); };

    function init(handlers) {
        h = { ...h, ...handlers };
        // watch / save / delete one entry
        $("replay-list").addEventListener("click", async (e) => {
            const btn = e.target.closest("button[data-act]");
            if (!btn) return;
            const id = btn.closest(".replay-item").dataset.id;
            const doc = await Replays.store.get(id);
            if (!doc) { toast(t("replays.gone")); render(); return; }
            if (btn.dataset.act === "watch") h.watch(doc);
            else if (btn.dataset.act === "download") download(doc);
            else if (btn.dataset.act === "delete") { await Replays.store.remove(id); render(); toast(t("replays.deleted")); }
        });
        $("replay-kind").addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-kind]");
            if (!btn) return;
            for (const b of $("replay-kind").querySelectorAll("button")) b.classList.toggle("selected", b === btn);
            refilter({ kind: btn.dataset.kind });
        });
        $("replay-search").addEventListener("input", () => refilter({ search: $("replay-search").value }));
        for (const id of ["replay-from", "replay-to"]) $(id).addEventListener("change", () => refilter({ from: $("replay-from").value, to: $("replay-to").value }));
        $("replay-page-prev").addEventListener("click", () => { f.page--; render(); });
        $("replay-page-next").addEventListener("click", () => { f.page++; render(); });
        // a replay file: parse (JSON → migrate → validate), keep it, watch it
        $("btn-replay-upload").addEventListener("click", () => $("replay-file").click());
        $("replay-file").addEventListener("change", async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";                                  // the same file may be opened again
            if (!file) return;
            let text = "";
            try { text = await file.text(); } catch (err) { toast(t("replays.cantRead")); return; }
            const res = Replays.parse(text);
            if (!res.ok) { toast(t(res.error)); return; }
            await Replays.store.save(res.doc);
            render();
            h.watch(res.doc);
        });
        $("btn-replays-back").addEventListener("click", () => h.show("menu"));
        // the game filter's dropdown closes on a click next to it and on Escape
        document.addEventListener("click", (e) => {
            if (!$("replay-filter").classList.contains("open") || $("replay-filter").contains(e.target)) return;
            openFilter(false);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || !$("replay-filter").classList.contains("open")) return;
            openFilter(false);
            $("replay-filter-button").focus();
        });
    }

    const relabel = () => { renderFilter(); render(); };     // the language changed while the list is open (#47)
    return { init, open, render, relabel, download, PAGE };
})();
