/**
 * The arithmetic on a memo. One implementation, used by the form's live
 * preview, the saved receipt, the printed PDF and the dashboard — so the
 * number on the screen and the number on the paper cannot disagree.
 *
 * Order of operations, which is the order the memo prints them in:
 *
 *   subtotal   = sum of (quantity x price) for every line
 *   discount   = a flat amount off, never more than the subtotal
 *   taxable    = subtotal - discount
 *   tax        = taxable x (tax% / 100)      <- tax is charged after discount
 *   grand      = taxable + tax
 *   change     = cash given - grand, never below zero
 */

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
 *          taxPercent?: number, cashGiven?: number}} receipt
 */
export function computeTotals(receipt = {}) {
  const items = Array.isArray(receipt.items) ? receipt.items : [];

  const subtotal = money(items.reduce((sum, it) => sum + num(it.qty) * num(it.price), 0));

  // A discount bigger than the sale would make the grand total negative, so it
  // is clamped. Better a zero memo than a memo that owes the customer money.
  const discount = money(Math.min(Math.max(num(receipt.discount), 0), subtotal));

  const taxable = money(subtotal - discount);
  const taxPercent = Math.max(num(receipt.taxPercent), 0);
  const tax = money(taxable * (taxPercent / 100));
  const grandTotal = money(taxable + tax);

  const cashGiven = Math.max(num(receipt.cashGiven), 0);
  const change = money(Math.max(cashGiven - grandTotal, 0));

  return { subtotal, discount, taxable, taxPercent, tax, grandTotal, cashGiven, change };
}

/** Per-line total, used by the items table. */
export function lineTotal(item = {}) {
  return money(num(item.qty) * num(item.price));
}
