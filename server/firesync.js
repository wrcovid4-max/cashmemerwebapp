/**
 * Cloud sync — pulling your receipts down from Firebase into this app.
 *
 * The read/fetch part (talking to Firestore) is kept apart from the mapping +
 * database part (importMemos), so the mapping can be tested on its own without
 * a live Firebase connection.
 *
 * Idempotent: every cloud receipt is matched by its document id (cloud_id), so
 * running a sync again updates the same local receipt instead of duplicating it.
 */
import { randomUUID } from 'node:crypto';
import { firestore, resolveUid } from './firebase.js';
import { db, allSettings, nowIso, nextReceiptNumber } from './db.js';
import { computeTotals } from '../shared/totals.js';

/* ---- small helpers ------------------------------------------------------- */

const str = (v, d = '') => (v === undefined || v === null ? d : String(v));
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v) => {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isoFromMs = (ms) => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : nowIso();
};
const msFromIso = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Date.now();
};

/* ---- field mapping: a cloud cashMemo -> a local receipt row -------------- */

const COLS = [
  'number', 'cloud_id', 'title', 'place', 'location_address', 'lat', 'lng',
  'customer_name', 'customer_phone', 'customer_email', 'customer_address',
  'currency', 'category', 'payment_method', 'discount', 'tax_percent',
  'cash_given', 'tax_base', 'note1', 'note2', 'signature', 'issuer_name',
  'issuer_email', 'created_at', 'updated_at',
];

/** A cloud document's data mapped onto local receipt columns. */
export function memoToRow(cloudId, d = {}) {
  return {
    number: Number.isFinite(Number(d.id)) && Number(d.id) > 0 ? Math.trunc(Number(d.id)) : null,
    cloud_id: cloudId,
    title: str(d.title),
    place: str(d.place),
    location_address: str(d.locationAddress),
    lat: numOrNull(d.latitude),
    lng: numOrNull(d.longitude),
    customer_name: str(d.customerName),
    customer_phone: str(d.customerPhone),
    customer_email: str(d.customerEmail),
    customer_address: str(d.customerAddress),
    currency: str(d.currency, 'PKR') || 'PKR',
    category: str(d.category, 'Shopping') || 'Shopping',
    payment_method: str(d.paymentType, 'Cash') || 'Cash',
    discount: num(d.discountValue),
    tax_percent: num(d.taxPercentage),
    cash_given: num(d.cashGiven),
    tax_base: 'after-discount',
    note1: str(d.note),
    note2: str(d.notePage2),
    signature: str(d.signatureBase64), // old receipts store a phone path, not the image → usually blank
    issuer_name: str(d.accountName),
    issuer_email: str(d.accountEmail),
    created_at: isoFromMs(d.timestamp),
    updated_at: isoFromMs(d.lastModified ?? d.timestamp),
  };
}

/** Cloud items ({name, quantity, totalPrice}) mapped to local ({name, qty, price}). */
export function memoItems(d = {}) {
  const items = Array.isArray(d.items) ? d.items : [];
  return items.map((it, i) => {
    const qty = num(it.quantity, 1) || 1;
    const total = num(it.totalPrice);
    return { name: str(it.name), qty, price: qty ? total / qty : total, sort_order: i };
  });
}

/* ---- import: upsert an array of {id, data} into the local database -------- */

const UPDATE_COLS = COLS.filter((c) => c !== 'number' && c !== 'cloud_id' && c !== 'created_at');

/**
 * Upserts cloud receipts into the local database. Returns { imported, updated }.
 * @param {{id: string, data: object}[]} docs
 */
