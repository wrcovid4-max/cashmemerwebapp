/**
 * Backups.
 *
 * There are two kinds and they are not the same thing:
 *
 *   1. Export — you press a button, you get one JSON file. That file is the
 *      only thing that moves your shop to another computer. `git clone` will
 *      NOT bring your receipts with it.
 *   2. Automatic daily — the app writes a dated snapshot into a folder you
 *      choose, keeps the last 30, and deletes older ones. Point it at a folder
 *      that syncs somewhere else (Google Drive, Dropbox, OneDrive, iCloud) and
 *      your shop leaves the building without you having to remember anything.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, allSettings, setSetting, nowIso } from './db.js';

const SNAPSHOT_PREFIX = 'cashmemer-backup-';
const KEEP_SNAPSHOTS = 30;

/** Everything in the database, in one plain object. This is the whole shop. */
export function exportDatabase() {
  const table = (name) => db.prepare(`SELECT * FROM ${name}`).all();
  return {
    format: 'cashmemer-backup',
    version: 1,
    exportedAt: nowIso(),
    settings: allSettings(),
    products: table('products'),
    price_list: table('price_list'),
    members: table('members'),
    receipts: table('receipts'),
    receipt_items: table('receipt_items'),
    custom_rates: table('custom_rates'),
  };
}

/**
 * Puts an exported file back.
 *
 * @param {object} payload the parsed JSON
 * @param {{mode: 'replace'|'merge'}} options
 *   replace — wipe what is here and use the file. For moving machines.
 *   merge   — keep what is here and add anything the file has that this
 *             machine does not. For pulling in a second till's takings.
 */
export function importDatabase(payload, { mode = 'replace' } = {}) {
  if (!payload || payload.format !== 'cashmemer-backup') {
    throw new Error(
      'That file is not a Cash Memer backup. It should be the .json file the ' +
        'Export button produces, and its first line contains "cashmemer-backup".',
    );
  }

  const counts = { products: 0, price_list: 0, members: 0, receipts: 0, receipt_items: 0, custom_rates: 0 };

  db.exec('BEGIN');
  try {
    if (mode === 'replace') {
      // receipt_items goes first — it points at receipts.
      db.exec('DELETE FROM receipt_items');
      db.exec('DELETE FROM receipts');
      db.exec('DELETE FROM products');
      db.exec('DELETE FROM price_list');
      db.exec('DELETE FROM members');
      db.exec('DELETE FROM custom_rates');
    }

    const insertInto = (table, rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return 0;
      const columns = Object.keys(rows[0]);
      const sql =
        `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) ` +
        `VALUES (${columns.map(() => '?').join(', ')})`;
      const stmt = db.prepare(sql);
      let n = 0;
      for (const row of rows) {
        stmt.run(...columns.map((c) => (row[c] === undefined ? null : row[c])));
        n += 1;
      }
      return n;
    };

    counts.products = insertInto('products', payload.products);
    counts.price_list = insertInto('price_list', payload.price_list);
    counts.members = insertInto('members', payload.members);
    counts.receipts = insertInto('receipts', payload.receipts);
    counts.receipt_items = insertInto('receipt_items', payload.receipt_items);
    counts.custom_rates = insertInto('custom_rates', payload.custom_rates);

    if (payload.settings && mode === 'replace') {
      for (const [key, value] of Object.entries(payload.settings)) {
        // Never let a restored file re-point the backup folder at a path that
        // does not exist on this machine.
        if (key === 'backupFolder') continue;
        setSetting(key, value);
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return counts;
}

function snapshotName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${SNAPSHOT_PREFIX}${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}-${p(date.getMinutes())}.json`
  );
}

/** Deletes all but the newest KEEP_SNAPSHOTS files we wrote. */
function prune(folder) {
  let removed = 0;
  const files = readdirSync(folder)
    .filter((f) => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith('.json'))
    .map((f) => ({ f, t: statSync(join(folder, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const old of files.slice(KEEP_SNAPSHOTS)) {
    try {
      unlinkSync(join(folder, old.f));
      removed += 1;
    } catch {
      /* A file we cannot delete is not a reason to fail the backup. */
    }
  }
  return removed;
}

/**
 * Writes one snapshot now.
 * @returns {{ok: true, file: string, pruned: number} | {ok: false, error: string}}
 */
export function runBackupNow() {
  const settings = allSettings();
  const folder = (settings.backupFolder || '').trim();

  if (!folder) {
    const error = 'No backup folder is set. Settings -> Automatic Backup -> Backup folder.';
    setSetting('lastBackupError', error);
    return { ok: false, error };
  }

  try {
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const file = join(folder, snapshotName());
    writeFileSync(file, JSON.stringify(exportDatabase(), null, 2), 'utf8');
    const pruned = prune(folder);
    setSetting('lastBackupAt', nowIso());
    setSetting('lastBackupError', '');
    return { ok: true, file, pruned };
  } catch (err) {
    // The most common causes are a folder that has been moved or renamed, and
    // a folder the app is not allowed to write to. Say which, do not just fail.
    const error = `${err.code === 'EACCES' ? 'No permission to write to' : 'Could not write to'} ${folder} — ${err.message}`;
    setSetting('lastBackupError', error);
    return { ok: false, error };
  }
}

/**
 * Starts the daily timer. Checks hourly rather than sleeping for 24 hours, so
 * a laptop that was shut overnight still gets its snapshot when it wakes.
 */
export function startBackupSchedule() {
  const check = () => {
    const settings = allSettings();
    if (!settings.backupEnabled || !settings.backupFolder) return;

    const last = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    if (last > dayAgo) return;

    const result = runBackupNow();
    if (result.ok) {
      console.log(`[backup] Snapshot written: ${result.file}`);
    } else {
      console.warn(`[backup] Failed: ${result.error}`);
    }
  };

  // A few seconds after boot, then hourly.
  setTimeout(check, 8000).unref();
  setInterval(check, 3600 * 1000).unref();
}

export { KEEP_SNAPSHOTS };
