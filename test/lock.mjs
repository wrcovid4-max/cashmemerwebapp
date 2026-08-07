/**
 * The lock on the till.
 *
 * Cash Memer is served to the whole Wi-Fi so the phone can reach it, which
 * means anyone else on that network can reach it too. These checks are written
 * from the point of view of a stranger who has joined the Wi-Fi and is trying
 * doors — including the phone scanner's door, which is the one people assume
 * is protected by the QR code alone. It is not: it needs the passcode like
 * everything else.
 *
 * Needs `ws` for the socket checks:
 *   npm install --no-save ws
 *   node test/lock.mjs
 */
import WebSocket from 'ws';
import { BASE, TEST_PASSCODE, signIn } from './helpers.mjs';

let failures = 0;
const ok = (label, pass) => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
};

/** A request with no cookie at all — a stranger on the network. */
const stranger = (path, options = {}) =>
  fetch(`${BASE}${path}`, { redirect: 'manual', ...options });

/** Tries a WebSocket and reports whether it was allowed in. */
function trySocket(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?role=phone&code=probe`, { headers });
    let settled = false;
    const finish = (allowed) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve(allowed);
    };
    ws.on('open', () => finish(true));
    ws.on('unexpected-response', () => finish(false));
    ws.on('error', () => finish(false));
    setTimeout(() => finish(false), 4000);
  });
}

/* ---- make sure a passcode exists, and hold a real session -------------- */

const cookie = await signIn();
const state = await fetch(`${BASE}/api/auth/state`).then((r) => r.json());
ok('a passcode is set', state.hasPasscode === true);

/* ---- the stranger ------------------------------------------------------ */

console.log('\n-- a stranger on your Wi-Fi, with no passcode --');

const home = await stranger('/');
ok(`the app itself is closed (${home.status}, sent to ${home.headers.get('location') ?? '—'})`, home.status === 302);

// The one people assume the QR alone protects.
const scan = await stranger('/scan?code=anything');
ok(`the phone scanner page is closed (${scan.status})`, scan.status === 302);

const api = await stranger('/api/receipts');
ok(`the receipts are closed (${api.status})`, api.status === 401);

const settings = await stranger('/api/settings');
ok(`the settings are closed (${settings.status})`, settings.status === 401);

const pair = await stranger('/api/pair', { method: 'POST' });
ok(`a stranger cannot mint a pairing code (${pair.status})`, pair.status === 401);

ok('the phone socket refuses a stranger', (await trySocket({})) === false);

const login = await stranger('/login');
ok(`the lock screen itself stays open (${login.status})`, login.status === 200);

const css = await stranger('/css/app.css');
ok(`the lock screen can still load its styles (${css.status})`, css.status === 200);

/* ---- you --------------------------------------------------------------- */

console.log('\n-- you, once signed in --');

const withCookie = (path, options = {}) =>
  fetch(`${BASE}${path}`, { redirect: 'manual', ...options, headers: { ...(options.headers ?? {}), Cookie: cookie } });

ok(`the app opens (${(await withCookie('/')).status})`, (await withCookie('/')).status === 200);
ok(`the scanner page opens (${(await withCookie('/scan?code=x')).status})`, (await withCookie('/scan?code=x')).status === 200);
ok(`the receipts open (${(await withCookie('/api/receipts')).status})`, (await withCookie('/api/receipts')).status === 200);
ok('the phone socket lets you in', (await trySocket({ Cookie: cookie })) === true);

/* ---- guessing ---------------------------------------------------------- */

console.log('\n-- somebody guessing the passcode --');

const guess = (passcode) =>
  fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  }).then((r) => r.json());

let slowedDown = false;
for (let i = 0; i < 8; i += 1) {
  const answer = await guess('definitely-not-it');
  if (/wait|next try/i.test(answer.error ?? '')) slowedDown = true;
}
ok('repeated wrong guesses start getting slowed down', slowedDown);

const wrongStillWrong = await guess('definitely-not-it');
ok('and a wrong passcode is still refused', Boolean(wrongStillWrong.error));

// The slowdown must not lock the shopkeeper out permanently.
await new Promise((r) => setTimeout(r, 6000));
const right = await guess(TEST_PASSCODE);
ok('the real passcode works again once the wait is over', right.ok === true);

console.log(failures === 0 ? '\nAll lock checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
