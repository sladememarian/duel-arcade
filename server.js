// server.js — Express + Socket.io. The server is the single source of truth.
// Accounts, sessions, points, matchmaking and the global derby all live here.
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// Minimal .env loader (no dependency). Populates process.env from ./.env if present.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no .env — fine */ }

const express = require('express');
const { Server } = require('socket.io');

const { Quoridor } = require('./game/quoridor');
const { InfiniteTTT } = require('./game/infiniteTTT');
const { Connect4 } = require('./game/connect4');
const { Reversi } = require('./game/reversi');
const { chooseQuoridorMove } = require('./game/quoridorAI');
const { chooseTTTMove } = require('./game/tttAI');
const { chooseConnect4Move } = require('./game/connect4AI');
const { chooseReversiMove } = require('./game/reversiAI');
const { Island, DURATIONS } = require('./game/island');
const { Trivia, DURATIONS: TRIVIA_DUR } = require('./game/trivia');
const { WordBomb, DURATIONS: WB_DUR, MIN_PLAYERS: WB_MIN, MAX_PLAYERS: WB_MAX } = require('./game/wordbomb');
const { InkRush, DURATIONS: IR_DUR, MIN_PLAYERS: IR_MIN, MAX_PLAYERS: IR_MAX } = require('./game/inkrush');
const { Derby, BET_MIN, BETTING_MS, RACE_MS, RESULTS_MS } = require('./game/derby');
const prizes = require('./game/prizes');
const db = require('./db');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 64 * 1024,
  perMessageDeflate: false, // small, frequent messages — compression costs CPU
  pingInterval: 25000,
  pingTimeout: 20000,
});

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---- security headers (no external helmet dependency) ----
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'; object-src 'none'"
  );
  next();
});

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  index: 'index.html',
  setHeaders: (res, filePath) => {
    // Never cache the shell: a deploy should be picked up on the next load.
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ---- CSRF / body guard for state-changing requests ----
app.use((req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    return next();
  }
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) {
    return res.status(415).json({ ok: false, error: 'Expected application/json.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return res.status(403).json({ ok: false, error: 'Bad origin.' });
      }
    } catch (_) {
      return res.status(403).json({ ok: false, error: 'Bad origin.' });
    }
  }
  next();
});

const PORT = process.env.PORT || 3000;
const MAX_USERS = Math.max(1, parseInt(process.env.MAX_USERS, 10) || 60);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false') === 'true';

// ---------------- rate limiting ----------------
const registerLimiter = new auth.RateLimiter({ windowMs: 10 * 60 * 1000, max: 5, name: 'register' });
const loginLimiter = new auth.RateLimiter({ windowMs: 10 * 60 * 1000, max: 25, name: 'login' });
const loginGuard = new auth.LoginGuard({ max: 8, windowMs: 15 * 60 * 1000 });

// A dummy credential so failed logins for unknown usernames still pay the scrypt cost.
let dummyCreds = { salt: '00'.repeat(16), hash: '00'.repeat(64) };
auth.hashPassword('dummy-password-123').then((c) => { dummyCreds = c; }).catch(() => {});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function reqUser(req) {
  if (!db.isOnline()) return null;
  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.COOKIE_NAME];
  if (!token) return null;
  const found = await db.getSession(auth.hashToken(token));
  return found ? found.user : null;
}

async function issueSession(res, user, req) {
  const token = auth.newSessionToken();
  const tokenHash = auth.hashToken(token);
  const expires = auth.sessionExpiry(7);
  await db.createSession({
    userId: user._id,
    tokenHash,
    expiresAt: expires,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.setHeader('Set-Cookie', auth.serializeCookie(auth.COOKIE_NAME, token, {
    maxAge: Math.floor((expires.getTime() - Date.now()) / 1000),
    expires,
    secure: COOKIE_SECURE,
  }));
  return token;
}

// ---------------- HTTP API ----------------

app.get('/api/prizes', (_req, res) => {
  res.json({ ok: true, prizes: prizes.PRIZES, minHumans: prizes.MIN_HUMANS, maxUsers: MAX_USERS });
});

app.get('/api/leaderboard/overall', wrap(async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
  const rows = await db.topUsers(limit);
  res.json({
    ok: true,
    online: db.isOnline(),
    users: rows.map((u, i) => ({
      rank: i + 1,
      username: u.username,
      points: u.points || 0,
      wins: u.wins || 0,
      gamesPlayed: u.gamesPlayed || 0,
    })),
  });
}));

// Legacy per-game high-score board.
app.get('/api/leaderboard', wrap(async (req, res) => {
  const game = String(req.query.game || '');
  const limit = parseInt(req.query.limit, 10) || 10;
  res.json({ ok: true, online: db.isOnline(), scores: await db.topScores(game, limit) });
}));

app.post('/api/score', wrap(async (req, res) => {
  const { game, name, score, meta } = req.body || {};
  if (!db.SCORED_GAMES.has(game)) return res.status(400).json({ ok: false, error: 'unknown game' });
  if (!db.isOnline()) return res.json({ ok: false, offline: true });
  const user = await reqUser(req);
  const r = await db.saveScore({
    game,
    name: user ? user.username : name,
    score,
    meta,
    userId: user ? user._id : null,
  });
  res.json(r);
}));

// Solo completion — this is where offline points are credited.
const soloCooldown = new Map();

app.post('/api/solo/complete', wrap(async (req, res) => {
  const user = await reqUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in to earn points.' });
  if (!db.isOnline()) return res.status(503).json({ ok: false, error: 'Points are temporarily unavailable.' });
  const { game, score, meta } = req.body || {};
  if (!prizes.isGame(game) || !prizes.PRIZES[game].solo) {
    return res.status(400).json({ ok: false, error: 'Not a solo game.' });
  }
  const key = `${user._id}:${game}`;
  const now = Date.now();
  if (now - (soloCooldown.get(key) || 0) < 45000) {
    return res.status(429).json({ ok: false, error: 'You can claim this prize again shortly.' });
  }
  soloCooldown.set(key, now);
  const pts = prizes.soloAward(game);
  const balance = await db.addPoints(user._id, pts, { game, mode: 'solo' });
  await db.recordMatch(user._id, { game, mode: 'solo', place: 1, points: pts });
  await db.saveScore({ game, name: user.username, score, meta, userId: user._id });
  res.json({ ok: true, points: pts, balance });
}));

app.get('/api/auth/me', wrap(async (req, res) => {
  const user = await reqUser(req);
  if (!user) return res.status(401).json({ ok: false });
  const rank = await db.getUserRank(user._id);
  res.json({ ok: true, user: { ...db.publicUser(user), rank } });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const rl = registerLimiter.hit(req.ip);
  if (!rl.allowed) return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${rl.retryAfter}s.` });
  if (!db.isOnline()) return res.status(503).json({ ok: false, error: 'Accounts are temporarily unavailable.' });

  const vu = auth.validateUsername(req.body && req.body.username);
  if (!vu.ok) return res.status(400).json({ ok: false, error: vu.error });
  const vp = auth.validatePassword(req.body && req.body.password);
  if (!vp.ok) return res.status(400).json({ ok: false, error: vp.error });

  const count = await db.getUserCount();
  if (count >= MAX_USERS) {
    return res.status(403).json({ ok: false, error: 'The arcade is full. Ask an organiser.' });
  }

  const lower = vu.value.toLowerCase();
  if (await db.getUserByUsername(lower)) {
    return res.status(409).json({ ok: false, error: 'That username is taken.' });
  }

  const { salt, hash } = await auth.hashPassword(vp.value);
  let user;
  try {
    user = await db.createUser({ username: vu.value, usernameLower: lower, salt, hash });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ ok: false, error: 'That username is taken.' });
    throw err;
  }
  await issueSession(res, user, req);
  const rank = await db.getUserRank(user._id);
  res.json({ ok: true, user: { ...db.publicUser(user), rank } });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const rl = loginLimiter.hit(req.ip);
  if (!rl.allowed) return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${rl.retryAfter}s.` });
  if (!db.isOnline()) return res.status(503).json({ ok: false, error: 'Accounts are temporarily unavailable.' });

  const rawUsername = String((req.body && req.body.username) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const guard = loginGuard.isLocked(rawUsername);
  if (guard.locked) {
    return res.status(429).json({ ok: false, error: `Too many failed attempts. Try again in ${guard.retryAfter}s.` });
  }

  const user = rawUsername ? await db.getUserByUsername(rawUsername) : null;
  const ok = user
    ? await auth.verifyPassword(password, user.salt, user.hash)
    : await auth.verifyPassword(password, dummyCreds.salt, dummyCreds.hash);

  if (!ok || !user) {
    loginGuard.fail(rawUsername);
    return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
  }

  loginGuard.succeed(rawUsername);
  await issueSession(res, user, req);
  const rank = await db.getUserRank(user._id);
  res.json({ ok: true, user: { ...db.publicUser(user), rank } });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  if (db.isOnline()) {
    const cookies = auth.parseCookies(req.headers.cookie);
    const token = cookies[auth.COOKIE_NAME];
    if (token) await db.deleteSession(auth.hashToken(token));
  }
  res.setHeader('Set-Cookie', auth.serializeCookie(auth.COOKIE_NAME, '', { maxAge: 0, secure: COOKIE_SECURE }));
  res.json({ ok: true });
}));

