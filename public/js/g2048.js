// public/js/g2048.js — 2048 (solo). Own screen, logic, input and local best.
// On a finished run it saves the score and claims the solo prize once.
(function () {
  const SIZE = 4;
  const G = {
    api: null,
    grid: [],
    score: 0,
    best: 0,
    over: false,
    won: false,
    claimed: false,
    submitted: false,
    keyHandler: null,
  };

  const $ = (s) => document.querySelector(s);

  function init(api) {
    G.api = api;
    wire();
  }

  function open() {
    G.best = parseInt(localStorage.getItem('g2048Best') || '0', 10) || 0;
    G.api.show('g2048-screen');
    newGame();
    refreshLeaderboard();
  }

  function wire() {
    $('#g2048-new').addEventListener('click', newGame);
    $('#g2048-again').addEventListener('click', () => { hideOverlay(); newGame(); });
    document.querySelector('.g2048-back').addEventListener('click', leave);
    $('#g2048-menu').addEventListener('click', leave);

    G.keyHandler = (e) => {
      if (!$('#g2048-screen').classList.contains('active')) return;
      const map = {
        ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D',
        a: 'L', d: 'R', w: 'U', s: 'D',
      };
      const dir = map[e.key];
      if (dir) { e.preventDefault(); move(dir); }
    };
    document.addEventListener('keydown', G.keyHandler);

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
    G.api.show('menu');
  }

  function newGame() {
    G.grid = Array(SIZE * SIZE).fill(0);
    G.score = 0; G.over = false; G.won = false; G.claimed = false; G.submitted = false;
    addRandom(); addRandom();
    hideOverlay();
    render();
  }

  function addRandom() {
    const empty = [];
    for (let i = 0; i < G.grid.length; i++) if (G.grid[i] === 0) empty.push(i);
    if (!empty.length) return;
    const i = empty[Math.floor(Math.random() * empty.length)];
    G.grid[i] = Math.random() < 0.9 ? 2 : 4;
  }

  function slideRow(row) {
    const nums = row.filter((v) => v !== 0);
    let gained = 0;
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
        const merged = nums[i] * 2;
        out.push(merged); gained += merged;
        if (merged === 2048) G.won = true;
        i++;
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
    $('#g2048-result-title').textContent = G.won ? 'You reached 2048' : 'Game over';
    $('#g2048-result-text').textContent = `The run ends at ${G.score} points.`;
    $('#g2048-save').textContent = 'Saving the run…';
    $('#g2048-overlay').classList.remove('hidden');
    settle();
  }

  async function settle() {
    if (!G.submitted) {
      G.submitted = true;
      G.api.submitScore('g2048', G.score, { won: G.won }).then(() => refreshLeaderboard());
    }
    if (G.claimed) return;
    G.claimed = true;
    const res = await G.api.completeSolo('g2048', G.score, { won: G.won });
    if (res && res.ok) $('#g2048-save').textContent = `Prize credited · +${res.points} points.`;
    else if (res && res.error) $('#g2048-save').textContent = res.error;
    else $('#g2048-save').textContent = '';
  }

  function hideOverlay() { $('#g2048-overlay').classList.add('hidden'); }

  function refreshLeaderboard() {
    if (window.LB) window.LB.render($('#g2048-lb'), 'g2048', { format: (r) => `${r.score}` });
  }

  window.G2048 = { init, open };
})();
