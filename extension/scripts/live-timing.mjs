// Real-page speed check in headless Firefox: time from navigation to the
// first restored row, cold and then on a revisit (served from the browser's
// saved copy while the archives refresh in the background).
//   node extension/scripts/live-timing.mjs [username]
import { resolve } from 'node:path';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { hiddenUser } from './live-users.mjs';

const user = hiddenUser(process.argv[2]);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(new firefox.Options().addArguments('-headless')).build();
async function visit(label) {
    await driver.get('about:blank');
    const started = Date.now();
    await driver.get(`https://www.reddit.com/user/${user}/`);
    const pageReady = Date.now() - started;
    let first = null;
    let settled = null;
    for (;;) {
        const s = await driver.executeScript(`const h = document.querySelector('[data-rosint-header]')?.shadowRoot;
            return { items: document.querySelectorAll('[data-rosint-item]').length, busy: !!h?.querySelector('.banner.busy'), title: h?.querySelector('.banner .title')?.textContent, detail: h?.querySelector('.banner .detail')?.textContent };`);
        const t = Date.now() - started;
        if (s.items && first == null) first = { t, ...s };
        if (s.title && !s.busy && (s.items || /archives|No archived/.test(s.title))) { settled = { t, ...s }; break; }
        if (t > 120000) { settled = { t, ...s, timeout: true }; break; }
        await driver.sleep(150);
    }
    console.log(`${label}: page ${pageReady}ms, first row ${first?.t ?? '-'}ms, settled ${settled.t}ms`);
    console.log(`   first: ${first ? `${first.items} rows | ${first.title} | ${first.detail}` : 'none'}`);
    console.log(`   final: ${settled.items} rows | ${settled.title} | ${settled.detail}`);
}
try {
    await driver.installAddon(resolve('extension/dist/rosint-firefox.xpi'), true);
    await visit('cold');
    await visit('revisit');
} finally {
    await driver.quit();
}
