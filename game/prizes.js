// game/prizes.js — the points economy.
//
// Every mini-game has its own fixed prize pool. Winning an ONLINE (human)
// match pays substantially more than playing offline against the computer or
// alone, so the overall leaderboard rewards real competition.

const PRIZES = {
  // solo / offline
  g2048: { title: '2048', offline: 20, online: 60, solo: true },
  memory: { title: 'Memory Match', offline: 20, online: 60, solo: true },

  // two-player
  barricade: { title: 'Barricade', offline: 45, online: 140 },
  ttt: { title: 'Infinite Tic Tac Toe', offline: 35, online: 110 },
  connect4: { title: 'Connect 4', offline: 45, online: 140 },
  reversi: { title: 'Reversi', offline: 45, online: 140 },

  // party games (3+)
  island: { title: 'Island', offline: 60, online: 220, maxPlayers: 10 },
  trivia: { title: 'Trivia Royale', offline: 55, online: 190, maxPlayers: 12 },
  wordbomb: { title: 'Word Bomb', offline: 55, online: 200, maxPlayers: 8 },
  inkrush: { title: 'Ink Rush', offline: 55, online: 190, maxPlayers: 8 },
};

// Minimum humans needed for a matchmade (online) game.
const MIN_HUMANS = {
  barricade: 2, ttt: 2, connect4: 2, reversi: 2,
  island: 3, trivia: 3, wordbomb: 3, inkrush: 3,
};

function isGame(game) { return Object.prototype.hasOwnProperty.call(PRIZES, game); }

function modeKind(mode) {
  // 'pve' and solo are offline; pvp / mm / bots-filled rooms count as online
  return mode === 'pve' ? 'offline' : 'online';
}

// How much of the pool a finishing place receives.
function placeFactor(place, playerCount) {
  if (place === 1) return 1;
  if (playerCount <= 2) return 0.15; // small consolation for the runner-up
  if (place === 2) return 0.4;
  if (place === 3) return 0.2;
  return 0;
}

// Points for one finish. Returns 0 for non-scoring finishes / unknown games.
function awardFor(game, mode, place, playerCount = 2) {
  const p = PRIZES[game];
  if (!p) return 0;
  const kind = modeKind(mode);
  const pool = kind === 'online' ? p.online : p.offline;
  const pts = Math.round(pool * placeFactor(place, playerCount));
  return Math.max(0, pts);
}

// Solo completion award (fixed, offline pool).
function soloAward(game) {
  const p = PRIZES[game];
  return p ? p.offline : 0;
}

module.exports = { PRIZES, MIN_HUMANS, isGame, modeKind, placeFactor, awardFor, soloAward };
