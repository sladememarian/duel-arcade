// test/e2e.js — boots the real server and drives it with socket.io clients.
const http = require('http');
const { io } = require('socket.io-client');
const { spawn } = require('child_process');

const PORT = 3210;
let passed = 0, failed = 0;
const log = (ok, name, extra='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${name} ${extra}`); ok?passed++:failed++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function connect() {
  return io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true });
}
function once(sock, ev) {
  return new Promise((res) => sock.once(ev, res));
}

async function main() {
  const srv = spawn('node', ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT } });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await wait(900); // let it boot

  try {
    // ---------- PvP Infinite TTT ----------
    const host = connect(), guest = connect();
    host.emit('createPvP', { game: 'ttt' });
    const hj = await once(host, 'joined');
    log(hj.seat === 1 && hj.mode === 'pvp', 'PvP host gets seat 1');

    guest.emit('joinPvP', { code: hj.code });
    const gj = await once(guest, 'joined');
    log(gj.seat === 2, 'PvP guest gets seat 2');

    // both should get a state after join
    const st = await once(guest, 'state');
    log(st.state.type === 'ttt' && st.state.turn === 1, 'initial TTT state, P1 to move');

    // P1 plays cell 0
    host.emit('move', { cell: 0 });
    let s = (await once(guest, 'state')).state;
    log(s.board[0] === 1 && s.turn === 2, 'host move applied, turn passes to guest');

    // out-of-turn move rejected
    host.emit('move', { cell: 1 });
    const err = await once(host, 'errorMsg');
    log(/turn/i.test(err), 'out-of-turn move rejected', '("'+err+'")');

    host.disconnect(); guest.disconnect();
    await wait(150);

    // ---------- PvE Barricade: AI must respond ----------
    const solo = connect();
    solo.emit('createPvE', { game: 'barricade', difficulty: 'hard' });
    const sj = await once(solo, 'joined');
    log(sj.mode === 'pve' && sj.seat === 1, 'PvE solo seat 1 vs AI');
    await once(solo, 'state'); // initial
    // human moves pawn forward (P1 at 8,4 -> 7,4)
    solo.emit('move', { kind: 'move', row: 7, col: 4 });
    // expect TWO state emits: ours, then the AI's reply
    const after1 = (await once(solo, 'state')).state;
    log(after1.players[1].row === 7, 'PvE human pawn advanced');
    const after2 = (await once(solo, 'state')).state; // AI move
    log(after2.turn === 1, 'PvE AI took its turn, control back to human');
    solo.disconnect();
    await wait(150);

    // ---------- disconnect notifies opponent ----------
    const a = connect(), b = connect();
    a.emit('createPvP', { game: 'ttt' });
    const aj = await once(a, 'joined');
    b.emit('joinPvP', { code: aj.code });
    await once(b, 'joined');
    const leftP = once(b, 'opponentLeft');
    a.disconnect();
    const left = await Promise.race([leftP, wait(1500).then(() => null)]);
    log(left !== null, 'remaining player notified when opponent leaves');
    b.disconnect();

    // ---------- bad room code ----------
    const c = connect();
    c.emit('joinPvP', { code: 'ZZZZ' });
    const e2 = await once(c, 'errorMsg');
    log(/not found/i.test(e2), 'joining unknown room returns error');
    c.disconnect();

    // ---------- ISLAND: full game flow ----------
    await runIsland();

  } catch (e) {
    console.log('  FATAL ' + e.message); failed++;
  } finally {
    srv.kill('SIGKILL');
    console.log(`\n=== E2E RESULT: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed ? 1 : 0);
  }
}

// Track every islandState so we never miss one to a listener race.
function track(sock) { sock._last = null; sock.on('islandState', (m) => { sock._last = m.state; }); }
// Resolve as soon as `sock`'s state matches `pred` (checks the latest seen first).
function waitState(sock, pred, timeout = 9000) {
  return new Promise((res, rej) => {
    if (sock._last && pred(sock._last)) return res(sock._last);
    const to = setTimeout(() => { sock.off('islandState', h); rej(new Error('timeout waiting for state')); }, timeout);
    function h(m) { if (pred(m.state)) { clearTimeout(to); sock.off('islandState', h); res(m.state); } }
    sock.on('islandState', h);
  });
}

async function runIsland() {
  // --- lobby + bots ---
  const solo = connect();
  track(solo);
  solo.emit('createIsland', { name: 'Solo' });
  const sj = await once(solo, 'islandJoined');
  log(!!sj.code && sj.youId === solo.id, 'island room created, host id assigned');
  solo.emit('islandAddBot');
  solo.emit('islandAddBot');
  const lob = await waitState(solo, (s) => s.players.length === 3);
  log(lob.players.filter((p) => p.isBot).length === 2, 'host can add bots to lobby');
  log(lob.isHost === true, 'creator is host');
  solo.disconnect();
  await wait(150);

  // --- full 3-human game (deterministic via early resolution) ---
  const g1 = connect(), g2 = connect(), g3 = connect();
  track(g1); track(g2); track(g3);
  g1.emit('createIsland', { name: 'G1' });
  const j1 = await once(g1, 'islandJoined');
  const id1 = j1.youId, gcode = j1.code;
  g2.emit('joinIsland', { code: gcode, name: 'G2' });
  const id2 = (await once(g2, 'islandJoined')).youId;
  g3.emit('joinIsland', { code: gcode, name: 'G3' });
  const id3 = (await once(g3, 'islandJoined')).youId;

  await waitState(g1, (s) => s.players.length === 3 && s.phase === 'lobby');
  log(true, 'three humans gathered in lobby');

  g1.emit('islandStart');
  await waitState(g1, (s) => s.phase === 'discussion');
  await waitState(g3, (s) => s.phase === 'discussion');
  log(true, 'host started game → discussion phase');

  // whisper privacy: g1 -> g2, g3 must not receive
  let g3Leaked = false;
  g3.on('islandWhisper', () => { g3Leaked = true; });
  const g2recv = once(g2, 'islandWhisper');
  g1.emit('islandWhisper', { to: id2, message: 'meet me at dawn' });
  const w = await Promise.race([g2recv, wait(1500).then(() => null)]);
  log(w && w.message === 'meet me at dawn', 'whisper delivered to its target');
  await wait(300);
  log(g3Leaked === false, 'whisper not leaked to third party');

  // host ends whispers early
  g1.emit('islandSkip');
  await waitState(g1, (s) => s.phase === 'voting');
  log(true, 'host skip advanced to voting');

  // votes: g1->g3, g2->g3, g3->g1  => g3 eliminated (2 vs 1)
  const revealP = waitState(g1, (s) => s.phase === 'reveal');
  g1.emit('islandVote', { target: id3 });
  g2.emit('islandVote', { target: id3 });
  g3.emit('islandVote', { target: id1 });
  const reveal = await revealP;
  log(reveal.lastResult && reveal.lastResult.eliminatedId === id3, 'majority vote eliminated G3');

  // reveal → ghostVote (2 alive: g1,g2; ghost: g3)
  await waitState(g1, (s) => s.phase === 'ghostVote');
  log(true, 'with 2 alive, advanced to ghost vote');

  // ghost g3 votes to kill g1 → g2 wins
  const endP = waitState(g2, (s) => s.phase === 'ended');
  g3.emit('islandGhostVote', { target: id1 });
  const ended = await endP;
  log(ended.winnerId === id2, 'ghost vote decided final survivor (G2 wins)');

  g1.disconnect(); g2.disconnect(); g3.disconnect();
  await wait(150);
}

main();
