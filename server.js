// server.js — Express + Socket.io. Server is the single source of truth.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { Quoridor } = require('./game/quoridor');
const { InfiniteTTT } = require('./game/infiniteTTT');
const { chooseQuoridorMove } = require('./game/quoridorAI');
const { chooseTTTMove } = require('./game/tttAI');

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

  socket.on('leaveRoom', () => cleanup(socket));
  socket.on('disconnect', () => cleanup(socket));
});

function cleanup(socket) {
  const code = socket.data.room;
  const room = rooms[code];
  if (!room) return;
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
