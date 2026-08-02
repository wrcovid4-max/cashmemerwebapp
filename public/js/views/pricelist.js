/**
 * Price list — the short list of things rung up most often.
 *
 * Kept separate from Inventory on purpose. Inventory is a record of stock;
 * this is a row of buttons for the counter. An entry here needs a name and a
 * price and nothing else, and lands on a memo in one click.
 */
import { h, mount, toast, openDialog, confirmDialog } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { money } from '../store.js';

export async function renderPriceList() {
  const root = h('div');
  const listHost = h('div');

  async function load() {
    const entries = await api.priceList.list();

    if (entries.length === 0) {
      mount(
        listHost,
        h(
          '.empty-state',
          'Nothing here yet. Add the few things you sell all day — they become one-click ' +
            'buttons on the receipt form.',
        ),
      );
      return;
    }

    mount(
      listHost,
      entries.map((entry) =>
        h(
          '.card',
          { style: { display: 'flex', alignItems: 'center', gap: 'var(--s4)', padding: 'var(--s4)' } },
          h(
            '.grow',
            h('h3', entry.name),
            h('.small.muted', `${t('price')}: ${money(entry.price)} / ${entry.unit}`),
          ),
          h('button.btn.small.ghost', { onclick: () => edit(entry) }, `✎ ${t('edit')}`),
          h(
            'button.btn.small.ghost',
            {
              style: { color: 'var(--danger)' },
              onclick: async () => {
                const yes = await confirmDialog({
                  title: `Remove “${entry.name}”?`,
                  body: 'It disappears from the quick-pick row. Inventory is not touched.',
                  confirmLabel: t('delete'),
                });
                if (!yes) return;
                await api.priceList.remove(entry.id);
                load();
              },
            },
            '🗑',
          ),
        ),
      ),
    );
  }

  function edit(entry) {
    const nameInput = h('input', { value: entry?.name ?? '', autofocus: true });
    const priceInput = h('input', { type: 'number', step: 'any', value: entry?.price ?? 0 });
    const unitInput = h('input', { value: entry?.unit ?? 'piece' });

    const overlay = openDialog(
      h('h2', entry ? t('edit') : t('add')),
      h('.field', h('label', t('name')), nameInput),
      h(
        '.grid-2',
        h('.field', h('label', t('price')), priceInput),
        h('.field', h('label', t('unit')), unitInput),
      ),
      h(
        '.dialog-actions',
        h('button.btn', { onclick: () => overlay.remove() }, t('cancel')),
        h(
          'button.btn.primary',
          {
            onclick: async () => {
              const body = {
                name: nameInput.value.trim(),
                price: Number(priceInput.value) || 0,
                unit: unitInput.value.trim() || 'piece',
              };
              if (!body.name) {
                nameInput.focus();
                return;
              }
              try {
                if (entry) await api.priceList.update(entry.id, body);
                else await api.priceList.create(body);
                overlay.remove();
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

  mount(
    root,
    h(
      '.page-head',
      h('h1', t('priceList')),
      h('.actions', h('button.btn.primary', { onclick: () => edit(null) }, `+ ${t('add')}`)),
    ),
    listHost,
  );

  await load();
  return root;
}
