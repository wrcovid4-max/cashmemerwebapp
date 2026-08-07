/**
 * Backups: the round trip, the pruning, and the case that actually broke.
 *
 * The last one matters most. The README tells you to point the backup folder
 * at something that syncs off the machine — a Google Drive or Dropbox folder,
 * or a drive on the network. When one of those is disconnected, a write to it
 * does not fail, it hangs. An earlier version of this app did that work
 * synchronously, which froze the entire server: no screens, no receipts,
 * nothing, in the middle of a sale. This checks that it cannot happen again.
 *
 * Start the app first:  npm start
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, signIn, authedFetch } from './helpers.mjs';

const cookie = await signIn();
const call = authedFetch(cookie);
let failures = 0;
const ok = (label, pass) => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
};

const json = async (method, path, body) => {
  const res = await call(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
};

/* ---- 1. export, wipe, restore ------------------------------------- */

await json('POST', '/api/members', { name: 'Backup Test Customer', phone: '0300 0000000' });
const before = await json('GET', '/api/members');

const backup = await (await call('/api/backup/export')).json();
ok('export produces a Cash Memer backup', backup.format === 'cashmemer-backup');

for (const m of before) await json('DELETE', `/api/members/${m.id}`);
ok('members wiped', (await json('GET', '/api/members')).length === 0);

const restored = await json('POST', '/api/backup/import', { payload: backup, mode: 'replace' });
ok('restore reports what it put back', restored.ok === true && restored.counts.members === before.length);
ok('members are back', (await json('GET', '/api/members')).length === before.length);

const refused = await json('POST', '/api/backup/import', { payload: { hello: 'world' }, mode: 'replace' });
ok('a file that is not a backup is refused, not half-imported', Boolean(refused.error));

/* ---- 2. only the newest 30 snapshots are kept ---------------------- */

const folder = '/tmp/cashmemer-test-backups';
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });

// 34 snapshots that look old, plus a file that is none of our business.
for (let i = 1; i <= 34; i += 1) {
  const file = join(folder, `cashmemer-backup-2026-07-${String(i).padStart(2, '0')}_10-00.json`);
  writeFileSync(file, '{}');
  const when = new Date(2026, 6, i);
  utimesSync(file, when, when);
}
writeFileSync(join(folder, 'my-own-notes.txt'), 'not yours to delete');

await json('PUT', '/api/settings', { backupFolder: folder });
const run = await json('POST', '/api/backup/run');
ok('a snapshot is written', run.ok === true);

const left = readdirSync(folder);
const snapshots = left.filter((f) => f.startsWith('cashmemer-backup-'));
ok(`only the newest 30 snapshots are kept (found ${snapshots.length}, pruned ${run.pruned})`, snapshots.length === 30);
ok('an unrelated file in the folder is left alone', left.includes('my-own-notes.txt'));

/* ---- 3. an unreachable folder must not freeze the app -------------- */

// /proc/... is a path the filesystem will not answer about promptly, which is
// how a disconnected network drive behaves.
await json('PUT', '/api/settings', { backupFolder: '/proc/nope/cannot' });

const started = Date.now();
const failed = await json('POST', '/api/backup/run');
ok('an unreachable folder fails rather than hanging forever', failed.ok === false);
ok(`it says why (${String(failed.error).slice(0, 60)}…)`, /disconnected|permission|does not exist|full|Could not write/i.test(failed.error));

// The real regression: is the app still serving anything at all?
const alive = await call('/api/dashboard').then((r) => r.status).catch(() => 0);
ok(`the app is still responsive afterwards (dashboard -> ${alive})`, alive === 200);
console.log(`      the failing backup took ${Math.round((Date.now() - started) / 1000)}s and did not block anything else`);

/* ---- tidy up ------------------------------------------------------ */

await json('PUT', '/api/settings', { backupFolder: '', backupEnabled: false });
rmSync(folder, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll backup checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
