// public/js/trivia.js — Trivia Royale client (setup, lobby, live quiz, podium).
(function () {
  const OPTCOLORS = ['opt-red', 'opt-blue', 'opt-gold', 'opt-green'];
  const OPTSHAPE = ['▲', '◆', '●', '■'];

  const T = {
    socket: null,
    helpers: null,
    code: null,
    youId: null,
    state: null,
    timerInt: null,
  };
  const $ = (s) => document.querySelector(s);

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function init(socket, helpers) {
    T.socket = socket; T.helpers = helpers;
    wireSetup();
    wireSocket();
  }

  function open() {
    $('#trivia-name').value = localStorage.getItem('arcadeName') || '';
    $('#trivia-join-code').value = '';
    showScreen('trivia-setup');
    $('#trivia-name').focus();
  }

  function reset() {
    if (T.timerInt) { clearInterval(T.timerInt); T.timerInt = null; }
    T.code = null; T.youId = null; T.state = null;
  }

  function leave() {
    T.socket.emit('leaveRoom');
    reset();
    showScreen('menu');
  }

  function wireSetup() {
    document.querySelectorAll('.trivia-tomenu').forEach((b) =>
      b.addEventListener('click', () => { reset(); showScreen('menu'); }));
    document.querySelectorAll('.trivia-leave').forEach((b) => b.addEventListener('click', leave));

    $('#trivia-create').addEventListener('click', () => {
      const name = $('#trivia-name').value.trim();
      if (!name) return T.helpers.toast('Enter a name first.');
      localStorage.setItem('arcadeName', name);
      T.socket.emit('createTrivia', { name, rounds: 7 });
    });
    $('#trivia-join').addEventListener('click', doJoin);
    $('#trivia-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    $('#trivia-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#trivia-create').click(); });
  }
  function doJoin() {
    const name = $('#trivia-name').value.trim();
    const code = $('#trivia-join-code').value.trim().toUpperCase();
    if (!name) return T.helpers.toast('Enter a name first.');
    if (!code) return T.helpers.toast('Enter a room code.');
    localStorage.setItem('arcadeName', name);
    T.socket.emit('joinTrivia', { code, name });
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
    if (to === 'question') T.helpers.toast('⚡ New question!');
    if (to === 'final') T.helpers.toast('🏁 Final results!');
  }

  function render() {
    if (!T.state) return;
    if (T.state.phase === 'lobby') { renderLobby(); showScreen('trivia-lobby'); }
    else { renderGame(); showScreen('trivia-game'); }
  }

  // ---------- lobby ----------
  function renderLobby() {
    const s = T.state;
    $('#trivia-lobby-banner').innerHTML =
      `Room code: <b>${T.code}</b> &nbsp;·&nbsp; ${s.players.length} player${s.players.length === 1 ? '' : 's'}`;

    // rounds control
    const rc = $('#trivia-rounds');
    rc.innerHTML = `<span class="rounds-label">Rounds: <b>${s.totalRounds}</b></span>`;
    if (s.isHost) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      [5, 7, 10, 15].forEach((n) => {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (n === s.totalRounds ? ' active' : '');
        b.textContent = n;
        b.addEventListener('click', () => T.socket.emit('triviaSetRounds', { rounds: n }));
        seg.appendChild(b);
      });
      rc.appendChild(seg);
    }

    const grid = $('#trivia-lobby-players');
    grid.innerHTML = '';
    s.players.forEach((p) => grid.appendChild(playerChip(p)));

    const ctr = $('#trivia-lobby-controls');
    ctr.innerHTML = '';
    if (s.isHost) {
      const addBot = mkBtn('🤖 Add Bot', 'ghost-btn', () => T.socket.emit('triviaAddBot'));
      addBot.disabled = s.players.length >= 12;
      const start = mkBtn('▶ Start Quiz', 'primary-btn', () => T.socket.emit('triviaStart'));
      start.disabled = s.players.length < 2;
      ctr.appendChild(addBot);
      ctr.appendChild(start);
    }
    $('#trivia-lobby-hint').textContent = s.isHost
      ? (s.players.length < 2 ? 'Add a bot or invite a friend to begin.' : 'Ready when you are!')
      : 'Waiting for the host to start…';
  }

  function playerChip(p) {
    const el = document.createElement('div');
    el.className = 'island-player' + (p.isMe ? ' me' : '');
    const initial = (p.name[0] || '?').toUpperCase();
    const tags = [];
    if (p.isHost) tags.push('<span class="tag host">HOST</span>');
    if (p.isMe) tags.push('<span class="tag you">YOU</span>');
    if (p.isBot) tags.push('<span class="tag bot">BOT</span>');
    el.innerHTML = `
      <div class="avatar" style="--c:${colorFor(p.id)}"><span>${esc(initial)}</span></div>
      <div class="pname">${esc(p.name)}</div>
      <div class="tags">${tags.join('')}</div>`;
    return el;
  }

  // ---------- game ----------
  function renderGame() {
    const s = T.state;
    $('#trivia-progress').textContent = s.phase === 'final' ? '🏁 Final Results' : `Round ${s.round} / ${s.totalRounds}`;
    $('#trivia-answered').textContent = s.phase === 'question' ? `${s.answeredCount}/${s.connectedCount} answered` : '';
    renderTimer();

    const stage = $('#trivia-stage');
    stage.innerHTML = '';
    if (s.phase === 'final') { stage.appendChild(finalCard()); return; }

    // question card
    const q = s.question;
    const card = document.createElement('div');
    card.className = 'trivia-q';
    card.innerHTML = `<div class="q-cat">${esc(q.category)}</div><div class="q-text">${esc(q.text)}</div>`;
    stage.appendChild(card);

    // options
    const opts = document.createElement('div');
    opts.className = 'trivia-options';
    const reveal = s.phase === 'reveal';
    q.options.forEach((text, i) => {
      const b = document.createElement('button');
      b.className = `trivia-opt ${OPTCOLORS[i]}`;
      b.type = 'button';
      b.innerHTML = `<span class="opt-shape">${OPTSHAPE[i]}</span><span class="opt-text">${esc(text)}</span>`;
      if (reveal) {
        if (i === q.answer) b.classList.add('correct');
        else if (i === s.yourChoice) b.classList.add('wrong');
        else b.classList.add('dim');
      } else {
        if (s.youAnswered) {
          b.classList.add('locked');
          if (i === s.yourChoice) b.classList.add('chosen');
        } else {
          b.addEventListener('click', () => {
            T.socket.emit('triviaAnswer', { choice: i });
          });
        }
      }
      opts.appendChild(b);
    });
    stage.appendChild(opts);

    // status line
    const note = document.createElement('p');
    note.className = 'sub trivia-note';
    if (reveal) {
      const me = s.players.find((p) => p.isMe);
      if (me && me.lastCorrect) note.textContent = `✅ Correct! +${me.lastGain} points`;
      else if (me && me.lastCorrect === false) note.textContent = '❌ Not this time.';
      else note.textContent = 'Round over.';
    } else {
      note.textContent = s.youAnswered ? 'Locked in! Waiting for others…' : 'Tap your answer — fast!';
    }
    stage.appendChild(note);

    // live scoreboard
    stage.appendChild(scoreboard(s, reveal));
  }

  function scoreboard(s, showDelta) {
    const box = document.createElement('div');
    box.className = 'trivia-scores';
    s.standings.forEach((row, i) => {
      const p = s.players.find((x) => x.id === row.id) || {};
      const r = document.createElement('div');
      r.className = 'ts-row' + (row.id === T.youId ? ' me' : '');
      const delta = showDelta && p.lastGain ? `<span class="ts-delta">+${p.lastGain}</span>` : '';
      const ans = (s.phase === 'question' && p.answered) ? '<span class="ts-lock">🔒</span>' : '';
      r.innerHTML = `<span class="ts-rank">${i + 1}</span>` +
        `<span class="ts-name">${esc(row.name)}${row.isBot ? ' <small>bot</small>' : ''}</span>` +
        `${ans}${delta}<span class="ts-score">${row.score}</span>`;
      box.appendChild(r);
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
    const order = [1, 0, 2]; // silver, gold, bronze visual order
    order.forEach((rank) => {
      const row = top3[rank];
      if (!row) return;
      const col = document.createElement('div');
      col.className = `podium-col p${rank + 1}`;
      col.innerHTML = `
        <div class="podium-medal">${['🥇','🥈','🥉'][rank]}</div>
        <div class="avatar" style="--c:${colorFor(row.id)}"><span>${esc((row.name[0]||'?').toUpperCase())}</span></div>
        <div class="podium-name">${esc(row.name)}</div>
        <div class="podium-score">${row.score}</div>
        <div class="podium-bar"></div>`;
      podium.appendChild(col);
    });
    wrap.appendChild(podium);

    const won = s.winner && s.winner.id === T.youId;
    const title = document.createElement('h2');
    title.textContent = won ? '🏆 You won!' : `🏆 ${s.winner ? s.winner.name : 'Nobody'} wins!`;
    wrap.appendChild(title);

    // full standings
    wrap.appendChild(scoreboard(s, false));

    // leaderboard (all-time)
    const lb = document.createElement('div');
    lb.className = 'leaderboard';
    wrap.appendChild(lb);
    window.LB.render(lb, 'trivia', { format: (r) => `${r.score}` });

    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    if (s.isHost) actions.appendChild(mkBtn('Play again', '', () => T.socket.emit('triviaPlayAgain')));
    actions.appendChild(mkBtn('Main menu', 'ghost', leave));
    wrap.appendChild(actions);
    return wrap;
  }

  function renderTimer() {
    const bar = $('#trivia-timerbar');
    const span = bar.firstElementChild;
    if (T.timerInt) { clearInterval(T.timerInt); T.timerInt = null; }
    const s = T.state;
    if (!s.phaseEndsAt || s.phase === 'final') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const dur = (s.durations && s.durations[s.phase]) || 1;
    const tick = () => {
      const remain = Math.max(0, s.phaseEndsAt - Date.now());
      const pct = Math.max(0, Math.min(100, (remain / (dur * 1000)) * 100));
      span.style.width = pct + '%';
      span.textContent = Math.ceil(remain / 1000) + 's';
      span.classList.toggle('urgent', remain < 6000);
      if (remain <= 0 && T.timerInt) { clearInterval(T.timerInt); T.timerInt = null; }
    };
    tick();
    T.timerInt = setInterval(tick, 250);
  }

  // ---------- helpers ----------
  const PALETTE = ['#ff5d73', '#34d1bf', '#6c8cff', '#f6c453', '#b06cff',
                   '#ff9f43', '#2ed573', '#ff6b9d', '#4bcffa', '#c0e218', '#e84393', '#00cec9'];
  function colorFor(id) {
    if (!T.state) return PALETTE[0];
    const idx = T.state.players.findIndex((p) => p.id === id);
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
  }
  function mkBtn(label, cls, onClick) {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls; b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.TriviaClient = { init, open };
})();
