/**
 * The feature that matters most: a barcode read on the phone appearing in the
 * receipt open on the computer. Driven for real — a Chromium page acting as
 * the desk, and a second WebSocket acting as the phone.
 */
import { chromium } from 'playwright';

// CHROME_PATH pins a specific browser; without it Playwright uses its own.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
import WebSocket from 'ws';

const BASE = 'http://localhost:4000';
const SHOT = process.env.SHOT_DIR ?? '/tmp';
const ok = (label, pass) => console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);

const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${BASE}/#/new`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 1. open the pairing dialog and read the code off it
await page.click('button:has-text("Phone scanner")');
await page.waitForSelector('.pair img.qr', { timeout: 5000 });
const code = (await page.locator('.pair .url .mono').innerText()).trim();
ok('pairing dialog shows a QR and a code', Boolean(code));
await page.screenshot({ path: `${SHOT}/shot-pairing.png` });

// 2. the phone joins
const phone = new WebSocket(`ws://localhost:4000/ws?role=phone&code=${code}`);
await new Promise((r) => phone.on('open', r));
const phoneSays = [];
phone.on('message', (m) => phoneSays.push(JSON.parse(m.toString())));
await page.waitForTimeout(500);
const connected = await page.locator('.pair .badge.ok').count();
ok('desk sees the phone connect', connected > 0);

await page.click('.dialog-actions button:has-text("Done")');

// 3. a known barcode -> a priced line item, with no typing
phone.send(JSON.stringify({ type: 'scan', barcode: '8964000101025' }));
await page.waitForTimeout(700);
const firstItem = await page.locator('.item-row input').first().inputValue();
const firstPrice = await page.locator('.item-row input').nth(2).inputValue();
ok(`known barcode became a line item (${firstItem} @ ${firstPrice})`, firstItem === 'Courasant' && firstPrice === '60');

const result = phoneSays.find((m) => m.type === 'scan-result');
ok('phone was told what happened', result?.found === true && result.name === 'Courasant');

// 4. scanning it again means two of it, not two lines
phone.send(JSON.stringify({ type: 'scan', barcode: '8964000101025' }));
await page.waitForTimeout(700);
const rows = await page.locator('.item-row').count();
const qty = await page.locator('.item-row input').nth(1).inputValue();
ok(`second scan increments quantity instead of adding a row (rows=${rows}, qty=${qty})`, rows === 1 && qty === '2');

// 5. an unknown barcode asks to create the product
phone.send(JSON.stringify({ type: 'scan', barcode: '999000111222' }));
await page.waitForSelector('.dialog h2:has-text("New barcode")', { timeout: 4000 });
ok('unknown barcode prompts to create the product', true);
await page.screenshot({ path: `${SHOT}/shot-unknown.png` });
await page.fill('.dialog .field input', 'Test Widget');
await page.fill('.dialog .grid-3 input >> nth=0', '250');
await page.click('.dialog button:has-text("Save & add to receipt")');
await page.waitForTimeout(900);
const rows2 = await page.locator('.item-row').count();
const newName = await page.locator('.item-row input').nth(3).inputValue();
ok(`created product landed on the receipt (${newName})`, rows2 === 2 && newName === 'Test Widget');

// 6. the totals box reflects it
const totalText = await page.locator('.totals-box .row.grand span').last().innerText();
ok(`grand total updated (${totalText})`, totalText.includes('370'));

// 7. drop the phone, scan while away, come back -> nothing is lost
phone.close();
await page.waitForTimeout(400);
const phone2 = new WebSocket(`ws://localhost:4000/ws?role=phone&code=${code}`);
await new Promise((r) => phone2.on('open', r));
phone2.send(JSON.stringify({ type: 'scan', barcode: '8964000202019' }));
await page.waitForTimeout(800);
const rows3 = await page.locator('.item-row').count();
ok(`a phone that reconnects still scans into the same sale (rows=${rows3})`, rows3 === 3);

// 8. reload the desk mid-sale: the draft comes back
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const restored = await page.locator('.notice.info:has-text("Draft restored")').count();
const rowsAfter = await page.locator('.item-row').count();
ok(`reloading mid-sale restores the draft (banner=${restored}, rows=${rowsAfter})`, restored === 1 && rowsAfter === 3);
await page.screenshot({ path: `${SHOT}/shot-restored.png`, fullPage: false });

// 9. a scan that lands while the desk is away is delivered on return
phone2.send(JSON.stringify({ type: 'scan', barcode: '8964000101018' }));
await page.waitForTimeout(900);
const rowsFinal = await page.locator('.item-row').count();
ok(`scan queued during the reload was delivered (rows=${rowsFinal})`, rowsFinal === 4);

phone2.close();
await browser.close();
