/**
 * History — every memo issued, and what the week looks like.
 *
 * The weekly card is always the last 7 days, whatever the filters below it
 * say. "This week" should not change meaning because you typed something in
 * the search box.
 *
 * Its six figures are worked out on this computer and always appear. The AI
 * sentence is an extra on top; if there is no key, or the call fails, the
 * numbers are unaffected.
 */
import { h, mount, toast, confirmDialog, debounce } from '../dom.js';
import { t } from '../i18n.js';
import { api, openPdf } from '../api.js';
import { money, formatDateTime, store } from '../store.js';
import { lineTotal } from '/shared/totals.js';

export async function renderHistory({ go }) {
  const filters = { q: '', from: '', to: '' };
  const selected = new Set();
  let receipts = [];

  const root = h('div');
  const summaryHost = h('.card');
  const listHost = h('div');
  const bulkBar = h('.notice', { style: { display: 'none' } });

  /* ---- weekly summary ------------------------------------------------ */

  async function loadSummary() {
    const s = await api.summary.weekly();
    const insightHost = h('div');

    mount(
      summaryHost,
      h(
        '.page-head',
        { style: { marginBottom: 'var(--s4)' } },
        h('h2', `📈 ${t('weeklySummary')}`),
        h('span.badge', t('last7Days')),
        h(
          '.actions',
          h(
            'button.btn.small',
            {
              onclick: async (e) => {
                const button = e.currentTarget;
                button.disabled = true;
                button.textContent = '…';
                try {
                  const result = await api.summary.insight();
                  mount(
                    insightHost,
                    result.ready
                      ? h('.notice.info', h('span', '✨'), h('.grow', result.insight))
                      : h(
                          '.notice.warn',
                          h('.grow', h('strong', 'No AI key'), h('p.small', result.message)),
                        ),
                  );
                } catch (err) {
                  mount(insightHost, h('.notice.error', h('.grow', err.message)));
                } finally {
                  button.disabled = false;
                  button.textContent = `✨ ${t('generateInsight')}`;
                }
              },
            },
            `✨ ${t('generateInsight')}`,
          ),
        ),
      ),
      h(
        '.tiles',
        tile(t('totalSpend'), money(s.totalSpend, s.currency)),
        tile(t('transactions'), String(s.transactions)),
        tile(t('averageValue'), money(s.averageValue, s.currency)),
        tile(t('topCustomer'), s.topCustomer?.name ?? '—', s.topCustomer ? money(s.topCustomer.total, s.currency) : null),
        tile(t('totalTax'), money(s.totalTax, s.currency)),
        tile(t('totalDiscount'), money(s.totalDiscount, s.currency)),
      ),
      insightHost,
    );
  }

  /* ---- the list ------------------------------------------------------- */

  async function load() {
    receipts = await api.receipts.list(filters);
    // A selection that survives a filter change would let a hidden receipt be
    // deleted by a button that says "3 selected".
    for (const id of [...selected]) {
      if (!receipts.some((r) => r.id === id)) selected.delete(id);
    }
    paint();
  }

  function paint() {
    updateBulkBar();

    if (receipts.length === 0) {
      mount(
        listHost,
        h(
          '.empty-state',
          filters.q || filters.from || filters.to ? 'Nothing matches those filters.' : t('noReceipts'),
        ),
      );
      return;
    }

    mount(
      listHost,
      receipts.map((r) => receiptRow(r)),
    );
  }

  function receiptRow(r) {
    const body = h('.body', { style: { display: 'none' } });
    let built = false;

    const head = h(
      '.head',
      {
        onclick: (e) => {
          if (e.target.closest('input,button')) return;
          const open = body.style.display !== 'none';
          if (!open && !built) {
            built = true;
            mount(body, expandedBody(r));
          }
          body.style.display = open ? 'none' : 'grid';
        },
      },
      h('input', {
        type: 'checkbox',
        checked: selected.has(r.id),
        style: { width: '18px', flex: 'none' },
        onclick: (e) => {
          e.stopPropagation();
          if (e.target.checked) selected.add(r.id);
          else selected.delete(r.id);
          updateBulkBar();
        },
      }),
      h(
        '.grow',
        h(
          'div',
          { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' } },
          h('strong', `#${r.number}`),
          h('span', r.place || r.title || '—'),
          r.pinned ? h('span.badge.ok', '📌') : null,
        ),
        h(
          '.small.muted',
          [formatDateTime(r.created_at), r.customer_name, r.payment_method].filter(Boolean).join(' · '),
        ),
      ),
      h('strong.nowrap', money(r.totals.grandTotal, r.currency)),
    );

    return h(`.receipt-row${r.pinned ? '.pinned' : ''}`, head, body);
  }

  function expandedBody(r) {
    const filename = `Receipt_${r.number}.pdf`;

    const act = async (fn) => {
      try {
        await fn();
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    return [
      h(
        '.table-wrap',
        h(
          'table',
          h('thead', h('tr', h('th', t('items')), h('th.right', t('quantity')), h('th.right', t('price')), h('th.right', 'Total'))),
          h(
            'tbody',
            r.items.length === 0
              ? h('tr', h('td', { colspan: '4' }, h('span.muted', t('noItems'))))
              : r.items.map((item) =>
                  h(
                    'tr',
                    h('td', item.name),
                    h('td.right', String(item.qty)),
                    h('td.right', money(item.price, r.currency)),
                    h('td.right', money(lineTotal(item), r.currency)),
                  ),
                ),
          ),
        ),
      ),

      h(
        '.grid-2',
        detail(t('subtotal'), money(r.totals.subtotal, r.currency)),
        detail(t('discount'), money(r.totals.discount, r.currency)),
        detail(`${t('tax')} (${r.totals.taxPercent}%)`, money(r.totals.tax, r.currency)),
        detail(t('grandTotal'), money(r.totals.grandTotal, r.currency)),
        detail(t('cashGiven'), money(r.totals.cashGiven, r.currency)),
        detail(t('change'), money(r.totals.change, r.currency)),
        detail(t('paymentMethod'), r.payment_method),
        detail(t('category'), r.category),
        r.note1 ? detail(t('notePage1'), r.note1) : null,
        r.location_address ? detail('Saved location', r.location_address) : null,
        r.lat != null ? detail('GPS', `${r.lat}, ${r.lng}`) : null,
      ),

      h(
        '.row-actions',
        h(
          'button.btn.small',
          { onclick: () => act(() => openPdf(api.receipts.pdfUrl(r.id), 'share', filename)) },
          `↗ ${t('share')}`,
        ),
        h(
          'button.btn.small',
          { onclick: () => act(() => openPdf(api.receipts.pdfUrl(r.id), 'download', filename)) },
          `⬇ ${t('pdf')}`,
        ),
        h(
          'button.btn.small',
          { onclick: () => act(() => openPdf(api.receipts.pdfUrl(r.id), 'print', filename)) },
          `🖨 ${t('print')}`,
        ),
        h(
          'button.btn.small',
          {
            onclick: () =>
              act(async () => {
                const copy = await api.receipts.duplicate(r.id);
                toast(`Duplicated as #${copy.number}.`);
                load();
              }),
          },
          `⧉ ${t('duplicate')}`,
        ),
        h('button.btn.small', { onclick: () => go('new', { edit: r.id }) }, `✎ ${t('edit')}`),
        h(
          'button.btn.small',
          {
            onclick: () =>
              act(async () => {
                await api.receipts.pin(r.id);
                load();
              }),
          },
          r.pinned ? '📌 Unpin' : '📌 Pin',
        ),
        h(
          'button.btn.small.danger',
          {
            onclick: () =>
              act(async () => {
                const yes = await confirmDialog({
                  title: `Delete receipt #${r.number}?`,
                  body: `${money(r.totals.grandTotal, r.currency)} · ${formatDateTime(r.created_at)}. This cannot be undone.`,
                });
                if (!yes) return;
                await api.receipts.remove(r.id);
                toast('Deleted.');
                load();
                loadSummary();
              }),
          },
          `🗑 ${t('delete')}`,
        ),
      ),
    ];
  }

  /* ---- bulk ----------------------------------------------------------- */

  function updateBulkBar() {
    if (selected.size === 0) {
      bulkBar.style.display = 'none';
      return;
    }
    const ids = [...selected];

    const bulkPdf = async (mode) => {
      const response = await fetch('/api/receipts/bulk-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error('Those receipts could not be produced.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, '_blank');
      if (!tab) throw new Error('Your browser blocked the window. Allow pop-ups for this site.');
      if (mode === 'print') tab.addEventListener('load', () => tab.print(), { once: true });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    bulkBar.style.display = 'flex';
    mount(
      bulkBar,
      h('.grow', h('strong', `${selected.size} ${t('selected')}`)),
      h(
        '.row-actions',
        h(
          'button.btn.small',
          {
            onclick: async () => {
              try {
                await bulkPdf('print');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          `🖨 ${t('print')}`,
        ),
        h(
          'button.btn.small',
          {
            onclick: async () => {
              try {
                await bulkPdf('view');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          `↗ ${t('share')}`,
        ),
        h(
          'button.btn.small.danger',
          {
            onclick: async () => {
              const yes = await confirmDialog({
                title: `Delete ${selected.size} receipts?`,
                body: 'They are gone for good. Export a backup first if you are not sure.',
              });
              if (!yes) return;
              try {
                await api.receipts.bulkDelete(ids);
                selected.clear();
                toast(`${ids.length} deleted.`);
                await load();
                loadSummary();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          `🗑 ${t('delete')}`,
        ),
        h('button.btn.small.ghost', { onclick: () => { selected.clear(); paint(); } }, t('clear')),
      ),
    );
  }

  /* ---- assembly -------------------------------------------------------- */

  const search = debounce((value) => {
    filters.q = value;
    load();
  }, 250);

  const fromInput = h('input', {
    type: 'date',
    onchange: (e) => {
      filters.from = e.target.value;
      load();
    },
  });
  const toInput = h('input', {
    type: 'date',
    onchange: (e) => {
      filters.to = e.target.value;
      load();
    },
  });

  mount(
    root,
    h('.page-head', h('h1', t('receipts')), h('.actions', h('a.btn.primary', { href: '#/new' }, `+ ${t('newReceipt')}`))),
    summaryHost,
    h(
      '.card',
      h(
        '.grid-3',
        h('.field', h('label', t('search')), h('input', { placeholder: `${t('title')} / ${t('place')} / ${t('customer')}`, oninput: (e) => search(e.target.value) })),
        h('.field', h('label', t('startDate')), fromInput),
        h('.field', h('label', t('endDate')), toInput),
      ),
      h(
        '.row-actions',
        { style: { marginTop: 'var(--s4)' } },
        h(
          'button.btn.small.ghost',
          {
            onclick: () => {
              filters.q = '';
              filters.from = '';
              filters.to = '';
              fromInput.value = '';
              toInput.value = '';
              const box = root.querySelector('input[type="text"], .card input:not([type])');
              if (box) box.value = '';
              load();
            },
          },
          `✕ ${t('clear')}`,
        ),
        h(
          'button.btn.small.ghost',
          {
            onclick: () => {
              const all = receipts.every((r) => selected.has(r.id));
              selected.clear();
              if (!all) for (const r of receipts) selected.add(r.id);
              paint();
            },
          },
          t('selectAll'),
        ),
      ),
    ),
    bulkBar,
    listHost,
  );

  await Promise.all([loadSummary(), load()]);
  return root;
}

function tile(label, value, sub) {
  return h('.tile', h('.label', label), h('.value', value), sub ? h('.sub', sub) : null);
}

function detail(label, value) {
  return h('div', h('.small.muted', label), h('div', value));
}
