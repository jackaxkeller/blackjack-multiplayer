# Arcade Blackjack Royale, online edition

This package converts the single-file lobby prototype into true online multiplayer using a small Node + WebSocket server.

## Files

- `server.js` — serves the game and hosts WebSocket lobbies
- `public/index.html` — the updated blackjack game
- `package.json` — Node dependencies and start script

## Run it

1. Install Node.js 18+.
2. In this folder, run:

```bash
npm install
npm start
```

3. Open `http://localhost:3000` in your browser.
4. One player clicks **Create Lobby**.
5. Other players open the same URL and click **Join Lobby** using the generated code.

## Hosting online

Deploy the folder to any Node-friendly host. The game expects the WebSocket endpoint at the same origin under `/ws`, so the HTML and server should stay together.

## Notes

- The host client is still the table authority. The server handles lobby creation, membership, and message relay.
- A lobby supports up to 4 humans total: 1 host + 3 guests.
- If the host disconnects, the lobby closes for everyone.
- The HTML still references the same background MP3 filename used by the original file. Keep that audio file alongside `public/index.html` if you want music.