app.get('/healthz', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    db: db.status,
    uptimeSeconds: Math.round(process.uptime()),
    memory: { rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576) },
    load1: os.loadavg ? Number(os.loadavg()[0].toFixed(2)) : 0,
    rooms: Object.keys(rooms).length,
    sockets: io.engine.clientsCount,
    derbyPhase: derby.phase,
  });
});

app.use((err, _req, res, next) => {
  console.warn('[http]', err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Server error.' });
});

// ===================================================================
// Socket layer
// ===================================================================

// ---------------- room registry ----------------
// Two-player rooms:
//   { game, mode:'pve'|'pvp', engine, players:{1,2}, aiDifficulty, users:{}, awarded }
// Party rooms (island/trivia/wordbomb/inkrush):
//   { game, engine, timer, botTimers:[], phaseEndsAt, botSeq, users:{}, mode, awardMode, awarded }
const rooms = {};

function makeCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (!c || rooms[c]);
  return c;
}

function newEngine(game) {
  switch (game) {
    case 'barricade': return new Quoridor();
    case 'connect4': return new Connect4();
    case 'reversi': return new Reversi();
    case 'ttt':
    default: return new InfiniteTTT();
  }
}

function broadcastState(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('state', { code, state: room.engine.serialize(), mode: room.mode });
}

function aiAction(game, eng, diff) {
  switch (game) {
    case 'barricade': return chooseQuoridorMove(eng, 2, diff || 'hard');
    case 'ttt': return chooseTTTMove(eng, 2);
    case 'connect4': return chooseConnect4Move(eng, 2, diff || 'hard');
    case 'reversi': return chooseReversiMove(eng, 2, diff || 'hard');
    default: return null;
  }
}

function maybeAIMove(code) {
  const room = rooms[code];
  if (!room || room.mode !== 'pve') return;
  if (room.engine.winner || room.engine.turn !== 2) return;
  setTimeout(() => {
    const r = rooms[code];
    if (!r || r.engine.winner || r.engine.turn !== 2) return;
    const eng = r.engine;
    let guard = 0;
    while (!eng.winner && eng.turn === 2 && guard++ < 80) {
      const action = aiAction(r.game, eng, r.aiDifficulty);
      const res = action != null ? eng.applyMove(2, action) : { ok: false };
      if (!res.ok) break;
      if (r.game !== 'reversi') break;
    }
    broadcastState(code);
    maybeAwardTwoPlayer(code);
  }, 450);
}

// ---------------- points awarding ----------------

async function awardRanked(code, game, mode, rankedIds) {
  if (!db.isOnline()) return;
  const room = rooms[code];
  if (!room) return;
  const n = rankedIds.length;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const pid = rankedIds[i];
    const user = room.users ? room.users[pid] : null;
    if (!user || seen.has(user.id)) continue;
    seen.add(user.id);
    const place = i + 1;
    const pts = prizes.awardFor(game, mode, place, n);
    let balance = user.points || 0;
    if (pts > 0) balance = await db.addPoints(user.id, pts, { game, mode, place });
    await db.recordMatch(user.id, { game, mode, place, points: pts });
    for (const s of io.sockets.sockets.values()) {
      if (s.data.user && s.data.user.id === user.id) {
        s.data.user.points = balance;
        s.emit('pointsAwarded', { game, mode, place, points: pts, balance });
      }
    }
  }
}

function maybeAwardTwoPlayer(code) {
  const room = rooms[code];
  if (!room || room.awarded || !room.engine.winner) return;
  if (room.engine.winner === 'draw') { room.awarded = true; return; }
  room.awarded = true;
  const w = room.engine.winner;
  const winnerId = room.players[w];
  const loserId = room.players[w === 1 ? 2 : 1];
  const mode = room.mode === 'pve' ? 'offline' : 'online';
  awardRanked(code, room.game, mode, [winnerId, loserId]);
}

