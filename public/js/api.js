/**
 * Talking to the server.
 *
 * Every call funnels through request(), so an error always reaches the screen
 * as a sentence a shopkeeper can act on rather than a status code.
 */

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // fetch only rejects when the server is unreachable.
    throw new Error(
      'Cannot reach Cash Memer. Is it still running in the terminal window? ' +
        'If you closed that window, start it again with: npm start',
    );
  }

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `The server said no (${response.status}).`);
  }
  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),

  bootstrap: () => request('GET', '/api/bootstrap'),

  settings: {
    get: () => request('GET', '/api/settings'),
    save: (patch) => request('PUT', '/api/settings', patch),
  },

  products: {
    list: (q = '', filter = 'all') =>
      request('GET', `/api/products?q=${encodeURIComponent(q)}&filter=${filter}`),
    byBarcode: (code) => request('GET', `/api/products/barcode/${encodeURIComponent(code)}`),
    create: (p) => request('POST', '/api/products', p),
    update: (id, p) => request('PUT', `/api/products/${id}`, p),
    duplicate: (id) => request('POST', `/api/products/${id}/duplicate`, {}),
    remove: (id) => request('DELETE', `/api/products/${id}`),
  },

  priceList: {
    list: () => request('GET', '/api/pricelist'),
    create: (p) => request('POST', '/api/pricelist', p),
    update: (id, p) => request('PUT', `/api/pricelist/${id}`, p),
    remove: (id) => request('DELETE', `/api/pricelist/${id}`),
  },

  members: {
    list: (q = '') => request('GET', `/api/members?q=${encodeURIComponent(q)}`),
    create: (m) => request('POST', '/api/members', m),
    update: (id, m) => request('PUT', `/api/members/${id}`, m),
    remove: (id) => request('DELETE', `/api/members/${id}`),
  },

  receipts: {
    list: ({ q = '', from = '', to = '' } = {}) =>
      request('GET', `/api/receipts?q=${encodeURIComponent(q)}&from=${from}&to=${to}`),
    get: (id) => request('GET', `/api/receipts/${id}`),
    create: (r) => request('POST', '/api/receipts', r),
    update: (id, r) => request('PUT', `/api/receipts/${id}`, r),
    duplicate: (id) => request('POST', `/api/receipts/${id}/duplicate`, {}),
    pin: (id) => request('POST', `/api/receipts/${id}/pin`, {}),
    remove: (id) => request('DELETE', `/api/receipts/${id}`),
    bulkDelete: (ids) => request('POST', '/api/receipts/bulk-delete', { ids }),
    pdfUrl: (id) => `/api/receipts/${id}/pdf`,
  },

  summary: {
    weekly: () => request('GET', '/api/summary/weekly'),
    insight: () => request('POST', '/api/summary/insight', {}),
  },

  dashboard: () => request('GET', '/api/dashboard'),

  rates: {
    list: (refresh = false) => request('GET', `/api/rates${refresh ? '?refresh=1' : ''}`),
    addCustom: (c) => request('POST', '/api/rates/custom', c),
    removeCustom: (code) => request('DELETE', `/api/rates/custom/${encodeURIComponent(code)}`),
  },

  pair: {
    create: () => request('POST', '/api/pair', {}),
    status: (code) => request('GET', `/api/pair/${encodeURIComponent(code)}/status`),
  },

  draft: {
    get: () => request('GET', '/api/draft'),
    save: (payload) => request('PUT', '/api/draft', payload),
    clear: () => request('DELETE', '/api/draft'),
  },

  backup: {
    status: () => request('GET', '/api/backup/status'),
    run: () => request('POST', '/api/backup/run', {}),
    importJson: (payload, mode) => request('POST', '/api/backup/import', { payload, mode }),
  },

  auth: {
    status: () => request('GET', '/api/auth/status'),
    signOut: () => request('POST', '/api/auth/signout', {}),
  },
};

/**
 * Downloads a PDF and hands it to the browser.
 *
 * `print` opens it in a tab and calls the print dialog; `share` uses the
 * phone/OS share sheet where the browser has one and falls back to a download
 * where it does not.
 */
export async function openPdf(url, mode = 'view', filename = 'receipt.pdf') {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The receipt could not be produced.');
  const blob = await response.blob();

  if (mode === 'share' && navigator.canShare) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  }

  const objectUrl = URL.createObjectURL(blob);

  if (mode === 'download' || mode === 'share') {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return;
  }

  const tab = window.open(objectUrl, '_blank');
  if (!tab) {
    throw new Error(
      'Your browser blocked the receipt window. Allow pop-ups for this site, then try again.',
    );
  }
  if (mode === 'print') {
    // Waiting for load means the print dialog opens on the receipt, not on a
    // blank tab that has not finished fetching yet.
    tab.addEventListener('load', () => tab.print(), { once: true });
    setTimeout(() => {
      try {
        tab.print();
      } catch {
        /* the user can still press Ctrl+P */
      }
    }, 1200);
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
