// Live check on reddit.com with the packaged Firefox add-on, headless so no
// window takes focus. No markup is replaced: this is Reddit's real page.
//   node extension/scripts/live-firefox.mjs [username] [--tabs overview,submitted,comments] [--dark] [--width 1280] [--lang de-DE]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Builder, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { hiddenUser } from './live-users.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const user = hiddenUser(args[0]);
const tabs = flag('--tabs', 'overview,submitted,comments').split(',');
const width = Number(flag('--width', 1280));
const height = Number(flag('--height', 1000));
const dark = args.includes('--dark');
const out = resolve(flag('--out', 'extension/dist/live'));
mkdirSync(out, { recursive: true });

const options = new firefox.Options().addArguments('-headless', `--width=${width}`, `--height=${height}`);
if (dark) options.setPreference('ui.systemUsesDarkTheme', 1);
// --lang de-DE: Reddit localises the hidden-history notice for logged-out viewers.
const lang = flag('--lang', null);
if (lang) options.setPreference('intl.accept_languages', lang);
options.setPreference('layout.css.prefers-color-scheme.content-override', dark ? 0 : 1);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
let failed = false;
try {
    await driver.manage().window().setRect({ width, height });
    await driver.installAddon(resolve('extension/dist/rosint-firefox.xpi'), true);
    for (const tab of tabs) {
        const path = tab === 'overview' ? '' : `${tab}/`;
        await driver.get(`https://www.reddit.com/user/${user}/${path}`);
        let ok = true;
        try { await driver.wait(until.elementLocated({ css: '[data-rosint-item]' }), 90000); } catch { ok = false; }
        await driver.sleep(Number(flag('--settle', 4000)));
        const report = await driver.executeScript(`
            const items = [...document.querySelectorAll('[data-rosint-item]')];
            const tabsEl = [...document.querySelectorAll('a,button')].find((e) => /^Feed options$/i.test(e.getAttribute('aria-label') || e.textContent.trim()));
            const first = items[0]?.getBoundingClientRect();
            const kinds = {}; const renderers = {};
            for (const e of items) { const k = e.getAttribute('data-rosint-kind') || e.localName; kinds[k] = (kinds[k] || 0) + 1; const r = e.getAttribute('data-rosint-renderer'); renderers[r] = (renderers[r] || 0) + 1; }
            return {
                title: document.title,
                challenged: /prove your humanity/i.test(document.title),
                items: items.length, kinds, renderers,
                archived: items.filter((e) => e.hasAttribute('data-rosint-archived')).length,
                status: [...document.querySelectorAll('[data-rosint-status]')].map((e) => e.textContent),
                hiddenPanelVisible: [...document.querySelectorAll('main *')].some((e) => /likes to keep their/.test(e.textContent) && e.children.length === 0 && e.getClientRects().length > 0),
                firstTop: first?.top, firstHeight: first?.height, firstWidth: first?.width,
                gapBelowControls: first && tabsEl ? Math.round(first.top - tabsEl.getBoundingClientRect().bottom) : null,
                zeroHeight: items.filter((e) => !e.hidden && e.getBoundingClientRect().height < 20).length,
            };`);
        console.log(tab, JSON.stringify(report));
        if (!ok || report.challenged || report.zeroHeight) failed = true;
        const png = await driver.takeScreenshot();
        writeFileSync(`${out}/firefox-${user}-${tab}${dark ? '-dark' : ''}${lang ? `-${lang}` : ''}-${width}.png`, png, 'base64');
        if (args.includes('--scroll')) {
            const before = report.items;
            await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
            await driver.sleep(8000);
            const after = await driver.executeScript('return document.querySelectorAll("[data-rosint-item]").length');
            console.log(tab, 'scroll', before, '->', after);
        }
    }
} finally {
    await driver.quit();
}
process.exitCode = failed ? 1 : 0;
