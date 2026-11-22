import { describe, expect, test, vi } from 'vitest';
import { createArchiveCache, memoryArea } from '../../shared/cache.js';
import { createArchiveService } from '../../shared/archiveService.js';

const ref = (id, t) => ({ kind: 'posts', id, fullname: `t3_${id}`, createdUtc: t, data: { id } });
const row = (id, t) => ({ id, created_utc: t, title: id, author: 'someone', subreddit: 'x', permalink: `/r/x/comments/${id}/s/` });

describe('saved copies', () => {
    test('pages merge newest first without duplicates', async () => {
        const cache = createArchiveCache({ area: memoryArea() });
        await cache.add('Someone', 'posts', [ref('a', 3), ref('b', 2)]);
        await cache.add('someone', 'posts', [ref('b', 2), ref('c', 1)]);
        expect((await cache.get('SOMEONE', 'posts')).items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
        await cache.clear();
        expect(await cache.get('someone', 'posts')).toBeNull();
    });

    test('a successful page is saved and served when the archives fail', async () => {
        const cache = createArchiveCache({ area: memoryArea() });
        let down = false;
        const service = createArchiveService({
            gate: async () => false,
            cache,
            page: async () => (down ? { items: [], arcticDown: true, pullpushDown: true } : { items: [row('a', 300)], arcticDown: false }),
        });
        expect((await service.page({ username: 'someone', kind: 'posts' })).items).toHaveLength(1);
        down = true;
        const fallback = await service.page({ username: 'someone', kind: 'posts' });
        expect(fallback).toMatchObject({ ok: true, cached: true, done: true });
        expect(fallback.items.map((item) => item.id)).toEqual(['a']);
    });

    test('a restricted user is never served a saved copy', async () => {
        const cache = createArchiveCache({ area: memoryArea() });
        await cache.add('someone', 'posts', [ref('a', 3)]);
        const page = vi.fn();
        const service = createArchiveService({ gate: async () => true, cache, page });
        for (const request of [{ cacheOnly: true }, {}]) {
            expect(await service.page({ username: 'someone', kind: 'posts', ...request })).toMatchObject({ restricted: true, items: [] });
        }
        expect(page).not.toHaveBeenCalled();
    });

    test('PullPush is skipped for five minutes after it fails', async () => {
        let clock = 0;
        const calls = [];
        const service = createArchiveService({
            gate: async () => false,
            cache: createArchiveCache({ area: memoryArea() }),
            now: () => clock,
            page: async (options) => { calls.push(options.skipPullpush); return { items: [row('a', 1)], arcticDown: false, pullpushDown: !options.skipPullpush }; },
        });
        await service.page({ username: 'someone', kind: 'posts' });
        clock = 60_000;
        const second = await service.page({ username: 'someone', kind: 'posts' });
        clock = 6 * 60_000;
        await service.page({ username: 'someone', kind: 'posts' });
        expect(calls).toEqual([false, true, false]);
        expect(second.health.pullpush).toBe('paused');
    });
});
