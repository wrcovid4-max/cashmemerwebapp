/**
 * Building a memo.
 *
 * Three things here are worth knowing about:
 *
 *   Drafts. The form saves itself a beat after you stop typing, not on every
 *   keystroke. If the browser closes mid-sale — or the power goes — the sale
 *   is still there when you come back.
 *
 *   Scans. A barcode arriving from the phone lands straight in the item list.
 *   If it matches nothing in inventory, you are asked to name and price it
 *   once; after that the same barcode just works.
 *
 *   Editing. Arriving with ?edit=12 loads receipt 12 and updates it in place.
 *   It never leaves a second copy behind — that is what Duplicate is for.
 */
import { h, mount, debounce, toast, openDialog, confirmDialog } from '../dom.js';
import { t } from '../i18n.js';
import { api, openPdf } from '../api.js';
import { store, money, defaultCurrency, saveSettings } from '../store.js';
import { scanner } from '../scanner.js';
import { openPairingDialog } from '../pairing.js';
import { computeTotals, lineTotal } from '/shared/totals.js';
import { attachSignaturePad } from '../signature.js';

const CATEGORIES = [
  'Shopping', 'Groceries', 'Food & Drink', 'Fuel', 'Utilities',
  'Services', 'Medical', 'Other',
];

const PAYMENT_METHODS = [
  'Cash', 'Card', 'Bank Transfer', 'Mobile Wallet', 'Apple Pay',
  'Google Wallet', 'Google Pay', 'Klarna', 'PayPak',
];

/** A fresh, empty sale. */
function blankReceipt() {
  const s = store.settings;
  return {
    id: null,
    title: s.storeName ?? '',
    place: s.storeName ?? '',
    location_address: s.storeAddress ?? '',
    lat: null,
    lng: null,
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    customer_address: '',
    currency: defaultCurrency(),
    category: 'Shopping',
    payment_method: 'Cash',
    discount: 0,
    tax_percent: 0,
    // Recorded on the receipt as it is issued, so changing the rule in
    // Settings later cannot re-total a memo already handed to a customer.
    tax_base: s.taxBase ?? 'after-discount',
    cash_given: 0,
    // Page 1's note has a default because almost every memo wants it, and
    // retyping it forty times a day is not a feature.
    note1: s.defaultNote1 ?? 'Thank You for shopping !!!',
    note2: '',
    signature: s.saveSignature ? (s.defaultSignature ?? '') : '',
    issuer_name: s.issuerName ?? store.account?.name ?? '',
    issuer_email: s.issuerEmail ?? store.account?.email ?? '',
    created_at: new Date().toISOString(),
    items: [],
  };
}

