// Outage drill in the packaged Chrome build: the first visit uses the real
// removal service and archives; then every archive request is made to fail in
// the extension worker and the profile is reloaded. Expect the saved copy,
// labelled. A never-visited profile during the outage should retry once on its
// own and then explain the outage. Reddit's markup is a fixture (automated
// Chromium gets Reddit's bot challenge).
//   node extension/scripts/outage-chrome.mjs [--screenshots]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { hiddenUser, secondHiddenUser } from './live-users.mjs';

const path = resolve('extension/chrome');
const shots = process.argv.includes('--screenshots');
const fixture = (user) => `<!doctype html><style>body{margin:0;background:#0e1113;--color-neutral-background:#0e1113;--color-neutral-background-hover:#181c1f;--color-neutral-content:#b7cad4;--color-neutral-content-strong:#eef1f3;--color-neutral-content-weak:#8ba2ad;--color-secondary-background:#2a3236;--color-secondary:#dbe4e9;--color-neutral-border-weak:#ffffff19;font-family:system-ui;color:#eef1f3}main{width:730px;margin:auto}</style><main><div id="profile-controls"><nav>Overview Posts Comments</nav><hr></div><section style="min-height:650px;padding-top:120px;text-align:center"><div><h2>Welcome!</h2><p>u/${user} likes to keep their posts hidden, but check out their stats to learn more about them.</p></div></section></main>`;
const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await context.route('https://www.reddit.com/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('.json')) return route.fulfill({ status: 403, body: 'Forbidden' });
        return route.fulfill({ contentType: 'text/html', body: fixture(url.pathname.split('/')[2]) });
    });
    const page = await context.newPage();
    const header = () => page.evaluate(() => {
        const h = document.querySelector('[data-rosint-header]')?.shadowRoot;
        return { rows: document.querySelectorAll('[data-rosint-item]').length, title: h?.querySelector('.banner .title')?.textContent, detail: h?.querySelector('.banner .detail')?.textContent, retry: h ? !h.querySelector('.btn.primary').hidden : false };
    });

    await page.goto(`https://www.reddit.com/user/${hiddenUser()}/submitted/`);
    await page.locator('[data-rosint-item]').first().waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('[data-rosint-header]')?.shadowRoot.querySelector('.banner.busy'), null, { timeout: 60000 });
    const live = await header();
    console.log('live visit:', JSON.stringify(live));

    await worker.evaluate(() => {
        const real = globalThis.fetch;
        globalThis.fetch = (url, init) => (/arctic-shift|pullpush/.test(String(url)) ? Promise.reject(new TypeError('Failed to fetch')) : real(url, init));
    });
    await page.reload();
    await page.waitForFunction(() => /aren’t answering/.test(document.querySelector('[data-rosint-header]')?.shadowRoot.querySelector('.banner .detail')?.textContent || ''), null, { timeout: 120000 });
    const offline = await header();
    console.log('outage, saved copy:', JSON.stringify(offline));
    assert.equal(offline.rows, live.rows);
    assert.equal(offline.retry, true);
    if (shots) await page.screenshot({ path: 'extension/dist/outage-saved.png' });

    await page.goto(`https://www.reddit.com/user/${secondHiddenUser()}/submitted/`);
    await page.waitForFunction(() => /Trying again/.test(document.querySelector('[data-rosint-header]')?.shadowRoot.textContent || ''), null, { timeout: 120000 });
    console.log('outage, nothing saved:', JSON.stringify(await header()));
    await page.waitForFunction(() => /aren’t answering/.test(document.querySelector('[data-rosint-header]')?.shadowRoot.querySelector('.banner .title')?.textContent || ''), null, { timeout: 180000 });
    const failed = await header();
    console.log('after the automatic retry:', JSON.stringify(failed));
    assert.equal(failed.rows, 0);
    assert.equal(failed.retry, true);
    if (shots) await page.screenshot({ path: 'extension/dist/outage-empty.png' });
    console.log('PASS: outages show the saved copy, or retry once and then explain.');
} finally {
    await context.close();
}
