// public/js/reversi.js — client renderer for Reversi / Othello.
(function () {
  function render(wrap, state, ctx) {
    wrap.innerHTML = '';
    const myTurn = state.turn === ctx.seat && !state.winner;

    const board = document.createElement('div');
    board.className = 'rv-board';
    board.style.setProperty('--n', state.n);

    for (let i = 0; i < state.n * state.n; i++) {
      const cell = document.createElement('div');
      cell.className = 'rv-cell';
      const owner = state.board[i];
      if (owner) {
        const disc = document.createElement('div');
        disc.className = 'rv-disc ' + (owner === 1 ? 'p1' : 'p2');
        if (state.flipped && state.flipped.includes(i)) disc.classList.add('flip');
        if (i === state.lastMove) disc.classList.add('last');
        cell.appendChild(disc);
      } else if (myTurn && state.legal.includes(i)) {
        cell.classList.add('legal');
        cell.addEventListener('click', () => ctx.onMove({ cell: i }));
      }
      board.appendChild(cell);
    }
    wrap.appendChild(board);
  }

  function statusText(state, seat, mode) {
    const meDisc = seat === 1 ? '⚫' : '⚪';
    const oppDisc = seat === 1 ? '⚪' : '⚫';
    const score = `${meDisc} ${state.counts[seat]} · ${oppDisc} ${state.counts[seat === 1 ? 2 : 1]}`;
    if (state.winner === 'draw') return `${score}  •  Draw!`;
    if (state.winner) {
      return `${score}  •  ` + (state.winner === seat ? 'You win! 🎉'
        : (mode === 'pve' ? 'Computer wins.' : 'Opponent wins.'));
    }
    let turnTxt;
    if (state.turn === seat) turnTxt = state.legal.length ? 'Your turn' : 'No moves — passing…';
    else turnTxt = (mode === 'pve' ? 'Computer thinking…' : "Opponent's turn");
    return `${score}  •  ${turnTxt}`;
  }

  function endText(state, seat, mode) {
    if (state.winner === 'draw') return { title: 'Draw', text: 'An even split of the board.' };
    const won = state.winner === seat;
    const my = state.counts[seat], op = state.counts[seat === 1 ? 2 : 1];
    return {
      title: won ? 'Victory 🎉' : 'Defeat',
      text: `Final discs — you ${my}, ${mode === 'pve' ? 'computer' : 'opponent'} ${op}.`,
    };
  }

  window.ReversiUI = { render, statusText, endText };
})();
