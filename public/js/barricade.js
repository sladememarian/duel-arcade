// public/js/barricade.js — client renderer + legal-move hints for Barricade.
// Mirrors the server's wall/adjacency rules ONLY for highlighting; the server
// remains authoritative and rejects anything illegal.
(function () {
  const SIZE = 9;

  function makeSets(state) {
    return { h: new Set(state.hWalls), v: new Set(state.vWalls) };
  }

  function canStep(sets, r, c, dr, dc) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return false;
    if (dr === -1) return !(sets.h.has(`${r - 1},${c}`) || sets.h.has(`${r - 1},${c - 1}`));
    if (dr === 1)  return !(sets.h.has(`${r},${c}`)     || sets.h.has(`${r},${c - 1}`));
    if (dc === -1) return !(sets.v.has(`${r},${c - 1}`) || sets.v.has(`${r - 1},${c - 1}`));
    if (dc === 1)  return !(sets.v.has(`${r},${c}`)     || sets.v.has(`${r - 1},${c}`));
    return false;
  }

  function legalMoves(state, seat) {
    const sets = makeSets(state);
    const me = state.players[seat];
    const opp = state.players[seat === 1 ? 2 : 1];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const out = [];
    for (const [dr, dc] of dirs) {
      if (!canStep(sets, me.row, me.col, dr, dc)) continue;
      const nr = me.row + dr, nc = me.col + dc;
      if (nr === opp.row && nc === opp.col) {
        if (canStep(sets, nr, nc, dr, dc)) out.push([nr + dr, nc + dc]);
        else {
          const perp = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [pr, pc] of perp) if (canStep(sets, nr, nc, pr, pc)) out.push([nr + pr, nc + pc]);
        }
      } else out.push([nr, nc]);
    }
    return out;
  }

  function render(wrap, state, ctx) {
    wrap.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'bar-board';
    const tracks = [];
    for (let i = 0; i < 17; i++) tracks.push(i % 2 === 0 ? 'minmax(0,1fr)' : 'var(--gap)');
    board.style.gridTemplateColumns = tracks.join(' ');
    board.style.gridTemplateRows = tracks.join(' ');

    const myTurn = state.turn === ctx.seat && !state.winner;
    const legal = myTurn && ctx.tool === 'move' ? legalMoves(state, ctx.seat) : [];
    const legalSet = new Set(legal.map(([r, c]) => `${r},${c}`));

    // cells + pawns
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'bar-cell';
        cell.style.gridRow = `${2 * r + 1} / ${2 * r + 2}`;
        cell.style.gridColumn = `${2 * c + 1} / ${2 * c + 2}`;
        if (state.players[1].row === r && state.players[1].col === c) {
          const p = document.createElement('div'); p.className = 'pawn p1'; cell.appendChild(p);
        } else if (state.players[2].row === r && state.players[2].col === c) {
          const p = document.createElement('div'); p.className = 'pawn p2'; cell.appendChild(p);
        }
        if (legalSet.has(`${r},${c}`)) {
          cell.classList.add('legal');
          cell.addEventListener('click', () => ctx.onMove({ kind: 'move', row: r, col: c }));
        }
        board.appendChild(cell);
      }
    }

    // wall slots (horizontal + vertical)
    const hSet = new Set(state.hWalls), vSet = new Set(state.vWalls);
    const wallTool = ctx.tool === 'wall' && myTurn && state.players[ctx.seat].walls > 0;
    for (let sr = 0; sr < SIZE - 1; sr++) {
      for (let sc = 0; sc < SIZE - 1; sc++) {
        // horizontal slot
        const h = document.createElement('div');
        h.className = 'slot';
        h.style.gridRow = `${2 * sr + 2} / ${2 * sr + 3}`;
        h.style.gridColumn = `${2 * sc + 1} / ${2 * sc + 4}`;
        h.style.position = 'relative';
        if (hSet.has(`${sr},${sc}`)) h.classList.add('filled');
        if (wallTool && ctx.orient === 'h') {
          h.classList.add('active');
          h.addEventListener('click', () => ctx.onMove({ kind: 'wall', orient: 'h', r: sr, c: sc }));
        }
        board.appendChild(h);

        // vertical slot
        const v = document.createElement('div');
        v.className = 'slot';
        v.style.gridColumn = `${2 * sc + 2} / ${2 * sc + 3}`;
        v.style.gridRow = `${2 * sr + 1} / ${2 * sr + 4}`;
        v.style.position = 'relative';
        if (vSet.has(`${sr},${sc}`)) v.classList.add('filled');
        if (wallTool && ctx.orient === 'v') {
          v.classList.add('active');
          v.addEventListener('click', () => ctx.onMove({ kind: 'wall', orient: 'v', r: sr, c: sc }));
        }
        board.appendChild(v);
      }
    }

    wrap.appendChild(board);
  }

  function statusText(state, seat, mode) {
    const w1 = state.players[1].walls, w2 = state.players[2].walls;
    if (state.winner) {
      const who = state.winner === seat ? 'You win! 🎉'
        : (mode === 'pve' ? 'Computer wins.' : 'Opponent wins.');
      return who;
    }
    const turnTxt = state.turn === seat ? 'Your turn' : (mode === 'pve' ? 'Computer thinking…' : "Opponent's turn");
    return `${turnTxt}  •  Walls — you(P${seat}): ${state.players[seat].walls}, opp: ${state.players[seat === 1 ? 2 : 1].walls}`;
  }

  window.BarricadeUI = { render, statusText };
})();
