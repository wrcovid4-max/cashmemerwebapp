/**
 * Members — the customer directory.
 *
 * Picking one on the receipt form fills name, phone, email and address in a
 * single action. Their phone and email never reach page 1 of the memo.
 */
import { h, mount, toast, openDialog, confirmDialog, debounce } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';

export async function renderMembers() {
  let query = '';
  const root = h('div');
  const listHost = h('.card');

  async function load() {
    const members = await api.members.list(query);

    if (members.length === 0) {
      mount(
        listHost,
        h('.empty-state', query ? 'Nobody matches that.' : 'No saved customers yet.'),
      );
      return;
    }

    mount(
      listHost,
      h(
        '.table-wrap',
        h(
          'table',
          h(
            'thead',
            h('tr', h('th', t('name')), h('th', t('phone')), h('th', t('email')), h('th', t('address')), h('th', '')),
          ),
          h(
            'tbody',
            members.map((m) =>
              h(
                'tr',
                h('td', h('strong', m.name)),
                h('td.small', m.phone || '—'),
                h('td.small', m.email || '—'),
                h('td.small.muted', m.address || '—'),
                h(
                  'td',
                  h(
                    '.row-actions',
                    h('button.btn.small.ghost', { onclick: () => edit(m) }, t('edit')),
                    h(
                      'button.btn.small.ghost',
                      {
                        style: { color: 'var(--danger)' },
                        onclick: async () => {
                          const yes = await confirmDialog({
                            title: `Delete ${m.name}?`,
                            body: 'Receipts already issued to them keep their details.',
                          });
                          if (!yes) return;
                          await api.members.remove(m.id);
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

  function edit(member) {
    const f = {
      name: h('input', { value: member?.name ?? '', autofocus: true }),
      phone: h('input', { value: member?.phone ?? '' }),
      email: h('input', { type: 'email', value: member?.email ?? '' }),
      address: h('input', { value: member?.address ?? '' }),
    };

    const overlay = openDialog(
      h('h2', member ? t('edit') : `${t('add')} ${t('customer')}`),
      h('.field', h('label', t('name')), f.name),
      h(
        '.grid-2',
        h('.field', h('label', t('phone')), f.phone),
        h('.field', h('label', t('email')), f.email),
      ),
      h('.field', h('label', t('address')), f.address),
      h(
        '.dialog-actions',
        h('button.btn', { onclick: () => overlay.remove() }, t('cancel')),
        h(
          'button.btn.primary',
          {
            onclick: async () => {
              const body = {
                name: f.name.value.trim(),
                phone: f.phone.value.trim(),
                email: f.email.value.trim(),
                address: f.address.value.trim(),
              };
              if (!body.name) {
                f.name.focus();
                return;
              }
              try {
                if (member) await api.members.update(member.id, body);
                else await api.members.create(body);
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

  const search = debounce((value) => {
    query = value;
    load();
  }, 250);

  mount(
    root,
    h(
      '.page-head',
      h('h1', t('members')),
      h('.actions', h('button.btn.primary', { onclick: () => edit(null) }, `+ ${t('add')}`)),
    ),
    h('input', {
      placeholder: t('search'),
      style: { marginBottom: 'var(--s5)' },
      oninput: (e) => search(e.target.value),
    }),
    listHost,
  );

  await load();
  return root;
}