async function awardParty(code, game) {
  const room = rooms[code];
  if (!room || room.awarded) return;
  room.awarded = true;
  const eng = room.engine;
  let ranked = [];
  if (game === 'island') {
    if (eng.winnerId) ranked = [eng.winnerId];
  } else if (typeof eng.standings === 'function') {
    ranked = eng.standings().map((r) => r.id);
  }
  const humans = eng.players.filter((p) => !p.isBot).length;
  const minH = prizes.MIN_HUMANS[game] || 2;
  const mode = humans >= minH ? 'online' : 'offline';
  await awardRanked(code, game, mode, ranked);
}

// ===================================================================
// ISLAND — multiplayer social-deduction game (3+ players).
// ===================================================================
const BOT_NAMES = ['Mango', 'Coco', 'Pearl', 'Reef', 'Drift', 'Sandy', 'Kelp', 'Marlin', 'Shelly', 'Finn'];
const BOT_LINES = [
  'I think we should target someone quiet.',
  'Not me, I swear! Vote with me?',
  'I heard they were scheming last night.',
  'Let us team up. Who do you trust?',
  'I am watching everyone closely.',
  'Stay calm. We will get through this.',
  'I have a bad feeling about them.',
  'Deal. I will follow your lead.',
  'We need to thin the herd. Suggestions?',
  'Trust no one but us two.',
];

function islandSendTo(playerId, event, payload) {
  io.to(playerId).emit(event, payload);
}

function broadcastIsland(code) {
  const room = rooms[code];
  if (!room || room.game !== 'island') return;
  const eng = room.engine;
  for (const p of eng.players) {
    if (p.isBot || !p.connected) continue;
    islandSendTo(p.id, 'islandState', {
      code,
      state: eng.serialize(p.id),
      phaseEndsAt: room.phaseEndsAt || null,
      durations: DURATIONS,
    });
  }
}

function clearBotTimers(code) {
  const room = rooms[code];
  if (!room || !room.botTimers) return;
  room.botTimers.forEach((t) => clearTimeout(t));
  room.botTimers = [];
}

function clearIslandTimer(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.phaseEndsAt = null;
}

function setIslandTimer(code, seconds, fn) {
  const room = rooms[code];
  if (!room) return;
  clearIslandTimer(code);
  room.phaseEndsAt = Date.now() + seconds * 1000;
  room.timer = setTimeout(() => { room.timer = null; fn(); }, seconds * 1000);
}

function islandStartDiscussion(code) {
  const room = rooms[code];
  if (!room) return;
  clearBotTimers(code);
  broadcastIsland(code);
  setIslandTimer(code, DURATIONS.discussion, () => islandStartVoting(code));
}

function islandStartVoting(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'discussion') return;
  room.engine.beginVoting();
  clearBotTimers(code);
  broadcastIsland(code);
  scheduleBotVotes(code);
  setIslandTimer(code, DURATIONS.voting, () => islandResolveVoting(code));
}

function islandResolveVoting(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'voting') return;
  clearIslandTimer(code);
  clearBotTimers(code);
  room.engine.tally();
  broadcastIsland(code);
  setIslandTimer(code, DURATIONS.reveal, () => islandAfterReveal(code));
}

function islandAfterReveal(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'reveal') return;
  const next = room.engine.advanceAfterReveal();
  if (next === 'ghostVote') {
    clearBotTimers(code);
    broadcastIsland(code);
    scheduleBotGhostVotes(code);
    setIslandTimer(code, DURATIONS.ghostVote, () => islandResolveGhost(code));
  } else {
    islandStartDiscussion(code);
  }
}

function islandResolveGhost(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'ghostVote') return;
  clearIslandTimer(code);
  clearBotTimers(code);
  room.engine.tallyGhost();
  broadcastIsland(code);
  awardParty(code, 'island');
}

function scheduleBotVotes(code) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  for (const bot of eng.alivePlayers().filter((p) => p.isBot)) {
    const delay = 1500 + Math.random() * DURATIONS.voting * 600;
    const t = setTimeout(() => {
      if (eng.phase !== 'voting') return;
      const targets = eng.alivePlayers().filter((p) => p.id !== bot.id);
      if (!targets.length) return;
      const tgt = targets[Math.floor(Math.random() * targets.length)];
      eng.vote(bot.id, tgt.id);
      broadcastIsland(code);
      if (eng.allAliveVoted()) islandResolveVoting(code);
    }, delay);
    room.botTimers.push(t);
  }
}

function scheduleBotGhostVotes(code) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  for (const bot of eng.ghostPlayers().filter((p) => p.isBot)) {
    const delay = 1500 + Math.random() * DURATIONS.ghostVote * 600;
    const t = setTimeout(() => {
      if (eng.phase !== 'ghostVote') return;
      const targets = eng.alivePlayers();
      if (!targets.length) return;
      const tgt = targets[Math.floor(Math.random() * targets.length)];
      eng.ghostVote(bot.id, tgt.id);
      broadcastIsland(code);
      if (eng.allGhostsVoted()) islandResolveGhost(code);
    }, delay);
    room.botTimers.push(t);
  }
}

function scheduleBotReply(code, botId, humanId) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  const t = setTimeout(() => {
    if (eng.phase !== 'discussion') return;
    const bot = eng.player(botId), human = eng.player(humanId);
    if (!bot || !bot.alive || !human || !human.connected) return;
    const line = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
    islandSendTo(human.id, 'islandWhisper', {
      from: bot.id, fromName: bot.name, to: human.id, message: line, ts: Date.now(),
    });
  }, 1200 + Math.random() * 2600);
  room.botTimers.push(t);
}

// ===================================================================
// TRIVIA ROYALE (3+)
// ===================================================================
function broadcastTrivia(code) {
  const room = rooms[code];
  if (!room || room.game !== 'trivia') return;
  const eng = room.engine;
  for (const p of eng.players) {
    if (p.isBot || !p.connected) continue;
    io.to(p.id).emit('triviaState', {
      code,
      state: eng.serialize(p.id),
      phaseEndsAt: room.phaseEndsAt || null,
      durations: TRIVIA_DUR,
    });
  }
}

function triviaStartQuestion(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'question') return;
  clearBotTimers(code);
  broadcastTrivia(code);
  scheduleBotAnswers(code);
  setTriviaTimer(code, TRIVIA_DUR.question, () => triviaReveal(code));
}

function triviaReveal(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'question') return;
  clearIslandTimer(code);
  clearBotTimers(code);
  room.engine.reveal();
  broadcastTrivia(code);
  setTriviaTimer(code, TRIVIA_DUR.reveal, () => triviaAfterReveal(code));
}

function triviaAfterReveal(code) {
  const room = rooms[code];
  if (!room || room.engine.phase !== 'reveal') return;
  const next = room.engine.advanceAfterReveal();
  if (next === 'final') {
    clearIslandTimer(code);
    broadcastTrivia(code);
    persistTriviaScores(room.engine);
    awardParty(code, 'trivia');
  } else {
    triviaStartQuestion(code);
  }
}

