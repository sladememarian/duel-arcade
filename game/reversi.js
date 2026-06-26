// game/reversi.js
// Reversi / Othello on an 8×8 board. Player 1 = dark, player 2 = light.
// A legal move must outflank at least one opponent disc in a straight line;
// all outflanked discs flip. If a player has no legal move, their turn is
// skipped (forced pass). When neither can move, the game ends and the player
// with more discs wins (equal = draw).
//
// Pure logic. Contract: applyMove(player, action) -> { ok, error?, state? }.
// `turn` always points at a player who HAS a legal move (or winner is set),
// so the server's AI driver can simply act whenever turn === AI.

const N = 8;

class Reversi {
  constructor() {
    this.board = Array(N * N).fill(null); // null | 1 | 2
    this.turn = 1;
    this.winner = null;     // null | 1 | 2 | 'draw'
    this.lastMove = null;   // index of last placed disc
    this.flipped = [];      // indices flipped by the last move (for animation)
    // standard opening four
    this.set(3, 3, 2); this.set(3, 4, 1);
    this.set(4, 3, 1); this.set(4, 4, 2);
  }

  idx(r, c) { return r * N + c; }
  set(r, c, v) { this.board[this.idx(r, c)] = v; }
  inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

  static DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  // discs that would flip if `player` plays at (r,c); [] means illegal.
  flipsFor(player, r, c) {
    if (this.board[this.idx(r, c)] !== null) return [];
    const opp = player === 1 ? 2 : 1;
    const out = [];
    for (const [dr, dc] of Reversi.DIRS) {
      const line = [];
      let nr = r + dr, nc = c + dc;
      while (this.inBounds(nr, nc) && this.board[this.idx(nr, nc)] === opp) {
        line.push(this.idx(nr, nc));
        nr += dr; nc += dc;
      }
      if (line.length && this.inBounds(nr, nc) && this.board[this.idx(nr, nc)] === player) {
        out.push(...line);
      }
    }
    return out;
  }

  legalMoves(player) {
    const out = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.flipsFor(player, r, c).length) out.push(this.idx(r, c));
      }
    }
    return out;
  }

  counts() {
    let a = 0, b = 0;
    for (const v of this.board) { if (v === 1) a++; else if (v === 2) b++; }
    return { 1: a, 2: b };
  }

  serialize() {
    return {
      type: 'reversi',
      n: N,
      board: [...this.board],
      turn: this.turn,
      winner: this.winner,
      lastMove: this.lastMove,
      flipped: [...this.flipped],
      legal: this.winner ? [] : this.legalMoves(this.turn),
      counts: this.counts(),
    };
  }

  // action: { cell } (0..63) or { r, c }. A bare number is also accepted.
  applyMove(player, action) {
    if (this.winner) return { ok: false, error: 'Game already over.' };
    if (player !== this.turn) return { ok: false, error: 'Not your turn.' };
    let r, c;
    if (typeof action === 'number') { r = Math.floor(action / N); c = action % N; }
    else if (action && Number.isInteger(action.cell)) { r = Math.floor(action.cell / N); c = action.cell % N; }
    else if (action && Number.isInteger(action.r)) { r = action.r; c = action.c; }
    else return { ok: false, error: 'Bad move.' };
    if (!this.inBounds(r, c)) return { ok: false, error: 'Off board.' };

    const flips = this.flipsFor(player, r, c);
    if (!flips.length) return { ok: false, error: 'Illegal move — must outflank a disc.' };

    this.board[this.idx(r, c)] = player;
    for (const i of flips) this.board[i] = player;
    this.lastMove = this.idx(r, c);
    this.flipped = flips;

    // decide who moves next (handle forced passes / game end)
    const opp = player === 1 ? 2 : 1;
    if (this.legalMoves(opp).length) {
      this.turn = opp;
    } else if (this.legalMoves(player).length) {
      this.turn = player;           // opponent passes
    } else {
      this.finish();                // neither can move
    }
    return { ok: true, state: this.serialize() };
  }

  finish() {
    const { 1: a, 2: b } = this.counts();
    this.winner = a > b ? 1 : b > a ? 2 : 'draw';
  }
}

module.exports = { Reversi, N };
