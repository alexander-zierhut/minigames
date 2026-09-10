/* Replays (#42): a played game as a file, and the games this device has played.

   A replay is the game record (see AGENTS.md "Game records") plus who played it and when,
   wrapped in a document with a format version:

     { format: "alzlper-minigames-replay", version: 1, game, config, history, outs,
       result: { over, winner, why }, players: [name per seat],
       meta: { playedAt, mode, gameNo, appVersion } }

   Everything here is pure except `Replays.store`, which keeps the documents in IndexedDB
   (fail-safe like Util's storage: a browser without it falls back to memory for this visit
   and `store.persistent()` says so). A file is read with `parse(text)` = JSON + migrate +
   validate, so the viewer only ever sees a document of the current version.

   Adding a format version: bump VERSION, add MIGRATIONS[old] and drop a sample of the old
   version into tests/replays/ (tests/unit/replays.test.mjs plays every sample there). */

"use strict";

const Replays = (() => {
    const FORMAT = "alzlper-minigames-replay";
    const VERSION = 1;
    const MAX_STORED = 200;             // the oldest replays fall out of the list

    /* ---------- migrations ---------- */
    // MIGRATIONS[v](doc) upgrades a document of version v to version v + 1.
    const MIGRATIONS = {};

    // any known version → the current one; null when the file is not a replay or is newer
    // than this page (then it may need keys we cannot invent)
    function migrate(doc) {
        if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
        if (doc.format !== FORMAT) return null;
        let out = doc;
        let v = out.version;
        if (!Number.isInteger(v) || v < 1) return null;
        while (v < VERSION) {
            const step = MIGRATIONS[v];
            if (!step) return null;
            out = step({ ...out });
            v += 1;
            out.version = v;
        }
        return v === VERSION ? out : null;
    }

    /* ---------- validation ---------- */
    // Is this a replay this page can show? Checks the shape and replays every move with the
    // game's own rules. It never compares the recorded result: the rules of a game may have
    // grown since, and what the file says happened stays what the list shows.
    function validate(doc) {
        const bad = (error) => ({ ok: false, error });
        if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.format !== FORMAT) return bad("This is not a replay file.");
        if (doc.version !== VERSION) return bad("This replay comes from a newer version of the site.");
        if (!Games.has(doc.game) || !Rules.of(doc.game)) return bad("This replay is of a game this page does not have.");
        const cfg = doc.config;
        if (!cfg || typeof cfg !== "object") return bad("This replay has no board.");
        if (!Number.isInteger(cfg.n) || cfg.n < 2 || cfg.n > 50) return bad("This replay has a board size that cannot be right.");
        const players = cfg.players || 2;
        if (!Number.isInteger(players) || players < 2 || players > 4) return bad("This replay has a number of players that cannot be right.");
        if (!Array.isArray(doc.history) || doc.history.some((i) => !Number.isInteger(i) || i < 0 || i >= cfg.n * cfg.n)) return bad("This replay has moves that are not on the board.");
        if (doc.outs !== undefined && !Array.isArray(doc.outs)) return bad("This replay is damaged.");
        if (!doc.result || typeof doc.result !== "object") return bad("This replay does not say how it ended.");
        if (!Array.isArray(doc.players) || doc.players.length < players || doc.players.some((n) => typeof n !== "string")) return bad("This replay does not say who played.");
        if (!doc.meta || typeof doc.meta !== "object" || typeof doc.meta.playedAt !== "string") return bad("This replay does not say when it was played.");
        try {
            const state = Rules.create({ ...cfg, game: doc.game }, doc.game);
            const applied = Rules.apply(doc.game, state, doc.history, doc.outs || []);
            if (applied !== doc.history.length) return bad("This replay does not fit the rules of the game.");
        } catch (e) {
            return bad("This replay could not be played back.");
        }
        return { ok: true };
    }

    // one file → a document ready for the viewer, or an error to show the player
    function parse(text) {
        let raw = null;
        try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: "That file is not a replay (it is not even JSON)." }; }
        const doc = migrate(raw);
        if (!doc) return { ok: false, error: raw && raw.format === FORMAT ? "This replay comes from a newer version of the site." : "That file is not a replay." };
        const check = validate(doc);
        return check.ok ? { ok: true, doc } : check;
    }

    /* ---------- building one ---------- */
    const appVersion = () => {
        try { return document.querySelector('meta[name="version"]').content || "dev"; } catch (e) { return "dev"; }
    };

    /* A game record (Match.record()) + who sat where + how it was played → a replay.
       `opts.finished` overrides whether the game really ended (a game left through "Back to
       room" is saved unfinished), `opts.playedAt` the timestamp (tests). */
    function fromRecord(record, names = [], mode = "local", opts = {}) {
        const cfg = { ...(record.config || {}) };
        const players = cfg.players || 2;
        const finished = opts.finished === undefined ? !!(record.over && record.why) : !!opts.finished;
        return {
            format: FORMAT,
            version: VERSION,
            game: record.game,
            config: cfg,
            history: (record.history || []).slice(),
            outs: (record.outs || []).map((o) => ({ ...o })),
            result: {
                over: finished,
                winner: finished ? (record.winner === null || record.winner === undefined ? -1 : record.winner) : null,
                why: finished ? (record.why || "") : "",
            },
            players: Array.from({ length: players }, (_, p) => String(names[p] === undefined || names[p] === null ? `Player ${p + 1}` : names[p])),
            meta: {
                playedAt: opts.playedAt || new Date().toISOString(),
                mode,
                gameNo: record.gameNo || 0,
                appVersion: opts.appVersion || appVersion(),
            },
        };
    }

    /* ---------- identity, names, summaries ---------- */
    const pad = (v) => String(v).padStart(2, "0");

    // FNV-1a over what makes the game that game: the same game saved twice (a page refresh
    // into a finished game, the same file uploaded again) keeps one entry.
    function idFor(doc) {
        const str = JSON.stringify([doc.game, doc.config, doc.history, doc.outs || [], doc.players]);
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(36) + "-" + str.length.toString(36);
    }

    // "chain-2026-09-10-2130.json" (local time, the way the player saw it)
    function fileName(doc) {
        const d = new Date(doc.meta && doc.meta.playedAt ? doc.meta.playedAt : Date.now());
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        return `${doc.game}-${stamp}.json`;
    }

    // "10 Sep 2026, 21:30" in the device's own format
    function when(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        try {
            return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
        } catch (e) {
            return d.toISOString().slice(0, 16).replace("T", ", ");
        }
    }

    // one line in the replays list (the document stays in the store until it is watched)
    function summary(doc, id = idFor(doc)) {
        const players = doc.players.slice(0, doc.config.players || 2);
        const winner = doc.result.winner;
        return {
            id,
            game: doc.game,
            title: Games.has(doc.game) ? Games.get(doc.game).title : doc.game,
            n: doc.config.n,
            players,
            moves: doc.history.length,
            playedAt: doc.meta.playedAt,
            mode: doc.meta.mode,
            over: !!doc.result.over,
            resultText: !doc.result.over ? "Unfinished" : winner >= 0 ? `${players[winner] || `Player ${winner + 1}`} won` : "Draw",
        };
    }

    /* ---------- the store (IndexedDB, memory when there is none) ---------- */
    const store = (() => {
        const DB_NAME = "chainreact";
        const STORE_NAME = "replays";
        const DB_VERSION = 1;
        const mem = new Map();
        let backendP = null;

        const memory = {
            persistent: false,
            put: async (rec) => { mem.set(rec.id, rec); },
            get: async (id) => mem.get(id) || null,
            all: async () => [...mem.values()],
            del: async (id) => { mem.delete(id); },
            clear: async () => { mem.clear(); },
        };

        function openDb() {
            return new Promise((resolve, reject) => {
                if (typeof indexedDB === "undefined" || !indexedDB) { reject(new Error("no IndexedDB")); return; }
                let req;
                try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
                const fail = () => reject(req.error || new Error("IndexedDB refused"));
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (db.objectStoreNames.contains(STORE_NAME)) return;
                    const os = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                    os.createIndex("game", "game");
                    os.createIndex("playedAt", "playedAt");
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = fail;
                req.onblocked = fail;
                setTimeout(() => reject(new Error("IndexedDB timed out")), 5000);
            });
        }

        function idbBackend(db) {
            const run = (write, op) => new Promise((resolve, reject) => {
                let req;
                const t = db.transaction(STORE_NAME, write ? "readwrite" : "readonly");
                try { req = op(t.objectStore(STORE_NAME)); } catch (e) { reject(e); return; }
                t.oncomplete = () => resolve(req ? req.result : null);
                t.onerror = t.onabort = () => reject(t.error || new Error("IndexedDB transaction failed"));
            });
            return {
                persistent: true,
                put: (rec) => run(true, (os) => os.put(rec)),
                get: (id) => run(false, (os) => os.get(id)).then((r) => r || null),
                all: () => run(false, (os) => os.getAll()).then((r) => r || []),
                del: (id) => run(true, (os) => os.delete(id)),
                clear: () => run(true, (os) => os.clear()),
            };
        }

        function backend() {
            if (!backendP) backendP = openDb().then(idbBackend).catch(() => memory);
            return backendP;
        }
        // one failed operation is enough: the rest of the visit uses memory instead of throwing
        async function safe(fn, fallback) {
            try { return await fn(await backend()); }
            catch (e) { backendP = Promise.resolve(memory); try { return await fn(memory); } catch (e2) { return fallback; } }
        }

        const persistent = () => safe(async (b) => b.persistent, false);

        // save a replay; the same game saved twice keeps its first timestamp and one entry
        async function save(doc) {
            const id = idFor(doc);
            return safe(async (b) => {
                const old = await b.get(id);
                const playedAt = old ? old.playedAt : doc.meta.playedAt;
                await b.put({ id, game: doc.game, playedAt, doc: { ...doc, meta: { ...doc.meta, playedAt } } });
                const all = await b.all();
                if (all.length > MAX_STORED) {
                    const oldest = all.sort((a, x) => (a.playedAt < x.playedAt ? -1 : 1)).slice(0, all.length - MAX_STORED);
                    for (const r of oldest) await b.del(r.id);
                }
                return id;
            }, id);
        }

        // newest first, optionally one game only; light summaries, not the documents
        const list = ({ game } = {}) => safe(async (b) => {
            const all = await b.all();
            return all
                .filter((r) => r && r.doc && (!game || r.game === game))
                .sort((a, x) => (a.playedAt < x.playedAt ? 1 : a.playedAt > x.playedAt ? -1 : 0))
                .map((r) => summary(r.doc, r.id));
        }, []);

        const get = (id) => safe(async (b) => { const r = await b.get(id); return r ? r.doc : null; }, null);
        const remove = (id) => safe(async (b) => { await b.del(id); return true; }, false);
        const clear = () => safe(async (b) => { await b.clear(); return true; }, false);

        return { save, list, get, remove, clear, persistent, DB_NAME, STORE_NAME };
    })();

    return { FORMAT, VERSION, MIGRATIONS, migrate, validate, parse, fromRecord, idFor, fileName, when, summary, store };
})();
