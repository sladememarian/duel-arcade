// public/js/tictactoe.js — client renderer for Infinite Tic Tac Toe.
(function () {
  const SYM = { 1: '✕', 2: '◯' };

  function render(wrap, state, ctx) {
    wrap.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'ttt-board';
    const myTurn = state.turn === ctx.seat && !state.winner;

    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      cell.className = 'ttt-cell';
      const owner = state.board[i];
      if (owner) {
        cell.classList.add(owner === 1 ? 'p1' : 'p2');
        cell.textContent = SYM[owner];
        // mark the oldest (about-to-vanish) piece for whichever player owns it
        if (state.oldest[owner] === i) cell.classList.add('oldest');
      } else if (myTurn) {
        cell.addEventListener('click', () => ctx.onMove({ cell: i }));
        cell.style.cursor = 'pointer';
      }
      board.appendChild(cell);
    }
    wrap.appendChild(board);
  }

  function statusText(state, seat, mode) {
    if (state.winner) {
      return state.winner === seat ? 'You win! 🎉'
        : (mode === 'pve' ? 'Computer wins.' : 'Opponent wins.');
    }
    const you = `You are ${SYM[seat]}`;
    const turnTxt = state.turn === seat ? 'Your turn'
      : (mode === 'pve' ? 'Computer thinking…' : "Opponent's turn");
    return `${you}  •  ${turnTxt}`;
  }

  window.TttUI = { render, statusText };
})();
