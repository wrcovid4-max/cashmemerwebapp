/**
 * What is on page 1 and what is on page 2.
 *
 * This is the check that matters for privacy: page 1 is handed across the
 * counter, so it must carry the customer's NAME and nothing else about them —
 * no phone, no email, no address — and neither the page-2 note nor the account
 * that issued it. Page 2 is the shop's own copy and must carry everything.
 *
 * It reads the text back out of the generated PDF rather than trusting the
 * layout code, by decoding the font's ToUnicode map — so it is checking what a
 * customer could actually read off the paper.
 *
 * Needs nothing but Node:  node test/pdf-pages.mjs
 */
import { inflateSync } from 'node:zlib';
import { renderReceiptPdf, receiptFileName } from '../server/pdf.js';

let failures = 0;
const ok = (label, pass) => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
};

/* ------------------------------------------------------------------ *
 * a small PDF text extractor
 * ------------------------------------------------------------------ */

function parseObjects(buf) {
  const objects = new Map();
  const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  const text = buf.toString('latin1');
  let m;
  while ((m = re.exec(text))) objects.set(Number(m[1]), m[2]);
  return objects;
}

function streamOf(body, buf) {
  const start = body.indexOf('stream');
  if (start === -1) return null;
  const text = buf.toString('latin1');
  const at = text.indexOf(body);
  const from = text.indexOf('stream', at) + 'stream'.length;
  const begin = text[from] === '\r' ? from + 2 : from + 1;
  const end = text.indexOf('endstream', begin);
  const raw = Buffer.from(text.slice(begin, end), 'latin1');
  try {
    return inflateSync(raw).toString('latin1');
  } catch {
    return raw.toString('latin1');
  }
}

/** A hex destination, which may be several UTF-16 units (e.g. an ligature). */
function decodeHex(hex) {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

/**
 * Builds glyph-id -> character from a font's ToUnicode CMap.
 *
 * bfrange has two forms and PDFKit uses the second one:
 *   <lo> <hi> <base>              every code in the range, counting up
 *   <lo> <hi> [<d0> <d1> …]       one destination listed per code
 */
function toUnicodeMap(cmap) {
  const map = new Map();

  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), decodeHex(m[2]));
    }
  }

  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const entry = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([\s\S]*?)\]|<([0-9A-Fa-f]+)>)/g;
    for (const m of block.matchAll(entry)) {
      const start = parseInt(m[1], 16);
      const end = parseInt(m[2], 16);

      if (m[3] !== undefined) {
        const list = [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((d) => d[1]);
        for (let i = 0; i <= end - start && i < list.length; i += 1) {
          map.set(start + i, decodeHex(list[i]));
        }
      } else {
        const base = parseInt(m[4].slice(0, 4), 16);
        for (let i = start; i <= end; i += 1) {
          map.set(i, String.fromCharCode(base + (i - start)));
        }
      }
    }
  }
  return map;
}

/**
 * Glyph ids are numbered per font, and the memo uses two (regular and bold),
 * so /F3 glyph 1 and /F4 glyph 1 are different letters. The current font has
 * to be tracked through the stream or the text comes out as nonsense.
 *
 * @returns {string[]} the readable text of each page, in order
 */
function textPerPage(buf) {
  const objects = parseObjects(buf);

  /** font object number -> (glyph id -> character) */
  const mapsByObject = new Map();
  const unicodeFor = (fontObj) => {
    if (mapsByObject.has(fontObj)) return mapsByObject.get(fontObj);
    const body = objects.get(fontObj) ?? '';
    const ref = Number(body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/)?.[1]);
    const map = ref ? toUnicodeMap(streamOf(objects.get(ref) ?? '', buf) ?? '') : new Map();
    mapsByObject.set(fontObj, map);
    return map;
  };

  const pages = [];
  for (const [, body] of objects) {
    if (!body.includes('/Type /Page') || body.includes('/Pages')) continue;

    // /Resources is usually a reference to its own object, not written inline.
    const resourcesRef = Number(body.match(/\/Resources\s+(\d+)\s+0\s+R/)?.[1]);
    const resources = resourcesRef
      ? (objects.get(resourcesRef) ?? '')
      : (body.match(/\/Resources\s*<<([\s\S]*?)>>\s*\n/)?.[1] ?? '');

    // /Font <</F3 12 0 R /F4 15 0 R>>
    const fontRefs = new Map();
    const fontDict = resources.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? '';
    for (const m of fontDict.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      fontRefs.set(m[1], Number(m[2]));
    }

    const contents = Number(body.match(/\/Contents\s+(\d+)\s+0\s+R/)?.[1]);
    const stream = streamOf(objects.get(contents) ?? '', buf) ?? '';

    let current = new Map();
    let out = '';

    // PDFKit emits "/F3 19 Tf" to pick a font, then "[<hex> 0] TJ" to draw.
    for (const m of stream.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>/g)) {
      if (m[1]) {
        current = unicodeFor(fontRefs.get(m[1]));
        continue;
      }
      const hex = m[2];
      for (let i = 0; i + 4 <= hex.length; i += 4) {
        out += current.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
      }
      out += '\n';
    }
    pages.push(out);
  }
  return pages;
}

