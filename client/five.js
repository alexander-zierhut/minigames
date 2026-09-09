/* Five Wins — gomoku-style: place a stone anywhere on an n×n grid, first to get five
   in a row (horizontal, vertical or diagonal) wins. Full board with no line = draw.
   Same interface as the chain engine so app.js can drive either. */

"use strict";

const FiveGame = (() => {
    const state = {
        n: 9,
        cells: [],          // owner per cell: -1 empty, 0, 1
        current: 0,
        round: 1,
        history: [],
        busy: false,
        over: false,
        winner: -1,
        winLine: [],
        movesBy: [0, 0],
        winLen: 5,
    };
    let hooks = {};
    let cellEls = [];
    const $ = (id) => document.getElementById(id);
    const boardEl = () => $("board");
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    function newGame(config, h) {
        hooks = h || hooks;
        state.n = config.n;
        state.winLen = Math.max(3, Math.min(config.winLen || 5, state.n));
        document.documentElement.style.setProperty("--n", state.n);
        state.cells = new Array(state.n * state.n).fill(-1);
        state.current = config.startPlayer || 0;
        state.round = 1;
        state.history = [];
        state.movesBy = [0, 0];
        state.busy = false;
        state.over = false;
        state.winner = -1;
        state.winLine = [];
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
        board.className = "five";
        cellEls = [];
        for (let i = 0; i < state.n * state.n; i++) {
            const cell = document.createElement("div");
            cell.className = "stone";
            const marker = document.createElement("div");
            marker.className = "last-marker";
            cell.appendChild(marker);
            cell.addEventListener("click", () => { if (hooks.onCellClick) hooks.onCellClick(i); });
            board.appendChild(cell);
            cellEls.push(cell);
        }
    }

    /* ---------- rules ---------- */
    function isLegal(i, player) {
        return !state.over && i >= 0 && i < state.cells.length && state.cells[i] === -1;
    }

    const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

    // longest line through cell i for its owner, with the cells of the best one
    function lineThrough(i) {
        const owner = state.cells[i];
        if (owner < 0) return { len: 0, cells: [] };
        const n = state.n, x0 = i % n, y0 = Math.floor(i / n);
        let best = { len: 1, cells: [i] };
        for (const [dx, dy] of DIRS) {
            const cells = [i];
            for (const s of [1, -1]) {
                let x = x0 + dx * s, y = y0 + dy * s;
                while (x >= 0 && y >= 0 && x < n && y < n && state.cells[y * n + x] === owner) {
                    cells.push(y * n + x);
                    x += dx * s; y += dy * s;
                }
            }
            if (cells.length > best.len) best = { len: cells.length, cells };
        }
        return best;
    }

    function bestRow(player) {
        let best = 0;
        for (let i = 0; i < state.cells.length; i++) {
            if (state.cells[i] === player) best = Math.max(best, lineThrough(i).len);
        }
        return Math.min(best, state.winLen);
    }

    function place(i, me) {
        state.cells[i] = me;
        state.history.push(i);
        state.movesBy[me]++;
    }

    function conclude(i, me) {
        const line = lineThrough(i);
        if (line.len >= state.winLen) {
            state.winLine = line.cells;
            return { winner: me, why: `${state.winLen} in a row!` };
        }
        if (state.history.length === state.cells.length) return { winner: -1, why: "The board is full." };
        state.current = 1 - me;
        if (state.current === 0) state.round++;
        return null;
    }

    /* ---------- play ---------- */
    async function play(i) {
        if (state.busy || !isLegal(i, state.current)) return false;
        const me = state.current;
        state.busy = true;
        if (hooks.onBusy) hooks.onBusy(true);
        place(i, me);
        if (hooks.onMoveApplied) hooks.onMoveApplied(i, me);
        renderCell(i);
        cellEls[i].classList.add("drop");
        renderHut();
        await sleep(180);
        if (state.over) return true;
        const result = conclude(i, me);
        if (result) { finish(result.winner, result.why); return true; }
        state.busy = false;
        if (hooks.onBusy) hooks.onBusy(false);
        render();
        if (hooks.onTurn) hooks.onTurn(state.current);
        return true;
    }

    function replay(history) {
        for (const i of history) {
            if (state.over) break;
            const me = state.current;
            if (!isLegal(i, me)) break;
            place(i, me);
            const result = conclude(i, me);
            if (result) { state.over = true; state.winner = result.winner; state.finishWhy = result.why; }
        }
        render();
        if (state.over) finish(state.winner, state.finishWhy || "");
        else if (hooks.onTurn) hooks.onTurn(state.current);
    }

    /* ---------- render ---------- */
    function renderCell(i) {
        const el = cellEls[i];
        const o = state.cells[i];
        el.classList.remove("p0", "p1", "can-place", "locked", "last", "win");
        if (o >= 0) el.classList.add("p" + o);
        if (state.history.length && state.history[state.history.length - 1] === i) el.classList.add("last");
        const w = state.winLine.indexOf(i);
        if (w >= 0) { el.classList.add("win"); el.style.setProperty("--k", w); }
        if (!state.over && !state.busy) {
            const mine = hooks.mayPlay ? hooks.mayPlay(state.current) : true;
            if (mine && o === -1) el.classList.add("can-place");
            else if (o === -1) el.classList.add("locked");
        }
    }

    function renderHut() {
        const names = hooks.names;
        const p = state.current;
        const total = state.cells.length;
        const text = state.over ? "Game over" : `Move ${state.history.length + 1}`;
        $("round-label").textContent = text;
        $("round-mini").textContent = text;
        const tb = $("turn-box");
        tb.className = "turn-box p" + p;
        boardEl().classList.toggle("turn-p0", !state.over && p === 0);
        boardEl().classList.toggle("turn-p1", !state.over && p === 1);
        $("turn-name").textContent = state.over && state.winner < 0 ? "Draw" : names[p];
        $("turn-hint").textContent = state.over
            ? (state.winner >= 0 ? `${names[state.winner]} won` : "no space left")
            : (hooks.turnHint ? hooks.turnHint(p) : "to move");
        const rows = [bestRow(0), bestRow(1)];
        for (let k = 0; k < 2; k++) {
            $(`p${k}-name`).textContent = names[k];
            $(`lbl-cells-${k}`).textContent = "Stones";
            $(`lbl-pieces-${k}`).textContent = "Best row";
            $(`p${k}-cells`).textContent = state.movesBy[k];
            $(`p${k}-pieces`).textContent = rows[k];
            const pct = Math.round(state.movesBy[k] / total * 100);
            $(`p${k}-bar`).style.width = (rows[k] / state.winLen * 100) + "%";
            $(`p${k}-pct`).textContent = `${rows[k]} / ${state.winLen}`;
            $(`p-${k}`).classList.toggle("leading", rows[k] > rows[1 - k]);
            $(`p-${k}`).classList.toggle("active", !state.over && p === k);
            void pct;
        }
        $("mini-line2").textContent = `best row ${rows[0]} · ${rows[1]}`;
    }

    function render() {
        if (!hooks.names || cellEls.length !== state.cells.length) return;
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

    function finish(winner, why) {
        state.over = true;
        state.busy = false;
        state.winner = winner;
        const names = hooks.names;
        if (winner >= 0) log(`${names[winner]} wins! ${why}`, "p" + winner);
        else log(`Draw. ${why}`, "x");
        render();
        $("overlay-block").className = "overlay-block " + (winner >= 0 ? "p" + winner : "draw");
        $("overlay-title").textContent = winner >= 0 ? `${names[winner]} wins!` : "Draw!";
        $("overlay-sub").textContent = `${why}\n${state.history.length} moves`;
        $("overlay").hidden = false;
        if (hooks.onBusy) hooks.onBusy(false);
        if (hooks.onFinish) hooks.onFinish(winner, why);
    }

    return { state, newGame, play, replay, finish, render, isLegal, log };
})();
