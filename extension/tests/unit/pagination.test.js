import { describe, expect, test } from 'vitest';
import { cursorAfter, fullnameOf, interleave, mergeRefs, toRef } from '../../shared/pagination.js';
import { createOrder, hotRank, orderItems, readSort } from '../../shared/sort.js';

const ref = (kind, id, createdUtc) => toRef(kind, { id, created_utc: createdUtc });

// Replays the content script's paging loop against an archive that honours the
// same exclusive `before` contract as Arctic Shift and PullPush.
function readAll(dataset, pageSize, maxPages = 20) {
    const sorted = [...dataset].sort((a, b) => b.createdUtc - a.createdUtc);
    let before = null;
    let pages = 0;
    const rows = [];
    while (pages < maxPages) {
        const page = sorted.filter((item) => before == null || item.createdUtc < before).slice(0, pageSize);
        if (!page.length) break;
        pages += 1;
        rows.push(...page);
        const next = cursorAfter(page, before);
        if (next == null) break;
        before = next;
    }
    return { rows: mergeRefs(rows), pages };
}

describe('timestamp pagination', () => {
    test('pages cover the whole history with no gaps or repeats', () => {
        const dataset = [100, 90, 80, 70, 60, 50].map((ts, index) => ref('posts', `p${index}`, ts));
        const { rows, pages } = readAll(dataset, 3);
        // The inclusive boundary re-reads one row per page; dedupe keeps the
        // feed gap-free, and the run still ends as soon as the archive is done.
        expect(pages).toBeLessThanOrEqual(4);
        expect(rows.map((row) => row.fullname)).toEqual(dataset.map((row) => row.fullname));
    });

    test('a boundary shared by several items is re-requested, then deduped', () => {
        // Two items share the oldest second, so a page boundary lands inside
        // that second. The cursor includes it again and dedupe keeps exactly
        // one row per fullname.
        const dataset = [ref('posts', 'a', 300), ref('posts', 'b', 300), ref('posts', 'c', 200), ref('posts', 'd', 100)];
        const { rows, pages } = readAll(dataset, 3);
        expect(rows.map((row) => row.fullname)).toEqual(['t3_a', 't3_b', 't3_c', 't3_d']);
        expect(new Set(rows.map((row) => row.fullname)).size).toBe(4);
        expect(pages).toBeLessThanOrEqual(20);
    });

    test('a timestamp-only archive cannot page inside one second, so the run ends', () => {
        // More than a page's worth of items share one created_utc. Neither
        // archive accepts an offset, so the run stops after re-reading the
        // boundary instead of looping forever; no duplicate rows are emitted.
        const dataset = [ref('posts', 'a', 500), ref('posts', 'b', 500), ref('posts', 'c', 500)];
        const { rows, pages } = readAll(dataset, 2);
        expect(pages).toBeLessThanOrEqual(2);
        expect(new Set(rows.map((row) => row.fullname)).size).toBe(rows.length);
    });

    test('a page that cannot advance ends the run instead of looping', () => {
        const stuck = [ref('posts', 'a', 500), ref('posts', 'b', 500)];
        expect(cursorAfter(stuck, 501)).toBeNull();
        expect(cursorAfter([], 500)).toBeNull();
        expect(cursorAfter(stuck)).toBe(501);
    });

    test('overview interleaves posts and comments by timestamp', () => {
        const posts = [ref('posts', 'p1', 300), ref('posts', 'p2', 100)];
        const comments = [ref('comments', 'c1', 200)];
        expect(interleave(posts, comments).map((row) => row.fullname)).toEqual(['t3_p1', 't1_c1', 't3_p2']);
    });

    test('archive rows are validated before they become feed items', () => {
        expect(toRef('posts', { id: 'abc', created_utc: 5 })).toMatchObject({ kind: 'posts', id: 'abc', fullname: 't3_abc', createdUtc: 5 });
        expect(toRef('comments', { id: 'abc', created_utc: 5 }).fullname).toBe('t1_abc');
        expect(toRef('posts', { id: 'a,b', created_utc: 5 })).toBeNull();
        expect(toRef('posts', { id: 'abc' })).toBeNull();
        expect(fullnameOf('comments', 'xyz')).toBe('t1_xyz');
    });
});

describe('sort modes', () => {
    const items = [
        { fullname: 't3_old-high', createdUtc: 1000, score: 500 },
        { fullname: 't3_new-low', createdUtc: 9000, score: 1 },
        { fullname: 't3_mid', createdUtc: 5000, score: 50 },
    ];

    test('new is created_utc descending', () => {
        expect(orderItems(items, { mode: 'new' }).map((item) => item.fullname))
            .toEqual(['t3_new-low', 't3_mid', 't3_old-high']);
    });

    test('top is score descending and honours the time filter', () => {
        expect(orderItems(items, { mode: 'top', range: 'all' }).map((item) => item.fullname))
            .toEqual(['t3_old-high', 't3_mid', 't3_new-low']);
        const now = 5_600_000;
        const recent = orderItems(items, { mode: 'top', range: 'hour', now });
        expect(recent.map((item) => item.fullname)).toEqual(['t3_mid', 't3_new-low']);
        const order = createOrder({ mode: 'top', range: 'hour', now });
        expect(order.inRange(items[0])).toBe(false);
        expect(order.inRange(items[2])).toBe(true);
    });

    test('hot prefers higher scores and newer items', () => {
        expect(hotRank(100, 0) - hotRank(1, 0)).toBeCloseTo(2, 6);
        expect(hotRank(1, 45000) - hotRank(1, 0)).toBeCloseTo(1, 6);
        const hot = orderItems([
            { fullname: 't3_a', createdUtc: 1000, score: 10 },
            { fullname: 't3_b', createdUtc: 30_000, score: 10 },
            { fullname: 't3_c', createdUtc: 1000, score: 1000 },
        ], { mode: 'hot' });
        expect(hot.map((item) => item.fullname)).toEqual(['t3_c', 't3_b', 't3_a']);
    });

    test('the dropdown state is read from the profile URL', () => {
        expect(readSort('?sort=top&t=week')).toEqual({ mode: 'top', range: 'week' });
        expect(readSort('?sort=hot')).toEqual({ mode: 'hot', range: 'all' });
        expect(readSort('')).toEqual({ mode: 'new', range: 'all' });
        expect(readSort('?sort=top&t=forever')).toEqual({ mode: 'top', range: 'all' });
        expect(readSort('?sort=unknown')).toEqual({ mode: 'new', range: 'all' });
    });
});
