/**
 * Inventory — the products the shop sells.
 *
 * A barcode here is what makes the phone scanner useful: scanning a code the
 * inventory knows adds a priced line to the memo with no typing at all.
 */
import { h, mount, toast, openDialog, confirmDialog, debounce } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { money } from '../store.js';

const UNITS = ['pcs', 'piece', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'dozen', 'metre'];

export async function renderInventory() {
  let query = '';
  let filter = 'all';

  const root = h('div');
  const summaryHost = h('.tiles');
  const tableHost = h('.card');

  async function load() {
    const { products, summary } = await api.products.list(query, filter);

    mount(
      summaryHost,
      tile(t('totalItems'), String(summary.total)),
      tile(
        `${t('lowStock')} (≤${summary.threshold})`,
        String(summary.lowStock),
        summary.lowStock > 0 ? 'warn' : null,
      ),
      tile(t('sellValue'), money(summary.sellValue)),
    );

    if (products.length === 0) {
      mount(
        tableHost,
        h(
          '.empty-state',
          query || filter !== 'all'
            ? 'Nothing matches that.'
            : 'No products yet. Press "New product" to add your first one.',
        ),
      );
      return;
    }

    mount(
      tableHost,
      h(
        '.table-wrap',
        h(
          'table',
          h(
            'thead',
            h(
              'tr',
              h('th', t('name')),
              h('th', t('barcode')),
              h('th.right', t('costPrice')),
              h('th.right', t('sellingPrice')),
              h('th.right', t('stock')),
              h('th', ''),
            ),
          ),
          h(
            'tbody',
            products.map((p) =>
              h(
                'tr',
                h(
                  'td',
                  h('strong', p.name),
                  h('div.small.muted', [p.brand, p.category].filter(Boolean).join(' · ')),
                ),
                h('td.mono.small', p.barcode || '—'),
                h('td.right', money(p.cost_price)),
                h('td.right', money(p.sell_price)),
                h(
                  'td.right.nowrap',
                  h(
                    `span${p.stock <= summary.threshold ? '.badge.warn' : ''}`,
                    `${p.stock} ${p.unit}`,
                  ),
                ),
                h(
                  'td',
                  h(
                    '.row-actions',
                    h(
                      `span.badge${p.archived ? '' : '.ok'}`,
                      p.archived ? t('archived') : t('active'),
                    ),
                    h('button.btn.small.ghost', { onclick: () => edit(p) }, t('edit')),
                    h(
                      'button.btn.small.ghost',
                      {
                        title: t('duplicate'),
                        onclick: async () => {
                          await api.products.duplicate(p.id);
                          toast('Duplicated.');
                          load();
                        },
                      },
                      '⧉',
                    ),
                    h(
                      'button.btn.small.ghost',
                      {
                        onclick: async () => {
                          await api.products.update(p.id, { ...p, archived: !p.archived });
                          load();
                        },
                      },
                      p.archived ? t('unarchive') : t('archive'),
                    ),
                    h(
                      'button.btn.small.ghost',
                      {
                        style: { color: 'var(--danger)' },
                        onclick: async () => {
                          const yes = await confirmDialog({
                            title: `Delete “${p.name}”?`,
                            body:
                              'This removes the product from inventory for good. Receipts that ' +
                              'already list it are not changed.',
                          });
                          if (!yes) return;
                          await api.products.remove(p.id);
                          toast('Deleted.');
                          load();
                        },
                      },
                      t('delete'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function edit(product) {
    const p = product ?? {
      name: '', barcode: '', brand: '', category: 'General',
      cost_price: 0, sell_price: 0, stock: 0, unit: 'pcs', archived: 0,
    };
    const f = {};
    const input = (key, attrs = {}) =>
      (f[key] = h('input', { value: p[key] ?? '', ...attrs }));

    const overlay = openDialog(
      h('h2', product ? t('edit') : t('newProduct')),
      h('.field', h('label', t('name')), input('name', { autofocus: true })),
      h(
        '.grid-2',
        h('.field', h('label', t('barcode')), input('barcode')),
        h('.field', h('label', t('brand')), input('brand')),
      ),
      h(
        '.grid-2',
        h('.field', h('label', t('category')), input('category')),
        h(
          '.field',
          h('label', t('unit')),
          (f.unit = h(
            'select',
            UNITS.map((u) => h('option', { value: u, selected: u === (p.unit ?? 'pcs') }, u)),
          )),
        ),
      ),
      h(
        '.grid-3',
        h('.field', h('label', t('costPrice')), input('cost_price', { type: 'number', step: 'any' })),
        h('.field', h('label', t('sellingPrice')), input('sell_price', { type: 'number', step: 'any' })),
        h('.field', h('label', t('stock')), input('stock', { type: 'number', step: 'any' })),
      ),
      h(
        '.dialog-actions',
        h('button.btn', { onclick: () => overlay.remove() }, t('cancel')),
        h(
          'button.btn.primary',
          {
            onclick: async () => {
              const body = {
                name: f.name.value.trim(),
                barcode: f.barcode.value.trim(),
                brand: f.brand.value.trim(),
                category: f.category.value.trim() || 'General',
                unit: f.unit.value,
                cost_price: Number(f.cost_price.value) || 0,
                sell_price: Number(f.sell_price.value) || 0,
                stock: Number(f.stock.value) || 0,
                archived: p.archived ?? 0,
              };
              if (!body.name) {
                toast('A product needs a name.', 'warn');
                f.name.focus();
                return;
              }
              try {
                if (product) await api.products.update(product.id, body);
                else await api.products.create(body);
                overlay.remove();
                toast(product ? 'Saved.' : 'Product added.');
                load();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          t('save'),
        ),
      ),
    );
  }

  const search = debounce((value) => {
    query = value;
    load();
  }, 250);

  const pills = h(
    '.pills',
    ['all', 'active', 'archived'].map((key) =>
      h(
        `button.pill-btn${filter === key ? '.on' : ''}`,
        {
          onclick: (e) => {
            filter = key;
            for (const btn of pills.children) btn.classList.remove('on');
            e.currentTarget.classList.add('on');
            load();
          },
        },
        t(key),
      ),
    ),
  );

  mount(
    root,
    h(
      '.page-head',
      h('h1', t('inventory')),
      h('.actions', h('button.btn.primary', { onclick: () => edit(null) }, `+ ${t('newProduct')}`)),
    ),
    summaryHost,
    h(
      'div',
      { style: { margin: 'var(--s5) 0', display: 'grid', gap: 'var(--s3)' } },
      h('input', {
        placeholder: `${t('search')} — ${t('barcode')} / ${t('name')} / ${t('brand')}`,
        oninput: (e) => search(e.target.value),
      }),
      pills,
    ),
    tableHost,
  );

  await load();
  return root;
}

function tile(label, value, kind) {
  return h(
    '.tile',
    h('.label', label),
    h(`.value${kind === 'warn' ? '' : ''}`, { style: kind === 'warn' ? { color: 'var(--amber)' } : {} }, value),
  );
}
