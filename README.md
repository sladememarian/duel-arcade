# The Arcade — eleven games, one ledger

A small university arcade: **eleven games**, shared accounts, and one points ledger that
ties them together. Solo runs, head-to-head rooms, party games for three or more, and a
live pari-mutuel horse race.

Built with **Node.js + Express + Socket.io** and a **vanilla HTML/CSS/JS** front end.
MongoDB runs **inside Docker Compose** — there is no external database or third-party
service to wire up. The interface is a warm paper-and-ink editorial theme: serif display,
mono metadata, no emoji chrome.

## Games

| # | Game | Players | How you win |
|---|------|---------|-------------|
| 01 | Barricade (Quoridor) | 2 | Reach the far row, or wall your rival into a longer road |
| 02 | Infinite Tic Tac Toe | 2 | Three marks each; the fourth removes your oldest |
| 03 | Connect 4 | 2 | Four in a row, any direction |
| 04 | Reversi / Othello | 2 | Flip the most discs |
| 05 | Island | 3–10 | Whisper, vote, survive; ghosts decide the final two |
| 06 | Trivia Royale | 3–12 | Same questions for all; faster correct answers score more |
| 07 | Word Bomb | 3–8 | Submit a word containing the bigram before the clock ends |
| 08 | Ink Rush | 3–8 | Tap the **ink colour**, not the word; faster is better |
| 09 | 2048 | Solo | Merge tiles, finish a run |
| 10 | Memory Match | Solo | Clear the board in few moves and little time |
| 11 | The Derby | Everyone | Wager points on a live race; winning tickets split the pool |

Two-player games offer **matchmaking**, **private rooms** (four-character code), and
**play vs. computer** at easy or hard strength. Party games offer matchmaking, private
rooms, and host-added bots. Matchmaking needs a signed-in account.

## Points and prizes

Every game has a fixed prize pool. An **online** win (real humans) pays substantially more
than **offline** play against the computer, so the overall board rewards competition rather
than grinding.

| Game | Offline win | Online win |
|------|------------:|-----------:|
| 2048 / Memory Match (solo completion) | 20 | — |
| Infinite Tic Tac Toe | 35 | 110 |
| Barricade / Connect 4 / Reversi | 45 | 140 |
| Trivia Royale / Ink Rush | 55 | 190 |
| Word Bomb | 55 | 200 |
| Island | 60 | 220 |

- **Two-player runner-up** receives 15% of the pool (for example 21 of 140 online).
- **Party games** pay second place 40% and third place 20%. Island is winner-takes-all.
- A party room counts as *online* only when enough humans are present; bot-filled rooms
  pay the offline rate. If no humans arrive within 30 seconds, matchmaking fills the room
  with the house so you can still play.
- **The Derby** does not use a fixed pool. Bets are deducted atomically when placed, and
  the whole pool is split among winning tickets (a longshot pays more). If nobody backed
  the winner, every stake is refunded.
- Points live on the server, never in the browser. The account cap is **60**.

## Accounts and security

- Usernames: 3–16 characters, letters, numbers or underscore.
- Passwords: 8–72 characters, at least one letter and one number.
- Stored with **scrypt** (`N=16384, r=8, p=1`), a per-user random salt, and constant-time
  comparison. No native build steps and no password hashing dependency.
- Sessions are random 32-byte tokens in an `HttpOnly`, `SameSite=Strict` cookie
  (`arcade_sid`), valid for seven days. Only a **keyed SHA-256 hash** of the token is stored
  in MongoDB, keyed by `SESSION_SECRET`.
- Registration and login are rate-limited per IP; repeated failures lock one username.
- State-changing HTTP requests require `application/json`, and a supplied `Origin`
  must match the host (cross-origin forms are refused).
- Security headers include CSP, `X-Frame-Options: DENY`, `nosniff`, and a restrictive
  permissions policy. The client never receives a password hash or session secret.

## The Derby

A single global loop runs continuously: **45 s of betting**, a **15 s race**, then **9 s of
results**. Odds are pari-mutuel — the multiplier shown on each horse is `total pool / that
horse's pool`, so money moving to one horse shortens its price. The winner is drawn
uniformly at random when betting closes. Bets are clamped to 10–5000 points and deducted
server-side before they are accepted.

## Architecture

- **The server is the single source of truth.** Pure engines live in `game/*.js`; the
  server owns turns, phase timers, bots, scoring and cleanup. Clients send intents and
  render what they are told.
