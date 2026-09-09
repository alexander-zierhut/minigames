# Chain React & Five Wins

Two nostalgic two-player minigames in one static page.

- **Chain React:** place pieces in cells; a full cell explodes into its neighbours and
  can set off long chains. Take the whole board to win.
- **Five Wins:** place a stone anywhere on the grid. First to get five in a row wins.

Static site, no build step, no backend. Create a room once, share the link, then pick
games and settings together in the room lobby; rematch or switch games without new links.

## Play

- **On one device:** two people share a screen or phone.
- **Online:** one player creates a room and shares the link (or the 5-letter code).
  Both players typing the same code also works. Uses PeerJS: the public PeerJS broker
  only brokers the handshake, then the game runs peer to peer.

Settings (board size, animation speed, chess-style timer, chain-win rule, stones in a
row) are shared live in the room lobby; either player can change them. The look (Classic,
MC board, Minecraft) is a per-device choice on the title screen. A page refresh rejoins
the room and re-syncs the game. Emoji reactions for trash talk are in the top-right corner.

## Deploy

Upload `index.html` and the `client/` folder to any static host (S3, GitHub Pages, …).
Share links are built from the page's own URL, so it works under any path.

## Files

- `client/game.js`  Chain React rules, board rendering, explosion animation
- `client/five.js`  Five Wins engine
- `client/clock.js` per-player chess clock (pauses during animations)
- `client/net.js`   PeerJS room transport with reconnects
- `client/app.js`   title screen, lobby, local and online flow, rematch
- `client/main.css` classic skin, plus the Minecraft skin under `body.skin-mc`
- `client/textures/` 16×16 block textures used by the Minecraft skin
- `client/vendor/peerjs.min.js` PeerJS 1.5.4
