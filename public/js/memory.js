// public/js/memory.js — Memory Match (solo). Flip cards, find all pairs.
// Score rewards fewer moves and faster time; submitted to the leaderboard.
(function () {
  const EMOJIS = ['🍎','🚀','🌟','🐬','🎸','🍩','⚽','🦊','🌈','🍕','🎈','🐢',
                  '🔥','🍔','🎲','🦄','🌵','🍓','🛸','🐙','🎁','🍀','🐝','🍉'];
  const M = {
    helpers: null,
    size: 4,
    cards: [],         // { emoji, flipped, matched }
    first: null,       // index of first flipped card
    lock: false,
    moves: 0,
    matched: 0,
    pairs: 0,
    started: false,
    startTime: 0,
    timerInt: null,
  };
  const $ = (s) => document.querySelector(s);

  function init(helpers) { M.helpers = helpers; wire(); }

  function open() {
    showScreen('memory-screen');
    newGame();
    refreshLeaderboard();
  }
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function wire() {
    $('#memory-new').addEventListener('click', newGame);
    $('#memory-again').addEventListener('click', () => { $('#memory-overlay').classList.add('hidden'); newGame(); });
    $('.memory-back').addEventListener('click', leave);
    $('#memory-menu').addEventListener('click', leave);
    $('#memory-diff').querySelectorAll('.seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        $('#memory-diff').querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        M.size = parseInt(b.dataset.size, 10);
        newGame();
      });
    });
  }

  function leave() {
    stopTimer();
    $('#memory-overlay').classList.add('hidden');
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById('menu').classList.add('active');
  }

  function newGame() {
    stopTimer();
    const total = M.size * M.size;
    M.pairs = total / 2;
    const pool = shuffle(EMOJIS.slice()).slice(0, M.pairs);
    const deck = shuffle(pool.concat(pool));
    M.cards = deck.map((emoji) => ({ emoji, flipped: false, matched: false }));
    M.first = null; M.lock = false; M.moves = 0; M.matched = 0;
    M.started = false; M.startTime = 0;
    $('#memory-overlay').classList.add('hidden');
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

    if (M.first === null) {
      M.first = i;
      return;
    }
    // second card
    M.moves += 1; updateStats();
    const a = M.cards[M.first], b = card;
    if (a.emoji === b.emoji) {
      a.matched = b.matched = true;
      M.matched += 1; M.first = null;
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
      el.className = 'mem-card' + ((card.flipped || card.matched) ? ' open' : '') + (card.matched ? ' matched' : '');
      el.type = 'button';
      el.innerHTML = `<span class="mem-face mem-back">?</span><span class="mem-face mem-front">${card.emoji}</span>`;
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
    // higher is better; bigger boards are worth more, fewer moves & faster = more
    const sizeMult = M.size === 6 ? 2.5 : 1;
    const score = Math.max(50, Math.round((10000 * sizeMult) - M.moves * 60 - secs * 12));
    $('#memory-time').textContent = fmtTime(secs);
    $('#memory-result-text').textContent =
      `Solved the ${M.size}×${M.size} board in ${M.moves} moves and ${fmtTime(secs)}. Score: ${score}.`;
    window.LB.buildSave($('#memory-save'), 'memory', score,
      { moves: M.moves, seconds: secs, size: M.size }, () => refreshLeaderboard());
    $('#memory-overlay').classList.remove('hidden');
  }

  function refreshLeaderboard() {
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
