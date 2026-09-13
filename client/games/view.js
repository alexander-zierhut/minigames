/* What every board view builds the same way, so a game only writes what is its own:
   the cell elements with their last-move marker and click, and the HUD's "leading" flags. */

"use strict";

const BoardView = (() => {
    // the `.last-marker` child the engine shows on the newest move's cell
    function marker() {
        const el = document.createElement("div");
        el.className = "last-marker";
        return el;
    }

    /* One element per cell inside `board`, in cell order: `decorate(el, i)` gives it its
       class (and any children of the game's own), then the marker and the click come for
       free. Returns the elements, which is what `view.build` hands to the engine. */
    function cells(board, count, onClick, decorate) {
        const out = [];
        for (let i = 0; i < count; i++) {
            const el = document.createElement("div");
            decorate(el, i);
            el.appendChild(marker());
            el.addEventListener("click", () => onClick(i));
            board.appendChild(el);
            out.push(el);
        }
        return out;
    }

    // per seat: strictly ahead of every other seat by `values` (the HUD's `leading` flag)
    const leading = (values) => values.map((v, k) => values.every((o, j) => j === k || v > o));

    return { marker, cells, leading };
})();
