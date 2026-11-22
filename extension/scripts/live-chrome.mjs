// Live check against reddit.com with the packaged Chrome extension, headless
// (new headless supports extensions) so no window takes focus.
//   node extension/scripts/live-chrome.mjs <username> [tab] [--out dir] [--dark]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { hiddenUser } from './live-users.mjs';

const args = process.argv.slice(2);
const user = hiddenUser(args[0]);
const tab = args[1] && !args[1].startsWith('--') ? args[1] : '';
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'extension/dist/live');
const dark = args.includes('--dark');
mkdirSync(out, { recursive: true });
const ext = resolve('extension/chrome');
const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !process.env.ROSINT_HEADED,
    viewport: { width: 1280, height: 1000 },
    colorScheme: dark ? 'dark' : 'light',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(process.env.ROSINT_HEADED ? ['--window-position=-2600,0'] : [])],
});
const page = context.pages()[0] ?? await context.newPage();
page.on('console', (m) => { if (/rosint/i.test(m.text())) console.log('[console]', m.text()); });
const url = `https://www.reddit.com/user/${user}/${tab ? tab + '/' : ''}`;
const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('status', res?.status(), 'title', await page.title());
let found = false;
try { await page.waitForSelector('[data-rosint-item]', { timeout: 60000 }); found = true; } catch { /* reported below as found: false */ }
await page.waitForTimeout(3000);
const info = await page.evaluate(() => ({
    items: document.querySelectorAll('[data-rosint-item]').length,
    renderers: [...document.querySelectorAll('[data-rosint-item]')].reduce((m, e) => { const r = e.getAttribute('data-rosint-renderer'); m[r] = (m[r] || 0) + 1; return m; }, {}),
    status: document.querySelector('[data-rosint-status]')?.textContent || null,
    hiddenText: /likes to keep their/i.test(document.body.innerText),
    bodyStart: document.body.innerText.slice(0, 300),
}));
console.log(JSON.stringify({ found, ...info }, null, 1));
const name = `chrome-${user}-${tab || 'overview'}${dark ? '-dark' : ''}`;
await page.screenshot({ path: `${out}/${name}.png` });
await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true }).catch(() => {});
await context.close();
