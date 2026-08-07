/**
 * Shared bits for the tests.
 *
 * The app is behind a passcode, so every test has to get past the lock first.
 * This handles both cases: a fresh install with no passcode yet (it sets one),
 * and an install that already has one (it signs in with PASSCODE from the
 * environment).
 */

export const BASE = process.env.BASE ?? 'http://localhost:4000';

/** The passcode used when a test has to create one. Override with PASSCODE=… */
export const TEST_PASSCODE = process.env.PASSCODE ?? 'test-passcode-1234';

/**
 * Gets past the lock and returns the session cookie as a `name=value` string,
 * ready to put in a Cookie header or hand to a browser.
 *
 * @returns {Promise<string>}
 */
export async function signIn() {
  const state = await fetch(`${BASE}/api/auth/state`).then((r) => r.json());

  const endpoint = state.hasPasscode ? 'login' : 'setup';
  const response = await fetch(`${BASE}/api/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: TEST_PASSCODE, label: 'test run' }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      `Could not get past the lock: ${detail.error ?? response.status}. ` +
        'If this install already has a passcode, run the tests with ' +
        'PASSCODE=your-passcode in front of the command.',
    );
  }

  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  if (!cookie.includes('=')) throw new Error('The server did not return a session cookie.');
  return cookie;
}

/** fetch, already signed in. */
export function authedFetch(cookie) {
  return (path, options = {}) =>
    fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
      ...options,
      headers: { ...(options.headers ?? {}), Cookie: cookie },
    });
}

/** Turns `name=value` into the shape Playwright wants for addCookies(). */
export function playwrightCookie(cookie) {
  const [name, ...rest] = cookie.split('=');
  return [
    {
      name,
      value: rest.join('='),
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ];
}