- `server.js` — HTTP API, security middleware, socket handlers, room registry,
  matchmaking, the derby clock, and points awarding.
- `db.js` — MongoDB layer for users, sessions (with a TTL index), scores, point events,
  races and bets. It **fails soft**: if Mongo is unreachable the arcade still serves and
  plays, but accounts, points, leaderboards and betting are disabled.
- `auth.js` — scrypt hashing, cookie parsing/serialisation, token hashing, rate limiters.
- `game/prizes.js` — the economy; `game/wordlist.js` — Word Bomb dictionary and bigrams.
- `public/` — one page, one stylesheet, one script per game. `main.js` exposes
  `window.Arcade` and owns the shell; `auth.js` runs last and boots the session.

## Run locally

```bash
npm install
npm start              # http://localhost:3000
npm test               # pure-logic unit tests (66)
npm run test:e2e       # socket.io integration tests, isolated server (34)
npm run test:e2e:live  # DB-backed suite against a running stack (34)
```

`npm start` expects MongoDB at `mongodb://127.0.0.1:27017` by default. Without it the app
still boots and the games work, but accounts, points and betting stay disabled. Use Docker
Compose for the complete experience.

`test:e2e:live` defaults to `http://localhost:3000`; set `BASE_URL` to target elsewhere. It
registers throwaway accounts and verifies real Mongo persistence, solo cooldowns, awards,
leaderboards, matchmaking, Derby wagers and both party games, so it needs the app and Mongo
running. The isolated `test:e2e` suite spawns its own server and does not need a database.

## Run with Docker

```bash
cp .env.example .env       # then set real secrets
docker compose up --build  # http://localhost:3000
```

Compose starts two services: `games` (the app) and `mongo:7` on a private network. Mongo is
not published to the host. Only the app's port 3000 is exposed. Both services have
healthchecks, restart policies, memory limits and capped JSON logs.

### Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `MONGO_URL` | `mongodb://127.0.0.1:27017` | Set by Compose; internal to the compose network |
| `MONGO_DB` | `arcade` | Database name |
| `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` | — | Compose Mongo credentials (required) |
| `SESSION_SECRET` | — | Keys session-token hashes; use 64+ random hex characters |
| `MAX_USERS` | `60` | Account cap |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `NODE_ENV` | — | `production` enables one-hour static caching |

The shell HTML is always served `Cache-Control: no-cache`, so a deploy is picked up on the
next load.

## 60-player load test

The load harness seeds 60 real accounts and sessions inside the app container (bypassing the
5-registrations-per-10-minutes limiter), opens 60 authenticated WebSocket clients, and runs a
worst-case mix: 12 Infinite TTT rooms, 6 Word Bomb rooms of 4, 2 Ink Rush rooms of 6, and all
60 players placing a Derby wager in the same betting window. It samples `/healthz` every
500 ms and reports latency, message counts, peak memory and cleanup.

```bash
docker cp test/load-seed.js game-arcade:/tmp/load-seed.js
docker exec game-arcade node /tmp/load-seed.js seed 60 /tmp/load-users.json
docker cp game-arcade:/tmp/load-users.json ./load-users.json
docker compose restart games              # fresh 45 s Derby betting window
USERS_FILE=./load-users.json npm run test:load
docker exec game-arcade node /tmp/load-seed.js clean /tmp/load-users.json
```

On PowerShell, use `$env:USERS_FILE = ".\load-users.json"` and optionally
`$env:DURATION_MS = "65000"`. The seeded accounts are named `load_<runid>_NN`; cleanup removes
only those accounts plus their sessions, scores, point events and bets. The shared seed
password is for the test database only — never point this harness at production.

## Monitoring

- `GET /healthz` returns JSON: database status, uptime, RSS/heap, load average, live rooms,
  connected sockets and the derby phase. Point your monitor at it.
  ```json
  {"ok":true,"db":"online","uptimeSeconds":3600,"memory":{"rssMB":96,"heapMB":38},
   "load1":0.12,"rooms":2,"sockets":14,"derbyPhase":"betting"}
  ```
- `docker stats --no-stream` — per-container CPU and memory against the 768 MB (app) and
  512 MB (Mongo) limits.
- `docker compose logs -f --tail=100 games mongo` — application and database logs.
  Logs are already rotated at 10 MB × 3 files.
- `docker compose ps` — health status of both services.
- Optional: run **Uptime Kuma** or any external checker against `/healthz` every 60 s and
  alert on a non-200 response, `"db":"error"`, or an RSS above ~400 MB.
