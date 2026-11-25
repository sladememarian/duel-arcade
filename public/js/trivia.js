// public/js/trivia.js — Trivia Royale client (lobby, live quiz, podium).
(function () {
  const OPT_COLORS = ['opt-red', 'opt-blue', 'opt-gold', 'opt-green'];
  const OPT_LETTERS = ['A', 'B', 'C', 'D'];

  const T = {
    socket: null,
    helpers: null,
    code: null,
    youId: null,
    state: null,
    timerInt: null,
  };
  const $ = (s) => document.querySelector(s);
  const PALETTE = ['#b23a22', '#3f6b4a', '#2f4f6f', '#a9791f', '#6b4a7a',
    '#8a4b2f', '#2f6b63', '#7a3b55', '#4a5f7a', '#6f6a2f', '#8a3b3b', '#2f5f6f'];

  function init(socket, helpers) {
    T.socket = socket;
    T.helpers = helpers;
    document.querySelectorAll('.trivia-leave').forEach((b) => b.addEventListener('click', leave));
    wireSocket();
  }

  function reset() {
    stopTimer();
    T.code = null; T.youId = null; T.state = null;
  }

  function leave() {
    T.socket.emit('leaveRoom');
    reset();
    T.helpers.show('menu');
  }

  function wireSocket() {
    T.socket.on('triviaJoined', ({ code, youId }) => { T.code = code; T.youId = youId; });
    T.socket.on('triviaState', ({ code, state, phaseEndsAt, durations }) => {
      T.code = code;
      const prev = T.state && T.state.phase;
      T.state = state;
      T.state.phaseEndsAt = phaseEndsAt;
      T.state.durations = durations;
      if (prev && prev !== state.phase) onPhaseChange(prev, state.phase);
      render();
    });
  }

  function onPhaseChange(from, to) {
    if (to === 'question') T.helpers.toast('New question.');
    if (to === 'final') T.helpers.toast('Final results.');
  }

  function render() {
    if (!T.state) return;
    if (T.state.phase === 'lobby') { renderLobby(); T.helpers.show('trivia-lobby'); }
    else { renderGame(); T.helpers.show('trivia-game'); }
  }

  // ---------------- lobby ----------------
  function renderLobby() {
    const s = T.state;
    $('#trivia-lobby-banner').innerHTML =
      `Room <b>${esc(T.code)}</b> · ${s.players.length} of 12 seats`;

    const rc = $('#trivia-rounds');
    rc.innerHTML = `<span class="rounds-label">Rounds: <b>${s.totalRounds}</b></span>`;
    if (s.isHost) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      [5, 7, 10, 15].forEach((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-btn' + (n === s.totalRounds ? ' is-active' : '');
        b.textContent = n;
        b.addEventListener('click', () => T.socket.emit('triviaSetRounds', { rounds: n }));
        seg.appendChild(b);
      });
      rc.appendChild(seg);
    }

    const grid = $('#trivia-lobby-players');
    grid.innerHTML = '';
    s.players.forEach((p) => grid.appendChild(playerCard(p)));

    const ctr = $('#trivia-lobby-controls');
    ctr.innerHTML = '';
    if (s.isHost) {
      const add = mkBtn('Add a bot', 'btn btn-quiet', () => T.socket.emit('triviaAddBot'));
      add.disabled = s.players.length >= 12;
      const start = mkBtn('Start the quiz', 'btn btn-ink', () => T.socket.emit('triviaStart'));
      start.disabled = s.players.length < 2;
      ctr.appendChild(add);
      ctr.appendChild(start);
    }
    $('#trivia-lobby-hint').textContent = s.isHost
      ? (s.players.length < 2 ? 'Add a bot or invite a friend to begin.' : 'Ready when you are.')
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
    const s = T.state;
    $('#trivia-progress').textContent = s.phase === 'final' ? 'Final results' : `Round ${s.round} / ${s.totalRounds}`;
    $('#trivia-answered').textContent = s.phase === 'question' ? `${s.answeredCount}/${s.connectedCount} answered` : '';
    renderTimer();

    const stage = $('#trivia-stage');
    stage.innerHTML = '';
    if (s.phase === 'final') { stage.appendChild(finalCard()); return; }

    const q = s.question;
    if (!q) return;
    const reveal = s.phase === 'reveal';

    const card = document.createElement('div');
    card.className = 'trivia-q';
    card.innerHTML = `<div class="q-cat">${esc(q.category)}</div><div class="q-text">${esc(q.text)}</div>`;
    stage.appendChild(card);

    const opts = document.createElement('div');
    opts.className = 'trivia-options';
    q.options.forEach((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `trivia-opt ${OPT_COLORS[i] || ''}`;
      b.innerHTML = `<span class="opt-shape">${OPT_LETTERS[i] || i + 1}</span><span class="opt-text">${esc(text)}</span>`;
      if (reveal) {
        if (i === q.answer) b.classList.add('correct');
        else if (i === s.yourChoice) b.classList.add('wrong');
        else b.classList.add('dim');
        b.disabled = true;
      } else {
        if (s.youAnswered) {
          b.classList.add('locked');
          if (i === s.yourChoice) b.classList.add('chosen');
          b.disabled = true;
        } else {
          b.addEventListener('click', () => T.socket.emit('triviaAnswer', { choice: i }));
        }
      }
      opts.appendChild(b);
    });
    stage.appendChild(opts);

    const note = document.createElement('p');
    note.className = 'trivia-note';
    if (reveal) {
      const me = s.players.find((p) => p.isMe);
      if (me && me.lastCorrect) note.textContent = `Correct · +${me.lastGain} points.`;
      else if (me && me.lastCorrect === false) note.textContent = 'Not this time.';
      else note.textContent = 'Round over.';
    } else {
      note.textContent = s.youAnswered ? 'Locked in. Waiting for the rest of the table.' : 'Tap your answer — faster is worth more.';
    }
    stage.appendChild(note);

    stage.appendChild(scoreboard(s, reveal));
  }

  function scoreboard(s, showDelta) {
    const box = document.createElement('div');
    box.className = 'party-scores';
    s.standings.forEach((row, i) => {
      const p = s.players.find((x) => x.id === row.id) || {};
      const el = document.createElement('div');
      el.className = 'ps-row' + (row.id === T.youId ? ' me' : '');
      const delta = showDelta && p.lastGain ? `<span class="ps-delta">+${p.lastGain}</span>` : '';
      const lock = (s.phase === 'question' && p.answered) ? '<span class="ps-lock">in</span>' : '';
      el.innerHTML = `
        <span class="ps-rank">${i + 1}</span>
        <span class="ps-name">${esc(row.name)}${row.isBot ? ' <small>bot</small>' : ''}</span>
        ${lock}${delta}
        <span class="ps-score">${row.score}</span>`;
      box.appendChild(el);
    });
    return box;
  }

  function finalCard() {
    const s = T.state;
    const wrap = document.createElement('div');
    wrap.className = 'trivia-final';

    const top3 = s.standings.slice(0, 3);
    const podium = document.createElement('div');
    podium.className = 'podium';
    [1, 0, 2].forEach((rank) => {
      const row = top3[rank];
      if (!row) return;
      const col = document.createElement('div');
      col.className = `podium-col p${rank + 1}`;
      col.innerHTML = `
        <div class="podium-medal">#${rank + 1}</div>
        <div class="avatar" style="--c:${colorFor(row.id)}"><span>${esc((row.name[0] || '?').toUpperCase())}</span></div>
        <div class="podium-name">${esc(row.name)}</div>
        <div class="podium-score">${row.score}</div>
        <div class="podium-bar"></div>`;
      podium.appendChild(col);
    });
    wrap.appendChild(podium);

    const won = s.winner && s.winner.id === T.youId;
    const title = document.createElement('h2');
    title.textContent = won ? 'You won the room.' : `${s.winner ? s.winner.name : 'Nobody'} wins.`;
    wrap.appendChild(title);

    wrap.appendChild(scoreboard(s, false));

    const lb = document.createElement('div');
    lb.className = 'leaderboard';
    wrap.appendChild(lb);
    if (window.LB) window.LB.render(lb, 'trivia', { format: (r) => `${r.score}` });

    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    if (s.isHost) actions.appendChild(mkBtn('Play again', 'btn btn-ink', () => T.socket.emit('triviaPlayAgain')));
    actions.appendChild(mkBtn('Main menu', 'btn btn-quiet', leave));
    wrap.appendChild(actions);
    return wrap;
  }

  function renderTimer() {
    const bar = $('#trivia-timerbar');
    const span = bar.firstElementChild;
    stopTimer();
    const s = T.state;
    if (!s.phaseEndsAt || s.phase === 'final' || s.phase === 'lobby') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const dur = (s.durations && s.durations[s.phase]) || 1;
    const tick = () => {
      const remain = Math.max(0, s.phaseEndsAt - Date.now());
      const pct = Math.max(0, Math.min(100, (remain / (dur * 1000)) * 100));
      span.style.width = pct + '%';
      span.textContent = Math.ceil(remain / 1000) + 's';
      span.classList.toggle('urgent', remain < 6000);
    };
    tick();
    T.timerInt = setInterval(tick, 250);
  }
  function stopTimer() { if (T.timerInt) { clearInterval(T.timerInt); T.timerInt = null; } }

  // ---------------- helpers ----------------
  function colorFor(id) {
    if (!T.state) return PALETTE[0];
    const idx = T.state.players.findIndex((p) => p.id === id);
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
  }
  function mkBtn(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.TriviaClient = { init, leave };
})();
