# Game Arcade — Barricade + Infinite Tic Tac Toe

Two 2-player web games with a menu, **Player vs Computer (PvE)** and **Player vs Player (PvP)** online rooms.
Built with **Node.js + Express + Socket.io** and a lightweight **Vanilla HTML/CSS/JS** front end.
Fully **responsive** (works on phones and desktops). Ships with a **Dockerfile** and **docker-compose.yml** for Runflare.

## Games

### Barricade (Quoridor rules)
- 9×9 board. P1 starts bottom-center and races to the top row; P2 starts top-center and races to the bottom row.
- Each turn: **move your pawn** one tile orthogonally (with pawn-jump over an adjacent opponent) **or place a wall**.
- 10 walls per player, each 2 tiles long. Walls can't overlap or cross.
- **Golden Rule:** a wall is rejected if it would leave *either* player with no path to their goal. Enforced server-side with a BFS pathfinding check.

### Infinite Tic Tac Toe
- 3×3 board, normal 3-in-a-row win.
- Each player may have **at most 3 marks**. Placing a 4th removes your **oldest** mark (FIFO) *before* the win check — so there are no draws.
- The about-to-vanish mark blinks so you can plan around it.

## Run locally
```bash
npm install
npm start          # http://localhost:3000
npm test           # pure-logic unit tests
node test/e2e.js   # live socket.io integration tests
```

## Run with Docker
```bash
docker compose up --build
# open http://localhost:3000
```

## Deploy on Runflare (Docker app)
1. Push this folder to a Git repo (or upload it) and point your Runflare Docker app at it.
2. Runflare builds the `Dockerfile`. The app listens on **port 3000** (`PORT` env var is honored if Runflare assigns a different port).
3. Expose/route port 3000 to your domain. The `/healthz` endpoint returns `{"ok":true}` for health checks.
4. Socket.io uses standard HTTP/WebSocket on the same port — no extra config needed. Make sure WebSocket upgrades are allowed (they are by default on Runflare HTTP routes).

## How PvP works
- "Create Online Room" generates a 4-character code; share it with a friend who picks "Join with Code".
- The **server holds the authoritative game state** — clients only send intents (`move` / `wall`) and render the state the server broadcasts. This prevents cheating and keeps both screens in sync.

## Project layout
```
server.js              Express + Socket.io, room registry, AI driver
game/quoridor.js       Barricade engine + BFS wall validation
game/quoridorAI.js     Barricade computer opponent
game/infiniteTTT.js    Infinite TTT engine (FIFO)
game/tttAI.js          TTT computer opponent
public/index.html      Menu + game UI
public/style.css       Responsive styling (mobile + desktop)
public/js/*.js         Renderers + socket client
test/run-tests.js      Unit tests (18)
test/e2e.js            Integration tests (10)
Dockerfile             node:18-alpine production image
docker-compose.yml     Maps port 3000
```
