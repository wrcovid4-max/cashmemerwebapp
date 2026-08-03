/**
 * The smallest thing that can stand in for a UI framework.
 *
 * There is no build step in this project on purpose — you run `npm install`
 * once and `npm start` forever, with nothing to compile and nothing that can
 * break on a machine that has never built JavaScript before. That means no
 * React, so this file is the whole rendering toolkit: build elements, and
 * replace a container's contents.
 */

/**
 * Builds an element.
 *   h('div.card', 'hello')
 *   h('button.btn.primary', { onclick: save }, 'Save')
 *
 * A leading tag is optional — 'div' is assumed, so '.card' works.
 */
export function h(spec, ...rest) {
  const [tagPart, ...classes] = String(spec).split('.');
  const tag = tagPart || 'div';
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');

  let children = rest;
  const first = rest[0];
  const isProps =
    first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Node);

  if (isProps) {
    children = rest.slice(1);
    for (const [key, value] of Object.entries(first)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = `${el.className} ${value}`.trim();
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value);
      } else if (key === 'html') el.innerHTML = value;
      else if (key in el && key !== 'list') {
        try {
          el[key] = value;
        } catch {
          // Some properties are read-only on some elements — `type` on a
          // textarea, for one. Falling back to the attribute keeps a shared
          // helper like a form binder usable across every kind of input.
          el.setAttribute(key, value === true ? '' : value);
        }
      } else el.setAttribute(key, value === true ? '' : value);
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Empties a container and puts new content in it. */
export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

/** Runs a function once the user stops typing, rather than on every keystroke. */
export function debounce(fn, ms = 400) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.now = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

/** A short-lived message in the corner. */
export function toast(message, kind = 'info') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('.toasts');
    document.body.append(host);
  }
  const node = h(`.toast.${kind}`, message);
  host.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 300);
  }, kind === 'error' ? 6000 : 2800);
}

/**
 * A yes/no the user cannot miss. Deliberately not window.confirm: the browser
 * dialog cannot say what is about to be deleted, and deleting a day's takings
 * by muscle memory is not recoverable.
 */
export function confirmDialog({ title, body, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const close = (answer) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    const overlay = h(
      '.overlay',
      { onclick: (e) => e.target === overlay && close(false) },
      h(
        '.dialog.narrow',
        h('h2', title),
        body ? h('p.muted', body) : null,
        h(
          '.dialog-actions',
          h('button.btn', { onclick: () => close(false) }, 'Cancel'),
          h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => close(true) }, confirmLabel),
        ),
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.btn.danger, .btn.primary')?.focus();
  });
}

/** A modal with arbitrary contents. Returns the overlay so callers can close it. */
export function openDialog(...content) {
  const overlay = h('.overlay', { onclick: (e) => e.target === overlay && overlay.remove() });
  const dialog = h('.dialog', ...content);
  overlay.append(dialog);
  document.body.append(overlay);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  return overlay;
}
