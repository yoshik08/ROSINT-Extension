// Store listing screenshots (1280x800, the size both stores accept) of the
// packaged Firefox add-on on a real hidden profile, headless. Reddit's
// logged-out sign-in prompts are hidden so the restored feed is the subject.
// Output: extension/dist/store/. Review before uploading: these show a real
// account's history.
//   node extension/scripts/store-shots.mjs <username>
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Builder, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const user = process.argv[2];
if (!user) {
    console.error('usage: node extension/scripts/store-shots.mjs <username of a profile that hides its history>');
    process.exit(2);
}
const out = resolve('extension/dist/store');
mkdirSync(out, { recursive: true });

const CLEAN = `
    const style = document.createElement('style');
    style.textContent = '#credential_picker_container, #credential_picker_iframe, iframe[src*="accounts.google.com"], [id*="google-one-tap" i], shreddit-async-loader[bundlename*="signup" i], faceplate-dialog, auth-flow-modal { display: none !important; }';
    document.head.appendChild(style);
`;

async function shoot(theme, tab) {
    const options = new firefox.Options().addArguments('-headless', '--width=1280', '--height=800');
    if (theme === 'dark') options.setPreference('ui.systemUsesDarkTheme', 1);
    options.setPreference('layout.css.prefers-color-scheme.content-override', theme === 'dark' ? 0 : 1);
    const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
    try {
        await driver.manage().window().setRect({ width: 1280, height: 800 });
        await driver.installAddon(resolve('extension/dist/rosint-firefox.xpi'), true);
        await driver.get(`https://www.reddit.com/user/${user}/${tab === 'overview' ? '' : `${tab}/`}`);
        // The window size includes browser chrome; grow it until the page
        // viewport itself is exactly 1280x800.
        const [innerWidth, innerHeight] = await driver.executeScript('return [innerWidth, innerHeight]');
        await driver.manage().window().setRect({ width: 1280 + (1280 - innerWidth), height: 800 + (800 - innerHeight) });
        await driver.wait(until.elementLocated({ css: '[data-rosint-item]' }), 90000);
        await driver.sleep(4000);
        await driver.executeScript(CLEAN);
        await driver.sleep(500);
        const file = `${out}/rosint-${tab}-${theme}-1280x800.png`;
        writeFileSync(file, await driver.takeScreenshot(), 'base64');
        console.log('wrote', file);
    } finally {
        await driver.quit();
    }
}

await shoot('light', 'overview');
await shoot('dark', 'comments');
