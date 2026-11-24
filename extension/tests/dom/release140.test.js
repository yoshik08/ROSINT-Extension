// @vitest-environment happy-dom
// 1.4.0: the Quiet Reddit setting, NSFW media in restored rows, and fixes
// found in the release pass.
import { describe, expect, test, vi } from 'vitest';
import { onQuietChange, QUIET_KEY, readQuiet, writeQuiet } from '../../shared/settings.js';
import { fillVisibleCard } from '../../shared/visibleCard.js';
import { createOrder } from '../../shared/sort.js';
import { createInfoClient } from '../../shared/reddit.js';
import { createFeedView } from '../../shared/feedView.js';
import { createInjector } from '../../shared/injector.js';

function fakeApi(initial = {}) {
    const store = { ...initial };
    const listeners = new Set();
    return {
        store,
        storage: {
            local: {
                get: async (key) => (Object.hasOwn(store, key) ? { [key]: store[key] } : {}),
                set: async (values) => {
                    const changes = {};
                    for (const [key, value] of Object.entries(values)) {
                        changes[key] = { oldValue: store[key], newValue: value };
                        store[key] = value;
                    }
                    for (const listener of listeners) listener(changes, 'local');
                },
            },
            onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
        },
    };
}

describe('Quiet Reddit setting', () => {
    test('is on unless the viewer turned it off, and survives broken storage', async () => {
        expect(await readQuiet(fakeApi())).toBe(true);
        expect(await readQuiet(fakeApi({ [QUIET_KEY]: false }))).toBe(false);
        expect(await readQuiet({ storage: { local: { get: async () => { throw new Error('quota'); } } } })).toBe(true);
        expect(await readQuiet(undefined)).toBe(true);
    });

    test('flipping the switch reaches every open tab', async () => {
        const api = fakeApi();
        const seen = [];
        const stop = onQuietChange((on) => seen.push(on), api);
        await writeQuiet(false, api);
        await writeQuiet(true, api);
        await api.storage.local.set({ unrelated: 1 });
        stop();
        await writeQuiet(false, api);
        expect(seen).toEqual([false, true]);
        expect(api.store[QUIET_KEY]).toBe(false);
    });
});

describe('NSFW media in restored rows', () => {
    const data = { id: 'p1', name: 't3_p1', title: 'x', author: 'a', subreddit: 'example', created_utc: 1700000000, permalink: '/r/example/comments/p1/x/', over_18: true, spoiler: false, images: [{ url: 'https://i.redd.it/p1.jpg' }] };
    const card = (options) => {
        const host = document.createElement('article');
        fillVisibleCard(host, 'posts', { kind: 'posts', data }, { doc: document, parent: null, now: 1700000100000, ...options });
        return host.shadowRoot;
    };

    test('stays behind a click by default', () => {
        expect(card({}).querySelector('.media.veiled .veil')).not.toBeNull();
    });

    test('is shown as is with Quiet Reddit for a signed-out viewer; spoilers keep their veil', () => {
        expect(card({ revealNsfw: true }).querySelector('.veil')).toBeNull();
        data.spoiler = true;
        data.over_18 = false;
        expect(card({ revealNsfw: true }).querySelector('.veil')).not.toBeNull();
    });
});

describe('fixes', () => {
    test('createOrder without a clock no longer hides every row', () => {
        // `now` defaulted to the Date.now function, so the cutoff was NaN and
        // every row failed the range check.
        const order = createOrder({ mode: 'top', range: 'day' });
        expect(order.inRange({ createdUtc: Date.now() / 1000 - 60 })).toBe(true);
        expect(order.inRange({ createdUtc: Date.now() / 1000 - 3 * 86400 })).toBe(false);
    });

    test('a signed-out viewer’s refused live lookup is not repeated for every page', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null } }));
        let clock = 0;
        const info = createInfoClient({ fetchImpl, now: () => clock, wait: async () => {} });
        await expect(info(['t3_a'])).rejects.toThrow();
        await expect(info(['t3_b'])).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        clock += 6 * 60 * 1000;
        await expect(info(['t3_c'])).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('a first page that does not fill the screen asks the observer again instead of stalling', async () => {
        document.body.innerHTML = '<main><shreddit-feed id="main-feed"><div id="empty-state">Nothing here yet</div></shreddit-feed></main>';
        const calls = [];
        const child = { kind: 't3', data: { id: 'p1', name: 't3_p1', author: 'x', created_utc: 1700000000, subreddit: 'pics', permalink: '/r/pics/comments/p1/x/', title: 't', selftext: 'hi', score: 1, num_comments: 0 } };
        const injector = createInjector({
            doc: document,
            win: { location: { search: '', pathname: '/' }, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout },
            archive: async ({ cacheOnly }) => (cacheOnly
                ? { ok: true, restricted: false, items: [], cached: false }
                : { ok: true, restricted: false, items: [{ kind: 'posts', id: 'p1', fullname: 't3_p1', createdUtc: 1700000000, data: child.data }], done: false }),
            info: async () => [child],
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe: () => calls.push('observe'), unobserve: () => calls.push('unobserve'), disconnect: () => calls.push('disconnect') }),
        });
        await injector.start({ username: 'someone', tab: 'posts' });
        expect(document.querySelectorAll('[data-rosint-item]')).toHaveLength(1);
        expect(calls).toEqual(['observe', 'unobserve', 'observe']);
        injector.stop();
    });

    test('a Top filter that hides every new row does not keep paging by itself', async () => {
        document.body.innerHTML = '<main><shreddit-feed id="main-feed"><div id="empty-state">Nothing here yet</div></shreddit-feed></main>';
        const calls = [];
        // Years old, so Top / past hour hides it.
        const child = { kind: 't3', data: { id: 'old', name: 't3_old', author: 'x', created_utc: 1500000000, subreddit: 'pics', permalink: '/r/pics/comments/old/x/', title: 't', selftext: 'hi', score: 1, num_comments: 0 } };
        const injector = createInjector({
            doc: document,
            win: { location: { search: '?sort=top&t=hour', pathname: '/' }, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout },
            archive: async ({ cacheOnly }) => (cacheOnly
                ? { ok: true, restricted: false, items: [], cached: false }
                : { ok: true, restricted: false, items: [{ kind: 'posts', id: 'old', fullname: 't3_old', createdUtc: 1500000000, data: child.data }], done: false }),
            info: async () => [child],
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe: () => calls.push('observe'), unobserve: () => calls.push('unobserve'), disconnect: () => calls.push('disconnect') }),
        });
        await injector.start({ username: 'someone', tab: 'posts' });
        expect(document.querySelector('[data-rosint-item]').hidden).toBe(true);
        expect(calls).toEqual(['observe']);
        injector.stop();
    });

    test('a profile feed header still links to Rosint’s search; the archive fallback does not', () => {
        const profile = createFeedView({ doc: document, username: 'someone', tab: 'overview' });
        expect(profile.header.shadowRoot.textContent).toContain('Open in Rosint');
        expect(profile.header.shadowRoot.textContent).toContain('Searching public archives for u/someone');
        const community = createFeedView({ doc: document, tab: 'posts', scope: 'community', name: 'example' });
        expect(community.header.shadowRoot.textContent).not.toContain('Open in Rosint');
        expect(community.header.shadowRoot.textContent).toContain('Loading r/example from the archive');
    });
});
