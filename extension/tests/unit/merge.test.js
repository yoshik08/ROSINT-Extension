import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchArchivePage, mergeArchiveItems } from '../../../src/archive.js';

const post = (id, created) => ({ id, created_utc: created, author: 'somebody' });

describe('two-archive merge', () => {
    test('keeps one row per id and sorts newest first', () => {
        const merged = mergeArchiveItems(
            [post('a', 100), post('b', 300)],
            [post('b', 300), post('c', 200)],
        );
        expect(merged.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    });

    test('ignores rows without an id', () => {
        const merged = mergeArchiveItems([{ created_utc: 10 }, post('a', 5)], [null]);
        expect(merged.map((item) => item.id)).toEqual(['a']);
    });
});

describe('fetchArchivePage', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('asks both archives for the same timestamp page and merges the answers', async () => {
        const calls = [];
        vi.stubGlobal('fetch', async (url) => {
            calls.push(url);
            if (url.includes('arctic-shift')) {
                return Response.json({ data: [post('b', 200), post('a', 100)] });
            }
            return Response.json({ data: [post('b', 200), post('c', 150)] });
        });

        const result = await fetchArchivePage({
            username: 'somebody',
            type: 'posts',
            pagination: { before: 12345 },
        });

        expect(calls).toHaveLength(2);
        expect(calls.every((url) => url.includes('before=12345'))).toBe(true);
        expect(calls.every((url) => url.includes('author=somebody'))).toBe(true);
        expect(result.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
        expect(result.sources).toEqual(['Arctic Shift', 'PullPush']);
        expect(result.arcticDown).toBe(false);
    });

    test('a comment page requests comment endpoints', async () => {
        const calls = [];
        vi.stubGlobal('fetch', async (url) => {
            calls.push(url);
            return Response.json({ data: [] });
        });
        await fetchArchivePage({ username: 'somebody', type: 'comments' });
        expect(calls.some((url) => url.includes('/api/comments/search'))).toBe(true);
        expect(calls.some((url) => url.includes('/reddit/search/comment/'))).toBe(true);
    });

    test('restrictions are checked before any archive request', async () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        const result = await fetchArchivePage({
            username: 'somebody',
            type: 'posts',
            isBlocked: async () => true,
        });
        expect(result).toMatchObject({ items: [], restricted: true });
        expect(fetcher).not.toHaveBeenCalled();
    });

    test('either archive alone can answer a page', async () => {
        vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
        const down = await fetchArchivePage({ username: 'somebody', type: 'posts' });
        expect(down.items).toEqual([]);
        expect(down.arcticDown).toBe(true);
    });
});
