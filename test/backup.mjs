/**
 * Backup — the export/restore round trip.
 *
 * There is one kind of backup: Export gives you a JSON file, Restore reads it
 * back. That file is the only copy that moves your shop between machines. There
 * is deliberately no folder-sync or cloud-drive backup to test — state lives in
 * the database, and real cross-device persistence is Firebase's job, not a file
 * dropped into a synced folder.
 *
 * Start the app first:  npm start
 */
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

/* ---- export, wipe, restore --------------------------------------- */

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

/* ---- the folder-sync backup is gone --------------------------------- */

const gone = await call('/api/backup/run', { method: 'POST' }).then((r) => r.status).catch(() => 0);
ok(`the old folder-backup endpoint no longer exists (${gone})`, gone === 404);

console.log(failures === 0 ? '\nAll backup checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
