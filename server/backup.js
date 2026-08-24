/**
 * Backups — a single kind: one JSON file you can save and restore.
 *
 * Export gives you the whole shop as one .json file; import puts it back.
 * That file is the only thing that moves your shop to another computer — a
 * fresh `git clone` does NOT bring your receipts with it.
 *
 * There is deliberately no folder-sync or cloud-drive backup here. State lives
 * in the local database; when this app moves to Firebase, real-time sync and
 * cloud storage handle persistence — no external file backup in between.
 */
import { db, allSettings, setSetting, nowIso } from './db.js';

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
