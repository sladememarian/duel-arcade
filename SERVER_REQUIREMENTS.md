# Server Requirements & Capacity Report — The Arcade

> **2026-11-27:** New public load tests supersede this baseline. See `LOAD_TEST_REPORT.md` for
> current measurements, the 60/100/200-player results, and SQLite/concurrency recommendations.

This report covers the infrastructure needed to run the arcade smoothly for its intended
scale: **up to 60 registered players**, several concurrent rooms, and the Derby broadcasting
at 2.5 Hz. It is based on the measured 60-player run described in `README.md` and the
production limits in `docker-compose.yml`.

## 1. Recommendation at a glance

| Tier | CPU | RAM | Disk | Suitable for |
|------|-----|-----|------|--------------|
| Minimum | 2 vCPU | 2 GB | 20–30 GB SSD | 60 accounts, light traffic; add 1–2 GB swap |
| **Recommended** | **2 vCPU** | **4 GB** | **40 GB SSD** | **60 accounts with normal headroom** |
| Growth | 4 vCPU | 8 GB | 80 GB SSD | ~120 players / more concurrent rooms |
| Large | 8 vCPU | 16 GB | 160 GB SSD | 250+ players, after the scaling changes in §8 |

- OS: **Ubuntu 24.04 LTS** (22.04 also fine), 64-bit.
- Runtime: **Docker Engine 27+** with **Docker Compose v2**.
- Network: any 100 Mbps+ connection; TLS termination at a reverse proxy is strongly
  recommended (Caddy, Nginx, Traefik or Cloudflare).
- The stack is two containers: the Node app (limit **768 MiB / 1.5 CPU**) and MongoDB 7
  (limit **512 MiB**, WiredTiger cache **0.25 GB**, no explicit CPU cap).

The recommended 4 GB is not because the app is heavy — it is because MongoDB is the tightest
memory consumer and has the least headroom under the current 512 MiB cap. On a 2 GB host the
tested configuration runs, but a 2 GB swap file is advised. On a 4 GB host, raise Mongo to
768 MiB–1 GiB and keep the WiredTiger cache at 0.25–0.5 GB.

## 2. Measured 60-player run

Environment: the production compose stack with its real limits, driven by 60 authenticated
WebSocket clients. The load generator ran on the same machine as Docker, so the latency
figures include the client-side event loop; `/healthz` is the cleaner server-side signal.

| Check | Result |
|-------|--------|
| Concurrent authenticated players | **60 / 60** |
| Concurrent rooms | **20** — 12 Infinite TTT, 6 Word Bomb (4 each), 2 Ink Rush (6 each) |
| Game completion | All 12 TTT games finished; all 6 Word Bomb and 2 Ink Rush rooms reached final |
| Derby wagers | **60 / 60 accepted**, 15 winning payouts |
| Derby messages | 6,120 `derbyState` broadcasts |
| Points events | 135 (60 wager debits + 75 awards) |
| Errors / failed connections / timeouts | **0 / 0 / 0** |
| `/healthz` latency | **p50 21 ms, p95 33 ms**, 14 ms after cleanup |
| Worst `/healthz` sample | 1.2 s during the artificial all-at-once 60-wager burst |
| TTT move round-trip | p50 73 ms, p95 95 ms |
| Wager acknowledgement during burst | p50 1.36 s, p95 2.17 s |
| App container working set | peak ~37 MiB of 768 MiB |
| Node process RSS / heap | peak 79 MB / 22 MB |
| App CPU | mostly 0.7–20%; one ~123% spike at the wager burst (limit 1.5 CPU) |
| Mongo memory | ~298 MB steady of 512 MB; cold-start sample reached ~458 MB |
| Mongo CPU | below 2% steady; short spikes at settlement (no CPU cap configured) |
| Host load average | peak 0.59 |
| Cleanup | 0 rooms, 0 sockets after clients disconnected |

The 60-wager burst is deliberately harsher than normal play: all wagers arrive in the same
instant, each one currently triggers a full Derby broadcast, and 60 players then receive
6,120 messages. Real players spread wagers over the 45-second window, so the 1.2 s health
spike and 1.4–2.2 s wager acknowledgements are worst-case figures, not steady-state ones.
If that burst ever becomes common, coalescing Derby broadcasts would be the first
optimisation.

## 3. CPU sizing

- **2 vCPU is the right target for 60 players.** The app peaked at ~1.23 cores during the
  wager burst; normal play stayed well below one core. The 1.5 CPU container cap leaves
  headroom on a 2-vCPU host for the OS, Docker and the Mongo process.
- MongoDB has no CPU limit in Compose. It stayed below 2% except for brief settlement
  spikes, but one cold-start/compact sample reached ~1.37 cores. A 2-vCPU host handles that.
- Avoid a 1-vCPU host: the app plus Mongo can briefly compete, and the wager burst would
  queue.

## 4. Memory sizing

- **App:** the container limit is 768 MiB and the Node heap is capped at 384 MiB. Measured
  working set was ~37 MiB, so this is generous. Keep the 768 MiB limit; do not lower it.