function setTriviaTimer(code, seconds, fn) {
  setIslandTimer(code, seconds, fn);
}

function scheduleBotAnswers(code) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  for (const bot of eng.players.filter((p) => p.isBot)) {
    const accuracy = bot._acc || (bot._acc = 0.5 + Math.random() * 0.4);
    const delay = 1500 + Math.random() * TRIVIA_DUR.question * 700;
    const t = setTimeout(() => {
      if (eng.phase !== 'question') return;
      eng.botAnswer(bot.id, accuracy);
      broadcastTrivia(code);
      if (eng.allAnswered()) triviaReveal(code);
    }, delay);
    room.botTimers.push(t);
  }
}

async function persistTriviaScores(eng) {
  if (!db.isOnline()) return;
  for (const p of eng.players) {
    if (p.isBot || p.score <= 0) continue;
    db.saveScore({ game: 'trivia', name: p.name, score: p.score, meta: { rounds: eng.totalRounds } });
  }
}

// ===================================================================
// WORD BOMB (3+)
// ===================================================================
function broadcastWordBomb(code) {
  const room = rooms[code];
  if (!room || room.game !== 'wordbomb') return;
  const eng = room.engine;
  for (const p of eng.players) {
    if (p.isBot || !p.connected) continue;
    io.to(p.id).emit('wordbombState', {
      code,
      state: eng.serialize(p.id),
      phaseEndsAt: room.phaseEndsAt || null,
      durations: WB_DUR,
    });
  }
}

function wbStartRound(code) {
  const room = rooms[code];
  if (!room || room.game !== 'wordbomb' || room.engine.phase !== 'round') return;
  clearBotTimers(code);
  broadcastWordBomb(code);
  scheduleBotWords(code);
  setIslandTimer(code, WB_DUR.round, () => wbReveal(code));
}

function wbReveal(code) {
  const room = rooms[code];
  if (!room || room.game !== 'wordbomb' || room.engine.phase !== 'round') return;
  clearIslandTimer(code);
  clearBotTimers(code);
  room.engine.reveal();
  broadcastWordBomb(code);
  setIslandTimer(code, WB_DUR.reveal, () => wbAfterReveal(code));
}

function wbAfterReveal(code) {
  const room = rooms[code];
  if (!room || room.game !== 'wordbomb' || room.engine.phase !== 'reveal') return;
  const next = room.engine.advanceAfterReveal();
  if (next === 'final') {
    clearIslandTimer(code);
    broadcastWordBomb(code);
    awardParty(code, 'wordbomb');
  } else {
    wbStartRound(code);
  }
}

function scheduleBotWords(code) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  for (const bot of eng.players.filter((p) => p.isBot)) {
    const delay = 1200 + Math.random() * WB_DUR.round * 650;
    const t = setTimeout(() => {
      if (eng.phase !== 'round') return;
      eng.botSubmit(bot.id);
      broadcastWordBomb(code);
      if (eng.allAnswered()) wbReveal(code);
    }, delay);
    room.botTimers.push(t);
  }
}

// ===================================================================
// INK RUSH (3+)
// ===================================================================
function broadcastInkRush(code) {
  const room = rooms[code];
  if (!room || room.game !== 'inkrush') return;
  const eng = room.engine;
  for (const p of eng.players) {
    if (p.isBot || !p.connected) continue;
    io.to(p.id).emit('inkrushState', {
      code,
      state: eng.serialize(p.id),
      phaseEndsAt: room.phaseEndsAt || null,
      durations: IR_DUR,
    });
  }
}

function irStartPrompt(code) {
  const room = rooms[code];
  if (!room || room.game !== 'inkrush' || room.engine.phase !== 'prompt') return;
  clearBotTimers(code);
  broadcastInkRush(code);
  scheduleBotInk(code);
  setIslandTimer(code, IR_DUR.prompt, () => irReveal(code));
}

function irReveal(code) {
  const room = rooms[code];
  if (!room || room.game !== 'inkrush' || room.engine.phase !== 'prompt') return;
  clearIslandTimer(code);
  clearBotTimers(code);
  room.engine.reveal();
  broadcastInkRush(code);
  setIslandTimer(code, IR_DUR.reveal, () => irAfterReveal(code));
}

function irAfterReveal(code) {
  const room = rooms[code];
  if (!room || room.game !== 'inkrush' || room.engine.phase !== 'reveal') return;
  const next = room.engine.advanceAfterReveal();
  if (next === 'final') {
    clearIslandTimer(code);
    broadcastInkRush(code);
    awardParty(code, 'inkrush');
  } else {
    irStartPrompt(code);
  }
}

function scheduleBotInk(code) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  for (const bot of eng.players.filter((p) => p.isBot)) {
    const accuracy = bot._acc || (bot._acc = 0.55 + Math.random() * 0.35);
    const delay = 700 + Math.random() * IR_DUR.prompt * 650;
    const t = setTimeout(() => {
      if (eng.phase !== 'prompt') return;
      eng.botAnswer(bot.id, accuracy);
      broadcastInkRush(code);
      if (eng.allAnswered()) irReveal(code);
    }, delay);
    room.botTimers.push(t);
  }
}

// ===================================================================
// THE DERBY — a shared, continuously-running betting race.
// ===================================================================
const derby = new Derby();
let derbyTimer = null;
let derbyTick = null;
let derbyResultsTimer = null;

function derbyBroadcast() {
  for (const s of io.sockets.sockets.values()) {
    s.emit('derbyState', derby.serialize(s.data.user ? s.data.user.id : s.id));
  }
}

function startDerbyBetting() {
  clearTimeout(derbyTimer); derbyTimer = null;
  clearTimeout(derbyResultsTimer); derbyResultsTimer = null;
  clearInterval(derbyTick); derbyTick = null;
  derby.reset();
  derby.phaseEndsAt = Date.now() + BETTING_MS;
  derbyBroadcast();
  derbyTimer = setTimeout(startDerbyRace, BETTING_MS);
}

function startDerbyRace() {
  derby.startRace(Date.now());
  derby.phaseEndsAt = null;
  derbyBroadcast();
  clearInterval(derbyTick);
  derbyTick = setInterval(() => {
    const done = derby.tick(Date.now());
    derbyBroadcast();
    if (done) {
      clearInterval(derbyTick); derbyTick = null;
      finishDerby();
    }
  }, 400);
}

