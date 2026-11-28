# Load Test & Capacity Report - The Arcade

Date: 2026-11-28  
Target: `https://amirpouyan.cool-elm.boxd.sh`  
VM: `cool-elm`, 2 vCPU, 8 GiB RAM, 98 GB disk, 1 GiB swap  
Stack: Node 20 container (`768 MiB / 1.5 CPU`) + MongoDB 7 container (`512 MiB`, WiredTiger cache `0.25 GB`)

This report supersedes the earlier same-host 60-player baseline in `SERVER_REQUIREMENTS.md`. The
earlier test ran the load generator inside the same Docker host; these tests drive the public
WebSocket endpoint from a separate Windows machine and sample the VM locally.

## 1. Verdict

- **60 players is supported** on the production 2 vCPU / 8 GiB VM and on the smaller 1 vCPU / 4 GiB
  tier with healthy headroom.
- **The Derby broadcast rewrite removed the 100/200 collapse.** After coalescing broadcasts and
  precomputing Derby state, 100 players completed every room with the Derby active and zero task
  errors on 1 vCPU / 4 GiB. A 200-player run also completed every room with 200/200 wagers and zero
  task errors, with one word-replay warning and one delayed auth handshake. 200 is still
  experimental and above the `MAX_USERS=60` account cap, but it is no longer a hard failure.
- **MongoDB is not the bottleneck at 60 players.** The app stayed below one core, host CPU peaked at
  about 21% of the 2 vCPU, VM-local `/healthz` p95 stayed under 5 ms, and there were zero failed
  game-level requests. Do not switch databases to fix concurrency before addressing the remaining
  edge latency issue below.
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
| Auth limits | register `max(5, MAX_USERS)`/10 min/IP (60), login 120/10 min/IP, login 10/10 min/IP+username, username lockout 8/15 min |
| 4 GiB matrix | Temporary resize to 1 vCPU / 4 GiB; restored to 2 vCPU / 8 GiB after testing |
| Public edge | `https://amirpouyan.cool-elm.boxd.sh`; boxd `bot_protection: on` |
| Load generator | Windows, Node `v26.8.1`, public WSS/HTTPS |

The 200-player runs seeded accounts directly in the container, bypassing the registration limiter.
The registration cap itself stayed at 60 throughout.

## 3. Method

- Node + `socket.io-client` for real game traffic; k6 cannot drive Socket.IO.
- Weighted mix after the first six players: 30% TTT, 40% Word Bomb, 20% Ink Rush, remaining 10%
  Derby-only. The harness enforces a minimum of six players.
- `test/scenarios-public.js` covers login bursts, disconnect/reconnect, and matchmaking bot-fill.
- The 4 GiB matrix used `boxd machine resize cool-elm --memory 4G`, which is the 1 vCPU / 4 GiB
  tier; the VM was restored to 2 vCPU / 8 GiB afterward.
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
  disconnects. The first 200-player run also failed (51 task errors, 56/200 wagers). This was the
  pre-fix collapse; the post-fix 200-player run completed all rooms (see below).
- `App CPU max` is Docker's percent of one core; 19% is about 0.19 core, not 19% of the VM.

### Post-fix validation (2026-11-28)

`987f652` was deployed after the Derby broadcast and payout changes. Test accounts were seeded
directly in the container, so the public `MAX_USERS=60` registration cap was not changed.

| Players | Host | Connect / auth | TTT / WB / IR rooms | Derby | TTT p95 | Derby p95 | Public health p95 | Task errors | App RSS peak |
|---:|---|---|---|---|---:|---:|---:|---:|---:|
| 60 | 2 vCPU / 8 GiB | 60 / 60 | 9 / 6 / 2 | 60/60 | 359 ms | 1,110 ms | 304 ms | 0 | 81 MB |
| 60 | 1 vCPU / 4 GiB | 60 / 60 | 9 / 6 / 2 | 60/60 | 189 ms | 289 ms | 196 ms | 0 | 79 MB |
| 100 | 1 vCPU / 4 GiB | 100 / 100 | 15 / 10 / 3 | 100/100 | 225 ms | 297 ms | 493 ms | 0 | 86 MB |
| 200 | 1 vCPU / 4 GiB | 200 / 199 at summary | 30 / 20 / 6 | 200/200 | 598 ms | 634 ms | 784 ms | 0 (+1 word warning) | 93 MB |

Notes:

- The 60-player post-fix run cut Derby wager p95 from **3,257 ms** to **1,110 ms** on the 8 GiB
  host. The 1 vCPU / 4 GiB run was faster again (289 ms p95), showing that edge variance dominates
  these public numbers.
- The 200-player run completed every TTT, Word Bomb and Ink Rush room with the Derby active,
  200/200 wagers and 50 payout events. There were zero task errors, one `That word was already
  played.` warning, and one auth handshake that arrived after the summary counter (all 200 `you`
  events were received). Event-loop p95 was **10.3 ms**, max **79.1 ms**.
