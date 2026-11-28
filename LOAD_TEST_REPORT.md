# Load Test & Capacity Report - The Arcade

Date: 2026-11-27  
Target: `https://amirpouyan.cool-elm.boxd.sh`  
VM: `cool-elm`, 2 vCPU, 8 GiB RAM, 98 GB disk, 1 GiB swap  
Stack: Node 20 container (`768 MiB / 1.5 CPU`) + MongoDB 7 container (`512 MiB`, WiredTiger cache `0.25 GB`)

This report supersedes the earlier same-host 60-player baseline in `SERVER_REQUIREMENTS.md`. The
earlier test ran the load generator inside the same Docker host; these tests drive the public
WebSocket endpoint from a separate Windows machine and sample the VM locally.

## 1. Verdict

- **60 players is supported** on the current 2 vCPU / 8 GiB VM with healthy headroom.
- **100 players completed all game rooms** in the public test, but the account cap is 60 and the
  Derby was not exercised at 100. Treat 100 as an upper experiment, not a certified tier.
- **200 players is not supported** with the current Derby broadcast path: all clients connected and
  authenticated, but no game room completed and 55 task errors were recorded.
- **MongoDB is not the bottleneck at 60 players.** The app stayed below one core, host CPU peaked at
  about 21% of the 2 vCPU, VM-local `/healthz` p95 stayed under 5 ms, and there were zero failed
  game-level requests. Do not switch databases to fix concurrency before fixing the Derby broadcast
  and edge latency issues below.
- The public k6 HTTP p95 of ~1.2 s is an edge/TLS/client artifact, not an app-capacity result: k6 had
  zero failed requests, while native Node `fetch` to the same endpoints was ~120-170 ms and
  VM-local `/healthz` was ~2.5-4.5 ms p95.

## 2. Environment and limits

| Item | Value |
|---|---|
| Host | `cool-elm`, region `fra`, Ubuntu 24.04-era kernel (`6.18.0+`) |
| CPU / RAM | 2 vCPU / 7,964 MiB visible RAM |
| Swap | 1,023 MiB, 0 used |
| App container | `game-arcade`, limit 768 MiB / 1.5 CPU |
| Mongo container | `arcade-mongo`, limit 512 MiB, WiredTiger cache 0.25 GB |
| Account cap | `MAX_USERS=60` |
| Auth limits | register 5/10 min/IP, login 25/10 min/IP, username lockout 8/15 min |
| Public edge | `https://amirpouyan.cool-elm.boxd.sh`; boxd `bot_protection: on` |
| Load generator | Windows, Node `v26.8.1`, public WSS/HTTPS |

The 200-player runs seeded accounts directly in the container, bypassing the registration limiter.
The registration cap itself stayed at 60 throughout.

## 3. Method

- Node + `socket.io-client` for real game traffic; k6 cannot drive Socket.IO.
- Weighted mix after the first six players: 30% TTT, 40% Word Bomb, 20% Ink Rush, remaining 10%
  Derby-only. The harness enforces a minimum of six players.
- 60-second game window (65 s when the Derby window was exercised), public WebSocket endpoint.
- `/healthz` sampled every 500 ms; VM-local `/healthz` sampled from the VM for server-side latency.
- App/Mongo CPU, memory and host load sampled with `docker stats`, `free`, `vmstat`, `mpstat`,
  `pidstat`.
- k6 run natively on Windows for HTTP reads and logins. Native k6 was used instead of the Docker
  image because WSL networking made the Docker path slower.

Important metric distinction:

- **Public `/healthz` p95**: includes browser/edge/TLS/Internet path; useful for user experience.
- **VM-local `/healthz` p95**: server process signal; useful for app capacity.
- **Docker CPU %**: percent of one core. The VM has two cores.
- **Host CPU %**: percent of both cores.

## 4. Game-level results

