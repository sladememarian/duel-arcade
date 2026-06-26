// server.js — Express + Socket.io. Server is the single source of truth.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { Quoridor } = require('./game/quoridor');
const { InfiniteTTT } = require('./game/infiniteTTT');
const { chooseQuoridorMove } = require('./game/quoridorAI');
const { chooseTTTMove } = require('./game/tttAI');
const { Island, DURATIONS } = require('./game/island');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

// ---- room registry ----
// rooms[code] = {
//   game: 'barricade'|'ttt', mode:'pvp'|'pve',
//   engine, players: { 1: socketId|null, 2: socketId|'AI'|null },
//   aiDifficulty
// }
const rooms = {};

function makeCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[c]);
  return c;
}

function newEngine(game) {
  return game === 'barricade' ? new Quoridor() : new InfiniteTTT();
}

function broadcastState(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('state', { code, state: room.engine.serialize(), mode: room.mode });
}

// Drive the AI when it's the AI's turn (PvE). AI is always player 2.
function maybeAIMove(code) {
  const room = rooms[code];
  if (!room || room.mode !== 'pve') return;
  const eng = room.engine;
  if (eng.winner || eng.turn !== 2) return;
  setTimeout(() => {
    const r = rooms[code];
    if (!r || r.engine.winner || r.engine.turn !== 2) return;
    const eng2 = r.engine;
    let res;
    if (r.game === 'barricade') {
      const action = chooseQuoridorMove(eng2, 2, r.aiDifficulty || 'hard');
      res = action ? eng2.applyMove(2, action) : { ok: false };
    } else {
      const cell = chooseTTTMove(eng2, 2);
      res = eng2.applyMove(2, cell);
    }
    broadcastState(code);
    // TTT/Barricade AI never chains (turn flips to human), so no recursion needed.
  }, 450); // small "thinking" delay
}

