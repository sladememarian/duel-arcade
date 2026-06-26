// game/island.js
// "Island" — a social-deduction party game (3+ players).
//
// Flow:
//   lobby      -> host gathers players, then starts
//   discussion -> players privately WHISPER each other (1:1 chats) to scheme
//   voting     -> everyone anonymously votes someone out
//   reveal     -> the tally is shown; highest votes is eliminated.
//                 a TIE means nobody dies (the night is skipped).
//   ...repeat discussion/voting until only 2 players remain alive...
//   ghostVote  -> the dead (ghosts) vote on which of the last 2 dies.
//   ended      -> the survivor wins.
//
// This file is PURE LOGIC — no sockets, no timers. The server owns the clock
// and the networking; it drives this engine and broadcasts serialize().

// Phase durations (seconds). The server reads these to set its timers.
const DURATIONS = {
  discussion: 90,
  voting: 35,
  reveal: 6,
  ghostVote: 35,
};

const MIN_PLAYERS = 3;

class Island {
  constructor() {
    this.players = [];          // { id, name, alive, ghost, hasVoted, votedFor, connected, isBot }
    this.phase = 'lobby';       // lobby|discussion|voting|reveal|ghostVote|ended
    this.night = 0;
    this.hostId = null;
    this.lastResult = null;     // { eliminatedId, eliminatedName, tie, voteCount }
    this.winnerId = null;
  }

  // ---------- player management ----------
  player(id) { return this.players.find((p) => p.id === id) || null; }
  alivePlayers() { return this.players.filter((p) => p.alive); }
  ghostPlayers() { return this.players.filter((p) => p.ghost); }
  aliveCount() { return this.alivePlayers().length; }

