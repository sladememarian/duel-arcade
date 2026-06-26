// public/js/island.js — Island game client (UI + socket wiring).
// Exposes window.IslandClient.init(socket, helpers) and .open().
(function () {
  const PALETTE = ['#ff5d73', '#34d1bf', '#6c8cff', '#f6c453', '#b06cff',
                   '#ff9f43', '#2ed573', '#ff6b9d', '#4bcffa', '#c0e218'];

  const I = {
    socket: null,
    helpers: null,
    code: null,
    youId: null,
    name: '',
    state: null,
    chats: {},        // peerId -> [{from, fromName, message, ts, mine}]
    ghostChat: [],    // [{from, fromName, message, ts, mine}]
    activeChat: null, // peerId or '__ghosts__'
    timerInt: null,
  };

  const $ = (s) => document.querySelector(s);

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function colorFor(id) {
    if (!I.state) return PALETTE[0];
    const idx = I.state.players.findIndex((p) => p.id === id);
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
  }
  function nameFor(id) {
    const p = I.state && I.state.players.find((x) => x.id === id);
    return p ? p.name : '???';
  }

  // ---------------- init / open ----------------
  function init(socket, helpers) {
    I.socket = socket;
    I.helpers = helpers;
    wireSetup();
    wireSocket();
  }

  function open() {
    I.name = localStorage.getItem('islandName') || '';
    $('#island-name').value = I.name;
    $('#island-join-code').value = '';
    showScreen('island-setup');
    $('#island-name').focus();
  }

  function leave() {
    I.socket.emit('leaveRoom');
    reset();
    showScreen('menu');
  }

  function reset() {
    if (I.timerInt) { clearInterval(I.timerInt); I.timerInt = null; }
    I.code = null; I.youId = null; I.state = null;
    I.chats = {}; I.ghostChat = []; I.activeChat = null;
  }

  // ---------------- setup screen ----------------
  function wireSetup() {
    document.querySelectorAll('.island-tomenu').forEach((b) =>
      b.addEventListener('click', () => { reset(); showScreen('menu'); }));
    document.querySelectorAll('.island-leave').forEach((b) =>
      b.addEventListener('click', leave));

    $('#island-create').addEventListener('click', () => {
      const name = $('#island-name').value.trim();
      if (!name) return I.helpers.toast('Enter a name first.');
      localStorage.setItem('islandName', name);
      I.socket.emit('createIsland', { name });
    });
    $('#island-join').addEventListener('click', doJoin);
    $('#island-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    $('#island-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#island-create').click(); });
  }
  function doJoin() {
    const name = $('#island-name').value.trim();
    const code = $('#island-join-code').value.trim().toUpperCase();
    if (!name) return I.helpers.toast('Enter a name first.');
    if (!code) return I.helpers.toast('Enter a room code.');
    localStorage.setItem('islandName', name);
    I.socket.emit('joinIsland', { code, name });
  }

  // ---------------- socket events ----------------
  function wireSocket() {
    I.socket.on('islandJoined', ({ code, youId }) => {
      I.code = code; I.youId = youId;
    });
    I.socket.on('islandState', ({ code, state, phaseEndsAt, durations }) => {
      I.code = code;
      const prevPhase = I.state && I.state.phase;
      I.state = state;
      I.state.phaseEndsAt = phaseEndsAt;
      I.state.durations = durations;
      if (prevPhase && prevPhase !== state.phase) onPhaseChange(prevPhase, state.phase);
      render();
    });
    I.socket.on('islandWhisper', (msg) => {
      const peer = msg.from === I.youId ? msg.to : msg.from;
      if (!I.chats[peer]) I.chats[peer] = [];
      I.chats[peer].push({ ...msg, mine: msg.from === I.youId });
      if (msg.from !== I.youId && I.activeChat !== peer) {
        I.helpers.toast(`💬 ${msg.fromName} whispered you`);
      }
      if (!I.activeChat && msg.from !== I.youId) I.activeChat = peer;
      if (I.state && I.state.phase === 'discussion') render();
    });
    I.socket.on('islandGhostChat', (msg) => {
      I.ghostChat.push({ ...msg, mine: msg.from === I.youId });
      if (I.state) render();
    });
  }

  function onPhaseChange(from, to) {
    if (to === 'voting') I.helpers.toast('🗳️ Voting has begun!');
    if (to === 'discussion' && from) I.helpers.toast('🌙 A new night falls. Whisper away.');
    if (to === 'ghostVote') I.helpers.toast('👻 Ghosts decide the final fate.');
    // close whisper windows when leaving discussion
    if (from === 'discussion' && to !== 'discussion') I.activeChat = null;
  }

  // ---------------- render ----------------
  function render() {
    if (!I.state) return;
    if (I.state.phase === 'lobby') { renderLobby(); showScreen('island-lobby'); }
    else { renderGame(); showScreen('island-game'); }
  }

  // ---- lobby ----
  function renderLobby() {
    const s = I.state;
    $('#island-lobby-banner').innerHTML =
      `Room code: <b>${I.code}</b> &nbsp;·&nbsp; ${s.players.length} player${s.players.length === 1 ? '' : 's'}`;

    const grid = $('#island-lobby-players');
    grid.innerHTML = '';
    s.players.forEach((p) => grid.appendChild(playerCard(p, { lobby: true })));

    const ctr = $('#island-lobby-controls');
    ctr.innerHTML = '';
    if (s.isHost) {
      const addBot = btn('🤖 Add Bot', 'ghost-btn', () => I.socket.emit('islandAddBot'));
      addBot.disabled = s.players.length >= 10;
      const start = btn('▶ Start Game', 'primary-btn', () => I.socket.emit('islandStart'));
      start.disabled = s.players.length < 3;
      ctr.appendChild(addBot);
      ctr.appendChild(start);
    }
    $('#island-lobby-hint').textContent = s.isHost
      ? (s.players.length < 3 ? 'Need at least 3 players. Add bots or invite friends.' : 'Everyone in? Hit start!')
      : 'Waiting for the host to start…';
  }

  // ---- game ----
  function renderGame() {
    const s = I.state;
    const titles = {
      discussion: '🌙 Whisper Phase',
      voting: '🗳️ Vote Someone Out',
      reveal: '💀 The Verdict',
      ghostVote: '👻 Ghosts Decide',
      ended: '🏆 Game Over',
    };
    $('#island-phase').textContent = titles[s.phase] || '';
    $('#island-night').textContent = s.phase === 'ended' ? '' : `Night ${s.night} · ${s.aliveCount} alive`;

    renderTimer();
    renderStage();
    renderAction();
    renderDock();
  }

  function renderTimer() {
    const bar = $('#island-timerbar');
    const span = bar.firstElementChild;
    if (I.timerInt) { clearInterval(I.timerInt); I.timerInt = null; }
    const s = I.state;
    if (!s.phaseEndsAt || s.phase === 'ended' || s.phase === 'reveal') {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    const dur = (s.durations && s.durations[s.phase]) || 1;
    const tick = () => {
      const remain = Math.max(0, s.phaseEndsAt - Date.now());
      const pct = Math.max(0, Math.min(100, (remain / (dur * 1000)) * 100));
      span.style.width = pct + '%';
      span.textContent = Math.ceil(remain / 1000) + 's';
      span.classList.toggle('urgent', remain < 10000);
      if (remain <= 0 && I.timerInt) { clearInterval(I.timerInt); I.timerInt = null; }
    };
    tick();
    I.timerInt = setInterval(tick, 250);
  }

  function renderStage() {
    const stage = $('#island-stage');
    stage.innerHTML = '';
    const s = I.state;

    if (s.phase === 'ended') {
      stage.appendChild(resultCard());
      return;
    }
    if (s.phase === 'reveal') {
      stage.appendChild(revealBanner());
    }

    const grid = document.createElement('div');
    grid.className = 'island-grid';
    s.players.forEach((p) => grid.appendChild(playerCard(p, {})));
    stage.appendChild(grid);
  }

  function revealBanner() {
    const r = I.state.lastResult || {};
    const div = document.createElement('div');
    div.className = 'island-reveal';
    if (r.tie || !r.eliminatedId) {
      div.innerHTML = `<span class="big">🤝 Tie!</span><span>No one was eliminated. The night is skipped.</span>`;
    } else {
      div.innerHTML = `<span class="big">💀 ${escapeHtml(r.eliminatedName)} was eliminated</span><span>The island grows quieter…</span>`;
    }
    return div;
  }

  function resultCard() {
    const s = I.state;
    const card = document.createElement('div');
    card.className = 'island-result';
    const won = s.winnerId === I.youId;
    card.innerHTML = `
      <div class="trophy">${won ? '🏆' : '🏝️'}</div>
      <h2>${won ? 'You Survived!' : `${escapeHtml(s.winnerName || 'No one')} wins`}</h2>
      <p class="sub">${won ? 'Last one standing on the island.' : 'Better luck next time.'}</p>
    `;
    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    if (s.isHost) actions.appendChild(btn('Play again', '', () => I.socket.emit('islandPlayAgain')));
    actions.appendChild(btn('Main menu', 'ghost', leave));
    card.appendChild(actions);
    return card;
  }

  // a single player avatar card; interaction depends on phase
  function playerCard(p, opts) {
    const s = I.state;
    const el = document.createElement('button');
    el.className = 'island-player';
    el.type = 'button';
    if (!p.alive && !opts.lobby) el.classList.add('dead');
    if (p.isMe) el.classList.add('me');
    if (!p.connected) el.classList.add('offline');

    const color = colorFor(p.id);
    const initial = (p.name[0] || '?').toUpperCase();
    const tags = [];
    if (p.isHost) tags.push('<span class="tag host">HOST</span>');
    if (p.isMe) tags.push('<span class="tag you">YOU</span>');
    if (p.isBot) tags.push('<span class="tag bot">BOT</span>');

    const showVoted = p.hasVoted && (s.phase === 'voting' || s.phase === 'ghostVote');
    const votedFor = (s.phase === 'voting' && s.youVotedFor === p.id);

    el.innerHTML = `
      <div class="avatar" style="--c:${color}">
        <span>${escapeHtml(initial)}</span>
        ${!p.alive && !opts.lobby ? '<div class="skull">💀</div>' : ''}
        ${showVoted ? '<div class="voted">✓</div>' : ''}
      </div>
      <div class="pname">${escapeHtml(p.name)}${!p.connected ? ' <small>(left)</small>' : ''}</div>
      <div class="tags">${tags.join('')}</div>
    `;
    if (votedFor) el.classList.add('selected');

    const action = cardAction(p);
    if (action) { el.classList.add('actionable'); el.addEventListener('click', action); }
    else el.disabled = true;
    return el;
  }

  // returns a click handler if this card is interactive in the current phase
  function cardAction(p) {
    const s = I.state;
    if (s.phase === 'lobby' || s.phase === 'reveal' || s.phase === 'ended') return null;
    if (p.isMe) return null;

    if (s.phase === 'discussion') {
      if (!s.youAlive || !p.alive) return null;
      return () => openChat(p.id);
    }
    if (s.phase === 'voting') {
      if (!s.youAlive || !p.alive || s.youVoted) return null;
      return () => I.socket.emit('islandVote', { target: p.id });
    }
    if (s.phase === 'ghostVote') {
      if (!s.youGhost || !p.alive || s.youVoted) return null;
      return () => I.socket.emit('islandGhostVote', { target: p.id });
    }
    return null;
  }

  function renderAction() {
    const a = $('#island-action');
    a.innerHTML = '';
    const s = I.state;
    let hint = '';
    if (s.phase === 'discussion') {
      hint = s.youAlive ? 'Tap a player to whisper privately. Plot who dies tonight.'
                        : 'You are a ghost. Watch the living squirm.';
      if (s.isHost) a.appendChild(btn('⏭ End whispers', 'ghost-btn small', () => I.socket.emit('islandSkip')));
    } else if (s.phase === 'voting') {
      hint = s.youAlive
        ? (s.youVoted ? `You voted. ${s.votesCast}/${s.votesNeeded} votes in…` : `Tap a player to vote them out. (${s.votesCast}/${s.votesNeeded})`)
        : `You're dead — watching the vote. (${s.votesCast}/${s.votesNeeded})`;
    } else if (s.phase === 'ghostVote') {
      hint = s.youGhost
        ? (s.youVoted ? `Vote cast. ${s.votesCast}/${s.votesNeeded} ghosts decided…` : `Pick who dies last. (${s.votesCast}/${s.votesNeeded})`)
        : 'Two remain. The ghosts decide your fate…';
    } else if (s.phase === 'reveal') {
      hint = 'Next night incoming…';
    }
    if (hint) { const p = document.createElement('p'); p.className = 'sub'; p.textContent = hint; a.appendChild(p); }
  }

  // ---- whisper / ghost dock ----
  function openChat(peerId) {
    I.activeChat = peerId;
    if (!I.chats[peerId]) I.chats[peerId] = [];
    renderDock();
    const input = $('#island-chat-input');
    if (input) input.focus();
  }

  function renderDock() {
    const dock = $('#island-dock');
    dock.innerHTML = '';
    const s = I.state;

    const canWhisper = s.phase === 'discussion' && s.youAlive;
    const isGhost = s.youGhost && (s.phase !== 'ended');
    if (!canWhisper && !isGhost) { dock.classList.add('hidden'); return; }
    dock.classList.remove('hidden');

    // tabs
    const tabs = document.createElement('div');
    tabs.className = 'chat-tabs';
    if (canWhisper) {
      Object.keys(I.chats).forEach((pid) => {
        const t = btn(nameFor(pid), 'chat-tab' + (I.activeChat === pid ? ' active' : ''), () => { I.activeChat = pid; renderDock(); });
        tabs.appendChild(t);
      });
    }
    if (isGhost) {
      const t = btn('👻 Ghosts', 'chat-tab' + (I.activeChat === '__ghosts__' ? ' active' : ''), () => { I.activeChat = '__ghosts__'; renderDock(); });
      tabs.appendChild(t);
    }
    dock.appendChild(tabs);

    // default active
    if (!I.activeChat) {
      if (canWhisper && Object.keys(I.chats).length) I.activeChat = Object.keys(I.chats)[0];
      else if (isGhost) I.activeChat = '__ghosts__';
    }
    if (!I.activeChat) {
      const hint = document.createElement('p');
      hint.className = 'sub chat-empty';
      hint.textContent = 'Tap a player above to start a private whisper.';
      dock.appendChild(hint);
      return;
    }

    const isGhostChat = I.activeChat === '__ghosts__';
    const msgs = isGhostChat ? I.ghostChat : (I.chats[I.activeChat] || []);

    const win = document.createElement('div');
    win.className = 'chat-window';
    const head = document.createElement('div');
    head.className = 'chat-head';
    head.textContent = isGhostChat ? '👻 Ghost lounge' : `💬 with ${nameFor(I.activeChat)}`;
    win.appendChild(head);

    const body = document.createElement('div');
    body.className = 'chat-body';
    msgs.forEach((m) => {
      const b = document.createElement('div');
      b.className = 'bubble ' + (m.mine ? 'mine' : 'theirs');
      b.innerHTML = `${isGhostChat && !m.mine ? `<span class="who">${escapeHtml(m.fromName)}</span>` : ''}${escapeHtml(m.message)}`;
      body.appendChild(b);
    });
    win.appendChild(body);

    const form = document.createElement('div');
    form.className = 'chat-input';
    const input = document.createElement('input');
    input.id = 'island-chat-input';
    input.maxLength = 500;
    input.placeholder = isGhostChat ? 'Message the dead…' : 'Whisper…';
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      if (isGhostChat) I.socket.emit('islandGhostChat', { message: text });
      else I.socket.emit('islandWhisper', { to: I.activeChat, message: text });
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    form.appendChild(input);
    form.appendChild(btn('Send', 'send-btn', send));
    win.appendChild(form);

    dock.appendChild(win);
    body.scrollTop = body.scrollHeight;
  }

  // ---------------- helpers ----------------
  function btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.IslandClient = { init, open };
})();
