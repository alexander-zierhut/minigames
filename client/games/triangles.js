/* Triangles: board view (pegs, bands, triangles, the two-click band), HUD model; registers
   the game.

   The board is a hexagon of pegs placed with absolute positions from the geometry's x, y.
   Three kinds of elements, in this DOM order: the triangles `.tri` (painted by
   `renderBoard`, never clicked), the unit edges `.band` (the engine's cells, never clicked
   either: an edge index would collide with a move integer) and the pegs `.peg` on top,
   which carry the view's own click. A move is two clicks like Isolation: the first peg
   (one that starts a legal band) becomes `.pending` and every peg a band may reach from it
   lights up as `.target`, the second one submits the encoded band, the pending peg takes
   it back, anything else does nothing. The first click is only accepted while some cell
   carries `can-place` (this device moves now) or `can-premove` (#37: somebody else is to
   move and the table takes a premove), so a preview, a spectator and local play are
   handled by the framework, not here. A premove goes through the very same onClick: Match
   stores it while it is not my turn, and its band's edges carry the `premove` marker. */

"use strict";

const TrianglesView = (() => {
    const { sleep } = Util;
    const { t } = I18n;
    const R = () => TrianglesRules;
    const SNAP_MS = 160;                  // the band snaps along its pegs
    const POP_MS = 200;                   // a claimed triangle pops

    let cells = [];                       // one `.band` per edge (the engine's cells)
    let pegEls = [];                      // one `.peg` per peg
    let triEls = [];                      // one `.tri` per triangle
    let pending = -1;                     // the peg picked by the first click (-1 = none)
    let pendingFor = -1;                  // the seat it was picked for
    let seatOf = () => -1;                // the seat this device composes a move for now (the engine's ctx.seat)
    let snapping = new Set();             // edges of the band that is animating
    let reach = { state: null, at: -1, last: -1, from: new Map() };   // peg -> [{ to, move }] of the live position

    /* is the choice still about the position on the screen? Dropped at the end, when the
       seat this device composes for changed (the next seat on one device) and when no band
       starts at the peg any more; a peg picked while the bot thinks survives its move */
    function keepPending(state) {
        if (pending >= 0 && (state.over || seatOf(state) !== pendingFor || !targetsOf(state, pending).length)) pending = -1;
        return pending;
    }
    // every legal band by its two end pegs, cached per state object and position
    function reachOf(state) {
        const h = state.history, last = h.length ? h[h.length - 1] : -1;
        if (reach.state === state && reach.at === h.length && reach.last === last) return reach.from;
        const from = new Map();
        const add = (p, to, move) => { if (!from.has(p)) from.set(p, []); from.get(p).push({ to, move }); };
        for (const move of R().legalMoves(state)) {
            const b = R().decode(state, move);
            add(b.a, b.b, move);
            add(b.b, b.a, move);
        }
        reach = { state, at: h.length, last, from };
        return from;
    }
    const targetsOf = (state, p) => reachOf(state).get(p) || [];
    // the engine wrote `can-place` or `can-premove` somewhere: this device may compose a move
    // now (its own, or a premove while somebody else is to move) and no preview is shown
    const allowed = () => cells.some((el) => el.classList.contains("can-place") || el.classList.contains("can-premove"));

    function place(el, x, y) {
        el.style.setProperty("--x", x.toFixed(4));
        el.style.setProperty("--y", y.toFixed(4));
    }

    function build(board, state, config, onClick, ctx) {
        const g = R().geometry(state.n);
        pending = -1; pendingFor = -1;
        seatOf = (s) => (ctx ? ctx.seat() : s.current);
        snapping = new Set();
        reach = { state: null, at: -1, last: -1, from: new Map() };
        board.style.setProperty("--tm", g.m);
        triEls = g.tris.map((tri) => {
            const el = document.createElement("div");
            const ps = tri.pegs.map((p) => g.pegs[p]);
            const down = ps[1].y === ps[0].y;                 // TA = { p, p + D0, p + D1 }: flat side on top
            el.className = "tri " + (down ? "down" : "up");
            place(el, Math.min(...ps.map((p) => p.x)), Math.min(...ps.map((p) => p.y)));
            board.appendChild(el);
            return el;
        });
        cells = BoardView.cells(board, g.E, () => {}, (el, e) => {
            const { a, b, d } = g.edges[e];
            el.className = "band";
            place(el, (g.pegs[a].x + g.pegs[b].x) / 2, (g.pegs[a].y + g.pegs[b].y) / 2);
            el.style.setProperty("--rot", `${d * 60}deg`);
        });
        pegEls = g.pegs.map((p, i) => {
            const el = document.createElement("div");
            el.className = "peg";
            place(el, p.x, p.y);
            el.addEventListener("click", () => click(state, i, onClick));
            el.addEventListener("mouseenter", () => preview(state, i));
            el.addEventListener("mouseleave", () => preview(state, -1));
            board.appendChild(el);
            return el;
        });
        return cells;
    }

    function click(state, p, onClick) {
        keepPending(state);
        if (pending < 0) {
            // step 1: only while the framework lets this device play, and only on a peg a band starts at
            if (!allowed() || !targetsOf(state, p).length) return;
            const seat = seatOf(state);
            if (seat < 0) return;
            pending = p; pendingFor = seat;
            paintPegs(state);
            return;
        }
        if (p === pending) { pending = -1; paintPegs(state); return; }      // take it back
        const hit = targetsOf(state, pending).find((x) => x.to === p);
        if (!hit) return;
        pending = -1;
        paintPegs(state);
        onClick(hit.move);
    }

    /* a move being put together is lit in the colour of the seat it is for, which is not the
       seat to move while it is a premove (#37): the pending and target pegs and the preview
       band carry `p<seat>` themselves instead of inheriting --pc from #board.turn-p<k> */
    const SEATS = ["p0", "p1", "p2", "p3"];
    const seatClass = (el, on) => {
        if (el.classList.contains("taken")) return;          // a taken band keeps its owner's class
        el.classList.remove(...SEATS);
        if (on) el.classList.add("p" + pendingFor);
    };
    // hovering a target shows the band it would stretch (`.preview` on its edges)
    function preview(state, p) {
        for (const el of cells) if (el.classList.contains("preview")) { el.classList.remove("preview"); seatClass(el, false); }
        if (p < 0 || keepPending(state) < 0) return;
        const hit = targetsOf(state, pending).find((x) => x.to === p);
        if (hit) for (const e of R().decode(state, hit.move).edges) { cells[e].classList.add("preview"); seatClass(cells[e], true); }
    }

    /* the pegs: `used` once a band runs through them, `pending` / `target` while a band is
       half picked, `dead` when no band starts there, `premove` on the two end pegs of the
       band the table marked as the premove (#37: its edges carry the engine's `premove`
       class); the board is `idle` while the engine lets nobody on this device move or
       premove (run after the cells are painted, so `allowed` and the marker are current) */
    function paintPegs(state) {
        const on = keepPending(state) >= 0;
        const idle = !allowed();
        const targets = new Set(on ? targetsOf(state, pending).map((x) => x.to) : []);
        const ends = premoveEnds(state);
        for (let p = 0; p < pegEls.length; p++) {
            const el = pegEls[p];
            el.classList.toggle("premove", ends.has(p));
            el.classList.toggle("used", state.touched[p] > 0);
            el.classList.toggle("pending", p === pending);
            el.classList.toggle("target", targets.has(p));
            seatClass(el, p === pending || targets.has(p));
            el.classList.toggle("dead", !idle && !on && !targetsOf(state, p).length);
        }
        // the engine's render strips the seat class off a previewed band: put it back
        for (const el of cells) if (el.classList.contains("preview")) { if (!on) el.classList.remove("preview"); seatClass(el, on); }
        const board = pegEls.length ? pegEls[0].parentElement : null;
        if (board) { board.classList.toggle("picking", on); board.classList.toggle("idle", idle); }
    }

    // the pegs that occur once among the edges marked `premove`: the ends of the premoved band
    function premoveEnds(state) {
        const g = R().geometry(state.n), seen = new Map();
        for (let e = 0; e < cells.length; e++) {
            if (!cells[e].classList.contains("premove")) continue;
            for (const p of [g.edges[e].a, g.edges[e].b]) seen.set(p, (seen.get(p) || 0) + 1);
        }
        return new Set([...seen].filter(([, k]) => k === 1).map(([p]) => p));
    }

    // the engine marks the band's middle edge `last`; the whole band carries it here
    function renderCell(el, state, i) {
        el.classList.toggle("last", state.lastEdges.includes(i) && state.history.length > 0);
        el.classList.toggle("snap", snapping.has(i));
    }

    // the triangles and the pegs are not cells: repainted whenever the engine renders
    function renderBoard(state) {
        for (let k = 0; k < triEls.length; k++) {
            const el = triEls[k], owner = state.tris[k];
            el.classList.remove("taken", "won", "p0", "p1", "p2", "p3");
            if (owner >= 0) el.classList.add("taken", "p" + owner);
        }
        paintPegs(state);
    }

    function hud(state) {
        const g = R().geometry(state.n);
        const limit = state.tokens > 0;
        const leading = BoardView.leading(state.scores);
        const table = R().onTable(state).length;
        return {
            round: t("hud.move", { n: state.history.length + 1 }),
            drawHint: t("game.triangles.hud.same"),
            line2: t("game.triangles.hud.line2", { list: state.scores.join(" · ") }),
            box: { stats: [[t("game.triangles.hud.left"), R().left(state)], [t("game.triangles.hud.table"), table]], hot: table > 0 },
            players: state.scores.map((s, k) => ({
                stats: [[t("game.triangles.hud.triangles"), s],
                    limit ? [t("game.triangles.hud.tokensLeft"), Math.max(0, state.tokens - s)] : [t("game.triangles.hud.bands"), state.movesBy[k]]],
                bar: limit ? Math.min(1, s / state.tokens) : (g.T ? s / g.T : 0),
                barText: limit ? `${Math.min(s, state.tokens)} / ${state.tokens}` : `${s} / ${g.T}`,
                leading: leading[k],
            })),
        };
    }

    const summary = (state) => {
        const top = state.winner >= 0 ? state.scores[state.winner] : Math.max(...state.scores);
        return t("game.triangles.hud.summary", { top, total: R().geometry(state.n).T });
    };

    // the band snaps along its pegs, then the triangles it closed are claimed and pop
    async function animateMove(ctx, move, player) {
        const state = ctx.state;
        snapping = new Set(state.lastEdges);
        ctx.render();
        await sleep(SNAP_MS);
        snapping = new Set();
        if (state.over) return;
        TrianglesRules.settle(state, player);                      // the same step the instant path uses
        ctx.render();
        if (!state.lastTris.length) return;
        Bus.emit("triangles:claim", { game: "triangles", tris: state.lastTris.slice(), player, score: state.scores[player] });
        for (const k of state.lastTris) if (triEls[k]) triEls[k].classList.add("won");
        await sleep(POP_MS);
    }

    // the pegs a player clicks, in order, to play `move` (the generic view hook the e2e
    // harness and the Learn suite use)
    function clicks(state, move) {
        const b = R().decode(state, move);
        return b ? [pegEls[b.a], pegEls[b.b]] : [];
    }

    return { build, renderCell, renderBoard, hud, summary, animateMove, clicks, get pending() { return pending; } };
})();

