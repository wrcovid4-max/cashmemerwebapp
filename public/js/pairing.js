/**
 * The "Pair your phone as a scanner" dialog.
 *
 * Deliberately closeable: pairing survives the dialog being dismissed, so you
 * set it up once in the morning and never see this again for the rest of the
 * day. Closing it does not unpair anything.
 */
import { h, mount, openDialog } from './dom.js';
import { t } from './i18n.js';
import { scanner } from './scanner.js';
import { store } from './store.js';

export async function openPairingDialog() {
  const statusEl = h('.badge', h('span.dot'), t('pairWaiting'));
  const qrHolder = h('div', h('p.muted', '…'));
  const urlEl = h('.url', '');

  const body = h(
    '.pair',
    h('h2', `📱 ${t('pairTitle')}`),
    h('p.muted', t('pairBody')),
    qrHolder,
    urlEl,
    statusEl,
    h('p.small.muted', t('pairKeepOpen')),
  );

  const overlay = openDialog(
    body,
    h(
      '.dialog-actions',
      h(
        'button.btn.ghost',
        {
          onclick: () => {
            scanner.unpair();
            overlay.remove();
          },
        },
        'Unpair',
      ),
      h('button.btn.primary', { onclick: () => overlay.remove() }, t('done')),
    ),
  );

  const paint = () => {
    const live = scanner.status;
    statusEl.className = `badge${live === 'connected' ? ' ok' : live === 'connecting' ? ' warn' : ''}`;
    mount(
      statusEl,
      h('span.dot'),
      live === 'connected'
        ? t('pairConnected')
        : live === 'connecting'
          ? t('pairDropped')
          : t('pairWaiting'),
    );
  };

  const off = () => scanner.removeEventListener('status', paint);
  scanner.addEventListener('status', paint);
  // Stop listening once the dialog is gone, so a long session does not pile up
  // listeners every time this is opened.
  new MutationObserver((_, obs) => {
    if (!document.body.contains(overlay)) {
      off();
      obs.disconnect();
    }
  }).observe(document.body, { childList: true });

  try {
    const pairing = await scanner.createPairing();
    mount(qrHolder, h('img.qr', { src: pairing.qr, alt: 'Pairing QR code' }));
    mount(
      urlEl,
      h('div', pairing.url),
      h('div', { style: { marginTop: '6px' } }, 'Code: ', h('span.mono', pairing.code)),
    );
    paint();
  } catch (err) {
    mount(
      qrHolder,
      h(
        '.notice.error',
        h('.grow', h('strong', 'Could not create a pairing.'), h('p.small', err.message)),
      ),
    );
  }

  if (!store.urls?.lanIp) {
    body.append(
      h(
        '.notice.warn',
        h(
          '.grow',
          h('strong', 'This computer is not on a network.'),
          h(
            'p.small',
            'The QR points at an address your phone cannot reach. Connect this computer to the ' +
              'same Wi-Fi as your phone and restart Cash Memer.',
          ),
        ),
      ),
    );
  } else {
    body.append(
      h(
        'p.small.muted',
        'Your phone will warn once that the connection "is not private" — that is this computer ' +
          'signing its own certificate. Tap Advanced, then Proceed.',
      ),
    );
  }

  return overlay;
}
