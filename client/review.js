/* The replay bar (#38) and the analysis panel (#43) after a game, and while a replay is
   watched. Every step is a view-only preview in the engine (the live game, the record and
   the hash never change) and is announced to the room, so everyone looks at the same move.
   `show` is the single funnel for every step (buttons, keys, Play, the room, the graph),
   `hide` the single teardown; the analysis panel follows both. */

"use strict";

const Review = (() => {
    const { $ } = Util;
    let h = { doc: () => null, onPlayFrom: () => {} };   // app.js: the replay document on the board (null while playing); "Play from here"

    const total = () => Match.state.history.length;
    const current = () => Match.engine.previewPly ?? total();
    // Play / Pause: each side steps on its own timer from the move that was announced, so
    // playing through a game together costs one message, not one per move
    const player = Replays.playback({ ply: current, total, seek: (p) => show(p, false, true) });

    function show(ply, announce, auto) {
        if (!auto) player.stop();                        // any step by hand pauses
        const to = Math.max(0, Math.min(total(), ply));
        const fresh = $("replay-bar").hidden;
        Match.engine.preview(to >= total() ? null : to);
        $("overlay").hidden = true;
        $("result-fab").hidden = false;
        $("replay-bar").hidden = false;
        if (fresh) openAnalysis();
        render();
        if (announce && Room.online) Room.review(to, player.playing);
    }
    function render() {
        const n = total();
        const ply = current();
        $("replay-pos").textContent = `Move ${ply} / ${n}`;
        $("replay-first").disabled = $("replay-prev").disabled = ply === 0;
        $("replay-next").disabled = $("replay-last").disabled = ply === n;
        const play = $("replay-play");
        play.disabled = n === 0;
        play.textContent = player.playing ? "❚❚" : "▶▶";
        play.title = player.playing ? "Pause" : "Play through the game";
        play.setAttribute("aria-label", play.title);
        // the analysis marks the bot's move on the board; a game whose moves are not plain
        // cell ids says which cell that is (`engine.cellOf`)
        const best = Analysis.at(ply);
        Match.mark(best >= 0 ? Match.engine.cellOf(best) : best);
    }
    // Play / Pause pressed here: the room follows on its own timer
    function togglePlay() {
        const on = player.toggle();
        render();
        if (Room.online) Room.review(current(), on);
    }
    // somebody else stepped or pressed Play: look at the same move, run the same timer
    function follow(ply, play) {
        player.stop();
        show(ply, false, true);
        if (play) player.start();
        render();
    }
    // back to the live position: a new game, a rematch, the room, the result overlay
    function hide() {
        player.stop();
        Analysis.close();
        Match.mark(-1);
        Match.engine.preview(null);
        $("replay-bar").hidden = true;
        $("result-fab").hidden = true;
    }

    // the game on the board as a replay document: the file when we watch one, else the game
    // that just ended (the same document the replays list keeps, so the analysis is cached
    // under the same id)
    function analysisDoc() {
        const doc = h.doc();
        if (doc) return doc;
        if (!Match.config || !Match.state.history.length) return null;
        return Replays.fromRecord(Match.record(), Match.names, Match.mode === "replay" ? "local" : Match.mode);
    }
    function openAnalysis() {
        const doc = Learn.active ? null : analysisDoc();   // a lesson is not a game to judge (#41)
        if (!doc) { Analysis.close(); return; }
        const two = (doc.config.players || 2) === 2;
        // "Play from here" opens a fresh room, so it is offered while watching a replay only
        Analysis.open(doc, { canPlayFrom: Match.mode === "replay" && two && !!Opponent.current(doc.game, doc.config) });
    }

    function init(handlers) {
        h = { ...h, ...handlers };
        $("overlay-look").addEventListener("click", () => show(total(), false));
        $("result-fab").addEventListener("click", () => { hide(); $("overlay").hidden = false; });
        $("replay-first").addEventListener("click", () => show(0, true));
        $("replay-prev").addEventListener("click", () => show(current() - 1, true));
        $("replay-next").addEventListener("click", () => show(current() + 1, true));
        $("replay-last").addEventListener("click", () => show(total(), true));
        $("replay-play").addEventListener("click", togglePlay);
        // arrow keys step, Home / End jump to the ends (while the bar is up and nothing is typed)
        document.addEventListener("keydown", (e) => {
            if ($("replay-bar").hidden || e.altKey || e.ctrlKey || e.metaKey) return;
            const t = e.target;
            if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
            const step = { ArrowLeft: current() - 1, ArrowRight: current() + 1, Home: 0, End: total() }[e.key];
            if (step === undefined) return;
            e.preventDefault();
            show(step, true);
        });
        Analysis.init({ onSeek: (ply) => show(ply, true), onPlayFrom: (ply) => h.onPlayFrom(ply) });
    }

    return { init, show, hide, render, follow, total, current };
})();