export async function renderReceiptForm({ params, go }) {
  const editId = params.get('edit');

  const [{ products }, priceList, members, draft] = await Promise.all([
    api.products.list('', 'active'),
    api.priceList.list(),
    api.members.list(),
    editId ? Promise.resolve(null) : api.draft.get(),
  ]);

  let receipt;
  let restoredDraft = false;

  if (editId) {
    receipt = await api.receipts.get(editId);
  } else if (draft?.payload && Object.keys(draft.payload).length > 0) {
    receipt = { ...blankReceipt(), ...draft.payload };
    restoredDraft = true;
    // A restored draft carries the time it was first opened, which may be hours
    // or a day ago. The sale is happening now, so the clock starts fresh.
    receipt.created_at = new Date().toISOString();
  } else {
    receipt = blankReceipt();
  }

  /* ---- persistence ------------------------------------------------- */

  const saveDraft = debounce(() => {
    // An edit in progress is not a draft — overwriting the draft with someone
    // else's old sale would lose whatever was on the counter.
    if (editId) return;
    api.draft.save(receipt).catch(() => {
      /* A failed draft save must never interrupt a sale. */
    });
  }, 700);

  /* ---- rendering ---------------------------------------------------- */

  const root = h('.receipt-layout');
  const formCol = h('div');
  // The live preview shows BOTH pages of the memo, because they are not the
  // same page: page 1 is the customer's (no phone, address, note 2 or issuer),
  // page 2 is yours and carries everything.
  const previewCol = h(
    '.preview-rail',
    h('.caption', t('livePreview')),
    h(
      '.paper-stack',
      h('.paper-wrap', h('.paper-label', t('page1Customer')), h('.paper', { id: 'paperPreview1' })),
      h('.paper-wrap', h('.paper-label', t('page2Yours')), h('.paper', { id: 'paperPreview2' })),
    ),
  );

  // True once the shopkeeper has set the date by hand; until then a new memo is
  // stamped with the current time when it is generated, so the time on it is
  // always "now" and never frozen at the moment the form happened to open.
  let dateTouched = false;

  const totals = () =>
    computeTotals({
      items: receipt.items,
      discount: receipt.discount,
      taxPercent: receipt.tax_percent,
      cashGiven: receipt.cash_given,
      taxBase: receipt.tax_base,
    });

  /** The customer lines a given page carries. Page 1 is handed across the
   *  counter, so it never shows the phone number or home address. */
  function customerLines(page) {
    const lines = [];
    if (receipt.customer_name) lines.push(h('.p-sub', receipt.customer_name));
    if (receipt.customer_email) lines.push(h('.p-sub', receipt.customer_email));
    if (page === 2 && receipt.customer_phone) lines.push(h('.p-sub', receipt.customer_phone));
    if (page === 2 && receipt.customer_address) lines.push(h('.p-sub', receipt.customer_address));
    return lines;
  }

  /** The contents of one preview page (1 = customer, 2 = your copy). */
  function paperContent(page, T) {
    const cur = receipt.currency;
    return [
      h('.p-title', receipt.place || 'RECEIPT'),
      h('.p-sub', new Date(receipt.created_at).toLocaleString()),
      h('.p-sub', `${receipt.category} · ${receipt.payment_method}`),
      ...customerLines(page),
      h('hr'),
      receipt.items.length === 0
        ? h('.p-sub', t('noItems'))
        : receipt.items.map((item) =>
            h(
              '.p-item',
              h('div', item.name || '—', h('small', ` ×${item.qty}`)),
              h('div', money(lineTotal(item), cur)),
            ),
          ),
      h('hr'),
      h('.p-row', h('span', t('subtotal')), h('span', money(T.subtotal, cur))),
      T.discount ? h('.p-row', h('span', t('discount')), h('span', `- ${money(T.discount, cur)}`)) : null,
      T.discount
        ? h('.p-row', h('span', t('subtotalAfterDiscount')), h('span', money(T.subtotal - T.discount, cur)))
        : null,
      T.tax ? h('.p-row', h('span', `${t('tax')} ${T.taxPercent}%`), h('span', `+ ${money(T.tax, cur)}`)) : null,
      h('.p-row.total', h('span', t('grandTotal')), h('span', money(T.grandTotal, cur))),
      T.cashGiven ? h('.p-row', h('span', t('cashGiven')), h('span', money(T.cashGiven, cur))) : null,
      T.cashGiven ? h('.p-row', h('span', t('change')), h('span', money(T.change, cur))) : null,
      h('.p-foot', '* * *'),
      h('.p-foot', receipt.note1 || t('thankYou')),
      page === 2 && receipt.note2 ? h('.p-foot', receipt.note2) : null,
      page === 2 && (receipt.issuer_name || receipt.issuer_email)
        ? h('.p-sub', { style: { marginTop: 'var(--s3)' } }, [receipt.issuer_name, receipt.issuer_email].filter(Boolean).join(' · '))
        : null,
      // The map of where the sale happened — your copy only, and only when the
      // Maps feature is switched on (otherwise the image would just 404).
      page === 2 && receipt.lat != null && receipt.lng != null && store.features?.maps?.ready
        ? h('img.p-map', { src: api.location.mapUrl(receipt.lat, receipt.lng, 300, 150), alt: 'Map of where this sale happened' })
        : null,
    ];
  }

  /** One place that repaints both preview pages and the totals box. */
  function repaint() {
    const T = totals();
    const cur = receipt.currency;
    mount(previewCol.querySelector('#paperPreview1'), paperContent(1, T));
    mount(previewCol.querySelector('#paperPreview2'), paperContent(2, T));

    const box = root.querySelector('.totals-box');
    if (box) {
      mount(
        box,
        h('.row', h('span.muted', t('subtotal')), h('span', money(T.subtotal, cur))),
        T.discount ? h('.row', h('span.muted', t('discount')), h('span', `- ${money(T.discount, cur)}`)) : null,
        T.discount
          ? h('.row', h('span.muted', t('subtotalAfterDiscount')), h('span', money(T.subtotal - T.discount, cur)))
          : null,
        h('.row', h('span.muted', `${t('tax')} (${T.taxPercent}%)`), h('span', `+ ${money(T.tax, cur)}`)),
        h('.row.grand', h('span', t('grandTotal')), h('span', money(T.grandTotal, cur))),
        T.cashGiven ? h('.row', h('span.muted', t('cashGiven')), h('span', money(T.cashGiven, cur))) : null,
        T.cashGiven ? h('.row', h('span.muted', t('change')), h('span', money(T.change, cur))) : null,
      );
    }
    saveDraft();
  }

  /**
   * Binds a control to a field on the receipt. `type` is only emitted when
   * asked for, because a textarea has no settable type.
   */
  function bind(field, { type = null, numeric = false } = {}) {
    return {
      ...(type ? { type } : {}),
      value: receipt[field] ?? '',
      oninput: (e) => {
        receipt[field] = numeric ? Number(e.target.value) || 0 : e.target.value;
        repaint();
      },
    };
  }

  /* ---- items -------------------------------------------------------- */

  const itemsHost = h('.grid', { style: { display: 'grid', gap: 'var(--s2)' } });

  /**
   * One item row. Typing updates the data, this row's line total, and the
   * preview — but never re-mounts the row, so the field keeps focus keystroke
   * after keystroke. The whole list is only rebuilt when a row is added or
   * removed (paintItems).
   */
  function itemRow(item, index) {
    const lineSpan = h('span', money(lineTotal(item), receipt.currency));
    const refreshLine = () => {
      lineSpan.textContent = money(lineTotal(item), receipt.currency);
      repaint();
    };

    const priceInput = h('input', {
      type: 'number',
      min: '0',
      step: 'any',
      value: item.price,
      oninput: (e) => {
        item.price = Number(e.target.value) || 0;
        refreshLine();
      },
    });

    const nameInput = h('input', {
      value: item.name,
      list: 'productNames',
      placeholder: t('productName'),
      oninput: (e) => {
        item.name = e.target.value;
        // Choosing a known product fills its price in — updated directly on the
        // price field so the name field you are typing in never loses focus.
        const key = e.target.value.trim().toLowerCase();
        const match = products.find((p) => p.name.toLowerCase() === key);
        const listed = priceList.find((p) => p.name.toLowerCase() === key);
        if (match && !item.price) {
          item.price = match.sell_price;
          item.productId = match.id;
          priceInput.value = item.price;
        } else if (listed && !item.price) {
          item.price = listed.price;
          priceInput.value = item.price;
        }
        refreshLine();
      },
    });

    const qtyInput = h('input', {
      type: 'number',
      min: '0',
      step: 'any',
      value: item.qty,
      oninput: (e) => {
        item.qty = Number(e.target.value) || 0;
        refreshLine();
      },
    });

    return h(
      '.item-row',
      nameInput,
      qtyInput,
      priceInput,
      h(
        '.line-total',
        { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center' } },
        lineSpan,
        h(
          'button.btn.small.ghost',
          {
            title: t('delete'),
            onclick: () => {
              receipt.items.splice(index, 1);
              paintItems();
              repaint();
            },
          },
          '✕',
        ),
      ),
    );
  }

  function paintItems() {
    mount(
      itemsHost,
      receipt.items.length === 0
        ? h('p.muted.small', t('noItems'))
        : receipt.items.map((item, index) => itemRow(item, index)),
    );
  }

  function addItem(item) {
    // Scanning the same thing twice means two of it, not two lines.
    const existing = receipt.items.find(
      (i) => i.name.toLowerCase() === item.name.toLowerCase() && i.price === item.price,
    );
    if (existing) existing.qty += item.qty ?? 1;
    else receipt.items.push({ qty: 1, price: 0, ...item });
    paintItems();
    repaint();
  }

  /* ---- scans from the phone ------------------------------------------ */

  async function onScan(event) {
    const scan = event.detail;
    if (!scan) return;

    if (scan.product) {
      addItem({ name: scan.product.name, price: scan.product.price, qty: 1, productId: scan.product.id });
      toast(`Added — ${scan.product.name} ×1`);
      return;
    }

    // Unknown barcode. Ask once, then it is known forever.
    const created = await askToCreateProduct(scan.barcode);
    if (created) {
      products.push(created);
      refreshProductList();
      addItem({ name: created.name, price: created.sell_price, qty: 1, productId: created.id });
      toast(`Added — ${created.name} ×1`);
      scanner.notifyPhone(`Saved: ${created.name}`);
    }
  }

  function askToCreateProduct(barcode) {
    return new Promise((resolve) => {
      const nameInput = h('input', { placeholder: 'e.g. White Bread Large', autofocus: true });
      const priceInput = h('input', { type: 'number', min: '0', step: 'any', value: '0' });
      const costInput = h('input', { type: 'number', min: '0', step: 'any', value: '0' });
      const stockInput = h('input', { type: 'number', step: 'any', value: '0' });

      const overlay = openDialog(
        h('h2', 'New barcode'),
        h(
          'p.muted',
          'Nothing in your inventory has this barcode. Name it once and the next scan of the ' +
            'same item will add itself.',
        ),
        h('.badge', h('span.mono', barcode)),
        h('.field', h('label', t('name')), nameInput),
        h(
          '.grid-3',
          h('.field', h('label', t('sellingPrice')), priceInput),
          h('.field', h('label', t('costPrice')), costInput),
          h('.field', h('label', t('stock')), stockInput),
        ),
        h(
          '.dialog-actions',
          h(
            'button.btn',
            {
              onclick: () => {
                overlay.remove();
                resolve(null);
              },
            },
            'Skip',
          ),
          h(
            'button.btn.primary',
            {
              onclick: async () => {
                const name = nameInput.value.trim();
                if (!name) {
                  nameInput.focus();
                  return;
                }
                try {
                  const product = await api.products.create({
                    name,
                    barcode,
                    sell_price: Number(priceInput.value) || 0,
                    cost_price: Number(costInput.value) || 0,
                    stock: Number(stockInput.value) || 0,
                  });
                  overlay.remove();
                  resolve(product);
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            'Save & add to receipt',
          ),
        ),
      );
      setTimeout(() => nameInput.focus(), 40);
    });
  }

  scanner.addEventListener('scan', onScan);
  // The listener must die with the screen, or a scan on History would try to
  // add an item to a form that is no longer there.
  new MutationObserver((_, obs) => {
    if (!document.body.contains(root)) {
      scanner.removeEventListener('scan', onScan);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* ---- product name autocomplete -------------------------------------- */

  const datalist = h('datalist', { id: 'productNames' });
  function refreshProductList() {
    const names = new Set([...products.map((p) => p.name), ...priceList.map((p) => p.name)]);
    mount(datalist, [...names].map((n) => h('option', { value: n })));
  }
  refreshProductList();

  /* ---- saving ---------------------------------------------------------- */

  async function generate() {
    if (receipt.items.length === 0) {
      toast('Add at least one item before generating.', 'warn');
      return;
    }

    // Stamp a brand-new memo with the moment it is actually issued, so its time
    // is current — unless the shopkeeper deliberately set a date themselves.
    if (!editId && !dateTouched) receipt.created_at = new Date().toISOString();

    try {
      const saved = editId
        ? await api.receipts.update(editId, receipt)
        : await api.receipts.create(receipt);

      if (!editId) await api.draft.clear();

      if (store.settings.saveSignature && receipt.signature) {
        await saveSettings({ defaultSignature: receipt.signature });
      }

      toast(editId ? `Receipt #${saved.number} updated.` : `Receipt #${saved.number} saved.`);

      if (store.settings.autoPrint) {
        await openPdf(api.receipts.pdfUrl(saved.id), 'print', `receipt-${saved.number}.pdf`);
      }

      go('receipts');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---- the form -------------------------------------------------------- */

  const scannerBadge = h('span.dot');
  const updateScannerBadge = () => {
    scannerBadge.style.background =
      scanner.status === 'connected' ? 'var(--accent)' : 'var(--muted)';
  };
  scanner.addEventListener('status', updateScannerBadge);
  updateScannerBadge();

  /* ---- where the sale happened -------------------------------------- */

  // Kept as a reference so a captured address can be written straight back into it.
  const locationInput = h('input', bind('location_address'));
  const locationStatus = h('span.map-status');

  function captureLocation(btn) {
    if (!navigator.geolocation) {
      toast('This device cannot find your location.', 'warn');
      return;
    }
    btn.disabled = true;
    locationStatus.textContent = 'Finding location…';
    locationStatus.className = 'map-status working';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        receipt.lat = pos.coords.latitude;
        receipt.lng = pos.coords.longitude;
        // The address is a bonus (it needs the Maps feature); the GPS point on
        // its own is already enough to draw the map and stamp the receipt.
        try {
          const { address } = await api.location.reverse(receipt.lat, receipt.lng);
          if (address) {
            receipt.location_address = address;
            locationInput.value = address;
          }
        } catch {
          /* leave the address as it was */
        }
        locationStatus.textContent = '✓ Location captured';
        locationStatus.className = 'map-status ok';
        btn.disabled = false;
        repaint();
      },
      () => {
        locationStatus.textContent = 'Could not get location — allow it in your browser and retry.';
        locationStatus.className = 'map-status err';
        btn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  mount(
    formCol,
    datalist,

    h(
      '.page-head',
      h('h1', editId ? `${t('edit')} #${receipt.number}` : t('newReceipt')),
      h(
        '.actions',
        h(
          'button.btn',
          { onclick: () => openPairingDialog() },
          '📱 ',
          t('phoneScanner'),
          scannerBadge,
        ),
      ),
    ),

    restoredDraft
      ? h(
          '.notice.info',
          h('span', '📝'),
          h('.grow', t('draftRestored')),
          h(
            'button.btn.link',
            {
              onclick: async () => {
                await api.draft.clear();
                location.reload();
              },
            },
            t('discardDraft'),
          ),
        )
      : null,

    h(
      '.card',
      h(
        '.grid-2',
        h('.field', h('label', t('title')), h('input', bind('title'))),
        h('.field', h('label', t('place')), h('input', bind('place'))),
      ),
      h(
        '.field',
        { style: { marginTop: 'var(--s4)' } },
        h('label', t('locationAddress')),
        locationInput,
        h(
          '.row-actions',
          { style: { marginTop: 'var(--s2)' } },
          h(
            'button.btn.small',
            { type: 'button', onclick: (e) => captureLocation(e.currentTarget) },
            '📍 Capture location',
          ),
          locationStatus,
        ),
      ),
      h(
        '.grid-3',
        { style: { marginTop: 'var(--s4)' } },
        h(
          '.field',
          h('label', t('currency')),
          h(
            'select',
            {
              onchange: async (e) => {
                receipt.currency = e.target.value;
                await saveSettings({ defaultCurrency: e.target.value });
                paintItems();
                repaint();
              },
            },
            store.currencies.map((c) =>
              h('option', { value: c.code, selected: c.code === receipt.currency }, `${c.code} — ${c.name}`),
            ),
          ),
        ),
        h(
          '.field',
          h('label', t('paymentMethod')),
          h(
            'select',
            { onchange: (e) => { receipt.payment_method = e.target.value; repaint(); } },
            PAYMENT_METHODS.map((m) =>
              h('option', { value: m, selected: m === receipt.payment_method }, m),
            ),
          ),
        ),
        h(
          '.field',
          h('label', t('category')),
          h(
            'select',
            { onchange: (e) => { receipt.category = e.target.value; repaint(); } },
            CATEGORIES.map((c) => h('option', { value: c, selected: c === receipt.category }, c)),
          ),
        ),
      ),
      h(
        '.field',
        { style: { marginTop: 'var(--s4)' } },
        h('label', t('date')),
        h('input', {
          type: 'datetime-local',
          value: toLocalInput(receipt.created_at),
          onchange: (e) => {
            dateTouched = true;
            receipt.created_at = e.target.value ? new Date(e.target.value).toISOString() : receipt.created_at;
            repaint();
          },
        }),
      ),
    ),

    /* customer */
    h(
      '.card',
      h(
        '.page-head',
        { style: { marginBottom: 'var(--s3)' } },
        h('h2', t('customer')),
        h(
          '.actions',
          members.length > 0
            ? h(
                'select',
                {
                  style: { width: 'auto' },
                  onchange: (e) => {
                    const member = members.find((m) => String(m.id) === e.target.value);
                    if (!member) return;
                    // One pick fills all four fields.
                    receipt.customer_name = member.name;
                    receipt.customer_phone = member.phone;
                    receipt.customer_email = member.email;
                    receipt.customer_address = member.address;
                    renderCustomerFields();
                    repaint();
                  },
                },
                h('option', { value: '' }, t('selectMember')),
                members.map((m) => h('option', { value: String(m.id) }, m.name)),
              )
            : h('a.btn.small.ghost', { href: '#/members' }, `+ ${t('members')}`),
        ),
      ),
      h('.customer-fields'),
    ),

    /* items */
    h(
      '.card',
      h(
        '.page-head',
        { style: { marginBottom: 'var(--s3)' } },
        h('h2', t('items')),
        h(
          '.actions',
          h('button.btn.small', { onclick: () => addItem({ name: '', qty: 1, price: 0 }) }, `+ ${t('addItem')}`),
        ),
      ),
      itemsHost,
      priceList.length > 0
        ? h(
            'div',
            { style: { marginTop: 'var(--s4)' } },
            h('p.small.muted', t('priceList')),
            h(
              '.pills',
              priceList.map((p) =>
                h(
                  'button.pill-btn',
                  { onclick: () => addItem({ name: p.name, price: p.price, qty: 1 }) },
                  `${p.name} · ${money(p.price, receipt.currency)}`,
                ),
              ),
            ),
          )
        : null,
      h(
        '.grid-3',
        { style: { marginTop: 'var(--s5)' } },
        h('.field', h('label', t('discount')), h('input', bind('discount', { type: 'number', numeric: true }))),
        h('.field', h('label', t('taxPercent')), h('input', bind('tax_percent', { type: 'number', numeric: true }))),
        h('.field', h('label', t('cashGiven')), h('input', bind('cash_given', { type: 'number', numeric: true }))),
      ),
      // The tax rule sits on its own full-width line, so it never squeezes the
      // Tax box or throws the three columns above out of alignment.
      h(
        '.tax-note',
        h('span.tax-note-ico', 'ⓘ'),
        h(
          'span',
          receipt.tax_base === 'before-discount' ? t('taxOnBeforeDiscount') : t('taxOnAfterDiscount'),
        ),
      ),
      h('.totals-box'),
    ),

    /* notes + signature */
    h(
      '.card',
      h(
        '.grid-2',
        h('.field', h('label', t('notePage1')), h('textarea', bind('note1'))),
        h('.field', h('label', t('notePage2')), h('textarea', bind('note2'))),
      ),
      h('.field', { style: { marginTop: 'var(--s4)' } }, h('label', t('signature')), h('.sig-host')),
    ),

    h(
      '.page-head',
      { style: { marginTop: 'var(--s5)' } },
      h(
        '.actions',
        { style: { marginInlineStart: '0' } },
        h(
          'button.btn.ghost',
          {
            onclick: async () => {
              const yes = await confirmDialog({
                title: 'Clear this receipt?',
                body: 'Everything typed here is discarded. Receipts already generated are not touched.',
                confirmLabel: 'Clear',
              });
              if (!yes) return;
              await api.draft.clear();
              location.hash = '#/new';
              location.reload();
            },
          },
          t('clear'),
        ),
        h('button.btn.primary', { onclick: generate }, `✓ ${editId ? t('save') : t('generate')}`),
      ),
    ),
  );

  function renderCustomerFields() {
    mount(
      formCol.querySelector('.customer-fields'),
      h(
        '.grid-2',
        h('.field', h('label', t('name')), h('input', bind('customer_name'))),
        h('.field', h('label', t('phone')), h('input', bind('customer_phone'))),
        h('.field', h('label', t('email')), h('input', bind('customer_email', { type: 'email' }))),
        h('.field', h('label', t('address')), h('input', bind('customer_address'))),
      ),
    );
  }

  renderCustomerFields();
  paintItems();

  attachSignaturePad(formCol.querySelector('.sig-host'), {
    initial: receipt.signature,
    onChange: (dataUrl) => {
      receipt.signature = dataUrl;
      saveDraft();
    },
  });

  root.append(formCol, previewCol);
  repaint();
  return root;
}

/** An ISO timestamp as the value a datetime-local input expects. */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
