/**
 * The computer's half of the phone-scanner link.
 *
 * What it has to survive, because all of it happens at a real counter:
 *   - the phone locks, or walks out of range, and comes back minutes later
 *   - this page gets reloaded in the middle of a sale
 *   - the server is restarted while the phone is still paired
 *
 * So: the pairing code is kept in this browser, not in memory, and the socket
 * reconnects on its own with a backoff that never gives up. Scans that arrive
 * while this page is away are held by the server and delivered on reconnect;
 * this side acknowledges each one, and only then does the server forget it.
 */
import { api } from './api.js';

const CODE_KEY = 'cashmemer.pairing-code';

/** Backoff between reconnection attempts. Caps out, never stops trying. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000];

class Scanner extends EventTarget {
  constructor() {
    super();
    this.code = localStorage.getItem(CODE_KEY) || null;
    this.socket = null;
    this.attempt = 0;
    this.wanted = false;
    this.phoneConnected = false;
    this.socketOpen = false;
    this.seen = new Set(); // scan ids already handled, so a redelivery is not a second item
  }

  get status() {
    if (!this.code) return 'unpaired';
    if (!this.socketOpen) return 'connecting';
    return this.phoneConnected ? 'connected' : 'waiting';
  }

  /** Makes a new pairing and returns what the dialog needs to draw the QR. */
  async createPairing() {
    const pairing = await api.pair.create();
    this.code = pairing.code;
    localStorage.setItem(CODE_KEY, pairing.code);
    this.seen.clear();
    this.connect();
    return pairing;
  }

  /** Reconnects to a pairing this browser already knows about. */
  resume() {
    if (this.code) this.connect();
  }

  connect() {
    if (!this.code) return;
    this.wanted = true;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws?role=desk&code=${encodeURIComponent(this.code)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.socketOpen = true;
      this.announce();
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handle(msg);
    });

    socket.addEventListener('close', () => {
      this.socketOpen = false;
      this.phoneConnected = false;
      this.announce();
      if (this.wanted) this.scheduleRetry();
    });

    socket.addEventListener('error', () => {
      // 'close' always follows, and that is where the retry lives.
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    });
  }

  scheduleRetry() {
    const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
    this.attempt += 1;
    setTimeout(() => {
      if (this.wanted) this.connect();
    }, delay);
  }

  handle(msg) {
    switch (msg.type) {
      case 'joined':
        this.phoneConnected = Boolean(msg.phoneConnected);
        this.announce();
        break;

      case 'phone-status':
        this.phoneConnected = Boolean(msg.connected);
        this.announce();
        break;

      case 'scan':
        this.deliver([msg.scan]);
        break;

      // Everything that happened while this page was away.
      case 'scan-batch':
        this.deliver(msg.scans ?? []);
        break;

      default:
        break;
    }
  }

  /**
   * Hands scans to whichever screen is listening, then tells the server they
   * are safely delivered. Anything already seen is dropped — a redelivery
   * must not put a second bottle of milk on the memo.
   */
  deliver(scans) {
    const fresh = scans.filter((s) => s && !this.seen.has(s.id));
    for (const scan of fresh) {
      this.seen.add(scan.id);
      this.dispatchEvent(new CustomEvent('scan', { detail: scan }));
    }
    const ids = scans.map((s) => s?.id).filter(Boolean);
    if (ids.length) this.send({ type: 'ack', ids });

    // The seen-set is only there to catch redelivery; it does not need to be
    // a permanent record of every barcode ever scanned.
    if (this.seen.size > 500) {
      this.seen = new Set([...this.seen].slice(-200));
    }
  }

  send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Tells the phone something, e.g. that a new product was just saved. */
  notifyPhone(text) {
    this.send({ type: 'notify-phone', text });
  }

  announce() {
    this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
  }

  /** Forgets the pairing entirely. The phone will not be able to rejoin. */
  unpair() {
    this.wanted = false;
    this.code = null;
    localStorage.removeItem(CODE_KEY);
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.socketOpen = false;
    this.phoneConnected = false;
    this.announce();
  }
}

export const scanner = new Scanner();

// A paired browser reconnects the moment the app loads, so the phone is live
// again before you have finished walking back to the counter.
scanner.resume();

// Coming back from a sleeping laptop or a background tab: check immediately
// rather than waiting out the backoff.
window.addEventListener('online', () => scanner.resume());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scanner.resume();
});
