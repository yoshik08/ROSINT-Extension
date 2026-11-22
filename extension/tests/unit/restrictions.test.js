import { describe, expect, test, vi } from 'vitest';
import { createArchiveService } from '../../shared/archiveService.js';
import { createRestrictionGate } from '../../shared/restrictions.js';
import { createMessageHandler, postInfo } from '../../shared/messageHandler.js';
import { MESSAGE } from '../../shared/config.js';
import { hashUsername } from '../../../src/restrictions.js';

const origin = 'https://removal.test';
const blockedName = 'blocked-person';
const allowedName = 'allowed-person';

const json = (body, init = {}) => Response.json(body, init);
const archivePage = (items) => vi.fn(async () => ({ items, sources: ['Arctic Shift'], arcticDown: false }));

function service({ config, blocklist }, onArchive) {
    const fetcher = vi.fn(async (url) => {
        if (url === `${origin}/api/config`) return config();
        if (url === `${origin}/api/blocklist`) return blocklist();
        throw new Error(`unexpected ${url}`);
    });
    const gate = createRestrictionGate({ origin, fetchImpl: fetcher });
    return {
        archive: createArchiveService({ gate, page: onArchive }),
        onArchive,
        fetcher,
    };
}

describe('restriction gate', () => {
    test('a restricted user gets zero items and never reaches the archive', async () => {
        const blockedHash = await hashUsername(blockedName);
        const page = archivePage([{ id: 'abc', created_utc: 1_700_000_000 }]);
        const { archive } = service({
            config: () => json({ featuresEnabled: true }),
            blocklist: () => json({ hashes: [blockedHash] }),
        }, page);

        const result = await archive.page({ username: blockedName, kind: 'posts' });

        expect(result.items).toEqual([]);
        expect(result.restricted).toBe(true);
        expect(page).not.toHaveBeenCalled();
    });

    test('an allowed user reaches the archive and gets items', async () => {
        const blockedHash = await hashUsername(blockedName);
        const page = archivePage([
            { id: 'abc', created_utc: 1_700_000_300 },
            { id: 'def', created_utc: 1_700_000_200 },
        ]);
        const { archive } = service({
            config: () => json({ featuresEnabled: true }),
            blocklist: () => json({ hashes: [blockedHash] }),
        }, page);

        const result = await archive.page({ username: allowedName, kind: 'posts' });

        expect(result.ok).toBe(true);
        expect(result.restricted).toBe(false);
        expect(result.items.map((item) => item.fullname)).toEqual(['t3_abc', 't3_def']);
        expect(result.done).toBe(true);
        expect(page).toHaveBeenCalledWith(expect.objectContaining({ username: allowedName, type: 'posts' }));
    });

    test.each([
        ['service returning 500', () => json({ error: 'unavailable' }, { status: 500 })],
        ['malformed config', () => json({})],
        ['non-JSON response', () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })],
    ])('fails closed when the service is unavailable: %s', async (_label, config) => {
        const page = archivePage([{ id: 'abc', created_utc: 1_700_000_000 }]);
        const { archive, fetcher } = service({
            config,
            blocklist: () => json({ hashes: [] }),
        }, page);

        const result = await archive.page({ username: allowedName, kind: 'comments' });

        expect(result.items).toEqual([]);
        expect(page).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalled();
    });

    test('a malformed blocklist fails closed', async () => {
        const page = archivePage([{ id: 'abc', created_utc: 1_700_000_000 }]);
        const { archive } = service({
            config: () => json({ featuresEnabled: true }),
            blocklist: () => json({ hashes: ['not-a-hash'] }),
        }, page);

        expect((await archive.page({ username: allowedName, kind: 'posts' })).items).toEqual([]);
        expect(page).not.toHaveBeenCalled();
    });

    test('a timeout fails closed', async () => {
        const page = archivePage([{ id: 'abc', created_utc: 1_700_000_000 }]);
        const gate = createRestrictionGate({
            origin,
            fetchImpl: async () => { throw new TypeError('network timeout'); },
        });
        const archive = createArchiveService({ gate, page });

        expect((await archive.page({ username: allowedName, kind: 'posts' })).items).toEqual([]);
        expect(page).not.toHaveBeenCalled();
    });

    test('archives that are down leave the page untouched', async () => {
        const gate = createRestrictionGate({
            origin,
            fetchImpl: async (url) => json(url.endsWith('/config') ? { featuresEnabled: false } : { hashes: [] }),
        });
        const broken = vi.fn(async () => ({ items: [], sources: [], arcticDown: true }));
        const result = await createArchiveService({ gate, page: broken }).page({ username: allowedName, kind: 'posts' });
        expect(result.ok).toBe(false);
        expect(result.items).toEqual([]);
    });

describe('worker messages', () => {
    test('only the Reddit content script may ask for data', async () => {
        const page = vi.fn(async () => ({
            ok: true,
            items: [{ fullname: 't3_a', id: 'a', kind: 'posts', createdUtc: 1 }],
            done: true,
        }));
        const handle = createMessageHandler({ archive: { page }, lookup: vi.fn() });

        const fromReddit = await handle(
            { type: MESSAGE.archivePage, username: allowedName, kind: 'posts' },
            { url: 'https://www.reddit.com/user/allowed-person' },
        );
        expect(fromReddit.items).toHaveLength(1);

        const fromElsewhere = await handle(
            { type: MESSAGE.archivePage, username: allowedName, kind: 'posts' },
            { url: 'https://evil.example/user/allowed-person' },
        );
        expect(fromElsewhere.ok).toBe(false);
        expect(page).toHaveBeenCalledTimes(1);

        expect(await handle(null, { url: 'https://www.reddit.com/' })).toEqual({ ok: false, items: [] });
        expect(await handle({ type: 'unknown' }, { url: 'https://www.reddit.com/' })).toEqual({ ok: false, items: [] });
    });

    test('invalid archive requests never reach the archive client', async () => {
        const page = vi.fn(async () => ({ items: [], sources: [], arcticDown: false }));
        const archive = createArchiveService({ gate: async () => false, page });

        expect((await archive.page({ username: '', kind: 'posts' })).ok).toBe(false);
        expect((await archive.page({ username: allowedName, kind: 'saved' })).ok).toBe(false);
        // A pasted URL/path collapses to a name, but anything left that is not a
        // Reddit username (here "..") is refused before the archive sees it.
        expect((await archive.page({ username: 'u/../etc/passwd', kind: 'posts' })).ok).toBe(false);
        expect(page).not.toHaveBeenCalled();
        expect((await archive.page({ username: `https://www.reddit.com/user/${allowedName}/`, kind: 'comments' })).ok).toBe(true);
        expect(page).toHaveBeenCalledTimes(1);
        expect(page.mock.calls[0][0].username).toBe(allowedName);
    });
});

describe('parent post titles', () => {
    test('looks up each valid post id once and drops misses', async () => {
        const lookup = vi.fn(async (id) => (id === 'missing'
            ? null
            : { id, title: `title ${id}`, permalink: `/p/${id}`, subreddit: 'pics' }));
        const result = await postInfo(['abc', 'abc', 'missing', 'bad id', 42], lookup);
        expect(lookup.mock.calls.map(([id]) => id)).toEqual(['abc', 'missing']);
        expect(result.posts).toEqual([{ id: 'abc', title: 'title abc', permalink: '/p/abc', subreddit: 'pics' }]);
    });
});

});
