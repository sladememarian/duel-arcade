'use strict';
// Public-URL load simulation for the live compose stack.
//
// Scales to any seeded account count and runs a weighted mix:
//   * 30% -> private Tic-Tac-Toe rooms (pairs, 5 moves each, real awards)
//   * 40% -> Word Bomb rooms of 4 (3 rounds each, real awards)
//   * 20% -> Ink Rush rooms of 6 (3 rounds each, real awards)
//   * remaining players -> Derby-only / browse traffic
//   * every connected player places a Derby wager during the betting window.
//
// While that runs it polls /healthz every 500 ms and records message counts,
// move latency, wager latency, peak RSS/heap, rooms, sockets and load.
//
// Usage (host, against the public HTTPS/WSS URL):
//   USERS_FILE=./load-users.json BASE_URL=https://amirpouyan.cool-elm.boxd.sh \
//     DURATION_MS=65000 RESULT_FILE=./load-result-60.json node test/load-public.js
//
// Seed the users inside the container first (see test/load-seed-public.js).

const fs = require('fs');
const os = require('os');
const { performance } = require('perf_hooks');
const { io } = require('socket.io-client');
const { wordsWith } = require('../game/wordlist');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DURATION_MS = Math.max(20000, parseInt(process.env.DURATION_MS, 10) || 65000);
const USERS_FILE = process.env.USERS_FILE || process.argv[2];
const RESULT_FILE = process.env.RESULT_FILE || '';

if (!USERS_FILE || !fs.existsSync(USERS_FILE)) {
  console.error('load users file not found; set USERS_FILE or pass a path');
  process.exit(2);
}

const allUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const requested = Math.max(0, parseInt(process.env.PLAYERS, 10) || allUsers.length);
const users = allUsers.slice(0, requested);
const N = users.length;
if (N < 6) {
  console.error(`need at least 6 seeded users, found ${N}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};

const EVENTS = new Set([
  'joined', 'state', 'pointsAwarded', 'errorMsg', 'wordbombJoined', 'wordbombState',
  'inkrushJoined', 'inkrushState', 'mmMatched', 'derbyState', 'you', 'opponentLeft', 'waiting',
]);

function makeClient(user, idx) {
  const sock = io(BASE, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 12000,
    extraHeaders: { Cookie: user.cookie },
  });

  const latest = new Map();
  const listeners = new Map();
  const counts = Object.create(null);
  const awards = Object.create(null);
  const errors = [];
  const state = {
    idx,
    user,
    sock,
    counts,
    awards,
    errors,
    derbyPayouts: 0,
    connected: false,
    disconnected: false,
    disconnectReason: null,
    connectError: null,
    taskError: null,
  };

  sock.onAny((ev, msg) => {
    counts[ev] = (counts[ev] || 0) + 1;
    if (ev === 'errorMsg') {
      if (errors.length < 8) errors.push(String(msg));
      return;
    }
    if (ev === 'pointsAwarded' && msg) {
      if (msg.game) awards[msg.game] = (awards[msg.game] || 0) + 1;
      if (msg.derby) state.derbyPayouts++;
    }
    if (!EVENTS.has(ev)) return;
    latest.set(ev, msg);
    const hs = listeners.get(ev);
    if (hs) for (const h of [...hs]) { try { h(msg); } catch (_) { /* predicate error */ } }
  });

  const wait = (ev, pred = () => true, timeout = 8000) => {
    const cur = latest.get(ev);
    if (cur !== undefined) {
      try { if (pred(cur)) return Promise.resolve(cur); } catch (_) { /* keep waiting */ }
    }
    return new Promise((resolve, reject) => {
      const hs = listeners.get(ev) || [];
      listeners.set(ev, hs);
      const h = (msg) => {
        let match = false;
        try { match = pred(msg); } catch (_) { return; }
        if (!match) return;
        clearTimeout(timer);
        const i = hs.indexOf(h);
        if (i >= 0) hs.splice(i, 1);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        const i = hs.indexOf(h);
        if (i >= 0) hs.splice(i, 1);
        reject(new Error(`timeout waiting for "${ev}"`));
      }, timeout);
      hs.push(h);
    });
  };

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 15000);
    sock.once('connect', () => {
      clearTimeout(timer);
      state.connected = true;
      resolve();
    });
    sock.once('connect_error', (err) => {
      clearTimeout(timer);
      state.connectError = err && err.message ? err.message : String(err);
      reject(new Error(state.connectError));
    });
  });

  sock.on('disconnect', (reason) => {
    state.disconnected = true;
    state.disconnectReason = String(reason);
  });

  state.wait = wait;
  state.ready = ready;
  return state;
}

function fetchHealth() {
  const t0 = performance.now();
  return fetch(BASE + '/healthz', { cache: 'no-store' })
    .then((r) => r.json().then((j) => ({ ...j, ms: performance.now() - t0 })))
    .catch((e) => ({ error: e.message, ms: performance.now() - t0 }));
}

async function runTtt(a, b, index, metrics) {
  a.sock.emit('createPvP', { game: 'ttt' });
  const ja = await a.wait('joined', (m) => m && m.game === 'ttt', 6000);
  b.sock.emit('joinPvP', { code: ja.code });
  await b.wait('joined', (m) => m && m.code === ja.code, 6000);
  await a.wait('state',
    (m) => m && m.state && Array.isArray(m.state.board) && m.state.board.every((v) => v === null), 6000);

  const awardA = a.wait('pointsAwarded', (m) => m && m.game === 'ttt', 10000);
  const awardB = b.wait('pointsAwarded', (m) => m && m.game === 'ttt', 10000);

  const moves = [[a, 0], [b, 3], [a, 1], [b, 4], [a, 2]];
  for (const [client, cell] of moves) {
    const t0 = performance.now();
    const done = a.wait('state',
      (m) => m && m.state && Array.isArray(m.state.board) && m.state.board[cell] !== null, 5000);
    client.sock.emit('move', { cell });
    await done;
    metrics.moveLat.push(performance.now() - t0);
  }

  const [pa, pb] = await Promise.all([awardA, awardB]);
  metrics.tttAwards += 2;
  metrics.tttRooms += 1;
  if (index === 0) {
    metrics.sampleTtt = {
      winner: pa.points,
      loser: pb.points,
      winnerBalance: pa.balance,
      loserBalance: pb.balance,
    };
  }
}

function submitWordsOnRound(client, players, roomIndex) {
  let lastRound = 0;
  const idx = players.indexOf(client);
  client.sock.on('wordbombState', (m) => {
    const st = m && m.state;
    if (!st || st.phase !== 'round' || st.round === lastRound || st.youSubmitted) return;
    lastRound = st.round;
    const opts = wordsWith(st.bigram);
    if (!opts.length) return;
    const word = opts[(idx + st.round) % opts.length];
    setTimeout(() => client.sock.emit('wordbombSubmit', { word }), 60 + idx * 20);
  });
}

async function runWordBomb(players, rounds, roomIndex, metrics) {
  const host = players[0];
  host.sock.emit('createWordBomb', { rounds });
  const j = await host.wait('wordbombJoined', () => true, 6000);
  const code = j.code;
  for (let i = 1; i < players.length; i++) {
    players[i].sock.emit('joinWordBomb', { code });
    await players[i].wait('wordbombJoined', (m) => m && m.code === code, 6000);
  }
  await host.wait('wordbombState',
    (m) => m && m.state && m.state.players.length === players.length, 6000);

  for (const c of players) submitWordsOnRound(c, players, roomIndex);
  host.sock.emit('wordbombStart');

  const final = await host.wait('wordbombState',
    (m) => m && m.state && m.state.phase === 'final', DURATION_MS + 15000).catch(() => null);
  metrics.wordBombRooms += 1;
  if (final) metrics.wordBombFinals += 1;
}

async function runInkRush(players, rounds, roomIndex, metrics) {
  const host = players[0];
  host.sock.emit('createInkRush', { rounds });
  const j = await host.wait('inkrushJoined', () => true, 6000);
  const code = j.code;
  for (let i = 1; i < players.length; i++) {
    players[i].sock.emit('joinInkRush', { code });
    await players[i].wait('inkrushJoined', (m) => m && m.code === code, 6000);
  }
  await host.wait('inkrushState',
    (m) => m && m.state && m.state.players.length === players.length, 6000);

  for (let idx = 0; idx < players.length; idx++) {
    const c = players[idx];
    let lastRound = 0;
    c.sock.on('inkrushState', (m) => {
      const st = m && m.state;
      if (!st || st.phase !== 'prompt' || st.round === lastRound || st.youAnswered) return;
      lastRound = st.round;
      const choice = st.prompt.ink;
      setTimeout(() => c.sock.emit('inkrushAnswer', { choice }), 360 + idx * 20);
    });
  }
  host.sock.emit('inkrushStart');

  const final = await host.wait('inkrushState',
    (m) => m && m.state && m.state.phase === 'final', DURATION_MS + 15000).catch(() => null);
  metrics.inkRushRooms += 1;
  if (final) metrics.inkRushFinals += 1;
}

async function main() {
  console.log(`Load test: ${N} players against ${BASE} for ~${Math.round(DURATION_MS / 1000)}s`);

  const clients = users.map(makeClient);
  const metrics = {
    startedAt: Date.now(),
    cpuStart: process.cpuUsage(),
    genRssPeak: 0,
    moveLat: [],
    betLat: [],
    tttAwards: 0,
    tttRooms: 0,
    wordBombRooms: 0,
    wordBombFinals: 0,
    inkRushRooms: 0,
    inkRushFinals: 0,
    sampleTtt: null,
    betPlaced: 0,
    betSkipped: false,
    health: [],
    healthErrors: 0,
    taskErrors: [],
  };

  const ready = await Promise.allSettled(clients.map((c) => c.ready));
  const connectFailures = ready
    .map((r, i) => (r.status === 'rejected' ? `${clients[i].user.username}: ${r.reason.message}` : null))
    .filter(Boolean);
  const connected = clients.filter((c) => c.connected).length;
  console.log(`  connected: ${connected}/${N}` + (connectFailures.length ? ` (${connectFailures.length} failed)` : ''));
  if (!connected) throw new Error('no clients connected');

  await sleep(800);
  const authed = clients.filter((c) => c.counts.you > 0).length;
  console.log(`  authenticated handshakes (you event): ${authed}/${connected}`);

  let healthInFlight = false;
  const healthTimer = setInterval(async () => {
    if (healthInFlight) return;
    healthInFlight = true;
    const h = await fetchHealth();
    healthInFlight = false;
    h.at = Date.now();
    metrics.health.push(h);
    metrics.genRssPeak = Math.max(metrics.genRssPeak, process.memoryUsage().rss / 1048576);
    if (h.error) metrics.healthErrors++;
  }, 500);

  // ---- derby wager burst: every connected player bets in the same window ----
  const first = clients[0];
  let betting = null;
  try {
    betting = await first.wait('derbyState',
      (m) => m && m.phase === 'betting' && (!m.endsAt || m.endsAt - Date.now() > 5000), 6000);
  } catch (_) { /* not betting right now */ }
  const horseIds = betting && Array.isArray(betting.horses) ? betting.horses.map((h) => h.id) : [];
  if (betting && horseIds.length) {
    const t0 = performance.now();
    const waits = clients.map((c) => c.wait('pointsAwarded',
      (m) => m && m.game === 'derby' && m.points === -10, 6000)
      .then(() => performance.now() - t0));
    clients.forEach((c, i) => c.sock.emit('derbyBet', { horse: horseIds[i % horseIds.length], amount: 10 }));
    const settled = await Promise.allSettled(waits);
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        metrics.betPlaced++;
        metrics.betLat.push(r.value);
      }
    }
    console.log(`  derby wagers: ${metrics.betPlaced}/${N} accepted`);
  } else {
    metrics.betSkipped = true;
    console.log('  derby wagers: skipped (not in a betting window)');
  }

  // ---- scenario mix: 30% TTT / 40% Word Bomb / 20% Ink Rush ----
  const tttCount = Math.floor((N * 0.30) / 2) * 2;
  const wbCount = Math.floor((N * 0.40) / 4) * 4;
  const irCount = Math.floor((N * 0.20) / 6) * 6;
  const ttt = clients.slice(0, tttCount);
  const wb = clients.slice(tttCount, tttCount + wbCount);
  const ir = clients.slice(tttCount + wbCount, tttCount + wbCount + irCount);
  const rest = clients.slice(tttCount + wbCount + irCount);
  const mix = {
    tttPlayers: ttt.length,
    wordBombPlayers: wb.length,
    inkRushPlayers: ir.length,
    derbyOnlyPlayers: rest.length,
  };
  console.log(`  mix: ${JSON.stringify(mix)}`);

  const tasks = [];
  for (let i = 0; i < ttt.length / 2; i++) {
    tasks.push(runTtt(ttt[2 * i], ttt[2 * i + 1], i, metrics)
      .catch((err) => { metrics.taskErrors.push(`ttt#${i}: ${err.message}`); }));
  }
  for (let i = 0; i < wb.length / 4; i++) {
    tasks.push(runWordBomb(wb.slice(i * 4, (i + 1) * 4), 3, i, metrics)
      .catch((err) => { metrics.taskErrors.push(`wordbomb#${i}: ${err.message}`); }));
  }
  for (let i = 0; i < ir.length / 6; i++) {
    tasks.push(runInkRush(ir.slice(i * 6, (i + 1) * 6), 3, i, metrics)
      .catch((err) => { metrics.taskErrors.push(`inkrush#${i}: ${err.message}`); }));
  }

  const started = Date.now();
  await Promise.race([
    Promise.allSettled(tasks),
    sleep(DURATION_MS + 5000),
  ]);
  const remaining = DURATION_MS - (Date.now() - started);
  if (remaining > 0) await sleep(remaining);

  clearInterval(healthTimer);
  const unexpected = clients.filter((c) => c.disconnected && c.disconnectReason !== 'io client disconnect');
  for (const c of clients) { try { c.sock.disconnect(); } catch (_) { /* noop */ } }
  await sleep(3000);
  const finalHealth = await fetchHealth();

  // ---- aggregate ----
  const totals = Object.create(null);
  const awards = Object.create(null);
  let errorMsgs = 0;
  let derbyPayouts = 0;
  const errorSamples = [];
  for (const c of clients) {
    for (const [k, v] of Object.entries(c.counts)) totals[k] = (totals[k] || 0) + v;
    for (const [k, v] of Object.entries(c.awards)) awards[k] = (awards[k] || 0) + v;
    errorMsgs += c.counts.errorMsg || 0;
    derbyPayouts += c.derbyPayouts;
    for (const e of c.errors) if (errorSamples.length < 10 && !errorSamples.includes(e)) errorSamples.push(e);
  }

  const goodHealth = metrics.health.filter((h) => !h.error);
  const healthMs = goodHealth.map((h) => h.ms);
  const maxSample = goodHealth.reduce((worst, h) => (!worst || h.ms > worst.ms ? h : worst), null);
  const peak = goodHealth.reduce((acc, h) => ({
    rss: Math.max(acc.rss, h.memory ? h.memory.rssMB : 0),
    heap: Math.max(acc.heap, h.memory ? h.memory.heapMB : 0),
    sockets: Math.max(acc.sockets, h.sockets || 0),
    rooms: Math.max(acc.rooms, h.rooms || 0),
    load1: Math.max(acc.load1, h.load1 || 0),
  }), { rss: 0, heap: 0, sockets: 0, rooms: 0, load1: 0 });

  const elapsedMs = Math.max(1, Date.now() - metrics.startedAt);
  const cpu = process.cpuUsage(metrics.cpuStart);
  const generator = {
    host: os.hostname(),
    platform: process.platform,
    node: process.version,
    cpuPercentOneCore: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10,
    peakRssMB: Math.round(metrics.genRssPeak),
  };

  const summary = {
    players: N,
    connected,
    authenticated: authed,
    mix,
    loadGenerator: generator,
    connectFailures,
    unexpectedDisconnects: unexpected.map((c) => `${c.user.username}: ${c.disconnectReason}`),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    health: {
      samples: metrics.health.length,
      errors: metrics.healthErrors,
      p50ms: pct(healthMs, 0.5),
      p95ms: pct(healthMs, 0.95),
      maxMs: pct(healthMs, 1),
      maxSample: maxSample ? {
        ms: Math.round(maxSample.ms),
        atUptimeSeconds: maxSample.uptimeSeconds,
        derbyPhase: maxSample.derbyPhase,
        sockets: maxSample.sockets,
        rooms: maxSample.rooms,
      } : null,
      peakRssMB: peak.rss,
      peakHeapMB: peak.heap,
      peakSockets: peak.sockets,
      peakRooms: peak.rooms,
      peakLoad1: peak.load1,
    },
    messages: totals,
    awardsByGame: awards,
    derby: {
      wagersAccepted: metrics.betPlaced,
      wagerLatencyP50ms: pct(metrics.betLat, 0.5),
      wagerLatencyP95ms: pct(metrics.betLat, 0.95),
      wagerLatencyMaxMs: pct(metrics.betLat, 1),
      payoutEvents: derbyPayouts,
      skipped: metrics.betSkipped,
    },
    ttt: {
      rooms: metrics.tttRooms,
      moveLatencyP50ms: pct(metrics.moveLat, 0.5),
      moveLatencyP95ms: pct(metrics.moveLat, 0.95),
      moveLatencyMaxMs: pct(metrics.moveLat, 1),
      sample: metrics.sampleTtt,
    },
    wordBomb: { rooms: metrics.wordBombRooms, reachedFinal: metrics.wordBombFinals },
    inkRush: { rooms: metrics.inkRushRooms, reachedFinal: metrics.inkRushFinals },
    errorMsgs,
    errorSamples,
    taskErrors: metrics.taskErrors,
    finalHealth,
  };

  console.log(`\n=== ${N}-PLAYER PUBLIC LOAD RESULT ===`);
  console.log(JSON.stringify(summary, null, 2));
  if (RESULT_FILE) {
    fs.writeFileSync(RESULT_FILE, JSON.stringify(summary, null, 2));
    console.log(`result written to ${RESULT_FILE}`);
  }

  const hardFail = connectFailures.length || authed < connected || unexpected.length || metrics.taskErrors.length;
  process.exit(hardFail ? 1 : 0);
}

main().catch((err) => {
  console.error('[load]', err && err.stack ? err.stack : err);
  process.exit(1);
});
