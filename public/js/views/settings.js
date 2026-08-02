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
import { store, saveSettings, formatDateTime } from '../store.js';

export async function renderSettings() {
  const [auth, backup] = await Promise.all([api.auth.status(), api.backup.status()]);
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

  const backupHost = h('div');

  function paintBackup(status) {
    mount(
      backupHost,
      status.lastBackupError
        ? h(
            '.notice.error',
            h('.grow', h('strong', 'The last automatic backup failed'), h('p.small', status.lastBackupError)),
          )
        : h(
            '.notice' + (status.lastBackupAt ? '.info' : ''),
            h(
              '.grow',
              h('strong', `${t('lastBackup')}: ${status.lastBackupAt ? formatDateTime(status.lastBackupAt) : t('never')}`),
              h('p.small', `The newest ${status.keep} snapshots are kept; older ones are deleted automatically.`),
            ),
          ),
    );
  }

  mount(
    root,
    h('.page-head', h('h1', t('settings'))),

    /* ---- what a clone will not give you ---- */
    h(
      '.notice.warn',
      h('span', '⚠️'),
      h(
        '.grow',
        h('strong', 'Your receipts are not in git.'),
        h(
          'p.small',
          'A fresh copy of this project from GitHub arrives empty: no receipts, no products, no ' +
            'customers, no settings, and no API keys. The Export button below produces the one ' +
            'file that carries all of it. Keep that file somewhere that is not this computer.',
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
      toggle(
        'autoSend',
        'Auto-send',
        'Open your mail app (or messages) with the receipt details, ready to send. It never sends on its own.',
      ),
      toggle('saveSignature', 'Remember my signature', 'Reuse the last signature on the next receipt.'),
      h(
        '.field',
        { style: { marginTop: 'var(--s4)' } },
        h('label', 'Which pages print'),
        h(
          'select',
          {
            onchange: async (e) => {
              await saveSettings({ massPrintOption: e.target.value });
              toast('Saved.');
            },
          },
          [
            ['both', 'Both pages'],
            ['page1', "Page 1 only — the customer's copy"],
            ['page2', 'Page 2 only — your copy'],
          ].map(([value, label]) => h('option', { value, selected: s.massPrintOption === value }, label)),
        ),
      ),
    ),

    /* ---- backup ---- */
    h(
      '.card',
      h('h2', t('backupRestore')),
      backupHost,
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

      h('h3', { style: { marginTop: 'var(--s6)' } }, t('automaticBackup')),
      h(
        'p.small.muted',
        'Point this at a folder that syncs somewhere else — Google Drive, Dropbox, OneDrive, ' +
          'iCloud — and a copy of your shop leaves this computer every day without you doing ' +
          'anything.',
      ),
      h(
        '.field',
        { style: { marginTop: 'var(--s3)' } },
        h('label', t('backupFolder')),
        h('input', {
          value: s.backupFolder ?? '',
          placeholder: '/Users/you/Google Drive/CashMemer',
          onchange: async (e) => {
            await saveSettings({ backupFolder: e.target.value.trim() });
            toast('Saved.');
          },
        }),
        h(
          'p.small.muted',
          'A full path on this computer. The browser cannot open a folder picker for the server, ' +
            'so this is typed in — copy it from your file manager’s address bar.',
        ),
      ),
      toggle('backupEnabled', 'Back up every day', 'Checked once a day while Cash Memer is running.'),
      h(
        'button.btn.small',
        {
          style: { marginTop: 'var(--s3)' },
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const result = await api.backup.run();
              if (result.ok) {
                toast(`Snapshot written${result.pruned ? `, ${result.pruned} old ones removed` : ''}.`);
              } else {
                toast(result.error, 'error');
              }
              paintBackup(await api.backup.status());
            } finally {
              e.currentTarget.disabled = false;
            }
          },
        },
        t('backupNow'),
      ),
    ),

    /* ---- google ---- */
    h(
      '.card',
      h('h2', 'Google sign-in'),
      !auth.configured
        ? h(
            '.notice.warn',
            h(
              '.grow',
              h('strong', 'Not set up — and not required.'),
              h(
                'p.small',
                'Sign-in only fills the issuer name and email printed on page 2, which you can ' +
                  'also just type above. To enable it, put GOOGLE_CLIENT_ID and ' +
                  'GOOGLE_CLIENT_SECRET in your .env file and restart.',
              ),
              h('p.small.muted', `Get them at ${auth.where}`),
              h('p.small.muted', `Authorised redirect URI: ${auth.redirectUri}`),
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
    ),

    /* ---- where things are ---- */
    h(
      '.card',
      h('h2', 'This installation'),
      h(
        'div',
        { style: { display: 'grid', gap: 'var(--s2)' } },
        info('On this computer', store.urls.localHttp),
        info('On your phone', store.urls.lanHttps ?? 'no network found'),
        info('Database file', 'data/cashmemer.db'),
        info('Keys file', '.env  (never in git)'),
      ),
    ),
  );

  paintBackup(backup);
  return root;
}

function info(label, value) {
  return h(
    'div',
    { style: { display: 'flex', gap: 'var(--s4)', justifyContent: 'space-between' } },
    h('span.muted.small', label),
    h('span.mono.small', value),
  );
}
