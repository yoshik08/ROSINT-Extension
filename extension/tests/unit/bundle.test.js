// The build's classic-script bundles. Both content scripts run in the same
// isolated world, so they must be able to load one after the other.
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { bundle, entries } from '../../scripts/build.mjs';

const built = Object.fromEntries(entries.map((entry) => [entry.file, bundle(entry.entry).code]));

describe('bundles', () => {
    test('every entry is wrapped in its own function scope', () => {
        for (const [file, code] of Object.entries(built)) {
            expect(code.split('\n')[1], file).toBe('(() => {');
            expect(code.trimEnd().endsWith('})();'), file).toBe(true);
        }
    });

    test('quiet.js and content.js load into one shared world without colliding', () => {
        // No window here, so neither boots; only their declarations run.
        const world = { console, URL, URLSearchParams, setTimeout, clearTimeout, AbortController, TextEncoder };
        expect(() => runInNewContext(`${built['quiet.js']}\n${built['content.js']}`, world)).not.toThrow();
        // Loading the same script twice (an extension update) is safe too.
        expect(() => runInNewContext(`${built['content.js']}\n${built['content.js']}`, { ...world })).not.toThrow();
    });
});
