// public/js/main.js — screen navigation + Socket.io client wiring.
// Two-player games (barricade, ttt, connect4, reversi) share the PvE/PvP room
// flow below. Solo games (2048, memory) and social games (island, trivia) are
// self-contained modules that take over their own screens.
(function () {
  const socket = io();

  // UI state (for the shared two-player flow)
  const ui = {
    game: null,        // 'barricade' | 'ttt' | 'connect4' | 'reversi'
    mode: null,        // 'pve' | 'pvp'
    difficulty: 'easy',
    seat: null,
    tool: 'move',      // barricade: 'move' | 'wall'
    orient: 'h',
    state: null,
    code: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const screens = { menu: $('#menu'), mode: $('#mode'), game: $('#game') };
  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---- game registry ----
  const TWO_PLAYER_UI = {
    barricade: () => window.BarricadeUI,
    ttt: () => window.TttUI,
    connect4: () => window.Connect4UI,
    reversi: () => window.ReversiUI,
  };
  const TITLES = { barricade: 'Barricade', ttt: 'Infinite Tic Tac Toe', connect4: 'Connect 4', reversi: 'Reversi' };
  const SOCIAL = { island: () => window.IslandClient, trivia: () => window.TriviaClient };
  const SOLO = { g2048: () => window.G2048, memory: () => window.MemoryGame };

  // ---- init self-contained modules ----
  const helpers = { show, toast };
  if (window.IslandClient) window.IslandClient.init(socket, helpers);
  if (window.TriviaClient) window.TriviaClient.init(socket, helpers);
  if (window.G2048) window.G2048.init(helpers);
  if (window.MemoryGame) window.MemoryGame.init(helpers);

  // ---------- MENU ----------
  document.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => {
      const g = card.dataset.game;
      if (SOCIAL[g]) { const m = SOCIAL[g](); if (m) m.open(); return; }
      if (SOLO[g]) { const m = SOLO[g](); if (m) m.open(); return; }
      // two-player game → mode select
      ui.game = g;
      $('#mode-title').textContent = (TITLES[g] || 'Game') + ' — choose mode';
      $('#join-wrap').classList.add('hidden');
      $('#difficulty-wrap').classList.remove('hidden');
      show('mode');
    });
  });

  // back buttons (shared two-player screens only)
  document.querySelectorAll('[data-back]').forEach((b) => {
    b.addEventListener('click', () => {
      const target = b.dataset.back;
      if (target === 'quit') { socket.emit('leaveRoom'); resetToMenu(); }
      else show(target);
    });
  });
  function resetToMenu() {
    ui.state = null; ui.seat = null; ui.code = null;
    $('#overlay').classList.add('hidden');
    $('#room-banner').classList.add('hidden');
    show('menu');
  }

  // difficulty seg
  $('#difficulty-wrap').querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      $('#difficulty-wrap').querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active'); ui.difficulty = b.dataset.diff;
    });
  });

  // mode buttons
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'pve') { socket.emit('createPvE', { game: ui.game, difficulty: ui.difficulty }); }
      else if (m === 'pvp-create') { socket.emit('createPvP', { game: ui.game }); }
      else if (m === 'pvp-join') {
        $('#join-wrap').classList.toggle('hidden');
        $('#join-code').focus();
      }
    });
  });
  $('#join-go').addEventListener('click', () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length) socket.emit('joinPvP', { code });
  });
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-go').click(); });

  // ---------- BARRICADE CONTROLS ----------
  function wireBarControls() {
    const ctr = $('#bar-controls');
    ctr.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        ctr.querySelectorAll('[data-tool]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); ui.tool = b.dataset.tool;
        $('#orient-seg').classList.toggle('hidden', ui.tool !== 'wall');
        renderGame();
      });
    });
    ctr.querySelectorAll('[data-orient]').forEach((b) => {
      b.addEventListener('click', () => {
        ctr.querySelectorAll('[data-orient]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); ui.orient = b.dataset.orient;
        renderGame();
      });
    });
  }
  wireBarControls();

  // ---------- SEND MOVES ----------
  function onMove(action) { socket.emit('move', action); }

  // ---------- RENDER ----------
  function renderGame() {
    if (!ui.state) return;
    const mod = TWO_PLAYER_UI[ui.game] && TWO_PLAYER_UI[ui.game]();
    if (!mod) return;
    const wrap = $('#board-wrap');
    const ctx = { seat: ui.seat, tool: ui.tool, orient: ui.orient, onMove };
    $('#bar-controls').classList.toggle('hidden', ui.game !== 'barricade');
    mod.render(wrap, ui.state, ctx);
    $('#status').textContent = mod.statusText(ui.state, ui.seat, ui.mode);
    handleEnd();
  }

  function handleEnd() {
    const st = ui.state;
    const ov = $('#overlay');
    if (!st.winner) { ov.classList.add('hidden'); return; }
    const mod = TWO_PLAYER_UI[ui.game]();
    let info;
    if (mod && mod.endText) {
      info = mod.endText(st, ui.seat, ui.mode);
    } else {
      const won = st.winner === ui.seat;
      info = {
        title: won ? 'Victory 🎉' : 'Defeat',
        text: won ? 'You reached the goal first!'
          : (ui.mode === 'pve' ? 'The computer got there first.' : 'Your opponent won this round.'),
      };
    }
    $('#overlay-title').textContent = info.title;
    $('#overlay-text').textContent = info.text;
    ov.classList.remove('hidden');
  }

  $('#overlay-rematch').addEventListener('click', () => { socket.emit('rematch'); $('#overlay').classList.add('hidden'); });
  $('#rematch').addEventListener('click', () => socket.emit('rematch'));
  $('#overlay-menu').addEventListener('click', () => { socket.emit('leaveRoom'); resetToMenu(); });

  // ---------- SOCKET EVENTS ----------
  socket.on('joined', ({ code, seat, game, mode }) => {
    ui.code = code; ui.seat = seat; ui.game = game; ui.mode = mode;
    ui.tool = 'move'; ui.orient = 'h';
    document.querySelectorAll('#bar-controls [data-tool]').forEach((x) =>
      x.classList.toggle('active', x.dataset.tool === 'move'));
    $('#orient-seg').classList.add('hidden');
    show('game');
    if (mode === 'pvp') {
      $('#room-banner').classList.remove('hidden');
      $('#room-banner').innerHTML = seat === 1
        ? `Share this code with a friend: <b>${code}</b>`
        : `Joined room <b>${code}</b>`;
    } else {
      $('#room-banner').classList.add('hidden');
    }
  });
  socket.on('waiting', () => { $('#status').textContent = 'Waiting for an opponent to join…'; });
  socket.on('opponentJoined', () => { toast('Opponent joined — game on!'); if (ui.mode === 'pvp') $('#room-banner').classList.add('hidden'); });
  socket.on('opponentLeft', () => { toast('Your opponent left the room.'); });
  socket.on('state', ({ code, state, mode }) => { ui.code = code; ui.state = state; ui.mode = mode; renderGame(); });
  socket.on('errorMsg', (m) => toast(m));
  socket.on('disconnect', () => toast('Disconnected from server.'));
})();
