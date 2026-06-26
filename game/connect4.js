// game/connect4.js
// Connect Four: 7 columns × 6 rows. Players drop a disc into a column; it
// falls to the lowest empty slot. First to line up four (horizontal, vertical
// or diagonal) wins. A full board with no line is a draw.
//
// Pure logic — the server owns turns/networking. Mirrors the Quoridor/TTT
// engine contract: applyMove(player, action) -> { ok, error?, state? }.

const COLS = 7;
const ROWS = 6;

class Connect4 {
  constructor() {
    // board is row-major, index = r * COLS + c. Row 0 is the TOP row.
    this.board = Array(COLS * ROWS).fill(null); // null | 1 | 2
    this.turn = 1;
    this.winner = null;        // null | 1 | 2 | 'draw'
    this.winLine = null;       // array of winning indices (for highlight)
    this.lastDrop = null;      // index of the most recent disc
    this.moveCount = 0;
  }

  idx(r, c) { return r * COLS + c; }

  // lowest empty row in a column, or -1 if the column is full
  dropRow(c) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[this.idx(r, c)] === null) return r;
    }
    return -1;
  }

  legalColumns() {
    const out = [];
    for (let c = 0; c < COLS; c++) if (this.dropRow(c) >= 0) out.push(c);
    return out;
  }

  serialize() {
    return {
      type: 'connect4',
      cols: COLS, rows: ROWS,
      board: [...this.board],
      turn: this.turn,
      winner: this.winner,
      winLine: this.winLine ? [...this.winLine] : null,
      lastDrop: this.lastDrop,
      legal: this.legalColumns(),
    };
  }

  // action: { col } (a column index 0..6). A bare number is also accepted.
  applyMove(player, action) {
    if (this.winner) return { ok: false, error: 'Game already over.' };
    if (player !== this.turn) return { ok: false, error: 'Not your turn.' };
    const c = typeof action === 'number' ? action : (action && action.col);
    if (!Number.isInteger(c) || c < 0 || c >= COLS) return { ok: false, error: 'Bad column.' };
    const r = this.dropRow(c);
    if (r < 0) return { ok: false, error: 'Column is full.' };

    const at = this.idx(r, c);
    this.board[at] = player;
    this.lastDrop = at;
    this.moveCount += 1;

    const line = this.findWinLine(r, c, player);
    if (line) {
      this.winner = player;
      this.winLine = line;
    } else if (this.legalColumns().length === 0) {
      this.winner = 'draw';
    } else {
      this.turn = player === 1 ? 2 : 1;
    }
    return { ok: true, state: this.serialize() };
  }

  // Look in all 4 directions from the dropped disc for a run of 4.
  findWinLine(r, c, player) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const line = [this.idx(r, c)];
      // forward
      for (let k = 1; k < 4; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
        if (this.board[this.idx(nr, nc)] !== player) break;
        line.push(this.idx(nr, nc));
      }
      // backward
      for (let k = 1; k < 4; k++) {
        const nr = r - dr * k, nc = c - dc * k;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
        if (this.board[this.idx(nr, nc)] !== player) break;
        line.unshift(this.idx(nr, nc));
      }
      if (line.length >= 4) return line.slice(0, 4);
    }
    return null;
  }
}

module.exports = { Connect4, COLS, ROWS };
