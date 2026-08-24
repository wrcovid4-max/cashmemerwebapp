import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = join(ROOT, 'public');
export const ASSETS_DIR = join(ROOT, 'assets');
export const FONTS_DIR = join(ASSETS_DIR, 'fonts');

/**
 * Everything the app writes lives under data/. On your own computer that is a
 * folder inside the project and it is gitignored on purpose.
 *
 * When the app is hosted on the internet it must instead be a folder on the
 * host's PERMANENT disk — set DATA_DIR to that folder. A hosted machine wipes
 * its own project folder on every restart, so a database left inside the
 * project would lose every receipt the next time the host restarts it. This is
 * the single most important setting to get right when hosting.
 */
const DATA_OVERRIDE = (process.env.DATA_DIR ?? '').trim();
export const DATA_DIR = DATA_OVERRIDE
  ? (isAbsolute(DATA_OVERRIDE) ? DATA_OVERRIDE : resolve(ROOT, DATA_OVERRIDE))
  : join(ROOT, 'data');
export const DB_FILE = join(DATA_DIR, 'cashmemer.db');
export const CERT_DIR = join(ROOT, 'certs');

export function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(CERT_DIR, { recursive: true });
}
