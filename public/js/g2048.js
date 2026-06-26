// public/js/g2048.js — 2048 (solo). Self-contained: own screen, logic, input,
// localStorage best-score, and online leaderboard submission.
(function () {
  const SIZE = 4;
  const G = {
    helpers: null,
    grid: [],          // SIZE*SIZE, 0 = empty
    score: 0,
    best: 0,
    over: false,
    won: false,
    submitted: false,
    keyHandler: null,
  };

  const $ = (s) => document.querySelector(s);

  function init(helpers) { G.helpers = helpers; wire(); }

  function open() {
    G.best = parseInt(localStorage.getItem('g2048Best') || '0', 10) || 0;
    showScreen('g2048-screen');
    newGame();
    refreshLeaderboard();
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function wire() {
    $('#g2048-new').addEventListener('click', newGame);
    $('#g2048-again').addEventListener('click', () => { hideOverlay(); newGame(); });
    $('.g2048-back').addEventListener('click', leave);
    $('#g2048-menu').addEventListener('click', leave);

    // keyboard
    G.keyHandler = (e) => {
      if (!$('#g2048-screen').classList.contains('active')) return;
      const map = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D',
                    a: 'L', d: 'R', w: 'U', s: 'D' };
      const dir = map[e.key];
      if (dir) { e.preventDefault(); move(dir); }
    };
    document.addEventListener('keydown', G.keyHandler);

    // touch swipe on the board
    const board = $('#g2048-board');
    let sx = 0, sy = 0;
    board.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    board.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'R' : 'L');
      else move(dy > 0 ? 'D' : 'U');
    }, { passive: true });
  }

  function leave() {
    hideOverlay();
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById('menu').classList.add('active');
  }

  function newGame() {
    G.grid = Array(SIZE * SIZE).fill(0);
    G.score = 0; G.over = false; G.won = false; G.submitted = false;
    addRandom(); addRandom();
    render();
  }

  function addRandom() {
    const empty = [];
    for (let i = 0; i < G.grid.length; i++) if (G.grid[i] === 0) empty.push(i);
    if (!empty.length) return;
    const i = empty[Math.floor(Math.random() * empty.length)];
    G.grid[i] = Math.random() < 0.9 ? 2 : 4;
  }

  // Compress + merge one row (array of 4) toward the left. Returns { row, gained, moved }.
  function slideRow(row) {
    const nums = row.filter((v) => v !== 0);
    let gained = 0;
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
        const merged = nums[i] * 2;
        out.push(merged); gained += merged;
        if (merged === 2048) G.won = true;
        i++; // skip the consumed tile
      } else {
        out.push(nums[i]);
      }
    }
    while (out.length < SIZE) out.push(0);
    const moved = out.some((v, i) => v !== row[i]);
    return { row: out, gained, moved };
  }

  function getRow(r) { return [0, 1, 2, 3].map((c) => G.grid[r * SIZE + c]); }
  function setRow(r, vals) { for (let c = 0; c < SIZE; c++) G.grid[r * SIZE + c] = vals[c]; }
  function getCol(c) { return [0, 1, 2, 3].map((r) => G.grid[r * SIZE + c]); }
  function setCol(c, vals) { for (let r = 0; r < SIZE; r++) G.grid[r * SIZE + c] = vals[r]; }

  function move(dir) {
    if (G.over) return;
    let moved = false, gained = 0;

    const apply = (line, reverse) => {
      const input = reverse ? line.slice().reverse() : line;
      const res = slideRow(input);
      const out = reverse ? res.row.slice().reverse() : res.row;
      if (res.moved) moved = true;
      gained += res.gained;
      return out;
    };

    if (dir === 'L' || dir === 'R') {
      for (let r = 0; r < SIZE; r++) setRow(r, apply(getRow(r), dir === 'R'));
    } else {
      for (let c = 0; c < SIZE; c++) setCol(c, apply(getCol(c), dir === 'D'));
    }

    if (!moved) return;
    G.score += gained;
    if (G.score > G.best) { G.best = G.score; localStorage.setItem('g2048Best', String(G.best)); }
    addRandom();
    render();
    if (isGameOver()) endGame();
  }

  function isGameOver() {
    if (G.grid.includes(0)) return false;
    // any adjacent equal pair?
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = G.grid[r * SIZE + c];
        if (c + 1 < SIZE && G.grid[r * SIZE + c + 1] === v) return false;
        if (r + 1 < SIZE && G.grid[(r + 1) * SIZE + c] === v) return false;
      }
    }
    return true;
  }

  function render() {
    $('#g2048-score').textContent = G.score;
    $('#g2048-best').textContent = G.best;
    const board = $('#g2048-board');
    board.innerHTML = '';
    for (let i = 0; i < G.grid.length; i++) {
      const cell = document.createElement('div');
      cell.className = 'g2048-cell';
      const v = G.grid[i];
      if (v) {
        const tile = document.createElement('div');
        tile.className = 'g2048-tile v' + (v > 2048 ? 'big' : v);
        tile.textContent = v;
        cell.appendChild(tile);
      }
      board.appendChild(cell);
    }
  }

  function endGame() {
    G.over = true;
    $('#g2048-result-title').textContent = G.won ? 'You hit 2048! 🎉' : 'Game Over';
    $('#g2048-result-text').textContent = `You scored ${G.score} points.`;
    window.LB.buildSave($('#g2048-save'), 'g2048', G.score, {}, () => refreshLeaderboard());
    $('#g2048-overlay').classList.remove('hidden');
  }

  function hideOverlay() { $('#g2048-overlay').classList.add('hidden'); }

  function refreshLeaderboard() {
    window.LB.render($('#g2048-lb'), 'g2048', { format: (r) => `${r.score}` });
  }

  window.G2048 = { init, open };
})();
