/**
 * Terminal — connected devices.
 *
 * The Android app talks to counter hardware over Bluetooth Serial Port
 * Profile. A browser cannot do that: SPP is not exposed to web pages by any
 * browser, on any platform. What a browser *can* do is Web Serial (a printer
 * on USB, or a Bluetooth printer paired as a serial port by the operating
 * system) and Web Bluetooth (devices that speak GATT).
 *
 * So this screen tells you plainly what your browser supports rather than
 * showing switches that quietly do nothing, and gives you the two things that
 * genuinely work from here: the phone scanner, and raw ESC/POS bytes to a
 * serial printer.
 */
import { h, mount, toast } from '../dom.js';
import { t } from '../i18n.js';
import { store } from '../store.js';
import { scanner } from '../scanner.js';
import { openPairingDialog } from '../pairing.js';

/** A rolling event log, kept in memory for as long as the app is open. */
const log = [];
const MAX_LOG = 200;

function addLog(text, kind = 'info') {
  log.unshift({ at: new Date(), text, kind });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  window.dispatchEvent(new CustomEvent('cashmemer:log'));
}

/* ------------------------------------------------------------------ *
 * a serial printer, when the browser has Web Serial
 * ------------------------------------------------------------------ */

const serial = {
  port: null,
  async connect() {
    if (!('serial' in navigator)) throw new Error('This browser has no Web Serial support.');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    this.port = port;
    addLog('Serial device connected.', 'ok');
    return port;
  },
  async disconnect() {
    try {
      await this.port?.close();
    } catch {
      /* already gone */
    }
    this.port = null;
    addLog('Serial device disconnected.');
  },
  async write(bytes) {
    if (!this.port) throw new Error('Nothing is connected.');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  },
};

/** Parses "1B 40" or "27,64" into bytes, or sends plain text as-is. */
function parseBytes(input) {
  const text = input.trim();
  const looksHex = /^[0-9a-fA-F\s,]+$/.test(text) && /[\s,]/.test(text);
  if (looksHex) {
    const parts = text.split(/[\s,]+/).filter(Boolean);
    return new Uint8Array(parts.map((p) => parseInt(p, 16) & 0xff));
  }
  return new TextEncoder().encode(`${text}\n`);
}

