/**
 * What the whole app agrees on: settings, the signed-in account, the theme,
 * the language, and the money formatter that goes with the chosen currency.
 */
import { api } from './api.js';
import { setLanguage } from './i18n.js';
import { formatMoney, formatAmount, currencySymbol } from '/shared/currency.js';

const listeners = new Set();

export const store = {
  settings: {},
  features: {},
  currencies: [],
  urls: {},
  account: null,
  ready: false,
};

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(store);
}

export async function loadBootstrap() {
  const data = await api.bootstrap();
  store.settings = data.settings ?? {};
  store.features = data.features ?? {};
  store.currencies = data.currencies ?? [];
  store.urls = data.urls ?? {};
  store.account = data.account ?? null;
  store.ready = true;
  applyTheme(store.settings.theme);
  setLanguage(store.settings.language ?? 'en');
  emit();
  return store;
}

/** Saves settings and updates the copy every screen reads from. */
export async function saveSettings(patch) {
  store.settings = await api.settings.save(patch);
  if ('theme' in patch) applyTheme(store.settings.theme);
  if ('language' in patch) setLanguage(store.settings.language);
  emit();
  return store.settings;
}

/* ------------------------------------------------------------------ *
 * theme
 * ------------------------------------------------------------------ */

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme = 'dark') {
  const resolved = theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

// Following the system means following it as it changes, not only at startup.
systemDark.addEventListener('change', () => {
  if (store.settings.theme === 'system') applyTheme('system');
});

/* ------------------------------------------------------------------ *
 * money
 * ------------------------------------------------------------------ */

export function defaultCurrency() {
  return store.settings.defaultCurrency ?? 'PKR';
}

/** Formats an amount in a given currency, defaulting to the shop's own. */
export function money(value, code) {
  return formatMoney(value, code ?? defaultCurrency());
}

export { formatAmount, currencySymbol };

/* ------------------------------------------------------------------ *
 * dates
 * ------------------------------------------------------------------ */

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Bytes as something readable — used by the dashboard's storage tile. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