| Players | Connect / auth | TTT / WB / IR rooms | Derby | TTT move p95 | Derby wager p95 | Public health p95 | Task errors | App CPU max | App RSS max |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|
| 10 | 10 / 10 | 1 / 1 / 0 | 10/10 | 169 ms | 278 ms | 265 ms | 0 | 2.2% | 41.2 MB |
| 30 | 30 / 30 | 4 / 3 / 1 | 30/30 | 216 ms | 746 ms | 212 ms | 0 | 11.2% | 44.2 MB |
| 60 | 60 / 60 | 9 / 6 / 2 | 60/60 | 338 ms | 3,257 ms | 225 ms | 0 | 19.0% | 44.8 MB |
| 100 | 100 / 100 | 15 / 10 / 3 | skipped | 353 ms | n/a | 271 ms | 0 | 7.0% | 45.6 MB |
| 200 | 200 / 200 | 0 completed | 29/200 accepted | n/a | 5,360 ms | 1,107 ms | 55 | 57.0% | 62.1 MB |

Notes:

- 60-player run: all 9 TTT, 6 Word Bomb and 2 Ink Rush rooms reached a final; 129 points awarded;
  one non-fatal word-replay warning.
- 100-player run: all rooms and finals completed; the Derby was in `racing` phase during the run,
  so it was skipped.
- 200-player run: peak 56 rooms, zero completed rooms, 55 task errors, one public health error, no
  disconnects. The first 200-player run also failed (51 task errors, 56/200 wagers). This is a
  repeatable capacity failure above 60, not a one-off auth failure.
- `App CPU max` is Docker's percent of one core; 19% is about 0.19 core, not 19% of the VM.

### 8 x 60-player soak

Eight consecutive 60-player rounds, about nine minutes total:

| Check | Result |
|---|---|
| Rounds | 8 / 8 completed |
| Players per round | 60 / 60 every round |
| Rooms per round | 9 TTT, 6 Word Bomb, 2 Ink Rush |
| Task errors | 0 across all rounds |
| Derby | Skipped in rounds 1-3 (window timing); 60/60 in rounds 4-8 |
| Derby p95 | 1.96-2.81 s |
| TTT p95 | 162-342 ms |
| Public health p95 | 174-356 ms; worst sample 0.56-3.82 s |
| App CPU max | 19.77% of one core |
| App RSS | 36.04 MB -> 41.91 MB; peak 49.48 MB |
| Mongo CPU max | 56.73% (one-core relative; background/compaction observed) |
| Mongo memory peak | 354.3 MB / 512 MiB |
| Host used peak | 804 MB |
| VM-local health p95 | 2.52 ms |

No memory creep or room leak was visible after cleanup.

## 5. Accurate host CPU/RAM snapshot

The final 60-player confirmation run had no Derby window (betting was closed), so it is used for
host-resource accuracy, not for Derby capacity.

- Host `mpstat` during that 60-player run:
  - peak total busy: **20.85% of 2 vCPU** (about **0.42 cores**)
  - peak `%usr`: **14.97%**
  - average total busy: **4.47%**
- `pidstat` per-process maxima during the same run:
  - `node`: **14.5% of one core**, RSS peak **88.1 MB**
  - `mongod`: **5.0% of one core**, RSS peak **178.8 MB**
- Host idle after cleanup:
  - CPU: **0.5%**
  - `free -m`: **669 used**, **4,389 free**, **3,194 buff/cache**, **7,295 available**
  - app container: **40.72 MiB / 768 MiB**
  - Mongo container: **357.8 MiB / 512 MiB (69.9%)**
  - Mongo WiredTiger cache counts toward the container working set; host Mongo RSS was ~179 MB.

### Why boxd showed about 3.9 GB RAM

`used + buff/cache` was `669 + 3,194 = 3,863 MB`, effectively the ~3.9 GB reported by boxd. That is
mostly reclaimable page cache, not anonymous app memory:

- `MemAvailable` was **7,295 MB**.
- Node RSS was **41-88 MB** depending on host-vs-container accounting.
- Mongo was **179-358 MB** depending on RSS-vs-cgroup-accounting.

