// Worker side of the signed-out NSFW fallback. Reddit answers "community not
// found" to signed-out viewers of many adult communities and their posts, so
// the content script asks for Arctic Shift's copy instead: a community's posts
// newest first, or one post and its comments.
//
// Restrictions still apply row by row: any post or comment whose author asked
// to be removed is dropped before it leaves the worker. The removal check
// fails closed, so when it cannot be confirmed every row is dropped and the
// page says so instead of showing anything.

import { ARCTIC, LIMIT, safeFetch } from '../../src/archive.js';
import { toRef } from './pagination.js';
import { createRestrictionGate } from './restrictions.js';

export const SUBREDDIT_NAME = /^[A-Za-z0-9_]{2,21}$/;
export const THREAD_ID = /^[a-z0-9]{1,16}$/i;
const COMMUNITY_TIMEOUT_MS = 15000;

export function communityUrl({ subreddit, before = null, pageSize = LIMIT }) {
    const query = [`subreddit=${encodeURIComponent(subreddit)}`, `limit=${pageSize}`, 'sort=desc'];
    if (Number.isFinite(before) && before > 0) query.push(`before=${before}`);
    return `${ARCTIC}/api/posts/search?${query.join('&')}`;
}

export function threadUrl({ post, kind, before = null, pageSize = LIMIT }) {
    if (kind === 'posts') return `${ARCTIC}/api/posts/ids?ids=${encodeURIComponent(post.toLowerCase())}`;
    const query = [`link_id=${encodeURIComponent(post.toLowerCase())}`, `limit=${pageSize}`, 'sort=desc'];
    if (Number.isFinite(before) && before > 0) query.push(`before=${before}`);
    return `${ARCTIC}/api/comments/search?${query.join('&')}`;
}

export function createCommunityArchive({
    gate = createRestrictionGate(),
    fetchPage = (url) => safeFetch(url, { timeoutMs: COMMUNITY_TIMEOUT_MS, retryTimeouts: true }),
    pageSize = LIMIT,
} = {}) {
    // Drops every row by an author on the removal list. Authors are checked
    // once each; the removal list itself is fetched once and reused.
    async function withoutRemoved(items) {
        const authors = [...new Set(items
            .map((item) => item?.author)
            .filter((author) => typeof author === 'string' && author && author !== '[deleted]')
            .map((author) => author.toLowerCase()))];
        const verdicts = await Promise.all(authors.map(async (author) => [author, await gate(author).catch(() => true)]));
        const removed = new Set(verdicts.filter(([, blocked]) => blocked).map(([author]) => author));
        return items.filter((item) => !removed.has(String(item?.author || '').toLowerCase()));
    }

    async function load(kind, url, single) {
        let result;
        try {
            result = await fetchPage(url);
        } catch {
            result = { ok: false, data: [] };
        }
        const health = { arctic: Boolean(result?.ok) };
        if (!result?.ok) return { ok: false, items: [], done: true, health };
        const raw = Array.isArray(result.data) ? result.data : [];
        const kept = await withoutRemoved(raw);
        const items = kept.map((item) => toRef(kind, item)).filter(Boolean);
        return {
            ok: true,
            // Rows existed but none may be shown: say so rather than "empty".
            restricted: raw.length > 0 && kept.length === 0,
            items,
            done: single || raw.length < pageSize,
            health,
        };
    }

    return {
        async community(request = {}) {
            const subreddit = String(request.subreddit || '');
            if (!SUBREDDIT_NAME.test(subreddit)) return { ok: false, items: [], done: true };
            const before = Number(request.before);
            return load('posts', communityUrl({ subreddit, before: Number.isFinite(before) ? before : null, pageSize }), false);
        },
        async thread(request = {}) {
            const post = String(request.post || '');
            const kind = request.kind;
            if (!THREAD_ID.test(post) || (kind !== 'posts' && kind !== 'comments')) return { ok: false, items: [], done: true };
            const before = Number(request.before);
            return load(kind, threadUrl({ post, kind, before: Number.isFinite(before) ? before : null, pageSize }), kind === 'posts');
        },
    };
}