export async function renderTerminal() {
  const root = h('div');
  const logHost = h('.card');
  const serialHost = h('.card');

  const paintLog = () => {
    mount(
      logHost,
      h(
        '.page-head',
        { style: { marginBottom: 'var(--s3)' } },
        h('h2', 'Event log'),
        h(
          '.actions',
          h(
            'button.btn.small.ghost',
            {
              onclick: () => {
                log.length = 0;
                paintLog();
              },
            },
            t('clear'),
          ),
        ),
      ),
      log.length === 0
        ? h('p.small.muted', 'Nothing yet.')
        : h(
            'div',
            { style: { display: 'grid', gap: '2px', maxHeight: '280px', overflow: 'auto' } },
            log.map((entry) =>
              h(
                '.small',
                { style: { display: 'flex', gap: 'var(--s3)' } },
                h('span.muted.mono', entry.at.toLocaleTimeString()),
                h('span', { style: entry.kind === 'ok' ? { color: 'var(--accent-text)' } : {} }, entry.text),
              ),
            ),
          ),
    );
  };

  window.addEventListener('cashmemer:log', paintLog);
  new MutationObserver((_, obs) => {
    if (!document.body.contains(root)) {
      window.removeEventListener('cashmemer:log', paintLog);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });

  const paintSerial = () => {
    const supported = 'serial' in navigator;
    const bytesInput = h('input', { placeholder: '1B 40   (or plain text)', value: '' });

    mount(
      serialHost,
      h('h2', 'Receipt printer over serial'),
      !supported
        ? h(
            '.notice.warn',
            h(
              '.grow',
              h('strong', 'This browser cannot talk to serial devices.'),
              h(
                'p.small',
                'Web Serial exists in Chrome, Edge and Opera on desktop. Safari and Firefox do not ' +
                  'have it. You can still print to any printer your computer knows about, from the ' +
                  'normal print dialog — that is what the Print buttons use.',
              ),
            ),
          )
        : h(
            'div',
            h(
              'p.small.muted',
              'For thermal printers that appear as a serial port. Ordinary printing does not need ' +
                'this — the Print buttons go through your computer’s print dialog.',
            ),
            h(
              '.row-actions',
              { style: { marginTop: 'var(--s3)' } },
              serial.port
                ? h(
                    'button.btn.small',
                    {
                      onclick: async () => {
                        await serial.disconnect();
                        paintSerial();
                      },
                    },
                    'Disconnect',
                  )
                : h(
                    'button.btn.small.primary',
                    {
                      onclick: async () => {
                        try {
                          await serial.connect();
                          paintSerial();
                        } catch (err) {
                          // Cancelling the browser's device chooser is not an error.
                          if (err.name !== 'NotFoundError') toast(err.message, 'error');
                        }
                      },
                    },
                    'Choose a device',
                  ),
              h('span.badge' + (serial.port ? '.ok' : ''), h('span.dot'), serial.port ? 'Connected' : 'Not connected'),
            ),
            h(
              '.field',
              { style: { marginTop: 'var(--s4)' } },
              h('label', 'Send raw bytes'),
              h('div', { style: { display: 'flex', gap: 'var(--s2)' } }, bytesInput, h(
                'button.btn.small',
                {
                  onclick: async () => {
                    try {
                      await serial.write(parseBytes(bytesInput.value));
                      addLog(`Sent: ${bytesInput.value}`, 'ok');
                      bytesInput.value = '';
                    } catch (err) {
                      toast(err.message, 'error');
                      addLog(`Send failed: ${err.message}`, 'error');
                    }
                  },
                },
                'Send',
              )),
              h('p.small.muted', 'Hex like "1B 40" is sent as bytes; anything else is sent as text.'),
            ),
          ),
    );
  };

  const diagnostics = () => {
    const checks = [
      ['Phone scanner paired', Boolean(scanner.code)],
      ['Phone connected right now', scanner.status === 'connected'],
      ['This computer is on a network', Boolean(store.urls?.lanIp)],
      ['Https available for the phone camera', Boolean(store.urls?.lanHttps)],
      ['Web Serial (thermal printers)', 'serial' in navigator],
      ['Web Bluetooth (GATT devices)', 'bluetooth' in navigator],
      ['Camera API in this browser', Boolean(navigator.mediaDevices?.getUserMedia)],
    ];
    return h(
      'div',
      { style: { display: 'grid', gap: 'var(--s2)' } },
      checks.map(([label, ok]) =>
        h(
          'div',
          { style: { display: 'flex', gap: 'var(--s3)', alignItems: 'center' } },
          h(`span.badge${ok ? '.ok' : ''}`, ok ? '✓' : '·'),
          h('span', label),
        ),
      ),
    );
  };

  mount(
    root,
    h('.page-head', h('h1', t('terminal'))),

    h(
      '.card',
      h('h2', `📱 ${t('phoneScanner')}`),
      h(
        'p.small.muted',
        'The scanner this app actually uses. Your phone reads the barcode and the item appears ' +
          'in the open receipt on this screen.',
      ),
      h(
        '.row-actions',
        { style: { marginTop: 'var(--s3)' } },
        h(
          `span.badge${scanner.status === 'connected' ? '.ok' : ''}`,
          h('span.dot'),
          scanner.status === 'connected'
            ? t('pairConnected')
            : scanner.code
              ? t('pairWaiting')
              : 'Not paired',
        ),
        h('button.btn.small.primary', { onclick: () => openPairingDialog() }, 'Pair a phone'),
        scanner.code
          ? h(
              'button.btn.small.ghost',
              {
                onclick: () => {
                  scanner.unpair();
                  addLog('Phone unpaired.');
                  toast('Unpaired.');
                },
              },
              'Forget this pairing',
            )
          : null,
      ),
    ),

    serialHost,

    h('.card', h('h2', 'Diagnostics'), diagnostics()),

    logHost,
  );

  paintSerial();
  paintLog();

  const onScan = (e) => addLog(`Scan: ${e.detail.barcode}${e.detail.product ? ` → ${e.detail.product.name}` : ' (not in inventory)'}`, 'ok');
  const onStatus = (e) => addLog(`Scanner: ${e.detail}`);
  scanner.addEventListener('scan', onScan);
  scanner.addEventListener('status', onStatus);
  new MutationObserver((_, obs) => {
    if (!document.body.contains(root)) {
      scanner.removeEventListener('scan', onScan);
      scanner.removeEventListener('status', onStatus);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });

  return root;
}
