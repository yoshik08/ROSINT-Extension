// Renders the built popup in each state with a stubbed extension API, for
// visual review without a browser profile. Output: extension/dist/popup/*.png
//   node extension/scripts/popup-shots.mjs
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const out = resolve('extension/dist/popup');
mkdirSync(out, { recursive: true });
const now = Date.now();
const health = { arctic: { ok: true, at: now - 40000 }, pullpush: { ok: false, at: now - 40000 } };
const profileUrl = 'https://www.reddit.com/user/hidden_example/';
const states = {
    ready: { url: profileUrl, conn: { ok: true, missing: [], health, saved: 6 }, state: { phase: 'ready', count: 67, counts: { posts: 11, comments: 56 }, oldest: 1762819200, archived: true, done: true, loading: false } },
    loading: { url: profileUrl, conn: { ok: true, missing: [], health: { arctic: null, pullpush: null } }, state: { phase: 'loading-archive', count: 0, loading: true } },
    public: { url: 'https://www.reddit.com/user/spez/', conn: { ok: true, missing: [], health }, state: { phase: 'not-hidden' } },
    offline: { url: profileUrl, conn: { ok: true, missing: [], saved: 6, health: { arctic: { ok: false, at: now - 5000 }, pullpush: { ok: false, at: now - 5000, paused: true } } }, state: { phase: 'ready', count: 67, counts: { posts: 11, comments: 56 }, oldest: 1762819200, archived: true, done: true, loading: false, offlineAt: now - 3600000 } },
    error: { url: profileUrl, conn: { ok: true, missing: [], health: { arctic: { ok: false, at: now - 5000 }, pullpush: { ok: false, at: now - 5000 } } }, state: { phase: 'error', failure: 'error', count: 0 } },
    access: { url: profileUrl, conn: { ok: false, error: 'host-permission-required', missing: ['https://api.pullpush.io/*'] }, state: null },
    idle: { url: 'https://github.com/', conn: { ok: true, missing: [], health }, state: null },
};
const browser = await chromium.launch({ headless: true });
for (const [name, fixture] of Object.entries(states)) {
    const page = await browser.newPage({ viewport: { width: 360, height: 600 }, deviceScaleFactor: 2 });
    await page.addInitScript((f) => {
        const stub = {
            runtime: { getManifest: () => ({ version: '1.3.0' }), sendMessage: async () => f.conn, id: 'x', getURL: (p) => p },
            tabs: { query: async () => [{ id: 1, url: f.url }], sendMessage: async () => ({ ok: true, state: f.state }), reload: async () => {}, update: async () => {}, create: async () => {} },
            permissions: { request: async () => true },
            action: { setBadgeText: async () => {} },
        };
        globalThis.chrome = stub;
    }, fixture);
    await page.goto(pathToFileURL(resolve('extension/chrome/popup.html')).href);
    await page.waitForTimeout(700);
    const height = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width: 360, height });
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.close();
}
await browser.close();
console.log('popup states written to', out);