Alert on `MemAvailable` and cgroup limits, not on the host graph's cache-inclusive total.

### Why boxd showed 6-14% vCPU

The host `%usr` peak was **14.97%**, matching the observed 6-14% range. Total CPU including system
peaked at **20.9% of the 2-vCPU host**, i.e. under half a core. There is no CPU saturation at 60
players.

## 6. k6 HTTP results

| Test | Requests | Throughput | Failed | p50 | p95 |
|---|---:|---:|---:|---:|---:|
| 10 VUs / 50 s reads | 195 | 3.9 rps | 0 | 693 ms | 1,240 ms |
| 100 VUs / 80 s reads | 3,232 | 39.3 rps | 0 | 768 ms | 1,326 ms |
| 60 VUs / 10 min reads | 18,146 | 29.2 rps | 0 | 690 ms | 1,188 ms |
| 20 logins | 20/20 | n/a | 0 | n/a | 1,193 ms |

The `p95 < 500 ms` threshold failed in every k6 run, but **no request failed** and no 429 was
observed. The same endpoints returned in ~120-170 ms via native Node `fetch`, and VM-local health was
~2.5-4.5 ms p95. The gap points at the public edge/TLS path and possibly boxd bot protection, not at
Node or Mongo. Do not use k6's public p95 to size the app without resolving this.

## 7. SQLite vs MongoDB

No SQLite migration was implemented.

Short answer: **SQLite can serve many concurrent connections, but only one writer at a time.** WAL
mode allows readers and a writer to proceed concurrently, but every write transaction is serialized
behind the single writer lock. It is viable for one Node process on one VM; it is not a drop-in
replacement for multi-instance scaling.

| Concern | SQLite WAL | Current MongoDB |
|---|---|---|
| Concurrent reads | Yes, many readers | Yes |
| Concurrent writes | One writer; others wait/return busy | Document-level concurrency |
| Write bursts (Derby payouts) | Serialized; batch in one transaction | Current volume is fine |
| Multiple app replicas | Not safe as a shared file | Yes |
| Backup/ops | File + WAL checkpoint | `mongodump` / snapshots |
| Horizontal scale | Single node | Replica/shard path |

If SQLite is ever tried, require `journal_mode=WAL`, `busy_timeout`, `synchronous=NORMAL`, batched
payout transactions, and an async or worker-thread driver. Do not use a synchronous driver on the
main event loop during Derby settlement.

The measured bottleneck is not Mongo: at 60 players the app is under one core, VM-local health is
milliseconds, and Mongo has no query latency problem in these tests. Switching to SQLite would add a
single-writer constraint without fixing the Derby broadcast storm or public edge latency.

## 8. Concurrency and scaling recommendations

### P0 - before raising the account cap

1. **Coalesce Derby broadcasts.** Today every accepted wager calls `derbyBroadcast()`, and every
   racing tick loops every socket. 200 simultaneous wagers can produce a 200 x 200 message burst.
   Broadcast at most once per tick (2.5 Hz), with an immediate reliable acknowledgement to the
   bettor.
2. **Compute Derby base state once per tick.** `derby.serialize()` currently filters the full bets
   array for each socket. Build shared horses/pools/odds once, then add only `yourBets` and personal
   result data per socket. Maintain a `betsByUser` map instead of filtering every time.
3. **Use a user-to-socket map for awards.** `awardRanked()` and Derby payout loops scan every socket
   for every winner. Join authenticated sockets to a user room or keep `Map<userId, Set<socket>>`.
4. **Do not persist inside the wager response path if it can be deferred.** `spendPoints` must stay
   atomic, but `saveBet` is already fire-and-forget; keep it that way and batch analytics writes.

### P1 - cheap wins

5. Cache `getUserRank()` or compute rank only on explicit leaderboard/me requests. It currently does
   a full user read plus a `countDocuments` on `/api/auth/me`, login and registration.
