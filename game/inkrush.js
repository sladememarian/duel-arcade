// game/inkrush.js — "Ink Rush" (3+ players), a Stroop-style reaction race.
//
// A colour NAME is printed in a DIFFERENT ink. Players must tap the ink colour,
// not read the word. Faster correct taps score more; wrong taps score nothing.
// A small minimum reaction time is enforced server-side so scripts can't win.

const COLORS = [
  { key: 'red', name: 'Red' },
  { key: 'blue', name: 'Blue' },
  { key: 'green', name: 'Green' },
  { key: 'gold', name: 'Gold' },
];

const DURATIONS = { prompt: 8, reveal: 4 };
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const BASE = 120;
const SPEED_BONUS = 180;
const MIN_REACTION_MS = 300;

class InkRush {
  constructor(opts = {}) {
    this.players = [];
    this.phase = 'lobby';
    this.hostId = null;
    this.round = 0;
    this.totalRounds = clampRounds(opts.rounds);
    this.prompt = null;
    this.roundStart = 0;
    this.lastReveal = null;
  }

  player(id) { return this.players.find((p) => p.id === id) || null; }

  addPlayer(id, name, opts = {}) {
    if (this.phase !== 'lobby') return null;
    if (this.player(id)) return this.player(id);
    if (this.players.length >= MAX_PLAYERS) return null;
    const clean = String(name || '').trim().slice(0, 16) || `Player ${this.players.length + 1}`;
    const p = {
      id, name: clean, score: 0, isBot: !!opts.isBot, connected: true,
      answer: null, answerAt: null, gain: 0, correct: null,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    return p;
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    if (this.phase === 'lobby') this.players = this.players.filter((x) => x.id !== id);
    else p.connected = false;
    if (this.hostId === id) {
      const next = this.players.find((x) => x.connected && !x.isBot) || this.players.find((x) => x.connected);
      this.hostId = next ? next.id : null;
    }
  }

  setRounds(n) { if (this.phase === 'lobby') this.totalRounds = clampRounds(n); }
  canStart() { return this.phase === 'lobby' && this.players.length >= MIN_PLAYERS; }

  start() {
    if (!this.canStart()) return { ok: false, error: `Need at least ${MIN_PLAYERS} players.` };
    this.round = 0;
    for (const p of this.players) p.score = 0;
    this.nextRound();
    return { ok: true };
  }

  nextRound() {
    this.round += 1;
    this.phase = 'prompt';
    this.roundStart = Date.now();
    // Choose which colour NAME is written, and which INK colour it is drawn in.
    const wordColor = Math.floor(Math.random() * COLORS.length);
    let ink = Math.floor(Math.random() * COLORS.length);
    // Mostly mismatched, which is what makes the task hard and fun.
    if (wordColor === ink && Math.random() < 0.8) {
      ink = (ink + 1 + Math.floor(Math.random() * (COLORS.length - 1))) % COLORS.length;
    }
    this.prompt = { wordIndex: wordColor, word: COLORS[wordColor].name, ink };
    this.lastReveal = null;
    for (const p of this.players) {
      p.answer = null; p.answerAt = null; p.gain = 0; p.correct = null;
    }
  }

  answer(id, choice, nowMs) {
    if (this.phase !== 'prompt') return { ok: false, error: 'Not taking answers.' };
    const p = this.player(id);
    if (!p || !p.connected) return { ok: false, error: 'Unknown player.' };
    if (p.answer !== null) return { ok: false, error: 'Already answered.' };
    if (!Number.isInteger(choice) || choice < 0 || choice >= COLORS.length) {
      return { ok: false, error: 'Bad choice.' };
    }
    const elapsed = (nowMs || Date.now()) - this.roundStart;
    if (elapsed < MIN_REACTION_MS) return { ok: false, error: 'Too fast — wait for the ink.' };
    p.answer = choice;
    p.answerAt = elapsed;
    return { ok: true };
  }

  allAnswered() {
    return this.players.every((p) => !p.connected || p.answer !== null);
  }

  botAnswer(id, accuracy = 0.75) {
    const p = this.player(id);
    if (!p || !p.isBot || p.answer !== null || this.phase !== 'prompt') return;
    const correct = Math.random() < accuracy;
    let choice = this.prompt.ink;
    if (!correct) {
      const others = COLORS.map((_, i) => i).filter((i) => i !== this.prompt.ink);
      choice = others[Math.floor(Math.random() * others.length)];
    }
    const elapsed = MIN_REACTION_MS + 250 + Math.random() * (DURATIONS.prompt * 1000 - MIN_REACTION_MS - 250);
    this.answer(id, choice, this.roundStart + Math.min(elapsed, DURATIONS.prompt * 1000 - 50));
  }

  reveal() {
    const windowMs = DURATIONS.prompt * 1000;
    const results = [];
    for (const p of this.players) {
      const correct = p.answer === this.prompt.ink;
      let gain = 0;
      if (correct) {
        const t = Math.min(p.answerAt ?? windowMs, windowMs);
        const speed = Math.max(0, 1 - t / windowMs);
        gain = Math.round(BASE + SPEED_BONUS * speed);
      }
      p.correct = correct;
      p.gain = gain;
      p.score += gain;
      results.push({ id: p.id, name: p.name, correct, gain, total: p.score, answer: p.answer });
    }
    this.phase = 'reveal';
    this.lastReveal = { ink: this.prompt.ink, results };
    return results;
  }

  isLastRound() { return this.round >= this.totalRounds; }

  advanceAfterReveal() {
    if (this.isLastRound()) { this.phase = 'final'; return 'final'; }
    this.nextRound();
    return 'prompt';
  }

  standings() {
    return this.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score, isBot: p.isBot, connected: p.connected }))
      .sort((a, b) => b.score - a.score);
  }

  serialize(forId) {
    const me = this.player(forId);
    const show = this.phase === 'reveal' || this.phase === 'final';
    return {
      type: 'inkrush',
      phase: this.phase,
      youId: forId,
      isHost: this.hostId === forId,
      round: this.round,
      totalRounds: this.totalRounds,
      prompt: this.prompt ? { word: this.prompt.word, ink: this.prompt.ink } : null,
      colors: COLORS,
      youAnswered: me ? me.answer !== null : false,
      yourChoice: me ? me.answer : null,
      reveal: show ? this.lastReveal : null,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, score: p.score, isBot: p.isBot,
        connected: p.connected, isHost: this.hostId === p.id, isMe: p.id === forId,
        answered: this.phase === 'prompt' ? p.answer !== null : false,
        correct: show ? p.correct : null,
        gain: show ? p.gain : 0,
      })),
      standings: this.standings(),
      answeredCount: this.players.filter((p) => p.connected && p.answer !== null).length,
      connectedCount: this.players.filter((p) => p.connected).length,
      winner: this.phase === 'final' ? (this.standings()[0] || null) : null,
    };
  }
}

function clampRounds(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n)) return 7;
  return Math.max(3, Math.min(12, n));
}

module.exports = { InkRush, COLORS, DURATIONS, MIN_PLAYERS, MAX_PLAYERS, MIN_REACTION_MS };