- The 200 result is still experimental: it used 200 seeded accounts above the 60-account cap.
  Treat 60 as the supported tier and 100 as a validated upper experiment until the cap and edge
  latency are revisited.
- The public health p95 includes edge/TLS; VM-local health remained in the low-millisecond range.

### 8 x 60-player soak (post-fix)

Eight consecutive 60-player rounds, about nine minutes total:

| Check | Result |
|---|---|
| Rounds | 8 / 8 completed |
| Players per round | 60 / 60 every round |
| Rooms per round | 9 TTT, 6 Word Bomb, 2 Ink Rush |
| Task errors | 0 across all rounds |
| Derby | 60/60 in rounds 1, 2, 6, 7, 8; skipped in 3-5 (window timing) |
| Derby p95 | 181-254 ms |
| TTT p95 | 166-637 ms |
| Public health p95 | 276-673 ms; worst sample 0.53-3.77 s |
| App RSS | 78-90 MB; peak 90 MB |

No memory creep or room leak was visible after cleanup. The 3.77 s public health outlier was a
single edge sample during round 2; event-loop health stayed at its normal 10 ms resolution.

### Auth, reconnect and bot-fill scenarios

| Check | Result |
|---|---|
| 60 simultaneous logins, 2 vCPU / 8 GiB | 60/60, p50 1.99 s, p95 2.75 s |
| 60 simultaneous logins, 1 vCPU / 4 GiB | 60/60, p50 2.31 s, p95 3.50 s |
| 50 disconnect/reconnect cycles, 2 vCPU / 8 GiB | 50/50, p95 2.79 s |
| One-player TTT matchmaking | Fell back to PvE in 32.6 s |

The login burst produced no 429s or failures. The 2-3.5 s public login latency is dominated by
scrypt on a 1-2 vCPU host plus edge/TLS; it is a burst UX limit, not an authentication failure.
Reconnect latency includes the intentional 250 ms disconnect gap and two full socket handshakes.

## 5. Accurate host CPU/RAM snapshot

The pre-fix 60-player confirmation run had no Derby window (betting was closed), so it is used for
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
Node or Mongo. Do not use k6's public p95 to size the app without resolving this. The 20-login k6
row predates the new rate limits; a native 60-login burst is reported in section 4.

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

Status as of 2026-11-28: P0 items 1-4 are implemented and validated by the post-fix runs above.
P1 items 7-9 are implemented; item 5 (rank caching) and item 10 (`volatile` Derby emits) remain
optional. P2 items are unchanged.

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
9. Keep scrypt off the main loop and watch the libuv threadpool during login bursts. The deployed
   limits are 120 logins per 10 min per IP and 10 per IP+username; 60 simultaneous logins passed
   without 429s, but public p95 reached 2.75-3.50 s.
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

Scenario checks and the 4 GiB matrix:

```powershell
$env:SCENARIO = "login"          # or reconnect, botfill
$env:USERS_FILE = ".\load-users-60.json"
$env:BASE_URL = "https://amirpouyan.cool-elm.boxd.sh"
node test/scenarios-public.js

boxd machine resize cool-elm --memory 4G --confirm   # 1 vCPU / 4 GiB
# run the game-level load test, then restore:
boxd machine resize cool-elm --memory 8G --confirm   # 2 vCPU / 8 GiB
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
- `load-result-60-postfix.json`, `load-result-60-4gb.json`, `load-result-100-4gb.json`
- `load-result-200-4gb.json`, `load-result-200b-4gb.json`
- `scenario-login-60.json`, `scenario-login-60-4gb.json`, `scenario-reconnect-50.json`,
  `scenario-botfill.json`
- `soak-postfix-1.json` through `soak-postfix-8.json`
- `metrics-10.log`, `metrics-30.log`, `metrics-60.log`, `metrics-100.log`, `metrics-200.log`
- `metrics-soak.log`, `metrics-game-soak.log`
- `mpstat-60b.log`, `vmstat-60b.log`, `pidstat-node-60b.log`, `pidstat-mongo-60b.log`
- `soak-game-1.json` through `soak-game-8.json`
- `test/k6/read-10-summary.json`, `read-100-summary.json`,
  `login-20-summary.json`, `soak-60-summary.json`

These are local measurements; test-user files were removed after cleanup. Do not commit test user
credentials or generated artifacts.

## 11. Cleanup state

- Post-fix test accounts removed: **200 users, 370 sessions, 1,190 point events, 770 bets**.
  This covers every seeded account from the 60/100/200 runs; the cleanup deleted only those IDs.
- The VM was restored to **2 vCPU / 8 GiB** after the 4 GiB matrix.
- Active real users were not modified: `amirpouyan` 279, `amirpouyan2` 81, `sajad` 0.
- Final health: `ok: true`, `db: online`, `rooms: 0`, `sockets: 1`, `derbyPhase: results`.
