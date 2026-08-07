/**
 * Starts Cash Memer.
 *
 * Two servers come up, on purpose:
 *
 *   http  — for this computer. Fast, no certificate warnings, what you use.
 *   https — for your phone. Phone browsers refuse to open a camera on a plain
 *           http address that is not localhost, so the scanner page has to be
 *           served over https or the camera silently never starts.
 *
 * Both addresses are printed when it boots, so you never have to go looking
 * for your own IP address.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import express from 'express';

import { env } from './env.js';
import { PUBLIC_DIR, ROOT, ensureDirs } from './paths.js';
import { db, seedIfEmpty } from './db.js';
import { primaryLanAddress, lanAddresses } from './net.js';
import { ensureCertificate } from './certs.js';
import { attachScanHub } from './scanhub.js';
import { createApi } from './api.js';
import { startBackupSchedule } from './backup.js';
import { requireSignIn, hasPasscode } from './auth.js';

ensureDirs();
seedIfEmpty();

const lanIp = primaryLanAddress();

const urls = {
  localHttp: `http://localhost:${env.port}`,
  lanHttp: lanIp ? `http://${lanIp}:${env.port}` : null,
  lanHttps: lanIp ? `https://${lanIp}:${env.httpsPort}` : null,
  localHttps: `https://localhost:${env.httpsPort}`,
  // Where the QR code sends the phone. https, because of the camera.
  phoneBase: lanIp ? `https://${lanIp}:${env.httpsPort}` : `https://localhost:${env.httpsPort}`,
  lanIp,
  port: env.port,
  httpsPort: env.httpsPort,
};

/* ------------------------------------------------------------------ *
 * the app
 * ------------------------------------------------------------------ */

const app = express();

// Signatures arrive as data URLs and a bulk restore can be a large file.
app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  // Everything is served from this machine to this machine. No caching, so a
  // change is never one stale file away from looking broken.
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Nothing below this line is reachable without the passcode, except the lock
// screen itself. It sits above every route on purpose — a route added later
// is protected by default rather than by remembering to protect it.
app.use(requireSignIn);

app.get('/login', (req, res) => res.sendFile(join(PUBLIC_DIR, 'login.html')));

app.use('/api', createApi({ urls }));

// The shared money code is loaded by both the server and the browser.
app.use('/shared', express.static(join(ROOT, 'shared')));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// The phone's scanner page.
app.get('/scan', (req, res) => res.sendFile(join(PUBLIC_DIR, 'scan.html')));

// Anything else is the single-page app.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: `No such endpoint: ${req.path}` });
    return;
  }
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

/* ------------------------------------------------------------------ *
 * servers
 * ------------------------------------------------------------------ */

const httpServer = createHttpServer(app);
const servers = [httpServer];

let httpsServer = null;
let certNote = '';
try {
  const { key, cert, regenerated } = ensureCertificate([lanIp, 'localhost'].filter(Boolean));
  httpsServer = createHttpsServer({ key, cert }, app);
  servers.push(httpsServer);
  certNote = regenerated ? 'a new certificate was just created' : 'using the saved certificate';
} catch (err) {
  certNote = `could not be started — ${err.message}`;
}

attachScanHub(servers, (barcode) =>
  db.prepare('SELECT * FROM products WHERE barcode = ? AND archived = 0').get(barcode),
);

/* ------------------------------------------------------------------ *
 * the banner
 * ------------------------------------------------------------------ */

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - [...text].length));
}