  addPlayer(id, name, opts = {}) {
    if (this.phase !== 'lobby') return null;      // can only join before start
    if (this.player(id)) return this.player(id);  // idempotent
    const clean = String(name || '').trim().slice(0, 16) || `Player ${this.players.length + 1}`;
    const p = {
      id, name: clean,
      alive: true, ghost: false,
      hasVoted: false, votedFor: null,
      connected: true, isBot: !!opts.isBot,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    return p;
  }

  // In the lobby a player is fully removed. Mid-game they're only marked
  // disconnected (their seat lives on so the game stays balanced).
  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.players = this.players.filter((x) => x.id !== id);
    } else {
      p.connected = false;
    }
    if (this.hostId === id) this.reassignHost();
  }

  reassignHost() {
    const next = this.players.find((p) => p.connected && !p.isBot)
      || this.players.find((p) => p.connected)
      || this.players[0] || null;
    this.hostId = next ? next.id : null;
  }

  // ---------- lifecycle ----------
  canStart() { return this.phase === 'lobby' && this.players.length >= MIN_PLAYERS; }

  start() {
    if (!this.canStart()) return { ok: false, error: `Need at least ${MIN_PLAYERS} players.` };
    this.night = 1;
    this.beginDiscussion();
    return { ok: true };
  }

  beginDiscussion() {
    this.phase = 'discussion';
    this.lastResult = null;
    this.clearVotes();
  }

  beginVoting() {
    this.phase = 'voting';
    this.clearVotes();
  }

  clearVotes() {
    for (const p of this.players) { p.hasVoted = false; p.votedFor = null; }
  }

  // ---------- voting ----------
  vote(id, targetId) {
    if (this.phase !== 'voting') return { ok: false, error: 'Not voting time.' };
    const p = this.player(id);
    const t = this.player(targetId);
    if (!p || !p.alive) return { ok: false, error: 'You cannot vote.' };
    if (!t || !t.alive) return { ok: false, error: 'Invalid target.' };
    if (t.id === p.id) return { ok: false, error: 'You cannot vote yourself.' };
    p.hasVoted = true;
    p.votedFor = targetId;
    return { ok: true };
  }

  allAliveVoted() { return this.alivePlayers().every((p) => p.hasVoted || !p.connected); }

  // Tally the night's votes. Highest count is eliminated; a tie (or no votes)
  // skips the night. Returns the result and stores it on lastResult.
  tally() {
    const counts = {};
    for (const p of this.alivePlayers()) {
      if (p.hasVoted && p.votedFor) counts[p.votedFor] = (counts[p.votedFor] || 0) + 1;
    }
    const { topId, tie } = topOf(counts);

    let result;
    if (!topId || tie) {
      result = { eliminatedId: null, eliminatedName: null, tie: true, voteCount: counts };
    } else {
      const victim = this.player(topId);
      victim.alive = false;
      victim.ghost = true;
      result = { eliminatedId: victim.id, eliminatedName: victim.name, tie: false, voteCount: counts };
    }
    this.lastResult = result;
    this.phase = 'reveal';
    return result;
  }

  // After the reveal we either continue to another night or go to ghost vote.
  isEndgame() { return this.aliveCount() <= 2; }

  advanceAfterReveal() {
    if (this.isEndgame()) {
      this.phase = 'ghostVote';
      this.clearVotes();
      return 'ghostVote';
    }
    this.night += 1;
    this.beginDiscussion();
    return 'discussion';
  }

  // ---------- ghost vote (the dead pick who dies last) ----------
  ghostVote(id, targetId) {
    if (this.phase !== 'ghostVote') return { ok: false, error: 'Not ghost-vote time.' };
    const p = this.player(id);
    if (!p || !p.ghost) return { ok: false, error: 'Only ghosts may vote now.' };
    const t = this.player(targetId);
    if (!t || !t.alive) return { ok: false, error: 'Must target a living player.' };
    p.hasVoted = true;
    p.votedFor = targetId;
    return { ok: true };
  }

  allGhostsVoted() { return this.ghostPlayers().every((p) => p.hasVoted || !p.connected); }

  // Resolve the ghost vote: the chosen living player dies, the other wins.
  // On a tie (or no votes) a victim is chosen at random — someone must fall.
  tallyGhost() {
    const alive = this.alivePlayers();
    const counts = {};
    for (const p of this.ghostPlayers()) {
      if (p.hasVoted && p.votedFor) counts[p.votedFor] = (counts[p.votedFor] || 0) + 1;
    }
    const { topId, tie } = topOf(counts);

    let loserId = topId;
    if (!loserId || tie) {
      loserId = alive[Math.floor(Math.random() * alive.length)].id;
    }
    const loser = this.player(loserId);
    loser.alive = false;
    loser.ghost = true;

    const winner = this.alivePlayers()[0] || null;
    this.winnerId = winner ? winner.id : null;
    this.phase = 'ended';
    this.lastResult = {
      eliminatedId: loser.id, eliminatedName: loser.name, tie: false, voteCount: counts,
    };
    return { loserId: loser.id, winnerId: this.winnerId, voteCount: counts };
  }

  // ---------- serialization (per-viewer) ----------
  serialize(forId) {
    const me = this.player(forId);
    const reveal = this.phase === 'reveal' || this.phase === 'ended';
    return {
      type: 'island',
      phase: this.phase,
      night: this.night,
      hostId: this.hostId,
      youId: forId,
      isHost: this.hostId === forId,
      youAlive: me ? me.alive : false,
      youGhost: me ? me.ghost : false,
      youVoted: me ? me.hasVoted : false,
      youVotedFor: me ? me.votedFor : null,
      aliveCount: this.aliveCount(),
      votesNeeded: this.phase === 'ghostVote'
        ? this.ghostPlayers().filter((p) => p.connected).length
        : this.alivePlayers().filter((p) => p.connected).length,
      votesCast: this.players.filter((p) =>
        p.hasVoted && (this.phase === 'ghostVote' ? p.ghost : p.alive)).length,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        ghost: p.ghost,
        connected: p.connected,
        isBot: p.isBot,
        isHost: this.hostId === p.id,
        isMe: p.id === forId,
        // anonymous "has voted" indicator only (never who they voted for)
        hasVoted: (this.phase === 'voting' || this.phase === 'ghostVote') ? p.hasVoted : false,
      })),
      // tally is only exposed once the night is revealed
      lastResult: reveal ? this.lastResult : null,
      winnerId: this.winnerId,
      winnerName: this.winnerId ? (this.player(this.winnerId)?.name || null) : null,
    };
  }
}

// Find the key with the strictly-highest value. Returns { topId, tie }.
// tie=true means the top value is shared by 2+ keys (or there are no votes).
function topOf(counts) {
  let topId = null, max = 0, tie = false;
  for (const [id, c] of Object.entries(counts)) {
    if (c > max) { max = c; topId = id; tie = false; }
    else if (c === max) { tie = true; }
  }
  return { topId: max > 0 ? topId : null, tie: max > 0 ? tie : false };
}

module.exports = { Island, DURATIONS, MIN_PLAYERS };
