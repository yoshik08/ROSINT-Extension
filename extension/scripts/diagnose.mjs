// Live external services; only Reddit's challenge-protected markup is a fixture.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { secondHiddenUser } from './live-users.mjs';
const user = secondHiddenUser();
const path = resolve('extension/chrome');
const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
try {
 const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
 const id = new URL(worker.url()).hostname;
 const settings = await context.newPage();
 await settings.goto('chrome://extensions/');
 await settings.evaluate(async (extensionId) => {
   await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, hostAccess: 'ON_CLICK' });
 }, id);
 assert.equal(await worker.evaluate(async () => {
   try { await fetch('https://removal.rosint.dev/api/config', {signal: AbortSignal.timeout(10000)}); return false; }
   catch { return true; }
 }), true);
 const popup = await context.newPage();
 await popup.goto(`chrome-extension://${id}/popup.html`);
 await popup.locator('#title').getByText('Allow Rosint on Reddit', {exact:true}).waitFor();
 console.log('PASS: withheld host permissions reproduce fetch failure; popup identifies missing access.');
 // This changes only the disposable test browser's extension, never the user's.
 await settings.evaluate(async (extensionId) => {
   await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, hostAccess: 'ON_ALL_SITES' });
 }, id);
 await popup.reload();
 await popup.locator('[data-service="removal"] .svc-state').getByText('Online', {exact:true}).waitFor({timeout:30000});
 console.log('PASS: granted host permissions permit real config and blocklist reads.');
 await context.route('https://www.reddit.com/**', async (route) => {
   if (new URL(route.request().url()).pathname.endsWith('.json')) {
     await route.fulfill({status:403,body:'Forbidden'});
   } else {
     await route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#0e1113;--color-neutral-background:#0e1113;--color-neutral-content:#b8c5cd;--color-neutral-content-strong:#eef1f3;--color-neutral-content-weak:#82959d;--color-secondary-background:#2a3236;--color-secondary:#eef1f3}main{width:730px;margin:auto}</style><main><div id="profile-controls"><nav>Overview Posts Comments</nav><button>Feed options</button><hr></div><section style="min-height:650px;padding-top:120px;margin-top:100px;text-align:center"><div><div><div><div><div><h2>Welcome!</h2><p>u/'+user+' likes to keep their posts hidden, but check out their stats to learn more about them.</p></div></div></div></div></div></section></main>'});
   }
 });
 const profile = await context.newPage();
 for (const tab of ['submitted', 'comments']) {
   await profile.goto(`https://www.reddit.com/user/${user}/${tab}/`);
   await profile.locator('[data-rosint-item]').first().waitFor({timeout:110000});
   const count = await profile.locator('[data-rosint-item]').count();
   assert.ok(count > 0);
   const card = profile.locator('[data-rosint-item]').first();
   assert.equal(await card.getAttribute('data-rosint-archived'), '');
   const box = await card.boundingBox();
   const controls = await profile.locator('#profile-controls').boundingBox();
   const feed = await profile.locator('[data-rosint-feed]').boundingBox();
   assert.ok(box.height > 100);
   assert.ok(feed.y - controls.y - controls.height <= 16);
   if (tab === 'submitted') assert.ok(await card.locator('img').count() > 0);
   assert.ok(await card.getByRole('button', {name:'Copy link', exact:true}).isVisible());
   if (process.argv.includes('--screenshots')) await profile.screenshot({path:`extension/dist/diagnose-${tab}.png`});
   console.log(`PASS: real removal/archive responses rendered ${count} ${tab} items, first card ${box.height}px high, ${feed.y - controls.y - controls.height}px below controls.`);
 }
} finally { await context.close(); }
