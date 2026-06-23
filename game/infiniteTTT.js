// game/infiniteTTT.js
// Infinite Tic Tac Toe: 3x3 board, each player may have AT MOST 3 marks.
// Placing a 4th mark removes that player's OLDEST mark (FIFO) BEFORE the
// win check, so a win must hold with the oldest piece already gone.

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // cols
  [0, 4, 8], [2, 4, 6],              // diagonals
];

class InfiniteTTT {
  constructor() {
    this.board = Array(9).fill(null); // null | 1 | 2
    this.queues = { 1: [], 2: [] };   // FIFO of cell indices per player
    this.turn = 1;
    this.winner = null;
    this.moveCount = 0;
  }

  serialize() {
    return {
      type: 'ttt',
      board: [...this.board],
      queues: { 1: [...this.queues[1]], 2: [...this.queues[2]] },
      // the cell that will vanish next for each player (oldest), or null
      oldest: {
        1: this.queues[1].length >= 3 ? this.queues[1][0] : null,
        2: this.queues[2].length >= 3 ? this.queues[2][0] : null,
      },
      turn: this.turn,
      winner: this.winner,
    };
  }

  checkWin(player) {
    return LINES.some(([a, b, c]) =>
      this.board[a] === player && this.board[b] === player && this.board[c] === player);
  }

  // apply a placement at cell index (0..8) for player
  applyMove(player, cell) {
    if (this.winner) return { ok: false, error: 'Game already over.' };
    if (player !== this.turn) return { ok: false, error: 'Not your turn.' };
    if (cell < 0 || cell > 8) return { ok: false, error: 'Bad cell.' };
    if (this.board[cell] !== null) return { ok: false, error: 'Cell occupied.' };

    // place
    this.board[cell] = player;
    this.queues[player].push(cell);

    // FIFO removal if now over the 3-piece limit
    if (this.queues[player].length > 3) {
      const removed = this.queues[player].shift();
      // only clear if it wasn't somehow overwritten (it can't be, board guards)
      if (this.board[removed] === player) this.board[removed] = null;
    }

    if (this.checkWin(player)) {
      this.winner = player;
    } else {
      this.turn = player === 1 ? 2 : 1;
    }
    this.moveCount += 1;
    return { ok: true, state: this.serialize() };
  }
}

module.exports = { InfiniteTTT, LINES };
