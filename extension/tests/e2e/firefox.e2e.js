// Live Firefox check via geckodriver + selenium-webdriver. Same environment
// gate and assertions as the Chrome suite; the add-on is installed from the
// built zip as a temporary add-on.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Builder, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
const hiddenUser = process.env.REDDIT_HIDDEN_USER;
const visibleUser = process.env.REDDIT_VISIBLE_USER;
const live = Boolean(hiddenUser && visibleUser);

const profileUrl = (name, tab = '') => `https://www.reddit.com/user/${name}/${tab}`;
const itemSelector = '[data-rosint-item]';
const nativeSelector = 'shreddit-post, shreddit-profile-comment';

function firefoxZip() {
    if (!existsSync(dist)) return null;
    const name = readdirSync(dist).find((file) => /^rosint-firefox.*\.zip$/.test(file));
    return name ? resolve(dist, name) : null;
}

const measure = (driver, selector) => driver.executeScript(`
    const element = document.querySelector(arguments[0]);
    if (!element) return null;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
        width: box.width, left: box.left,
        fontFamily: style.fontFamily, fontSize: style.fontSize,
        fontWeight: style.fontWeight, lineHeight: style.lineHeight,
        color: style.color, backgroundColor: style.backgroundColor,
        padding: style.padding, margin: style.margin
    };
`, selector);

describe.skipIf(!live)('firefox extension on live Reddit', () => {
    let driver;

    beforeAll(async () => {
        const zip = firefoxZip();
        if (!zip) throw new Error('no extension/dist/rosint-firefox.zip — run `npm run ext:build` first');

        const options = new firefox.Options();
        if (!process.env.ROSINT_E2E_HEADED) options.addArguments('-headless');
        driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
        await driver.installAddon(zip, true);
    }, 120_000);

    afterAll(async () => {
        await driver?.quit();
    });

    test('a hidden profile gets its feed back', async () => {
        await driver.get(profileUrl(hiddenUser));
        await driver.wait(until.elementLocated({ css: itemSelector }), 90_000);
        const items = await driver.findElements({ css: itemSelector });
        expect(items.length).toBeGreaterThan(0);
    }, 120_000);

    test('an injected item matches a native item within 1px', async () => {
        await driver.get(profileUrl(visibleUser));
        await driver.wait(until.elementLocated({ css: nativeSelector }), 90_000);
        const native = await measure(driver, nativeSelector);

        await driver.get(profileUrl(hiddenUser));
        await driver.wait(until.elementLocated({ css: itemSelector }), 90_000);
        const injected = await measure(driver, itemSelector);

        expect(injected).not.toBeNull();
        expect(native).not.toBeNull();
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'padding', 'margin']) {
            expect(injected[property], property).toBe(native[property]);
        }
        expect(Math.abs(injected.width - native.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(injected.left - native.left)).toBeLessThanOrEqual(1);
    }, 180_000);

    test('a profile with visible history is untouched', async () => {
        await driver.get(profileUrl(visibleUser));
        await driver.wait(until.elementLocated({ css: nativeSelector }), 90_000);
        expect((await driver.findElements({ css: itemSelector })).length).toBe(0);
        expect(await driver.executeScript('return document.querySelector("[data-rosint]") !== null')).toBe(false);
    }, 120_000);

    test('the posts and comments tabs each inject their own kind', async () => {
        await driver.get(profileUrl(hiddenUser, 'submitted'));
        await driver.wait(until.elementLocated({ css: 'shreddit-post[data-rosint-item]' }), 90_000);
        expect((await driver.findElements({ css: 'shreddit-profile-comment[data-rosint-item]' })).length).toBe(0);

        await driver.get(profileUrl(hiddenUser, 'comments'));
        await driver.wait(until.elementLocated({ css: 'shreddit-profile-comment[data-rosint-item]' }), 90_000);
        expect((await driver.findElements({ css: 'shreddit-post[data-rosint-item]' })).length).toBe(0);
    }, 180_000);

    test('scrolling loads a second archive page', async () => {
        await driver.get(profileUrl(hiddenUser, 'submitted'));
        await driver.wait(until.elementLocated({ css: 'shreddit-post[data-rosint-item]' }), 90_000);
        const first = (await driver.findElements({ css: 'shreddit-post[data-rosint-item]' })).length;
        await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
        await driver.wait(async () => {
            const count = (await driver.findElements({ css: 'shreddit-post[data-rosint-item]' })).length;
            return count > first;
        }, 90_000);
        expect((await driver.findElements({ css: 'shreddit-post[data-rosint-item]' })).length).toBeGreaterThan(first);
    }, 180_000);
});
