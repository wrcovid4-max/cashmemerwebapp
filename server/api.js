/**
 * Every HTTP endpoint the browser talks to.
 *
 * House rules for this file:
 *   - A missing API key is never an error the user has to decode. The endpoint
 *     answers 200 with { ready: false, missing: 'GEMINI_API_KEY', where: ... }
 *     and the screen shows that sentence.
 *   - Anything that can lose data (delete, restore) says exactly what it did.
 *   - Money is never recomputed here by hand; it goes through shared/totals.js,
 *     the same code the screen and the printed memo use.
 */
import { Router } from 'express';
import QRCode from 'qrcode';
import { db, allSettings, setSetting, nowIso, nextReceiptNumber, DEFAULT_SETTINGS } from './db.js';
import { env, featureStatus } from './env.js';
import { computeTotals, TAX_BASES, DEFAULT_TAX_BASE } from '../shared/totals.js';
import { CURRENCIES, withDerivedRates } from '../shared/currency.js';
import { renderReceiptsPdf, receiptFileName } from './pdf.js';
import { exportDatabase, importDatabase, runBackupNow, KEEP_SNAPSHOTS } from './backup.js';
import { createPairing, pairingStatus } from './scanhub.js';
import {
  hasPasscode, setPasscode, passcodeMatches, createSession, destroySession,
  destroyAllSessions, sessionCount, setSessionCookie, clearSessionCookie,
  readCookie, isSignedIn, lockoutRemainingMs, recordMiss, clearMisses, COOKIE_NAME,
} from './auth.js';

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v, fallback = '') => (v === undefined || v === null ? fallback : String(v));

/** Wraps a handler so a thrown error becomes a clean message, not a stack. */
const guard = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`[api] ${req.method} ${req.originalUrl} — ${err.stack || err.message}`);
    if (!res.headersSent) res.status(400).json({ error: err.message });
  }
};

function receiptWithItems(row) {
  if (!row) return null;
  const items = db
    .prepare('SELECT id, name, qty, price FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order, id')
    .all(row.id);
  const totals = computeTotals({
    items,
    discount: row.discount,
    taxPercent: row.tax_percent,
    cashGiven: row.cash_given,
    // The rule the receipt was issued under, so an old memo cannot re-total
    // itself because the shop changed its mind later.
    taxBase: row.tax_base,
  });
  return { ...row, items, totals };
}

function loadReceipt(id) {
  return receiptWithItems(db.prepare('SELECT * FROM receipts WHERE id = ?').get(Number(id)));
}

/** The columns a receipt write accepts, so a stray field cannot reach SQL. */
function receiptFields(body) {
  return {
    title: str(body.title),
    place: str(body.place),
    location_address: str(body.location_address ?? body.locationAddress),
    lat: body.lat === '' || body.lat === undefined || body.lat === null ? null : num(body.lat),
    lng: body.lng === '' || body.lng === undefined || body.lng === null ? null : num(body.lng),
    customer_name: str(body.customer_name ?? body.customerName),
    customer_phone: str(body.customer_phone ?? body.customerPhone),
    customer_email: str(body.customer_email ?? body.customerEmail),
    customer_address: str(body.customer_address ?? body.customerAddress),
    currency: str(body.currency, 'PKR'),
    category: str(body.category, 'Shopping'),
    payment_method: str(body.payment_method ?? body.paymentMethod, 'Cash'),
    discount: num(body.discount),
    tax_percent: num(body.tax_percent ?? body.taxPercent),
    tax_base: TAX_BASES.includes(body.tax_base ?? body.taxBase)
      ? (body.tax_base ?? body.taxBase)
      : (allSettings().taxBase ?? DEFAULT_TAX_BASE),
    cash_given: num(body.cash_given ?? body.cashGiven),
    note1: str(body.note1),
    note2: str(body.note2),
    signature: str(body.signature),
    issuer_name: str(body.issuer_name ?? body.issuerName),
    issuer_email: str(body.issuer_email ?? body.issuerEmail),
  };
}

function writeItems(receiptId, items) {
  db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(receiptId);
  const stmt = db.prepare(
    'INSERT INTO receipt_items (receipt_id, name, qty, price, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  (Array.isArray(items) ? items : []).forEach((item, i) => {
    const name = str(item.name).trim();
    if (!name) return;
    stmt.run(receiptId, name, num(item.qty, 1), num(item.price), i);
  });
}