async function finishDerby() {
  const result = derby.settle();
  derby.phaseEndsAt = Date.now() + RESULTS_MS;
  derbyBroadcast();

  if (db.isOnline()) {
    for (const p of result.payouts) {
      if (p.payout > 0) {
        const balance = await db.addPoints(p.userId, p.payout, {
          game: 'derby', raceId: derby.raceId, horseId: p.horseId, refund: !!p.refund,
        });
        for (const s of io.sockets.sockets.values()) {
          if (s.data.user && s.data.user.id === p.userId) {
            s.data.user.points = balance;
            s.emit('pointsAwarded', { game: 'derby', points: p.payout, balance, derby: true });
          }
        }
      }
    }
    db.saveRace({
      raceId: derby.raceId,
      winnerId: result.winnerId,
      total: result.total,
      winningPool: result.winningPool,
      pools: result.pools.byHorse,
      bets: derby.bets.length,
    });
  }

  derbyResultsTimer = setTimeout(startDerbyBetting, RESULTS_MS);
}

// ===================================================================
// MATCHMAKING
// ===================================================================
const TWO_PLAYER = new Set(['barricade', 'ttt', 'connect4', 'reversi']);
const MM_GAMES = new Set([...TWO_PLAYER, 'island', 'trivia', 'wordbomb', 'inkrush']);
const mmQueues = new Map();
const MM_WAIT_MS = 30000;

function mmMin(game) { return prizes.MIN_HUMANS[game] || 2; }

function mmBroadcast(game) {
  const q = mmQueues.get(game) || [];
  q.forEach((e, idx) => {
    const s = io.sockets.sockets.get(e.socketId);
    if (s) s.emit('mmState', { game, waiting: q.length, need: mmMin(game), position: idx + 1 });
  });
}

function mmRemove(socketId) {
  for (const [game, q] of mmQueues) {
    const before = q.length;
    const next = q.filter((e) => e.socketId !== socketId);
    if (next.length !== before) {
      mmQueues.set(game, next);
      mmBroadcast(game);
    }
  }
}

function mmPartyRoom(game, entries, fallback) {
  const code = makeCode();
  let engine;
  if (game === 'island') engine = new Island();
  else if (game === 'trivia') engine = new Trivia({ rounds: 7 });
  else if (game === 'wordbomb') engine = new WordBomb({ rounds: 5 });
  else engine = new InkRush({ rounds: 7 });

  const room = {
    game, engine, timer: null, botTimers: [], phaseEndsAt: null, botSeq: 0,
    users: {}, awarded: false, mode: fallback ? 'botfill' : 'mm',
  };
  rooms[code] = room;

  for (const e of entries) {
    const s = io.sockets.sockets.get(e.socketId);
    if (!s) continue;
    s.join(code);
    s.data.room = code; s.data.seat = null;
    room.users[s.id] = s.data.user || null;
    engine.addPlayer(s.id, (s.data.user && s.data.user.username) || e.name || 'Player');
  }
  if (!engine.players.length) { delete rooms[code]; return; }

  engine.hostId = engine.players[0].id;

  if (fallback) {
    let i = 0;
    while (engine.players.length < mmMin(game)) {
      const id = `BOT_${code}_${i}`;
      engine.addPlayer(id, BOT_NAMES[i % BOT_NAMES.length], { isBot: true });
      i += 1;
    }
  }

  for (const e of entries) {
    const s = io.sockets.sockets.get(e.socketId);
    if (!s) continue;
    s.emit('mmMatched', { code, game, bots: fallback });
    if (game === 'island') s.emit('islandJoined', { code, youId: s.id });
    else if (game === 'trivia') s.emit('triviaJoined', { code, youId: s.id });
    else if (game === 'wordbomb') s.emit('wordbombJoined', { code, youId: s.id });
    else if (game === 'inkrush') s.emit('inkrushJoined', { code, youId: s.id });
  }

  const started = engine.start();
  if (!started.ok) {
    io.to(code).emit('errorMsg', started.error || 'Could not start the match.');
    return;
  }
  if (game === 'island') islandStartDiscussion(code);
  else if (game === 'trivia') triviaStartQuestion(code);
  else if (game === 'wordbomb') wbStartRound(code);
  else irStartPrompt(code);
}

function mmTwoPlayerRoom(game, entries) {
  const code = makeCode();
  const room = {
    game, mode: 'pvp', engine: newEngine(game),
    players: { 1: null, 2: null }, aiDifficulty: 'hard', users: {}, awarded: false,
  };
  rooms[code] = room;
  entries.forEach((e, i) => {
    const s = io.sockets.sockets.get(e.socketId);
    if (!s) return;
    const seat = i + 1;
    room.players[seat] = s.id;
    room.users[s.id] = s.data.user || null;
    s.join(code);
    s.data.room = code; s.data.seat = seat;
    s.emit('joined', { code, seat, game, mode: 'pvp' });
  });
  if (!room.players[1] || !room.players[2]) {
    for (const id of Object.values(room.players)) {
      if (id) io.sockets.sockets.get(id)?.emit('errorMsg', 'A player left the match.');
    }
    delete rooms[code];
    return;
  }
  io.to(code).emit('mmMatched', { code, game, bots: false });
  broadcastState(code);
}

function tryMatch(game) {
  const q = mmQueues.get(game);
  if (!q) return;
  const min = mmMin(game);
  let safety = 0;
  while (q.length >= min && safety++ < 50) {
    const entries = q.splice(0, min);
    if (TWO_PLAYER.has(game)) mmTwoPlayerRoom(game, entries);
    else mmPartyRoom(game, entries, false);
  }
  mmBroadcast(game);
}

function mmFallbackScan() {
  const now = Date.now();
  for (const [game, q] of mmQueues) {
    if (!q.length) continue;
    if (q.length >= mmMin(game)) { tryMatch(game); continue; }
    if (now - q[0].at < MM_WAIT_MS) continue;

    const entries = q.splice(0, q.length);
    if (TWO_PLAYER.has(game)) {
      // No human found — give each waiter a game against the computer.
      for (const e of entries) {
        const s = io.sockets.sockets.get(e.socketId);
        if (!s) continue;
        const code = makeCode();
        rooms[code] = {
          game, mode: 'pve', engine: newEngine(game),
          players: { 1: s.id, 2: 'AI' }, aiDifficulty: 'hard',
          users: { [s.id]: s.data.user || null }, awarded: false,
        };
        s.join(code);
        s.data.room = code; s.data.seat = 1;
        s.emit('mmFallback', { game });
        s.emit('joined', { code, seat: 1, game, mode: 'pve' });
        broadcastState(code);
        maybeAIMove(code);
      }
    } else {
      mmPartyRoom(game, entries, true);
    }
    mmBroadcast(game);
  }
}
setInterval(mmFallbackScan, 5000).unref();

// ===================================================================
// SOCKET CONNECTION
// ===================================================================
io.use(async (socket, next) => {
  try {
    if (db.isOnline()) {
      const cookies = auth.parseCookies(socket.handshake.headers.cookie);
      const token = cookies[auth.COOKIE_NAME];
      if (token) {
        const found = await db.getSession(auth.hashToken(token));
        if (found) {
          socket.data.user = db.publicUser(found.user);
          db.touchUser(found.user._id);
        }
      }
    }
  } catch (_) { /* guest */ }
  next();
});

