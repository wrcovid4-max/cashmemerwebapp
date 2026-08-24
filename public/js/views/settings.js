/**
 * Settings.
 *
 * The section that matters most here is Backup. `git clone` does not bring
 * your receipts back — the JSON export is the only thing that moves your shop
 * between machines — so that is said on the screen, not just in the README.
 */
import { h, mount, toast, confirmDialog } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { store, saveSettings } from '../store.js';

export async function renderSettings({ params } = {}) {
  const auth = await api.auth.status();
  const s = store.settings;

  const root = h('div');

  /** A labelled on/off row that saves the moment it is flipped. */
  const toggle = (key, title, description) =>
    h(
      '.switch',
      h('.label', h('strong', title), description ? h('span', description) : null),
      h('input', {
        type: 'checkbox',
        checked: Boolean(s[key]),
        onchange: async (e) => {
          await saveSettings({ [key]: e.target.checked });
          toast('Saved.');
        },
      }),
    );

  /** A text field that saves when it loses focus, not on every keystroke. */
  const textSetting = (key, label, placeholder = '') =>
    h(
      '.field',
      h('label', label),
      h('input', {
        value: s[key] ?? '',
        placeholder,
        onchange: async (e) => {
          await saveSettings({ [key]: e.target.value });
          toast('Saved.');
        },
      }),
    );

  const lockHost = h('div');
  // Status line for the "Back up" button in the Google card.
  const gSyncStatus = h('span.backup-status');

  /** Repaints the passcode card, so the device count stays honest. */
  async function paintLock() {
    let state;
    try {
      state = await api.lock.state();
    } catch (err) {
      mount(lockHost, h('.notice.error', h('.grow.small', err.message)));
      return;
    }

    const current = h('input', { type: 'password', placeholder: 'current passcode' });
    const next = h('input', { type: 'password', placeholder: 'new passcode, 4+ characters' });
    const again = h('input', { type: 'password', placeholder: 'type the new one again' });

    mount(
      lockHost,
      h(
        '.row-actions',
        { style: { marginBottom: 'var(--s4)' } },
        h(
          `span.badge${state.hasPasscode ? '.ok' : '.bad'}`,
          h('span.dot'),
          state.hasPasscode ? 'Locked' : 'NO PASSCODE SET',
        ),
        h('span.badge', `${state.devices} device${state.devices === 1 ? '' : 's'} signed in`),
      ),

      h(
        '.grid-3',
        state.hasPasscode ? h('.field', h('label', 'Current'), current) : null,
        h('.field', h('label', 'New passcode'), next),
        h('.field', h('label', 'Confirm'), again),
      ),

      h(
        '.row-actions',
        { style: { marginTop: 'var(--s4)' } },
        h(
          'button.btn.small.primary',
          {
            onclick: async (e) => {
              if (next.value !== again.value) {
                toast('The two new passcodes do not match.', 'warn');
                return;
              }
              if (next.value.length < 4) {
                toast('The passcode needs at least 4 characters.', 'warn');
                return;
              }
              e.currentTarget.disabled = true;
              try {
                await api.lock.change(current.value, next.value);
                toast('Passcode changed. Every other device has been signed out.');
                paintLock();
              } catch (err) {
                toast(err.message, 'error');
              } finally {
                e.currentTarget.disabled = false;
              }
            },
          },
          state.hasPasscode ? 'Change passcode' : 'Set a passcode',
        ),

        h(
          'button.btn.small',
          {
            onclick: async () => {
              await api.lock.lockNow();
              location.replace('/login');
            },
          },
          'Lock this device now',
        ),

        // For a phone that has been lost, or a device you cannot get back to.
        h(
          'button.btn.small.danger',
          {
            onclick: async () => {
              const yes = await confirmDialog({
                title: 'Sign every device out?',
                body:
                  'Every phone and computer, including this one, will have to enter the ' +
                  'passcode again. Use this if a phone has gone missing.',
                confirmLabel: 'Sign all out',
              });
              if (!yes) return;
              await api.lock.signOutEverywhere();
              location.replace('/login');
            },
          },
          'Sign out everywhere',
        ),
      ),
    );
  }


  mount(
    root,
    h('.page-head', h('h1', t('settings'))),

    /* ---- keep a copy of your shop ---- */
    h(
      '.notice.warn',
      h('span', '⚠️'),
      h(
        '.grow',
        h('strong', 'Keep a copy of your shop.'),
        h(
          'p.small',
          'Your receipts and customers live on this device. Use Back up now and then, and keep ' +
            'the copy somewhere safe, so nothing is lost if this device is.',
        ),
      ),
    ),

    /* ---- shop ---- */
    h(
      '.card',
      h('h2', 'Your shop'),
      h('p.small.muted', 'These fill in a new receipt so you are not retyping them all day.'),
      h(
        '.grid-2',
        { style: { marginTop: 'var(--s3)' } },
        textSetting('storeName', 'Store name', 'Mart (Example)'),
        textSetting('storeAddress', 'Store address'),
      ),
      // The Maps key lives with the store's location settings. It is stored on
      // this device and never shown back, so the field starts blank.
      h(
        '.field',
        { style: { marginTop: 'var(--s4)' } },
        h('label', 'Google Maps key — for the location map'),
        h('input', {
          type: 'password',
          autocomplete: 'off',
          placeholder: s.mapsKeySet
            ? 'A key is saved — type a new one to replace it'
            : 'Paste your Google Maps key',
          onchange: async (e) => {
            const value = e.target.value.trim();
            if (!value) return;
            await saveSettings({ mapsApiKey: value });
            e.target.value = '';
            toast('Maps key saved. Reload to see the map on new receipts.');
          },
        }),
        h(
          'p.small.muted',
          'Turns on the map of where each sale happened. Kept on this device and never shown again.',
        ),
      ),
      h(
        '.grid-2',
        { style: { marginTop: 'var(--s4)' } },
        textSetting('issuerName', 'Issuer name (page 2 only)'),
        textSetting('issuerEmail', 'Issuer email (page 2 only)'),
      ),
      h(
        '.field',
        { style: { marginTop: 'var(--s4)' } },
        h('label', 'Default note for page 1'),
        h('input', {
          value: s.defaultNote1 ?? '',
          onchange: async (e) => {
            await saveSettings({ defaultNote1: e.target.value });
            toast('Saved.');
          },
        }),
      ),
    ),

    /* ---- appearance ---- */
    h(
      '.card',
      h('h2', t('appearance')),
      h(
        '.field',
        h('label', t('theme')),
        h(
          'select',
          {
            onchange: async (e) => {
              await saveSettings({ theme: e.target.value });
            },
          },
          [
            ['system', t('system')],
            ['light', t('light')],
            ['dark', t('dark')],
          ].map(([value, label]) => h('option', { value, selected: s.theme === value }, label)),
        ),
      ),
    ),

    /* ---- printing ---- */
    h(
      '.card',
      h('h2', t('print')),
      toggle('autoPrint', 'Auto-print', 'Send the memo to the print dialog as soon as it is generated.'),
      toggle('saveSignature', 'Remember my signature', 'Reuse the last signature on the next receipt.'),
      h(
        'p.small.muted',
        { style: { marginTop: 'var(--s4)' } },
        'Every receipt is always two pages: page 1 for the customer, page 2 for ' +
          'you. Page 1 never carries the customer’s phone, email or address, ' +
          'the page-2 note, or your account details.',
      ),
    ),

    /* ---- how tax is worked out ---- */
    h(
      '.card',
      h('h2', 'Tax'),
      h(
        '.field',
        h('label', 'Tax percentage is charged on'),
        h(
          'select',
          {
            onchange: async (e) => {
              await saveSettings({ taxBase: e.target.value });
              toast('Saved. This applies to new receipts.');
            },
          },
          [
            ['after-discount', 'The amount after the discount (usual)'],
            ['before-discount', 'The full price, before any discount'],
          ].map(([value, label]) => h('option', { value, selected: s.taxBase === value }, label)),
        ),
      ),
      h(
        '.notice',
        { style: { marginTop: 'var(--s3)' } },
        h(
          '.grow',
          h('strong', 'Worked example'),
          h(
            'p.small',
            s.taxBase === 'before-discount'
              ? 'A ₨60 sale with a ₨50 discount at 15%: tax is 15% of ₨60 = ₨9.00, ' +
                'so the customer pays ₨19.00.'
              : 'A ₨60 sale with a ₨50 discount at 15%: tax is 15% of the ₨10 actually ' +
                'paid = ₨1.50, so the customer pays ₨11.50.',
          ),
          h(
            'p.small.muted',
            'Each receipt remembers the rule it was issued under, so changing this ' +
              'never alters a memo you have already given someone.',
          ),
        ),
      ),
    ),

    /* ---- backup ---- */
    h(
      '.card',
      h('h2', t('backupRestore')),
      h(
        'p.small.muted',
        'Export saves your whole shop as one file you keep. Restore reads it back on this or another ' +
          'computer. It is the only copy that moves with you, so save one now and then.',
      ),
      h(
        '.row-actions',
        { style: { marginTop: 'var(--s4)' } },
        h('a.btn.primary', { href: '/api/backup/export' }, `⬇ ${t('exportJson')}`),
        h(
          'button.btn',
          {
            onclick: () => {
              const picker = h('input', {
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onchange: async () => {
                  const file = picker.files?.[0];
                  if (!file) return;
                  let payload;
                  try {
                    payload = JSON.parse(await file.text());
                  } catch {
                    toast('That file is not readable JSON.', 'error');
                    return;
                  }
                  const yes = await confirmDialog({
                    title: 'Restore from this file?',
                    body:
                      'Everything currently on this computer — receipts, products, customers — is ' +
                      'replaced by what is in the file. Export first if you are not sure.',
                    confirmLabel: 'Replace everything',
                  });
                  if (!yes) return;
                  try {
                    const result = await api.backup.importJson(payload, 'replace');
                    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
                    toast(`Restored ${total} rows.`);
                    setTimeout(() => location.reload(), 900);
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              });
              document.body.append(picker);
              picker.click();
              setTimeout(() => picker.remove(), 60_000);
            },
          },
          `⬆ ${t('importJson')}`,
        ),
      ),
    ),

    /* ---- the lock on the till ---- */
    h(
      '.card',
      h('h2', '🔒 Passcode'),
      h(
        'p.small.muted',
        'Protect your shop with a passcode. Each device is asked once and stays signed in for ' +
          '30 days.',
      ),
      lockHost,
    ),

    /* ---- google ---- */
    h(
      '.card',
      { id: 'googleCard' },
      h('h2', 'Google sign-in'),
      !auth.configured
        ? h(
            '.notice',
            h(
              '.grow',
              h('strong', 'Google sign-in isn’t connected yet.'),
              h(
                'p.small',
                'Connect it to fill your name and email onto your copy of each receipt automatically.',
              ),
            ),
          )
        : auth.account
          ? h(
              '.row-actions',
              h('span.badge.ok', h('span.dot'), `${auth.account.name} · ${auth.account.email}`),
              h(
                'button.btn.small',
                {
                  onclick: async () => {
                    await api.auth.signOut();
                    toast('Signed out.');
                    location.reload();
                  },
                },
                t('signOut'),
              ),
            )
          : h('a.btn.primary', { href: '/api/auth/google' }, t('signIn')),

      // Two separate actions, each with its own plain progress line.
      h('hr', { style: { border: '0', borderTop: '1px solid var(--line)', margin: 'var(--s4) 0' } }),
      h(
        '.row-actions',
        h(
          'button.btn.small.primary',
          {
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              gSyncStatus.textContent = 'Backing up…';
              gSyncStatus.className = 'backup-status working';
              try {
                const res = await fetch('/api/backup/export');
                if (!res.ok) throw new Error('Backup could not be created.');
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `cashmemer-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                gSyncStatus.textContent = '✓ Backup done';
                gSyncStatus.className = 'backup-status ok';
              } catch (err) {
                gSyncStatus.textContent = err.message;
                gSyncStatus.className = 'backup-status err';
              } finally {
                btn.disabled = false;
              }
            },
          },
          'Back up',
        ),
        h(
          'button.btn.small',
          {
            onclick: async (e) => {
              const btn = e.currentTarget;
              if (!store.features?.firebase?.ready) {
                gSyncStatus.textContent = 'Cloud sync needs your Firebase details first (coming).';
                gSyncStatus.className = 'backup-status working';
                return;
              }
              btn.disabled = true;
              gSyncStatus.textContent = 'Syncing…';
              gSyncStatus.className = 'backup-status working';
              try {
                const r = await api.sync.now();
                gSyncStatus.textContent = `✓ Synced — ${r.pushed} up, ${r.pulled} down`;
                gSyncStatus.className = 'backup-status ok';
              } catch (err) {
                gSyncStatus.textContent = err.message;
                gSyncStatus.className = 'backup-status err';
              } finally {
                btn.disabled = false;
              }
            },
          },
          'Sync',
        ),
        gSyncStatus,
      ),
      h(
        'p.small.muted',
        { style: { marginTop: 'var(--s2)' } },
        'Back up saves a file to this device. Sync keeps your shop in your Google account, across ' +
          'every device — through Firebase, never a Drive folder.',
      ),
    ),
  );

  paintLock();

  // Arriving from the sidebar's "Sign in with Google" lands on the Google card
  // rather than the top of a long Settings page.
  if (params?.get('focus') === 'google') {
    requestAnimationFrame(() => {
      const card = root.querySelector('#googleCard');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1600);
      }
    });
  }

  return root;
}
