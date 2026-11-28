'use strict';
// Seed/cleanup helper for the public load test (any count up to MAX_SEED).
//
// This script is meant to run INSIDE the app container, where MONGO_URL,
// MONGO_DB and SESSION_SECRET are already configured, and where the app's
// node_modules live. It creates real accounts + sessions so the load client
// can authenticate without tripping the per-IP registration limiter.
//
//   docker cp test/load-seed.js game-arcade:/tmp/load-seed.js
//   docker exec game-arcade node /tmp/load-seed.js seed 60 /tmp/load-users.json
//   docker cp game-arcade:/tmp/load-users.json ./load-users.json
//   # ... run test/load-60.js ...
//   docker exec game-arcade node /tmp/load-seed.js clean /tmp/load-users.json
//
// The seed password is the same for every account and is only for this test
// database; it is never used by the app itself.

const fs = require('fs');
const auth = require('/app/auth.js');
const db = require('/app/db.js');

const MODE = process.argv[2] || 'seed';

async function clean(file) {
  const users = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = users.map((u) => String(u.id));
  const names = users.map((u) => u.usernameLower);
  const { MongoClient } = require('/app/node_modules/mongodb');
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  const database = client.db(process.env.MONGO_DB || 'arcade');
  const deleted = {};
  deleted.sessions = (await database.collection('sessions').deleteMany({ userId: { $in: ids } })).deletedCount;
  deleted.scores = (await database.collection('scores').deleteMany({ userId: { $in: ids } })).deletedCount;
  deleted.pointEvents = (await database.collection('point_events').deleteMany({ userId: { $in: ids } })).deletedCount;
  deleted.bets = (await database.collection('bets').deleteMany({ userId: { $in: ids } })).deletedCount;
  deleted.users = (await database.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
  deleted.users += (await database.collection('users').deleteMany({ usernameLower: { $in: names } })).deletedCount;
  await client.close();
  console.log(JSON.stringify({ cleaned: deleted }, null, 2));
}

async function seed(count, outfile) {
  const ok = await db.initDb();
  if (!ok) throw new Error('database is not reachable');

  const runId = Date.now().toString(36).slice(-5);
  const { salt, hash } = await auth.hashPassword('Loadtest123');
  const out = [];

  for (let i = 0; i < count; i++) {
    const username = `load_${runId}_${String(i).padStart(2, '0')}`;
    const user = await db.createUser({ username, usernameLower: username.toLowerCase(), salt, hash });
    await db.addPoints(user._id, 200, { game: 'loadseed', mode: 'seed', points: 200 });
    const token = auth.newSessionToken();
    await db.createSession({
      userId: user._id,
      tokenHash: auth.hashToken(token),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      ip: 'loadtest',
      userAgent: 'loadtest',
    });
    out.push({
      username,
      usernameLower: username.toLowerCase(),
      id: user._id,
      cookie: `${auth.COOKIE_NAME}=${token}`,
      points: 200,
    });
  }

  fs.writeFileSync(outfile, JSON.stringify(out));
  console.log(JSON.stringify({ seeded: out.length, runId, outfile, sample: out[0].username }, null, 2));
}

async function main() {
  if (MODE === 'clean') {
    await clean(process.argv[3] || '/tmp/load-users.json');
    return;
  }
  const maxSeed = Math.max(1, parseInt(process.env.MAX_SEED, 10) || 500);
  const count = Math.max(1, Math.min(maxSeed, parseInt(process.argv[3], 10) || 60));
  await seed(count, process.argv[4] || '/tmp/load-users.json');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[load-seed]', err && err.stack ? err.stack : err);
  process.exit(1);
});
