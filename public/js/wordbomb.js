// public/js/wordbomb.js — Word Bomb client (lobby, rounds, reveal, final).
(function () {
  const W = {
    socket: null,
    helpers: null,
    code: null,
    youId: null,
    state: null,
    timerInt: null,
    roundKey: null,
  };
  const $ = (s) => document.querySelector(s);
  const PALETTE = ['#b23a22', '#3f6b4a', '#2f4f6f', '#a9791f', '#6b4a7a', '#8a4b2f', '#2f6b63', '#7a3b55'];

  function init(socket, helpers) {
    W.socket = socket;
    W.helpers = helpers;
    document.querySelectorAll('.wordbomb-leave').forEach((b) => b.addEventListener('click', leave));
    wireSocket();
  }

  function leave() {
    W.socket.emit('leaveRoom');
    reset();
    W.helpers.show('menu');
  }

  function reset() {
    stopTimer();
    W.code = null; W.youId = null; W.state = null; W.roundKey = null;
  }

  function wireSocket() {
    W.socket.on('wordbombJoined', ({ code, youId }) => { W.code = code; W.youId = youId; });
    W.socket.on('wordbombState', ({ code, state, phaseEndsAt, durations }) => {
      W.code = code;
      W.state = state;
      W.state.phaseEndsAt = phaseEndsAt;
      W.state.durations = durations;
      render();
    });
  }

  function render() {
    if (!W.state) return;
    if (W.state.phase === 'lobby') { renderLobby(); W.helpers.show('wordbomb-lobby'); }
    else { renderGame(); W.helpers.show('wordbomb-game'); }
  }

  // ---------------- lobby ----------------
  function renderLobby() {
    const s = W.state;
    $('#wordbomb-lobby-banner').innerHTML =
      `Room <b>${esc(W.code)}</b> · ${s.players.length} of 8 seats`;

    const rounds = $('#wordbomb-rounds');
    rounds.innerHTML = `<span class="rounds-label">Rounds: <b>${s.totalRounds}</b></span>`;
    if (s.isHost) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      [3, 5, 7, 10].forEach((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-btn' + (n === s.totalRounds ? ' is-active' : '');
        b.textContent = n;
        b.addEventListener('click', () => W.socket.emit('wordbombSetRounds', { rounds: n }));
        seg.appendChild(b);
      });
      rounds.appendChild(seg);
    }

    const grid = $('#wordbomb-lobby-players');
    grid.innerHTML = '';
    s.players.forEach((p) => grid.appendChild(playerCard(p)));

    const ctr = $('#wordbomb-lobby-controls');
    ctr.innerHTML = '';
    if (s.isHost) {
      const add = mkBtn('Add a bot', 'btn btn-quiet', () => W.socket.emit('wordbombAddBot'));
      add.disabled = s.players.length >= 8;
      const start = mkBtn('Start the round', 'btn btn-ink', () => W.socket.emit('wordbombStart'));
      start.disabled = s.players.length < 3;
      ctr.appendChild(add);
      ctr.appendChild(start);
    }
    $('#wordbomb-lobby-hint').textContent = s.isHost
      ? (s.players.length < 3 ? 'At least three players. Add a bot or invite a friend.' : 'Three or more seated. Start when ready.')
      : 'Waiting for the host to start…';
  }

  function playerCard(p) {
    const el = document.createElement('div');
    el.className = 'island-player' + (p.isMe ? ' me' : '');
    const initial = (p.name[0] || '?').toUpperCase();
    const tags = [];
    if (p.isHost) tags.push('<span class="tag host">host</span>');
    if (p.isMe) tags.push('<span class="tag you">you</span>');
    if (p.isBot) tags.push('<span class="tag bot">bot</span>');
    el.innerHTML = `
      <div class="avatar" style="--c:${colorFor(p.id)}"><span>${esc(initial)}</span></div>
      <div class="pname">${esc(p.name)}</div>
      <div class="tags">${tags.join('')}</div>`;
    return el;
  }

  // ---------------- game ----------------
  function renderGame() {
    const s = W.state;
    $('#wordbomb-progress').textContent = s.phase === 'final'
      ? 'Final results'
      : `Round ${s.round} / ${s.totalRounds}`;
    $('#wordbomb-answered').textContent = s.phase === 'round'
      ? `${s.answeredCount}/${s.connectedCount} answered`
      : '';

    renderTimer();

    const stage = $('#wordbomb-stage');
    if (s.phase === 'round') {
      const key = 'round' + s.round;
      if (W.roundKey !== key) {
        stage.innerHTML = '';
        buildRound(stage, s);
        W.roundKey = key;
      }
      updateRound(s);
    } else {
      W.roundKey = s.phase + s.round;
      stage.innerHTML = '';
      if (s.phase === 'reveal') buildReveal(stage, s);
      else buildFinal(stage, s);
    }
  }

  function buildRound(stage, s) {
    const prompt = document.createElement('div');
    prompt.className = 'wb-prompt';
    prompt.innerHTML = `<p class="kicker">Contains</p><div class="wb-bigram">${esc(s.bigram || '')}</div>`;
    stage.appendChild(prompt);

    const form = document.createElement('form');
    form.className = 'wb-form';
    form.id = 'wb-form';
    form.innerHTML = `
      <input id="wb-input" class="wb-input" maxlength="12" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="one word" />
      <button class="btn btn-ink" type="submit">Submit</button>`;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#wb-input');
      const word = input.value.trim();
      if (!word) return;
      W.socket.emit('wordbombSubmit', { word });
      input.value = '';
    });
    stage.appendChild(form);

    const status = document.createElement('p');
    status.className = 'wb-status';
    status.id = 'wb-status';
    stage.appendChild(status);
  }

  function updateRound(s) {
    const form = $('#wb-form');
    const input = $('#wb-input');
    const status = $('#wb-status');
    if (!form || !input || !status) return;
    if (s.youSubmitted) {
      input.disabled = true;
      form.querySelector('button').disabled = true;
      status.textContent = 'Word locked in. Waiting for the rest of the table.';
    } else {
      if (document.activeElement === document.body) input.focus();
      status.textContent = `Type a word containing “${(s.bigram || '').toUpperCase()}”. ${s.answeredCount}/${s.connectedCount} in.`;
    }
  }

  function buildReveal(stage, s) {
    const prompt = document.createElement('div');
    prompt.className = 'wb-prompt';
    prompt.innerHTML = `<p class="kicker">The bigram was</p><div class="wb-bigram">${esc(s.bigram || '')}</div>`;
    stage.appendChild(prompt);

    const list = document.createElement('div');
    list.className = 'wb-results';
    (s.reveal && s.reveal.results ? s.reveal.results : []).forEach((r) => {
      const row = document.createElement('div');
      row.className = 'wb-row' + (r.id === W.youId ? ' me' : '');
      const word = r.valid ? esc(r.word) : 'no word accepted';
      row.innerHTML = `
        <span>${esc(r.name)}${r.id === W.youId ? ' <span class="meta">(you)</span>' : ''}</span>
        <span class="wb-word ${r.valid ? 'valid' : 'invalid'}">${word}</span>
        <span class="wb-gain">${r.gain ? '+' + r.gain : '—'}</span>`;
      list.appendChild(row);
    });
    stage.appendChild(list);

    stage.appendChild(scoreboard(s));
  }

  function buildFinal(stage, s) {
    const winner = s.winner;
    const card = document.createElement('div');
    card.className = 'island-result';
    const won = winner && winner.id === W.youId;
    card.innerHTML = `
      <p class="kicker">Final</p>
      <h2>${won ? 'You took the table.' : winner ? esc(winner.name) + ' wins.' : 'No winner.'}</h2>
      <p class="sub">${winner ? esc(winner.score) + ' points after ' + s.totalRounds + ' rounds.' : ''}</p>`;
    stage.appendChild(card);
    stage.appendChild(scoreboard(s, true));

    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    if (s.isHost) actions.appendChild(mkBtn('Play again', 'btn btn-ink', () => W.socket.emit('wordbombPlayAgain')));
    actions.appendChild(mkBtn('Main menu', 'btn btn-quiet', leave));
    stage.appendChild(actions);
  }

  function scoreboard(s, withDelta) {
    const box = document.createElement('div');
    box.className = 'party-scores';
    s.standings.forEach((row, i) => {
      const p = s.players.find((x) => x.id === row.id) || {};
      const el = document.createElement('div');
      el.className = 'ps-row' + (row.id === W.youId ? ' me' : '');
      const delta = withDelta && p.gain ? `<span class="ps-delta">+${p.gain}</span>` : '';
      const lock = (s.phase === 'round' && p.answered) ? '<span class="ps-lock">in</span>' : '';
      el.innerHTML = `
        <span class="ps-rank">${i + 1}</span>
        <span class="ps-name">${esc(row.name)}${row.isBot ? ' <small>bot</small>' : ''}</span>
        ${lock}${delta}
        <span class="ps-score">${row.score}</span>`;
      box.appendChild(el);
    });
    return box;
  }

  function renderTimer() {
    const bar = $('#wordbomb-timerbar');
    const span = bar.firstElementChild;
    stopTimer();
    const s = W.state;
    if (!s.phaseEndsAt || s.phase === 'final' || s.phase === 'lobby') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const dur = (s.durations && s.durations[s.phase]) || 1;
    const tick = () => {
      const remain = Math.max(0, s.phaseEndsAt - Date.now());
      const pct = Math.max(0, Math.min(100, (remain / (dur * 1000)) * 100));
      span.style.width = pct + '%';
      span.textContent = Math.ceil(remain / 1000) + 's';
      span.classList.toggle('urgent', remain < 5000);
    };
    tick();
    W.timerInt = setInterval(tick, 250);
  }
  function stopTimer() { if (W.timerInt) { clearInterval(W.timerInt); W.timerInt = null; } }

  // ---------------- helpers ----------------
  function colorFor(id) {
    if (!W.state) return PALETTE[0];
    const idx = W.state.players.findIndex((p) => p.id === id);
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
  }
  function mkBtn(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.WordBombClient = { init, leave };
})();
