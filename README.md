# Game Arcade — 8 mini-games

A web arcade with a menu of games spanning **solo**, **two-player (PvE + PvP)**, and **social (3+ players)** modes.
Built with **Node.js + Express + Socket.io** and a lightweight **Vanilla HTML/CSS/JS** front end.
Fully **responsive** (works on phones and desktops). Optional **MongoDB leaderboards** for the solo and trivia
games (fails soft — the arcade runs fine without a database). Ships with a **Dockerfile** and **docker-compose.yml**.

## Games

| Game | Type | Modes |
|------|------|-------|
| Barricade | 2-player | PvE · PvP |
| Infinite Tic Tac Toe | 2-player | PvE · PvP |
| Connect 4 | 2-player | PvE · PvP |
| Reversi (Othello) | 2-player | PvE · PvP |
| 2048 | Solo | + leaderboard |
| Memory Match | Solo | + leaderboard |
| Island | Social (3+) | online rooms + bots |
| Trivia Royale | Social (3+) | online rooms + bots, + leaderboard |

### Barricade (Quoridor rules)
- 9×9 board. Race your pawn to the far row, or spend a wall to lengthen your rival's path.
- **Golden Rule:** a wall that would fully trap *either* player is rejected (server-side BFS check).

### Infinite Tic Tac Toe
- 3×3 board. Each player keeps **at most 3 marks** — a 4th removes your oldest (FIFO), so there are no draws.

### Connect 4
- 7×6 grid. Drop discs to line up four (any direction). AI uses **minimax with alpha-beta pruning**; always takes a win and blocks a loss.

### Reversi / Othello
- 8×8 board. Outflank to flip discs; forced passes and disc-count wins are handled by the engine. AI uses a **positional-weight minimax** (corners are gold).

### 2048 (solo)
- Swipe / arrow-keys to merge tiles toward 2048. Animated tiles, local best score, and an online leaderboard.

### Memory Match (solo)
- Flip cards to find every pair in the fewest moves. 4×4 or 6×6. Scored by moves + time, with a leaderboard.

### Island (3+ players, social deduction)
- **Whisper** privately 1:1, then **anonymously vote** someone out each night (a tie skips the night). Last survivor wins; **ghosts** decide the final two. Host can add **bots**.

### Trivia Royale (3+ players)
- Everyone answers the same multiple-choice question at once — **faster correct answers score more**. Live scoreboard, streak bonuses, podium finish, and an online leaderboard. Host picks the round count and can add **bots**.

## Architecture
- The **server is the single source of truth.** Pure game engines live in `game/*.js`; the server drives them, runs all phase timers, and broadcasts state. Clients send intents and render what they're told — no trusted client logic.
- Two-player games share one PvE/PvP room system. Island and Trivia are socket subsystems with lobbies, bots, and server-owned timers. Solo games are self-contained client modules that post scores to a small REST API.

## Leaderboards (optional MongoDB)
- `GET /api/leaderboard?game=<2048|memory|trivia>` → top scores.
- `POST /api/score` `{ game, name, score, meta }` → saves a score, returns your rank.
- Configure with env vars (a local `.env` is read automatically, and is git/docker-ignored):
  ```
  MONGO_URL=mongodb://user:pass@host:port/db?authSource=admin
  MONGO_DB=arcade
  ```
- If `MONGO_URL` is unset or the database is unreachable, leaderboards quietly disable and every game still works.

## Run locally
```bash
npm install
npm start          # http://localhost:3000
npm test           # pure-logic unit tests (49)
npm run test:e2e   # live socket.io integration tests (34)
```

## Run with Docker
```bash
docker compose up --build
# open http://localhost:3000
```

## Deploy on Runflare (Docker app)
1. Point your Runflare Docker app at this repo. Runflare builds the `Dockerfile`.
2. The app listens on **port 3000** (`PORT` env var honored). `/healthz` returns `{"ok":true,"db":"online|disabled|..."}`.
3. For leaderboards, set `MONGO_URL` (and optionally `MONGO_DB`) as env vars in the Runflare dashboard.
4. Socket.io rides standard HTTP/WebSocket on the same port — WebSocket upgrades are allowed by default.

## Project layout
```
server.js              Express + Socket.io, room registry, AI driver, REST score API
db.js                  Optional MongoDB leaderboard (fails soft)
game/quoridor.js       Barricade engine + BFS wall validation
game/infiniteTTT.js    Infinite TTT engine (FIFO)
game/connect4.js       Connect 4 engine        · connect4AI.js (minimax)
game/reversi.js        Reversi/Othello engine  · reversiAI.js (positional minimax)
game/island.js         Island engine (whisper/vote/ghost phases)
game/trivia.js         Trivia engine + triviaQuestions.js (question bank)
game/*AI.js            Computer opponents
public/index.html      Menu + all game screens
public/style.css       Responsive styling (mobile + desktop)
public/js/*.js         Per-game renderers/clients + shared leaderboard + main wiring
test/run-tests.js      Unit tests (49)
test/e2e.js            Integration tests (34)
Dockerfile             node:18-alpine production image
docker-compose.yml     Port 3000 + Mongo env
```
