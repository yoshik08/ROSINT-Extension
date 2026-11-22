// Live control on reddit.com: a profile whose history is public must be left
// exactly as Reddit drew it. Headless Firefox with the packaged add-on.
//   node extension/scripts/live-firefox-public.mjs [username]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Builder, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const user = process.argv[2] || 'spez';
const options = new firefox.Options().addArguments('-headless', '--width=1280', '--height=1000');
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
try {
    await driver.installAddon(resolve('extension/dist/rosint-firefox.xpi'), true);
    await driver.get(`https://www.reddit.com/user/${user}/`);
    await driver.wait(until.elementLocated({ css: 'shreddit-post, shreddit-profile-comment, shreddit-comment' }), 60000);
    // Long enough for detection, an archive round trip and rendering.
    await driver.sleep(12000);
    const report = await driver.executeScript(`return {
        challenged: /prove your humanity/i.test(document.title),
        feeds: document.querySelectorAll('[data-rosint-feed]').length,
        items: document.querySelectorAll('[data-rosint-item]').length,
        native: document.querySelectorAll('shreddit-post, shreddit-profile-comment, shreddit-comment').length,
        concealed: [...document.querySelectorAll('[style*="display: none"]')].filter((e) => e.closest('main')).length,
    };`);
    console.log(user, JSON.stringify(report));
    assert.equal(report.challenged, false, 'Reddit challenged the browser; result is meaningless');
    assert.equal(report.feeds, 0, 'no Rosint feed on a public profile');
    assert.equal(report.items, 0, 'no restored rows on a public profile');
    assert.ok(report.native > 0, "Reddit's own items are still there");
    console.log('PASS: a public profile is untouched.');
} finally {
    await driver.quit();
}