export function importMemos(docs) {
  const insertReceipt = db.prepare(
    `INSERT INTO receipts (${COLS.join(', ')}, pinned, synced)
     VALUES (${COLS.map(() => '?').join(', ')}, 0, 1)`,
  );
  const updateReceipt = db.prepare(
    `UPDATE receipts SET ${UPDATE_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
  );
  const findByCloud = db.prepare('SELECT id FROM receipts WHERE cloud_id = ?');
  const numberTaken = db.prepare('SELECT 1 FROM receipts WHERE number = ?');
  const clearItems = db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?');
  const insertItem = db.prepare(
    'INSERT INTO receipt_items (receipt_id, name, qty, price, sort_order) VALUES (?, ?, ?, ?, ?)',
  );

  // Receipt numbers must be unique. The cloud's numeric id is used when it is
  // free; otherwise (the cloud reuses ids, so duplicates exist) a fresh number
  // is assigned. This is what stopped the "UNIQUE constraint failed" on import.
  const freshNumber = (preferred) => {
    if (preferred != null && !numberTaken.get(preferred)) return preferred;
    return nextReceiptNumber();
  };

  let imported = 0;
  let updated = 0;

  db.exec('BEGIN');
  try {
    for (const doc of docs) {
      const row = memoToRow(doc.id, doc.data);
      const items = memoItems(doc.data);
      const existing = findByCloud.get(doc.id);

      let receiptId;
      if (existing) {
        updateReceipt.run(...UPDATE_COLS.map((c) => row[c]), existing.id);
        receiptId = existing.id;
        updated += 1;
      } else {
        row.number = freshNumber(row.number);
        const info = insertReceipt.run(...COLS.map((c) => row[c]));
        receiptId = info.lastInsertRowid;
        imported += 1;
      }

      clearItems.run(receiptId);
      items.forEach((it) => insertItem.run(receiptId, it.name, it.qty, it.price, it.sort_order));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { imported, updated };
}

/* ---- field mapping: a cloud manualProduct -> a local product row --------- */

const PCOLS = [
  'cloud_id', 'name', 'barcode', 'brand', 'category', 'cost_price', 'sell_price',
  'tax_percent', 'stock', 'unit', 'archived', 'created_at', 'updated_at',
];
const PUPDATE_COLS = PCOLS.filter((c) => c !== 'cloud_id' && c !== 'created_at');

/** A cloud manualProduct mapped onto local product columns. */
export function productToRow(cloudId, d = {}) {
  return {
    cloud_id: cloudId,
    name: str(d.name),
    barcode: '', // not in the cloud product
    brand: '',
    category: str(d.category, 'General') || 'General',
    cost_price: num(d.costPrice),
    sell_price: num(d.sellingPrice),
    tax_percent: 0,
    stock: 0, // not tracked in the cloud product
    unit: str(d.unit, 'pcs') || 'pcs',
    archived: d.isArchived ? 1 : 0,
    created_at: nowIso(),
    updated_at: isoFromMs(d.lastUpdated),
  };
}

/** Upserts cloud products into the local database. Returns { imported, updated }. */
export function importProducts(docs) {
  const insertP = db.prepare(
    `INSERT INTO products (${PCOLS.join(', ')}) VALUES (${PCOLS.map(() => '?').join(', ')})`,
  );
  const updateP = db.prepare(
    `UPDATE products SET ${PUPDATE_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
  );
  const findP = db.prepare('SELECT id FROM products WHERE cloud_id = ?');

  let imported = 0;
  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const doc of docs) {
      const row = productToRow(doc.id, doc.data);
      const existing = findP.get(doc.id);
      if (existing) {
        updateP.run(...PUPDATE_COLS.map((c) => row[c]), existing.id);
        updated += 1;
      } else {
        insertP.run(...PCOLS.map((c) => row[c]));
        imported += 1;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { imported, updated };
}

/* ---- reverse mapping: local rows -> cloud documents (for Back up) --------- */

/** A local receipt (+ its items) mapped to the cloud cashMemo shape. */
export function rowToMemo(r, items) {
  const totals = computeTotals({
    items: items.map((i) => ({ qty: i.qty, price: i.price })),
    discount: r.discount,
    taxPercent: r.tax_percent,
    cashGiven: r.cash_given,
    taxBase: r.tax_base,
  });
  return {
    accountEmail: r.issuer_email || '',
    accountName: r.issuer_name || '',
    title: r.title || '',
    place: r.place || '',
    category: r.category || 'Shopping',
    currency: r.currency || 'PKR',
    paymentType: r.payment_method || 'Cash',
    customerName: r.customer_name || '',
    customerPhone: r.customer_phone || '',
    customerEmail: r.customer_email || '',
    customerAddress: r.customer_address || '',
    discountType: (r.discount || 0) > 0 ? 'Flat' : 'None',
    discountValue: r.discount || 0,
    taxPercentage: r.tax_percent || 0,
    subtotal: totals.subtotal,
    grandTotal: totals.grandTotal,
    cashGiven: r.cash_given || 0,
    changeAmount: totals.change,
    note: r.note1 || '',
    notePage2: r.note2 || '',
    latitude: r.lat == null ? null : r.lat,
    longitude: r.lng == null ? null : r.lng,
    locationAddress: r.location_address || '',
    signatureBase64: r.signature || null,
    signaturePath: null,
    id: r.number,
    timestamp: msFromIso(r.created_at),
    lastModified: msFromIso(r.updated_at),
    items: items.map((i) => ({ name: i.name, quantity: i.qty, totalPrice: i.qty * i.price })),
  };
}

/** A local product mapped to the cloud manualProduct shape. */
export function rowToProduct(p) {
  return {
    productUuid: p.cloud_id || null, // filled with the doc id at push time
    name: p.name || '',
    category: p.category || 'General',
    costPrice: p.cost_price || 0,
    sellingPrice: p.sell_price || 0,
    unit: p.unit || 'pcs',
    isArchived: Boolean(p.archived),
    notes: '',
    id: 0,
    lastUpdated: msFromIso(p.updated_at),
  };
}

/* ---- the Firestore side -------------------------------------------------- */

/** The signed-in Google account's Firebase UID, or throws a plain reason. */
async function currentUid() {
  const email = allSettings().account?.email;
  if (!email) throw new Error('Sign in with Google first — use the same account as your phone.');
  const uid = await resolveUid(email);
  if (!uid) throw new Error(`No Firebase user found for ${email}. Sign in on your phone once first.`);
  return uid;
}

/** Read-only counts of what is already in the cloud for this account. */
export async function preview() {
  const cloud = await firestore();
  if (!cloud) throw new Error('Firebase is not connected. Add your service-account key on this machine.');
  const uid = await currentUid();
  const base = cloud.collection('users').doc(uid);
  const [memos, products] = await Promise.all([
    base.collection('cashMemos').count().get(),
    base.collection('manualProducts').count().get(),
  ]);
  return { uid, cashMemos: memos.data().count, manualProducts: products.data().count };
}

/** Pulls your cloud receipts and products into the local app. Idempotent. */
export async function pull() {
  const cloud = await firestore();
  if (!cloud) throw new Error('Firebase is not connected. Add your service-account key on this machine.');
  const uid = await currentUid();
  const base = cloud.collection('users').doc(uid);

  const [memoSnap, prodSnap] = await Promise.all([
    base.collection('cashMemos').get(),
    base.collection('manualProducts').get(),
  ]);

  const receipts = importMemos(memoSnap.docs.map((d) => ({ id: d.id, data: d.data() })));
  const products = importProducts(prodSnap.docs.map((d) => ({ id: d.id, data: d.data() })));

  return {
    uid,
    receipts: { total: memoSnap.size, ...receipts },
    products: { total: prodSnap.size, ...products },
  };
}

/**
 * Pushes every local receipt and product UP to the cloud (the Back up button).
 * Idempotent: rows that came from the cloud keep their document id; locally-made
 * rows get a new id, saved back onto the row, so a later push updates the same
 * document instead of making a duplicate.
 */
export async function push() {
  const cloud = await firestore();
  if (!cloud) throw new Error('Firebase is not connected. Add your service-account key on this machine.');
  const uid = await currentUid();
  const base = cloud.collection('users').doc(uid);

  const setReceiptCloud = db.prepare('UPDATE receipts SET cloud_id = ? WHERE id = ?');
  const setProductCloud = db.prepare('UPDATE products SET cloud_id = ? WHERE id = ?');
  const itemsFor = db.prepare('SELECT name, qty, price FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order, id');

  const writes = [];

  for (const r of db.prepare('SELECT * FROM receipts').all()) {
    const docId = r.cloud_id || randomUUID();
    if (!r.cloud_id) setReceiptCloud.run(docId, r.id);
    writes.push({ ref: base.collection('cashMemos').doc(docId), data: rowToMemo(r, itemsFor.all(r.id)) });
  }

  for (const p of db.prepare('SELECT * FROM products').all()) {
    const docId = p.cloud_id || randomUUID();
    if (!p.cloud_id) setProductCloud.run(docId, p.id);
    const data = rowToProduct(p);
    data.productUuid = docId;
    writes.push({ ref: base.collection('manualProducts').doc(docId), data });
  }

  // Firestore batches take up to 500 writes; stay well under.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = cloud.batch();
    for (const w of writes.slice(i, i + 400)) batch.set(w.ref, w.data, { merge: true });
    await batch.commit();
  }

  const receipts = db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n;
  const products = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  return { uid, receipts, products };
}
