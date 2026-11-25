// db.js — MongoDB data layer for accounts, sessions, points and scores.
//
// The database is expected to live inside docker-compose (see docker-compose.yml).
// MONGO_URL defaults to the compose service name, so no external URL is required.
// Every method fails soft: if Mongo is unreachable the arcade still runs, accounts
// and points simply report as unavailable.

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGO_DB || 'arcade';
const RETRY_MS = parseInt(process.env.DB_RETRY_MS, 10) || 20000;

let client = null;
let db = null;
let users = null;
let sessions = null;
let scores = null;
let pointEvents = null;
let races = null;
let bets = null;

let status = 'connecting'; // connecting | online | error | disabled
let closed = false;
let retryTimer = null;
let lastErrorLogged = 0;

// Games that keep a per-game high-score table (legacy leaderboard).
const SCORED_GAMES = new Set(['g2048', '2048', 'memory', 'trivia', 'wordbomb', 'inkrush']);

async function connectOnce() {
  try {
    client = new MongoClient(MONGO_URL, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      maxPoolSize: 20,
      minPoolSize: 2,
      retryWrites: true,
    });
    await client.connect();
    db = client.db(DB_NAME);
    users = db.collection('users');
    sessions = db.collection('sessions');
    scores = db.collection('scores');
    pointEvents = db.collection('point_events');
    races = db.collection('races');
    bets = db.collection('bets');

    await Promise.all([
      users.createIndex({ usernameLower: 1 }, { unique: true }),
      users.createIndex({ points: -1 }),
      sessions.createIndex({ tokenHash: 1 }, { unique: true }),
      sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      scores.createIndex({ game: 1, score: -1 }),
      pointEvents.createIndex({ userId: 1, at: -1 }),
    ]);

    status = 'online';
    console.log(`[db] connected — accounts & points online (db: ${DB_NAME}).`);
    return true;
  } catch (err) {
    status = 'error';
    db = users = sessions = scores = pointEvents = races = bets = null;
    const now = Date.now();
    // Log the first failure loudly, then keep quiet on retries.
    if (now - lastErrorLogged > 60000) {
      lastErrorLogged = now;
      console.warn('[db] not reachable yet — accounts/points disabled until it is:', err.message);
    }
    return false;
  }
}

async function scheduleRetry() {
  if (closed || retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    const ok = await connectOnce();
    if (!ok) scheduleRetry();
  }, RETRY_MS);
  if (retryTimer.unref) retryTimer.unref();
}

async function initDb() {
  const ok = await connectOnce();
  if (!ok) scheduleRetry();
  return ok;
}

function isOnline() { return status === 'online' && !!users; }
function assertOnline() {
  if (!isOnline()) throw new Error('database offline');
}

// ---------------- users ----------------

async function createUser({ username, usernameLower, salt, hash }) {
  assertOnline();
  const doc = {
    _id: require('crypto').randomUUID(),
    username,
    usernameLower,
    salt,
    hash,
    points: 0,
    gamesPlayed: 0,
    wins: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSeenAt: new Date(),
  };
  await users.insertOne(doc);
  return doc;
}

async function getUserByUsername(usernameLower) {
  if (!isOnline()) return null;
  return users.findOne({ usernameLower });
}

async function getUserById(id) {
  if (!isOnline()) return null;
  return users.findOne({ _id: String(id) });
}

async function getUserCount() {
  if (!isOnline()) return 0;
  return users.countDocuments({});
}

