/**
 * Terminal — the phone scanner.
 *
 * Kept deliberately simple: pair a phone, see whether it is connected, and get
 * on with the sale. The barcode is read on the phone and the item appears in
 * the open receipt on this screen.
 */
import { h, mount, toast } from '../dom.js';
import { t } from '../i18n.js';
import { scanner } from '../scanner.js';
import { openPairingDialog } from '../pairing.js';

export async function renderTerminal() {
  const root = h('div');

  const paint = () => {
    const connected = scanner.status === 'connected';
    mount(
      root,
      h('.page-head', h('h1', t('terminal'))),

      h(
        '.card',
        h('h2', `📱 ${t('phoneScanner')}`),
        h(
          'p.small.muted',
          'Turn your phone into a barcode scanner. Pair it once, point it at a barcode, and the ' +
            'item drops straight into the open receipt on this screen.',
        ),
        h(
          '.row-actions',
          { style: { marginTop: 'var(--s3)' } },
          h(
            `span.badge${connected ? '.ok' : ''}`,
            h('span.dot'),
            connected ? t('pairConnected') : scanner.code ? t('pairWaiting') : 'Not paired',
          ),
          h('button.btn.small.primary', { onclick: () => openPairingDialog() }, 'Pair a phone'),
          scanner.code
            ? h(
                'button.btn.small.ghost',
                {
                  onclick: () => {
                    scanner.unpair();
                    toast('Unpaired.');
                    paint();
                  },
                },
                'Forget this pairing',
              )
            : null,
        ),
      ),
    );
  };

  paint();

  // Keep the connection badge honest as the phone joins or drops.
  scanner.addEventListener('status', paint);
  new MutationObserver((_, obs) => {
    if (!document.body.contains(root)) {
      scanner.removeEventListener('status', paint);
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });

  return root;
}