io.on('connection', (socket) => {
  socket.data.room = null;
  socket.data.seat = null;

  // Light per-socket flood guard.
  let bucket = 0;
  let bucketAt = Date.now();
  socket.use((_packet, next) => {
    const now = Date.now();
    if (now - bucketAt > 2000) { bucketAt = now; bucket = 0; }
    bucket += 1;
    if (bucket > 80) return; // drop silently
    next();
  });

  if (socket.data.user) socket.emit('you', { user: socket.data.user });
  socket.emit('derbyState', derby.serialize(socket.data.user ? socket.data.user.id : socket.id));

  // ---- two-player: create vs computer ----
  socket.on('createPvE', ({ game, difficulty }) => {
    if (!TWO_PLAYER.has(game)) return;
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    rooms[code] = {
      game, mode: 'pve', engine: newEngine(game),
      players: { 1: socket.id, 2: 'AI' }, aiDifficulty: difficulty || 'hard',
      users: { [socket.id]: socket.data.user || null }, awarded: false,
    };
    socket.join(code);
    socket.data.room = code; socket.data.seat = 1;
    socket.emit('joined', { code, seat: 1, game, mode: 'pve' });
    broadcastState(code);
    maybeAIMove(code);
  });

  // ---- two-player: private room ----
  socket.on('createPvP', ({ game }) => {
    if (!TWO_PLAYER.has(game)) return;
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    rooms[code] = {
      game, mode: 'pvp', engine: newEngine(game),
      players: { 1: socket.id, 2: null },
      users: { [socket.id]: socket.data.user || null }, awarded: false,
    };
    socket.join(code);
    socket.data.room = code; socket.data.seat = 1;
    socket.emit('joined', { code, seat: 1, game, mode: 'pvp' });
    socket.emit('waiting', { code });
  });

  socket.on('joinPvP', ({ code }) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('errorMsg', 'Room not found.');
    if (room.mode !== 'pvp' && room.mode !== 'mm') return socket.emit('errorMsg', 'That room is not a multiplayer room.');
    if (room.players[2]) return socket.emit('errorMsg', 'Room is already full.');
    if (socket.data.room && socket.data.room !== code) cleanup(socket);
    room.players[2] = socket.id;
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = 2;
    socket.emit('joined', { code, seat: 2, game: room.game, mode: 'pvp' });
    io.to(code).emit('opponentJoined', { code });
    broadcastState(code);
  });

  socket.on('move', (action) => {
    const code = socket.data.room;
    const seat = socket.data.seat;
    const room = rooms[code];
    if (!room || !seat) return;
    if (room.mode === 'pvp' && !room.players[2]) {
      return socket.emit('errorMsg', 'Waiting for an opponent to join.');
    }
    let res;
    if (room.game === 'ttt') {
      res = room.engine.applyMove(seat, action && action.cell);
    } else {
      res = room.engine.applyMove(seat, action);
    }
    if (!res.ok) return socket.emit('errorMsg', res.error || 'Illegal move.');
    broadcastState(code);
    maybeAwardTwoPlayer(code);
    maybeAIMove(code);
  });

  socket.on('rematch', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    room.engine = newEngine(room.game);
    room.awarded = false;
    broadcastState(code);
    maybeAIMove(code);
  });

  // ================= ISLAND =================
  socket.on('createIsland', ({ name }) => {
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    const room = { game: 'island', engine: new Island(), timer: null, botTimers: [], phaseEndsAt: null, botSeq: 0, users: {}, awarded: false, mode: 'pvp' };
    rooms[code] = room;
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('islandJoined', { code, youId: socket.id });
    broadcastIsland(code);
  });

  socket.on('joinIsland', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room || room.game !== 'island') return socket.emit('errorMsg', 'Island room not found.');
    if (room.engine.phase !== 'lobby') return socket.emit('errorMsg', 'That game has already started.');
    if (room.engine.players.length >= 10) return socket.emit('errorMsg', 'Room is full.');
    if (socket.data.room && socket.data.room !== code) cleanup(socket);
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('islandJoined', { code, youId: socket.id });
    broadcastIsland(code);
  });

  socket.on('islandAddBot', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const eng = room.engine;
    if (eng.hostId !== socket.id || eng.phase !== 'lobby' || eng.players.length >= 10) return;
    const id = `BOT_${code}_${room.botSeq++}`;
    const name = BOT_NAMES[(room.botSeq - 1) % BOT_NAMES.length];
    eng.addPlayer(id, name, { isBot: true });
    broadcastIsland(code);
  });

  socket.on('islandStart', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const eng = room.engine;
    if (eng.hostId !== socket.id) return;
    const r = eng.start();
    if (!r.ok) return socket.emit('errorMsg', r.error);
    islandStartDiscussion(code);
  });

  socket.on('islandSkip', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    if (room.engine.hostId !== socket.id) return;
    if (room.engine.phase === 'discussion') islandStartVoting(code);
  });

  socket.on('islandWhisper', ({ to, message }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const eng = room.engine;
    if (eng.phase !== 'discussion') return;
    const from = eng.player(socket.id);
    const target = eng.player(to);
    if (!from || !from.alive || !target || !target.alive || from.id === target.id) return;
    const text = String(message || '').slice(0, 500).trim();
    if (!text) return;
    const payload = { from: from.id, fromName: from.name, to: target.id, message: text, ts: Date.now() };
    islandSendTo(from.id, 'islandWhisper', payload);
    if (target.isBot) scheduleBotReply(code, target.id, from.id);
    else if (target.connected) islandSendTo(target.id, 'islandWhisper', payload);
  });

  socket.on('islandGhostChat', ({ message }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const eng = room.engine;
    const from = eng.player(socket.id);
    if (!from || !from.ghost) return;
    const text = String(message || '').slice(0, 500).trim();
    if (!text) return;
    const payload = { from: from.id, fromName: from.name, message: text, ts: Date.now() };
    for (const g of eng.ghostPlayers()) {
      if (!g.isBot && g.connected) islandSendTo(g.id, 'islandGhostChat', payload);
    }
  });

  socket.on('islandVote', ({ target }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const eng = room.engine;
    const r = eng.vote(socket.id, target);
    if (!r.ok) return socket.emit('errorMsg', r.error);
    broadcastIsland(code);
    if (eng.allAliveVoted()) islandResolveVoting(code);
  });

  socket.on('islandGhostVote', ({ target }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const eng = room.engine;
    const r = eng.ghostVote(socket.id, target);
    if (!r.ok) return socket.emit('errorMsg', r.error);
    broadcastIsland(code);
    if (eng.allGhostsVoted()) islandResolveGhost(code);
  });

  socket.on('islandPlayAgain', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    const old = room.engine;
    if (old.hostId !== socket.id) return;
    clearIslandTimer(code); clearBotTimers(code);
    const ne = new Island();
    for (const p of old.players) if (p.connected) ne.addPlayer(p.id, p.name, { isBot: p.isBot });
    if (old.hostId && ne.player(old.hostId)) ne.hostId = old.hostId;
    room.engine = ne;
    room.awarded = false;
    broadcastIsland(code);
  });

  // ================= TRIVIA =================
  socket.on('createTrivia', ({ name, rounds }) => {
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    const room = { game: 'trivia', engine: new Trivia({ rounds }), timer: null, botTimers: [], phaseEndsAt: null, botSeq: 0, users: {}, awarded: false, mode: 'pvp' };
    rooms[code] = room;
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('triviaJoined', { code, youId: socket.id });
    broadcastTrivia(code);
  });

  socket.on('joinTrivia', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room || room.game !== 'trivia') return socket.emit('errorMsg', 'Trivia room not found.');
    if (room.engine.phase !== 'lobby') return socket.emit('errorMsg', 'That game has already started.');
    if (room.engine.players.length >= 12) return socket.emit('errorMsg', 'Room is full.');
    if (socket.data.room && socket.data.room !== code) cleanup(socket);
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('triviaJoined', { code, youId: socket.id });
    broadcastTrivia(code);
  });

  socket.on('triviaAddBot', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'trivia') return;
    const eng = room.engine;
    if (eng.hostId !== socket.id || eng.phase !== 'lobby' || eng.players.length >= 12) return;
    const id = `BOT_${code}_${room.botSeq++}`;
    const name = BOT_NAMES[(room.botSeq - 1) % BOT_NAMES.length];
    eng.addPlayer(id, name, { isBot: true });
    broadcastTrivia(code);
  });

  socket.on('triviaSetRounds', ({ rounds }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'trivia') return;
    if (room.engine.hostId !== socket.id) return;
    room.engine.setRounds(rounds);
    broadcastTrivia(code);
  });

  socket.on('triviaStart', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'trivia') return;
    const eng = room.engine;
    if (eng.hostId !== socket.id) return;
    const r = eng.start();
    if (!r.ok) return socket.emit('errorMsg', r.error);
    triviaStartQuestion(code);
  });

  socket.on('triviaAnswer', ({ choice }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'trivia') return;
    const eng = room.engine;
    const r = eng.answer(socket.id, choice, Date.now());
    if (!r.ok) return;
    broadcastTrivia(code);
    if (eng.allAnswered()) triviaReveal(code);
  });

  socket.on('triviaPlayAgain', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'trivia') return;
    const old = room.engine;
    if (old.hostId !== socket.id) return;
    clearIslandTimer(code); clearBotTimers(code);
    const ne = new Trivia({ rounds: old.totalRounds });
    for (const p of old.players) if (p.connected) ne.addPlayer(p.id, p.name, { isBot: p.isBot });
    if (old.hostId && ne.player(old.hostId)) ne.hostId = old.hostId;
    room.engine = ne;
    room.awarded = false;
    broadcastTrivia(code);
  });

  // ================= WORD BOMB =================
  socket.on('createWordBomb', ({ name, rounds }) => {
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    const room = { game: 'wordbomb', engine: new WordBomb({ rounds }), timer: null, botTimers: [], phaseEndsAt: null, botSeq: 0, users: {}, awarded: false, mode: 'pvp' };
    rooms[code] = room;
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('wordbombJoined', { code, youId: socket.id });
    broadcastWordBomb(code);
  });

  socket.on('joinWordBomb', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room || room.game !== 'wordbomb') return socket.emit('errorMsg', 'Word Bomb room not found.');
    if (room.engine.phase !== 'lobby') return socket.emit('errorMsg', 'That game has already started.');
    if (room.engine.players.length >= WB_MAX) return socket.emit('errorMsg', 'Room is full.');
    if (socket.data.room && socket.data.room !== code) cleanup(socket);
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('wordbombJoined', { code, youId: socket.id });
    broadcastWordBomb(code);
  });

  socket.on('wordbombAddBot', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'wordbomb') return;
    const eng = room.engine;
    if (eng.hostId !== socket.id || eng.phase !== 'lobby' || eng.players.length >= WB_MAX) return;
    const id = `BOT_${code}_${room.botSeq++}`;
    eng.addPlayer(id, BOT_NAMES[(room.botSeq - 1) % BOT_NAMES.length], { isBot: true });
    broadcastWordBomb(code);
  });

  socket.on('wordbombSetRounds', ({ rounds }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'wordbomb') return;
    if (room.engine.hostId !== socket.id) return;
    room.engine.setRounds(rounds);
    broadcastWordBomb(code);
  });

  socket.on('wordbombStart', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'wordbomb') return;
    if (room.engine.hostId !== socket.id) return;
    const r = room.engine.start();
    if (!r.ok) return socket.emit('errorMsg', r.error);
    wbStartRound(code);
  });

  socket.on('wordbombSubmit', ({ word }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'wordbomb') return;
    const eng = room.engine;
    const r = eng.submit(socket.id, word, Date.now());
    if (!r.ok) return socket.emit('errorMsg', r.error);
    broadcastWordBomb(code);
    if (eng.allAnswered()) wbReveal(code);
  });

  socket.on('wordbombPlayAgain', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'wordbomb') return;
    const old = room.engine;
    if (old.hostId !== socket.id) return;
    clearIslandTimer(code); clearBotTimers(code);
    const ne = new WordBomb({ rounds: old.totalRounds });
    for (const p of old.players) if (p.connected) ne.addPlayer(p.id, p.name, { isBot: p.isBot });
    if (old.hostId && ne.player(old.hostId)) ne.hostId = old.hostId;
    room.engine = ne;
    room.awarded = false;
    broadcastWordBomb(code);
  });

  // ================= INK RUSH =================
  socket.on('createInkRush', ({ name, rounds }) => {
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    const room = { game: 'inkrush', engine: new InkRush({ rounds }), timer: null, botTimers: [], phaseEndsAt: null, botSeq: 0, users: {}, awarded: false, mode: 'pvp' };
    rooms[code] = room;
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('inkrushJoined', { code, youId: socket.id });
    broadcastInkRush(code);
  });

  socket.on('joinInkRush', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room || room.game !== 'inkrush') return socket.emit('errorMsg', 'Ink Rush room not found.');
    if (room.engine.phase !== 'lobby') return socket.emit('errorMsg', 'That game has already started.');
    if (room.engine.players.length >= IR_MAX) return socket.emit('errorMsg', 'Room is full.');
    if (socket.data.room && socket.data.room !== code) cleanup(socket);
    const display = name || (socket.data.user && socket.data.user.username);
    room.engine.addPlayer(socket.id, display);
    room.users[socket.id] = socket.data.user || null;
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('inkrushJoined', { code, youId: socket.id });
    broadcastInkRush(code);
  });

  socket.on('inkrushAddBot', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'inkrush') return;
    const eng = room.engine;
    if (eng.hostId !== socket.id || eng.phase !== 'lobby' || eng.players.length >= IR_MAX) return;
    const id = `BOT_${code}_${room.botSeq++}`;
    eng.addPlayer(id, BOT_NAMES[(room.botSeq - 1) % BOT_NAMES.length], { isBot: true });
    broadcastInkRush(code);
  });

  socket.on('inkrushSetRounds', ({ rounds }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'inkrush') return;
    if (room.engine.hostId !== socket.id) return;
    room.engine.setRounds(rounds);
    broadcastInkRush(code);
  });

  socket.on('inkrushStart', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'inkrush') return;
    if (room.engine.hostId !== socket.id) return;
    const r = room.engine.start();
    if (!r.ok) return socket.emit('errorMsg', r.error);
    irStartPrompt(code);
  });

  socket.on('inkrushAnswer', ({ choice }) => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'inkrush') return;
    const eng = room.engine;
    const r = eng.answer(socket.id, choice, Date.now());
    if (!r.ok) return socket.emit('errorMsg', r.error);
    broadcastInkRush(code);
    if (eng.allAnswered()) irReveal(code);
  });

  socket.on('inkrushPlayAgain', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'inkrush') return;
    const old = room.engine;
    if (old.hostId !== socket.id) return;
    clearIslandTimer(code); clearBotTimers(code);
    const ne = new InkRush({ rounds: old.totalRounds });
    for (const p of old.players) if (p.connected) ne.addPlayer(p.id, p.name, { isBot: p.isBot });
    if (old.hostId && ne.player(old.hostId)) ne.hostId = old.hostId;
    room.engine = ne;
    room.awarded = false;
    broadcastInkRush(code);
  });

  // ================= THE DERBY =================
  socket.on('derbyBet', async ({ horse, amount }) => {
    const user = socket.data.user;
    if (!user) return socket.emit('errorMsg', 'Sign in to place a bet.');
    if (!db.isOnline()) return socket.emit('errorMsg', 'Betting is temporarily unavailable.');
    if (derby.phase !== 'betting') return socket.emit('errorMsg', 'Betting is closed for this race.');
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < BET_MIN) return socket.emit('errorMsg', `Minimum bet is ${BET_MIN} points.`);
    if (!derby.horse(horse)) return socket.emit('errorMsg', 'Unknown horse.');

    const balance = await db.spendPoints(user.id, amt);
    if (balance === null) return socket.emit('errorMsg', 'You do not have enough points.');

    const r = derby.placeBet({ userId: user.id, username: user.username, horseId: horse, amount: amt });
    if (!r.ok) {
      await db.addPoints(user.id, amt, { game: 'derby', reason: 'rollback' });
      return socket.emit('errorMsg', r.error);
    }

    socket.data.user.points = balance;
    socket.emit('pointsAwarded', { game: 'derby', points: -amt, balance });
    db.saveBet({ raceId: derby.raceId, userId: user.id, username: user.username, horseId: horse, amount: amt });
    derbyBroadcast();
  });

  // ================= MATCHMAKING =================
  socket.on('mmJoin', ({ game }) => {
    game = String(game || '');
    if (!MM_GAMES.has(game)) return socket.emit('errorMsg', 'Unknown game.');
    if (!socket.data.user) return socket.emit('errorMsg', 'Sign in to use matchmaking.');
    if (socket.data.room) cleanup(socket);
    mmRemove(socket.id);
    if (!mmQueues.has(game)) mmQueues.set(game, []);
    const q = mmQueues.get(game);
    q.push({ socketId: socket.id, name: socket.data.user.username, at: Date.now() });
    socket.emit('mmSearching', { game, need: mmMin(game), waiting: q.length });
    mmBroadcast(game);
    tryMatch(game);
  });

  socket.on('mmLeave', () => {
    mmRemove(socket.id);
    socket.emit('mmIdle');
  });

  socket.on('leaveRoom', () => cleanup(socket));
  socket.on('disconnect', () => { mmRemove(socket.id); cleanup(socket); });
});

