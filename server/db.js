/**
 * The shop's database.
 *
 * It is one SQLite file at data/cashmemer.db, read and written by the copy of
 * SQLite that ships inside Node itself. That means no compiler, no build tools,
 * and nothing to install beyond `npm install` — the usual reason a database
 * refuses to install on a fresh machine simply cannot happen here.
 *
 * That file is NOT in git. Your only portable copy is the JSON export in
 * Settings. See the README.
 */
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE, ensureDirs } from './paths.js';

ensureDirs();

export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  barcode     TEXT    DEFAULT '',
  brand       TEXT    DEFAULT '',
  category    TEXT    DEFAULT 'General',
  cost_price  REAL    NOT NULL DEFAULT 0,
  sell_price  REAL    NOT NULL DEFAULT 0,
  tax_percent REAL    NOT NULL DEFAULT 0,
  stock       REAL    NOT NULL DEFAULT 0,
  unit        TEXT    DEFAULT 'pcs',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name    ON products(name);

CREATE TABLE IF NOT EXISTS price_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  price      REAL    NOT NULL DEFAULT 0,
  unit       TEXT    DEFAULT 'piece',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT    DEFAULT '',
  email      TEXT    DEFAULT '',
  address    TEXT    DEFAULT '',
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           INTEGER NOT NULL,
  title            TEXT    DEFAULT '',
  place            TEXT    DEFAULT '',
  location_address TEXT    DEFAULT '',
  lat              REAL,
  lng              REAL,
  customer_name    TEXT    DEFAULT '',
  customer_phone   TEXT    DEFAULT '',
  customer_email   TEXT    DEFAULT '',
  customer_address TEXT    DEFAULT '',
  currency         TEXT    NOT NULL DEFAULT 'PKR',
  category         TEXT    DEFAULT 'Shopping',
  payment_method   TEXT    DEFAULT 'Cash',
  discount         REAL    NOT NULL DEFAULT 0,
  tax_percent      REAL    NOT NULL DEFAULT 0,
  cash_given       REAL    NOT NULL DEFAULT 0,
  tax_base         TEXT    NOT NULL DEFAULT 'after-discount',
  note1            TEXT    DEFAULT '',
  note2            TEXT    DEFAULT '',
  signature        TEXT    DEFAULT '',
  issuer_name      TEXT    DEFAULT '',
  issuer_email     TEXT    DEFAULT '',
  pinned           INTEGER NOT NULL DEFAULT 0,
  synced           INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_number  ON receipts(number);
CREATE INDEX IF NOT EXISTS        idx_receipts_created ON receipts(created_at);

CREATE TABLE IF NOT EXISTS receipt_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  qty        REAL    NOT NULL DEFAULT 1,
  price      REAL    NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_receipt ON receipt_items(receipt_id);

CREATE TABLE IF NOT EXISTS custom_rates (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  rate       REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

/* ------------------------------------------------------------------ *
 * migrations
 *
 * A database made by an older version of the app must open and keep working.
 * Losing a shop's receipts to a schema change is exactly the disaster this
 * project exists to avoid, so columns are only ever added, never removed or
 * retyped, and every add carries a default that makes old rows correct.
 * ------------------------------------------------------------------ */

function addColumnIfMissing(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (existing.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] Added ${table}.${column}`);
}

// Receipts issued before the tax rule became a choice were all worked out with
// tax applied after the discount, so that is the right value for them.
addColumnIfMissing('receipts', 'tax_base', "TEXT NOT NULL DEFAULT 'after-discount'");
addColumnIfMissing('products', 'tax_percent', 'REAL NOT NULL DEFAULT 0');

// The id of the matching document in the cloud, so a re-sync updates the same
// row instead of making a second copy. Locally-made rows leave it null.
addColumnIfMissing('receipts', 'cloud_id', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_cloud ON receipts(cloud_id) WHERE cloud_id IS NOT NULL');
addColumnIfMissing('products', 'cloud_id', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_cloud ON products(cloud_id) WHERE cloud_id IS NOT NULL');

/* ------------------------------------------------------------------ *
 * settings — a tiny key/value store, values are JSON
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  theme: 'dark',
  language: 'en',
  storeName: '',
  storeAddress: '',
  defaultCurrency: 'PKR',
  defaultNote1: 'Thank You for shopping !!!',
  autoPrint: false,
  autoSend: false,
  saveSignature: true,
  defaultSignature: '',
  // Which amount the tax percentage applies to. See shared/totals.js.
  taxBase: 'after-discount',
  issuerName: '',
  issuerEmail: '',
  lowStockThreshold: 5,
  // The Google Maps key can live here (entered in Settings) as well as in .env.
  // It is never sent to the browser — the server redacts it from settings responses.
  mapsApiKey: '',
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value ?? null));
}

export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

export { DEFAULT_SETTINGS };

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

export function nowIso() {
  return new Date().toISOString();
}

/** Receipt numbers are sequential and never reused, like a real memo book. */
export function nextReceiptNumber() {
  const row = db.prepare('SELECT MAX(number) AS n FROM receipts').get();
  return (row?.n ?? 0) + 1;
}

/** First run only: a couple of rows so the screens are not blank. */
export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count > 0) return;
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO products (name, barcode, brand, category, cost_price, sell_price, stock, unit, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  const samples = [
    ['White Bread Large', '8964000101018', 'Bake Parlour', 'Bakery', 150, 200, 24, 'piece'],
    ['Courasant', '8964000101025', '', 'Bakery', 40, 60, 30, 'piece'],
    ['Milk 1 Litre', '8964000202019', 'Olpers', 'Dairy', 210, 240, 40, 'litre'],
  ];
  for (const s of samples) insert.run(...s, ts, ts);
}
