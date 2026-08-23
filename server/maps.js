/**
 * Google Maps, kept entirely on the server so the key never reaches a browser.
 *
 * Two small things are used:
 *   - a Static Maps image of where a sale happened (shown in the preview and
 *     printed on page 2),
 *   - reverse geocoding, to turn the phone's GPS reading into a street address.
 *
 * Both return null rather than throwing when the key is missing or Google is
 * unreachable. A map is a nicety on a receipt; it must never be the reason a
 * memo will not print or a sale cannot be saved.
 */
import { env } from './env.js';
import { getSetting } from './db.js';

/** The key in use: one entered in Settings wins, otherwise the one from .env. */
function mapsKey() {
  return String(getSetting('mapsApiKey') || env.mapsApiKey || '').trim();
}

/** Is the maps feature switched on (a key is present, from Settings or .env)? */
export function mapsReady() {
  return Boolean(mapsKey());
}

/** Guards against nonsense coordinates before they reach Google. */
function validCoords(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
}

const TIMEOUT_MS = 8000;

async function withTimeout(promise) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A Static Maps PNG for one point.
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>}
 */
export async function staticMapImage(lat, lng, { width = 320, height = 160, zoom = 15 } = {}) {
  const key = mapsKey();
  if (!key || !validCoords(lat, lng)) return null;

  const point = `${Number(lat)},${Number(lng)}`;
  const url =
    'https://maps.googleapis.com/maps/api/staticmap?' +
    new URLSearchParams({
      center: point,
      zoom: String(zoom),
      size: `${width}x${height}`,
      scale: '2',
      markers: `color:0x2E6B1F|${point}`,
      key,
    }).toString();

  try {
    const res = await withTimeout((signal) => fetch(url, { signal }));
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null; // an error comes back as text
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } catch {
    return null;
  }
}

/**
 * A street address for one point, or null.
 * @returns {Promise<string | null>}
 */
export async function reverseGeocode(lat, lng) {
  const key = mapsKey();
  if (!key || !validCoords(lat, lng)) return null;

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?' +
    new URLSearchParams({ latlng: `${Number(lat)},${Number(lng)}`, key }).toString();

  try {
    const res = await withTimeout((signal) => fetch(url, { signal }));
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}
