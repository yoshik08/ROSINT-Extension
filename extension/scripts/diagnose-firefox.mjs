import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Builder, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { secondHiddenUser } from './live-users.mjs';
const user = secondHiddenUser();

const options = new firefox.Options().addArguments('-headless');
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
try {
    const id = await driver.installAddon(resolve('extension/dist/rosint-firefox.xpi'), true);
    console.log(`Installed temporary Firefox add-on: ${id}`);
    for (const tab of ['submitted', 'comments']) {
    await driver.get(`https://www.reddit.com/user/${user}/${tab}/`);
    // Test only markup is replaced. Archive/removal requests and extension
    // messaging remain real; automated Reddit sessions hit a challenge.
    await driver.executeScript(`document.body.innerHTML = '<main style="width:730px;margin:auto"><div id="profile-controls"><nav>Overview Posts Comments</nav><button>Feed options</button><hr></div><section id="hidden-panel" style="min-height:650px;padding-top:120px;margin-top:100px;text-align:center"><div><div><div><div><h2>Welcome!</h2><p>u/${user} likes to keep their posts hidden, but check out their stats to learn more about them.</p></div></div></div></div></section></main>';`);
    await driver.wait(until.elementLocated({ css: '[data-rosint-item]' }), 110000);
    const result = await driver.executeScript(`
        const card = document.querySelector('[data-rosint-item]');
        const controls = document.querySelector('#profile-controls').getBoundingClientRect();
        const box = card.getBoundingClientRect();
        return {count:document.querySelectorAll('[data-rosint-item]').length, height:box.height, gap:box.top-controls.bottom, title:card.shadowRoot?.querySelector('[slot="title"]')?.textContent, media:card.shadowRoot?.querySelectorAll('img').length};
    `);
    console.log(result);
    assert.ok(result.count > 0);
    assert.ok(result.height > 100);
    assert.ok(result.gap <= 16);
    if (tab === 'submitted') {
        assert.ok(result.title);
        assert.ok(result.media > 0);
    }
    console.log(`PASS: packaged Firefox add-on uses real removal/archive services and renders ${tab} below the controls.`);
    }
} finally {
    await driver.quit();
}