/* ------------------------------------------------------------------ *
 * the receipt under test — every field populated
 * ------------------------------------------------------------------ */

const receipt = {
  number: 41,
  title: 'Mart (Example)',
  place: 'Mart (Example)',
  location_address: '265 Street 160, Sector L Dha Phase 1, Lahore, Pakistan',
  lat: 31.479918,
  lng: 74.400637,
  customer_name: 'Umer Butt',
  customer_phone: '03044545431',
  customer_email: 'customer.private@example.com',
  customer_address: '265/1 Sector L, Phase 1, Street 160, DHA Lahore',
  currency: 'PKR',
  category: 'Shopping',
  payment_method: 'Cash',
  discount: 50,
  tax_percent: 15,
  tax_base: 'after-discount',
  cash_given: 500,
  note1: 'Thank You for shopping !!!',
  note2: 'PRIVATE NOTE FOR ME ONLY',
  signature: '',
  issuer_name: 'Umer Butt',
  issuer_email: 'issuer.account@example.com',
  created_at: '2026-08-01T22:28:03',
  items: [{ name: 'Courasant', qty: 5, price: 12 }],
};

const buf = await renderReceiptPdf(receipt);
const pages = textPerPage(buf);

ok(`every receipt is two pages (got ${pages.length})`, pages.length === 2);

const [page1, page2] = pages;
const squash = (s) => s.replace(/\s+/g, '');
const p1 = squash(page1 ?? '');
const p2 = squash(page2 ?? '');

console.log('\n-- page 1 must NOT reveal these --');
ok('no customer phone number', !p1.includes('03044545431'));
ok('no customer email', !p1.includes('customer.private@example.com'));
ok('no customer address', !p1.includes('265/1SectorL'));
ok('no page-2 note', !p1.includes('PRIVATENOTEFORMEONLY'));
ok('no issuer account name label', !p1.includes('IssuerAccount'));
ok('no issuer email', !p1.includes('issuer.account@example.com'));

console.log('\n-- page 1 must show these --');
ok('the customer name', p1.includes('Customer:UmerButt'));
ok('the heading', p1.includes('CASHMEMO'));
ok('the receipt number', p1.includes('#41'));
ok('the item', p1.includes('Courasant'));
ok('the grand total', p1.includes('GRANDTOTAL'));
ok('note 1', p1.includes('ThankYouforshopping'));
ok('the saved location', p1.includes('265Street160'));
ok('the GPS coordinates', p1.includes('31.479918'));

console.log('\n-- page 2 must show everything --');
ok('marked as page 2', p2.includes('CASHMEMO(Page2)'));
ok('customer name', p2.includes('Name:UmerButt'));
ok('customer phone', p2.includes('03044545431'));
ok('customer email', p2.includes('customer.private@example.com'));
ok('customer address', p2.includes('265/1SectorL'));
ok('note 1 as well', p2.includes('ThankYouforshopping'));
ok('note 2', p2.includes('PRIVATENOTEFORMEONLY'));
ok('the saved location', p2.includes('265Street160'));
ok('the GPS coordinates', p2.includes('31.479918'));
ok('issuer account name', p2.includes('Name:UmerButt'));
ok('issuer email', p2.includes('issuer.account@example.com'));
ok('the items', p2.includes('Courasant'));
ok('the totals', p2.includes('GRANDTOTAL'));

console.log('\n-- the download name --');
const name = receiptFileName(receipt, new Date('2026-08-01T22:32:29'));
ok(
  `matches the shop's convention (${name})`,
  name === 'Receipt_41___Mart_Example___20260801_22_32_29___Cash_Memer.pdf',
);

console.log(failures === 0 ? '\nAll page-content checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
