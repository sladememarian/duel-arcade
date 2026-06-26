// db.js — optional MongoDB-backed leaderboard.
//
// Designed to FAIL SOFT: if MONGO_URL is unset or the database is unreachable,
// every function resolves to an empty/no-op result so the games keep working
// without persistence. The server never blocks on the database.

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || '';
const DB_NAME = process.env.MONGO_DB || 'arcade';

let client = null;
let scores = null;     // the scores collection (or null when offline)
let status = 'disabled'; // 'disabled' | 'connecting' | 'online' | 'error'

// Games that keep a high-score leaderboard (solo + trivia).
const SCORED_GAMES = new Set(['2048', 'memory', 'trivia']);

async function initDb() {
  if (!MONGO_URL) {
    console.log('[db] MONGO_URL not set — leaderboards disabled (games still work).');
    status = 'disabled';
    return;
  }
  status = 'connecting';
  try {
    client = new MongoClient(MONGO_URL, {
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 4000,
    });
    await client.connect();
    const db = client.db(DB_NAME);
    scores = db.collection('scores');
    // index for fast top-N per game; ignore failures (e.g. read-only users)
    await scores.createIndex({ game: 1, score: -1 }).catch(() => {});
    status = 'online';
    console.log(`[db] connected — leaderboards online (db: ${DB_NAME}).`);
  } catch (err) {
    status = 'error';
    scores = null;
    console.warn('[db] connection failed — leaderboards disabled:', err.message);
  }
}

function isOnline() { return status === 'online' && !!scores; }

// Persist a score. Lower-is-better games (memory = moves, time) are normalized
// to a higher-is-better `score` by the caller, so we always sort score desc.
// Returns { ok, rank? }.
async function saveScore({ game, name, score, meta }) {
  if (!SCORED_GAMES.has(game)) return { ok: false, error: 'unscored game' };
  if (!isOnline()) return { ok: false, offline: true };
  const clean = {
    game: String(game),
    name: String(name || 'Anonymous').slice(0, 16) || 'Anonymous',
    score: Math.max(0, Math.round(Number(score) || 0)),
    meta: meta && typeof meta === 'object' ? meta : {},
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

// Top N scores for a game, best first. Returns [] when offline.
async function topScores(game, limit = 10) {
  if (!isOnline()) return [];
  try {
    const rows = await scores
      .find({ game: String(game) })
      .sort({ score: -1, at: 1 })
      .limit(Math.max(1, Math.min(50, limit)))
      .toArray();
    return rows.map((r) => ({ name: r.name, score: r.score, meta: r.meta || {}, at: r.at }));
  } catch (err) {
    console.warn('[db] topScores failed:', err.message);
    return [];
  }
}

async function closeDb() {
  if (client) { try { await client.close(); } catch (_) {} }
}

module.exports = { initDb, saveScore, topScores, isOnline, closeDb, SCORED_GAMES, get status() { return status; } };
