/**
 * The link between your phone and the receipt open on your computer.
 *
 * Shape of it:
 *   computer  --WebSocket-->  this hub  <--WebSocket--  phone
 *
 * A "pairing" is one short code. The computer asks for a code, shows it as a
 * QR, and the phone joins that code by scanning it. From then on every barcode
 * the phone reads is pushed straight to the computer.
 *
 * Two things this has to survive, because they happen constantly at a counter:
 *   1. The phone locks or walks out of range. Its socket dies. When it comes
 *      back it rejoins the same code — the pairing is not lost.
 *   2. The computer's page is reloaded mid-sale. Scans that arrived while it
 *      was away are held here and delivered the moment it returns, rather than
 *      being dropped on the floor.
 *
 * Delivery is acknowledged. A scan stays in the queue until the computer says
 * it has it, so a scan can be delivered late but never silently lost.
 */
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { hasPasscode, isSignedIn } from './auth.js';

/** How many undelivered scans we hold for a computer that is not listening. */
const MAX_QUEUE = 200;
/** A pairing with nobody attached is forgotten after this long. */
const IDLE_PAIRING_MS = 12 * 60 * 60 * 1000; // 12 hours — a full trading day
/** Silence longer than this and we assume the socket is dead. */
const HEARTBEAT_MS = 25_000;

/** @typedef {{code: string, desks: Set<any>, phones: Set<any>, queue: any[], createdAt: number, lastSeen: number}} Pairing */

/** @type {Map<string, Pairing>} */
const pairings = new Map();

