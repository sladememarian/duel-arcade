// game/quoridor.js
// Server-authoritative Barricade (Quoridor) engine.
//
// Board: 9x9 cells. row 0 = top, row 8 = bottom.
// Player 1 (P1, "you"): starts row 8 col 4 (bottom center). Goal: reach row 0.
// Player 2 (P2, "opponent"): starts row 0 col 4 (top center). Goal: reach row 8.
//
// Walls live on an 8x8 grid of "slots" (r,c in 0..7).
//   - horizontal wall at (r,c): sits between row r and r+1, spanning columns c & c+1.
//   - vertical   wall at (r,c): sits between col c and c+1, spanning rows r & r+1.

const SIZE = 9;
const WALLS_PER_PLAYER = 10;

class Quoridor {
  constructor() {
    this.size = SIZE;
    this.players = {
      1: { row: 8, col: 4, walls: WALLS_PER_PLAYER, goalRow: 0 },
      2: { row: 0, col: 4, walls: WALLS_PER_PLAYER, goalRow: 8 },
    };
    this.turn = 1;                 // whose turn (1 or 2)
    this.hWalls = new Set();       // "r,c" horizontal wall slots
    this.vWalls = new Set();       // "r,c" vertical wall slots
    this.winner = null;            // 1 | 2 | null
    this.moveCount = 0;
  }

  // ---- serialization for the network ----
  serialize() {
    return {
      type: 'barricade',
      size: this.size,
      players: {
        1: { ...this.players[1] },
        2: { ...this.players[2] },
      },
      turn: this.turn,
      hWalls: [...this.hWalls],
      vWalls: [...this.vWalls],
      winner: this.winner,
    };
  }

  // ---- adjacency: can a pawn step from (r,c) to a neighbor? (walls only) ----
  canStep(r, c, dr, dc) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return false;
    if (dr === -1 && dc === 0) { // up
      return !(this.hWalls.has(`${r - 1},${c}`) || this.hWalls.has(`${r - 1},${c - 1}`));
    }
    if (dr === 1 && dc === 0) {  // down
      return !(this.hWalls.has(`${r},${c}`) || this.hWalls.has(`${r},${c - 1}`));
    }
    if (dr === 0 && dc === -1) { // left
      return !(this.vWalls.has(`${r},${c - 1}`) || this.vWalls.has(`${r - 1},${c - 1}`));
    }
    if (dr === 0 && dc === 1) {  // right
      return !(this.vWalls.has(`${r},${c}`) || this.vWalls.has(`${r - 1},${c}`));
    }
    return false;
  }

  // ---- BFS: does a player have ANY path to their goal row? ----
  hasPathToGoal(player) {
    const { row, col, goalRow } = this.players[player];
    const seen = new Set([`${row},${col}`]);
    const q = [[row, col]];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (q.length) {
      const [r, c] = q.shift();
      if (r === goalRow) return true;
      for (const [dr, dc] of dirs) {
        if (!this.canStep(r, c, dr, dc)) continue;
        const key = `${r + dr},${c + dc}`;
        if (!seen.has(key)) { seen.add(key); q.push([r + dr, c + dc]); }
      }
    }
    return false;
  }

  // ---- BFS shortest path length to goal (used by AI). Infinity if blocked ----
  shortestPath(player) {
    const { row, col, goalRow } = this.players[player];
    const seen = new Set([`${row},${col}`]);
    const q = [[row, col, 0]];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (q.length) {
      const [r, c, d] = q.shift();
      if (r === goalRow) return d;
      for (const [dr, dc] of dirs) {
        if (!this.canStep(r, c, dr, dc)) continue;
        const key = `${r + dr},${c + dc}`;
        if (!seen.has(key)) { seen.add(key); q.push([r + dr, c + dc, d + 1]); }
      }
    }
    return Infinity;
  }

  // ---- legal pawn destinations from current player (incl. jumps) ----
  legalMoves(player) {
    const me = this.players[player];
    const opp = this.players[player === 1 ? 2 : 1];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const moves = [];
    for (const [dr, dc] of dirs) {
      if (!this.canStep(me.row, me.col, dr, dc)) continue;
      const nr = me.row + dr, nc = me.col + dc;
      if (nr === opp.row && nc === opp.col) {
        // opponent is there -> try to jump straight over
        if (this.canStep(nr, nc, dr, dc)) {
          moves.push([nr + dr, nc + dc]);
        } else {
          // blocked behind -> diagonal jumps
          const perp = (dr === 0) ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [pr, pc] of perp) {
            if (this.canStep(nr, nc, pr, pc)) moves.push([nr + pr, nc + pc]);
          }
        }
      } else {
        moves.push([nr, nc]);
      }
    }
    return moves;
  }

  // ---- check a wall placement is structurally legal (overlap/cross), ----
  // ---- NOT counting path-blocking (handled separately) ----
  wallSlotFree(orient, r, c) {
    if (r < 0 || r > SIZE - 2 || c < 0 || c > SIZE - 2) return false;
    if (orient === 'h') {
      if (this.hWalls.has(`${r},${c}`)) return false;
      if (this.hWalls.has(`${r},${c - 1}`)) return false;
      if (this.hWalls.has(`${r},${c + 1}`)) return false;
      if (this.vWalls.has(`${r},${c}`)) return false; // crossing
      return true;
    } else {
      if (this.vWalls.has(`${r},${c}`)) return false;
      if (this.vWalls.has(`${r - 1},${c}`)) return false;
      if (this.vWalls.has(`${r + 1},${c}`)) return false;
      if (this.hWalls.has(`${r},${c}`)) return false; // crossing
      return true;
    }
  }

  // Full validity incl. the Golden Rule (both players keep a path).
  isWallLegal(player, orient, r, c) {
    if (this.players[player].walls <= 0) return false;
    if (!this.wallSlotFree(orient, r, c)) return false;
    // tentatively add, check both paths, then remove
    const set = orient === 'h' ? this.hWalls : this.vWalls;
    const key = `${r},${c}`;
    set.add(key);
    const ok = this.hasPathToGoal(1) && this.hasPathToGoal(2);
    set.delete(key);
    return ok;
  }

  // ---- apply a move from a player ----
  // action = { kind:'move', row, col }  OR  { kind:'wall', orient:'h'|'v', r, c }
  applyMove(player, action) {
    if (this.winner) return { ok: false, error: 'Game already over.' };
    if (player !== this.turn) return { ok: false, error: 'Not your turn.' };

    if (action.kind === 'move') {
      const legal = this.legalMoves(player).some(([r, c]) => r === action.row && c === action.col);
      if (!legal) return { ok: false, error: 'Illegal pawn move.' };
      this.players[player].row = action.row;
      this.players[player].col = action.col;
      if (action.row === this.players[player].goalRow) this.winner = player;
    } else if (action.kind === 'wall') {
      if (!this.isWallLegal(player, action.orient, action.r, action.c)) {
        return { ok: false, error: 'Illegal wall placement (blocks a path, overlaps, or none left).' };
      }
      (action.orient === 'h' ? this.hWalls : this.vWalls).add(`${action.r},${action.c}`);
      this.players[player].walls -= 1;
    } else {
      return { ok: false, error: 'Unknown action.' };
    }

    this.moveCount += 1;
    if (!this.winner) this.turn = (this.turn === 1) ? 2 : 1;
    return { ok: true, state: this.serialize() };
  }
}

module.exports = { Quoridor, SIZE, WALLS_PER_PLAYER };
