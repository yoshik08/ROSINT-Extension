// Worker side of the signed-out NSFW fallback: Arctic Shift requests for a
// community or a post, and row-by-row removal checks.
import { describe, expect, test, vi } from 'vitest';
import { communityUrl, createCommunityArchive, threadUrl } from '../../shared/communityArchive.js';
import { createMessageHandler } from '../../shared/messageHandler.js';
import { MESSAGE } from '../../shared/config.js';

const post = (id, author, ts, extra = {}) => ({ id, author, created_utc: ts, title: `t ${id}`, subreddit: 'example', permalink: `/r/example/comments/${id}/x/`, over_18: true, ...extra });
const comment = (id, author, ts) => ({ id, author, created_utc: ts, body: `b ${id}`, subreddit: 'example', link_id: 't3_p1', parent_id: 't3_p1', permalink: `/r/example/comments/p1/x/${id}/` });

describe('request URLs', () => {
    test('a community page asks Arctic Shift for its newest posts', () => {
        expect(communityUrl({ subreddit: 'Example_1' })).toBe('https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=Example_1&limit=100&sort=desc');
        expect(communityUrl({ subreddit: 'example', before: 1700000001 })).toMatch(/&before=1700000001$/);
    });

    test('a thread asks for the post by id and its comments by link id', () => {
        expect(threadUrl({ post: 'ABC12', kind: 'posts' })).toBe('https://arctic-shift.photon-reddit.com/api/posts/ids?ids=abc12');
        expect(threadUrl({ post: 'abc12', kind: 'comments', before: 5 })).toBe('https://arctic-shift.photon-reddit.com/api/comments/search?link_id=abc12&limit=100&sort=desc&before=5');
    });
});

describe('community pages', () => {
    test('rows become refs, newest first, and a short page ends the feed', async () => {
        const fetchPage = vi.fn(async () => ({ ok: true, data: [post('a', 'one', 300), post('b', 'two', 200)] }));
        const archive = createCommunityArchive({ gate: async () => false, fetchPage });
        const result = await archive.community({ subreddit: 'example' });
        expect(fetchPage).toHaveBeenCalledWith(communityUrl({ subreddit: 'example' }));
        expect(result).toMatchObject({ ok: true, restricted: false, done: true, health: { arctic: true } });
        expect(result.items.map((ref) => ref.fullname)).toEqual(['t3_a', 't3_b']);
        expect(result.items[0].data.over_18).toBe(true);
    });

    test('rows by an author on the removal list never leave the worker; each author is checked once', async () => {
        const gate = vi.fn(async (name) => name === 'removed');
        const archive = createCommunityArchive({
            gate,
            fetchPage: async () => ({ ok: true, data: [post('a', 'Removed', 3), post('b', 'kept', 2), post('c', 'removed', 1), post('d', '[deleted]', 1)] }),
        });
        const result = await archive.community({ subreddit: 'example' });
        expect(result.items.map((ref) => ref.id)).toEqual(['b', 'd']);
        expect(gate.mock.calls.map(([name]) => name).sort()).toEqual(['kept', 'removed']);
    });

    test('when the removal check cannot be confirmed nothing is shown, and the page says so', async () => {
        const archive = createCommunityArchive({
            gate: async () => { throw new Error('removal service down'); },
            fetchPage: async () => ({ ok: true, data: [post('a', 'one', 3)] }),
        });
        expect(await archive.community({ subreddit: 'example' })).toMatchObject({ ok: true, restricted: true, items: [] });
    });

    test('a full page asks for more; an archive failure is reported, not hidden', async () => {
        const full = Array.from({ length: 3 }, (_, i) => post(`p${i}`, 'a', 100 - i));
        const archive = createCommunityArchive({ gate: async () => false, fetchPage: async () => ({ ok: true, data: full }), pageSize: 3 });
        expect((await archive.community({ subreddit: 'example' })).done).toBe(false);
        const down = createCommunityArchive({ gate: async () => false, fetchPage: async () => ({ ok: false, data: [] }) });
        expect(await down.community({ subreddit: 'example' })).toMatchObject({ ok: false, items: [], health: { arctic: false } });
    });

    test('malformed names never reach the network', async () => {
        const fetchPage = vi.fn();
        const archive = createCommunityArchive({ gate: async () => false, fetchPage });
        for (const subreddit of ['', 'a', 'has space', 'x'.repeat(22), '../etc', 'r/example']) {
            expect((await archive.community({ subreddit })).ok).toBe(false);
        }
        expect((await archive.thread({ post: 'abc', kind: 'videos' })).ok).toBe(false);
        expect((await archive.thread({ post: 'a/b', kind: 'posts' })).ok).toBe(false);
        expect(fetchPage).not.toHaveBeenCalled();
    });
});

describe('threads', () => {
    test('the post is a single answer; comments page like any feed', async () => {
        const fetchPage = vi.fn(async (url) => (url.includes('/posts/ids')
            ? { ok: true, data: [post('p1', 'op', 100)] }
            : { ok: true, data: [comment('c2', 'two', 300), comment('c1', 'one', 200)] }));
        const archive = createCommunityArchive({ gate: async () => false, fetchPage });
        expect(await archive.thread({ post: 'p1', kind: 'posts' })).toMatchObject({ ok: true, done: true, items: [{ fullname: 't3_p1' }] });
        const comments = await archive.thread({ post: 'p1', kind: 'comments' });
        expect(comments.items.map((ref) => ref.fullname)).toEqual(['t1_c2', 't1_c1']);
        expect(comments.done).toBe(true);
    });
});

describe('message routing', () => {
    test('only reddit.com content scripts can ask for a community or a thread', async () => {
        const community = { community: vi.fn(async () => ({ ok: true, items: [] })), thread: vi.fn(async () => ({ ok: true, items: [] })) };
        const handle = createMessageHandler({ archive: { page: vi.fn() }, lookup: vi.fn(), cache: null, community });
        const reddit = { url: 'https://www.reddit.com/r/example/' };
        await handle({ type: MESSAGE.communityPage, subreddit: 'example' }, reddit);
        await handle({ type: MESSAGE.threadPage, post: 'p1', kind: 'comments' }, reddit);
        expect(community.community).toHaveBeenCalledTimes(1);
        expect(community.thread).toHaveBeenCalledTimes(1);
        expect(await handle({ type: MESSAGE.communityPage, subreddit: 'example' }, { url: 'https://evil.example/' })).toEqual({ ok: false, items: [] });
        expect(community.community).toHaveBeenCalledTimes(1);
    });
});
