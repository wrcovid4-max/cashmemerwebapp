/**
 * Dashboard.
 *
 * The charts are built from ordinary elements rather than a charting library.
 * Two bar charts and a column of daily sales do not justify a dependency that
 * has to be downloaded, kept up to date, and can break an install.
 */
import { h, mount } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { money, formatBytes } from '../store.js';

export async function renderDashboard() {
  const d = await api.dashboard();
  const c = d.currency;

  return h(
    'div',
    h('.page-head', h('h1', t('dashboard'))),

    h(
      '.tiles',
      tile("Today's takings", money(d.todayTotal, c), `${d.todayCount} receipt${d.todayCount === 1 ? '' : 's'}`),
      tile('This month', money(d.monthTotal, c)),
      tile('Total spending', money(d.totalSpending, c), 'all time'),
      tile('Total receipts', String(d.totalReceipts)),
      tile('Total products', String(d.totalProducts), 'active in inventory'),
      tile('Average receipt', money(d.averageReceipt, c)),
      tile('Highest receipt', money(d.highestReceipt, c)),
      tile('Lowest receipt', money(d.lowestReceipt, c)),
      tile('Average product cost', money(d.averageProductCost, c)),
      tile('Most-visited store', d.mostVisitedStore ?? '—'),
      tile('Unique stores', String(d.uniqueStores)),
      tile('Top product', d.topProduct ?? '—'),
      tile('Storage used', formatBytes(d.storageBytes), 'data/cashmemer.db'),
      tile(
        'Pending sync',
        String(d.pendingSync),
        d.pendingSync > 0 ? 'not yet uploaded' : 'everything local is saved',
      ),
    ),

    h(
      '.card',
      { style: { marginTop: 'var(--s5)' } },
      h('h2', 'Sales over time'),
      h('p.small.muted', 'Last 30 days'),
      d.salesOverTime.some((p) => p.value > 0)
        ? sparkColumns(d.salesOverTime, c)
        : h('.empty-state', 'No sales in the last 30 days.'),
    ),

    h(
      '.grid-2',
      { style: { marginTop: 'var(--s4)' } },
      h(
        '.card',
        h('h2', 'Top 5 stores'),
        d.topStores.length ? barChart(d.topStores.slice(0, 5), c) : h('.empty-state', 'Nothing yet.'),
      ),
      h(
        '.card',
        h('h2', 'Spend by category'),
        d.byCategory.length ? barChart(d.byCategory, c) : h('.empty-state', 'Nothing yet.'),
      ),
    ),
  );
}

function tile(label, value, sub) {
  return h('.tile', h('.label', label), h('.value', value), sub ? h('.sub', sub) : null);
}

function barChart(rows, currency) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return h(
    '.bars',
    rows.map((r) =>
      h(
        '.bar-row',
        h('span', { title: r.label }, r.label),
        h('.bar-track', h('.bar-fill', { style: { width: `${Math.max((r.value / max) * 100, 2)}%` } })),
        h('span.nowrap', money(r.value, currency)),
      ),
    ),
  );
}

function sparkColumns(points, currency) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return h(
    '.spark',
    points.map((p) =>
      h('div', {
        style: { height: `${Math.max((p.value / max) * 100, 1)}%` },
        // A bar chart with no axis still has to answer "what is that spike?"
        title: `${p.label} — ${money(p.value, currency)}`,
      }),
    ),
  );
}
