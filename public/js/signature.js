/**
 * Signature capture — mouse, finger or stylus.
 *
 * Pointer events cover all three with one code path, so a touchscreen till and
 * a mouse behave identically. The canvas is backed at the screen's real pixel
 * density, or a signature drawn on a high-DPI laptop comes out soft on paper.
 */
import { h, mount } from './dom.js';
import { t } from './i18n.js';

export function attachSignaturePad(host, { initial = '', onChange } = {}) {
  const canvas = h('canvas.sig-pad');
  const status = h('span.badge', 'Empty');

  const clearBtn = h(
    'button.btn.small',
    {
      onclick: () => {
        wipe();
        emit();
      },
    },
    t('clearSignature'),
  );

  mount(
    host,
    canvas,
    h(
      'div',
      { style: { display: 'flex', gap: 'var(--s2)', alignItems: 'center', marginTop: 'var(--s2)' } },
      status,
      h('span.grow'),
      clearBtn,
    ),
  );

  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = Boolean(initial);

  function sizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;

    // Redrawing after a resize would need the strokes kept as points; instead
    // the existing image is scaled across, which is fine for a signature.
    const previous = dirty ? canvas.toDataURL('image/png') : null;

    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';

    if (previous) drawImage(previous);
  }

  function drawImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = dataUrl;
  }

  function wipe() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    dirty = false;
    status.className = 'badge';
    status.textContent = 'Empty';
  }

  function pointOf(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    const p = pointOf(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const p = pointOf(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!dirty) {
      dirty = true;
      status.className = 'badge ok';
      status.textContent = 'Captured';
    }
  });

  const finish = () => {
    if (!drawing) return;
    drawing = false;
    ctx.closePath();
    emit();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', finish);

  function emit() {
    onChange?.(dirty ? canvas.toDataURL('image/png') : '');
  }

  // The canvas has no size until it is laid out.
  requestAnimationFrame(() => {
    sizeCanvas();
    if (initial) {
      drawImage(initial);
      dirty = true;
      status.className = 'badge ok';
      status.textContent = 'Captured';
    }
  });

  const onResize = () => sizeCanvas();
  window.addEventListener('resize', onResize);

  return {
    clear: wipe,
    destroy: () => window.removeEventListener('resize', onResize),
  };
}
