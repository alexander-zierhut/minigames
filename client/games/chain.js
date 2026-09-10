/* Chain React — board view, explosion animation, HUD numbers; registers the game.
   Layout (matches the 2015 screenshot): every cell is a 3×3 block — glass corners, a
   lamp on each side that has a neighbour cell (glass otherwise), and the centre shows
   the owner's block. Lit lamps = pieces in the cell. */

"use strict";

const ChainView = (() => {
    const { $, sleep, restartClass } = Util;
    let speed = 750;        // ms, from the animation-speed setting

    /* ---------- board ---------- */
    function build(board, state, config, onClick) {
        speed = config.speed || 750;
        document.documentElement.style.setProperty("--speed", speed + "ms");
        const n = state.n;
        const cells = [];
        for (let i = 0; i < n * n; i++) {
            const x = i % n, y = Math.floor(i / n);
            const hasNeighbour = { top: y > 0, left: x > 0, right: x < n - 1, bottom: y < n - 1 };
            const tiles = ["glass", "top", "glass", "left", "center", "right", "glass", "bottom", "glass"];
            const cell = document.createElement("div");
            cell.className = "cell";
            for (const t of tiles) {
                const tile = document.createElement("div");
                tile.className = "tile " + (t in hasNeighbour ? (hasNeighbour[t] ? "lamp" : "glass") : t);
                cell.appendChild(tile);
            }
            const marker = document.createElement("div");
            marker.className = "last-marker";
            cell.appendChild(marker);
            cell.addEventListener("click", () => onClick(i));
            board.appendChild(cell);
            cells.push(cell);
        }
        return cells;
    }

    function renderCell(el, state, i) {
        const c = state.cells[i];
        el.classList.toggle("critical", c.count > 0 && c.count >= c.cap - 1);
        el.querySelectorAll(".tile.lamp").forEach((lamp, k) => lamp.classList.toggle("on", k < c.count));
    }

    /* ---------- HUD ---------- */
    function hud(state) {
        const t = ChainRules.tally(state);
        const total = state.cells.length;
        $("chain-now").textContent = state.chainNow;
        $("chain-best").textContent = state.chainBest;
        $("explosions").textContent = state.explosions;
        $("chain-box").classList.toggle("hot", state.busy && state.chainNow >= 5);
        $("mini-line2").innerHTML = `chain <b>${state.chainNow}</b> / best <b>${state.chainBest}</b>`;
        return {
            round: `Round ${state.round}`,
            players: t.map((x, k) => ({
                stats: [["Cells", x.cells], ["Pieces", x.pieces]],
                bar: x.cells / total,
                barText: Math.round(x.cells / total * 100) + "%",
                leading: t.every((o, j) => j === k || x.cells > o.cells),
            })),
        };
    }

    function summary(state) {
        const t = ChainRules.tally(state);
        const cells = state.winner >= 0 ? t[state.winner].cells : 0;
        return `Round ${state.round} · ${cells} of ${state.cells.length} cells · longest chain ${state.chainBest}`;
    }

    /* ---------- animated chain reaction (owner-approved tuning, keep it "wuchtig") ----------
       per wave: 1. prime (full cells blink like lit TNT)  2. blast (flash, ring, shake, debris)
       3. fly (pieces arc to the neighbours)  4. land (pulse) + short pause.
       The rule steps are the same ones ChainRules.settle() uses instantly. */
    async function animateMove(ctx, i, me) {
        const { state, cells } = ctx;
        ctx.render();
        for (;;) {
            if (state.over) return;
            const ready = ChainRules.readyCells(state);
            if (ready.length === 0 || ChainRules.chainStopped(state)) break;

            for (const k of ready) cells[k].classList.add("prime");
            Bus.emit("chain:prime", { cells: ready, player: me, ms: speed * 0.6 });
            await sleep(speed * 0.6);
            if (state.over) return;

            const flights = ChainRules.detonate(state, ready);
            Bus.emit("chain:explode", { cells: ready, player: me, chain: state.chainNow });
            for (const k of ready) {
                cells[k].classList.remove("prime");
                restartClass(cells[k], "boom");
                spawnDebris(ctx, k, me);
                ctx.renderCell(k);
            }
            restartClass(ctx.board(), "shake");
            ctx.renderHud();

            await animateFlights(ctx, flights, me);
            if (state.over) return;

            ChainRules.land(state, flights, me);
            for (const f of flights) { ctx.renderCell(f.to); restartClass(cells[f.to], "land"); }
            for (const k of ready) cells[k].classList.remove("boom");
            ctx.renderHud();
            await sleep(speed * 0.35);
        }
        if (state.chainNow > 0) Log.add(`${ctx.names()[me]} set off a chain of ${state.chainNow}.`, "x");
    }

    function cellCentre(ctx, i, size) {
        const boardRect = ctx.board().getBoundingClientRect();
        const r = ctx.cells[i].getBoundingClientRect();
        return [r.left - boardRect.left + r.width / 2 - size / 2, r.top - boardRect.top + r.height / 2 - size / 2];
    }
    const unitPx = (ctx) => ctx.cells[0].getBoundingClientRect().width / 3;

    function spawnDebris(ctx, i, me) {
        const board = ctx.board();
        const unit = unitPx(ctx);
        const [cx, cy] = cellCentre(ctx, i, unit * 0.28);
        const kinds = ["fire", "fire", "fire", "lamp", "glass", "rock", "fire", "lamp"];
        const count = 16;
        const dur = speed * 1.4;
        for (let k = 0; k < count; k++) {
            const s = document.createElement("div");
            s.className = `spark ${kinds[k % kinds.length]} p${me}`;
            board.appendChild(s);
            const angle = (k / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
            const dist = unit * (2.2 + Math.random() * 2.2);
            const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
            const spin = (Math.random() - 0.5) * 900;
            s.animate([
                { transform: `translate(${cx}px, ${cy}px) rotate(0deg) scale(1.3)`, opacity: 1 },
                { transform: `translate(${cx + dx * 0.7}px, ${cy + dy * 0.7 - unit * 0.6}px) rotate(${spin * 0.6}deg) scale(1)`, opacity: 1, offset: 0.45 },
                { transform: `translate(${cx + dx}px, ${cy + dy + unit * 0.8}px) rotate(${spin}deg) scale(.4)`, opacity: 0 },
            ], { duration: dur * (0.7 + Math.random() * 0.5), easing: "cubic-bezier(.15,.7,.4,1)", fill: "forwards" })
                .onfinish = () => s.remove();
        }
    }

    function animateFlights(ctx, flights, me) {
        if (flights.length === 0) return Promise.resolve();
        const board = ctx.board();
        const unit = unitPx(ctx);
        const dur = speed * 1.25;
        return Promise.all(flights.map((f, k) => {
            const s = document.createElement("div");
            s.className = `fly p${me}`;
            board.appendChild(s);
            const [sx, sy] = cellCentre(ctx, f.from, unit);
            const [tx, ty] = cellCentre(ctx, f.to, unit);
            const mx = (sx + tx) / 2, my = (sy + ty) / 2 - unit * 1.6;
            const spin = (k % 2 ? 1 : -1) * 360;
            const a = s.animate([
                { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(.6)`, opacity: 0.9 },
                { transform: `translate(${mx}px, ${my}px) rotate(${spin / 2}deg) scale(1.7)`, opacity: 1, offset: 0.5 },
                { transform: `translate(${tx}px, ${ty}px) rotate(${spin}deg) scale(.9)`, opacity: 1 },
            ], { duration: dur, easing: "cubic-bezier(.35,.1,.3,1)", fill: "forwards" });
            return a.finished.then(() => s.remove()).catch(() => s.remove());
        }));
    }

    return { build, renderCell, hud, summary, animateMove };
})();

const ChainGame = Games.register({
    key: "chain",
    title: "Chain React",
    tagline: "Fill a cell, it explodes into its neighbours. Take the whole board.",
    desc: "Explosions & chain reactions",
    preview: "...01....",                  // 3×3 picker preview: . empty, digit = player
    size: { min: 3, max: 12, default: 6 },
    settings: ["speed", "chainRule"],      // rows of #settings-modal shown for this game
    describeOptions: (cfg) => cfg.chainRule ? [`${cfg.chainLen}-chain wins`] : [],
    rules: ChainRules,
    view: ChainView,
});