function banner() {
  const W = 68;
  const line = (text = '') => console.log(`  │ ${pad(text, W)} │`);
  const bar = (l, r) => console.log(`  ${l}${'─'.repeat(W + 2)}${r}`);

  console.log('');
  bar('╭', '╮');
  line('CASH MEMER — running');
  bar('├', '┤');
  line('');
  line('ON THIS COMPUTER — open this in your browser:');
  line(`    ${urls.localHttp}`);
  line('');

  if (urls.lanHttp) {
    line('ON YOUR PHONE — same Wi-Fi as this computer:');
    // The two URLs differ in length by one character; pad so the notes line up.
    const width = Math.max(urls.lanHttp.length, urls.lanHttps.length);
    line(`    ${pad(urls.lanHttp, width)}   <- normal use, no warning`);
    line(`    ${pad(urls.lanHttps, width)}   <- needed for the camera`);
    line('');
    line('    Two addresses because phone browsers refuse to open a camera');
    line('    over plain http. The https one warns that the connection "is');
    line('    not private" — expected, this computer signed its own');
    line('    certificate. Tap Advanced, then Proceed. Once per phone.');
    line('');
    line('    Easier: open New receipt on this computer, press "Phone');
    line('    scanner", and point your phone camera at the QR code.');
  } else {
    line('NO NETWORK FOUND — the phone scanner needs Wi-Fi.');
    line('    This computer has no address other phones can reach.');
    line('    Connect it to the same Wi-Fi as your phone and restart.');
  }

  line('');
  bar('├', '┤');
  const keyLine = (label, ready, name) =>
    line(`  ${ready ? '✓' : '·'} ${pad(label, 20)} ${ready ? 'ready' : `off — no ${name}`}`);
  keyLine('Live rates', Boolean(env.exchangeRateApiKey), 'EXCHANGE_RATE_API_KEY');
  keyLine('Weekly AI sentence', Boolean(env.geminiApiKey), 'GEMINI_API_KEY');
  keyLine('Google sign-in', Boolean(env.googleClientId && env.googleClientSecret), 'GOOGLE_CLIENT_ID');
  if (!env.hasEnvFile) {
    line('');
    line('  No .env file. That is fine — every key is optional. To add one,');
    line('  copy .env.example to .env and edit it.');
  }
  bar('├', '┤');
  line('  Your shop lives in  data/cashmemer.db  — this is NOT in git.');
  line('  To move machines, use Settings -> Export, and keep that file.');
  line(`  Https certificate: ${certNote}`);
  line('');
  line('  Stop the app with Ctrl+C.');
  bar('╰', '╯');
  console.log('');
}

/* ------------------------------------------------------------------ *
 * go
 * ------------------------------------------------------------------ */

function explainPortInUse(port, err) {
  if (err.code !== 'EADDRINUSE') return false;
  console.error('');
  console.error(`  Port ${port} is already being used by another program.`);
  console.error('');
  console.error('  Most likely Cash Memer is already running in another terminal');
  console.error('  window — check your other windows before doing anything else.');
  console.error('');
  console.error(`  To use a different port instead, open .env and change PORT=${port}`);
  console.error(`  to something else, for example PORT=${port + 10}, then start again.`);
  console.error('');
  return true;
}

httpServer.on('error', (err) => {
  if (!explainPortInUse(env.port, err)) console.error(err);
  process.exit(1);
});

httpServer.listen(env.port, '0.0.0.0', () => {
  if (httpsServer) {
    httpsServer.on('error', (err) => {
      // A failed https server costs you the phone camera, not the whole app.
      if (err.code === 'EADDRINUSE') {
        console.warn(`\n  Note: port ${env.httpsPort} is in use, so the phone scanner is off.`);
        console.warn(`  Change HTTPS_PORT in .env and restart to get it back.\n`);
      } else {
        console.warn(`\n  Note: https did not start — ${err.message}\n`);
      }
    });
    httpsServer.listen(env.httpsPort, '0.0.0.0', banner);
  } else {
    banner();
  }

  startBackupSchedule();

  const others = lanAddresses().slice(1);
  if (others.length > 0) {
    console.log(
      `  (This computer also answers on ${others.map((a) => a.address).join(', ')} — ` +
        'if the phone cannot reach the address above, try one of those.)\n',
    );
  }
});

const shutdown = () => {
  console.log('\n  Stopping Cash Memer. Your data is saved.\n');
  for (const s of servers) s.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
