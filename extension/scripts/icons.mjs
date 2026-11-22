// Renders the toolbar/store icons from the Rosint orb (the same gradient disc
// rosint.dev uses as its mark). Run after changing the artwork:
//   node extension/scripts/icons.mjs
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve('extension/shared/assets/icons');
mkdirSync(out, { recursive: true });
const orb = (size) => {
    // Small sizes drop the highlight and keep a crisp edge. The 128px icon is
    // also the store icon: Chrome Web Store asks for 96px of artwork with 16px
    // of transparent padding on each side.
    const inset = size <= 16 ? 0.5 : size === 128 ? 16 : size * 0.04;
    const r = size / 2 - inset;
    const highlight = size >= 32
        ? `<ellipse cx="${size * 0.42}" cy="${size * 0.3}" rx="${size * 0.22}" ry="${size * 0.13}" fill="url(#h)"/>`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a45"/><stop offset="1" stop-color="#fd4602"/></linearGradient>
<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="url(#g)"/>${highlight}</svg>`;
};
const browser = await chromium.launch({ headless: true });
for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${orb(size)}</body></html>`);
    await page.screenshot({ path: `${out}/icon-${size}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
}
await browser.close();
console.log('icons written to', out);
