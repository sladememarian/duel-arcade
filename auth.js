// auth.js — password hashing, session tokens, validation and rate limiting.
// Uses only Node's built-in crypto (scrypt + SHA-256), so there are no native
// build steps and nothing extra to audit.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function validateUsername(username) {
  const u = String(username || '').trim();
  if (!USERNAME_RE.test(u)) {
    return { ok: false, error: 'Username must be 3–16 characters: letters, numbers or underscores.' };
  }
  return { ok: true, value: u };
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < PASSWORD_MIN) return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (p.length > PASSWORD_MAX) return { ok: false, error: `Password must be at most ${PASSWORD_MAX} characters.` };
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return { ok: false, error: 'Password must include at least one letter and one number.' };
  }
  return { ok: true, value: p };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, SCRYPT);
  return { salt, hash: derived.toString('hex') };
}

async function verifyPassword(password, salt, expectedHex) {
  try {
    const derived = await scrypt(password, salt, 64, SCRYPT);
    const expected = Buffer.from(expectedHex, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Session tokens are stored only as a keyed hash. SESSION_SECRET (when set)
// means a stolen database alone cannot be used to forge a valid token.
const TOKEN_SECRET = process.env.SESSION_SECRET || '';

function hashToken(token) {
  if (TOKEN_SECRET) {
    return crypto.createHmac('sha256', TOKEN_SECRET).update(String(token)).digest('hex');
  }
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ---- cookie helpers ----
const COOKIE_NAME = 'arcade_sid';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (opts.maxAge != null) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) bits.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.secure) bits.push('Secure');
  return bits.join('; ');
}

function sessionExpiry(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ---- rate limiter (per-process, per-key sliding window) ----
class RateLimiter {
  constructor({ windowMs, max, name }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name || 'limiter';
    this.hits = new Map();
    const timer = setInterval(() => this.sweep(), Math.min(windowMs, 60000));
    if (timer.unref) timer.unref();
  }
  hit(key) {
    const now = Date.now();
    const k = String(key);
    let arr = this.hits.get(k);
    if (!arr) { arr = []; this.hits.set(k, arr); }
    while (arr.length && arr[0] <= now - this.windowMs) arr.shift();
    if (arr.length >= this.max) {
      return { allowed: false, retryAfter: Math.ceil((arr[0] + this.windowMs - now) / 1000) };
    }
    arr.push(now);
    return { allowed: true, remaining: this.max - arr.length };
  }
  sweep() {
    const cutoff = Date.now() - this.windowMs;
    for (const [k, arr] of this.hits) {
      if (!arr.length || arr[arr.length - 1] <= cutoff) this.hits.delete(k);
    }
  }
}

// Per-username failed-login lockout (protects one account from distributed guesses).
class LoginGuard {
  constructor({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.state = new Map();
    const timer = setInterval(() => this.sweep(), 60000);
    if (timer.unref) timer.unref();
  }
  isLocked(key) {
    const s = this.state.get(String(key));
    if (!s) return { locked: false };
    if (s.until && s.until > Date.now()) return { locked: true, retryAfter: Math.ceil((s.until - Date.now()) / 1000) };
    return { locked: false };
  }
  fail(key) {
    const k = String(key);
    const now = Date.now();
    let s = this.state.get(k);
    if (!s || (s.firstAt && now - s.firstAt > this.windowMs)) s = { count: 0, firstAt: now, until: 0 };
    s.count += 1;
    if (s.count >= this.max) { s.until = now + this.windowMs; s.count = 0; s.firstAt = now; }
    this.state.set(k, s);
  }
  succeed(key) { this.state.delete(String(key)); }
  sweep() {
    const now = Date.now();
    for (const [k, s] of this.state) {
      if ((!s.until || s.until < now) && now - s.firstAt > this.windowMs) this.state.delete(k);
    }
  }
}

module.exports = {
  COOKIE_NAME,
  validateUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashToken,
  parseCookies,
  serializeCookie,
  sessionExpiry,
  RateLimiter,
  LoginGuard,
};
