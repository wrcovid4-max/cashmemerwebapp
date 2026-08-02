/**
 * The phone's half of the scanner.
 *
 * Reading barcodes:
 *   Chrome on Android has a barcode reader built into the browser
 *   (BarcodeDetector) — it is faster and uses less battery than anything we
 *   could ship, so it is used when present. Safari on iPhone and iPad has no
 *   such thing, so ZXing is served from this same computer as a fallback.
 *   Neither needs the internet.
 *
 * Not losing scans:
 *   The socket will drop — a phone in a pocket sleeps, Wi-Fi wanders. Scans
 *   made while it is down are queued here, on the phone, and flushed in order
 *   when it comes back. Nothing is dropped just because the link blinked.
 */

const params = new URLSearchParams(location.search);
const code = params.get('code') ?? '';

const els = {
  link: document.getElementById('link'),
  video: document.getElementById('video'),
  cameraMessage: document.getElementById('cameraMessage'),
  lastScan: document.getElementById('lastScan'),
  manualForm: document.getElementById('manualForm'),
  manualInput: document.getElementById('manualInput'),
  torchBtn: document.getElementById('torchBtn'),
  cameraBtn: document.getElementById('cameraBtn'),
  history: document.getElementById('history'),
  queueNote: document.getElementById('queueNote'),
};

if (!code) {
  showCameraMessage(
    'No pairing code',
    'Open Cash Memer on your computer, press "Phone scanner", and scan the QR code it shows.',
  );
}

/* ------------------------------------------------------------------ *
 * the link back to the computer
 * ------------------------------------------------------------------ */

const QUEUE_KEY = `cashmemer.queue.${code}`;
const RETRY_MS = [400, 800, 1600, 3200, 6000, 10000];

let socket = null;
let attempt = 0;
let deskConnected = false;

/** Scans made while the socket was down. Survives the page being reopened. */
function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-100)));
  } catch {
    /* A full storage quota must not stop scanning. */
  }
  renderQueueNote(queue.length);
}

let queue = loadQueue();

function renderQueueNote(pending) {
  if (pending > 0) {
    els.queueNote.textContent = `${pending} scan${pending === 1 ? '' : 's'} waiting to be sent.`;
  } else {
    els.queueNote.textContent = '';
  }
}
renderQueueNote(queue.length);

function setLink(text, kind) {
  els.link.textContent = text;
  els.link.className = `pill${kind ? ` ${kind}` : ''}`;
}

