// public/js/memory.js — Memory Match (solo). Flip cards, find every pair.
// Faces are inline line-drawings, not emoji.
(function () {
  const SYMBOLS = [
    '<circle cx="12" cy="12" r="7"/>',
    '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    '<path d="M12 4l8 15H4z"/>',
    '<path d="M12 3l9 9-9 9-9-9z"/>',
    '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    '<path d="M12 4v16M4 12h16"/>',
    '<path d="M5 5l14 14M19 5L5 19"/>',
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    '<path d="M5 7h14M5 12h14M5 17h14"/>',
    '<path d="M15 4a8 8 0 1 0 0 16 7 7 0 0 1 0-16z"/>',
    '<path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z"/>',
    '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
    '<path d="M3 19l6-10 4 6 2-3 6 7z"/>',
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
    '<path d="M5 19C5 10 12 5 20 4c0 8-5 15-15 15z"/><path d="M5 19c3-4 6-7 10-9"/>',
    '<circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M15 15l2-2M17 17l2-2"/>',
    '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 14a7 7 0 0 0 14 0M8 10h8"/>',
    '<path d="M12 3l7 4v10l-7 4-7-4V7z"/>',
    '<path d="M5 12h14M13 6l6 6-6 6"/>',
  ];

  const M = {
    api: null,
    size: 4,
    cards: [],
    first: null,
    lock: false,
    moves: 0,
    matched: 0,
    pairs: 0,
    started: false,
    startTime: 0,
    timerInt: null,
    submitted: false,
    claimed: false,
  };
  const $ = (s) => document.querySelector(s);

  function init(api) {
    M.api = api;
    wire();
  }

  function open() {
    M.api.show('memory-screen');
    newGame();
    refreshLeaderboard();
  }

  function wire() {
    $('#memory-new').addEventListener('click', newGame);
    $('#memory-again').addEventListener('click', () => { $('#memory-overlay').classList.add('hidden'); newGame(); });
    document.querySelector('.memory-back').addEventListener('click', leave);
    $('#memory-menu').addEventListener('click', leave);
    $('#memory-diff').querySelectorAll('.seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        $('#memory-diff').querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        M.size = parseInt(b.dataset.size, 10);
        newGame();
      });
    });
  }

  function leave() {
    stopTimer();
    $('#memory-overlay').classList.add('hidden');
    M.api.show('menu');
  }

  function newGame() {
    stopTimer();
    const total = M.size * M.size;
    M.pairs = total / 2;
    const ids = shuffle(SYMBOLS.map((_, i) => i)).slice(0, M.pairs);
    const deck = shuffle(ids.concat(ids));
    M.cards = deck.map((id) => ({ id, flipped: false, matched: false }));
    M.first = null; M.lock = false; M.moves = 0; M.matched = 0;
    M.started = false; M.startTime = 0; M.submitted = false; M.claimed = false;
    $('#memory-overlay').classList.add('hidden');
    $('#memory-time').textContent = '0:00';
    updateStats();
    render();
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function flip(i) {
    if (M.lock) return;
    const card = M.cards[i];
    if (card.flipped || card.matched) return;
    if (!M.started) { M.started = true; M.startTime = Date.now(); startTimer(); }

    card.flipped = true;
    render();

    if (M.first === null) { M.first = i; return; }

    M.moves += 1;
    updateStats();
    const a = M.cards[M.first], b = card;
    if (a.id === b.id) {
      a.matched = b.matched = true;
      M.matched += 1;
      M.first = null;
      updateStats();
      render();
      if (M.matched === M.pairs) win();
    } else {
      M.lock = true;
      setTimeout(() => {
        a.flipped = false; b.flipped = false;
        M.first = null; M.lock = false;
        render();
      }, 750);
    }
  }

  function render() {
    const board = $('#memory-board');
    board.style.setProperty('--n', M.size);
    board.innerHTML = '';
    M.cards.forEach((card, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'mem-card' + ((card.flipped || card.matched) ? ' open' : '') + (card.matched ? ' matched' : '');
      el.innerHTML = `<span class="mem-face mem-back">?</span>` +
        `<span class="mem-face mem-front"><svg viewBox="0 0 24 24" aria-hidden="true">${SYMBOLS[card.id]}</svg></span>`;
      if (!card.flipped && !card.matched) el.addEventListener('click', () => flip(i));
      board.appendChild(el);
    });
  }

  function updateStats() {
    $('#memory-moves').textContent = M.moves;
    $('#memory-pairs').textContent = `${M.matched}/${M.pairs}`;
  }

  function startTimer() {
    stopTimer();
    M.timerInt = setInterval(() => { $('#memory-time').textContent = fmtTime(elapsed()); }, 500);
  }
  function stopTimer() { if (M.timerInt) { clearInterval(M.timerInt); M.timerInt = null; } }
  function elapsed() { return M.started ? Math.floor((Date.now() - M.startTime) / 1000) : 0; }
  function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

  function win() {
    stopTimer();
    const secs = elapsed();
    const sizeMult = M.size === 6 ? 2.5 : 1;
    const score = Math.max(50, Math.round((10000 * sizeMult) - M.moves * 60 - secs * 12));
    $('#memory-time').textContent = fmtTime(secs);
    $('#memory-result-text').textContent =
      `Solved the ${M.size}×${M.size} board in ${M.moves} moves and ${fmtTime(secs)}. Score ${score}.`;
    $('#memory-save').textContent = 'Saving the run…';
    $('#memory-overlay').classList.remove('hidden');
    settle(score, secs);
  }

  async function settle(score, secs) {
    if (!M.submitted) {
      M.submitted = true;
      M.api.submitScore('memory', score, { moves: M.moves, seconds: secs, size: M.size })
        .then(() => refreshLeaderboard());
    }
    if (M.claimed) return;
    M.claimed = true;
    const res = await M.api.completeSolo('memory', score, { moves: M.moves, seconds: secs, size: M.size });
    if (res && res.ok) $('#memory-save').textContent = `Prize credited · +${res.points} points.`;
    else if (res && res.error) $('#memory-save').textContent = res.error;
    else $('#memory-save').textContent = '';
  }

  function refreshLeaderboard() {
    if (!window.LB) return;
    window.LB.render($('#memory-lb'), 'memory', {
      format: (r) => {
        const m = r.meta || {};
        if (m.moves != null) return `${m.size || '?'}×${m.size || '?'} · ${m.moves}mv · ${fmtTime(m.seconds || 0)}`;
        return String(r.score);
      },
    });
  }

  window.MemoryGame = { init, open };
})();