const TrianglesGame = Games.register({
    key: "triangles",
    title: "game.triangles.title",
    tagline: "game.triangles.tagline",
    desc: "game.triangles.desc",
    preview: "0.1.1.0.1",                   // tokens on a triangle lattice (the CSS draws the lines)
    size: { min: 3, max: 7, default: 4, presets: [4, 5, 6], text: (n) => I18n.t("game.triangles.size", { n }) },
    minSize: (cfg) => (cfg.band === 3 ? 4 : 3),   // a 4-peg band never reaches the rim of n = 3
    players: { min: 2, max: 4 },
    settings: [
        { key: "band", label: "game.triangles.set.band", type: "select", def: 3,
            options: [[3, "game.triangles.set.band4"], [2, "game.triangles.set.band3"], [0, "game.triangles.set.bandAny"]] },
        { key: "touch", label: "game.triangles.set.touch", type: "bool", def: false },
        { key: "tokens", label: "game.triangles.set.tokens", type: "preset", presets: [10, 15, 21, 30], off: true, def: 21,
            min: 1, max: 99, unit: "game.triangles.unit.tokens", customLabel: "game.triangles.set.tokensCustom" },
    ],
    /* the summary names what differs from the default (4-peg bands anywhere), like chain
       and five name an option only when it is on; the token count always shows.
       Five parts by default took three lines of the phone lobby. */
    describeRules: (cfg) => {
        const band = cfg.band === 2 ? ["game.triangles.sum.band3"] : cfg.band === 0 ? ["game.triangles.sum.bandAny"] : [];
        const tokens = cfg.tokens === undefined ? 21 : cfg.tokens;
        return [...band.map((k) => I18n.t(k)), tokens > 0 ? I18n.t("game.triangles.sum.tokens", { count: tokens }) : I18n.t("game.triangles.sum.noLimit")];
    },
    describeOptions: (cfg) => (cfg.touch === true ? [I18n.t("game.triangles.sum.touch")] : []),
    /* Learn (#41): the rule bullets and a five-step lesson on the physical board (n = 4,
       4-peg bands anywhere, no token limit): stretch a band, a second one, claim a
       triangle, see what a band hands over, the two endings. `expect` holds whole encoded bands
       (`a * V + b`), so every step names its `highlight` edges itself. The scenarios come
       from the proven puzzle set (client/learn/triangles-scenarios.js). */
    howto: {
        rules: ["game.triangles.rule.1", "game.triangles.rule.2", "game.triangles.rule.3", "game.triangles.rule.4", "game.triangles.rule.5", "game.triangles.rule.6"
        ],
        tutorial: [
            {
                config: { n: 4, band: 3, tokens: 0 },
                moves: [],
                text: "game.triangles.tutorial.1",
                expect: [573],                                     // the left corner to the middle
                highlight: [42, 44, 47],
            },
            {
                moves: [573, 702],
                text: "game.triangles.tutorial.2",
                expect: [129],                                     // the middle to the top right corner
                highlight: [10, 22, 36],
            },
            {
                moves: [573, 702, 129, 345],
                text: "game.triangles.tutorial.3",
                expect: [18, 210, 438],                            // every band over the third side
                highlight: [32],
            },
            {
                moves: [573, 702, 129, 345, 438],
                text: "game.triangles.tutorial.4",
            },
            {
                moves: [573, 702, 129, 345, 438, 91],
                text: "game.triangles.tutorial.5",
            },
        ],
    },
    rules: TrianglesRules,
    view: TrianglesView,
});