/* ------------------------------------------------------------------ *
 * router
 * ------------------------------------------------------------------ */

export function createApi({ urls }) {
  const api = Router();

  /* ---- what the app needs before it can draw anything --------------- */

  api.get(
    '/bootstrap',
    guard(async (req, res) => {
      res.json({
        settings: allSettings(),
        features: featureStatus(),
        currencies: CURRENCIES,
        urls,
        defaults: DEFAULT_SETTINGS,
        account: allSettings().account ?? null,
      });
    }),
  );

  /* ---- settings ------------------------------------------------------ */

  api.get('/settings', guard(async (req, res) => res.json(allSettings())));

  api.put(
    '/settings',
    guard(async (req, res) => {
      const incoming = req.body ?? {};
      for (const [key, value] of Object.entries(incoming)) {
        setSetting(key, value);
      }
      res.json(allSettings());
    }),
  );

  /* ---- inventory ------------------------------------------------------ */

  api.get(
    '/products',
    guard(async (req, res) => {
      const q = str(req.query.q).trim().toLowerCase();
      const filter = str(req.query.filter, 'all');

      let rows = db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all();
      if (filter === 'active') rows = rows.filter((r) => !r.archived);
      if (filter === 'archived') rows = rows.filter((r) => r.archived);
      if (q) {
        rows = rows.filter((r) =>
          [r.name, r.barcode, r.brand].some((f) => String(f ?? '').toLowerCase().includes(q)),
        );
      }

      const threshold = num(allSettings().lowStockThreshold, 5);
      const active = rows.filter((r) => !r.archived);
      res.json({
        products: rows,
        summary: {
          total: rows.length,
          active: active.length,
          lowStock: active.filter((r) => r.stock <= threshold).length,
          sellValue: active.reduce((sum, r) => sum + r.stock * r.sell_price, 0),
          threshold,
        },
      });
    }),
  );

  api.get(
    '/products/barcode/:code',
    guard(async (req, res) => {
      const row = db
        .prepare('SELECT * FROM products WHERE barcode = ? AND archived = 0')
        .get(str(req.params.code).trim());
      res.json({ found: Boolean(row), product: row ?? null });
    }),
  );

  const productFields = (b) => ({
    name: str(b.name).trim(),
    barcode: str(b.barcode).trim(),
    brand: str(b.brand).trim(),
    category: str(b.category, 'General').trim() || 'General',
    cost_price: num(b.cost_price ?? b.costPrice),
    sell_price: num(b.sell_price ?? b.sellPrice),
    stock: num(b.stock),
    unit: str(b.unit, 'pcs').trim() || 'pcs',
    archived: b.archived ? 1 : 0,
  });

  api.post(
    '/products',
    guard(async (req, res) => {
      const f = productFields(req.body ?? {});
      if (!f.name) throw new Error('A product needs a name.');
      const ts = nowIso();
      const info = db
        .prepare(
          `INSERT INTO products (name, barcode, brand, category, cost_price, sell_price, stock, unit, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(f.name, f.barcode, f.brand, f.category, f.cost_price, f.sell_price, f.stock, f.unit, f.archived, ts, ts);
      res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
    }),
  );

  api.put(
    '/products/:id',
    guard(async (req, res) => {
      const f = productFields(req.body ?? {});
      if (!f.name) throw new Error('A product needs a name.');
      db.prepare(
        `UPDATE products SET name=?, barcode=?, brand=?, category=?, cost_price=?, sell_price=?,
         stock=?, unit=?, archived=?, updated_at=? WHERE id=?`,
      ).run(f.name, f.barcode, f.brand, f.category, f.cost_price, f.sell_price, f.stock, f.unit, f.archived, nowIso(), Number(req.params.id));
      res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id)));
    }),
  );

  api.post(
    '/products/:id/duplicate',
    guard(async (req, res) => {
      const src = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
      if (!src) throw new Error('That product no longer exists.');
      const ts = nowIso();
      // The barcode is deliberately not copied — two products cannot share one.
      const info = db
        .prepare(
          `INSERT INTO products (name, barcode, brand, category, cost_price, sell_price, stock, unit, archived, created_at, updated_at)
           VALUES (?, '', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(`${src.name} (copy)`, src.brand, src.category, src.cost_price, src.sell_price, src.stock, src.unit, ts, ts);
      res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
    }),
  );

  api.delete(
    '/products/:id',
    guard(async (req, res) => {
      db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  /* ---- price list ------------------------------------------------------ */

  api.get(
    '/pricelist',
    guard(async (req, res) => {
      res.json(db.prepare('SELECT * FROM price_list ORDER BY sort_order, id').all());
    }),
  );

  api.post(
    '/pricelist',
    guard(async (req, res) => {
      const b = req.body ?? {};
      const name = str(b.name).trim();
      if (!name) throw new Error('A price list entry needs a name.');
      const info = db
        .prepare('INSERT INTO price_list (name, price, unit, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(name, num(b.price), str(b.unit, 'piece'), num(b.sort_order), nowIso());
      res.json(db.prepare('SELECT * FROM price_list WHERE id = ?').get(info.lastInsertRowid));
    }),
  );

  api.put(
    '/pricelist/:id',
    guard(async (req, res) => {
      const b = req.body ?? {};
      db.prepare('UPDATE price_list SET name=?, price=?, unit=?, sort_order=? WHERE id=?').run(
        str(b.name).trim(),
        num(b.price),
        str(b.unit, 'piece'),
        num(b.sort_order),
        Number(req.params.id),
      );
      res.json(db.prepare('SELECT * FROM price_list WHERE id = ?').get(Number(req.params.id)));
    }),
  );

  api.delete(
    '/pricelist/:id',
    guard(async (req, res) => {
      db.prepare('DELETE FROM price_list WHERE id = ?').run(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  /* ---- members --------------------------------------------------------- */

  api.get(
    '/members',
    guard(async (req, res) => {
      const q = str(req.query.q).trim().toLowerCase();
      let rows = db.prepare('SELECT * FROM members ORDER BY name COLLATE NOCASE').all();
      if (q) {
        rows = rows.filter((r) =>
          [r.name, r.phone, r.email, r.address].some((f) => String(f ?? '').toLowerCase().includes(q)),
        );
      }
      res.json(rows);
    }),
  );

  const memberFields = (b) => ({
    name: str(b.name).trim(),
    phone: str(b.phone).trim(),
    email: str(b.email).trim(),
    address: str(b.address).trim(),
  });

  api.post(
    '/members',
    guard(async (req, res) => {
      const f = memberFields(req.body ?? {});
      if (!f.name) throw new Error('A customer needs a name.');
      const ts = nowIso();
      const info = db
        .prepare('INSERT INTO members (name, phone, email, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(f.name, f.phone, f.email, f.address, ts, ts);
      res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid));
    }),
  );

  api.put(
    '/members/:id',
    guard(async (req, res) => {
      const f = memberFields(req.body ?? {});
      if (!f.name) throw new Error('A customer needs a name.');
      db.prepare('UPDATE members SET name=?, phone=?, email=?, address=?, updated_at=? WHERE id=?').run(
        f.name, f.phone, f.email, f.address, nowIso(), Number(req.params.id),
      );
      res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(Number(req.params.id)));
    }),
  );

  api.delete(
    '/members/:id',
    guard(async (req, res) => {
      db.prepare('DELETE FROM members WHERE id = ?').run(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  /* ---- receipts --------------------------------------------------------- */

  api.get(
    '/receipts',
    guard(async (req, res) => {
      const q = str(req.query.q).trim().toLowerCase();
      const from = str(req.query.from).trim();
      const to = str(req.query.to).trim();

      const where = [];
      const params = [];
      if (from) {
        where.push('created_at >= ?');
        params.push(`${from}T00:00:00.000`);
      }
      if (to) {
        // The end date covers the whole day, not just its midnight instant —
        // picking "today" and seeing none of today's sales is maddening.
        where.push('created_at <= ?');
        params.push(`${to}T23:59:59.999`);
      }

      const sql =
        'SELECT * FROM receipts' +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY pinned DESC, created_at DESC, id DESC';

      let rows = db.prepare(sql).all(...params).map(receiptWithItems);

      if (q) {
        rows = rows.filter((r) =>
          [r.title, r.place, r.location_address, r.customer_name]
            .some((f) => String(f ?? '').toLowerCase().includes(q)),
        );
      }
      res.json(rows);
    }),
  );

  api.get(
    '/receipts/:id',
    guard(async (req, res) => {
      const row = loadReceipt(req.params.id);
      if (!row) throw new Error('That receipt no longer exists.');
      res.json(row);
    }),
  );

  api.post(
    '/receipts',
    guard(async (req, res) => {
      const body = req.body ?? {};
      const f = receiptFields(body);
      const ts = nowIso();
      const createdAt = str(body.created_at ?? body.createdAt) || ts;
      const number = nextReceiptNumber();

      const columns = Object.keys(f);
      const info = db
        .prepare(
          `INSERT INTO receipts (number, ${columns.join(', ')}, pinned, synced, created_at, updated_at)
           VALUES (?, ${columns.map(() => '?').join(', ')}, 0, 0, ?, ?)`,
        )
        .run(number, ...columns.map((c) => f[c]), createdAt, ts);

      const id = Number(info.lastInsertRowid);
      writeItems(id, body.items);

      // Selling something takes it off the shelf.
      if (body.reduceStock !== false) reduceStockForItems(body.items);

      res.json(loadReceipt(id));
    }),
  );

  api.put(
    '/receipts/:id',
    guard(async (req, res) => {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT id FROM receipts WHERE id = ?').get(id);
      if (!existing) throw new Error('That receipt no longer exists.');

      const body = req.body ?? {};
      const f = receiptFields(body);
      const columns = Object.keys(f);

      // Edit updates the original. It never leaves a second copy behind —
      // that is what Duplicate is for.
      db.prepare(
        `UPDATE receipts SET ${columns.map((c) => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`,
      ).run(...columns.map((c) => f[c]), nowIso(), id);

      if (body.created_at ?? body.createdAt) {
        db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run(str(body.created_at ?? body.createdAt), id);
      }

      writeItems(id, body.items);
      res.json(loadReceipt(id));
    }),
  );

  api.post(
    '/receipts/:id/duplicate',
    guard(async (req, res) => {
      const src = loadReceipt(req.params.id);
      if (!src) throw new Error('That receipt no longer exists.');

      const f = receiptFields(src);
      const columns = Object.keys(f);
      const ts = nowIso();
      const info = db
        .prepare(
          `INSERT INTO receipts (number, ${columns.join(', ')}, pinned, synced, created_at, updated_at)
           VALUES (?, ${columns.map(() => '?').join(', ')}, 0, 0, ?, ?)`,
        )
        .run(nextReceiptNumber(), ...columns.map((c) => f[c]), ts, ts);

      const id = Number(info.lastInsertRowid);
      writeItems(id, src.items);
      res.json(loadReceipt(id));
    }),
  );

  api.post(
    '/receipts/:id/pin',
    guard(async (req, res) => {
      const id = Number(req.params.id);
      const row = db.prepare('SELECT pinned FROM receipts WHERE id = ?').get(id);
      if (!row) throw new Error('That receipt no longer exists.');
      db.prepare('UPDATE receipts SET pinned = ? WHERE id = ?').run(row.pinned ? 0 : 1, id);
      res.json(loadReceipt(id));
    }),
  );

  api.delete(
    '/receipts/:id',
    guard(async (req, res) => {
      db.prepare('DELETE FROM receipts WHERE id = ?').run(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  api.post(
    '/receipts/bulk-delete',
    guard(async (req, res) => {
      const ids = (req.body?.ids ?? []).map(Number).filter(Number.isFinite);
      if (ids.length === 0) throw new Error('Nothing was selected.');
      const stmt = db.prepare('DELETE FROM receipts WHERE id = ?');
      for (const id of ids) stmt.run(id);
      res.json({ ok: true, deleted: ids.length });
    }),
  );

  /* ---- the printed memo -------------------------------------------------- */

  /**
   * One document, however many memos. `inline` so the browser opens it in a
   * tab where Ctrl+P reaches the printer, rather than dropping a file in
   * Downloads that has to be found and opened by hand.
   */
  const sendPdf = async (res, receipts, downloadName) => {
    const buffer = await renderReceiptsPdf(receipts);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    res.send(buffer);
  };

  api.get(
    '/receipts/:id/pdf',
    guard(async (req, res) => {
      const row = loadReceipt(req.params.id);
      if (!row) throw new Error('That receipt no longer exists.');
      await sendPdf(res, [row], receiptFileName(row));
    }),
  );

  api.post(
    '/receipts/bulk-pdf',
    guard(async (req, res) => {
      const ids = (req.body?.ids ?? []).map(Number).filter(Number.isFinite);
      const rows = ids.map((id) => loadReceipt(id)).filter(Boolean);
      const name = `Cash_Memer_${rows.length}_receipts.pdf`;
      await sendPdf(res, rows, name);
    }),
  );

  /* ---- the weekly card -------------------------------------------------- */

  api.get(
    '/summary/weekly',
    guard(async (req, res) => {
      res.json(weeklySummary());
    }),
  );

  api.post(
    '/summary/insight',
    guard(async (req, res) => {
      const summary = weeklySummary();
      if (!env.geminiApiKey) {
        // The six numbers are already on screen. This endpoint only ever adds
        // a sentence on top, so a missing key is information, not a failure.
        res.json({
          ready: false,
          missing: 'GEMINI_API_KEY',
          where: 'https://aistudio.google.com/apikey',
          message:
            'The weekly numbers above are worked out on this computer and are always correct. ' +
            'The extra sentence of interpretation needs a free Gemini key: put GEMINI_API_KEY in your .env file and restart.',
          summary,
        });
        return;
      }

      const prompt =
        'You are helping a small shopkeeper in Lahore read their week. In ONE plain sentence, ' +
        'under 30 words, say the single most useful thing about these figures. No greeting, no ' +
        'markdown, no numbers the shopkeeper can already see.\n' +
        JSON.stringify(summary);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        res.json({
          ready: false,
          message: `Gemini refused the request (${response.status}). The numbers above are unaffected. ${detail.slice(0, 200)}`,
          summary,
        });
        return;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      res.json({ ready: Boolean(text), insight: text, summary });
    }),
  );

  /* ---- dashboard --------------------------------------------------------- */

  api.get(
    '/dashboard',
    guard(async (req, res) => {
      res.json(dashboard());
    }),
  );

  /* ---- rates -------------------------------------------------------------- */

  api.get(
    '/rates',
    guard(async (req, res) => {
      const custom = db.prepare('SELECT * FROM custom_rates ORDER BY code').all();

      if (!env.exchangeRateApiKey) {
        res.json({
          ready: false,
          missing: 'EXCHANGE_RATE_API_KEY',
          where: 'https://www.exchangerate-api.com',
          message:
            'Live rates need a free key from exchangerate-api.com. Put EXCHANGE_RATE_API_KEY in your ' +
            '.env file and restart. Custom rates you enter by hand below work without it.',
          base: 'USD',
          rates: {},
          custom,
          fetchedAt: null,
        });
        return;
      }

      const cached = getSetting_ratesCache();
      const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < 3600 * 1000;
      if (fresh && !req.query.refresh) {
        res.json({ ready: true, ...cached, rates: withDerivedRates(cached.rates), custom });
        return;
      }

      try {
        const r = await fetch(
          `https://v6.exchangerate-api.com/v6/${encodeURIComponent(env.exchangeRateApiKey)}/latest/USD`,
        );
        const data = await r.json();
        if (data.result !== 'success') {
          throw new Error(data['error-type'] ?? `HTTP ${r.status}`);
        }
        const payload = { base: 'USD', rates: data.conversion_rates, fetchedAt: nowIso() };
        setSetting('ratesCache', payload);
        res.json({ ready: true, ...payload, rates: withDerivedRates(payload.rates), custom });
      } catch (err) {
        // A rate screen that has gone stale is far better than one that is blank.
        res.json({
          ready: Boolean(cached),
          error: `Could not reach exchangerate-api.com — ${err.message}`,
          ...(cached ?? { base: 'USD', rates: {}, fetchedAt: null }),
          rates: withDerivedRates(cached?.rates ?? {}),
          custom,
          stale: Boolean(cached),
        });
      }
    }),
  );

  api.post(
    '/rates/custom',
    guard(async (req, res) => {
      const b = req.body ?? {};
      const code = str(b.code).trim().toUpperCase();
      if (!code) throw new Error('A custom currency needs a code, for example "GOLD".');
      db.prepare(
        `INSERT INTO custom_rates (code, name, rate, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, rate = excluded.rate`,
      ).run(code, str(b.name), num(b.rate), nowIso());
      res.json(db.prepare('SELECT * FROM custom_rates ORDER BY code').all());
    }),
  );

  api.delete(
    '/rates/custom/:code',
    guard(async (req, res) => {
      db.prepare('DELETE FROM custom_rates WHERE code = ?').run(str(req.params.code).toUpperCase());
      res.json(db.prepare('SELECT * FROM custom_rates ORDER BY code').all());
    }),
  );

  /* ---- phone pairing -------------------------------------------------------- */

  api.post(
    '/pair',
    guard(async (req, res) => {
      const pairing = createPairing();

      // Where to send the phone. Hosted, it is the public https address the
      // request actually came in on (read from the proxy headers, falling back
      // to the configured PUBLIC_URL) — so the QR always points at the real
      // site. On your own computer it is the Wi-Fi https address, because a
      // phone browser will not open its camera on a plain http LAN address.
      let base;
      let insecureUrl;
      if (urls.hosted) {
        const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim() || req.protocol || 'https';
        const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host;
        base = host ? `${proto}://${host}` : urls.publicUrl;
        insecureUrl = `${base}/scan?code=${pairing.code}`; // one address only, already https
      } else {
        base = urls.phoneBase;
        insecureUrl = `${urls.lanHttp}/scan?code=${pairing.code}`;
      }

      const url = `${base}/scan?code=${encodeURIComponent(pairing.code)}`;
      const qr = await QRCode.toDataURL(url, { margin: 1, scale: 6 });
      res.json({ code: pairing.code, url, qr, insecureUrl });
    }),
  );

  api.get(
    '/pair/:code/status',
    guard(async (req, res) => res.json(pairingStatus(str(req.params.code)))),
  );

  /* ---- the in-progress sale ---------------------------------------------- */

  api.get(
    '/draft',
    guard(async (req, res) => {
      const row = db.prepare("SELECT * FROM drafts WHERE id = 'current'").get();
      res.json(row ? { payload: JSON.parse(row.payload), updatedAt: row.updated_at } : null);
    }),
  );

  api.put(
    '/draft',
    guard(async (req, res) => {
      db.prepare(
        `INSERT INTO drafts (id, payload, updated_at) VALUES ('current', ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      ).run(JSON.stringify(req.body ?? {}), nowIso());
      res.json({ ok: true });
    }),
  );

  api.delete(
    '/draft',
    guard(async (req, res) => {
      db.prepare("DELETE FROM drafts WHERE id = 'current'").run();
      res.json({ ok: true });
    }),
  );

  /* ---- backup -------------------------------------------------------------- */

  api.get(
    '/backup/export',
    guard(async (req, res) => {
      const payload = exportDatabase();
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="cashmemer-backup-${stamp}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    }),
  );

  api.post(
    '/backup/import',
    guard(async (req, res) => {
      const mode = str(req.body?.mode, 'replace');
      const counts = importDatabase(req.body?.payload, { mode });
      res.json({ ok: true, mode, counts });
    }),
  );

  api.post(
    '/backup/run',
    guard(async (req, res) => res.json(await runBackupNow())),
  );

  api.get(
    '/backup/status',
    guard(async (req, res) => {
      const s = allSettings();
      res.json({
        enabled: Boolean(s.backupEnabled),
        folder: s.backupFolder ?? '',
        lastBackupAt: s.lastBackupAt ?? '',
        lastBackupError: s.lastBackupError ?? '',
        keep: KEEP_SNAPSHOTS,
      });
    }),
  );

  /* ---- the lock on the till -------------------------------------------------- */

  /** Who is knocking, for the purpose of slowing down repeated guesses. */
  const whoIs = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

  api.get(
    '/auth/state',
    guard(async (req, res) => {
      res.json({
        hasPasscode: hasPasscode(),
        signedIn: isSignedIn(req),
        devices: sessionCount(),
      });
    }),
  );

  /** First run only: choose the passcode. Refused once one exists. */
  api.post(
    '/auth/setup',
    guard(async (req, res) => {
      if (hasPasscode()) {
        res.status(400).json({
          error: 'A passcode is already set. Change it in Settings once you are signed in.',
        });
        return;
      }
      setPasscode(str(req.body?.passcode));
      const { token, expires } = createSession(str(req.body?.label));
      setSessionCookie(res, token, expires);
      res.json({ ok: true });
    }),
  );

  api.post(
    '/auth/login',
    guard(async (req, res) => {
      const who = whoIs(req);

      // Someone sitting on your Wi-Fi trying codes gets slower and slower.
      const wait = lockoutRemainingMs(who);
      if (wait > 0) {
        res.status(429).json({
          error: `Too many wrong tries. Wait ${Math.ceil(wait / 1000)} seconds and try again.`,
        });
        return;
      }

      if (!passcodeMatches(str(req.body?.passcode))) {
        const nextWait = recordMiss(who);
        res.status(401).json({
          error: nextWait
            ? `Wrong passcode. Next try in ${Math.ceil(nextWait / 1000)} seconds.`
            : 'Wrong passcode.',
        });
        return;
      }

      clearMisses(who);
      const { token, expires } = createSession(str(req.body?.label));
      setSessionCookie(res, token, expires);
      res.json({ ok: true });
    }),
  );

  api.post(
    '/auth/lock',
    guard(async (req, res) => {
      destroySession(readCookie(req, COOKIE_NAME));
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  /** Changing the passcode signs every device out. That is the point of it. */
  api.post(
    '/auth/passcode',
    guard(async (req, res) => {
      if (hasPasscode() && !passcodeMatches(str(req.body?.current))) {
        res.status(401).json({ error: 'That is not your current passcode.' });
        return;
      }
      setPasscode(str(req.body?.passcode));
      const { token, expires } = createSession('this device');
      setSessionCookie(res, token, expires);
      res.json({ ok: true, signedOutOthers: true });
    }),
  );

  /** Sign every device out, including this one. For a lost or stolen phone. */
  api.post(
    '/auth/sign-out-everywhere',
    guard(async (req, res) => {
      destroyAllSessions();
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  /* ---- Google sign-in ------------------------------------------------------- */

  api.get(
    '/auth/status',
    guard(async (req, res) => {
      const s = allSettings();
      res.json({
        configured: Boolean(env.googleClientId && env.googleClientSecret),
        account: s.account ?? null,
        where: 'https://console.cloud.google.com/apis/credentials',
        redirectUri: `${urls.localHttp}/api/auth/google/callback`,
      });
    }),
  );

  api.get(
    '/auth/google',
    guard(async (req, res) => {
      if (!env.googleClientId) {
        res.status(400).send(
          'Google sign-in is not set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your ' +
            '.env file and restart. Everything else in the app works without it.',
        );
        return;
      }
      const params = new URLSearchParams({
        client_id: env.googleClientId,
        redirect_uri: `${urls.localHttp}/api/auth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'offline',
        prompt: 'select_account',
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    }),
  );

  api.get(
    '/auth/google/callback',
    guard(async (req, res) => {
      const code = str(req.query.code);
      if (!code) {
        res.status(400).send('Google did not send a sign-in code back. Close this tab and try again.');
        return;
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: `${urls.localHttp}/api/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const detail = await tokenRes.text().catch(() => '');
        res.status(400).send(
          `Google would not complete the sign-in (${tokenRes.status}). The usual cause is that ` +
            `${urls.localHttp}/api/auth/google/callback is not listed as an Authorised redirect URI ` +
            `on your OAuth client. ${detail.slice(0, 300)}`,
        );
        return;
      }

      const tokens = await tokenRes.json();
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const info = await infoRes.json();

      const account = { name: info.name ?? '', email: info.email ?? '', picture: info.picture ?? '' };
      setSetting('account', account);
      // Page 2 names the account that issued the memo.
      if (!allSettings().issuerName) setSetting('issuerName', account.name);
      if (!allSettings().issuerEmail) setSetting('issuerEmail', account.email);

      res.redirect('/?signedin=1');
    }),
  );

  api.post(
    '/auth/signout',
    guard(async (req, res) => {
      setSetting('account', null);
      res.json({ ok: true });
    }),
  );

  return api;
}

/* ------------------------------------------------------------------ *
 * things the endpoints lean on
 * ------------------------------------------------------------------ */

function getSetting_ratesCache() {
  const s = allSettings();
  return s.ratesCache ?? null;
}

/** Selling reduces stock; a product with no barcode match is left alone. */
function reduceStockForItems(items) {
  const stmt = db.prepare('UPDATE products SET stock = MAX(stock - ?, 0), updated_at = ? WHERE id = ?');
  const find = db.prepare('SELECT id FROM products WHERE name = ? COLLATE NOCASE AND archived = 0');
  for (const item of Array.isArray(items) ? items : []) {
    const name = str(item.name).trim();
    if (!name) continue;
    const product = item.productId
      ? { id: Number(item.productId) }
      : find.get(name);
    if (product?.id) stmt.run(num(item.qty, 1), nowIso(), product.id);
  }
}

/**
 * The last seven days, always — the card ignores whatever filter History has
 * on it, because "this week" should not change meaning when you search.
 */
export function weeklySummary() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rows = db
    .prepare('SELECT * FROM receipts WHERE created_at >= ? ORDER BY created_at DESC')
    .all(since)
    .map(receiptWithItems);

  let totalSpend = 0;
  let totalTax = 0;
  let totalDiscount = 0;
  const byCustomer = new Map();

  for (const r of rows) {
    totalSpend += r.totals.grandTotal;
    totalTax += r.totals.tax;
    totalDiscount += r.totals.discount;
    const name = (r.customer_name || '').trim();
    if (name) byCustomer.set(name, (byCustomer.get(name) ?? 0) + r.totals.grandTotal);
  }

  const topCustomer = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    from: since,
    totalSpend,
    transactions: rows.length,
    averageValue: rows.length ? totalSpend / rows.length : 0,
    topCustomer: topCustomer ? { name: topCustomer[0], total: topCustomer[1] } : null,
    totalTax,
    totalDiscount,
    currency: allSettings().defaultCurrency ?? 'PKR',
  };
}

export function dashboard() {
  const receipts = db.prepare('SELECT * FROM receipts ORDER BY created_at').all().map(receiptWithItems);
  const products = db.prepare('SELECT * FROM products').all();

  const totals = receipts.map((r) => r.totals.grandTotal);
  const sum = totals.reduce((a, b) => a + b, 0);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const inRange = (r, from) => new Date(r.created_at).getTime() >= from.getTime();
  const todayReceipts = receipts.filter((r) => inRange(r, startOfToday));
  const monthReceipts = receipts.filter((r) => inRange(r, startOfMonth));

  const byStore = new Map();
  const byCategory = new Map();
  const byProduct = new Map();
  for (const r of receipts) {
    const store = (r.place || r.title || 'Unnamed').trim();
    byStore.set(store, (byStore.get(store) ?? 0) + r.totals.grandTotal);
    const cat = r.category || 'Other';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.totals.grandTotal);
    for (const item of r.items) {
      byProduct.set(item.name, (byProduct.get(item.name) ?? 0) + item.qty);
    }
  }

  const sortDesc = (map) =>
    [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // Sales per day for the last 30 days, zero-filled so the chart has no holes.
  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const value = receipts
      .filter((r) => String(r.created_at).slice(0, 10) === key)
      .reduce((a, r) => a + r.totals.grandTotal, 0);
    days.push({ label: key, value });
  }

  const storageBytes = (() => {
    try {
      const page = db.prepare('PRAGMA page_count').get();
      const size = db.prepare('PRAGMA page_size').get();
      return (page.page_count ?? 0) * (size.page_size ?? 0);
    } catch {
      return 0;
    }
  })();

  return {
    currency: allSettings().defaultCurrency ?? 'PKR',
    totalReceipts: receipts.length,
    totalProducts: products.filter((p) => !p.archived).length,
    totalSpending: sum,
    averageReceipt: receipts.length ? sum / receipts.length : 0,
    highestReceipt: totals.length ? Math.max(...totals) : 0,
    lowestReceipt: totals.length ? Math.min(...totals) : 0,
    averageProductCost: products.length
      ? products.reduce((a, p) => a + p.cost_price, 0) / products.length
      : 0,
    todayTotal: todayReceipts.reduce((a, r) => a + r.totals.grandTotal, 0),
    todayCount: todayReceipts.length,
    monthTotal: monthReceipts.reduce((a, r) => a + r.totals.grandTotal, 0),
    uniqueStores: byStore.size,
    mostVisitedStore: sortDesc(byStore)[0]?.label ?? null,
    topProduct: sortDesc(byProduct)[0]?.label ?? null,
    storageBytes,
    pendingSync: receipts.filter((r) => !r.synced).length,
    topStores: sortDesc(byStore).slice(0, 5),
    byCategory: sortDesc(byCategory),
    salesOverTime: days,
  };
}
