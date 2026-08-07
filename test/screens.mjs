import { chromium } from 'playwright';
import { signIn, playwrightCookie } from './helpers.mjs';

// CHROME_PATH pins a specific browser; without it Playwright uses its own.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

const BASE = 'http://localhost:4000';
const SHOT = process.env.SHOT_DIR ?? '/tmp';

const cookie = await signIn();
const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addCookies(playwrightCookie(cookie));
const page = await context.newPage();

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const screens = ['dashboard', 'receipts', 'new', 'inventory', 'pricelist', 'members', 'terminal', 'rates', 'settings'];

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

for (const s of screens) {
  problems.push(`--- ${s} ---`);
  await page.goto(`${BASE}/#/${s}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const h1 = await page.locator('h1').first().textContent().catch(() => '(no h1)');
  const empty = await page.locator('.notice.error').count();
  problems.push(`   h1=${JSON.stringify(h1)} errorNotices=${empty}`);
  await page.screenshot({ path: `${SHOT}/shot-${s}.png`, fullPage: false });
}

console.log(problems.join('\n'));
await browser.close();
