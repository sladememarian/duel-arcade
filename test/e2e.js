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

  } catch (e) {
    console.log('  FATAL ' + e.message); failed++;
  } finally {
    srv.kill('SIGKILL');
    console.log(`\n=== E2E RESULT: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed ? 1 : 0);
  }
}
main();
