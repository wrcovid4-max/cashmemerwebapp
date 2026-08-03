/**
 * The arithmetic on a memo. One implementation, used by the form's live
 * preview, the saved receipt, the printed PDF and the dashboard — so the
 * number on the screen and the number on the paper cannot disagree.
 *
 * Order of operations, which is the order the memo prints them in:
 *
 *   subtotal   = sum of (quantity x price) for every line
 *   discount   = a flat amount off, never more than the subtotal
 *   taxable    = subtotal - discount        (see the note below)
 *   tax        = taxable x (tax% / 100)
 *   grand      = subtotal - discount + tax
 *   change     = cash given - grand, never below zero
 *
 * WHAT THE TAX IS CHARGED ON is a shop-level choice, because it genuinely
 * differs by place:
 *
 *   'after-discount'  (default) tax applies to what the customer actually
 *                     pays. ₨60 less a ₨50 discount at 15% is ₨1.50 of tax.
 *   'before-discount' tax applies to the list price regardless of any
 *                     discount. The same sale carries ₨9.00 of tax.
 *
 * The choice is recorded on each receipt as it is issued, not read from
 * settings at print time. Changing the rule next year must not quietly change
 * the total on a memo you handed someone last year.
 */

export const TAX_BASES = ['after-discount', 'before-discount'];
export const DEFAULT_TAX_BASE = 'after-discount';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Rounds to whole paisa/cents so repeated addition cannot drift. */
function money(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param {{items?: {qty?: number, price?: number}[], discount?: number,
 *          taxPercent?: number, cashGiven?: number,
 *          taxBase?: 'after-discount'|'before-discount'}} receipt
 */
export function computeTotals(receipt = {}) {
  const items = Array.isArray(receipt.items) ? receipt.items : [];

  const subtotal = money(items.reduce((sum, it) => sum + num(it.qty) * num(it.price), 0));

  // A discount bigger than the sale would make the grand total negative, so it
  // is clamped. Better a zero memo than a memo that owes the customer money.
  const discount = money(Math.min(Math.max(num(receipt.discount), 0), subtotal));

  const afterDiscount = money(subtotal - discount);
  const taxBase = TAX_BASES.includes(receipt.taxBase) ? receipt.taxBase : DEFAULT_TAX_BASE;

  // Anything not explicitly set to the other rule is taxed on what was paid.
  const taxable = taxBase === 'before-discount' ? subtotal : afterDiscount;

  const taxPercent = Math.max(num(receipt.taxPercent), 0);
  const tax = money(taxable * (taxPercent / 100));
  const grandTotal = money(afterDiscount + tax);

  const cashGiven = Math.max(num(receipt.cashGiven), 0);
  const change = money(Math.max(cashGiven - grandTotal, 0));

  return {
    subtotal,
    discount,
    taxable,
    taxBase,
    taxPercent,
    tax,
    grandTotal,
    cashGiven,
    change,
  };
}

/** Per-line total, used by the items table. */
export function lineTotal(item = {}) {
  return money(num(item.qty) * num(item.price));
}
