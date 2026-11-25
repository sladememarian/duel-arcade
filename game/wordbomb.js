// game/wordbomb.js — "Word Bomb" (3+ players).
//
// Each round reveals a two-letter bigram. Every player has a short window to
// submit one distinct English word that contains it. Correct words score by
// speed; the highest total after N rounds wins.
//
// Pure logic. The server owns timers, sockets and bots.

const { WORD_SET, FAIR_BIGRAMS, wordsWith } = require('./wordlist');

const DURATIONS = { round: 14, reveal: 5 };
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const BASE = 100;
const SPEED_BONUS = 100;

class WordBomb {
  constructor(opts = {}) {
    this.players = [];
    this.phase = 'lobby';
    this.hostId = null;
    this.round = 0;
    this.totalRounds = clampRounds(opts.rounds);
    this.bigram = null;
    this.roundStart = 0;
    this.usedBigrams = new Set();
    this.usedWords = new Set();
    this.lastReveal = null;
    this.history = [];
  }

  player(id) { return this.players.find((p) => p.id === id) || null; }
  humans() { return this.players.filter((p) => !p.isBot && p.connected); }

  addPlayer(id, name, opts = {}) {
    if (this.phase !== 'lobby') return null;
    if (this.player(id)) return this.player(id);
    if (this.players.length >= MAX_PLAYERS) return null;
    const clean = String(name || '').trim().slice(0, 16) || `Player ${this.players.length + 1}`;
    const p = {
      id, name: clean, score: 0, isBot: !!opts.isBot, connected: true,
      word: null, submitAt: null, gain: 0, valid: null,
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

  pickBigram() {
    const available = FAIR_BIGRAMS.filter((bg) => !this.usedBigrams.has(bg));
    const pool = available.length ? available : FAIR_BIGRAMS;
    const bg = pool[Math.floor(Math.random() * pool.length)];
    this.usedBigrams.add(bg);
    return bg;
  }

  nextRound() {
    this.round += 1;
    this.phase = 'round';
    this.bigram = this.pickBigram();
    this.roundStart = Date.now();
    this.lastReveal = null;
    for (const p of this.players) {
      p.word = null; p.submitAt = null; p.gain = 0; p.valid = null;
    }
  }

  // Returns { ok } or { ok:false, error }. Invalid words cost nothing but the
  // player may try again until the round ends (one accepted word per round).
  submit(id, rawWord, nowMs) {
    if (this.phase !== 'round') return { ok: false, error: 'Not taking words right now.' };
    const p = this.player(id);
    if (!p || !p.connected) return { ok: false, error: 'Unknown player.' };
    if (p.word !== null) return { ok: false, error: 'Already submitted.' };
    const word = String(rawWord || '').toLowerCase().replace(/[^a-z]/g, '');
    if (word.length < 3 || word.length > 12) return { ok: false, error: 'Word must be 3–12 letters.' };
    if (!word.includes(this.bigram)) return { ok: false, error: `Word must contain "${this.bigram.toUpperCase()}".` };
    if (!WORD_SET.has(word)) return { ok: false, error: 'That word is not in the dictionary.' };
    if (this.usedWords.has(word)) return { ok: false, error: 'That word was already played.' };
    p.word = word;
    p.submitAt = (nowMs || Date.now()) - this.roundStart;
    this.usedWords.add(word);
    return { ok: true };
  }

  allAnswered() {
    return this.players.every((p) => !p.connected || p.word !== null);
  }

  botSubmit(id) {
    const p = this.player(id);
    if (!p || !p.isBot || p.word !== null || this.phase !== 'round') return;
    const options = wordsWith(this.bigram).filter((w) => !this.usedWords.has(w));
    if (!options.length) return;
    const word = options[Math.floor(Math.random() * options.length)];
    this.submit(id, word, Date.now());
  }

  // Score the round. A word is worth BASE plus a speed bonus, softened by how
  // late it arrived.
  reveal() {
    const windowMs = DURATIONS.round * 1000;
    const results = [];
    for (const p of this.players) {
      const valid = p.word !== null;
      let gain = 0;
      if (valid) {
        const t = Math.min(p.submitAt ?? windowMs, windowMs);
        const speed = Math.max(0, 1 - t / windowMs);
        gain = Math.round(BASE + SPEED_BONUS * speed);
      }
      p.valid = valid;
      p.gain = gain;
      p.score += gain;
      results.push({ id: p.id, name: p.name, word: p.word, valid, gain, total: p.score });
    }
    this.phase = 'reveal';
    this.lastReveal = { bigram: this.bigram, results };
    this.history.push({ bigram: this.bigram, results });
    return results;
  }

  isLastRound() { return this.round >= this.totalRounds; }

  advanceAfterReveal() {
    if (this.isLastRound()) { this.phase = 'final'; return 'final'; }
    this.nextRound();
    return 'round';
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
      type: 'wordbomb',
      phase: this.phase,
      youId: forId,
      isHost: this.hostId === forId,
      round: this.round,
      totalRounds: this.totalRounds,
      bigram: this.bigram,
      youSubmitted: me ? me.word !== null : false,
      yourWord: me ? (show ? me.word : (me.word ? '•••' : null)) : null,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, score: p.score, isBot: p.isBot,
        connected: p.connected, isHost: this.hostId === p.id, isMe: p.id === forId,
        answered: this.phase === 'round' ? p.word !== null : false,
        word: show ? p.word : null,
        valid: show ? p.valid : null,
        gain: show ? p.gain : 0,
      })),
      reveal: show ? this.lastReveal : null,
      standings: this.standings(),
      answeredCount: this.players.filter((p) => p.connected && p.word !== null).length,
      connectedCount: this.players.filter((p) => p.connected).length,
      winner: this.phase === 'final' ? (this.standings()[0] || null) : null,
    };
  }
}

function clampRounds(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n)) return 5;
  return Math.max(3, Math.min(10, n));
}

module.exports = { WordBomb, DURATIONS, MIN_PLAYERS, MAX_PLAYERS };
