// public/js/main.js — app shell, navigation and the shared socket wiring.
// Exposes window.Arcade for the auth layer and the per-game modules.
(function () {
  const socket = io({ autoConnect: false });
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    user: null,
    prizes: null,
    game: null,
    kind: null,          // 'two' | 'party'
    mode: null,          // 'pve' | 'pvp' | 'mm' | 'botfill'
    difficulty: 'easy',
    seat: null,
    tool: 'move',
    orient: 'h',
    boardState: null,
    code: null,
    awardText: '',
  };

  const TWO = {
    barricade: () => window.BarricadeUI,
    ttt: () => window.TttUI,
    connect4: () => window.Connect4UI,
    reversi: () => window.ReversiUI,
  };
  const TITLES = {
    barricade: 'Barricade',
    ttt: 'Infinite Tic Tac Toe',
    connect4: 'Connect 4',
    reversi: 'Reversi',
    island: 'Island',
    trivia: 'Trivia Royale',
    wordbomb: 'Word Bomb',
    inkrush: 'Ink Rush',
    g2048: '2048',
    memory: 'Memory Match',
    derby: 'The Derby',
  };
  const PARTY = {
    island: { create: 'createIsland', join: 'joinIsland', client: () => window.IslandClient },
    trivia: { create: 'createTrivia', join: 'joinTrivia', client: () => window.TriviaClient },
    wordbomb: { create: 'createWordBomb', join: 'joinWordBomb', client: () => window.WordBombClient },
    inkrush: { create: 'createInkRush', join: 'joinInkRush', client: () => window.InkRushClient },
  };
  const SOLO = { g2048: () => window.G2048, memory: () => window.MemoryGame };

  // ---------------- screens ----------------
  function navFor(name) {
    if (name === 'ranks-screen') return 'ranks';
    if (name === 'derby-screen') return 'derby';
    return 'menu';
  }
  function show(name) {
    const main = $('#main');
    if (main) $$('.screen', main).forEach((s) => s.classList.remove('active'));
    const el = document.getElementById(name);
    if (el) el.classList.add('active');
    const nav = navFor(name);
    $$('.app-nav .nav-link').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === nav));
    if (name !== 'game') {
      $('#overlay').classList.add('hidden');
      $('#room-banner').classList.add('hidden');
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ---------------- account ----------------
  function renderAccount() {
    const u = state.user;
    const name = u ? u.username : 'Player';
    $('#account-name').textContent = name;
    $('#account-initial').textContent = (name[0] || '?').toUpperCase();
    $('#account-points').textContent = u ? (u.points || 0) : 0;
    $('#menu-points').textContent = u ? (u.points || 0) : 0;
    $('#menu-rank').textContent = u && u.rank ? `Rank ${u.rank}` : 'Unranked';
    const dw = $('#derby-wallet');
    if (dw) dw.textContent = u ? (u.points || 0) : 0;
    const rr = $('#ranks-rank');
    if (rr) rr.textContent = u && u.rank ? `#${u.rank}` : '—';
    const rp = $('#ranks-points');
    if (rp) rp.textContent = `${u ? (u.points || 0) : 0} points`;
  }

  function setUser(user) {
    if (user) state.user = { ...(state.user || {}), ...user };
    else state.user = null;
    renderAccount();
  }
  function updatePoints(balance) {
    if (!state.user) return;
    state.user = { ...state.user, points: balance };
    renderAccount();
  }

  // ---------------- data ----------------
  async function loadPrizes() {
    try {
      const r = await fetch('/api/prizes');
      const d = await r.json();
      if (d.ok) state.prizes = d.prizes;
    } catch (_) { /* offline */ }
  }

  function renderRankStrip(users) {
    const el = $('#menu-ranks');
    if (!el) return;
    if (!users.length) { el.innerHTML = '<p class="empty-note">No ranked players yet. Win a game to start the ledger.</p>'; return; }
    el.innerHTML = users.map((u, i) => `
      <div class="rank-row">
        <span class="rank-pos">${i + 1}</span>
        <span class="rank-name">${escapeHtml(u.username)}${u.rank === 1 ? ' <span class="meta">leader</span>' : ''}</span>
        <span class="rank-wins">${u.wins || 0} wins</span>
        <span class="rank-points">${u.points || 0}</span>
      </div>`).join('');
  }

  function renderRanks(users) {
    const el = $('#rank-list');
    if (!el) return;
    if (!users.length) { el.innerHTML = '<p class="empty-note">The board is empty. Play a game to appear here.</p>'; return; }
    el.innerHTML = users.map((u) => `
      <div class="rank-row">
        <span class="rank-pos">${u.rank}</span>
        <span class="rank-name">${escapeHtml(u.username)}</span>
        <span class="rank-wins">${u.wins || 0} wins · ${u.gamesPlayed || 0} played</span>
        <span class="rank-points">${u.points || 0}</span>
      </div>`).join('');
  }

  function renderPrizes() {
    const el = $('#prize-list');
    if (!el) return;
    if (!state.prizes) { el.innerHTML = '<p class="empty-note">Prize pools unavailable.</p>'; return; }
    el.innerHTML = Object.keys(state.prizes).map((key) => {
      const p = state.prizes[key];
      return `<div class="prize-row">
        <span class="prize-name">${escapeHtml(p.title || key)}</span>
        <span class="prize-amounts">
          <span class="prize-chip">offline ${p.offline}</span>
          <span class="prize-chip online">online ${p.online}</span>
        </span>
      </div>`;
    }).join('');
  }

  async function loadRanks() {
    if (!state.prizes) await loadPrizes();
    let users = [];
    let online = false;
    try {
      const r = await fetch('/api/leaderboard/overall?limit=25');
      const d = await r.json();
      if (d.ok) { users = d.users || []; online = !!d.online; }
    } catch (_) { /* offline */ }
    const status = $('#rank-status');
    if (status) status.textContent = online ? '' : 'offline';
    renderRankStrip(users.slice(0, 5));
    renderRanks(users);
    renderPrizes();
    if (state.user && state.user.rank == null) {
      const me = users.find((u) => state.user && u.username === state.user.username);
      if (me) setUser({ ...state.user, rank: me.rank });
    }
  }

  // ---------------- socket lifecycle ----------------
  function connectSocket() {
    if (!socket.connected) socket.connect();
  }
  function enterApp() {
    const auth = $('#auth-screen');
    if (auth) auth.classList.remove('active');
    $('#shell').classList.remove('hidden');
    connectSocket();
    show('menu');
    loadPrizes().then(loadRanks);
  }
  function enterAuth() {
    socket.disconnect();
    $('#shell').classList.add('hidden');
    const auth = $('#auth-screen');
    if (auth) auth.classList.add('active');
  }

  // ---------------- solo helpers ----------------
  async function submitScore(game, score, meta) {
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game,
          name: state.user ? state.user.username : 'Player',
          score,
          meta: meta || {},
        }),
      });
      return await r.json();
    } catch (_) { return { ok: false }; }
  }

  async function completeSolo(game, score, meta) {
    if (!state.user) { toast('Sign in to earn points.'); return { ok: false }; }
    try {
      const r = await fetch('/api/solo/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, score, meta: meta || {} }),
      });
      const d = await r.json();
      if (d.ok) {
        updatePoints(d.balance);
        toast(`Prize claimed · +${d.points} pts`);
      } else {
        toast(d.error || 'No prize available right now.');
      }
      return d;
    } catch (_) {
      toast('Could not claim the prize.');
      return { ok: false };
    }
  }

  // ---------------- menu ----------------
  $$('#game-grid .game-card').forEach((card) => {
    card.addEventListener('click', () => {
      const g = card.dataset.game;
      if (g === 'derby') { if (window.DerbyClient) window.DerbyClient.open(); return; }
      if (SOLO[g]) { const m = SOLO[g](); if (m) m.open(); return; }
      if (PARTY[g]) { openMode(g, 'party'); return; }
      if (TWO[g]) { openMode(g, 'two'); return; }
    });
  });

  function openMode(g, kind) {
    state.game = g;
    state.kind = kind;
    state.mode = null;
    const p = state.prizes && state.prizes[g];
    $('#mode-title').textContent = (TITLES[g] || 'Choose') + ' — choose a mode';
    $('#mode-prize').textContent = p
      ? `A win pays ${p.online} points online or ${p.offline} against the computer.`
      : '';
    $('#mode-pve').classList.toggle('hidden', kind !== 'two');
    $('#difficulty-wrap').classList.toggle('hidden', kind !== 'two');
    $('#join-wrap').classList.add('hidden');
    $('#mode-note').textContent = kind === 'party'
      ? 'Party games need three humans for the full online prize. Matchmaking fills empty seats with the house after thirty seconds.'
      : 'Matchmaking pairs you with another player. Private rooms use a four-character code.';
    show('mode');
  }

  $$('.mode-card').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.dataset.mode;
      const g = state.game;
      if (!g) return;
      if (m === 'mm') {
        if (!state.user) return toast('Sign in to use matchmaking.');
        socket.emit('mmJoin', { game: g });
        startMatchmaking(g);
      } else if (m === 'create') {
        createRoom(g);
      } else if (m === 'join') {
        $('#join-wrap').classList.remove('hidden');
        $('#join-code').focus();
      } else if (m === 'pve') {
        state.mode = 'pve';
        socket.emit('createPvE', { game: g, difficulty: state.difficulty });
      }
    });
  });

  function createRoom(g) {
    const name = state.user ? state.user.username : 'Player';
    if (state.kind === 'two') {
      socket.emit('createPvP', { game: g });
    } else if (PARTY[g]) {
      socket.emit(PARTY[g].create, { name });
    }
  }

  function doJoin() {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length < 4) return toast('Enter the four-character room code.');
    const g = state.game;
    if (state.kind === 'two') socket.emit('joinPvP', { code });
    else if (PARTY[g]) socket.emit(PARTY[g].join, { code, name: state.user ? state.user.username : 'Player' });
  }
  $('#join-go').addEventListener('click', doJoin);
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  // difficulty
  $$('#difficulty-wrap .seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      $$('#difficulty-wrap .seg-btn').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      state.difficulty = b.dataset.diff;
    });
  });

  // ---------------- matchmaking ----------------
  function mmNeed(game) {
    return (game === 'island' || game === 'trivia' || game === 'wordbomb' || game === 'inkrush') ? 3 : 2;
  }
  function startMatchmaking(game) {
    $('#mm-title').textContent = `Finding players — ${TITLES[game] || 'match'}`;
    $('#mm-status').textContent = 'Looking for a room…';
    $('#mm-count').textContent = `0 waiting · ${mmNeed(game)} needed`;
    $('#mm-meter-fill').style.width = '10%';
    show('matchmaking');
  }
  $('#mm-cancel').addEventListener('click', () => { socket.emit('mmLeave'); show('menu'); });

  // ---------------- back buttons ----------------
  $$('[data-back]').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset.back;
      if (t === 'quit') {
        socket.emit('leaveRoom');
        resetBoard();
        show('menu');
      } else if (t === 'menu') {
        if ($('#matchmaking').classList.contains('active')) socket.emit('mmLeave');
        show('menu');
      } else {
        show(t);
      }
    });
  });

  function resetBoard() {
    state.boardState = null;
    state.seat = null;
    state.code = null;
    const wrap = $('#board-wrap');
    if (wrap) wrap.innerHTML = '';
    $('#overlay').classList.add('hidden');
    $('#room-banner').classList.add('hidden');
    $('#rematch').classList.add('hidden');
  }

  // ---------------- barricade controls ----------------
  (function wireBarControls() {
    const ctr = $('#bar-controls');
    ctr.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        ctr.querySelectorAll('[data-tool]').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        state.tool = b.dataset.tool;
        $('#orient-seg').classList.toggle('hidden', state.tool !== 'wall');
        renderBoard();
      });
    });
    ctr.querySelectorAll('[data-orient]').forEach((b) => {
      b.addEventListener('click', () => {
        ctr.querySelectorAll('[data-orient]').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        state.orient = b.dataset.orient;
        renderBoard();
      });
    });
  })();

  function renderBoard() {
    if (!state.boardState) return;
    const mod = TWO[state.game] && TWO[state.game]();
    if (!mod) return;
    $('#bar-controls').classList.toggle('hidden', state.game !== 'barricade');
    mod.render($('#board-wrap'), state.boardState, {
      seat: state.seat,
      tool: state.tool,
      orient: state.orient,
      onMove: (action) => socket.emit('move', action),
    });
    $('#status').textContent = mod.statusText(state.boardState, state.seat, state.mode);
    handleEnd();
  }

  function handleEnd() {
    const st = state.boardState;
    const ov = $('#overlay');
    if (!st || !st.winner) { ov.classList.add('hidden'); $('#rematch').classList.add('hidden'); return; }
    const mod = TWO[state.game] && TWO[state.game]();
    let info;
    if (mod && mod.endText) info = mod.endText(st, state.seat, state.mode);
    else if (st.winner === 'draw') info = { title: 'Draw', text: 'Neither side could break through.' };
    else {
      const won = st.winner === state.seat;
      info = {
        title: won ? 'You win' : 'Defeat',
        text: won ? 'The table is yours.'
          : (state.mode === 'pve' ? 'The computer got there first.' : 'Your opponent won this round.'),
      };
    }
    $('#overlay-title').textContent = info.title;
    $('#overlay-text').textContent = info.text;
    $('#overlay-points').textContent = state.awardText || '';
    ov.classList.remove('hidden');
    $('#rematch').classList.remove('hidden');
  }

  $('#overlay-rematch').addEventListener('click', () => { socket.emit('rematch'); $('#overlay').classList.add('hidden'); state.awardText = ''; });
  $('#rematch').addEventListener('click', () => { socket.emit('rematch'); state.awardText = ''; });
  $('#overlay-menu').addEventListener('click', () => { socket.emit('leaveRoom'); resetBoard(); show('menu'); });

  // ---------------- nav ----------------
  $$('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = b.dataset.nav;
      if (n === 'menu') { show('menu'); loadRanks(); }
      else if (n === 'ranks') { show('ranks-screen'); loadRanks(); }
      else if (n === 'derby') { if (window.DerbyClient) window.DerbyClient.open(); }
    });
  });
  $('#brand-home').addEventListener('click', () => { show('menu'); loadRanks(); });

  // ---------------- socket events ----------------
  socket.on('connect', () => { /* server emits `you` on connection */ });
  socket.on('you', ({ user }) => setUser(user));

  socket.on('joined', ({ code, seat, game, mode }) => {
    state.code = code;
    state.seat = seat;
    state.game = game;
    state.mode = mode;
    state.boardState = null;
    state.tool = 'move';
    state.orient = 'h';
    state.awardText = '';
    $$('#bar-controls [data-tool]').forEach((x) => x.classList.toggle('is-active', x.dataset.tool === 'move'));
    $$('#orient-seg [data-orient]').forEach((x) => x.classList.toggle('is-active', x.dataset.orient === 'h'));
    $('#orient-seg').classList.add('hidden');
    $('#bar-controls').classList.add('hidden');
    $('#board-wrap').innerHTML = '';
    $('#overlay').classList.add('hidden');
    $('#rematch').classList.add('hidden');
    $('#status').textContent = mode === 'pve' ? 'Starting the table…' : 'Waiting for an opponent…';
    const banner = $('#room-banner');
    if (mode === 'pvp' && seat === 1) {
      banner.innerHTML = `Room <b>${escapeHtml(code)}</b> — share this code with your opponent.`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
    show('game');
  });

  socket.on('waiting', () => { $('#status').textContent = 'Waiting for an opponent to join…'; });
  socket.on('opponentJoined', () => {
    toast('Opponent joined. The table is set.');
    $('#room-banner').classList.add('hidden');
  });
  socket.on('opponentLeft', () => { toast('Your opponent left the table.'); });

  socket.on('state', ({ code, state: st, mode }) => {
    state.code = code;
    state.boardState = st;
    state.mode = mode;
    show('game');
    renderBoard();
  });

  socket.on('mmSearching', ({ game, need, waiting }) => {
    $('#mm-title').textContent = `Finding players — ${TITLES[game] || 'match'}`;
    $('#mm-status').textContent = 'Looking for a room…';
    $('#mm-count').textContent = `${waiting} waiting · ${need} needed`;
    $('#mm-meter-fill').style.width = Math.min(100, (waiting / Math.max(1, need)) * 100) + '%';
  });
  socket.on('mmState', ({ waiting, need }) => {
    $('#mm-count').textContent = `${waiting} waiting · ${need} needed`;
    $('#mm-meter-fill').style.width = Math.min(100, (waiting / Math.max(1, need)) * 100) + '%';
  });
  socket.on('mmMatched', ({ game, bots }) => {
    if (bots) toast('No humans found — the house filled the room.');
    else toast(`Match found — ${TITLES[game] || 'game'} on.`);
    $('#room-banner').classList.add('hidden');
  });
  socket.on('mmFallback', () => { toast('Nobody arrived. You are playing the computer.'); });
  socket.on('mmIdle', () => { /* cancelled */ });

  socket.on('pointsAwarded', (d) => {
    if (typeof d.balance === 'number') updatePoints(d.balance);
    if (d.derby) {
      if (d.points < 0) toast(`Wager placed · ${-d.points} pts`);
      else if (d.points > 0) toast(`Derby payout · +${d.points} pts`);
      return;
    }
    if (d.points > 0) {
      const label = d.place === 1 ? 'Winner' : d.place === 2 ? 'Second' : d.place === 3 ? 'Third' : 'Points';
      state.awardText = `${label} · +${d.points} pts`;
      toast(`${label} · +${d.points} pts`);
    } else if (d.place) {
      state.awardText = 'No prize this time.';
    }
    if (TWO[d.game] && !$('#overlay').classList.contains('hidden')) {
      $('#overlay-points').textContent = state.awardText || '';
    }
  });

  socket.on('errorMsg', (m) => toast(m));
  socket.on('disconnect', () => {
    if (!$('#shell').classList.contains('hidden')) toast('Connection lost. Reconnecting…');
  });

  // ---------------- module bootstrapping ----------------
  const helpers = { show, toast };
  if (window.IslandClient) window.IslandClient.init(socket, helpers);
  if (window.TriviaClient) window.TriviaClient.init(socket, helpers);
  if (window.WordBombClient) window.WordBombClient.init(socket, helpers);
  if (window.InkRushClient) window.InkRushClient.init(socket, helpers);
  if (window.DerbyClient) window.DerbyClient.init(socket, helpers);
  const soloApi = { show, toast, submitScore, completeSolo, get user() { return state.user; } };
  if (window.G2048) window.G2048.init(soloApi);
  if (window.MemoryGame) window.MemoryGame.init(soloApi);

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  renderAccount();

  window.Arcade = {
    socket,
    show,
    toast,
    setUser,
    updatePoints,
    connectSocket,
    enterApp,
    enterAuth,
    completeSolo,
    submitScore,
    loadRanks,
    loadPrizes,
    get user() { return state.user; },
    state,
  };
})();
