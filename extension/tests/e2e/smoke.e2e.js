// Run the packaged extension with deterministic network responses. Unlike the
// live suites this needs no Reddit account or third-party service availability.
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, test } from 'vitest';

test.each([{ denied: false }, { denied: true }, { denied: true, brokenComponent: true }])('packaged Chrome extension renders hidden profile %j', async ({ denied, brokenComponent }) => {
    const extensionPath = resolve(import.meta.dirname, '../../chrome');
    const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        // Keep all real message handling, restriction checks and archive parsing.
        // Only replace the external network boundary in the test worker.
        await worker.evaluate(() => {
            globalThis.fetch = async (url) => {
                const path = String(url);
                let payload;
                if (path.includes('/api/config')) payload = { featuresEnabled: true };
                else if (path.includes('/api/blocklist')) payload = { hashes: [] };
                else payload = { data: [{ id: 'abc', created_utc: 1700000000, author: 'fixture-user', title: 'Recovered post title', selftext: 'Recovered post body', subreddit: 'test', permalink: '/r/test/comments/abc/title/' }] };
                return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
            };
        });
        const infoRequests = [];
        await context.route('https://www.reddit.com/**', async (route) => {
            const url = new URL(route.request().url());
            if (denied && url.pathname.endsWith('.json')) {
                await route.fulfill({ status: 403, body: 'Forbidden' });
                return;
            }
            let payload;
            if (url.pathname.endsWith('/about.json')) payload = { data: { name: 'fixture-user' } };
            else if (url.pathname === '/api/info.json') {
                const ids = url.searchParams.get('id').split(',');
                infoRequests.push(ids);
                payload = { data: { children: ids.filter((id) => id === 't3_abc').map((name) => ({
                    kind: 't3', data: { name, id: 'abc', author: 'fixture-user', created_utc: 1700000000,
                        title: 'Recovered post title', selftext: 'Recovered post body',
                        permalink: '/r/test/comments/abc/title/', subreddit: 'test' },
                })) } };
            } else if (url.pathname.endsWith('.json')) payload = { data: { children: [] } };
            else {
                await route.fulfill({ contentType: 'text/html', body: denied
                    ? `<!doctype html><style>body{margin:0;--color-neutral-background:#0e1113;--color-neutral-content:#b8c5cd;--color-neutral-content-strong:#eef1f3;--color-neutral-content-weak:#82959d;background:#0e1113}main{width:730px;margin:auto}article{margin-top:200px!important}</style>${brokenComponent ? '<script>customElements.define("shreddit-post", class extends HTMLElement {constructor(){super();this.attachShadow({mode:"open"});}});</script>' : ''}<main><div id="profile-controls"><nav>Overview Posts Comments</nav><button>Feed options</button><hr></div><section id="hidden-panel" style="min-height:650px;padding-top:120px;margin-top:100px;text-align:center"><div><div><div><div><div><h2>Welcome!</h2><p>u/fixture-user likes to keep their posts hidden, but check out their stats to learn more about them.</p></div></div></div></div></div></section></main>`
                    : '<!doctype html><main><shreddit-feed id="main-feed"><div id="empty-state">Nothing here yet</div></shreddit-feed></main>' });
                return;
            }
            await route.fulfill({ json: payload });
        });
        const page = await context.newPage();
        await page.goto('https://www.reddit.com/user/fixture-user/submitted/');
        await page.locator('[data-rosint-item]').waitFor();
        if (denied) {
            expect(await page.locator('[data-rosint-item]').getAttribute('data-rosint-archived')).toBe('');
            expect(await page.locator('[data-rosint-item] [slot="text-body"]').innerText()).toContain('Recovered post body');
            expect(await page.locator('#hidden-panel h2').isVisible()).toBe(false);
            expect(await page.locator('nav').innerText()).toBe('Overview Posts Comments');
            const controls = await page.locator('#profile-controls').boundingBox();
            const feed = await page.locator('[data-rosint-feed]').boundingBox();
            const header = await page.locator('[data-rosint-header]').boundingBox();
            const card = await page.locator('[data-rosint-item]').boundingBox();
            expect(card.height).toBeGreaterThan(100);
            expect(feed.y - controls.y - controls.height).toBeLessThanOrEqual(16);
            expect(card.y - header.y - header.height).toBeLessThanOrEqual(16);
            expect(await page.locator('[data-rosint-header] .banner .title').innerText()).toBe('1 post restored');
            expect(await page.locator('[data-rosint-item]').getByRole('link', { name: '0 comments' }).isVisible()).toBe(true);
            expect(await page.locator('[data-rosint-item]').getByRole('button', { name: 'Copy link' }).isVisible()).toBe(true);
        } else {
            expect(infoRequests).toEqual([['t3_abc']]);
            expect(await page.locator('[slot="title"]').innerText()).toBe('Recovered post title');
            expect(await page.locator('[slot="text-body"]').innerText()).toBe('Recovered post body');
            expect(await page.locator('#empty-state').isVisible()).toBe(false);
        }
        await page.goto('https://www.reddit.com/r/test/');
        expect(await page.locator('[data-rosint-item]').count()).toBe(0);
    } finally {
        await context.close();
    }
});