- Watch disk with `docker system df`; the `mongo-data` volume grows slowly (sessions expire
  after seven days) but is the only long-lived data.
- A useful alert set: health endpoint down, database not online, app memory above 80% of
  its limit, and any sustained restart loop.

## Server sizing and measured 60-player load

The target is **60 accounts**, a handful of concurrent rooms, and the Derby broadcast at
2.5 Hz. The included stack was measured with 60 authenticated WebSocket clients:

- 20 concurrent rooms: 12 Infinite TTT, 6 Word Bomb (4 players each), 2 Ink Rush (6 players
  each). All 12 TTT games completed, and all 6 Word Bomb and 2 Ink Rush rooms reached final.
- 60 simultaneous Derby wagers — a deliberate thundering-herd worst case — all accepted,
  producing 15 winning payouts, 6,120 `derbyState` messages and 135 points events
  (60 wager debits + 75 awards).
- **Zero** failed connections, unexpected disconnects, socket errors or task timeouts.
- `/healthz`: **p50 21 ms, p95 33 ms**, one **1.2 s** spike during the all-at-once wager
  burst, and 14 ms after cleanup. Final state: 0 sockets, 0 rooms.
- TTT move round-trip: p50 73 ms, p95 95 ms (measured through the busy load-client event
  loop). Wager acknowledgement during the burst: p50 1.36 s, p95 2.17 s — normal wagers are
  spread over the 45 s window and do not queue like this.
- App container: peak working set ~37 MiB of 768 MiB; Node process RSS peaked at 79 MB. CPU
  was mostly 0.7–20% with one ~123% burst spike, under the 1.5 CPU limit.
- Mongo: ~298 MB steady of 512 MB in the final run; an earlier cold-start sample reached
  ~458 MB while the cache grew, still under the cap. CPU stayed below 2% except for short
  spikes at settlement.
- Host load average peaked at 0.59; the arcade cleaned up to zero rooms and sockets.

Verdict: the 2 vCPU / 2 GB target is sufficient for 60 seats. The app is far from its limits;
Mongo memory is the tightest resource, so on a 4 GB host raise the Mongo limit to 768 MB (or
keep the 0.25 GB WiredTiger cache) for long-running production. Use HTTPS at a reverse proxy
and set `COOKIE_SECURE=true`.

A standalone deployment report with recommended VM specs, disk/network/OS guidance,
monitoring thresholds and scaling limits is in
[SERVER_REQUIREMENTS.md](SERVER_REQUIREMENTS.md).

Scaling beyond one machine would mean moving Mongo to a managed service and making Socket.io
sessions sticky. That is not needed for sixty seats.

## Project layout

```
server.js              HTTP + Socket.io, rooms, matchmaking, bots, derby, points
db.js                  MongoDB: users, sessions, points, scores, races, bets (fails soft)
auth.js                scrypt, cookies, token hashing, rate limits
game/prizes.js         Prize pools and place factors
game/wordlist.js       Word Bomb dictionary + fair bigrams
game/wordbomb.js       Word Bomb engine
game/inkrush.js        Ink Rush engine
game/derby.js          Derby engine (pari-mutuel odds, race, payout)
game/quoridor.js       Barricade engine + BFS wall validation · quoridorAI.js
game/infiniteTTT.js    Infinite TTT engine (FIFO) · tttAI.js
game/connect4.js       Connect 4 engine · connect4AI.js
game/reversi.js        Reversi engine · reversiAI.js
game/island.js         Island engine (whisper / vote / ghost vote)
game/trivia.js         Trivia engine · triviaQuestions.js
public/index.html      Auth, shell, menu, all game screens
public/style.css       Paper-and-ink design system, responsive
public/js/main.js      window.Arcade: navigation, matchmaking, board flow, points
public/js/auth.js      Sign in / register / sign out, session boot
public/js/{island,trivia,wordbomb,inkrush,derby}.js
public/js/{barricade,tictactoe,connect4,reversi}.js  Board renderers
public/js/{g2048,memory,leaderboard}.js
test/run-tests.js      Pure-logic unit tests (66)
test/e2e.js            Socket.io integration tests, isolated server (34)
test/e2e-live.js       DB-backed live suite: auth, points, awards, derby, party games (34)
test/load-seed.js      Seeds/cleans 60 real accounts inside the app container
test/load-60.js        60-player load simulation + /healthz sampling
Dockerfile             node:20-alpine, non-root user, npm ci
docker-compose.yml     App + MongoDB 7, internal network, healthchecks, limits
```
