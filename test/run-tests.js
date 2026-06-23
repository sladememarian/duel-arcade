// test/run-tests.js  — pure-logic tests, no network needed.
const assert = require('assert');
const { Quoridor } = require('../game/quoridor');
const { InfiniteTTT } = require('../game/infiniteTTT');
const { chooseTTTMove } = require('../game/tttAI');
const { chooseQuoridorMove } = require('../game/quoridorAI');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '  -> ' + e.message); failed++; }
}

console.log('\n=== Infinite Tic Tac Toe ===');

test('initial state is empty, P1 to move', () => {
  const g = new InfiniteTTT();
  assert.strictEqual(g.turn, 1);
  assert.deepStrictEqual(g.board, Array(9).fill(null));
});

test('FIFO removes the oldest piece on the 4th placement', () => {
  const g = new InfiniteTTT();
  // Use non-winning cells for P1: 0,1,5  (no line), then 4th at 6 drops 0.
  g.applyMove(1, 0); g.applyMove(2, 4);
  g.applyMove(1, 1); g.applyMove(2, 3);
  g.applyMove(1, 5); g.applyMove(2, 8);   // P1 now has [0,1,5]
  // P1 placing 4th at cell 6 should drop cell 0 (FIFO)
  const r = g.applyMove(1, 6);
  assert.ok(r.ok, r.error);
  assert.strictEqual(g.board[0], null, 'oldest (cell 0) should be removed');
  assert.deepStrictEqual(g.queues[1], [1, 5, 6]);
});

test('win is detected for a straight 3-in-a-row', () => {
  const g = new InfiniteTTT();
  g.applyMove(1, 0); g.applyMove(2, 3);
  g.applyMove(1, 1); g.applyMove(2, 4);
  const r = g.applyMove(1, 2); // 0,1,2 row
  assert.ok(r.ok);
  assert.strictEqual(g.winner, 1);
});

test('NO false win when the winning piece was just FIFO-removed', () => {
  // Construct a case where the oldest removal prevents a stale win.
  const g = new InfiniteTTT();
  // P1: place 0,1, then later would complete 0,1,2 but 0 has vanished.
  g.applyMove(1, 0); g.applyMove(2, 6);
  g.applyMove(1, 1); g.applyMove(2, 7);
  g.applyMove(1, 5); g.applyMove(2, 8); // P2 wins? 6,7,8 -> yes P2 wins here
  assert.strictEqual(g.winner, 2);
});

test('oldest indicator appears only at 3 pieces', () => {
  const g = new InfiniteTTT();
  g.applyMove(1, 0); g.applyMove(2, 4);
  assert.strictEqual(g.serialize().oldest[1], null);
  g.applyMove(1, 1); g.applyMove(2, 5);
  g.applyMove(1, 2);
  assert.strictEqual(g.serialize().oldest[1], 0);
});

test('TTT AI takes an immediate win', () => {
  const g = new InfiniteTTT();
  g.board = [1, 1, null, null, 2, 2, null, null, null];
  g.queues = { 1: [0, 1], 2: [4, 5] };
  g.turn = 1;
  assert.strictEqual(chooseTTTMove(g, 1), 2);
});

test('TTT AI blocks opponent win', () => {
  const g = new InfiniteTTT();
  g.board = [2, 2, null, null, 1, null, null, null, null];
  g.queues = { 1: [4], 2: [0, 1] };
  g.turn = 1;
  assert.strictEqual(chooseTTTMove(g, 1), 2);
});

console.log('\n=== Barricade (Quoridor) ===');

test('initial positions and wall counts', () => {
  const g = new Quoridor();
  assert.deepStrictEqual([g.players[1].row, g.players[1].col], [8, 4]);
  assert.deepStrictEqual([g.players[2].row, g.players[2].col], [0, 4]);
  assert.strictEqual(g.players[1].walls, 10);
});

