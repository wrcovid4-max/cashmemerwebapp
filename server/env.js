/**
 * Reads .env, and refuses to start if a real-looking secret has been committed
 * into .env.example.
 *
 * There is no dotenv dependency here on purpose — this is 60 lines and one less
 * thing that can break on install.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.js';

const ENV_FILE = join(ROOT, '.env');
const EXAMPLE_FILE = join(ROOT, '.env.example');

/** Parses KEY=value lines. Ignores blanks and # comments. Strips wrapping quotes. */
function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Values in .env.example that are obviously placeholders, not secrets. */
function looksLikePlaceholder(value) {
  if (!value) return true;
  const v = value.trim();
  if (v.length < 12) return true; // ports, "true", short words
  if (/^PUT_.*_HERE$/i.test(v)) return true;
  if (/^(your|my|example|placeholder|changeme|xxx+|<.*>|\.\.\.)/i.test(v)) return true;
  if (/^[-_.A-Za-z]+$/.test(v) && !/[0-9]/.test(v)) return true; // words only, no digits
  return false;
}

/** Shapes that are almost certainly a real credential. */
const SECRET_SHAPES = [
  { name: 'a Google / Gemini API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'a Google OAuth client ID', re: /[0-9]{8,}-[0-9a-z]{12,}\.apps\.googleusercontent\.com/ },
  { name: 'a Google OAuth client secret', re: /GOCSPX-[0-9A-Za-z_-]{10,}/ },
  { name: 'an OpenAI-style key', re: /sk-[0-9A-Za-z_-]{20,}/ },
  { name: 'a private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'a JSON web token', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'a long random-looking key', re: /^[0-9a-f]{32,}$/i },
  { name: 'a long random-looking key', re: /^[0-9A-Za-z]{24,}$/ },
];

/**
 * Hard stop. .env.example is tracked by git — anything in it is public to
 * everyone who can see the repo. Better to refuse to boot than to let a real
 * key sit there being quietly leaked.
 */
function guardExampleFile() {
  if (!existsSync(EXAMPLE_FILE)) return;
  const parsed = parseEnvFile(readFileSync(EXAMPLE_FILE, 'utf8'));
  const offences = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (looksLikePlaceholder(value)) continue;
    const shape = SECRET_SHAPES.find((s) => s.re.test(value));
    if (shape) offences.push({ key, why: `looks like ${shape.name}` });
  }

  if (offences.length === 0) return;

  console.error('');
  console.error('  ╭──────────────────────────────────────────────────────────────╮');
  console.error('  │  STOPPED — a real key appears to be inside .env.example       │');
  console.error('  ╰──────────────────────────────────────────────────────────────╯');
  console.error('');
  console.error('  .env.example is tracked by git. Anything in it is visible to');
  console.error('  everyone who can see your repository, forever, even if you');
  console.error('  delete it later.');
  console.error('');
  for (const o of offences) console.error(`    • ${o.key} — ${o.why}`);
  console.error('');
  console.error('  Fix it like this:');
  console.error('    1. Open  .env.example  and put the placeholder text back,');
  console.error('       for example:  GEMINI_API_KEY=PUT_YOUR_GEMINI_API_KEY_HERE');
  console.error('    2. Open  .env  (make it if it is missing) and put the real');
  console.error('       key in there instead. .env is ignored by git.');
  console.error('    3. Start the app again with:  npm start');
  console.error('');
  console.error('  If that key was already pushed to GitHub, treat it as burnt:');
  console.error('  go to the provider and revoke it, then make a new one.');
  console.error('');
  process.exit(1);
}

guardExampleFile();

const fileEnv = existsSync(ENV_FILE) ? parseEnvFile(readFileSync(ENV_FILE, 'utf8')) : {};

/** Real environment variables win over .env, so you can override for one run. */
function read(key, fallback = '') {
  const v = process.env[key] ?? fileEnv[key] ?? fallback;
  return typeof v === 'string' ? v.trim() : v;
}

/** A key counts as "set" only if it is present and is not still a placeholder. */
function readKey(name) {
  const v = read(name);
  if (!v || /^PUT_.*_HERE$/i.test(v)) return '';
  return v;
}

/**
 * Hosted mode: the app is running on a server on the internet, not on the
 * shopkeeper's own computer. It is on when HOSTED=1, or automatically on Render
 * (which sets RENDER=true). In hosted mode the app runs a single plain-http
 * server and lets the host put https in front of it, sends the phone to the
 * host's public web address instead of a Wi-Fi IP, and marks the login cookie
 * Secure because the connection really is https.
 */
const hosted = read('HOSTED') === '1' || read('RENDER').toLowerCase() === 'true';

/** The public https address the app is reached at, e.g. https://cashmemer.onrender.com */
const publicUrl = (read('PUBLIC_URL') || read('RENDER_EXTERNAL_URL') || '').replace(/\/$/, '');

export const env = {
  hasEnvFile: existsSync(ENV_FILE),
  hosted,
  publicUrl,
  // On the public internet there must be a passcode from the very first request,
  // or whoever finds the address first could set it themselves. Seeding it from
  // the environment locks the door before anyone can knock. Only used once — a
  // passcode set inside the app later wins and is kept on the permanent disk.
  initialPasscode: read('SETUP_PASSCODE'),
  port: Number(read('PORT', '4000')) || 4000,
  httpsPort: Number(read('HTTPS_PORT', '4001')) || 4001,
  exchangeRateApiKey: readKey('EXCHANGE_RATE_API_KEY'),
  geminiApiKey: readKey('GEMINI_API_KEY'),
  mapsApiKey: readKey('MAPS_API_KEY'),
  googleClientId: readKey('GOOGLE_CLIENT_ID'),
  googleClientSecret: readKey('GOOGLE_CLIENT_SECRET'),
};

/**
 * What the app tells the UI about missing keys. Each feature reports its own
 * gap; nothing here ever stops the app from starting.
 */
export function featureStatus() {
  return {
    rates: {
      ready: Boolean(env.exchangeRateApiKey),
      key: 'EXCHANGE_RATE_API_KEY',
      where: 'https://www.exchangerate-api.com',
      note: 'Live exchange rates. Custom currencies you add by hand still work without it.',
    },
    ai: {
      ready: Boolean(env.geminiApiKey),
      key: 'GEMINI_API_KEY',
      where: 'https://aistudio.google.com/apikey',
      note: 'The one-sentence weekly insight. All six weekly numbers work without it.',
    },
    maps: {
      ready: Boolean(env.mapsApiKey),
      key: 'MAPS_API_KEY',
      where: 'https://console.cloud.google.com/google/maps-apis/credentials',
      note: 'Shows where each sale happened as a map on page 2, and fills the address from GPS.',
    },
    google: {
      ready: Boolean(env.googleClientId && env.googleClientSecret),
      key: 'GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET',
      where: 'https://console.cloud.google.com/apis/credentials',
      note: 'Sign-in, and the issuer name on page 2. You can type those into Settings instead.',
    },
  };
}
