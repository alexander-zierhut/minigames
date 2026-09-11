---
paths:
  - "client/room.js"
  - "client/lib/net.js"
  - "client/session.js"
  - "client/chat.js"
  - "tests/unit/net.test.mjs"
  - "tests/e2e/online*.test.mjs"
---

# Online play: rooms, protocol, presence, spectators

The PeerJS transport, the room protocol and its every message, seats and presence, the room's bot, spectators, TURN, desync detection, the session and the gotchas already hit. The core context is `AGENTS.md`; the table (`match.js`) is in `games.md`.

## Online play (`client/lib/net.js` + protocol in `client/room.js`)

- Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; `normalizeCode` maps O→0,
  I/L→1. Peer id = `chainreact-v1-<CODE>`.
- **Two codes per room (#29)**: the room code (players) and an independent **spectator
  code** (`Net.randomCode()`, never derived from the room code). The host registers a
  **second peer** `chainreact-v1-s-<SPECTATOR CODE>` (`Net.hostSpectators(code)`,
  `Net.SPEC_PREFIX`; retried 4× on `unavailable-id`, torn down in `leave()` and whenever
  this device stops hosting). Viewers open the room with `Net.open(spec, handlers,
  "spectator")`: they dial that peer, never claim a room id (no takeover) and never learn
  the room code. Such connections are tagged `spectator: true` in `Net.peers` and can never
  hold a seat. The spectator code is room state the players share (`Room.spec`, in `state
  {spec}` to seated guests only and in the session), so whoever ends up hosting registers
  the same viewer peer and the spectate link keeps working.
- **Transport role**: whoever claims the room peer id is `host`; on `unavailable-id` the
  others become `guest` and dial the host — so "Create room" and "both type the same
  code" share `Net.open(code, handlers, preferredRole)` (`preferredRole` = `"guest"` /
  `"spectator"` / undefined). The host keeps **one
  DataConnection per guest** (`conns`, each `{ c, id: "c<n>", seat, meta, spectator, lastPong }`):
  `Net.send(obj)` broadcasts from the host (guests send to the host), `Net.sendTo(id,
  obj)` / `Net.sendExcept(id, obj)` address one guest / all but one, `Net.peers` lists
  `{ id, seat, meta, spectator, open, silent }`, `Net.setSeat(id, seat)` tags a connection
  with the seat the app assigned, `Net.setSpectate(id, on)` with "does not want one" (#39). `Net.connected` = at least one open connection (host) / the
  host connection (guest). Handlers get the connection id: `onOpen(role, id)`,
  `onClose(reason, id)`, `onMessage(msg, id)` (`"host"` on a guest); `admit(meta,
  peers)` lets the app decide whether a newcomer may join. `handlers.preferHost` (a former
  host refreshing) retries the claim 4× before giving in. A guest whose dials hit
  `peer-unavailable` twice **takes over** the room id (`claimHost`), so the room lives
  on as long as anyone is in it and a host who left can come back by the same link (it
  then joins as guest). Roles can therefore swap; the app never derives seats from them.
- **Seats** (`Match.me`, player number 0…`players`−1, −1 = none) are sticky for a room
  visit: creator = 0, session restore = saved seat, a joining guest gets one from the
  host. Handshake on every (re)connect: guest → `hello {seat, spectate, name, rematch}` (seat
  −1 = none) → host assigns (`msg.seat` if it is < `players` and free, else the first
  free seat, else −1), tags the connection (`Net.setSeat`, `Net.setMeta` for the name),
  answers `state {you, phase,
  settings, names, config, g, rematch}` to that guest (+ `sync` in a game) and a `roster` to
  everyone → the guest takes `you`, mirrors settings, starts/continues the game, answers
  `sync`. `rematch: true` = "I pressed Rematch while you were away": the host counts the
  vote and passes it on as a `rematch` message, so a request never gets lost. The
  number of seats is `config.players` (`playersNow()`: the running game's, else the
  settings'); when the *Players* setting changes the host **reseats** (`reseat`): seats ≥
  `players` are taken away (`state {you: -1}`), people without a seat get a free one.
- **The room's bot (#36)**: instead of waiting for the friend, a two-seat room can put a
  bot on the empty seat. It is **room state in the config** (`config.bot = { id, difficulty,
  seat }`, seat 1 by default and everywhere read off `config.bot.seat`, never a constant, so
  "Play from here" (#43) can seat the bot on 0 instead, see Settings in `ui.md`), so it travels in
  `lobby {s}` / `start {config}` / `state` and
  everybody sees "Bot / ready" on that seat card, the *Opponent* row to change the level and
  an enabled Start. `#btn-room-bot` opens the usual bot modal (Play sets it, with the room's
  settings, so a rule variant picks a bot that knows it), `#btn-room-bot-off` clears it; if the
  room's rules change under a bot that cannot play them, `Match.setupBot` puts
  the one `Opponent.current(game, config)` names on the seat instead.
  The **transport host runs the seat** (`Match.makeSeats` asks `hostsBot()` =
  `Room.isHost`; for everybody else it is a `remote` seat called "Bot"): `botTurn` relays its
  move through `onLocalMove` like a click, its persona's reactions go out through
  `onBotReact` as `react {from: <bot seat>}`, and `Room.onRole` → `Match.refreshSeats()` hands the
  seat to whoever hosts after a takeover or a refresh (a fresh seed then, which is fine).
  Presence treats the bot seat as present while its host is (`presentSeats`), `allHere()`
  therefore works with nobody else in the room, `rematchComplete()` counts the bot as having
  voted, and `takenSeats` protects its seat. **A person always beats the bot to a seat**: it
  steps aside (`dropBot`, a toast, a `lobby` message) when a friend joins the lobby with no
  free seat left, and when everyone is back in the lobby with somebody waiting for a seat
  (`Room.enteredLobby()`, called by app.js's `backToLobby`); during a running game the
  newcomer simply watches. Spectate-link viewers never displace it.
- **Swapping seat and spectator role (#39)**, in the lobby only (never under a running
  game): `Room.watchInstead()` / `Room.takeSeat()` send `seat {want}` (`-1` = watch, a seat
  number, or `Room`'s `ANY_SEAT`); the host decides in `applySeatWish` (its own switch takes
  the same path with `id = null`): it frees the seat (`Net.setSeat(id, -1)` +
  `Net.setSpectate(id, true)`, so a later `reseat` does not hand it straight back and the
  next dial's metadata says the same) or gives a free one, then answers `state {you}` to
  that connection and a `roster` to everyone. `Room.setSeat` follows through everywhere:
  `Match.setSeat`, the address bar (`&spectate=1` next to `?room=` for a seatless player, so
  a refresh keeps the role; the spectate link is a different thing, see below), the net box, the lobby, the Rematch buttons and the session. A spectate-link
  connection is refused (`spectator` in `Net.peers`), and the *Players* control alone never
  re-seats somebody who chose to watch — only "Take a seat" does.
- **Presence** (`presentSeats()`): the host derives it from its connections (an open
  connection with that seat, not in Room's `left` set), guests from the host's `roster
  {present[], spectators, left[], names[]}` message (sent on every change: hello, close,
  leave, reseat, a new name). `allHere()` = every seat filled and my connection up; `live()` = `!online ||
  allHere()` gates input and the clock (`syncLive()` pauses/resumes on every presence
  change). Start needs `allHere()` ("Waiting for your friend…" with two seats, else
  "Waiting for N more player(s)…"). The in-game banner (`updateBanner`) says who is
  missing (2 players: the classic "Your friend left the room…" / "seems to be away"
  texts; more: "Waiting for Bo, Cy (left the room). The game resumes when everyone
  is back."). Texts use `who(seat)` = "Your friend" with two seats, else the seat's name.
- **Names (#35, `Room.names()`)**: per seat the name of whoever sits there. My own seat is
  always my own `Prefs.name` (`myName()`, so a rename shows instantly); the **host** reads the
  others off its connections (`Net.peers[].meta.name`, kept by the dial's `metadata` and by
  `Net.setMeta(id, patch)` on `hello` and on a `name` message), a **guest** off the host's
  `roster.names` (and off the `names` in the `state` it gets on connecting). A seat nobody
  holds keeps the last name seen there (`r.lastNames`), so a card that says "not here yet"
  still names the person; a seat we never saw anybody in is `Player k` (1-based). Every
  arriving name goes through `Prefs.cleanName` before it is shown, and only ever as
  `textContent`. Duplicate names in one room are allowed. `Room.nameChanged()` (app.js calls
  it when the preference changed) re-rosters on the host and sends `name {name}` to the host
  on a guest — `name` is **not** relayed: the host owns the roster and passes the change on
  in it, so everyone, spectators included, agrees on who is called what. Every text that used
  to say a colour goes through this: the lobby seat cards, the HUD player cards, "X starts.",
  "X wins!", "X is out.", chat lines (`Chat.init`'s `name(seat)` → `Match.names`), the banner,
  the toasts ("Settings updated by …", "… wants a rematch", "… went back to the room") and
  the turn hint "waiting for X…". Offline the names come from `Prefs.seatNames()` instead
  (app.js's `seatNames()` picks; `Match.names` still renames a bot seat to "Bot").
- **Accepting a guest** (`accept` in net.js): the guest's dial carries `metadata {seat,
  spectate, name}`; once the data channel is open the host answers `welcome` (the guest
  attaches only then) or `full`. A dial with a seat that an existing connection holds
  replaces that connection (the same person back after a refresh). Otherwise the app's
  `admit(meta)` decides (`admitGuest`: a free seat exists, or the seat it names is free,
  or it wants to spectate); refused newcomers get `full` — unless some connection has
  stopped answering pings (> 6 s): that stale one is dropped in the newcomer's favour.
  **The same peer id dialling again always replaces its old connection** (newest wins): a
  guest whose first dial stalled retries after 8 s, and without this the host counted one
  spectator twice on the slow CI runner (a seat-less dial is not deduped by seat).
  `Net.peer` is exposed for that e2e check only.
  `full` is not final on the guest: it shows "This room is full…" (status `error`) and
  quietly redials every 5 s, because the "friend" may be its own stale connection the
  host hasn't noticed as dead yet (a slow CI machine hit exactly that). Connection
  handlers check the entry is still in `conns` (guest: `conn === c`) so a replaced
  connection's close is ignored. A dial that gets no data channel within 8 s is closed
  and retried.
- **Relay**: `onMessage` on the host stamps every guest message with `from` = the
  connection's seat and forwards the types in `RELAY` (`move, chat, react, tolobby,
  rematch, timeout, lobby, review`) to the other guests (`Net.sendExcept`) before handling
  them itself; messages the host originates carry `from: Match.me` (`netSend`). So every
  message everywhere says which seat sent it (−1 = a spectator). `sync` is pairwise
  (host ↔ one guest: `sendSyncTo` on hello, broadcast `sendSync` after a rematch or when
  the host wants everyone's state), `state`/`roster` come from the host only.
- A former host whose id was taken over while its tab slept (`unavailable-id` with
  `everConnected`) joins as guest at once; only a fresh page (refresh) retries the claim.
- **Newest intent wins** (`Room.rev`): every phase change (start, rematch, back to room)
  bumps a room-state revision on both sides. `hello` and `state` carry `rev, phase,
  config, g`; a host whose guest reports a higher `rev` adopts the guest's phase before
  answering (`adoptRoomState`), a guest follows the host when `rev` is equal or higher.
  So "one tab died, the other went back to the room / started a rematch, the tab comes
  back" never drags anybody back into a stale game, whoever ends up hosting. The
  revision is part of the session, so a refresh keeps it.
- **Desync detection** (`Game.hash()`: FNV-1a over cells/current/over/winner/movesBy/out):
  `move` carries the sender's hash before the move, `sync` the sender's hash. A move
  whose hash doesn't match is not applied; a sync is requested instead. `applySync`:
  identical prefix + longer history → the short side replays the tail; a prefix
  mismatch, a hash mismatch at equal length, or the host still lacking moves the guest
  already sent (`syncSentAt`) → `resolveDesync`: the host just re-sends its sync,
  the guest rebuilds the game from the host's history (`rebuiltAt` remembers the
  attempt). A second mismatch at the same point → both back to the room with a toast,
  never two different games.
- Share link = `<page URL without query>?room=CODE` (`Room.roomLink()`); `?room=` on load
  auto-joins; `history.replaceState` keeps `?room=` in the address bar while in a room, with
  `&spectate=1` appended for somebody who is in the room by its **room code** but holds no
  seat, so a refresh keeps that role. That parameter is **not** the spectate link:
  **spectate link = `?watch=<SPECTATOR CODE>`** (`Room.spectateLink()`, #29), a code of its
  own, so removing a parameter can never promote a viewer, and such a viewer's address bar
  carries only `?watch=` (see Spectators).
- **Hidden room code** (#19, streamers): `Room.hideCode(on)` / `Room.codeHidden` — the
  lobby code and the HUD net box show `•••••` (`Room.codeText()`), `setUrlRoom` drops
  `?room=` from the address bar, the session stores `codeHidden`, and the boot rejoins a
  hidden room from the session alone (no `?room=` needed; a visible room still needs the
  matching `?room=`). `Net.code`, the share / spectate links and `Copy code` are untouched
  — hiding is display only, per device, never sent to the room. The lobby's eye button
  (`#btn-hide-code` in the Invite modal, the eye / eye-off icon, "Hide the room code" / "Show the room code") toggles it; `Prefs.hideCode` makes new rooms start hidden
  (`Room.enter(code, { hidden: Prefs.get().hideCode, … })`).
- Messages (JSON over reliable DataConnections; every message carries `from` = the
  sender's seat; game messages carry `g` = gameNo): `hello {seat, spectate, name, rev, phase,
  config, g, rematch}`, `state {you, settings, names, rev, phase, config, g, rematch, spec}` (host →
  one guest; `spec` = the room's spectator code, only to a seated guest, #29),
  `roster {present, spectators, left, names}` (host → all), `name {name}` (#35:
  I renamed myself; guest → host only, never relayed — the host stores it on that connection
  and sends a fresh `roster`), `welcome`/`full`
  (transport level, host → guest on accept/reject), `lobby {s}` (settings changed;
  relayed; the host reseats), `start {config, g, prefix?}` (host started; `prefix =
  { history, outs }` starts the game from a position instead of an empty board, #43), `start-request` (a
  guest asks; host is authoritative), `tolobby` (anyone; abandons a running game;
  relayed), `sync {g, history, outs, clocks, h}` (on (re)connect / on gaps: the shorter
  side replays the missing tail + eliminations; deferred with `Match.whenIdle(…, "sync")` while
  animating), `move {i, n, g, h}` (`n` = history length before the move; queued in
  Room's `incoming`, applied when idle and `n` matches, else a sync is requested;
  relayed), `timeout {p, g}` (only the owner of the flagged clock decides — clocks drift;
  relayed; deferred through `Match.flagged` → `whenIdle` while animating; → `engine.eliminate`), `rematch
  {g}` (every seat must press: Room's `votes`; relayed; the overlay button shows
  "Waiting for opponent…" / "Waiting for others… (k/N)" / "Accept rematch"), `review
  {ply, play, g}` (#38: I am looking at the position after `ply` moves of the finished game;
  relayed; receivers in the same finished game show the same ply and open the replay bar,
  spectators included; `play: true` (#43) also starts their own Play timer from that move,
  `play: false` / a plain `review` pauses it), `seat {want}` (#39: a guest asks the host for a seat (`-1` = to
  watch instead); not relayed, the host answers `state` + `roster`; a spectate-link
  connection is always refused), `react
  {e}` (relayed; dot in the sender's colour), `chat {text}` (relayed, see Chat in `ui.md`), `leave`
  (sent 250 ms before closing; the app treats that seat as gone at once — Start is
  disabled before the connection actually drops; the host tells the others via
  `roster.left`), `ping`/`pong` every 3 s per connection, 12 s silence → that connection
  is dropped → the guest redials. `rematch` with `g <= gameNo` is ignored (duplicates).
  Handlers live in `HANDLERS` in room.js and receive `(msg, id)`; the state they keep is the `r` object at the top of room.js (`rev, roster (with the seat names), lastNames, left, netDetail, votes, incoming, syncSentAt, rebuiltAt`) — everything about *who sits where* is `Match`.
- **ICE servers / TURN** (`iceServers()` in net.js): STUN alone cannot connect two players
  who are both on mobile data (carrier-grade NAT; the owner hit this on the go). So every
  `open()` fetches the ICE list (STUN + TURN with credentials) from the owner's **Metered**
  account's credentials API (`alzlper.metered.live`, credential-scoped API key, free plan
  0.5 GB/month — plenty, a move is a few bytes; WebRTC relays only without a direct path),
  exactly as Metered documents for browser apps. Cached 20 min; on failure/timeout (4 s)
  STUN-only is used (tests and local dev work either way). The endpoint is stored in
  `RELAY_SRC` reversed + base64 (`relayUrl()`) so crawlers grepping for `turn:` or the key parameter
  don't harvest it; it is not a secret and the owner doesn't mind the free account —
  just don't publish it in an obvious place (no `turn.json`, no plain string). Metered has
  no domain restriction and the owner explicitly rejected a rotation workflow as unreliable.
  The Peer is created asynchronously (`createPeer`, guarded by `openGen` so a room left
  meanwhile is ignored) with `Net.peerConfig(servers, relayOnly)`: **"Keep my IP always
  private"** (#30, `handlers.relayOnly()` = `Prefs.privateIp`) sets `iceTransportPolicy:
  "relay"`, so this side offers relay candidates only and nobody in the room learns its IP
  (the other side may still connect directly to the relay; only my own preference relays
  my side). `Net.iceInfo` = `{ relayOnly, turn, servers }` of the current peer; relay
  demanded but no TURN entry in the list (Metered unreachable) → status `error` with
  `NO_RELAY_TEXT` on every dial. The e2e `online` suite verifies the selected candidate
  pair is `relay` on the host's side through `getStats()`. After 3 dials whose data channel never opened while the host is
  registered (`channelFailures`, or repeated `webrtc` errors) the status becomes `error`
  with a plain hint to try Wi‑Fi.
- **Guest dial handshake**: the guest listens for data from the start (under load the
  host's first message can arrive before the guest's own `open` event) and attaches once
  the channel is open *and* the host sent `welcome` (a host `ping` counts too).
- Statuses: `idle, connecting, waiting, connected, reconnecting, signaling, error`.
  `signaling` = broker socket dropped (tab suspended); an established DataConnection
  keeps working without the broker → no in-game banner for it. The host is `connected`
  while at least one guest is; losing the last one → `reconnecting`, losing one of
  several keeps `connected` (the banner then comes from presence, not from the status).
  `everConnected` picks the wording ("isn't here yet" vs "seems to be away");
  `ERROR_TEXT` maps PeerJS error types to plain sentences. `visibilitychange`/`online` →
  `Net.retryNow()`. The HUD net box shows "Waiting for N…" when seats are empty (3+).
- Page refresh: `sessionStorage["chainreact.session"]` = code (the spectator code for a
  viewer), me (seat), spectator, watch, spec, role, gameNo, rev, phase, config, history,
  outs, clocks, codeHidden. With a matching `?room=` / `?watch=` (or a hidden code) the
  board is rebuilt from it (`replay(history, outs)`), then the handshake fills in the rest.
  `spec` is what lets a refreshing host register the same viewer peer again.
- Takeover with several guests: every guest that misses the host twice tries to claim
  the id; one wins, the others get `unavailable-id` and dial it. The new host keeps its
  own seat, hands the others theirs back on `hello`, and a spectator that happens to
  win the claim stays a spectator (`onRole` gives seat 0 only to a seatless non-spectator).

### Spectators (`Match.spectator`, seat −1)

There are two ways to end up without a seat, and they differ in one thing only: whether
the device knows the room code.
- **Room-code spectators**: `admitGuest` always says yes, so whoever joins with the room
  code when every seat is taken becomes a spectator (the host's `hello` finds no free seat
  → `state {you: -1}`), as does a player who chose "Watch instead" (#39). They may take a
  seat again ("Take a seat", see Seat switching); `reseat` alone never hands a seat to a
  connection whose `meta.spectate` says it does not want one.
- **Spectate-link viewers (#29)**: the spectate link `?watch=<SPECTATOR CODE>`
  (`#btn-share-spectate` → `Room.spectateLink()`) uses the room's second code and the host's
  second peer, so the viewer never receives the room code in any message (`state` carries
  `spec` only to seated guests; `roster`, `sync`, `lobby`, `chat` never carry a code at all,
  and the dev panel prints none). Its connection is `spectator: true` in `Net.peers`: the
  host's `hello` refuses it a seat whatever the message says, `reseat` skips it and it can
  never take a seat. Its lobby shows "Watching" instead of the code, with no eye and no
  share / copy row in the Invite modal (only the spectator link to pass its own link on); the HUD net box says "Watching"
  with no code; `Room.watching` / `Room.codeText()` say so. It never claims the room id, so
  when the host hands hosting over it simply reconnects to the new host by the same link.
Both get everything the host sends (`state`,
`roster`, `sync`, relayed `move`/`chat`/`react`/…): they see the board live with every
cell `locked` (`makeSeats` → all seats `remote`, `mayPlay` false), "spectating" as the
turn hint, "Spectating" in the HUD net box, on the lobby's Start button and on both
Rematch buttons (disabled; a rematch request never shows them the overlay prompt), can
chat ("Spectator: …", class `chat x`) and react (white dot) — the line goes to the host,
which stamps `from: -1` and relays it to everyone like any guest message; a device whose
`muteSpectators` preference is on (Content Creator: "Hide chat and reactions from
spectators") simply does not show spectators' `chat` / `react` (`Room.hides(msg)`, checked
in the two handlers; the host still relays them, so the other players see them) — and step through a finished
game with the replay bar for themselves (their `review` never reaches anyone else). `#lobby-spectators` shows
"N spectator(s) watching" from `roster.spectators`. The session stores `spectator` and
`watch`, so a refresh keeps spectating; `metadata {spectate}` goes with every dial. The sound module
hears a neutral `over` for them. A spectator that wins a host takeover stays seatless.
**Spectators only watch (#29):** the host refuses `Room.PLAYERS_ONLY` messages (`move,
timeout, rematch, tolobby, lobby, start-request, review`) from a seatless connection before
relaying (`Room.accepts(msg, seat)`; a refused `lobby` gets the host's settings back so the
sender's view is corrected) — the same veto path also drops a `lobby` message whose
`s.players` is below `Room.occupiedSeats()` (`Room.keepsSeats(msg, occupied)`, pure), so a
stale or forged message cannot take anybody's seat (#34). `Settings.setLocked(true)` (from `renderLobby`) disables the
picker, the players control and every settings input (`body.settings-locked`,
`#settings-locked-hint`), and in the game the spectator's HUD button says "Leave room"
(leaves the room instead of sending everyone `tolobby`) while the overlay's "Change game"
is hidden (`renderRematch`, re-run on every seat change through `Room.setSeat` →
`onVotes`). Chat and reactions stay allowed.
The old "room is full" answer only remains in net.js for an app that refuses newcomers.

### Gotchas already hit
- Host: the `connection` event fires before the data channel is open → attach on
  `c.on("open")` (or `c.open`), else the first `send` is silently dropped.
- `peer.destroy()` emits `close` synchronously → peer handlers check they still belong
  to the current peer (`bindPeer`), otherwise a demoted host re-scheduled its claim.
- `Room.enter` → `Match.reset("online", …)` clears config/gameNo (a leftover local config once
  made the host skip starting).
- `engine.render()` runs from net callbacks; the engine guards it until a board exists.
- Headless tests: pick the CDP target with `type === "page"`; disable the cache.
- The starter rotates per started game in a lobby, offline too: an e2e test that starts
  its Nth game must not assume seat 0 starts (`party.test.mjs` reads `state.current`).
- Eliminations are not moves: they live in `state.outs` with the history length they
  happened at, never inside `history` (five's `conclude` reads the last history entry,
  `move.n` counts moves). `sync`, the session and `replay` carry them separately.
- The host stamps `from` on every guest message before relaying; guests never trust a
  `from` they wrote themselves. A relayed `lobby` change makes the host reseat, so a
  guest reducing *Players* can drop another guest to spectator — by design.
- `Room.leave` shuts the transport down 250 ms later (so the `leave` message goes out);
  `Room.enter` cancels that timer — otherwise leaving and creating a room within 250 ms
  killed the new room (`Net.open` already closes the old one). The hide-code e2e does that.
- `pkill -f <pattern>` kills your own shell if the pattern is in the command line.

## Lessons learned

- **PeerJS ordering.** The first data message can arrive before the guest's own `open`
  event under load; `destroy()` emits `close` synchronously; a "room full" verdict can be
  the guest's own stale connection — handshake `welcome`/`full`, listen before `open`,
  never treat `full` as final, replace connections that stopped answering pings.
