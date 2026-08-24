/**
 * Cloud sync — step one: a read-only look at what is in your Firebase.
 *
 * This does not write anything, anywhere. It resolves the signed-in Google
 * account to its Firebase UID and counts the receipts and products already in
 * users/{uid}/cashMemos and users/{uid}/manualProducts, so you can confirm the
 * server is reaching your real data before any importing or two-way sync is
 * switched on.
 */
import { firestore, resolveUid } from './firebase.js';
import { allSettings } from './db.js';

/** The signed-in Google account's Firebase UID, or throws a plain reason. */
async function currentUid() {
  const email = allSettings().account?.email;
  if (!email) {
    throw new Error('Sign in with Google first — use the same account as your phone.');
  }
  const uid = await resolveUid(email);
  if (!uid) {
    throw new Error(`No Firebase user found for ${email}. Sign in on your phone at least once first.`);
  }
  return uid;
}

/** Read-only counts of what is already in the cloud for this account. */
export async function preview() {
  const db = await firestore();
  if (!db) throw new Error('Firebase is not connected. Add your service-account key on this machine.');

  const uid = await currentUid();
  const base = db.collection('users').doc(uid);

  // count() is an aggregation — it does not download every document.
  const [memos, products] = await Promise.all([
    base.collection('cashMemos').count().get(),
    base.collection('manualProducts').count().get(),
  ]);

  return {
    uid,
    cashMemos: memos.data().count,
    manualProducts: products.data().count,
  };
}
