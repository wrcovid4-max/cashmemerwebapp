/**
 * Exchange rates, USD base.
 *
 * A rate you typed in yourself is never overwritten by a refresh. That is the
 * whole point of the custom list: the rate your supplier gives you is not the
 * rate on the internet, and the internet must not get a vote.
 */
import { h, mount, toast, confirmDialog } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { formatAmount } from '../store.js';
import { RIAL_PER_TOMAN } from '/shared/currency.js';

/** Turns a currency code into its country flag, e.g. PKR -> 🇵🇰 */
function flagFor(code) {
  const country = String(code).slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return '🏳️';
  return String.fromCodePoint(...[...country].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export async function renderRates() {
  let query = '';
  let data = null;

  const root = h('div');
  const statusHost = h('div');
  const fixedHost = h('.card');
  const customHost = h('.card');
  const listHost = h('.card');

  async function load(refresh = false) {
    data = await api.rates.list(refresh);
    paint();
  }

  function paint() {
    /* --- the state of the connection --- */
    mount(
      statusHost,
      !data.ready && data.missing
        ? h(
            '.notice.warn',
            h('span', '🔑'),
            h(
              '.grow',
              h('strong', `No ${data.missing}`),
              h('p.small', data.message),
              h('p.small.muted', `Get a free key at ${data.where}`),
            ),
          )
        : data.error
          ? h(
              '.notice.error',
              h(
                '.grow',
                h('strong', data.stale ? 'Showing the last rates that arrived' : 'Rates unavailable'),
                h('p.small', data.error),
              ),
            )
          : h(
              '.notice.info',
              h('.grow', `Base USD · updated ${data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : '—'}`),
              h('button.btn.small', { onclick: () => load(true) }, '↻ Refresh'),
            ),
    );

    /* --- fixed by definition, so it is stated whether or not rates load --- */
    mount(
      fixedHost,
      h('h2', 'Fixed conversions'),
      h(
        '.bar-row',
        { style: { gridTemplateColumns: '1fr auto' } },
        h('span', `${flagFor('IRR')} 1 Toman (IRT)`),
        h('strong', `${RIAL_PER_TOMAN} Iranian Rial (IRR)`),
      ),
      h(
        'p.small.muted',
        'Iran quotes prices in Toman while the official unit is the Rial. This is a naming ' +
          'convention, not a market rate, so it never changes and a refresh never touches it. ' +
          'When live rates are loaded, Toman appears in the table below alongside the Rial.',
      ),
    );

    /* --- your own rates, which a refresh never touches --- */
    mount(
      customHost,
      h('h2', 'Your own rates'),
      h('p.small.muted', 'Entered by hand. A refresh will never overwrite these.'),
      data.custom.length === 0
        ? h('p.small.muted', 'None yet.')
        : h(
            '.bars',
            { style: { marginTop: 'var(--s3)' } },
            data.custom.map((row) =>
              h(
                '.bar-row',
                { style: { gridTemplateColumns: '1fr auto auto' } },
                h('span', `${flagFor(row.code)} ${row.code}${row.name ? ` — ${row.name}` : ''}`),
                h('strong', formatAmount(row.rate)),
                h(
                  'button.btn.small.ghost',
                  {
                    style: { color: 'var(--danger)' },
                    onclick: async () => {
                      const yes = await confirmDialog({
                        title: `Remove ${row.code}?`,
                        body: 'Your hand-entered rate is deleted.',
                        confirmLabel: t('delete'),
                      });
                      if (!yes) return;
                      data.custom = await api.rates.removeCustom(row.code);
                      paint();
                    },
                  },
                  '✕',
                ),
              ),
            ),
          ),
      addCustomForm(),
    );

    /* --- live rates --- */
    const entries = Object.entries(data.rates ?? {}).filter(([code]) =>
      query ? code.toLowerCase().includes(query.toLowerCase()) : true,
    );

    mount(
      listHost,
      h('h2', 'Live rates'),
      entries.length === 0
        ? h('.empty-state', data.ready ? 'Nothing matches that code.' : 'No live rates without a key.')
        : h(
            '.table-wrap',
            h(
              'table',
              h('thead', h('tr', h('th', 'Currency'), h('th.right', '1 USD ='))),
              h(
                'tbody',
                entries.map(([code, rate]) =>
                  h('tr', h('td', `${flagFor(code)}  ${code}`), h('td.right.mono', formatAmount(rate))),
                ),
              ),
            ),
          ),
    );
  }

  function addCustomForm() {
    const codeInput = h('input', { placeholder: 'e.g. GOLD', maxlength: '12' });
    const nameInput = h('input', { placeholder: 'Description (optional)' });
    const rateInput = h('input', { type: 'number', step: 'any', placeholder: '1 USD = ?' });

    return h(
      'div',
      { style: { marginTop: 'var(--s4)' } },
      h(
        '.grid-3',
        h('.field', h('label', 'Code'), codeInput),
        h('.field', h('label', 'Name'), nameInput),
        h('.field', h('label', 'Rate against USD'), rateInput),
      ),
      h(
        'button.btn.small',
        {
          style: { marginTop: 'var(--s3)' },
          onclick: async () => {
            const code = codeInput.value.trim().toUpperCase();
            if (!code) {
              codeInput.focus();
              return;
            }
            try {
              data.custom = await api.rates.addCustom({
                code,
                name: nameInput.value.trim(),
                rate: Number(rateInput.value) || 0,
              });
              codeInput.value = '';
              nameInput.value = '';
              rateInput.value = '';
              toast('Saved.');
              paint();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        `+ ${t('add')}`,
      ),
    );
  }

  mount(
    root,
    h('.page-head', h('h1', t('rates'))),
    statusHost,
    h('input', {
      placeholder: 'Search by code',
      style: { margin: 'var(--s4) 0' },
      oninput: (e) => {
        query = e.target.value;
        paint();
      },
    }),
    fixedHost,
    customHost,
    listHost,
  );

  await load();
  return root;
}
