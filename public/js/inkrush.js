// public/js/inkrush.js — Ink Rush client (a Stroop-style reaction race).
(function () {
  const I = {
    socket: null,
    helpers: null,
    code: null,
    youId: null,
    state: null,
    timerInt: null,
  };
  const $ = (s) => document.querySelector(s);
  const PALETTE = ['#b23a22', '#3f6b4a', '#2f4f6f', '#a9791f', '#6b4a7a', '#8a4b2f', '#2f6b63', '#7a3b55'];
  const TONE = { 0: 'ink-red', 1: 'ink-blue', 2: 'ink-green', 3: 'ink-gold' };

  function init(socket, helpers) {
    I.socket = socket;
    I.helpers = helpers;
    document.querySelectorAll('.inkrush-leave').forEach((b) => b.addEventListener('click', leave));
    wireSocket();
  }

  function leave() {
    I.socket.emit('leaveRoom');
    reset();
    I.helpers.show('menu');
  }

  function reset() {
    stopTimer();
    I.code = null; I.youId = null; I.state = null;
  }

  function wireSocket() {
    I.socket.on('inkrushJoined', ({ code, youId }) => { I.code = code; I.youId = youId; });
    I.socket.on('inkrushState', ({ code, state, phaseEndsAt, durations }) => {
      I.code = code;
      I.state = state;
      I.state.phaseEndsAt = phaseEndsAt;
      I.state.durations = durations;
      render();
    });
  }

  function render() {
    if (!I.state) return;
    if (I.state.phase === 'lobby') { renderLobby(); I.helpers.show('inkrush-lobby'); }
    else { renderGame(); I.helpers.show('inkrush-game'); }
  }

  // ---------------- lobby ----------------
  function renderLobby() {
    const s = I.state;
    $('#inkrush-lobby-banner').innerHTML =
      `Room <b>${esc(I.code)}</b> · ${s.players.length} of 8 seats`;

    const rounds = $('#inkrush-rounds');
    rounds.innerHTML = `<span class="rounds-label">Rounds: <b>${s.totalRounds}</b></span>`;
    if (s.isHost) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      [3, 5, 7, 10].forEach((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-btn' + (n === s.totalRounds ? ' is-active' : '');
        b.textContent = n;
        b.addEventListener('click', () => I.socket.emit('inkrushSetRounds', { rounds: n }));
        seg.appendChild(b);
      });
      rounds.appendChild(seg);
    }

    const grid = $('#inkrush-lobby-players');
    grid.innerHTML = '';
    s.players.forEach((p) => grid.appendChild(playerCard(p)));

    const ctr = $('#inkrush-lobby-controls');
    ctr.innerHTML = '';
    if (s.isHost) {
      const add = mkBtn('Add a bot', 'btn btn-quiet', () => I.socket.emit('inkrushAddBot'));
      add.disabled = s.players.length >= 8;
      const start = mkBtn('Start the round', 'btn btn-ink', () => I.socket.emit('inkrushStart'));
      start.disabled = s.players.length < 3;
      ctr.appendChild(add);
      ctr.appendChild(start);
    }
    $('#inkrush-lobby-hint').textContent = s.isHost
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
    const s = I.state;
    $('#inkrush-progress').textContent = s.phase === 'final'
      ? 'Final results'
      : `Round ${s.round} / ${s.totalRounds}`;
    $('#inkrush-answered').textContent = s.phase === 'prompt'
      ? `${s.answeredCount}/${s.connectedCount} answered`
      : '';
    renderTimer();

    const stage = $('#inkrush-stage');
    stage.innerHTML = '';
    if (s.phase === 'final') { buildFinal(stage, s); return; }

    const reveal = s.phase === 'reveal';
    if (s.prompt) {
      const prompt = document.createElement('div');
      prompt.className = 'ink-prompt';
      prompt.innerHTML = `
        <p class="kicker">Tap the ink</p>
        <div class="ink-word ${TONE[s.prompt.ink] || ''}">${esc(s.prompt.word)}</div>`;
      stage.appendChild(prompt);
    }

    const grid = document.createElement('div');
    grid.className = 'ink-grid';
    (s.colors || []).forEach((c, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ink-choice';
      b.innerHTML = `<span class="ink-swatch ${TONE[idx] || ''}"></span><span>${esc(c.name)}</span>`;
      if (reveal) {
        const correctIdx = s.reveal ? s.reveal.ink : (s.prompt ? s.prompt.ink : -1);
        if (idx === correctIdx) b.classList.add('correct');
        else if (idx === s.yourChoice) b.classList.add('wrong');
        b.disabled = true;
      } else {
        if (s.youAnswered) {
          b.disabled = true;
          if (idx === s.yourChoice) b.classList.add('chosen');
        } else {
          b.addEventListener('click', () => I.socket.emit('inkrushAnswer', { choice: idx }));
        }
      }
      grid.appendChild(b);
    });
    stage.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'ink-note';
    if (reveal) {
      const me = s.players.find((p) => p.isMe);
      if (me && me.correct) note.textContent = `Correct · +${me.gain} points.`;
      else if (me && me.correct === false) note.textContent = 'Wrong ink. No points this round.';
      else note.textContent = 'Round over.';
    } else {
      note.textContent = s.youAnswered ? 'Locked in. Waiting for the rest of the table.' : 'Read the ink, not the word.';
    }
    stage.appendChild(note);
    stage.appendChild(scoreboard(s, reveal));
  }

  function scoreboard(s, withDelta) {
    const box = document.createElement('div');
    box.className = 'party-scores';
    s.standings.forEach((row, i) => {
      const p = s.players.find((x) => x.id === row.id) || {};
      const el = document.createElement('div');
      el.className = 'ps-row' + (row.id === I.youId ? ' me' : '');
      const delta = withDelta && p.gain ? `<span class="ps-delta">+${p.gain}</span>` : '';
      const lock = (s.phase === 'prompt' && p.answered) ? '<span class="ps-lock">in</span>' : '';
      el.innerHTML = `
        <span class="ps-rank">${i + 1}</span>
        <span class="ps-name">${esc(row.name)}${row.isBot ? ' <small>bot</small>' : ''}</span>
        ${lock}${delta}
        <span class="ps-score">${row.score}</span>`;
      box.appendChild(el);
    });
    return box;
  }

  function buildFinal(stage, s) {
    const winner = s.winner;
    const card = document.createElement('div');
    card.className = 'island-result';
    const won = winner && winner.id === I.youId;
    card.innerHTML = `
      <p class="kicker">Final</p>
      <h2>${won ? 'Your eyes were fastest.' : winner ? esc(winner.name) + ' wins.' : 'No winner.'}</h2>
      <p class="sub">${winner ? esc(winner.score) + ' points after ' + s.totalRounds + ' rounds.' : ''}</p>`;
    stage.appendChild(card);
    stage.appendChild(scoreboard(s, true));

    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    if (s.isHost) actions.appendChild(mkBtn('Play again', 'btn btn-ink', () => I.socket.emit('inkrushPlayAgain')));
    actions.appendChild(mkBtn('Main menu', 'btn btn-quiet', leave));
    stage.appendChild(actions);
  }

  function renderTimer() {
    const bar = $('#inkrush-timerbar');
    const span = bar.firstElementChild;
    stopTimer();
    const s = I.state;
    if (!s.phaseEndsAt || s.phase === 'final' || s.phase === 'lobby') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const dur = (s.durations && s.durations[s.phase]) || 1;
    const tick = () => {
      const remain = Math.max(0, s.phaseEndsAt - Date.now());
      const pct = Math.max(0, Math.min(100, (remain / (dur * 1000)) * 100));
      span.style.width = pct + '%';
      span.textContent = Math.ceil(remain / 1000) + 's';
      span.classList.toggle('urgent', remain < 3000);
    };
    tick();
    I.timerInt = setInterval(tick, 250);
  }
  function stopTimer() { if (I.timerInt) { clearInterval(I.timerInt); I.timerInt = null; } }

  function colorFor(id) {
    if (!I.state) return PALETTE[0];
    const idx = I.state.players.findIndex((p) => p.id === id);
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

  window.InkRushClient = { init, leave };
})();
