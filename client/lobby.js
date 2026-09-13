/* The lobby screen: the head (kind, room code, Invite, the seat count), the seat cards with
   their controls, the Options rows and the Start button's text. Local play, against a bot
   and a room share the one screen; `render()` reads Match, Room and Settings and paints.
   The Invite modal and its "it worked" feedback live here too. app.js owns the flow
   (Start, Leave) and tells this module the seat names through `init({ names })`. */

"use strict";

const Lobby = (() => {
    const { $ } = Util;
    const { t } = I18n;
    const DONE_MS = 1400;                   // how long a copy confirmation shows
    let h = { names: () => [] };            // app.js: who sits in each seat

    function render() {
        const online = Room.online;
        const bot = Match.mode === "bot";
        const nm = h.names();
        Settings.setMinPlayers(online ? Room.occupiedSeats() : 2);  // no count that takes a seat away (#34)
        const players = Settings.read().players;
        $("lobby-kind").textContent = t(online ? "lobby.kind.online" : bot ? "lobby.kind.bot" : "lobby.kind.local");
        $("lobby-code").textContent = online ? Room.codeText() : t(bot ? "lobby.code.bot" : "lobby.code.local");
        $("lobby-code").classList.toggle("as-word", online && Room.watching);   // "Watching" is a word, not a code
        $("screen-lobby").classList.toggle("online", online);       // the code is a copy button in a room
        $("lobby-code").title = online ? t(Room.watching ? "lobby.copySpectate" : "lobby.copyInvite") : "";
        // the Invite modal: a spectate-link viewer never sees the room code, so it gets no
        // eye and no share or copy row, only the spectate link to invite more viewers (#29)
        const watcher = Room.watching;
        const eye = $("btn-hide-code");
        eye.hidden = !online || watcher;
        Icons.set(eye.querySelector(".gear-icon"), Room.codeHidden ? "eye-off" : "eye");
        $("hide-code-label").textContent = t(Room.codeHidden ? "invite.show" : "invite.hide");
        $("invite-code").textContent = online ? Room.codeText() : "";
        $("invite-code").hidden = !online || watcher;
        $("invite-hint").textContent = t(watcher ? "invite.hintWatcher" : "invite.hint");
        const roomBot = online ? Settings.bot : null;               // the room plays a bot (#36)
        $("btn-opponent").hidden = !bot && !roomBot;
        if (bot || roomBot) $("opponent-summary").textContent = Opponent.summary(Settings.game, Settings.read(), roomBot);
        Settings.setLocked(online && Match.spectator);              // spectators only watch (#29)
        // the seat count lives beside the room code online and in its own section offline;
        // it is the same control, moved
        const countHome = online ? document.querySelector(".lobby-head-row") : $("group-count");
        if ($("row-players").parentElement !== countHome) countHome.appendChild($("row-players"));
        $("group-count").hidden = online || bot;
        $("lobby-share").hidden = !online;
        $("btn-share").hidden = watcher;
        $("btn-copy-code").hidden = watcher;
        $("lobby-players").hidden = !online;
        $("group-players").hidden = !online;                        // seat cards, their heading and the notes are a room's
        const box = $("lobby-players");
        // the seat controls live inside the card they act on; park them before the cards are rebuilt
        const park = $("seat-actions");
        for (const id of ["btn-watch", "btn-take-seat", "btn-room-bot", "btn-room-bot-off"]) park.appendChild($(id));
        if (box.children.length !== players) {
            box.innerHTML = "";
            for (let k = 0; k < players; k++) box.appendChild(Util.fromTemplate("tpl-lobby-player", k));
        }
        const present = Room.presentSeats();
        const botSeat = online ? Room.botSeat() : -1;                // Room.names() already calls it "Bot" (#36)
        for (let k = 0; k < players; k++) {
            const mine = Match.me === k;
            $(`lp-${k}`).querySelector(".lp-name").textContent = nm[k];
            $(`lp-${k}`).querySelector(".lp-you").textContent = online && mine ? t("lobby.you") : "";
            $(`lp-${k}`).classList.toggle("absent", online && !present[k]);
            $(`lp-${k}-status`).textContent = !online ? "" : t(mine || k === botSeat ? "lobby.status.ready" : present[k] ? "lobby.status.connected" : "lobby.status.absent");
        }
        // swap between playing and watching (#39): a spectate-link viewer never sits down.
        // Each control sits in the card it acts on: "Watch instead" on my own card, "Sit here"
        // on the first empty card (a spectator), "Add a bot" on the empty card of a two-seat
        // room, "Remove the bot" on the bot's card.
        const canSwap = online && !watcher;
        const free = Room.seatFree();
        const firstFree = online ? present.findIndex((p, k) => !p && k < players) : -1;
        const place = (btn, shown, seat) => {
            btn.hidden = !shown;
            if (shown && seat >= 0 && $(`lp-${seat}`)) $(`lp-${seat}`).appendChild(btn);
        };
        place($("btn-watch"), canSwap && Match.me >= 0, Match.me);
        place($("btn-take-seat"), canSwap && Match.me < 0, firstFree);
        $("btn-take-seat").disabled = !free;
        $("btn-take-seat").title = free ? "" : t("lobby.seatTaken");
        // a two-seat room waiting for a friend may play a bot instead (#36)
        const mayAskBot = canSwap && Match.me >= 0 && players === 2 && Opponent.current(Settings.game, Settings.read());
        place($("btn-room-bot"), mayAskBot && !roomBot && !Room.allHere(), firstFree);
        place($("btn-room-bot-off"), mayAskBot && roomBot, botSeat);
        const watching = online ? Room.spectators : 0;
        $("lobby-spectators").textContent = watching > 0 ? t("lobby.spectators", { count: watching }) : "";
        const start = $("btn-start");
        if (!online) {
            start.disabled = bot && !Opponent.current(Settings.game, Settings.read());
            start.textContent = t("lobby.start");
            $("lobby-status").textContent = "";
        } else if (Match.spectator) {
            start.disabled = true;
            start.textContent = t("lobby.spectating");
        } else if (Room.netTrouble()) {
            // a connection problem says so on the button in two words (the banner at the top
            // carries the whole sentence), never as a stray line under the seats
            start.disabled = true;
            start.textContent = Room.netTrouble().short;
        } else if (!Room.allHere()) {
            const missing = Room.missingSeats().length;
            start.disabled = true;
            start.textContent = players === 2 ? t("lobby.waitingFriend") : t("lobby.waitingMore", { count: missing });
        } else {
            start.disabled = false;
            start.textContent = t(Room.isHost ? "lobby.start" : "lobby.startAsk");
            $("lobby-status").textContent = "";       // everyone is back: drop the "X left the room." note
        }
        $("btn-lobby-back").textContent = t(online ? "lobby.leave" : "lobby.back");
    }

    /* ---------- the Invite modal and its confirmations ----------
       "It worked" is shown on the thing that was clicked, never in a toast at the other end
       of the screen: a row's icon becomes a check and its border turns green for DONE_MS,
       the room code turns green, then both go back. */
    const doneTimers = new Map();
    async function copyText(text, ask) {
        try { await navigator.clipboard.writeText(text); return true; }
        catch (e) { prompt(ask, text); return false; }
    }
    function flashDone(btn) {
        const icon = btn.querySelector(".gear-icon");
        if (!icon) return;
        const was = icon.dataset.icon;
        Icons.set(icon, "check");
        btn.classList.add("done");
        clearTimeout(doneTimers.get(btn));
        doneTimers.set(btn, setTimeout(() => { Icons.set(icon, was); btn.classList.remove("done"); doneTimers.delete(btn); }, DONE_MS));
    }
    // true when the link landed on the clipboard (the share sheet and the fallback prompt say so themselves)
    async function shareLink(link, text) {
        if (navigator.share) {
            try { await navigator.share({ title: t("app.name"), text, url: link }); return false; } catch (e) { /* cancelled */ }
        }
        try { await navigator.clipboard.writeText(link); return true; }
        catch (e) { prompt(t("invite.promptCopy"), link); return false; }
    }
    const shareFrom = async (btn, link, text) => { if (await shareLink(link, text)) flashDone(btn); };
    const closeInvite = () => { $("invite-modal").hidden = true; };

    function init(handlers) {
        h = { ...h, ...handlers };
        $("btn-share").addEventListener("click", () => shareFrom($("btn-share"), Room.roomLink(), t("invite.shareText", { game: Games.title(Settings.game) })));
        // the spectate link carries the room's own spectator code, never the room code (#29)
        $("btn-share-spectate").addEventListener("click", () => shareFrom($("btn-share-spectate"), Room.spectateLink(), t("invite.watchText", { game: Games.title(Settings.game) })));
        $("btn-copy-code").addEventListener("click", async () => {
            if (await copyText(Net.code, t("invite.promptCode"))) flashDone($("btn-copy-code"));
        });
        // the room code itself copies the invite link (a spectate-link viewer has no room
        // code and copies its own watch link); only the colour says it worked, so nothing moves
        $("lobby-code").addEventListener("click", async () => {
            if (!Room.online) return;
            const watcher = Room.watching;
            const link = watcher ? Room.spectateLink() : Room.roomLink();
            if (!(await copyText(link, t(watcher ? "invite.promptWatch" : "invite.promptLink")))) return;
            const el = $("lobby-code");
            el.classList.add("copied");
            clearTimeout(doneTimers.get(el));
            doneTimers.set(el, setTimeout(() => { el.classList.remove("copied"); doneTimers.delete(el); }, DONE_MS));
        });
        // hiding the code the first time on this device asks whether new rooms should start
        // hidden (the `hideCode` preference); showing it again never asks
        $("btn-hide-code").addEventListener("click", () => {
            if (!Room.codeHidden && !Prefs.get().hideCodeAsked) { $("hide-code-ask").hidden = false; return; }
            Room.hideCode(!Room.codeHidden);
        });
        const answerHideAsk = (always) => {
            $("hide-code-ask").hidden = true;
            Prefs.set({ hideCodeAsked: true, ...(always ? { hideCode: true } : {}) });
            Room.hideCode(true);
        };
        $("btn-hide-once").addEventListener("click", () => answerHideAsk(false));
        $("btn-hide-always").addEventListener("click", () => answerHideAsk(true));
        $("btn-invite").addEventListener("click", () => { render(); $("invite-modal").hidden = false; });
        $("btn-invite-done").addEventListener("click", closeInvite);
        $("invite-modal").addEventListener("click", (e) => { if (e.target === $("invite-modal")) closeInvite(); });
        $("btn-watch").addEventListener("click", () => Room.watchInstead());
        $("btn-take-seat").addEventListener("click", () => Room.takeSeat());
        $("btn-room-bot").addEventListener("click", () => Opponent.open(Settings.game));
        $("btn-room-bot-off").addEventListener("click", () => { Settings.setBot(null); render(); });
        $("btn-opponent").addEventListener("click", () => Opponent.open(Settings.game, Settings.read(), Room.online ? Settings.bot : null));
        $("btn-howto").addEventListener("click", () => Learn.openHowto(Settings.game));
    }

    return { init, render, closeInvite, DONE_MS };
})();
