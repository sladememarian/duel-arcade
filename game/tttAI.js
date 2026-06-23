// game/tttAI.js
// Infinite Tic Tac Toe AI.
//  1) If the AI can win immediately, do it.
//  2) Else block the opponent's immediate win.
//  3) Else prefer center, then corners, then edges.
//  Win/threat detection accounts for the FIFO removal: simulating a placement
//  uses the SAME engine logic so the "oldest piece vanishes" rule is honored.

const { InfiniteTTT, LINES } = require('./infiniteTTT');

function cloneState(game) {
  const g = new InfiniteTTT();
  g.board = [...game.board];
  g.queues = { 1: [...game.queues[1]], 2: [...game.queues[2]] };
  g.turn = game.turn;
  g.winner = game.winner;
  g.moveCount = game.moveCount;
  return g;
}

function wouldWin(game, player, cell) {
  if (game.board[cell] !== null) return false;
  const g = cloneState(game);
  g.turn = player;          // force it to be this player's move
  g.winner = null;
  const res = g.applyMove(player, cell);
  return res.ok && g.winner === player;
}

function chooseTTTMove(game, player) {
  const opp = player === 1 ? 2 : 1;
  const empty = [];
  for (let i = 0; i < 9; i++) if (game.board[i] === null) empty.push(i);

  // 1) win now
  for (const c of empty) if (wouldWin(game, player, c)) return c;
  // 2) block opponent
  for (const c of empty) if (wouldWin(game, opp, c)) return c;
  // 3) positional preference
  const pref = [4, 0, 2, 6, 8, 1, 3, 5, 7];
  for (const c of pref) if (game.board[c] === null) return c;
  return empty[0];
}

module.exports = { chooseTTTMove };