async function touchUser(id) {
  if (!isOnline()) return;
  await users.updateOne({ _id: String(id) }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
}

async function addPoints(userId, amount, meta = {}) {
  if (!isOnline()) return null;
  const delta = Math.round(Number(amount) || 0);
  if (!delta) return null;
  const res = await users.findOneAndUpdate(
    { _id: String(userId) },
    { $inc: { points: delta }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after', projection: { points: 1, username: 1 } }
  );
  await pointEvents.insertOne({
    userId: String(userId),
    amount: delta,
    ...meta,
    at: new Date(),
  }).catch(() => {});
  return res ? res.points : null;
}

// Atomically deduct points only if the balance covers it. Returns the new
// balance, or null when the balance is insufficient / DB is offline.
async function spendPoints(userId, amount) {
  if (!isOnline()) return null;
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return null;
  const res = await users.findOneAndUpdate(
    { _id: String(userId), points: { $gte: amt } },
    { $inc: { points: -amt }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after', projection: { points: 1 } }
  );
  return res ? res.points : null;
}

async function recordMatch(userId, { game, mode, place, points }) {
  if (!isOnline()) return;
  await users.updateOne(
    { _id: String(userId) },
    {
      $inc: { gamesPlayed: 1, wins: place === 1 ? 1 : 0 },
      $set: { updatedAt: new Date() },
    }
  ).catch(() => {});
}

async function topUsers(limit = 20) {
  if (!isOnline()) return [];
  const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  return users.find({}, { projection: { username: 1, points: 1, wins: 1, gamesPlayed: 1 } })
    .sort({ points: -1, wins: -1, createdAt: 1 })
    .limit(n)
    .toArray();
}

async function getUserRank(userId) {
  if (!isOnline()) return null;
  const me = await getUserById(userId);
  if (!me) return null;
  const above = await users.countDocuments({ points: { $gt: me.points || 0 } });
  return above + 1;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    username: u.username,
    points: u.points || 0,
    wins: u.wins || 0,
    gamesPlayed: u.gamesPlayed || 0,
    createdAt: u.createdAt,
  };
}

// ---------------- sessions ----------------

async function createSession({ userId, tokenHash, expiresAt, ip, userAgent }) {
  assertOnline();
  await sessions.insertOne({
    _id: require('crypto').randomUUID(),
    userId: String(userId),
    tokenHash,
    createdAt: new Date(),
    expiresAt,
    ip: String(ip || '').slice(0, 64),
    userAgent: String(userAgent || '').slice(0, 256),
  });
}

async function getSession(tokenHash) {
  if (!isOnline()) return null;
  const s = await sessions.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!s) return null;
  const u = await getUserById(s.userId);
  if (!u) return null;
  return { session: s, user: u };
}

async function deleteSession(tokenHash) {
  if (!isOnline()) return;
  await sessions.deleteOne({ tokenHash }).catch(() => {});
}

async function deleteUserSessions(userId) {
  if (!isOnline()) return;
  await sessions.deleteMany({ userId: String(userId) }).catch(() => {});
}

async function cleanupSessions() {
  if (!isOnline()) return;
  await sessions.deleteMany({ expiresAt: { $lte: new Date() } }).catch(() => {});
}

// ---------------- high scores (legacy per-game board) ----------------

async function saveScore({ game, name, score, meta, userId }) {
  if (!SCORED_GAMES.has(game)) return { ok: false, error: 'unscored game' };
  if (!isOnline()) return { ok: false, offline: true };
  const clean = {
    game: String(game),
    name: String(name || 'Anonymous').slice(0, 16) || 'Anonymous',
    score: Math.max(0, Math.round(Number(score) || 0)),
    meta: meta && typeof meta === 'object' ? meta : {},
    userId: userId ? String(userId) : null,
    at: new Date(),
  };
  try {
    await scores.insertOne(clean);
    const rank = await scores.countDocuments({ game: clean.game, score: { $gt: clean.score } });
    return { ok: true, rank: rank + 1 };
  } catch (err) {
    console.warn('[db] saveScore failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function topScores(game, limit = 10) {
  if (!isOnline()) return [];
  try {
    const rows = await scores
      .find({ game: String(game) })
      .sort({ score: -1, at: 1 })
      .limit(Math.max(1, Math.min(50, parseInt(limit, 10) || 10)))
      .toArray();
    return rows.map((r) => ({ name: r.name, score: r.score, meta: r.meta || {}, at: r.at }));
  } catch (err) {
    console.warn('[db] topScores failed:', err.message);
    return [];
  }
}

// ---------------- derby persistence ----------------

async function saveRace(race) {
  if (!isOnline()) return;
  await races.insertOne({ ...race, at: new Date() }).catch(() => {});
}

async function saveBet(bet) {
  if (!isOnline()) return;
  await bets.insertOne({ ...bet, at: new Date() }).catch(() => {});
}

async function closeDb() {
  closed = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (client) { try { await client.close(); } catch (_) {} }
}

module.exports = {
  initDb,
  isOnline,
  closeDb,
  SCORED_GAMES,
  // users
  createUser,
  getUserByUsername,
  getUserById,
  getUserCount,
  touchUser,
  addPoints,
  spendPoints,
  recordMatch,
  topUsers,
  getUserRank,
  publicUser,
  // sessions
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  cleanupSessions,
  // scores
  saveScore,
  topScores,
  // derby
  saveRace,
  saveBet,
  get status() { return status; },
};
