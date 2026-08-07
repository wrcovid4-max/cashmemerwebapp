/**
 * The lock on the till.
 *
 * Cash Memer is served to your whole Wi-Fi, not just to this computer — that
 * is what makes the phone scanner work. It also means anyone else on that
 * network can reach it: a guest, a neighbour, whoever is in range. Without a
 * password they would get every receipt and every customer's phone number.
 *
 * How it works:
 *   - One passcode for the shop. It is never stored — only a scrypt hash of
 *     it, with a random salt, so the file on disk cannot be read back into a
 *     password even by someone holding the database.
 *   - Signing in mints a random session token, kept in a table, and sets it as
 *     a cookie. Restarting the app does not sign you out, because a till that
 *     logs you out every time you restart it will simply not be locked.
 *   - Wrong guesses are slowed down, so nobody can sit on your Wi-Fi and try
 *     four-digit codes all afternoon.
 *
 * What this does NOT protect against, stated plainly: the app is served over
 * plain http on your LAN, so somebody already on your Wi-Fi and actively
 * capturing traffic could read the session cookie in transit. Locking the app
 * stops the casual case — a stranger who opens the address and looks. For the
 * rest, keep the Wi-Fi password to yourself.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, getSetting, setSetting, nowIso } from './db.js';

/* Cost parameters. High enough to make guessing slow, low enough that signing
   in at the counter feels instant. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** How long a signed-in browser stays signed in. A trading month. */
const SESSION_DAYS = 30;

/** Brute-force slowing. After this many misses, each further try must wait. */
const FREE_ATTEMPTS = 5;
const LOCKOUT_STEP_MS = 5_000;
const LOCKOUT_MAX_MS = 5 * 60_000;

export const COOKIE_NAME = 'cashmemer_session';

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  label      TEXT DEFAULT ''
);
`);

/* ------------------------------------------------------------------ *
 * the passcode
 * ------------------------------------------------------------------ */

function hash(passcode, salt) {
  return scryptSync(String(passcode), salt, SCRYPT.keylen, SCRYPT).toString('hex');
}

/** True once a passcode has been chosen. Before that the app is open. */
export function hasPasscode() {
  const stored = getSetting('passcode');
  return Boolean(stored?.hash && stored?.salt);
}

/**
 * Sets or changes the passcode. Changing it signs every other browser out,
 * which is the point of changing it.
 */
export function setPasscode(passcode) {
  const value = String(passcode ?? '');
  if (value.length < 4) {
    throw new Error('The passcode needs to be at least 4 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  setSetting('passcode', { salt, hash: hash(value, salt), setAt: nowIso() });
  db.exec('DELETE FROM sessions');
}

/** Constant-time check, so the comparison cannot leak the answer by timing. */
export function passcodeMatches(passcode) {
  const stored = getSetting('passcode');
  if (!stored?.hash || !stored?.salt) return false;
  const attempt = Buffer.from(hash(String(passcode ?? ''), stored.salt), 'hex');
  const actual = Buffer.from(stored.hash, 'hex');
  if (attempt.length !== actual.length) return false;
  return timingSafeEqual(attempt, actual);
}

/* ------------------------------------------------------------------ *
 * slowing down guesses
 * ------------------------------------------------------------------ */

/** @type {Map<string, {misses: number, until: number}>} */
const attempts = new Map();

export function lockoutRemainingMs(who) {
  const record = attempts.get(who);
  if (!record) return 0;
  return Math.max(0, record.until - Date.now());
}

export function recordMiss(who) {
  const record = attempts.get(who) ?? { misses: 0, until: 0 };
  record.misses += 1;
  if (record.misses > FREE_ATTEMPTS) {
    const over = record.misses - FREE_ATTEMPTS;
    record.until = Date.now() + Math.min(over * LOCKOUT_STEP_MS, LOCKOUT_MAX_MS);
  }
  attempts.set(who, record);
  return lockoutRemainingMs(who);
}

export function clearMisses(who) {
  attempts.delete(who);
}

/* ------------------------------------------------------------------ *
 * sessions
 * ------------------------------------------------------------------ */

function purgeExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}

export function createSession(label = '') {
  purgeExpired();
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    token,
    nowIso(),
    expires,
    String(label).slice(0, 120),
  );
  return { token, expires };
}

export function sessionIsValid(token) {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(String(token));
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
    return false;
  }
  return true;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
}

export function destroyAllSessions() {
  db.exec('DELETE FROM sessions');
}

export function sessionCount() {
  purgeExpired();
  return db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
}

/* ------------------------------------------------------------------ *
 * cookies
 * ------------------------------------------------------------------ */

export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res, token, expires) {
  // Deliberately NOT Secure: the app is served over plain http on your LAN,
  // and a Secure cookie would simply never be sent, locking you out.
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

/* ------------------------------------------------------------------ *
 * the guard
 * ------------------------------------------------------------------ */

/** Is this request from a browser that has signed in? */
export function isSignedIn(req) {
  return sessionIsValid(readCookie(req, COOKIE_NAME));
}

/**
 * Paths that stay open, and why each one has to.
 *
 * This is a short list on purpose. The phone's scanner page is NOT on it: the
 * phone signs in with the same passcode as everything else. It is asked once
 * and then stays signed in for a month, so this costs one entry per phone, not
 * one per sale — and a stranger who photographs your QR code over your
 * shoulder still cannot use it.
 *
 * Only the login page itself and the assets needed to draw it stay open.
 */
const OPEN_PATHS = new Set([
  '/login',
  '/login.html',
  '/api/auth/state',
  '/api/auth/login',
  '/api/auth/setup',
]);

const OPEN_PREFIXES = ['/css/', '/js/', '/vendor/', '/shared/'];

export function isOpenPath(pathname) {
  if (OPEN_PATHS.has(pathname)) return true;
  return OPEN_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Express middleware. Anything not open needs a session — unless no passcode
 * has been chosen yet, in which case the app is open so you can choose one.
 */
export function requireSignIn(req, res, next) {
  if (!hasPasscode() || isOpenPath(req.path) || isSignedIn(req)) {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Locked. Sign in to continue.', locked: true });
    return;
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}
