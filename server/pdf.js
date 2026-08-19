/**
 * The printed cash memo.
 *
 * This is a deliberate, measured copy of the memo the Android app produces —
 * same 600-point-wide continuous page, same off-white paper on a beige border,
 * same navy "CASH MEMO" heading, same double rules, same wording. The
 * measurements in LAYOUT below were taken off the sample PDF pixel by pixel,
 * not guessed.
 *
 * Every receipt is ALWAYS two pages, and they are deliberately different:
 *
 *   Page 1 is the customer's copy. It carries their name and their email —
 *          enough to identify the sale and send the memo on — but never their
 *          phone number or home address, never the page-2 note, and never the
 *          issuing account. It is handed across a counter, and a customer's
 *          phone number should not be on a piece of paper that ends up in
 *          someone else's pocket.
 *   Page 2 is the shop's copy, and it holds everything: full customer details,
 *          where the sale happened and its coordinates, BOTH notes, and the
 *          issuing account name and email.
 *
 * The page is as tall as its contents. That is how the sample is built (its two
 * pages are 1355pt and 1435pt tall) and it is what a receipt wants to be — one
 * continuous strip, not a sheet of A4 with a lake of white space underneath.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fontkit from 'fontkit';
import { FONTS_DIR } from './paths.js';
import { computeTotals, lineTotal } from '../shared/totals.js';
import { currencySymbol, formatAmount } from '../shared/currency.js';
import { staticMapImage } from './maps.js';

/* ------------------------------------------------------------------ *
 * Fonts
 *
 * Liberation Sans is metric-compatible with Arial, which is what the sample
 * was set in. It also carries the ₨ sign. DejaVu is the fallback for the odd
 * currency symbol Liberation is missing (₹, ৳, ฿ …) — the whole document
 * switches to it rather than mixing two typefaces on one page.
 * ------------------------------------------------------------------ */

const FONT_SETS = [
  {
    name: 'liberation',
    regular: join(FONTS_DIR, 'LiberationSans-Regular.ttf'),
    bold: join(FONTS_DIR, 'LiberationSans-Bold.ttf'),
  },
  {
    name: 'dejavu',
    regular: join(FONTS_DIR, 'DejaVuSans.ttf'),
    bold: join(FONTS_DIR, 'DejaVuSans.ttf'),
  },
];

const coverageCache = new Map();

function coverageOf(file) {
  if (coverageCache.has(file)) return coverageCache.get(file);
  let has = () => true;
  try {
    const font = fontkit.openSync(file);
    has = (cp) => {
      try {
        return font.hasGlyphForCodePoint(cp);
      } catch {
        return false;
      }
    };
  } catch {
    /* If the font will not open, assume it copes; PDFKit will complain later. */
  }
  coverageCache.set(file, has);
  return has;
}

/** Picks the first bundled font that can draw every character in the memo. */
function chooseFontSet(sampleText) {
  const codepoints = [...new Set([...sampleText].map((ch) => ch.codePointAt(0)))];
  for (const set of FONT_SETS) {
    if (!existsSync(set.regular) || !existsSync(set.bold)) continue;
    const has = coverageOf(set.regular);
    if (codepoints.every((cp) => cp < 32 || has(cp))) return set;
  }
  return FONT_SETS.find((s) => existsSync(s.regular)) ?? null;
}

/* ------------------------------------------------------------------ *
 * Layout — every number here was measured off the sample PDF
 * ------------------------------------------------------------------ */

