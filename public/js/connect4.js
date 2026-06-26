// public/js/connect4.js — client renderer for Connect 4.
(function () {
  function render(wrap, state, ctx) {
    wrap.innerHTML = '';
    const myTurn = state.turn === ctx.seat && !state.winner;

    const board = document.createElement('div');
    board.className = 'c4-board';
    board.style.setProperty('--cols', state.cols);

    for (let c = 0; c < state.cols; c++) {
      const col = document.createElement('div');
      col.className = 'c4-col';
      const playable = myTurn && state.legal.includes(c);
      if (playable) {
        col.classList.add('playable');
        col.addEventListener('click', () => ctx.onMove({ col: c }));
      }
      for (let r = 0; r < state.rows; r++) {
        const i = r * state.cols + c;
        const cell = document.createElement('div');
        cell.className = 'c4-cell';
        const slot = document.createElement('div');
        slot.className = 'c4-slot';
        const owner = state.board[i];
        if (owner) {
          slot.classList.add(owner === 1 ? 'p1' : 'p2');
          if (i === state.lastDrop) slot.classList.add('drop');
        }
        if (state.winLine && state.winLine.includes(i)) slot.classList.add('win');
        cell.appendChild(slot);
        col.appendChild(cell);
      }
      board.appendChild(col);
    }
    wrap.appendChild(board);
  }

  function statusText(state, seat, mode) {
    const me = seat === 1 ? '🔴' : '🟡';
    if (state.winner === 'draw') return 'Draw — the board is full.';
    if (state.winner) {
      return state.winner === seat ? 'You win! 🎉'
        : (mode === 'pve' ? 'Computer wins.' : 'Opponent wins.');
    }
    const turnTxt = state.turn === seat ? 'Your turn'
      : (mode === 'pve' ? 'Computer thinking…' : "Opponent's turn");
    return `You are ${me}  •  ${turnTxt}`;
  }

  function endText(state, seat, mode) {
    if (state.winner === 'draw') return { title: 'Draw', text: 'The board filled up with no four-in-a-row.' };
    const won = state.winner === seat;
    return {
      title: won ? 'Victory 🎉' : 'Defeat',
      text: won ? 'Four in a row — nicely done!' : (mode === 'pve' ? 'The computer connected four.' : 'Your opponent connected four.'),
    };
  }

  window.Connect4UI = { render, statusText, endText };
})();
