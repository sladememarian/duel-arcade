// test/e2e-live.js — end-to-end tests against a running arcade + MongoDB.
//
// Unlike test/e2e.js (which boots an isolated, DB-less server), this suite talks
// to the real deployment, normally `docker compose up -d`. It covers the paths
// that need accounts and persistence: registration, login, sessions, solo
// prizes, overall leaderboard, derby wagers, online two-player awards,
// matchmaking, Word Bomb, Ink Rush and logout.
//
//   docker compose up -d --build
//   npm run test:e2e:live
//
// Registration is rate-limited to 5 attempts per IP per 10 minutes. This suite
// uses three, so restart the games service before an immediate re-run:
//   docker compose restart games
const { io } = require('socket.io-client');
const { wordsWith } = require('../game/wordlist');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = 'Purple42harbor';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  ok ? passed++ : failed++;
}

function uniqueUsername(tag) {
  const stamp = Date.now().toString(36).slice(-7);
  const rand = Math.floor(Math.random() * 36).toString(36);
  return `e2e_${stamp}${tag}${rand}`.slice(0, 16);
}

function pickCookie(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.length ? list : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of raw) {
    const m = /(?:^|,\s*)(arcade_sid=[^;]+)/.exec(String(c));
    if (m) return m[1];
  }
  return null;
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const headers = { Origin: BASE };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text, cookie: pickCookie(res) };
}

function connect(cookie) {
  const sock = io(BASE, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });

  const latest = new Map();
  const listeners = new Map();
  for (const ev of ['joined', 'state', 'pointsAwarded', 'errorMsg', 'mmMatched',
    'mmSearching', 'mmIdle', 'derbyState', 'wordbombJoined', 'wordbombState',
    'inkrushJoined', 'inkrushState', 'you', 'opponentLeft']) {
    sock.on(ev, (msg) => {
      latest.set(ev, msg);
      const hs = listeners.get(ev);
      if (hs) for (const h of [...hs]) { try { h(msg); } catch (_) { /* noop */ } }
    });
  }

  const track = {
    latest: (ev) => latest.get(ev),
    wait(ev, pred = () => true, timeout = 8000) {
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
    },
  };

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 6000);
    sock.once('connect', () => { clearTimeout(timer); resolve(); });
    sock.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });

  return { sock, track, ready };
}

function emptyBigramWord(bigram, used = new Set()) {
  return wordsWith(bigram).find((w) => !used.has(w) && w.length >= 3 && w.length <= 12);
}