const LAYOUT = {
  pageWidth: 600,
  paperInset: 6, // beige border around the paper
  left: 40,
  right: 560,

  colors: {
    border: '#DCDCD2', // the beige edge
    paper: '#FAF9F6', // the off-white memo itself
    ink: '#000000',
    title: '#102C57', // deep navy of "CASH MEMO"
    subtitle: '#505050', // store name under the title
    muted: '#8A8A8A', // "@ Rs12.00 each"
    footer: '#676767', // the two closing lines
    boxLine: '#CFCFCF', // hairline round the signature and QR boxes
    boxFill: '#FFFFFF',
  },

  size: {
    title: 37,
    subtitle: 19,
    body: 19,
    item: 18,
    itemSub: 14,
    grand: 22,
    address: 17,
    footerSmall: 15,
    footerBig: 19,
  },

  // Vertical rhythm, all measured.
  topToTitleBaseline: 59,
  titleToSubtitle: 40,
  gapAfterDoubleRule: 31, // rule bottom -> next baseline
  gapAfterRule: 33, // rule bottom -> next baseline
  gapBeforeRule: 23, // last baseline -> rule top
  metaRowHeight: 35,
  totalRowHeight: 35,
  addressRowHeight: 25,
  itemNameToSub: 26,
  itemBlockGap: 35,

  ruleThickness: 2,
  doubleRuleGap: 2, // 2pt line, 2pt gap, 2pt line

  signatureBox: { width: 140, height: 60 },
  qrBox: { size: 120, pad: 10 },

  bottomPadding: 88, // ink of the last line -> bottom of the paper
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function safe(v) {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * The memo writes money as "₨ 60.00" — symbol, one space, amount. Kept
 * separate from formatMoney only so the sign can be drawn in the same run.
 */
function money(value, code) {
  return `${currencySymbol(code)} ${formatAmount(value)}`;
}

function two(n) {
  return String(n).padStart(2, '0');
}

/** The memo shows local date and time, as the shop experienced them. */
export function receiptDateParts(iso) {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return { date, time };
}

/**
 * The download name, in the same shape as the sample:
 *   Receipt_41___Mart_Example___20260801_22_32_29___Cash_Memer.pdf
 *
 * Every run of characters that is not a letter or a digit collapses to one
 * underscore, and the three parts are joined by a triple underscore. Nothing
 * in here can produce a path separator, so this is always safe as a filename.
 */
export function receiptFileName(receipt, at = new Date()) {
  const clean = (s) =>
    safe(s)
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_');

  const stamp =
    `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}` +
    `_${two(at.getHours())}_${two(at.getMinutes())}_${two(at.getSeconds())}`;

  const parts = [
    clean(`Receipt ${receipt.number ?? ''}`),
    clean(receipt.place || receipt.title || 'Cash Memo'),
    stamp,
    'Cash_Memer',
  ].filter(Boolean);

  return `${parts.join('___')}.pdf`;
}

/**
 * What the QR carries. Short on purpose — a dense code will not survive being
 * printed on thermal paper. Pipe-separated, uppercase-friendly, no JSON.
 */
export function qrPayload(receipt, totals) {
  const { date, time } = receiptDateParts(receipt.created_at);
  return [
    `CM#${receipt.number}`,
    safe(receipt.place || receipt.title).slice(0, 40),
    `${receipt.currency} ${formatAmount(totals.grandTotal)}`,
    `${date} ${time}`,
  ].join('|');
}

/* ------------------------------------------------------------------ *
 * The renderer
 * ------------------------------------------------------------------ */

class MemoPage {
  /**
   * @param {PDFKit.PDFDocument} doc
   * @param {{draw: boolean, fonts: {regular: string, bold: string}}} opts
   */
  constructor(doc, opts) {
    this.doc = doc;
    this.draw = opts.draw;
    this.fonts = opts.fonts;
    this.y = 0;
    this.lastRuleWasDouble = false;
  }

  /**
   * How far below the last separator the next baseline sits. A heavy rule sits
   * slightly tighter to what follows it than a light one, which is what the
   * sample does; keeping it in one place means a section that becomes optional
   * (no note, no location) still lands on the right line.
   */
  gapAfterLastRule() {
    return this.lastRuleWasDouble ? LAYOUT.gapAfterDoubleRule : LAYOUT.gapAfterRule;
  }

  font(bold, size) {
    this.doc.font(bold ? this.fonts.bold : this.fonts.regular).fontSize(size);
    return this;
  }

  widthOf(text, bold, size) {
    this.font(bold, size);
    return this.doc.widthOfString(safe(text));
  }

  /**
   * PDFKit places text by its top edge; the measurements are baselines, so
   * everything goes through here. Using the real font ascent keeps the
   * baseline honest across font sizes.
   */
  atBaseline(text, x, baseline, { bold = false, size = LAYOUT.size.body, color = LAYOUT.colors.ink, align = 'left', width = null } = {}) {
    if (!this.draw) return;
    this.font(bold, size);
    const ascent = (this.doc._font.ascender / 1000) * size;
    const top = baseline - ascent;
    this.doc.fillColor(color);
    if (align === 'left' && width === null) {
      this.doc.text(safe(text), x, top, { lineBreak: false });
    } else {
      this.doc.text(safe(text), x, top, { width: width ?? LAYOUT.right - x, align, lineBreak: false });
    }
  }

  /** Label on the left, value hard against the right edge. */
  labelValue(label, value, baseline, { bold = false, size = LAYOUT.size.body, color = LAYOUT.colors.ink } = {}) {
    this.atBaseline(label, LAYOUT.left, baseline, { bold, size, color });
    const w = this.widthOf(value, bold, size);
    this.atBaseline(value, LAYOUT.right - w, baseline, { bold, size, color });
  }

  /** Two labels on one line: one left, one right. Used by the meta block. */
  leftRight(leftText, rightText, baseline, size = LAYOUT.size.body) {
    this.atBaseline(leftText, LAYOUT.left, baseline, { bold: false, size });
    if (rightText) {
      const w = this.widthOf(rightText, false, size);
      this.atBaseline(rightText, LAYOUT.right - w, baseline, { bold: false, size });
    }
  }

  rule(thickness = LAYOUT.ruleThickness) {
    if (this.draw) {
      this.doc
        .rect(LAYOUT.left, this.y, LAYOUT.right - LAYOUT.left, thickness)
        .fillColor(LAYOUT.colors.ink)
        .fill();
    }
    this.y += thickness;
    this.lastRuleWasDouble = false;
  }

  /** The heavy separator: 2pt line, 2pt gap, 2pt line. */
  doubleRule() {
    this.rule();
    this.y += LAYOUT.doubleRuleGap;
    this.rule();
    this.lastRuleWasDouble = true;
  }

  /** Splits text to fit a width, breaking on spaces, then on characters. */
  wrap(text, width, bold, size) {
    this.font(bold, size);
    const words = safe(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (this.doc.widthOfString(attempt) <= width || !line) {
        // A single word longer than the line still has to go somewhere.
        if (this.doc.widthOfString(attempt) > width && !line) {
          let chunk = '';
          for (const ch of word) {
            if (this.doc.widthOfString(chunk + ch) > width && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
          continue;
        }
        line = attempt;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  box(x, y, w, h) {
    if (!this.draw) return;
    this.doc.rect(x, y, w, h).fillColor(LAYOUT.colors.boxFill).fill();
    this.doc.rect(x + 0.5, y + 0.5, w - 1, h - 1).lineWidth(1).strokeColor(LAYOUT.colors.boxLine).stroke();
  }
}

/**
 * Lays out one page. Runs twice: once to find out how tall the page is, and
 * once to actually draw it.
 *
 * @returns {number} the height the page needs
 */
function layoutPage(doc, receipt, totals, qrImage, { page, draw, fonts, mapImage = null }) {
  const P = new MemoPage(doc, { draw, fonts });
  const L = LAYOUT;
  const cur = receipt.currency;
  const { date, time } = receiptDateParts(receipt.created_at);
  const isPage2 = page === 2;

  if (draw) {
    // The page background is drawn by the caller, which knows the final height.
  }

  /* --- masthead ------------------------------------------------------ */
  let baseline = L.topToTitleBaseline;
  P.atBaseline(isPage2 ? 'CASH MEMO (Page 2)' : 'CASH MEMO', L.left, baseline, {
    bold: true,
    size: L.size.title,
    color: L.colors.title,
    align: 'center',
    width: L.right - L.left,
  });

  baseline += L.titleToSubtitle;
  P.atBaseline(receipt.place || receipt.title || '', L.left, baseline, {
    bold: true,
    size: L.size.subtitle,
    color: L.colors.subtitle,
    align: 'center',
    width: L.right - L.left,
  });

  P.y = baseline + 38;
  P.doubleRule();

  /* --- who / when / how ---------------------------------------------- */
  baseline = P.y + P.gapAfterLastRule();
  P.leftRight(`Receipt No: #${receipt.number}`, `Date: ${date}`, baseline);
  baseline += L.metaRowHeight;
  P.leftRight(`Place/Store: ${safe(receipt.place)}`, `Time: ${time}`, baseline);
  baseline += L.metaRowHeight;
  P.leftRight(`Category: ${safe(receipt.category)}`, `Method: ${safe(receipt.payment_method)}`, baseline);

  if (!isPage2) {
    // The customer's own copy: name, and an email to send it to. Deliberately
    // NOT their phone number or their home address — this sheet is handed
    // across a counter and does not always stay with the person it belongs to.
    baseline += L.metaRowHeight;
    P.atBaseline(`Customer: ${safe(receipt.customer_name)}`, L.left, baseline);
    if (safe(receipt.customer_email).trim()) {
      const lines = P.wrap(
        `Email: ${safe(receipt.customer_email)}`,
        L.right - (L.left + 11),
        false,
        L.size.body,
      );
      lines.forEach((line, i) => {
        baseline += i === 0 ? L.metaRowHeight : L.addressRowHeight;
        P.atBaseline(line, L.left + 11, baseline, { size: L.size.body });
      });
    }
  } else {
    baseline += L.metaRowHeight;
    P.atBaseline('Customer Details:', L.left, baseline);
    const details = [
      ['Name', receipt.customer_name],
      ['Phone', receipt.customer_phone],
      ['Email', receipt.customer_email],
      ['Address', receipt.customer_address],
    ].filter(([, v]) => safe(v).trim());
    for (const [label, value] of details) {
      // A long address is wrapped, not run off the edge of the paper. The
      // sample lets it overflow and clips it mid-word; on the shop's own copy
      // the whole address is the point of printing it.
      const lines = P.wrap(`${label}: ${safe(value)}`, L.right - (L.left + 11), false, L.size.body);
      lines.forEach((line, i) => {
        baseline += i === 0 ? L.metaRowHeight : L.addressRowHeight;
        P.atBaseline(line, L.left + 11, baseline, { size: L.size.body });
      });
    }
  }

  P.y = baseline + L.gapBeforeRule;
  P.doubleRule();

  /* --- items ---------------------------------------------------------- */
  const qtyX = 381;
  baseline = P.y + P.gapAfterLastRule();
  P.atBaseline('Item', L.left, baseline, { bold: true });
  P.atBaseline('Qty', qtyX, baseline, { bold: true });
  {
    const w = P.widthOf('Total', true, L.size.body);
    P.atBaseline('Total', L.right - w, baseline, { bold: true });
  }

  P.y = baseline + 20;
  P.rule();

  const items = receipt.items ?? [];
  baseline = P.y + P.gapAfterLastRule();
  if (items.length === 0) {
    P.atBaseline('No items', L.left, baseline, { color: L.colors.muted, size: L.size.item });
    P.y = baseline + 20;
  } else {
    items.forEach((item, index) => {
      if (index > 0) baseline += L.itemBlockGap;
      const nameLines = P.wrap(item.name, qtyX - L.left - 12, true, L.size.item);
      nameLines.forEach((line, i) => {
        P.atBaseline(line, L.left, baseline + i * (L.size.item + 5), {
          bold: true,
          size: L.size.item,
        });
      });
      P.atBaseline(String(item.qty), qtyX, baseline, { size: L.size.item });
      const total = money(lineTotal(item), cur);
      const w = P.widthOf(total, false, L.size.item);
      P.atBaseline(total, L.right - w, baseline, { size: L.size.item });

      baseline += (nameLines.length - 1) * (L.size.item + 5);
      baseline += L.itemNameToSub;
      P.atBaseline(`@ ${money(item.price, cur)} each`, L.left + 11, baseline, {
        size: L.size.itemSub,
        color: L.colors.muted,
      });
    });
    P.y = baseline + 35;
  }
  P.rule();

  /* --- the arithmetic -------------------------------------------------- */
  baseline = P.y + P.gapAfterLastRule();
  P.labelValue('Subtotal:', money(totals.subtotal, cur), baseline);
  baseline += L.totalRowHeight;
  P.labelValue('Discount:', `- ${money(totals.discount, cur)}`, baseline);
  baseline += L.totalRowHeight;
  P.labelValue(`Tax (${formatAmount(totals.taxPercent).replace(/\.00$/, '.0')}%):`, `+ ${money(totals.tax, cur)}`, baseline);

  P.y = baseline + 20;
  P.rule();

  baseline = P.y + P.gapAfterLastRule();
  P.labelValue('GRAND TOTAL:', money(totals.grandTotal, cur), baseline, {
    bold: true,
    size: L.size.grand,
  });

  P.y = baseline + 18;
  P.doubleRule();

  baseline = P.y + P.gapAfterLastRule();
  P.labelValue('Cash Given:', money(totals.cashGiven, cur), baseline);
  baseline += L.totalRowHeight;
  P.labelValue('Change Amount:', money(totals.change, cur), baseline);

  P.y = baseline + 23;
  P.doubleRule();

  /* --- notes -----------------------------------------------------------
   * Page 1 shows note 1 only. Page 2 shows both, because it is the shop's
   * own record and note 2 is written for exactly that.
   */
  const notes = isPage2
    ? [
        ['Note:', safe(receipt.note1).trim()],
        ['Note (Page 2):', safe(receipt.note2).trim()],
      ].filter(([, text]) => text)
    : [['Note:', safe(receipt.note1).trim()]].filter(([, text]) => text);

  if (notes.length > 0) {
    baseline = P.y + P.gapAfterLastRule();
    notes.forEach(([label, text], index) => {
      if (index > 0) baseline += L.metaRowHeight;
      P.atBaseline(label, L.left, baseline, { bold: true });
      const lines = P.wrap(text, L.right - L.left - 11, false, L.size.item);
      lines.forEach((line, i) => {
        baseline += i === 0 ? 30 : L.addressRowHeight;
        P.atBaseline(line, L.left + 11, baseline, { size: L.size.item });
      });
    });
    P.y = baseline + 35;
    P.rule();
  }

  /* --- where the sale happened; on both pages ------------------------- */
  const hasLocation = safe(receipt.location_address).trim() || receipt.lat != null;
  if (hasLocation) {
    baseline = P.y + P.gapAfterLastRule();
    P.atBaseline('Saved Location:', L.left, baseline, { bold: true });
    const address = safe(receipt.location_address).trim();
    if (address) {
      const lines = P.wrap(address, L.right - L.left - 11, false, L.size.address);
      lines.forEach((line, i) => {
        baseline += i === 0 ? 29 : L.addressRowHeight;
        P.atBaseline(line, L.left + 11, baseline, { size: L.size.address });
      });
    }
    if (receipt.lat != null && receipt.lng != null) {
      baseline += address ? L.addressRowHeight : 29;
      P.atBaseline(
        `GPS: ${Number(receipt.lat).toFixed(6)}, ${Number(receipt.lng).toFixed(6)}`,
        L.left + 11,
        baseline,
        { size: L.size.address },
      );
    }
    // The map itself — your copy (page 2) only, and only when one was fetched.
    if (isPage2 && mapImage) {
      const mapW = L.right - (L.left + 11);
      const mapH = Math.round(mapW / 2);
      const mapTop = baseline + 12;
      if (draw) {
        try {
          doc.image(mapImage, L.left + 11, mapTop, { fit: [mapW, mapH], align: 'left' });
        } catch {
          /* a bad image must never stop the memo printing */
        }
      }
      baseline = mapTop + mapH;
    }
    P.y = baseline + 36;
    P.rule(1);
  }

  /* --- issuer account (page 2 only) ------------------------------------ */
  if (isPage2 && (safe(receipt.issuer_name).trim() || safe(receipt.issuer_email).trim())) {
    baseline = P.y + P.gapAfterLastRule();
    P.atBaseline('Issuer Account:', L.left, baseline, { bold: true });
    if (safe(receipt.issuer_name).trim()) {
      baseline += 29;
      P.atBaseline(`Name: ${receipt.issuer_name}`, L.left + 11, baseline, { size: L.size.address });
    }
    if (safe(receipt.issuer_email).trim()) {
      baseline += L.addressRowHeight;
      P.atBaseline(`Email: ${receipt.issuer_email}`, L.left + 11, baseline, {
        size: L.size.address,
      });
    }
    P.y = baseline + 36;
    P.rule(1);
  }

  /* --- signature -------------------------------------------------------- */
  const sigTop = P.y;
  const sig = L.signatureBox;
  P.box(L.right - sig.width, sigTop, sig.width, sig.height);
  if (draw && safe(receipt.signature).startsWith('data:image')) {
    try {
      const base64 = receipt.signature.split(',')[1] ?? '';
      const buf = Buffer.from(base64, 'base64');
      doc.image(buf, L.right - sig.width + 4, sigTop + 4, {
        fit: [sig.width - 8, sig.height - 8],
        align: 'center',
        valign: 'center',
      });
    } catch {
      /* A signature that will not decode should not stop the memo printing. */
    }
  }
  P.atBaseline('Authorized Signature:', L.left, sigTop + 37, { bold: true });

  P.y = sigTop + sig.height + 9;
  P.rule();

  /* --- QR and the closing lines ----------------------------------------- */
  const qr = L.qrBox;
  const qrX = Math.round((L.pageWidth - qr.size) / 2);
  const qrY = P.y + 19;
  P.box(qrX, qrY, qr.size, qr.size);
  if (draw && qrImage) {
    try {
      doc.image(qrImage, qrX + qr.pad, qrY + qr.pad, {
        fit: [qr.size - qr.pad * 2, qr.size - qr.pad * 2],
      });
    } catch {
      /* ditto */
    }
  }

  baseline = qrY + qr.size + 22;
  P.atBaseline('Scan QR Code for details', L.left, baseline, {
    bold: true,
    size: L.size.footerSmall,
    color: L.colors.footer,
    align: 'center',
    width: L.right - L.left,
  });

  baseline += 29;
  P.atBaseline('Thank you for shopping with us!', L.left, baseline, {
    bold: true,
    size: L.size.footerBig,
    color: L.colors.footer,
    align: 'center',
    width: L.right - L.left,
  });

  return baseline + L.bottomPadding;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/** Everything that will be drawn, so the right font is chosen once per file. */
function textOfReceipt(receipt) {
  return [
    'CASH MEMO (Page 2) Receipt No Place/Store Category Method Customer Details',
    'Item Qty Total Subtotal Discount Tax GRAND TOTAL Cash Given Change Amount',
    'Note Saved Location GPS Issuer Account Authorized Signature',
    'Scan QR Code for details Thank you for shopping with us!',
    currencySymbol(receipt.currency),
    safe(receipt.place),
    safe(receipt.title),
    safe(receipt.customer_name),
    safe(receipt.customer_phone),
    safe(receipt.customer_email),
    safe(receipt.customer_address),
    safe(receipt.location_address),
    safe(receipt.note1),
    safe(receipt.note2),
    safe(receipt.issuer_name),
    safe(receipt.issuer_email),
    (receipt.items ?? []).map((i) => i.name).join(' '),
  ].join(' ');
}

function totalsOf(receipt) {
  return computeTotals({
    items: receipt.items ?? [],
    discount: receipt.discount,
    taxPercent: receipt.tax_percent,
    cashGiven: receipt.cash_given,
    // The rule this receipt was issued under, not whatever Settings says today.
    taxBase: receipt.tax_base,
  });
}

async function qrImageFor(receipt, totals) {
  try {
    const dataUrl = await QRCode.toDataURL(qrPayload(receipt, totals), {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } catch {
    return null; // No QR is better than no memo.
  }
}

/** The static-map PNG for a receipt's location, or null. Never throws. */
async function mapBufferFor(receipt) {
  if (receipt.lat == null || receipt.lng == null) return null;
  const image = await staticMapImage(receipt.lat, receipt.lng, { width: 600, height: 300 });
  return image?.buffer ?? null;
}

/**
 * Builds one PDF holding any number of memos.
 *
 * Bulk printing goes through here rather than stitching separate files
 * together, so "print 20 receipts" is one job at the printer and one document
 * in the share sheet — and there is no PDF-merging dependency to install.
 *
 * @param {object[]} receipts receipt rows, each with an `items` array
 * @returns {Promise<Buffer>}
 */
export async function renderReceiptsPdf(receipts) {
  const list = (Array.isArray(receipts) ? receipts : [receipts]).filter(Boolean);
  if (list.length === 0) throw new Error('There are no receipts to print.');

  // Always both. Page 1 is the customer's, page 2 is the shop's, and a memo
  // that exists without its own record is not a memo worth keeping.
  const wanted = [1, 2];

  const set = chooseFontSet(list.map(textOfReceipt).join(' '));
  if (!set) {
    throw new Error(
      'No receipt font found. Expected assets/fonts/LiberationSans-Regular.ttf — ' +
        'restore it from git with: git checkout assets/fonts',
    );
  }

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  doc.registerFont('memo', set.regular);
  doc.registerFont('memo-bold', set.bold);
  const fonts = { regular: 'memo', bold: 'memo-bold' };

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const receipt of list) {
    const totals = totalsOf(receipt);
    const qrImage = await qrImageFor(receipt, totals);
    // The map of where the sale happened, for page 2. Null when there is no
    // location, no Maps key, or Google could not be reached — and null is fine,
    // the memo just prints without it.
    const mapImage = await mapBufferFor(receipt);

    for (const page of wanted) {
      // Pass one: how tall does this page need to be?
      const height = Math.ceil(
        layoutPage(doc, receipt, totals, qrImage, { page, draw: false, fonts, mapImage }),
      );

      doc.addPage({ size: [LAYOUT.pageWidth, height], margin: 0 });

      // The beige edge, then the paper on top of it.
      doc.rect(0, 0, LAYOUT.pageWidth, height).fillColor(LAYOUT.colors.border).fill();
      doc
        .rect(
          LAYOUT.paperInset,
          LAYOUT.paperInset,
          LAYOUT.pageWidth - LAYOUT.paperInset * 2,
          height - LAYOUT.paperInset * 2,
        )
        .fillColor(LAYOUT.colors.paper)
        .fill();

      // Pass two: draw it.
      layoutPage(doc, receipt, totals, qrImage, { page, draw: true, fonts });
    }
  }

  doc.end();
  return done;
}

/**
 * Builds the memo for a single receipt.
 *
 * @param {object} receipt a receipt row with an `items` array
 * @returns {Promise<Buffer>}
 */
export function renderReceiptPdf(receipt) {
  return renderReceiptsPdf([receipt]);
}
