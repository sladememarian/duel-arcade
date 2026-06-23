// game/quoridorAI.js
// A pragmatic Barricade AI.
//  - Computes its own shortest path and the opponent's shortest path.
//  - If it is meaningfully "behind" (opponent closer to goal) and has walls,
//    it tries the wall that maximally lengthens the opponent's path while
//    keeping its own path short and never illegally blocking.
//  - Otherwise it steps along its own shortest path toward goal.
//  - Difficulty: 'easy' moves greedily, 'hard' uses walls more aggressively.

function chooseQuoridorMove(game, player, difficulty = 'hard') {
  const opp = player === 1 ? 2 : 1;

  // Pick the legal pawn move (incl. jumps) that minimizes our distance to goal.
  // Evaluating actual legalMoves guarantees the returned action is always legal.
  function bestPawnMove(state) {
    const moves = state.legalMoves(player);
    if (!moves.length) return null;
    const me = state.players[player];
    const origR = me.row, origC = me.col;
    let best = null, bestDist = Infinity;
    for (const [r, c] of moves) {
      me.row = r; me.col = c;
      const d = state.shortestPath(player);
      me.row = origR; me.col = origC;
      if (d < bestDist || (d === bestDist && Math.random() < 0.5)) {
        bestDist = d; best = { row: r, col: c };
      }
    }
    return best;
  }

  const myDist = game.shortestPath(player);
  const oppDist = game.shortestPath(opp);
  const haveWalls = game.players[player].walls > 0;

  // Decide whether to consider walls.
  const wallChance = difficulty === 'easy' ? 0.15 : 0.6;
  const behind = oppDist < myDist; // opponent is closer to their goal

  if (haveWalls && behind && Math.random() < wallChance) {
    let best = null, bestGain = 0;
    const myBaseline = game.shortestPath(player);
    for (const orient of ['h', 'v']) {
      const set = orient === 'h' ? game.hWalls : game.vWalls;
      for (let r = 0; r < game.size - 1; r++) {
        for (let c = 0; c < game.size - 1; c++) {
          if (!game.isWallLegal(player, orient, r, c)) continue;
          const key = `${r},${c}`;
          set.add(key);
          const newOpp = game.shortestPath(opp);
          const newMe = game.shortestPath(player);
          set.delete(key);
          // gain = how much we slow the opponent, penalized by self-slowdown
          const gain = (newOpp - oppDist) - (newMe - myBaseline);
          if (gain > bestGain) { bestGain = gain; best = { orient, r, c }; }
        }
      }
    }
    if (best && bestGain > 0) {
      return { kind: 'wall', orient: best.orient, r: best.r, c: best.c };
    }
  }

  // Otherwise advance the pawn.
  const step = bestPawnMove(game);
  if (step) return { kind: 'move', row: step.row, col: step.col };

  // Fallback: any legal move.
  const moves = game.legalMoves(player);
  if (moves.length) return { kind: 'move', row: moves[0][0], col: moves[0][1] };
  return null;
}

module.exports = { chooseQuoridorMove };