// ===================================================================
// ISLAND — multiplayer social-deduction game (3+ players).
// Island rooms live in the same `rooms` registry but have a different
// shape: { game:'island', engine:Island, timer, botTimers[], phaseEndsAt }.
// The server owns all phase timers; the engine is pure logic.
// ===================================================================
const BOT_NAMES = ['Mango', 'Coco', 'Pearl', 'Reef', 'Drift', 'Sandy', 'Kelp', 'Marlin', 'Shelly', 'Finn'];
const BOT_LINES = [
  'I think we should target someone quiet.',
  'Not me, I swear! Vote with me?',
  'I heard they were scheming last night.',
  'Let’s team up — who do you trust?',
  'I’m watching everyone closely.',
  'Stay calm. We’ll get through this.',
  'I’ve got a bad feeling about them.',
  'Deal. I’ll follow your lead.',
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

// ---- phase drivers ----
function islandStartDiscussion(code) {
  const room = rooms[code];
  if (!room) return;
  clearBotTimers(code);
  broadcastIsland(code); // engine already in 'discussion'
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
  broadcastIsland(code); // 'reveal' with lastResult
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
  broadcastIsland(code); // 'ended'
}

// ---- bot behaviour (so the game is playable / testable solo) ----
function scheduleBotVotes(code) {
  const room = rooms[code];
  if (!room) return;
  const eng = room.engine;
  for (const bot of eng.alivePlayers().filter((p) => p.isBot)) {
    const delay = 1500 + Math.random() * DURATIONS.voting * 600; // vote within first ~60%
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

io.on('connection', (socket) => {
  socket.data.room = null;
  socket.data.seat = null;

  // ---- PvE: create a solo room vs the computer ----
  socket.on('createPvE', ({ game, difficulty }) => {
    if (game !== 'barricade' && game !== 'ttt') return;
    const code = makeCode();
    rooms[code] = {
      game, mode: 'pve',
      engine: newEngine(game),
      players: { 1: socket.id, 2: 'AI' },
      aiDifficulty: difficulty || 'hard',
    };
    socket.join(code);
    socket.data.room = code; socket.data.seat = 1;
    socket.emit('joined', { code, seat: 1, game, mode: 'pve' });
    broadcastState(code);
    maybeAIMove(code);
  });

  // ---- PvP: host creates a room and waits for a friend ----
  socket.on('createPvP', ({ game }) => {
    if (game !== 'barricade' && game !== 'ttt') return;
    const code = makeCode();
    rooms[code] = {
      game, mode: 'pvp',
      engine: newEngine(game),
      players: { 1: socket.id, 2: null },
    };
    socket.join(code);
    socket.data.room = code; socket.data.seat = 1;
    socket.emit('joined', { code, seat: 1, game, mode: 'pvp' });
    socket.emit('waiting', { code });
  });

  // ---- PvP: friend joins with the code ----
  socket.on('joinPvP', ({ code }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('errorMsg', 'Room not found.');
    if (room.mode !== 'pvp') return socket.emit('errorMsg', 'That room is not a multiplayer room.');
    if (room.players[2]) return socket.emit('errorMsg', 'Room is already full.');
    room.players[2] = socket.id;
    socket.join(code);
    socket.data.room = code; socket.data.seat = 2;
    socket.emit('joined', { code, seat: 2, game: room.game, mode: 'pvp' });
    io.to(code).emit('opponentJoined', { code });
    broadcastState(code);
  });

  // ---- a move from a client ----
  socket.on('move', (action) => {
    const code = socket.data.room;
    const seat = socket.data.seat;
    const room = rooms[code];
    if (!room || !seat) return;
    if (room.mode === 'pvp' && !room.players[2]) {
      return socket.emit('errorMsg', 'Waiting for an opponent to join.');
    }
    let res;
    if (room.game === 'barricade') {
      res = room.engine.applyMove(seat, action);
    } else {
      res = room.engine.applyMove(seat, action.cell);
    }
    if (!res.ok) return socket.emit('errorMsg', res.error || 'Illegal move.');
    broadcastState(code);
    maybeAIMove(code);
  });

  // ---- rematch: reset the engine in place ----
  socket.on('rematch', () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    room.engine = newEngine(room.game);
    broadcastState(code);
    maybeAIMove(code);
  });

  // ================= ISLAND HANDLERS =================
  socket.on('createIsland', ({ name }) => {
    if (socket.data.room) cleanup(socket);
    const code = makeCode();
    rooms[code] = { game: 'island', engine: new Island(), timer: null, botTimers: [], phaseEndsAt: null, botSeq: 0 };
    rooms[code].engine.addPlayer(socket.id, name);
    socket.join(code);
    socket.data.room = code; socket.data.seat = null;
    socket.emit('islandJoined', { code, youId: socket.id });
    broadcastIsland(code);
  });

  socket.on('joinIsland', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room || room.game !== 'island') return socket.emit('errorMsg', 'Island room not found.');
    if (room.engine.phase !== 'lobby') return socket.emit('errorMsg', 'That game has already started.');
    if (room.engine.players.length >= 10) return socket.emit('errorMsg', 'Room is full.');
    if (socket.data.room && socket.data.room !== code) cleanup(socket);
    room.engine.addPlayer(socket.id, name);
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

  // host may end the whisper phase early
  socket.on('islandSkip', () => {
    const code = socket.data.room; const room = rooms[code];
    if (!room || room.game !== 'island') return;
    if (room.engine.hostId !== socket.id) return;
    if (room.engine.phase === 'discussion') islandStartVoting(code);
  });

  // private 1:1 whisper, relayed ONLY to the two participants
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

  // shared chat for the dead while they wait
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
    for (const p of old.players) {
      if (p.connected) ne.addPlayer(p.id, p.name, { isBot: p.isBot });
    }
    if (old.hostId && ne.player(old.hostId)) ne.hostId = old.hostId;
    room.engine = ne;
    broadcastIsland(code);
  });

  socket.on('leaveRoom', () => cleanup(socket));
  socket.on('disconnect', () => cleanup(socket));
});

function cleanup(socket) {
  const code = socket.data.room;
  const room = rooms[code];
  if (!room) return;

  // ---- island rooms ----
  if (room.game === 'island') {
    const eng = room.engine;
    eng.removePlayer(socket.id); // lobby: removed; mid-game: marked disconnected
    socket.leave(code);
    socket.data.room = null; socket.data.seat = null;
    const humans = eng.players.filter((p) => !p.isBot && p.connected);
    if (humans.length === 0) {
      clearIslandTimer(code); clearBotTimers(code);
      delete rooms[code];
      return;
    }
    // a departure might complete the current vote
    if (eng.phase === 'voting' && eng.allAliveVoted()) islandResolveVoting(code);
    else if (eng.phase === 'ghostVote' && eng.allGhostsVoted()) islandResolveGhost(code);
    else broadcastIsland(code);
    return;
  }

  // notify the other seat
  socket.to(code).emit('opponentLeft', { code });
  // free the seat
  for (const seat of [1, 2]) {
    if (room.players[seat] === socket.id) room.players[seat] = null;
  }
  socket.leave(code);
  socket.data.room = null; socket.data.seat = null;
  // delete empty rooms (ignore the 'AI' seat)
  const humans = [room.players[1], room.players[2]].filter((p) => p && p !== 'AI');
  if (humans.length === 0) delete rooms[code];
}

server.listen(PORT, () => console.log(`Games server listening on :${PORT}`));