async function main() {
  console.log(`\nLive E2E against ${BASE}\n`);
  const sockets = [];
  const open = (cookie) => { const c = connect(cookie); sockets.push(c.sock); return c; };

  try {
    // ---------------- platform ----------------
    const health = await api('/healthz');
    check('healthz responds and Mongo is online', health.status === 200 && health.json.db === 'online',
      `(${health.json && health.json.db})`);

    const prizes = await api('/api/prizes');
    const prizeCount = prizes.json && prizes.json.ok ? Object.keys(prizes.json.prizes).length : 0;
    check('prize table exposes 10 games and the 60-seat cap',
      prizes.status === 200 && prizeCount === 10 && prizes.json.maxUsers === 60);

    const anon = await api('/api/auth/me');
    check('anonymous /api/auth/me is rejected', anon.status === 401);

    // ---------------- accounts ----------------
    const nameA = uniqueUsername('a');
    const nameB = uniqueUsername('b');
    const regA = await api('/api/auth/register', { method: 'POST', body: { username: nameA, password: PASSWORD } });
    check('register creates an account with a session cookie',
      regA.status === 200 && regA.json.ok && regA.json.user.username === nameA && !!regA.cookie,
      `(${nameA}, ${regA.json && regA.json.user && regA.json.user.points} pts)`);

    const dup = await api('/api/auth/register', { method: 'POST', body: { username: nameA, password: 'Another99pass' } });
    check('duplicate username is rejected', dup.status === 409);

    const wrong = await api('/api/auth/login', { method: 'POST', body: { username: nameA, password: 'Wrongpass99' } });
    check('wrong password is rejected', wrong.status === 401);

    const loginA = await api('/api/auth/login', { method: 'POST', body: { username: nameA, password: PASSWORD } });
    check('login issues a fresh session cookie', loginA.status === 200 && loginA.json.ok && !!loginA.cookie);
    const cookieA = loginA.cookie;

    const meA = await api('/api/auth/me', { cookie: cookieA });
    check('/api/auth/me returns the signed-in account', meA.status === 200 && meA.json.user.username === nameA);

    const regB = await api('/api/auth/register', { method: 'POST', body: { username: nameB, password: PASSWORD } });
    check('second account registers for the head-to-head tests',
      regB.status === 200 && regB.json.ok && !!regB.cookie);
    const cookieB = regB.cookie;

    // ---------------- solo prize + leaderboard ----------------
    const soloAnon = await api('/api/solo/complete', { method: 'POST', body: { game: 'g2048', score: 256 } });
    check('solo prize requires a session', soloAnon.status === 401);

    const solo = await api('/api/solo/complete', {
      method: 'POST', cookie: cookieA, body: { game: 'g2048', score: 512, meta: { size: 4 } },
    });
    check('solo completion credits the 20-point prize',
      solo.status === 200 && solo.json.ok && solo.json.points === 20 && solo.json.balance === 20);

    const soloAgain = await api('/api/solo/complete', {
      method: 'POST', cookie: cookieA, body: { game: 'g2048', score: 512 },
    });
    check('solo prize respects the 45-second cooldown', soloAgain.status === 429);

    const meAfterSolo = await api('/api/auth/me', { cookie: cookieA });
    check('points and match record are persisted',
      meAfterSolo.json.user.points === 20 && meAfterSolo.json.user.wins === 1 && meAfterSolo.json.user.gamesPlayed === 1);

    const overall = await api('/api/leaderboard/overall?limit=100');
    const rowA = overall.json.users.find((u) => u.username === nameA);
    check('overall leaderboard lists the new score',
      overall.status === 200 && overall.json.online === true && rowA && rowA.points === 20);

    // ---------------- derby ----------------
    const a = open(cookieA);
    await a.ready;
    const youA = await a.track.wait('you', () => true, 3000).catch(() => null);
    check('socket handshake authenticates the session cookie',
      youA && youA.user && youA.user.username === nameA);

    const betting = await a.track.wait('derbyState',
      (s) => s.phase === 'betting' && s.endsAt - Date.now() > 5000, 60000);
    check('derby is taking wagers with four horses',
      betting.horses.length === 4 && betting.minBet === 10 && betting.totalPool >= 0);

    const guest = open(null);
    await guest.ready;
    guest.sock.emit('derbyBet', { horse: 'nightfall', amount: 10 });
    const guestErr = await guest.track.wait('errorMsg', (m) => /sign in/i.test(m), 4000);
    check('anonymous derby wagers are refused', /sign in/i.test(guestErr));

    const betPoints = a.track.wait('pointsAwarded', (p) => p.game === 'derby', 5000);
    const betState = a.track.wait('derbyState',
      (s) => (s.yourBets || []).some((b) => b.horseId === 'nightfall' && b.amount === 10), 5000);
    a.sock.emit('derbyBet', { horse: 'nightfall', amount: 10 });
    const wager = await betPoints;
    await betState;
    check('derby wager debits points and updates the pool',
      wager.points === -10 && wager.balance === 10);

    const b = open(cookieB);
    await b.ready;
    b.sock.emit('derbyBet', { horse: 'ember', amount: 10 });
    const broke = await b.track.wait('errorMsg', (m) => /enough points/i.test(m), 4000);
    check('derby refuses a stake above the balance', /enough points/i.test(broke));

    // ---------------- online two-player award ----------------
    const host = open(cookieA);
    const guest2 = open(cookieB);
    await Promise.all([host.ready, guest2.ready]);

    host.sock.emit('createPvP', { game: 'ttt' });
    const hj = await host.track.wait('joined', (j) => j.game === 'ttt', 4000);
    const guestJoin = guest2.track.wait('joined', (j) => j.game === 'ttt', 4000);
    const initial = guest2.track.wait('state', (m) => m.state.turn === 1, 4000);
    guest2.sock.emit('joinPvP', { code: hj.code });
    await guestJoin;
    await initial;
    check('two-player room creates seats and an initial state', hj.seat === 1);

    const play = async (sock, track, action, pred) => {
      const p = track.wait('state', pred, 4000);
      sock.emit('move', action);
      return p;
    };
    await play(host.sock, host.track, { cell: 0 }, (m) => m.state.board[0] === 1);
    await play(guest2.sock, guest2.track, { cell: 3 }, (m) => m.state.board[3] === 2);
    await play(host.sock, host.track, { cell: 1 }, (m) => m.state.board[1] === 1);
    await play(guest2.sock, guest2.track, { cell: 4 }, (m) => m.state.board[4] === 2);

    const awardHost = host.track.wait('pointsAwarded', (p) => p.game === 'ttt', 6000);
    const awardGuest = guest2.track.wait('pointsAwarded', (p) => p.game === 'ttt', 6000);
    const win = host.track.wait('state', (m) => m.state.winner === 1, 4000);
    host.sock.emit('move', { cell: 2 });
    await win;
    const [pa, pb] = await Promise.all([awardHost, awardGuest]);
    check('online winner receives the full 110-point pool',
      pa.place === 1 && pa.points === 110 && pa.balance === 120, `(balance ${pa.balance})`);
    check('runner-up receives the 17-point consolation', pb.place === 2 && pb.points === 17);

    const meA2 = await api('/api/auth/me', { cookie: cookieA });
    const meB2 = await api('/api/auth/me', { cookie: cookieB });
    check('match awards persist to both accounts',
      meA2.json.user.points === 120 && meB2.json.user.points === 17);

    // ---------------- matchmaking ----------------
    const mmA = open(cookieA);
    const mmB = open(cookieB);
    await Promise.all([mmA.ready, mmB.ready]);
    const matchA = mmA.track.wait('mmMatched', () => true, 5000);
    const matchB = mmB.track.wait('mmMatched', () => true, 5000);
    const joinedA = mmA.track.wait('joined', () => true, 5000);
    const joinedB = mmB.track.wait('joined', () => true, 5000);
    const mmState = mmB.track.wait('state', () => true, 5000);
    mmA.sock.emit('mmJoin', { game: 'ttt' });
    await sleep(100);
    mmB.sock.emit('mmJoin', { game: 'ttt' });
    const [ma, mb, ja, jb, ms] = await Promise.all([matchA, matchB, joinedA, joinedB, mmState]);
    check('matchmaking pairs two humans into one room',
      ma.code === mb.code && ma.bots === false && ja.seat === 1 && jb.seat === 2 && ms.state.type === 'ttt',
      `(room ${ma.code})`);

    const mmMove = mmB.track.wait('state', (m) => m.state.board[0] === 1, 4000);
    mmA.sock.emit('move', { cell: 0 });
    await mmMove;
    check('a matchmade room accepts moves', true);

    const guestMm = open(null);
    await guestMm.ready;
    guestMm.sock.emit('mmJoin', { game: 'ttt' });
    const mmErr = await guestMm.track.wait('errorMsg', (m) => /sign in/i.test(m), 4000);
    check('guest matchmaking is refused', /sign in/i.test(mmErr));

    // ---------------- Word Bomb ----------------
    const wb = open(null);
    await wb.ready;
    wb.sock.emit('createWordBomb', { rounds: 3 });
    const wbJoin = await wb.track.wait('wordbombJoined', () => true, 4000);
    check('Word Bomb room created', !!wbJoin.code);

    wb.sock.emit('wordbombAddBot');
    wb.sock.emit('wordbombAddBot');
    const wbLobby = await wb.track.wait('wordbombState',
      (m) => m.state.players.length === 3 && m.state.players.filter((p) => p.isBot).length === 2, 4000);
    check('Word Bomb lobby accepts two bots', wbLobby.state.players.length === 3);

    wb.sock.emit('wordbombStart');
    const wbRound = (await wb.track.wait('wordbombState', (m) => m.state.phase === 'round', 4000)).state;
    const wbWord = emptyBigramWord(wbRound.bigram);
    check('Word Bomb reveals a playable bigram', wbRound.bigram.length === 2 && !!wbWord,
      `("${wbRound.bigram}")`);
    const wbAnswered = wb.track.wait('wordbombState', (m) => m.state.youSubmitted === true, 4000);
    wb.sock.emit('wordbombSubmit', { word: wbWord });
    const wbAfter = (await wbAnswered).state;
    check('Word Bomb accepts a valid word and marks the player answered',
      wbAfter.youSubmitted === true && wbAfter.players.find((p) => p.isMe).answered === true);

    // ---------------- Ink Rush ----------------
    const ir = open(null);
    await ir.ready;
    ir.sock.emit('createInkRush', { rounds: 3 });
    const irJoin = await ir.track.wait('inkrushJoined', () => true, 4000);
    check('Ink Rush room created', !!irJoin.code);

    ir.sock.emit('inkrushAddBot');
    ir.sock.emit('inkrushAddBot');
    await ir.track.wait('inkrushState', (m) => m.state.players.length === 3, 4000);
    ir.sock.emit('inkrushStart');
    const irPrompt = (await ir.track.wait('inkrushState', (m) => m.state.phase === 'prompt', 4000)).state;
    check('Ink Rush deals a name/ink prompt with four choices',
      irPrompt.colors.length === 4 && irPrompt.prompt && irPrompt.prompt.ink >= 0 && irPrompt.prompt.ink < 4);

    await sleep(400); // server enforces a 300ms minimum reaction time
    const irAnswered = ir.track.wait('inkrushState', (m) => m.state.youAnswered === true, 4000);
    ir.sock.emit('inkrushAnswer', { choice: irPrompt.prompt.ink });
    const irAfter = (await irAnswered).state;
    check('Ink Rush accepts the correct ink and marks the player answered', irAfter.youAnswered === true);

    // ---------------- logout ----------------
    const out = await api('/api/auth/logout', { method: 'POST', cookie: cookieB, body: {} });
    const meAfterLogout = await api('/api/auth/me', { cookie: cookieB });
    check('logout destroys the session', out.status === 200 && meAfterLogout.status === 401);

  } catch (err) {
    console.log('  FATAL  ' + err.message);
    failed++;
  } finally {
    for (const s of sockets) {
      try { s.disconnect(); } catch (_) { /* noop */ }
    }
    await sleep(300);
    console.log(`\n=== LIVE E2E RESULT: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed ? 1 : 0);
  }
}

main();
