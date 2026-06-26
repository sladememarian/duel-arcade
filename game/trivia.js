// game/trivia.js
// "Trivia Royale" — a fast, social multiple-choice quiz race (3+ players, but
// playable from 1 with bots). Everyone answers the same question at once; the
// faster you answer correctly, the more points you earn. Highest total after
// all rounds wins.
//
// Flow:
//   lobby    -> host gathers players (+ optional bots), picks round count
//   question -> a question is shown; players lock in an answer before time runs out
//   reveal   -> correct answer + per-player results + running scoreboard
//   ...repeat for N rounds...
//   final    -> podium, winner highlighted
//
// Pure logic — the server owns timers/networking and calls these methods.

const { QUESTIONS } = require('./triviaQuestions');

const DURATIONS = {
  question: 18,   // seconds to answer
  reveal: 6,      // seconds to view the result
};
const MIN_PLAYERS = 1;     // bots can fill in; 1 human is enough to play
const BASE_POINTS = 500;
const SPEED_BONUS = 500;   // decays linearly to 0 across the answer window

class Trivia {
  constructor(opts = {}) {
    this.players = [];        // { id, name, score, isBot, connected, answer, answerTime, lastGain, streak }
    this.phase = 'lobby';     // lobby|question|reveal|final
    this.hostId = null;
    this.round = 0;
    this.totalRounds = clampRounds(opts.rounds);
    this.questions = [];      // chosen question objects for this match
    this.current = null;      // current question
    this.questionStart = 0;   // ms timestamp the question went live
  }

  player(id) { return this.players.find((p) => p.id === id) || null; }
  humans() { return this.players.filter((p) => !p.isBot && p.connected); }

  addPlayer(id, name, opts = {}) {
    if (this.phase !== 'lobby') return null;
    if (this.player(id)) return this.player(id);
    const clean = String(name || '').trim().slice(0, 16) || `Player ${this.players.length + 1}`;
    const p = {
      id, name: clean, score: 0, isBot: !!opts.isBot, connected: true,
      answer: null, answerTime: null, lastGain: 0, lastCorrect: null, streak: 0,
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

  canStart() { return this.phase === 'lobby' && this.humans().length >= 1 && this.players.length >= 2; }

  // pick the questions and begin. `pick` lets tests inject a deterministic set.
  start(pick) {
    if (!this.canStart()) return { ok: false, error: 'Need at least 2 players (add a bot).' };
    this.questions = pick ? pick.slice(0, this.totalRounds) : pickQuestions(this.totalRounds);
    this.totalRounds = this.questions.length;
    this.round = 0;
    for (const p of this.players) { p.score = 0; p.streak = 0; }
    this.nextQuestion();
    return { ok: true };
  }

  nextQuestion() {
    this.round += 1;
    this.current = this.questions[this.round - 1];
    this.phase = 'question';
    this.questionStart = Date.now();
    for (const p of this.players) { p.answer = null; p.answerTime = null; p.lastGain = 0; p.lastCorrect = null; }
  }

  // Record an answer. choice is an option index. Scoring is deferred to reveal,
  // but we stamp the elapsed time now so faster answers earn more.
  answer(id, choice, nowMs) {
    if (this.phase !== 'question') return { ok: false, error: 'Not answering time.' };
    const p = this.player(id);
    if (!p || !p.connected) return { ok: false, error: 'Unknown player.' };
    if (p.answer !== null) return { ok: false, error: 'Already answered.' };
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.current.options.length) {
      return { ok: false, error: 'Bad choice.' };
    }
    p.answer = choice;
    p.answerTime = (nowMs || Date.now()) - this.questionStart;
    return { ok: true };
  }

  allAnswered() {
    return this.players.every((p) => !p.connected || p.answer !== null);
  }

  // bots answer with a configurable accuracy and a random delay
  botAnswer(id, accuracy = 0.65) {
    const p = this.player(id);
    if (!p || !p.isBot || p.answer !== null || this.phase !== 'question') return;
    const correct = Math.random() < accuracy;
    let choice;
    if (correct) choice = this.current.answer;
    else {
      const wrong = this.current.options.map((_, i) => i).filter((i) => i !== this.current.answer);
      choice = wrong[Math.floor(Math.random() * wrong.length)];
    }
    this.answer(id, choice, Date.now());
  }

  // Score the round and move to reveal. Returns per-player outcome.
  reveal() {
    const windowMs = DURATIONS.question * 1000;
    const results = [];
    for (const p of this.players) {
      const correct = p.answer === this.current.answer;
      let gain = 0;
      if (correct) {
        const t = Math.min(p.answerTime ?? windowMs, windowMs);
        const speed = Math.max(0, 1 - t / windowMs);
        gain = Math.round(BASE_POINTS + SPEED_BONUS * speed);
        p.streak += 1;
        if (p.streak >= 3) gain += 100; // streak bonus
      } else {
        p.streak = 0;
      }
      p.score += gain;
      p.lastGain = gain;
      p.lastCorrect = correct;
      results.push({ id: p.id, name: p.name, correct, gain, total: p.score, choice: p.answer });
    }
    this.phase = 'reveal';
    return results;
  }

  isLastRound() { return this.round >= this.totalRounds; }

  advanceAfterReveal() {
    if (this.isLastRound()) { this.phase = 'final'; return 'final'; }
    this.nextQuestion();
    return 'question';
  }

  standings() {
    return this.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score, isBot: p.isBot, connected: p.connected }))
      .sort((a, b) => b.score - a.score);
  }

  serialize(forId) {
    const me = this.player(forId);
    const showAnswer = this.phase === 'reveal' || this.phase === 'final';
    return {
      type: 'trivia',
      phase: this.phase,
      youId: forId,
      isHost: this.hostId === forId,
      round: this.round,
      totalRounds: this.totalRounds,
      // question text + options always safe to show; correct answer only on reveal
      question: this.current ? {
        text: this.current.text,
        category: this.current.category,
        options: this.current.options,
        answer: showAnswer ? this.current.answer : null,
      } : null,
      youAnswered: me ? me.answer !== null : false,
      yourChoice: me ? me.answer : null,
      // during 'question' we only expose who has locked in (not what), like Kahoot
      players: this.players.map((p) => ({
        id: p.id, name: p.name, score: p.score, isBot: p.isBot,
        connected: p.connected, isHost: this.hostId === p.id, isMe: p.id === forId,
        answered: this.phase === 'question' ? p.answer !== null : false,
        lastGain: showAnswer ? p.lastGain : 0,
        lastCorrect: showAnswer ? p.lastCorrect : null,
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
  return Math.max(3, Math.min(15, n));
}

function pickQuestions(n) {
  // Fisher–Yates shuffle a copy, take n.
  const pool = QUESTIONS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

module.exports = { Trivia, DURATIONS, MIN_PLAYERS, pickQuestions };
