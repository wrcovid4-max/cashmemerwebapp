/**
 * The shell: sidebar, routing, and the two controls that live above every
 * screen — theme and language.
 *
 * Routing is the URL hash, so the back button works, a screen can be
 * bookmarked, and a reload lands you where you were rather than at Dashboard.
 */
import { h, mount, toast } from './dom.js';
import { t, getLanguage, setLanguage, LANGUAGES } from './i18n.js';
import { store, loadBootstrap, saveSettings, onChange } from './store.js';
import { scanner } from './scanner.js';
import { api } from './api.js';

import { renderDashboard } from './views/dashboard.js';
import { renderHistory } from './views/history.js';
import { renderReceiptForm } from './views/receipt-form.js';
import { renderInventory } from './views/inventory.js';
import { renderPriceList } from './views/pricelist.js';
import { renderMembers } from './views/members.js';
import { renderTerminal } from './views/terminal.js';
import { renderRates } from './views/rates.js';
import { renderSettings } from './views/settings.js';

const ROUTES = [
  { id: 'dashboard', icon: '📊', label: () => t('dashboard'), render: renderDashboard },
  { id: 'receipts', icon: '🧾', label: () => t('receipts'), render: renderHistory },
  { id: 'new', icon: '➕', label: () => t('newReceipt'), render: renderReceiptForm },
  { id: 'inventory', icon: '📦', label: () => t('inventory'), render: renderInventory },
  { id: 'pricelist', icon: '📋', label: () => t('priceList'), render: renderPriceList },
  { id: 'members', icon: '👥', label: () => t('members'), render: renderMembers },
  { id: 'terminal', icon: '💳', label: () => t('terminal'), render: renderTerminal },
  { id: 'rates', icon: '💱', label: () => t('rates'), render: renderRates },
  { id: 'settings', icon: '⚙️', label: () => t('settings'), render: renderSettings },
];

const content = document.getElementById('content');
const sidebar = document.getElementById('sidebar');

/* ------------------------------------------------------------------ *
 * routing
 * ------------------------------------------------------------------ */

/** '#/new?edit=12' -> { id: 'new', params: URLSearchParams } */
function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, query = ''] = raw.split('?');
  const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
  return { route, params: new URLSearchParams(query) };
}

export function go(id, params = {}) {
  const query = new URLSearchParams(params).toString();
  location.hash = `#/${id}${query ? `?${query}` : ''}`;
}

let renderToken = 0;

async function renderCurrent() {
  const { route, params } = currentRoute();
  const token = ++renderToken;

  renderSidebar();
  mount(content, h('.empty-state', '…'));

  try {
    const view = await route.render({ params, go });
    // A slow screen that has been navigated away from must not paint over the
    // screen the user is now looking at.
    if (token !== renderToken) return;
    mount(content, view);
    content.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== renderToken) return;
    mount(
      content,
      h(
        '.notice.error',
        h('.grow', h('strong', 'This screen could not load.'), h('p.small', err.message)),
        h('button.btn', { onclick: () => renderCurrent() }, 'Try again'),
      ),
    );
  }
}

/** Re-renders the current screen — used after language or data changes. */
export function refresh() {
  renderCurrent();
}

window.addEventListener('hashchange', renderCurrent);

/* ------------------------------------------------------------------ *
 * sidebar
 * ------------------------------------------------------------------ */

function initials(name, email) {
  const source = (name || email || '?').trim();
  return source.slice(0, 1).toUpperCase();
}

function renderSidebar() {
  const { route } = currentRoute();
  const account = store.account;
  const scannerLive = scanner.status === 'connected';

  mount(
    sidebar,
    h(
      '.brand',
      h('.logo', 'CM'),
      h('div', h('.name', t('appName')), h('.tagline', t('tagline'))),
    ),

    h(
      'nav.nav',
      ROUTES.map((r) =>
        h(
          `a${r.id === route.id ? '.active' : ''}`,
          { href: `#/${r.id}` },
          h('span.icon', r.icon),
          h('span', r.label()),
          r.id === route.id ? h('span.dot') : null,
        ),
      ),
    ),

    h(
      '.sidebar-foot',
      // The scanner light lives where it can be seen from any screen — if the
      // phone has dropped mid-sale you want to know before you scan, not after.
      h(
        `.badge${scannerLive ? '.ok' : ''}`,
        { style: { justifyContent: 'center' } },
        h('span.dot'),
        scannerLive ? t('pairConnected') : scanner.code ? t('pairWaiting') : t('phoneScanner'),
      ),

      h(
        '.switch',
        { style: { borderBottom: '0', paddingBottom: '0' } },
        h('span.small.muted', t('language')),
        h(
          'select',
          {
            style: { width: 'auto' },
            value: getLanguage(),
            onchange: async (e) => {
              setLanguage(e.target.value);
              await saveSettings({ language: e.target.value });
              renderCurrent();
            },
          },
          LANGUAGES.map((l) =>
            h('option', { value: l.code, selected: l.code === getLanguage() }, l.label),
          ),
        ),
      ),

      account
        ? h(
            '.account',
            h(
              '.avatar',
              account.picture
                ? h('img', { src: account.picture, alt: '', referrerpolicy: 'no-referrer' })
                : initials(account.name, account.email),
            ),
            h('.who', h('strong', account.name || account.email), h('span', account.email)),
            h(
              'button.btn.link',
              {
                title: t('signOut'),
                onclick: async () => {
                  await api.auth.signOut();
                  store.account = null;
                  renderSidebar();
                  toast(t('signOut'));
                },
              },
              '⏻',
            ),
          )
        : h('a.btn.ghost.small', { href: '#/settings' }, t('signIn')),
    ),
  );
}

// The sidebar light follows the socket without the page being re-rendered.
scanner.addEventListener('status', renderSidebar);
onChange(renderSidebar);

/* ------------------------------------------------------------------ *
 * start
 * ------------------------------------------------------------------ */

async function start() {
  try {
    await loadBootstrap();
  } catch (err) {
    mount(
      content,
      h(
        '.notice.error',
        h('.grow', h('strong', 'Cash Memer could not start.'), h('p.small', err.message)),
      ),
    );
    return;
  }

  if (!location.hash) location.hash = '#/dashboard';
  await renderCurrent();

  // Coming back from the Google sign-in round trip.
  if (new URLSearchParams(location.search).get('signedin')) {
    toast('Signed in.');
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

start();
