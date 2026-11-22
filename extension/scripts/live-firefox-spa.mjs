// Live SPA navigation on reddit.com in headless Firefox: click Reddit's own
// profile tabs and go back, checking the restored feed follows each change
// without duplicates or leftovers.
//   node extension/scripts/live-firefox-spa.mjs [username]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { hiddenUser } from './live-users.mjs';

const user = hiddenUser(process.argv[2]);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(new firefox.Options().addArguments('-headless', '--width=1280', '--height=1000')).build();
const state = () => driver.executeScript(`
    const items = [...document.querySelectorAll('[data-rosint-item]')];
    const kinds = {}; for (const e of items) kinds[e.getAttribute('data-rosint-kind')] = (kinds[e.getAttribute('data-rosint-kind')] || 0) + 1;
    return { path: location.pathname, feeds: document.querySelectorAll('[data-rosint-feed]').length, items: items.length,
        unique: new Set(items.map((e) => e.getAttribute('data-rosint-fullname'))).size, kinds,
        title: document.querySelector('[data-rosint-header]')?.shadowRoot.querySelector('.banner .title')?.textContent, detail: document.querySelector('[data-rosint-header]')?.shadowRoot.querySelector('.banner .detail')?.textContent };`);
async function settle(predicate, label) {
    const started = Date.now();
    for (;;) {
        const s = await state();
        if (predicate(s)) { console.log(label, JSON.stringify(s)); return s; }
        if (Date.now() - started > 90000) throw new Error(`${label}: ${JSON.stringify(s)}`);
        await driver.sleep(500);
    }
}
try {
    await driver.installAddon(resolve('extension/dist/rosint-firefox.xpi'), true);
    await driver.get(`https://www.reddit.com/user/${user}/`);
    const overview = await settle((s) => s.items > 0 && s.kinds.posts && s.kinds.comments, 'overview');
    for (const [label, kind] of [['Comments', 'comments'], ['Posts', 'posts']]) {
        const tab = await driver.wait(until.elementLocated(By.xpath(`//a[normalize-space()='${label}']`)), 20000);
        await driver.executeScript('arguments[0].click()', tab);
        const s = await settle((x) => x.items > 0 && Object.keys(x.kinds).length === 1 && x.kinds[kind] && x.feeds === 1, `click ${label}`);
        assert.equal(s.unique, s.items, 'no duplicate rows');
    }
    await driver.navigate().back();
    await driver.navigate().back();
    const back = await settle((s) => s.feeds === 1 && s.kinds.posts && s.kinds.comments, 'back to overview');
    // Saved copies repaint everything this browser has seen for both kinds,
    // which can be more than the first page shown on the first visit.
    assert.ok(back.items >= overview.items, 'back shows at least the first visit');
    assert.equal(back.unique, back.items);
    console.log('PASS: SPA tab clicks and back navigation keep exactly one restored feed of the right kind.');
} finally {
    await driver.quit();
}
