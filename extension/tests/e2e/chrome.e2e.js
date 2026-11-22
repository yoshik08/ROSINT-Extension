// Live Chrome check. It needs a real Reddit session and two profiles you own
// or can view, so it is skipped unless REDDIT_HIDDEN_USER and
// REDDIT_VISIBLE_USER are set. Build the extension first: `npm run ext:build`.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '../../chrome');
const hiddenUser = process.env.REDDIT_HIDDEN_USER;
const visibleUser = process.env.REDDIT_VISIBLE_USER;
const live = Boolean(hiddenUser && visibleUser);

const profileUrl = (name, tab = '') => `https://www.reddit.com/user/${name}/${tab}`;
const itemSelector = '[data-rosint-item]';
const nativeSelector = 'shreddit-post, shreddit-profile-comment';

// Typography and geometry of the first matching item. Height is reported but
// not compared: two different posts legitimately differ in body length, while
// width, left offset and every computed font/colour value must match.
const measure = (page, selector) => page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
        width: box.width,
        left: box.left,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        padding: style.padding,
        margin: style.margin,
    };
}, selector);

describe.skipIf(!live)('chrome extension on live Reddit', () => {
    let context;
    let page;

    beforeAll(async () => {
        if (!existsSync(resolve(extensionPath, 'content.js'))) {
            throw new Error('extension/chrome/content.js is missing — run `npm run ext:build` first');
        }
        context = await chromium.launchPersistentContext('', {
            headless: !process.env.ROSINT_E2E_HEADED,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
        });
        page = context.pages()[0] ?? await context.newPage();
    });

    afterAll(async () => {
        await context?.close();
    });

    test('a hidden profile gets its feed back', async () => {
        await page.goto(profileUrl(hiddenUser), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(itemSelector, { timeout: 90_000 });
        expect(await page.locator(itemSelector).count()).toBeGreaterThan(0);
    });

    test('an injected item matches a native item within 1px', async () => {
        await page.goto(profileUrl(visibleUser), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(nativeSelector, { timeout: 90_000 });
        const native = await measure(page, nativeSelector);

        await page.goto(profileUrl(hiddenUser), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(itemSelector, { timeout: 90_000 });
        const injected = await measure(page, itemSelector);

        expect(injected).not.toBeNull();
        expect(native).not.toBeNull();
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'padding', 'margin']) {
            expect(injected[property], property).toBe(native[property]);
        }
        expect(Math.abs(injected.width - native.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(injected.left - native.left)).toBeLessThanOrEqual(1);
    });

    test('a profile with visible history is untouched', async () => {
        await page.goto(profileUrl(visibleUser), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(nativeSelector, { timeout: 90_000 });
        expect(await page.locator(itemSelector).count()).toBe(0);
        expect(await page.evaluate(() => document.querySelector('[data-rosint]') !== null)).toBe(false);
    });

    test('the posts and comments tabs each inject their own kind', async () => {
        await page.goto(profileUrl(hiddenUser, 'submitted'), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('shreddit-post[data-rosint-item]', { timeout: 90_000 });
        expect(await page.locator('shreddit-profile-comment[data-rosint-item]').count()).toBe(0);

        await page.goto(profileUrl(hiddenUser, 'comments'), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('shreddit-profile-comment[data-rosint-item]', { timeout: 90_000 });
        expect(await page.locator('shreddit-post[data-rosint-item]').count()).toBe(0);
    });

    test('scrolling loads a second archive page', async () => {
        await page.goto(profileUrl(hiddenUser, 'submitted'), { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('shreddit-post[data-rosint-item]', { timeout: 90_000 });
        const first = await page.locator('shreddit-post[data-rosint-item]').count();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForFunction(
            (before) => document.querySelectorAll('shreddit-post[data-rosint-item]').length > before,
            first,
            { timeout: 90_000 },
        );
        expect(await page.locator('shreddit-post[data-rosint-item]').count()).toBeGreaterThan(first);
    });
});
