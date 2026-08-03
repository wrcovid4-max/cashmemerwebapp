import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = join(ROOT, 'public');
export const ASSETS_DIR = join(ROOT, 'assets');
export const FONTS_DIR = join(ASSETS_DIR, 'fonts');

/** Everything the app writes lives under data/. It is gitignored on purpose. */
export const DATA_DIR = join(ROOT, 'data');
export const DB_FILE = join(DATA_DIR, 'cashmemer.db');
export const CERT_DIR = join(ROOT, 'certs');

export function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(CERT_DIR, { recursive: true });
}
