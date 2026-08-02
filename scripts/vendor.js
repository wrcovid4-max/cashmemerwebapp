/**
 * Copies the barcode-reading library out of node_modules and into public/vendor/
 * so the phone can download it from this server.
 *
 * Why: the phone's browser has to load the barcode reader from somewhere. It
 * cannot reach the internet through this app, and we do not want to depend on a
 * CDN (your shop's internet going down should not stop you selling). So the
 * file is served from your own computer.
 *
 * Runs automatically after `npm install`. Never fails the install — if the copy
 * does not work, the phone falls back to the browser's built-in barcode reader
 * (Chrome on Android has one) or to typing the code by hand.
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');

const candidates = [
  'node_modules/@zxing/library/umd/index.min.js',
  'node_modules/@zxing/library/umd/index.js',
];

try {
  mkdirSync(outDir, { recursive: true });
  const found = candidates.map((c) => join(root, c)).find((p) => existsSync(p));
  if (!found) {
    const dir = join(root, 'node_modules/@zxing/library/umd');
    const listing = existsSync(dir) ? readdirSync(dir).join(', ') : '(no umd folder)';
    console.warn(`[vendor] Could not find the ZXing UMD build. Saw: ${listing}`);
    console.warn('[vendor] The phone scanner will fall back to the built-in browser reader.');
  } else {
    copyFileSync(found, join(outDir, 'zxing.min.js'));
    console.log('[vendor] Barcode reader copied to public/vendor/zxing.min.js');
  }
} catch (err) {
  console.warn(`[vendor] Skipped: ${err.message}`);
}
