'use strict';
// Scenario checks that are awkward to fit into the mixed load generator.
//
// Usage (after seeding users with test/load-seed-public.js):
//   SCENARIO=login USERS_FILE=./load-users.json BASE_URL=https://... node test/scenarios-public.js
//   SCENARIO=reconnect USERS_FILE=./load-users.json BASE_URL=https://... node test/scenarios-public.js
//   SCENARIO=botfill USERS_FILE=./load-users.json BASE_URL=https://... node test/scenarios-public.js
//
// The seeded password is Loadtest123; override with LOAD_PASSWORD if needed.

const fs = require('fs');
const { performance } = require('perf_hooks');
const { io } = require('socket.io-client');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MODE = process.env.SCENARIO || 'login';
const USERS_FILE = process.env.USERS_FILE || process.argv[2];
const RESULT_FILE = process.env.RESULT_FILE || '';
const PASSWORD = process.env.LOAD_PASSWORD || 'Loadtest123';
const LIMIT = Math.max(1, parseInt(process.env.PLAYERS, 10) || 60);

if (!USERS_FILE || !fs.existsSync(USERS_FILE)) {
  console.error('users file not found; set USERS_FILE or pass a path');
  process.exit(2);
}

const allUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const users = allUsers.slice(0, LIMIT);
if (!users.length) {
  console.error('no users in file');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};

function connect(user) {
  const sock = io(BASE, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 12000,
    extraHeaders: { Cookie: user.cookie },
  });
  const latest = new Map();
  const listeners = new Map();
  sock.onAny((ev, msg) => {
    latest.set(ev, msg);
    const hs = listeners.get(ev);
    if (hs) for (const h of [...hs]) { try { h(msg); } catch (_) { /* noop */ } }
  });
  const wait = (ev, pred = () => true, timeout = 10000) => {
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
    sock.once('connect', () => { clearTimeout(timer); resolve(); });
    sock.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(err && err.message ? err.message : String(err)));
    });
  });
  return { sock, wait, ready };
}

async function loginBurst() {
  const rows = await Promise.all(users.map(async (user) => {
    const t0 = performance.now();
    try {
      const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE },
        body: JSON.stringify({ username: user.username, password: PASSWORD }),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* non-json */ }
      return { username: user.username, status: res.status, ok: res.ok && !!json && json.ok, ms: performance.now() - t0 };
    } catch (err) {
      return { username: user.username, status: 0, ok: false, ms: performance.now() - t0, error: err.message };
    }
  }));
  const failed = rows.filter((r) => !r.ok);
  const latencies = rows.filter((r) => r.ok).map((r) => r.ms);
  return {
    scenario: 'login',
    players: users.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    latencyP50ms: pct(latencies, 0.5),
    latencyP95ms: pct(latencies, 0.95),
    latencyMaxMs: pct(latencies, 1),
    failures: failed.slice(0, 10),
  };
}

async function reconnect() {
  const rows = await Promise.all(users.map(async (user) => {
    const first = connect(user);
    const t0 = performance.now();
    try {
      await first.ready;
      await first.wait('you', () => true, 8000);
      first.sock.disconnect();
      await sleep(250);
      const second = connect(user);
      await second.ready;
      await second.wait('you', () => true, 8000);
      const ms = performance.now() - t0;
      second.sock.disconnect();
      return { username: user.username, ok: true, ms };
    } catch (err) {
      try { first.sock.disconnect(); } catch (_) { /* noop */ }
      return { username: user.username, ok: false, ms: performance.now() - t0, error: err.message };
    }
  }));
  const failed = rows.filter((r) => !r.ok);
  const latencies = rows.filter((r) => r.ok).map((r) => r.ms);
  return {
    scenario: 'reconnect',
    players: users.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    latencyP50ms: pct(latencies, 0.5),
    latencyP95ms: pct(latencies, 0.95),
    latencyMaxMs: pct(latencies, 1),
    failures: failed.slice(0, 10),
  };
}

async function botfill() {
  const user = users[0];
  const c = connect(user);
  const t0 = performance.now();
  try {
    await c.ready;
    await c.wait('you', () => true, 8000);
    c.sock.emit('mmJoin', { game: 'ttt' });
    const joined = await c.wait('joined', (m) => m && m.game === 'ttt', 45000);
    const state = await c.wait('state', (m) => m && m.state && m.state.type === 'ttt', 8000);
    return {
      scenario: 'botfill',
      player: user.username,
      passed: joined.mode === 'pve' && joined.seat === 1 && state.state.type === 'ttt',
      mode: joined.mode,
      seat: joined.seat,
      waitMs: performance.now() - t0,
    };
  } catch (err) {
    return { scenario: 'botfill', player: user.username, passed: false, error: err.message, waitMs: performance.now() - t0 };
  } finally {
    try { c.sock.disconnect(); } catch (_) { /* noop */ }
  }
}

async function main() {
  let summary;
  if (MODE === 'login') summary = await loginBurst();
  else if (MODE === 'reconnect') summary = await reconnect();
  else if (MODE === 'botfill') summary = await botfill();
  else {
    console.error(`unknown SCENARIO "${MODE}" (use login, reconnect, botfill)`);
    process.exit(2);
  }
  console.log(JSON.stringify(summary, null, 2));
  if (RESULT_FILE) fs.writeFileSync(RESULT_FILE, JSON.stringify(summary, null, 2));
  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[scenario]', err && err.stack ? err.stack : err);
  process.exit(1);
});
