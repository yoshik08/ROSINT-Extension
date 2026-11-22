// Store-readiness checks on both manifests. A host missing here is invisible
// in unit tests (they stub the network) but breaks every real lookup.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REQUIRED_ORIGINS } from '../../shared/connection.js';

const root = resolve(import.meta.dirname, '../..');
const read = (target) => JSON.parse(readFileSync(resolve(root, target, 'manifest.json'), 'utf8'));
const chrome = read('chrome');
const firefox = read('firefox');

describe.each([['chrome', chrome], ['firefox', firefox]])('%s manifest', (target, manifest) => {
    test('declares every host the worker and popup check for', () => {
        for (const origin of REQUIRED_ORIGINS) expect(manifest.host_permissions).toContain(origin);
    });

    test('asks for nothing beyond storage and the four hosts', () => {
        expect(manifest.permissions).toEqual(['storage']);
        expect(manifest.host_permissions).toHaveLength(REQUIRED_ORIGINS.length);
        expect(manifest.optional_permissions).toBeUndefined();
    });

    test('runs the content script on reddit.com only', () => {
        expect(manifest.content_scripts.map((script) => script.matches)).toEqual([['*://www.reddit.com/*']]);
    });

    test('fits store limits', () => {
        expect(manifest.manifest_version).toBe(3);
        expect(manifest.name.length).toBeLessThanOrEqual(45);
        expect(manifest.short_name.length).toBeLessThanOrEqual(12);
        expect(manifest.description.length).toBeLessThanOrEqual(132);
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(manifest.homepage_url).toMatch(/^https:\/\//);
    });

    test('every icon it names exists in shared assets', () => {
        const icons = [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
        for (const icon of icons) expect(existsSync(resolve(root, 'shared', icon)), icon).toBe(true);
    });

    test('loads no remote code', () => {
        expect(JSON.stringify(manifest)).not.toMatch(/content_security_policy|externally_connectable|web_accessible_resources/);
    });
});

test('both browsers ship the same version, name and description', () => {
    expect(firefox.version).toBe(chrome.version);
    expect(firefox.name).toBe(chrome.name);
    expect(firefox.description).toBe(chrome.description);
});

test('Firefox declares what leaves the browser', () => {
    // The visited profile's username is sent to the public archives.
    expect(firefox.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(['browsingActivity']);
    expect(firefox.browser_specific_settings.gecko.id).toMatch(/@/);
});

test('shared sources contain no HTML sinks or dynamic code', () => {
    const files = ['content.js', 'injector.js', 'feedView.js', 'visibleCard.js', 'markdown.js', 'nativeFeed.js', 'popup.js', 'background.js'];
    for (const file of files) {
        const source = readFileSync(resolve(root, 'shared', file), 'utf8');
        expect(source, file).not.toMatch(/\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
    }
});
