/* Chain React — game core: rules, board rendering, explosion animation.
   Player 0 and player 1. A cell holds up to (neighbours - 1) pieces; reaching the
   neighbour count makes it explode and hand one piece to every neighbour.
   The same wave logic is used for animated play and for instant replay (reconnect). */

"use strict";

const ChainGame = (() => {
    const state = {
        n: 6,
        cells: [],          // [{count, owner, cap}]
        current: 0,
        round: 1,
        movesBy: [0, 0],
        history: [],        // cell indices in play order
        busy: false,
        over: false,
        winner: -1,
        chainNow: 0,
        chainBest: 0,
        explosions: 0,
        chainRule: false,
        chainLen: 15,
        speed: 750,
    };

    let hooks = {};         // { names: [..], onTurn(player), onBusy(bool), onFinish(winner, why), onMoveApplied(i) }
    let cellEls = [];
    const $ = (id) => document.getElementById(id);
    const boardEl = () => $("board");
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const idx = (x, y) => y * state.n + x;

    function neighbours(x, y) {
        const out = [];
        if (x > 0) out.push([x - 1, y]);
        if (x < state.n - 1) out.push([x + 1, y]);
        if (y > 0) out.push([x, y - 1]);
        if (y < state.n - 1) out.push([x, y + 1]);
        return out;
    }

    /* ---------------- setup ---------------- */
    function newGame(config, h) {
        hooks = h || hooks;
        state.n = config.n;
        state.speed = config.speed;
        state.chainRule = !!config.chainRule;
        state.chainLen = config.chainLen || 15;
        document.documentElement.style.setProperty("--n", state.n);
        document.documentElement.style.setProperty("--speed", state.speed + "ms");
        state.cells = [];
        for (let y = 0; y < state.n; y++) for (let x = 0; x < state.n; x++) {
            state.cells.push({ count: 0, owner: -1, cap: neighbours(x, y).length });
        }
        state.current = config.startPlayer || 0;
        state.round = 1;
        state.movesBy = [0, 0];
        state.history = [];
        state.busy = false;
        state.over = false;
        state.winner = -1;
        state.chainNow = 0;
        state.chainBest = 0;
        state.explosions = 0;
        $("log").innerHTML = "";
        $("overlay").hidden = true;
        buildBoard();
        log(`New game. ${hooks.names[state.current]} starts.`, "p" + state.current);
        render();
        if (hooks.onTurn) hooks.onTurn(state.current);
    }

    function buildBoard() {
        const board = boardEl();
        board.innerHTML = "";
        board.className = "chain";
        cellEls = [];
        for (let y = 0; y < state.n; y++) for (let x = 0; x < state.n; x++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.x = x;
            cell.dataset.y = y;
            // 3x3: corners glass, centre glass (owner block once taken),
            // a lamp on every side that has a neighbour cell, glass on the others
            const hasN = { top: y > 0, left: x > 0, right: x < state.n - 1, bottom: y < state.n - 1 };
            const layout = [
                ["glass"], ["side", "top"], ["glass"],
                ["side", "left"], ["center"], ["side", "right"],
                ["glass"], ["side", "bottom"], ["glass"],
            ];
            layout.forEach(([t, dir]) => {
                const tile = document.createElement("div");
                if (t === "side") tile.className = "tile " + (hasN[dir] ? "lamp" : "glass");
                else tile.className = "tile " + t;
                cell.appendChild(tile);
            });
            const marker = document.createElement("div");
            marker.className = "last-marker";
            cell.appendChild(marker);
            const i = idx(x, y);
            cell.addEventListener("click", () => { if (hooks.onCellClick) hooks.onCellClick(i); });
            board.appendChild(cell);
            cellEls.push(cell);
        }
    }

    /* ---------------- rendering ---------------- */
    function renderCell(i) {
        const c = state.cells[i];
        const el = cellEls[i];
        el.classList.remove("p0", "p1", "critical", "can-place", "locked", "last");
        if (c.owner >= 0) el.classList.add("p" + c.owner);
        if (state.history.length && state.history[state.history.length - 1] === i) el.classList.add("last");
        if (c.count > 0 && c.count >= c.cap - 1) el.classList.add("critical");
        const lamps = el.querySelectorAll(".tile.lamp");
        lamps.forEach((l, k) => l.classList.toggle("on", k < c.count));
        if (!state.over && !state.busy) {
            const mine = hooks.mayPlay ? hooks.mayPlay(state.current) : true;
            if (mine && (c.owner === -1 || c.owner === state.current)) el.classList.add("can-place");
            else el.classList.add("locked");
        }
    }

    function tally() {
        const t = [{ cells: 0, pieces: 0 }, { cells: 0, pieces: 0 }];
        for (const c of state.cells) {
            if (c.owner >= 0) { t[c.owner].cells++; t[c.owner].pieces += c.count; }
        }
        return t;
    }

    function renderHut() {
        const t = tally();
        const total = state.cells.length;
        const p = state.current;
        const names = hooks.names;

        const roundText = state.over ? "Game over" : `Round ${state.round}`;
        $("round-label").textContent = roundText;
        $("round-mini").textContent = roundText;

        const tb = $("turn-box");
        tb.className = "turn-box p" + p + (state.busy ? " busy" : "");
        boardEl().classList.toggle("turn-p0", !state.over && p === 0);
        boardEl().classList.toggle("turn-p1", !state.over && p === 1);
        boardEl().classList.toggle("over", state.over);
        $("turn-name").textContent = names[p];
        $("turn-hint").textContent = state.over
            ? (state.winner >= 0 ? `${names[state.winner]} won` : "")
            : (hooks.turnHint ? hooks.turnHint(p) : "to move");

        for (let k = 0; k < 2; k++) {
            $(`p${k}-name`).textContent = names[k];
            $(`lbl-cells-${k}`).textContent = "Cells";
            $(`lbl-pieces-${k}`).textContent = "Pieces";
            $(`p${k}-cells`).textContent = t[k].cells;
            $(`p${k}-pieces`).textContent = t[k].pieces;
            const pct = Math.round(t[k].cells / total * 100);
            $(`p${k}-bar`).style.width = pct + "%";
            $(`p${k}-pct`).textContent = pct + "%";
            $(`p-${k}`).classList.toggle("leading", t[k].cells > t[1 - k].cells);
            $(`p-${k}`).classList.toggle("active", !state.over && p === k);
        }

        $("chain-now").textContent = state.chainNow;
        $("chain-best").textContent = state.chainBest;
        $("mini-line2").innerHTML = `chain <b>${state.chainNow}</b> / best <b>${state.chainBest}</b>`;
        $("explosions").textContent = state.explosions;
        $("chain-box").classList.toggle("hot", state.busy && state.chainNow >= 5);
    }

    function render() {
        if (!hooks.names || cellEls.length !== state.cells.length) return; // no game built yet
        for (let i = 0; i < state.cells.length; i++) renderCell(i);
        renderHut();
    }

    function log(msg, cls) {
        const line = document.createElement("div");
        if (cls) line.className = cls;
        line.textContent = msg;
        const el = $("log");
        el.prepend(line);
        while (el.children.length > 6) el.removeChild(el.lastChild);
    }

    /* ---------------- rules (shared by animated play and instant replay) ---------------- */
    function isLegal(i, player) {
        if (state.over || i < 0 || i >= state.cells.length) return false;
        const c = state.cells[i];
        return c.owner === -1 || c.owner === player;
    }

    function readyCells() {
        const ready = [];
        state.cells.forEach((c, i) => { if (c.count >= c.cap) ready.push(i); });
        return ready;
    }

    // one colour left on the board (after both have moved) -> chain would loop forever
    function boardDecided() {
        if (state.movesBy[0] === 0 || state.movesBy[1] === 0) return false;
        const t = tally();
        return t[0].cells === 0 || t[1].cells === 0;
    }

    // remove the pieces from exploding cells, return the flights they produce
    function detonate(ready) {
        const flights = [];
        for (const i of ready) {
            const c = state.cells[i];
            const x = i % state.n, y = Math.floor(i / state.n);
            c.count -= c.cap;
            if (c.count === 0) c.owner = -1;
            for (const [nx, ny] of neighbours(x, y)) flights.push({ from: i, to: idx(nx, ny) });
        }
        return flights;
    }

    function land(flights, me) {
        for (const f of flights) {
            const target = state.cells[f.to];
            target.owner = me;
            target.count++;
        }
    }

    function placePiece(i, me) {
        const c = state.cells[i];
        c.owner = me;
        c.count++;
        state.movesBy[me]++;
        state.history.push(i);
        state.chainNow = 0;
    }

    // after the chain settled: decide winner or pass the turn
    function concludeMove(me) {
        if (state.chainNow > state.chainBest) state.chainBest = state.chainNow;
        if (state.chainRule && state.chainNow >= state.chainLen) {
            return { winner: me, why: `Chain reaction of ${state.chainNow} explosions!` };
        }
        const t = tally();
        if (state.movesBy[0] > 0 && state.movesBy[1] > 0) {
            if (t[1 - me].cells === 0) return { winner: me, why: "Took over the whole board!" };
            if (t[me].cells === 0) return { winner: 1 - me, why: "Took over the whole board!" };
        }
        state.current = 1 - me;
        if (state.current === 0) state.round++;
        return null;
    }

    /* ---------------- animated play ---------------- */
    async function play(i) {
        if (state.busy || !isLegal(i, state.current)) return false;
        const me = state.current;
        state.busy = true;
        if (hooks.onBusy) hooks.onBusy(true);
        placePiece(i, me);
        if (hooks.onMoveApplied) hooks.onMoveApplied(i, me);
        render();

        await resolveChainAnimated(me);
        if (state.over) return true; // finished externally (e.g. opponent left) while animating

        if (state.chainNow > 0) log(`${hooks.names[me]} set off a chain of ${state.chainNow}.`, "x");
        const result = concludeMove(me);
        if (result) { finish(result.winner, result.why); return true; }

        state.busy = false;
        if (hooks.onBusy) hooks.onBusy(false);
        render();
        if (hooks.onTurn) hooks.onTurn(state.current);
        return true;
    }

    async function resolveChainAnimated(me) {
        const board = boardEl();
        for (;;) {
            if (state.over) return;
            const ready = readyCells();
            if (ready.length === 0 || boardDecided()) return;
            if (state.chainRule && state.chainNow >= state.chainLen) return;

            state.chainNow += ready.length;
            state.explosions += ready.length;
            if (state.chainNow > state.chainBest) state.chainBest = state.chainNow;

            // 1. prime: the full cells blink like lit TNT
            for (const i of ready) cellEls[i].classList.add("prime");
            renderHut();
            await sleep(state.speed * 0.6);
            if (state.over) return;

            // 2. blast
            const flights = detonate(ready);
            for (const i of ready) {
                const el = cellEls[i];
                el.classList.remove("prime", "boom");
                void el.offsetWidth;
                el.classList.add("boom");
                spawnDebris(i, me);
                renderCell(i);
            }
            board.classList.remove("shake");
            void board.offsetWidth;
            board.classList.add("shake");
            renderHut();

            // 3. pieces fly to the neighbours
            await animateFlights(flights, me);
            if (state.over) return;

            // 4. land
            land(flights, me);
            for (const f of flights) {
                renderCell(f.to);
                const el = cellEls[f.to];
                el.classList.remove("land");
                void el.offsetWidth;
                el.classList.add("land");
            }
            for (const i of ready) cellEls[i].classList.remove("boom");
            renderHut();

            await sleep(state.speed * 0.35);
        }
    }

    /* ---------------- instant replay (used after reconnect / page refresh) ---------------- */
    function replay(history) {
        for (const i of history) {
            if (state.over) break;
            const me = state.current;
            if (!isLegal(i, me)) break;
            placePiece(i, me);
            for (;;) {
                const ready = readyCells();
                if (ready.length === 0 || boardDecided()) break;
                if (state.chainRule && state.chainNow >= state.chainLen) break;
                state.chainNow += ready.length;
                state.explosions += ready.length;
                land(detonate(ready), me);
            }
            const result = concludeMove(me);
            if (result) { state.over = true; state.winner = result.winner; state.finishWhy = result.why; }
        }
        render();
        if (state.over) finish(state.winner, state.finishWhy || "");
        else if (hooks.onTurn) hooks.onTurn(state.current);
    }

    /* ---------------- animation helpers ---------------- */
    function cellCentre(i, size) {
        const boardRect = boardEl().getBoundingClientRect();
        const r = cellEls[i].getBoundingClientRect();
        return [r.left - boardRect.left + r.width / 2 - size / 2, r.top - boardRect.top + r.height / 2 - size / 2];
    }

    function unitPx() {
        return cellEls[0].getBoundingClientRect().width / 3;
    }

    function spawnDebris(i, me) {
        const board = boardEl();
        const unit = unitPx();
        const size = unit * 0.28;
        const [cx, cy] = cellCentre(i, size);
        const kinds = ["fire", "fire", "fire", "lamp", "glass", "rock", "fire", "lamp"];
        const count = 16;
        const dur = state.speed * 1.4;
        for (let k = 0; k < count; k++) {
            const s = document.createElement("div");
            s.className = "spark " + kinds[k % kinds.length] + " p" + me;
            board.appendChild(s);
            const angle = (k / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
            const dist = unit * (2.2 + Math.random() * 2.2);
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            const spin = (Math.random() - 0.5) * 900;
            s.animate([
                { transform: `translate(${cx}px, ${cy}px) rotate(0deg) scale(1.3)`, opacity: 1 },
                { transform: `translate(${cx + dx * 0.7}px, ${cy + dy * 0.7 - unit * 0.6}px) rotate(${spin * 0.6}deg) scale(1)`, opacity: 1, offset: 0.45 },
                { transform: `translate(${cx + dx}px, ${cy + dy + unit * 0.8}px) rotate(${spin}deg) scale(.4)`, opacity: 0 },
            ], { duration: dur * (0.7 + Math.random() * 0.5), easing: "cubic-bezier(.15,.7,.4,1)", fill: "forwards" })
                .onfinish = () => s.remove();
        }
    }

    function animateFlights(flights, me) {
        if (flights.length === 0) return Promise.resolve();
        const board = boardEl();
        const unit = unitPx();
        const dur = state.speed * 1.25;
        const anims = flights.map((f, k) => {
            const s = document.createElement("div");
            s.className = "fly p" + me;
            board.appendChild(s);
            const [sx, sy] = cellCentre(f.from, unit);
            const [tx, ty] = cellCentre(f.to, unit);
            const mx = (sx + tx) / 2, my = (sy + ty) / 2 - unit * 1.6;
            const spin = (k % 2 ? 1 : -1) * 360;
            const a = s.animate([
                { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(.6)`, opacity: 0.9 },
                { transform: `translate(${mx}px, ${my}px) rotate(${spin / 2}deg) scale(1.7)`, opacity: 1, offset: 0.5 },
                { transform: `translate(${tx}px, ${ty}px) rotate(${spin}deg) scale(.9)`, opacity: 1 },
            ], { duration: dur, easing: "cubic-bezier(.35,.1,.3,1)", fill: "forwards" });
            return a.finished.then(() => s.remove()).catch(() => s.remove());
        });
        return Promise.all(anims);
    }

    /* ---------------- end ---------------- */
    function finish(winner, why) {
        state.over = true;
        state.busy = false;
        state.winner = winner;
        const t = tally();
        const name = hooks.names[winner];
        log(`${name} wins! ${why}`, "p" + winner);
        render();
        $("overlay-block").className = "overlay-block p" + winner;
        $("overlay-title").textContent = `${name} wins!`;
        $("overlay-sub").textContent =
            `${why}\nRound ${state.round} · ${t[winner].cells} of ${state.cells.length} cells · longest chain ${state.chainBest}`;
        $("overlay").hidden = false;
        if (hooks.onBusy) hooks.onBusy(false);
        if (hooks.onFinish) hooks.onFinish(winner, why);
    }

    return { state, newGame, play, replay, finish, render, isLegal, log };
})();
