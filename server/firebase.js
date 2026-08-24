/**
 * The connection to your Firebase project.
 *
 * Everything here is OPTIONAL and lazy. If the firebase-admin package is not
 * installed, or no service-account key is present, every function reports "not
 * ready" and the rest of the app runs exactly as before. Cloud sync is a bolt-on,
 * never a requirement.
 *
 * The service-account key is the master key to the project, so it is only ever
 * read from a gitignored file on this machine — never committed, never sent to
 * the browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DATA_DIR } from './paths.js';
import { env } from './env.js';

let state = null; // { db, auth, error } — computed once, then cached

/** The first place a service-account key is found, or null. */
function keyPath() {
  const candidates = [
    env.firebaseServiceAccount, // explicit path from .env
    join(ROOT, 'firebase-service-account.json'),
    join(DATA_DIR, 'firebase-service-account.json'),
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  }) ?? null;
}

/** Initialises once. Any failure is captured, never thrown, so the app stays up. */
async function init() {
  if (state) return state;

  const path = keyPath();
  if (!path) {
    state = { db: null, auth: null, error: 'No Firebase service-account key on this machine.' };
    return state;
  }

  try {
    const { default: admin } = await import('firebase-admin');
    const creds = JSON.parse(readFileSync(path, 'utf8'));
    const app = admin.apps?.length
      ? admin.apps[0]
      : admin.initializeApp({ credential: admin.credential.cert(creds), projectId: creds.project_id });
    state = { db: admin.firestore(app), auth: admin.auth(app), error: '' };
  } catch (err) {
    // firebase-admin missing, or a bad key, or no network — all non-fatal.
    state = { db: null, auth: null, error: `Firebase could not start — ${err.message}` };
  }
  return state;
}

/** { ready, error } — safe to call any time. */
export async function firebaseStatus() {
  const s = await init();
  return { ready: Boolean(s.db), error: s.error };
}

export async function firebaseReady() {
  return Boolean((await init()).db);
}

/** The Firestore handle, or null when not configured. */
export async function firestore() {
  return (await init()).db;
}

/**
 * The Firebase UID for a Google email — the same UID your other devices use,
 * so the web app lands in the same users/{uid} partition. Null if unknown.
 */
export async function resolveUid(email) {
  const s = await init();
  if (!s.auth || !email) return null;
  try {
    const user = await s.auth.getUserByEmail(String(email).trim());
    return user.uid;
  } catch {
    return null; // no such user yet, or auth unreachable
  }
}
