/**
 * Currencies, and how money is written.
 *
 * This one file is used by both the server and the browser, so a total can
 * never be formatted one way on screen and another way on the printed memo.
 */

export const CURRENCIES = [
  { code: 'PKR', symbol: '₨', name: 'Pakistani Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', symbol: 'SAR', name: 'Saudi Riyal' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
  { code: 'QAR', symbol: 'QAR', name: 'Qatari Riyal' },
  { code: 'OMR', symbol: 'OMR', name: 'Omani Rial' },
  { code: 'KWD', symbol: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'BHD', symbol: 'BHD', name: 'Bahraini Dinar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee' },
  { code: 'AFN', symbol: '؋', name: 'Afghan Afghani' },
  { code: 'IRR', symbol: '﷼', name: 'Iranian Rial' },
  // Iran prices in Toman in practice, while the official unit is the Rial.
  // One Toman is ten Rial, always — it is a naming convention, not a rate that
  // moves, so it is derived rather than fetched. See RIAL_PER_TOMAN.
  { code: 'IRT', symbol: 'T', name: 'Iranian Toman' },
];

/** One Toman is ten Rial. Fixed by definition, not by any exchange. */
export const RIAL_PER_TOMAN = 10;

/**
 * Adds the rates that are fixed by definition rather than published.
 *
 * Iran quotes prices in Toman while the official unit is the Rial, and one
 * Toman is always ten Rial. No rate provider returns IRT, so it is derived
 * from the Rial. If a provider ever does start returning it, its number wins.
 *
 * @param {Record<string, number>} rates rates against the base currency
 */
export function withDerivedRates(rates) {
  if (!rates || typeof rates !== 'object') return rates;
  if (rates.IRT !== undefined || typeof rates.IRR !== 'number') return rates;
  return { ...rates, IRT: rates.IRR / RIAL_PER_TOMAN };
}

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencySymbol(code) {
  return BY_CODE.get(code)?.symbol ?? code ?? '';
}

export function currencyName(code) {
  return BY_CODE.get(code)?.name ?? code ?? '';
}

/**
 * Two decimals always. A memo that says "Rs 60" where it means "Rs 60.00" is
 * the kind of thing a customer argues about.
 */
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** e.g. "₨ 1,234.50" — symbol, one space, amount. Matches the printed memo. */
export function formatMoney(value, code = 'PKR') {
  return `${currencySymbol(code)} ${formatAmount(value)}`;
}