6. Keep the existing Mongo indexes; they are appropriate:
   `users.usernameLower`, `users.points`, `sessions.tokenHash`, `sessions.expiresAt` TTL,
   `scores.game + score`, `point_events.userId + at`.
7. Prune `soloCooldown` entries on a timer. They grow per game/user and are never removed.
8. Add TTL/archival for `point_events`, `races` and `bets`; they grow forever and are write-only in
   the hot path.
9. Keep scrypt off the main loop and watch the libuv threadpool during login bursts. The current
   limits (25 logins per 10 min per IP) are appropriate; do not raise them for load tests.
10. Consider `socket.volatile.emit` for the 2.5 Hz Derby animation stream, while keeping wager
    acknowledgements, payouts and phase changes reliable.

### P2 - only when going beyond one VM

11. Add a Redis Socket.IO adapter and sticky sessions before running more than one app replica.
12. Move Derby state/clock to a single leader or shared service; room state is in process memory.
13. Put HTTP/WebSocket behind a proper reverse proxy/CDN and investigate the 1.2 s public k6 latency,
    including boxd bot protection and HTTP/2/TLS behavior.

## 9. Monitoring

Poll `/healthz` every 30-60 s and alert on:

- Non-200, `ok != true`, or `db != "online"`.
- App RSS above 600 MB (about 80% of 768 MiB).
- Mongo container memory above 85% (currently about 70%).
- Host `MemAvailable` below 1 GB, not boxd's cache-inclusive "used".
- `load1` sustained above the vCPU count (2).
- Container restarts in the last 15 minutes.
- Optional: VM-local `/healthz` p95 above 250 ms over five minutes.

`boxd machine usage` only reports cost/period data; it does not expose live RAM/vCPU metrics. Use
`vmstat`, `mpstat`, `pidstat`, `free` and `docker stats` on the VM for accurate measurements.

## 10. Reproduction and artifacts

Game-level runs:

```powershell
# seed inside the container, copy users out, then run
$env:USERS_FILE = ".\load-users.json"
$env:BASE_URL = "https://amirpouyan.cool-elm.boxd.sh"
$env:DURATION_MS = "65000"
$env:PLAYERS = "60"
$env:RESULT_FILE = ".\load-result-60b.json"
node test/load-public.js
```

Host sampling used during the final run:

```bash
mpstat -P ALL 2 90 > /tmp/mpstat-60b.log
vmstat 2 90 > /tmp/vmstat-60b.log
pidstat -u -r -C node 2 90 > /tmp/pidstat-node-60b.log
pidstat -u -r -C mongod 2 90 > /tmp/pidstat-mongo-60b.log
```

Relevant local artifacts:

- `load-result-10.json`, `load-result-30.json`, `load-result-60.json`
- `load-result-100.json`, `load-result-200.json`, `load-result-200b.json`
- `load-result-60b.json`
- `metrics-10.log`, `metrics-30.log`, `metrics-60.log`, `metrics-100.log`, `metrics-200.log`
- `metrics-soak.log`, `metrics-game-soak.log`
- `mpstat-60b.log`, `vmstat-60b.log`, `pidstat-node-60b.log`, `pidstat-mongo-60b.log`
- `soak-game-1.json` through `soak-game-8.json`
- `test/k6/read-10-summary.json`, `read-100-summary.json`,
  `login-20-summary.json`, `soak-60-summary.json`

These are local measurements; test-user files were removed after cleanup. Do not commit test user
credentials or generated artifacts.

## 11. Cleanup state

- All seeded accounts from the final 60-player confirmation were removed:
  60 users, 60 sessions, 102 point events, 0 bets.
- Earlier 200-player accounts were also removed: 200 users, 220 sessions, 874 point events,
  800 bets.
- Active real users after cleanup: `amirpouyan` 279, `amirpouyan2` 81, `sajad` 0.
- Final health: `ok: true`, `db: online`, `rooms: 0`, `sockets: 1`, `derbyPhase: betting`.