// ===================================================================
// CLEANUP
// ===================================================================
function cleanup(socket) {
  mmRemove(socket.id);
  const code = socket.data.room;
  const room = rooms[code];
  if (!room) return;

  // ---- party rooms ----
  if (room.game === 'island' || room.game === 'trivia' || room.game === 'wordbomb' || room.game === 'inkrush') {
    const game = room.game;
    const eng = room.engine;
    eng.removePlayer(socket.id);
    socket.leave(code);
    socket.data.room = null; socket.data.seat = null;
    const humans = eng.players.filter((p) => !p.isBot && p.connected);
    if (humans.length === 0) {
      clearIslandTimer(code); clearBotTimers(code);
      delete rooms[code];
      return;
    }
    if (game === 'island') {
      if (eng.phase === 'voting' && eng.allAliveVoted()) islandResolveVoting(code);
      else if (eng.phase === 'ghostVote' && eng.allGhostsVoted()) islandResolveGhost(code);
      else broadcastIsland(code);
      return;
    }
    if (game === 'trivia') {
      if (eng.phase === 'question' && eng.allAnswered()) triviaReveal(code);
      else broadcastTrivia(code);
      return;
    }
    if (game === 'wordbomb') {
      if (eng.phase === 'round' && eng.allAnswered()) wbReveal(code);
      else broadcastWordBomb(code);
      return;
    }
    if (game === 'inkrush') {
      if (eng.phase === 'prompt' && eng.allAnswered()) irReveal(code);
      else broadcastInkRush(code);
      return;
    }
  }

  // ---- two-player ----
  socket.to(code).emit('opponentLeft', { code });
  for (const seat of [1, 2]) {
    if (room.players[seat] === socket.id) room.players[seat] = null;
  }
  socket.leave(code);
  socket.data.room = null; socket.data.seat = null;
  const humans = [room.players[1], room.players[2]].filter((p) => p && p !== 'AI');
  if (humans.length === 0) delete rooms[code];
}

// ---- boot ----
server.listen(PORT, () => {
  console.log(`Games server listening on :${PORT}`);
  startDerbyBetting();
});

db.initDb().catch((err) => console.warn('[db] init error:', err.message));
setInterval(() => { db.cleanupSessions().catch(() => {}); }, 60 * 60 * 1000).unref();
