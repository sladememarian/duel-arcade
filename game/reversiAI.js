// game/reversiAI.js
// Reversi computer opponent.
//   easy → greedy: grab corners, otherwise flip the most discs (with a little
//          randomness so it isn't perfectly predictable).
//   hard → minimax with alpha-beta over a positional weight map (corners are
//          gold, squares next to corners are traps).

const { Reversi, N } = require('./reversi');

// Classic positional weights (8×8). Corners great, X/C squares dangerous.
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
   20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
   20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];
const CORNERS = [0, 7, 56, 63];

function clone(game) {
  const g = Object.create(Reversi.prototype);
  g.board = [...game.board];
  g.turn = game.turn;
  g.winner = game.winner;
  g.lastMove = game.lastMove;
  g.flipped = [...game.flipped];
  return g;
}

function chooseReversiMove(game, player, difficulty = 'hard') {
  const legal = game.legalMoves(player);
  if (!legal.length) return null;

  // Snap a corner whenever it's available — never give one up.
  for (const cell of legal) if (CORNERS.includes(cell)) return { cell };

  if (difficulty === 'easy') {
    let best = legal[0], bestScore = -Infinity;
    for (const cell of legal) {
      const r = Math.floor(cell / N), c = cell % N;
      const score = game.flipsFor(player, r, c).length + (Math.random() * 2);
      if (score > bestScore) { bestScore = score; best = cell; }
    }
    return { cell: best };
  }

  // hard: minimax with alpha-beta
  const opp = player === 1 ? 2 : 1;
  const depth = 4;
  let bestCell = legal[0], bestScore = -Infinity;
  for (const cell of legal) {
    const g = clone(game);
    g.applyMove(player, { cell });
    const score = minimax(g, depth - 1, -Infinity, Infinity, player, opp);
    if (score > bestScore) { bestScore = score; bestCell = cell; }
  }
  return { cell: bestCell };
}

function minimax(game, depth, alpha, beta, me, opp) {
  if (game.winner) {
    if (game.winner === me) return 1e6;
    if (game.winner === opp) return -1e6;
    return 0;
  }
  if (depth === 0) return evaluate(game, me, opp);

  const mover = game.turn;
  const maximizing = mover === me;
  const legal = game.legalMoves(mover);
  if (!legal.length) return evaluate(game, me, opp); // shouldn't happen (engine handles passes)

  if (maximizing) {
    let value = -Infinity;
    for (const cell of legal) {
      const g = clone(game); g.applyMove(mover, { cell });
      value = Math.max(value, minimax(g, depth - 1, alpha, beta, me, opp));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  } else {
    let value = Infinity;
    for (const cell of legal) {
      const g = clone(game); g.applyMove(mover, { cell });
      value = Math.min(value, minimax(g, depth - 1, alpha, beta, me, opp));
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return value;
  }
}

function evaluate(game, me, opp) {
  let posScore = 0;
  for (let i = 0; i < game.board.length; i++) {
    if (game.board[i] === me) posScore += WEIGHTS[i];
    else if (game.board[i] === opp) posScore -= WEIGHTS[i];
  }
  // mobility: having more options than the opponent is good
  const myMob = game.legalMoves(me).length;
  const opMob = game.legalMoves(opp).length;
  const mobScore = (myMob - opMob) * 5;
  return posScore + mobScore;
}

module.exports = { chooseReversiMove };