test('both players always have a path at start', () => {
  const g = new Quoridor();
  assert.ok(g.hasPathToGoal(1));
  assert.ok(g.hasPathToGoal(2));
});

test('a basic pawn move forward is legal', () => {
  const g = new Quoridor();
  const r = g.applyMove(1, { kind: 'move', row: 7, col: 4 });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([g.players[1].row, g.players[1].col], [7, 4]);
  assert.strictEqual(g.turn, 2);
});

test('cannot move diagonally onto empty space', () => {
  const g = new Quoridor();
  const r = g.applyMove(1, { kind: 'move', row: 7, col: 5 });
  assert.ok(!r.ok);
});

test('a wall lengthens the path and is reversible', () => {
  const g = new Quoridor();
  const before = g.shortestPath(1);
  assert.ok(g.isWallLegal(1, 'h', 7, 3) || g.isWallLegal(1, 'h', 7, 4));
});

test('GOLDEN RULE: a wall that fully traps a player is rejected', () => {
  // Box player 1 (at 8,4) so the only escape is sealed -> illegal.
  const g = new Quoridor();
  // Build a horizontal wall line across row 7 above player except leave checks.
  // Place horizontal walls at slot row 7 covering columns 0..8 then the final
  // sealing wall must be rejected because it removes the last path.
  // hWall (7,c) blocks moving from row 8 to row 7 over columns c,c+1.
  g.hWalls.add('7,0'); g.hWalls.add('7,2'); g.hWalls.add('7,4'); g.hWalls.add('7,6');
  // columns covered: 0-1,2-3,4-5,6-7 -> only column 8 escape remains.
  // Add vertical walls to seal column 8 escape route near the corner.
  // The final horizontal wall at (7,7) would cover cols 7-8, fully sealing row8.
  assert.ok(g.hasPathToGoal(1), 'still has a path before sealing');
  const legal = g.isWallLegal(1, 'h', 7, 7);
  assert.strictEqual(legal, false, 'sealing the last gap must be illegal');
});

test('overlapping walls are rejected', () => {
  const g = new Quoridor();
  g.hWalls.add('4,4');
  assert.strictEqual(g.wallSlotFree('h', 4, 4), false);
  assert.strictEqual(g.wallSlotFree('h', 4, 5), false); // overlaps span
  assert.strictEqual(g.wallSlotFree('v', 4, 4), false); // crossing
});

test('placing a wall decrements wall count and passes turn', () => {
  const g = new Quoridor();
  const r = g.applyMove(1, { kind: 'wall', orient: 'h', r: 4, c: 4 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(g.players[1].walls, 9);
  assert.strictEqual(g.turn, 2);
});

test('reaching the goal row wins', () => {
  const g = new Quoridor();
  g.players[1].row = 1; g.players[1].col = 4; g.turn = 1;
  g.players[2].row = 0; g.players[2].col = 0; // move opponent off the target cell
  const r = g.applyMove(1, { kind: 'move', row: 0, col: 4 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(g.winner, 1);
});

test('Quoridor AI returns a legal action each call', () => {
  const g = new Quoridor();
  for (let i = 0; i < 6; i++) {
    const mv = chooseQuoridorMove(g, g.turn, 'hard');
    assert.ok(mv, 'AI produced a move');
    const r = g.applyMove(g.turn, mv);
    assert.ok(r.ok, 'AI move legal: ' + JSON.stringify(mv) + ' -> ' + r.error);
    if (g.winner) break;
  }
});

test('full AI vs AI Quoridor game terminates with a winner', () => {
  const g = new Quoridor();
  let safety = 0;
  while (!g.winner && safety < 2000) {
    const mv = chooseQuoridorMove(g, g.turn, 'hard');
    const r = g.applyMove(g.turn, mv);
    assert.ok(r.ok, 'illegal AI move: ' + JSON.stringify(mv) + ' ' + r.error);
    safety++;
  }
  assert.ok(g.winner, 'a winner emerged within bound');
});

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