function connect() {
  if (!code) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setLink('connecting…');
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/ws?role=phone&code=${encodeURIComponent(code)}`);

  socket.addEventListener('open', () => {
    attempt = 0;
    flushQueue();
    updateLink();
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'joined') {
      deskConnected = Boolean(msg.deskConnected);
      updateLink();
    } else if (msg.type === 'desk-status') {
      deskConnected = Boolean(msg.connected);
      updateLink();
    } else if (msg.type === 'scan-result') {
      showResult(msg);
    } else if (msg.type === 'notice') {
      showNotice(msg.text);
    }
  });

  socket.addEventListener('close', () => {
    updateLink();
    const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
    attempt += 1;
    setTimeout(connect, delay);
  });

  socket.addEventListener('error', () => {
    try {
      socket.close();
    } catch {
      /* already closing */
    }
  });
}

function updateLink() {
  const open = socket?.readyState === WebSocket.OPEN;
  if (!open) setLink('reconnecting…', 'warn');
  else if (deskConnected) setLink('connected', 'ok');
  else setLink('computer away', 'warn');
}

function flushQueue() {
  if (socket?.readyState !== WebSocket.OPEN || queue.length === 0) return;
  for (const item of queue) socket.send(JSON.stringify(item));
  queue = [];
  saveQueue(queue);
}

/** Sends a barcode, or holds on to it until the link is back. */
function sendBarcode(barcode) {
  const message = {
    type: 'scan',
    barcode,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };

  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    queue.push(message);
    saveQueue(queue);
    showLocalResult(barcode, 'Saved — will send when reconnected');
  }

  addHistory(barcode);
  buzz();
}

connect();
window.addEventListener('online', connect);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    connect();
    startCamera();
  }
});

/* ------------------------------------------------------------------ *
 * feedback
 * ------------------------------------------------------------------ */

function buzz() {
  try {
    navigator.vibrate?.(45);
  } catch {
    /* not every phone has a motor, and none of them owe us one */
  }
}

function showResult(msg) {
  if (msg.found) {
    els.lastScan.className = 'last-scan found';
    els.lastScan.innerHTML = '';
    els.lastScan.append(
      document.createTextNode(`Added — ${msg.name}`),
      Object.assign(document.createElement('small'), {
        textContent: msg.queued ? `${msg.barcode} · held until the computer is back` : msg.barcode,
      }),
    );
  } else {
    els.lastScan.className = 'last-scan unknown';
    els.lastScan.innerHTML = '';
    els.lastScan.append(
      document.createTextNode('Not in inventory'),
      Object.assign(document.createElement('small'), {
        textContent: `${msg.barcode} · add it on the computer`,
      }),
    );
  }
}

function showLocalResult(barcode, note) {
  els.lastScan.className = 'last-scan';
  els.lastScan.innerHTML = '';
  els.lastScan.append(
    document.createTextNode(barcode),
    Object.assign(document.createElement('small'), { textContent: note }),
  );
}

function showNotice(text) {
  if (!text) return;
  els.lastScan.className = 'last-scan found';
  els.lastScan.textContent = text;
}

function addHistory(barcode) {
  const li = document.createElement('li');
  const left = document.createElement('span');
  left.textContent = barcode;
  const right = document.createElement('span');
  right.textContent = new Date().toLocaleTimeString();
  li.append(left, right);
  els.history.prepend(li);
  while (els.history.children.length > 8) els.history.lastElementChild.remove();
}

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = els.manualInput.value.trim();
  if (!value) return;
  sendBarcode(value);
  els.manualInput.value = '';
});

/* ------------------------------------------------------------------ *
 * the camera
 * ------------------------------------------------------------------ */

function showCameraMessage(title, body, extra) {
  els.cameraMessage.classList.remove('hidden');
  els.cameraMessage.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('div');
  p.className = 'muted';
  p.textContent = body;
  els.cameraMessage.append(strong, p);
  if (extra) {
    const more = document.createElement('div');
    more.className = 'muted';
    more.textContent = extra;
    els.cameraMessage.append(more);
  }
}

function hideCameraMessage() {
  els.cameraMessage.classList.add('hidden');
}

let stream = null;
let facingMode = 'environment';
let stopReading = null;
let lastCode = '';
let lastAt = 0;

/** The same barcode twice in a second is one item held in front of the lens. */
function accept(barcode) {
  const now = Date.now();
  if (barcode === lastCode && now - lastAt < 1500) return false;
  lastCode = barcode;
  lastAt = now;
  return true;
}

async function startCamera() {
  if (!code) return;
  if (stream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    // The usual cause by a mile: the page was opened over plain http.
    showCameraMessage(
      'The camera is not available',
      location.protocol === 'https:'
        ? 'This browser will not give the page a camera. Type barcodes in the box below instead — they still reach the computer.'
        : 'Phone browsers only allow the camera on a secure (https) address.',
      location.protocol === 'https:'
        ? ''
        : 'Go back to your computer, press "Phone scanner" and use the QR code — it points at the https address.',
    );
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
    showCameraMessage(
      denied ? 'Camera permission was refused' : 'The camera would not start',
      denied
        ? 'Allow the camera for this page, then reload. In Safari: the "aA" button in the address bar, then Website Settings.'
        : err.message,
      'You can always type barcodes in the box below instead.',
    );
    return;
  }

  hideCameraMessage();
  els.video.srcObject = stream;
  try {
    await els.video.play();
  } catch {
    /* Autoplay blocked: the first tap on the page will start it. */
  }

  setupTorch();
  startReading();
}

function setupTorch() {
  const track = stream?.getVideoTracks?.()[0];
  const capable = track?.getCapabilities?.().torch;
  els.torchBtn.classList.toggle('hidden', !capable);
  if (!capable) return;

  let on = false;
  els.torchBtn.onclick = async () => {
    on = !on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      els.torchBtn.textContent = on ? 'Torch off' : 'Torch';
    } catch {
      els.torchBtn.classList.add('hidden');
    }
  };
}

els.cameraBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
});

function stopCamera() {
  stopReading?.();
  stopReading = null;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
}

/** Chrome's own reader when it exists, ZXing when it does not. */
async function startReading() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const detector = new window.BarcodeDetector({ formats });
      let running = true;
      const tick = async () => {
        if (!running) return;
        try {
          const found = await detector.detect(els.video);
          if (found.length > 0) {
            const value = String(found[0].rawValue ?? '').trim();
            if (value && accept(value)) sendBarcode(value);
          }
        } catch {
          /* A frame that will not decode is normal; try the next one. */
        }
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      stopReading = () => {
        running = false;
      };
      return;
    } catch {
      /* fall through to ZXing */
    }
  }

  try {
    const zxing = await import('/vendor/zxing.min.js');
    const ZX = zxing.default ?? zxing ?? window.ZXing;
    const reader = new (ZX.BrowserMultiFormatReader ?? window.ZXing.BrowserMultiFormatReader)();
    const controls = await reader.decodeFromVideoElement(els.video, (result) => {
      const value = result?.getText?.()?.trim();
      if (value && accept(value)) sendBarcode(value);
    });
    stopReading = () => {
      try {
        controls?.stop?.() ?? reader.reset?.();
      } catch {
        /* already stopped */
      }
    };
  } catch (err) {
    showCameraMessage(
      'The barcode reader did not load',
      'The camera is on, but nothing can read from it on this browser.',
      'Type barcodes in the box below — they reach the computer exactly the same way.',
    );
  }
}

startCamera();
window.addEventListener('pagehide', stopCamera);
