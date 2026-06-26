// public/js/main.js — screen navigation + Socket.io client wiring.
(function () {
  const socket = io();

  // UI state
  const ui = {
    game: null,        // 'barricade' | 'ttt'
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
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- ISLAND (multiplayer social game) ----------
  if (window.IslandClient) {
    window.IslandClient.init(socket, { show, toast });
  }

  // ---------- MENU ----------
  document.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (card.dataset.game === 'island') {
        if (window.IslandClient) window.IslandClient.open();
        return;
      }
      ui.game = card.dataset.game;
      $('#mode-title').textContent = (ui.game === 'barricade' ? 'Barricade' : 'Infinite Tic Tac Toe') + ' — choose mode';
      $('#join-wrap').classList.add('hidden');
      $('#difficulty-wrap').classList.remove('hidden');
      show('mode');
    });
  });

  // back buttons
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
    const wrap = $('#board-wrap');
    const ctx = { seat: ui.seat, tool: ui.tool, orient: ui.orient, onMove };
    if (ui.game === 'barricade') {
      $('#bar-controls').classList.remove('hidden');
      BarricadeUI.render(wrap, ui.state, ctx);
      $('#status').textContent = BarricadeUI.statusText(ui.state, ui.seat, ui.mode);
    } else {
      $('#bar-controls').classList.add('hidden');
      TttUI.render(wrap, ui.state, ctx);
      $('#status').textContent = TttUI.statusText(ui.state, ui.seat, ui.mode);
    }
    handleEnd();
  }

  function handleEnd() {
    const over = !!ui.state.winner;
    const ov = $('#overlay');
    if (over) {
      const won = ui.state.winner === ui.seat;
      $('#overlay-title').textContent = won ? 'Victory 🎉' : 'Defeat';
      $('#overlay-text').textContent = won
        ? 'You reached the goal first!'
        : (ui.mode === 'pve' ? 'The computer got there first.' : 'Your opponent won this round.');
      ov.classList.remove('hidden');
    } else {
      ov.classList.add('hidden');
    }
  }

  $('#overlay-rematch').addEventListener('click', () => { socket.emit('rematch'); $('#overlay').classList.add('hidden'); });
  $('#rematch').addEventListener('click', () => socket.emit('rematch'));
  $('#overlay-menu').addEventListener('click', () => { socket.emit('leaveRoom'); resetToMenu(); });

  // ---------- SOCKET EVENTS ----------
  socket.on('joined', ({ code, seat, game, mode }) => {
    ui.code = code; ui.seat = seat; ui.game = game; ui.mode = mode;
    ui.tool = 'move'; ui.orient = 'h';
    // reset bar control buttons
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