/** Short, unambiguous, and safe to put in a URL. */
function makeCode() {
  return randomBytes(9)
    .toString('base64')
    .replace(/\+/g, '')
    .replace(/\//g, '')
    .replace(/=/g, '')
    .slice(0, 11);
}

export function createPairing() {
  let code = makeCode();
  while (pairings.has(code)) code = makeCode();
  const pairing = {
    code,
    desks: new Set(),
    phones: new Set(),
    queue: [],
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  pairings.set(code, pairing);
  return pairing;
}

export function getPairing(code) {
  return pairings.get(code) ?? null;
}

/**
 * Rejoining a code that the server has forgotten (app restarted, say) recreates
 * it rather than refusing. The phone keeps working across a server restart,
 * which is what you would expect from something you paired once.
 */
function getOrCreate(code) {
  let p = pairings.get(code);
  if (!p) {
    p = {
      code,
      desks: new Set(),
      phones: new Set(),
      queue: [],
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    pairings.set(code, p);
  }
  return p;
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(sockets, payload) {
  for (const s of sockets) send(s, payload);
}

/** Tells every computer on this pairing how many phones are attached. */
function announcePhoneCount(pairing) {
  broadcast(pairing.desks, {
    type: 'phone-status',
    connected: pairing.phones.size > 0,
    count: pairing.phones.size,
  });
}

function announceDeskCount(pairing) {
  broadcast(pairing.phones, {
    type: 'desk-status',
    connected: pairing.desks.size > 0,
    count: pairing.desks.size,
  });
}

/** Hands a computer everything it has not acknowledged yet. */
function flushQueue(pairing, socket) {
  if (pairing.queue.length === 0) return;
  send(socket, { type: 'scan-batch', scans: pairing.queue });
}

/**
 * @param {import('node:http').Server[]} servers every server (http and https)
 *   that should accept scanner sockets
 * @param {(barcode: string) => any} lookupProduct finds a product by barcode
 */
export function attachScanHub(servers, lookupProduct) {
  const wss = new WebSocketServer({ noServer: true });

  for (const server of servers) {
    server.on('upgrade', (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, 'http://placeholder');
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      // A socket is a way in like any other. The phone signs in with the same
      // passcode as the computer, so a stranger who photographs the QR code
      // over your shoulder still cannot attach to it.
      if (hasPasscode() && !isSignedIn(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, url);
      });
    });
  }

  wss.on('connection', (ws, req, url) => {
    const role = url.searchParams.get('role') === 'phone' ? 'phone' : 'desk';
    const code = (url.searchParams.get('code') || '').slice(0, 32);

    if (!code) {
      send(ws, { type: 'error', message: 'No pairing code given.' });
      ws.close();
      return;
    }

    const pairing = getOrCreate(code);
    pairing.lastSeen = Date.now();
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    if (role === 'phone') {
      pairing.phones.add(ws);
      send(ws, { type: 'joined', role, code, deskConnected: pairing.desks.size > 0 });
      announcePhoneCount(pairing);
      announceDeskCount(pairing);
    } else {
      pairing.desks.add(ws);
      send(ws, { type: 'joined', role, code, phoneConnected: pairing.phones.size > 0 });
      announcePhoneCount(pairing);
      announceDeskCount(pairing);
      flushQueue(pairing, ws);
    }

    ws.on('message', (raw) => {
      pairing.lastSeen = Date.now();
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        /* Phone read a barcode. This is the whole point of the feature. */
        case 'scan': {
          const barcode = String(msg.barcode ?? '').trim();
          if (!barcode) return;

          let product = null;
          try {
            product = lookupProduct(barcode);
          } catch {
            product = null;
          }

          const scan = {
            id: msg.id || randomBytes(8).toString('hex'),
            barcode,
            at: new Date().toISOString(),
            product: product
              ? {
                  id: product.id,
                  name: product.name,
                  price: product.sell_price,
                  unit: product.unit,
                  stock: product.stock,
                }
              : null,
          };

          // Same code twice in a row within a second is a double-read, not two items.
          const last = pairing.queue[pairing.queue.length - 1];
          const isEcho =
            last && last.barcode === barcode && Date.now() - new Date(last.at).getTime() < 900;
          if (!isEcho) {
            pairing.queue.push(scan);
            if (pairing.queue.length > MAX_QUEUE) pairing.queue.shift();
          }

          broadcast(pairing.desks, { type: 'scan', scan });
          // Tell the phone what happened, so it can show "Added — Milk ×1".
          send(ws, {
            type: 'scan-result',
            id: scan.id,
            barcode,
            found: Boolean(product),
            name: product?.name ?? null,
            queued: pairing.desks.size === 0,
          });
          break;
        }

        /* Computer confirms it has these scans; they can leave the queue. */
        case 'ack': {
          const ids = new Set((msg.ids ?? []).map(String));
          pairing.queue = pairing.queue.filter((s) => !ids.has(String(s.id)));
          break;
        }

        /* Computer nudging the phone, e.g. "I saved that new product". */
        case 'notify-phone': {
          broadcast(pairing.phones, { type: 'notice', text: String(msg.text ?? '') });
          break;
        }

        case 'ping':
          send(ws, { type: 'pong' });
          break;

        default:
          break;
      }
    });

    ws.on('close', () => {
      pairing.desks.delete(ws);
      pairing.phones.delete(ws);
      pairing.lastSeen = Date.now();
      announcePhoneCount(pairing);
      announceDeskCount(pairing);
    });

    ws.on('error', () => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    });
  });

  /* Drop sockets that stopped answering, and forget stale pairings. */
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* closing anyway */
      }
    }
    const cutoff = Date.now() - IDLE_PAIRING_MS;
    for (const [code, p] of pairings) {
      if (p.desks.size === 0 && p.phones.size === 0 && p.lastSeen < cutoff) {
        pairings.delete(code);
      }
    }
  }, HEARTBEAT_MS);
  timer.unref();

  return wss;
}

/** Used by the status endpoint so the UI can show the pairing state. */
export function pairingStatus(code) {
  const p = pairings.get(code);
  if (!p) return { exists: false, phones: 0, desks: 0, queued: 0 };
  return { exists: true, phones: p.phones.size, desks: p.desks.size, queued: p.queue.length };
}
