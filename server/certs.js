/**
 * Makes the self-signed HTTPS certificate the phone camera needs.
 *
 * Why this exists at all: phone browsers refuse to open the camera unless the
 * page came over https (or from localhost). Your shop's computer has no domain
 * name and no certificate authority, so the only option on a home network is a
 * certificate the app signs itself. Your phone will warn you once that the
 * connection "is not private" — that warning is about the certificate not being
 * vouched for by anyone, not about the connection being readable. Tap through
 * it. See the README for the exact taps.
 *
 * The certificate is regenerated whenever your LAN IP changes, and lives in
 * certs/, which git ignores.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import selfsigned from 'selfsigned';
import { CERT_DIR } from './paths.js';

const CERT_FILE = join(CERT_DIR, 'cashmemer-cert.pem');
const KEY_FILE = join(CERT_DIR, 'cashmemer-key.pem');
const META_FILE = join(CERT_DIR, 'cashmemer-meta.json');

/**
 * @param {string[]} hosts every name/IP the certificate should cover
 * @returns {{key: string, cert: string, regenerated: boolean}}
 */
export function ensureCertificate(hosts) {
  const wanted = [...new Set(['localhost', '127.0.0.1', ...hosts.filter(Boolean)])].sort();
  const signature = JSON.stringify(wanted);

  if (existsSync(CERT_FILE) && existsSync(KEY_FILE) && existsSync(META_FILE)) {
    try {
      const meta = JSON.parse(readFileSync(META_FILE, 'utf8'));
      const stillValid = new Date(meta.expires).getTime() > Date.now() + 24 * 3600 * 1000;
      if (meta.signature === signature && stillValid) {
        return {
          key: readFileSync(KEY_FILE, 'utf8'),
          cert: readFileSync(CERT_FILE, 'utf8'),
          regenerated: false,
        };
      }
    } catch {
      // Unreadable metadata just means we make a fresh one.
    }
  }

  const altNames = wanted.map((h) =>
    /^\d+\.\d+\.\d+\.\d+$/.test(h) ? { type: 7, ip: h } : { type: 2, value: h },
  );

  const days = 825; // the longest most browsers will tolerate
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Cash Memer' }], {
    days,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'subjectAltName', altNames },
    ],
  });

  writeFileSync(KEY_FILE, pems.private, { mode: 0o600 });
  writeFileSync(CERT_FILE, pems.cert);
  writeFileSync(
    META_FILE,
    JSON.stringify(
      { signature, hosts: wanted, expires: new Date(Date.now() + days * 86400000).toISOString() },
      null,
      2,
    ),
  );

  return { key: pems.private, cert: pems.cert, regenerated: true };
}