- **MongoDB:** 512 MiB is the tightest resource. Steady state was ~298 MB, but a cold start
  reached ~458 MB while the cache grew. On a 4 GB host, raise `mem_limit` to **768 MiB–1 GiB**
  (and optionally the WiredTiger cache to 0.5 GB). On a 2 GB host, keep 512 MiB and add swap.
- **OS + Docker:** budget ~400–600 MB. A 2 GB host is therefore viable but has little slack;
  a 4 GB host is the comfortable recommendation.

## 5. Disk, network and OS

- **Disk:** 20–30 GB SSD minimum. Images and build cache are roughly 1–2 GB; Mongo data
  (users, sessions, points, bets, races) is small. Logs are capped at 10 MB × 3 per
  container. 40 GB gives room for images, backups and growth.
- **Network:** 100 Mbps is ample. The Derby sends 60 small per-user payloads at 2.5 Hz
  (~150 messages/s), which is well under 1 Mbps at this scale.
- **TLS proxy:** terminate HTTPS at Caddy/Nginx/Traefik; forward to `127.0.0.1:3000`. Enable
  WebSocket upgrade, set `proxy_read_timeout`/`proxy_send_timeout` to at least 120 s, and
  disable proxy buffering for the socket path. Set `COOKIE_SECURE=true` when HTTPS is
  active. The app trusts exactly one proxy hop (`trust proxy = 1`), so keep a single TLS
  proxy in front and forward the standard `X-Forwarded-*` headers.
- **OS hardening:** SSH keys only, UFW allowing 22/80/443 (not 3000 publicly), fail2ban,
  unattended security upgrades. Mongo is already unpublished from the host and reachable
  only on the compose network.
- **Time sync:** keep NTP/chrony enabled; Derby phase timers and session expiry use server
  time.

## 6. Software versions

- Ubuntu 22.04 or 24.04 LTS, x86_64 or arm64.
- Docker Engine 27+ and Compose v2 (`docker compose`, not `docker-compose`).
- The app image is `node:20-alpine`; MongoDB is `mongo:7`. Both support current amd64 and
  arm64 hosts.
- No external database, CDN or third-party service is required. The only outbound need is
  pulling the Docker images and the Git repository.

## 7. Deployment checklist

1. Create the VM with the recommended specs and a static public IP.
2. Install Docker Engine + Compose v2; add the deploy user to the `docker` group.
3. Clone the repository and create `.env` from `.env.example`:
   - `MONGO_ROOT_PASSWORD` — long random value.
   - `SESSION_SECRET` — 64+ random hex characters.
   - `COOKIE_SECURE=true` once HTTPS is in place.
   - `MAX_USERS=60`.
4. `docker compose up -d --build`.
5. Wait for both healthchecks, then confirm:
   - `curl -fsS http://127.0.0.1:3000/healthz` → `"ok":true,"db":"online"`.
   - The public HTTPS URL serves the arcade and WebSockets connect.
6. Put Caddy/Nginx in front with a certificate for the public domain.
7. Schedule `mongodump` backups (daily, 7–14 day retention) and test a restore.
8. Add monitoring/alerts from §9.

## 8. Limits and scaling beyond one VM

- **Single point of failure:** a single VM means downtime during host maintenance, kernel
  upgrades or disk failure. For a class/demo deployment that is usually acceptable; for
  production, use provider snapshots and a documented restore procedure.
- **No horizontal scaling out of the box:** Socket.io room state and the Derby live in
  process memory. Running multiple app replicas requires a shared adapter (e.g. Redis) and
  sticky sessions, plus moving Derby state out of process. That work is not needed for 60
  seats.
- **Growth path:** ~120 players → 4 vCPU / 8 GB, consider moving Mongo to a managed service;
  250+ players → 8 vCPU / 16 GB, multiple app instances with sticky sessions and a Redis
  adapter, or a redesign of the room/Derby state.
- **Derby burst:** if simultaneous wagers become a real pattern, throttle/coalesce
  `derbyBroadcast` so N wagers in one tick produce one broadcast instead of N.

## 9. Monitoring and alert thresholds

Poll `/healthz` every 30–60 s. Alert on:

- HTTP non-200, or `"ok"` not true, or `"db"` not `"online"`.
- `load1` sustained above the vCPU count.
- App process RSS above 600 MB (80% of the 768 MiB limit).
- Mongo container memory above 85% of its limit.
- Disk usage above 80%; Mongo volume growth abnormal.
- Container restarts in the last 15 minutes.
- Optional: p95 `/healthz` latency above 250 ms over five minutes (the measured p95 is
  33 ms, so this is a generous guard).

`docker stats --no-stream` shows both containers against their limits; Compose logs are
already rotated at 10 MB × 3.

## 10. Reproduce the measurement

The 60-player harness and commands are documented in `README.md` under **60-player load
test**. It seeds 60 accounts inside the app container, runs the room/derby mix, samples
`/healthz` every 500 ms, and cleans up the seeded accounts afterwards. Do not run it against
production data.
