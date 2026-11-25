// game/derby.js — "The Derby": a shared horse race where players wager points.
//
// Flow (driven by the server's global clock):
//   betting -> a 45s window to place wagers; odds are pari-mutuel and move live
//   racing  -> one horse is chosen uniformly at random; a live race plays out
//   results -> winning tickets are paid from the whole pool
//
// Polymarket-style logic: a horse more people back has a higher implied
// probability and therefore a smaller payout. A longshot pays much more.
//
// Pure logic. No sockets, no database, no timers.

const HORSES = [
  { id: 'nightfall', name: 'Nightfall', tone: 'ink' },
  { id: 'ember', name: 'Ember', tone: 'red' },
  { id: 'sage', name: 'Sage', tone: 'green' },
  { id: 'gilded', name: 'Gilded', tone: 'gold' },
];

const BET_MIN = 10;
const BET_MAX = 5000;
const BETTING_MS = 45000;
const RACE_MS = 15000;
const RESULTS_MS = 9000;

let raceCounter = 0;

class Derby {
  constructor() {
    this.reset();
  }

  reset() {
    raceCounter += 1;
    this.raceId = `race-${Date.now().toString(36)}-${raceCounter}`;
    this.phase = 'betting'; // betting | racing | results
    this.phaseEndsAt = null;
    this.bets = [];         // { userId, username, horseId, amount }
    this.horses = HORSES.map((h) => ({ ...h, progress: 0, finishMs: 0 }));
    this.winnerId = null;
    this.startedAt = 0;
    this.snapshot = null;   // frozen pools/odds at the moment betting closed
    this.result = null;
  }

  horse(id) { return this.horses.find((h) => h.id === id) || null; }

  pools() {
    const byHorse = {};
    for (const h of HORSES) byHorse[h.id] = 0;
    let total = 0;
    for (const b of this.bets) {
      if (byHorse[b.horseId] == null) continue;
      byHorse[b.horseId] += b.amount;
      total += b.amount;
    }
    return { total, byHorse };
  }

  // Implied probability rises with the money on a horse; payout multiple falls.
  odds() {
    const { total, byHorse } = this.pools();
    const out = {};
    for (const h of HORSES) {
      const pool = byHorse[h.id];
      out[h.id] = {
        pool,
        probability: total > 0 ? pool / total : 0.25,
        multiplier: pool > 0 ? total / pool : null,
      };
    }
    return out;
  }

  placeBet({ userId, username, horseId, amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'Betting is closed.' };
    if (!this.horse(horseId)) return { ok: false, error: 'Unknown horse.' };
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < BET_MIN) return { ok: false, error: `Minimum bet is ${BET_MIN} points.` };
    if (amt > BET_MAX) return { ok: false, error: `Maximum bet is ${BET_MAX} points.` };
    this.bets.push({
      userId: String(userId),
      username: String(username || 'Player').slice(0, 16),
      horseId,
      amount: amt,
    });
    return { ok: true, amount: amt, horseId };
  }

  totalForUser(userId) {
    return this.bets
      .filter((b) => b.userId === String(userId))
      .reduce((sum, b) => sum + b.amount, 0);
  }

  betsForUser(userId) {
    return this.bets
      .filter((b) => b.userId === String(userId))
      .map((b) => ({ horseId: b.horseId, amount: b.amount }));
  }

  // Close betting and launch the race. The winner is uniformly random.
  startRace(now = Date.now(), winnerId = null) {
    const chosen = winnerId && this.horse(winnerId)
      ? winnerId
      : HORSES[Math.floor(Math.random() * HORSES.length)].id;
    this.phase = 'racing';
    this.startedAt = now;
    this.winnerId = chosen;
    this.snapshot = { pools: this.pools(), odds: this.odds() };

    const winnerFinish = RACE_MS * (0.72 + Math.random() * 0.14);
    let offset = 0;
    this.horses = this.horses.map((h) => {
      let finish = winnerFinish;
      if (h.id !== chosen) {
        offset += 500 + Math.random() * 900;
        finish = winnerFinish + offset;
      }
      return { ...h, progress: 0, finishMs: finish };
    });
    return this.winnerId;
  }

  // Advance the animation; returns true once every horse has crossed the line.
  tick(now = Date.now()) {
    const elapsed = Math.max(0, now - this.startedAt);
    let allDone = true;
    for (const h of this.horses) {
      h.progress = Math.min(1, elapsed / h.finishMs);
      if (h.progress < 1) allDone = false;
    }
    return allDone;
  }

  // Pay winning tickets pari-mutuel from the full pool.
  settle() {
    const snap = this.snapshot || { pools: this.pools(), odds: this.odds() };
    const winningPool = snap.pools.byHorse[this.winnerId] || 0;
    const total = snap.pools.total;
    const payouts = [];
    const winners = this.bets.filter((b) => b.horseId === this.winnerId);

    // If nobody backed the winner, refund every stake instead of burning points.
    if (winningPool === 0) {
      for (const b of this.bets) {
        payouts.push({ userId: b.userId, username: b.username, horseId: b.horseId, stake: b.amount, payout: b.amount, refund: true });
      }
    } else {
      for (const b of this.bets) {
        const won = b.horseId === this.winnerId;
        const payout = won ? Math.round((b.amount / winningPool) * total) : 0;
        payouts.push({ userId: b.userId, username: b.username, horseId: b.horseId, stake: b.amount, payout, refund: false });
      }
    }

    this.phase = 'results';
    this.result = {
      winnerId: this.winnerId,
      winnerName: this.horse(this.winnerId) ? this.horse(this.winnerId).name : this.winnerId,
      pools: snap.pools,
      total,
      winningPool,
      payouts,
      refunded: winningPool === 0,
    };
    return this.result;
  }

  serialize(forUserId) {
    const odds = this.phase === 'racing' && this.snapshot
      ? this.snapshot.odds
      : this.odds();
    const pools = this.snapshot && this.phase !== 'betting'
      ? this.snapshot.pools
      : this.pools();
    return {
      type: 'derby',
      raceId: this.raceId,
      phase: this.phase,
      endsAt: this.phaseEndsAt,
      minBet: BET_MIN,
      maxBet: BET_MAX,
      horses: this.horses.map((h) => ({
        id: h.id, name: h.name, tone: h.tone,
        progress: Number(h.progress.toFixed(4)),
        pool: pools.byHorse[h.id] || 0,
        odds: odds[h.id] || null,
      })),
      totalPool: pools.total,
      winnerId: this.phase === 'results' ? this.winnerId : null,
      result: this.phase === 'results' ? {
        winnerId: this.result.winnerId,
        winnerName: this.result.winnerName,
        payouts: this.result.payouts.filter((p) => p.userId === String(forUserId)),
        refunded: this.result.refunded,
      } : null,
      yourBets: this.betsForUser(forUserId),
    };
  }
}

module.exports = {
  Derby, HORSES, BET_MIN, BET_MAX, BETTING_MS, RACE_MS, RESULTS_MS,
};
