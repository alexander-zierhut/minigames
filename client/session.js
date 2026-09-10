/* The room session: what survives a page refresh (sessionStorage, this tab only).
   Room.save() writes it on every change; app.js reads it at boot and, when the URL still
   names the same room, rebuilds the board from the game record before re-syncing.
   Shape: { code, me, spectator, role, gameNo, rev, phase, config, history, outs, clocks }
   — config/history/outs are the game record (see Games.positionAt). */

"use strict";

const Session = (() => {
    const KEY = "chainreact.session";
    const save = (data) => Util.save(sessionStorage, KEY, data);
    const load = () => Util.load(sessionStorage, KEY);
    const clear = () => Util.remove(sessionStorage, KEY);
    return { save, load, clear, KEY };
})();
