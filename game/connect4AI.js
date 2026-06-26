// game/connect4AI.js
// Connect Four computer opponent.
//   easy → mostly random, but always takes an immediate win and blocks an
//          immediate loss (so it isn't frustratingly dumb).
//   hard → minimax with alpha-beta pruning + a positional heuristic.

const { Connect4, COLS, ROWS } = require('./connect4');

function clone(game) {
  const g = new Connect4();
  g.board = [...game.board];
  g.turn = game.turn;
  g.winner = game.winner;
  g.winLine = game.winLine ? [...game.winLine] : null;
  g.lastDrop = game.lastDrop;
  g.moveCount = game.moveCount;
  return g;
}

function winsWith(game, player, col) {
  const g = clone(game);
  g.turn = player; g.winner = null;
  const res = g.applyMove(player, col);
  return res.ok && g.winner === player;
}

// Centre-out column ordering improves pruning and play quality.
const ORDER = [3, 2, 4, 1, 5, 0, 6];

function chooseConnect4Move(game, player, difficulty = 'hard') {
  const opp = player === 1 ? 2 : 1;
  const legal = game.legalColumns();
  if (!legal.length) return null;

  // Always grab a win, always block a loss — at every difficulty.
  for (const c of legal) if (winsWith(game, player, c)) return c;
  for (const c of legal) if (winsWith(game, opp, c)) return c;

  if (difficulty === 'easy') {
    // Prefer central-ish columns but stay unpredictable.
    const weighted = legal.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (Math.random() < 0.5) return weighted[0];
    return legal[Math.floor(Math.random() * legal.length)];
  }

  // hard: minimax
  const depth = 6;
  let bestCol = legal[0];
  let bestScore = -Infinity;
  for (const c of ORDER) {
    if (!legal.includes(c)) continue;
    const g = clone(game);
    g.turn = player;
    g.applyMove(player, c);
    const score = minimax(g, depth - 1, -Infinity, Infinity, false, player, opp);
    if (score > bestScore) { bestScore = score; bestCol = c; }
  }
  return bestCol;
}

function minimax(game, depth, alpha, beta, maximizing, me, opp) {
  if (game.winner === me) return 100000 + depth;     // sooner wins score higher
  if (game.winner === opp) return -100000 - depth;
  if (game.winner === 'draw') return 0;
  if (depth === 0) return evaluate(game, me, opp);

  const legal = game.legalColumns();
  const mover = maximizing ? me : opp;
  if (maximizing) {
    let value = -Infinity;
    for (const c of ORDER) {
      if (!legal.includes(c)) continue;
      const g = clone(game); g.turn = mover; g.applyMove(mover, c);
      value = Math.max(value, minimax(g, depth - 1, alpha, beta, false, me, opp));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  } else {
    let value = Infinity;
    for (const c of ORDER) {
      if (!legal.includes(c)) continue;
      const g = clone(game); g.turn = mover; g.applyMove(mover, c);
      value = Math.min(value, minimax(g, depth - 1, alpha, beta, true, me, opp));
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return value;
  }
}

// Heuristic: score all length-4 windows by how many of my discs vs theirs.
function evaluate(game, me, opp) {
  let score = 0;
  const b = game.board;
  const at = (r, c) => b[r * COLS + c];

  // centre column control is valuable
  for (let r = 0; r < ROWS; r++) if (at(r, 3) === me) score += 3;

  const windows = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) windows.push([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]]);
      if (r + 3 < ROWS) windows.push([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]]);
      if (r + 3 < ROWS && c + 3 < COLS) windows.push([[r, c], [r + 1, c + 1], [r + 2, c + 2], [r + 3, c + 3]]);
      if (r + 3 < ROWS && c - 3 >= 0) windows.push([[r, c], [r + 1, c - 1], [r + 2, c - 2], [r + 3, c - 3]]);
    }
  }
  for (const w of windows) {
    let mine = 0, theirs = 0, empty = 0;
    for (const [r, c] of w) {
      const v = at(r, c);
      if (v === me) mine++; else if (v === opp) theirs++; else empty++;
    }
    if (mine && theirs) continue;            // contested window, ignore
    if (mine === 3 && empty === 1) score += 50;
    else if (mine === 2 && empty === 2) score += 8;
    else if (theirs === 3 && empty === 1) score -= 60;  // block threats harder
    else if (theirs === 2 && empty === 2) score -= 6;
  }
  return score;
}

module.exports = { chooseConnect4Move };
