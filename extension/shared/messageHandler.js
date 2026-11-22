// Worker message handling, kept separate from the browser wiring so it can be
// unit-tested. Only the Reddit content script may ask for data.

import { ARCTIC } from '../../src/archive.js';
import { createPostLookup } from '../../src/postLookup.js';
import { createArchiveService } from './archiveService.js';
import { createArchiveCache } from './cache.js';
import { MESSAGE } from './config.js';

const REDDIT_SENDER = /^https:\/\/(www\.)?reddit\.com\//;
const POST_ID = /^[a-z0-9]+$/i;

const defaultLookup = createPostLookup({ base: ARCTIC });
const defaultCache = createArchiveCache();
export const defaultArchive = createArchiveService({ cache: defaultCache });

function isRedditSender(sender) {
    const url = sender?.url || sender?.tab?.url || '';
    return typeof url === 'string' && REDDIT_SENDER.test(url);
}

// Parent post titles for comment cards. createPostLookup already batches every
// id asked for in the same tick and caches results, so this reuses the website's
// client instead of adding another Arctic request shape.
// Titles already seen are answered from this browser's saved copy, so comment
// headers survive an Arctic Shift outage.
export async function postInfo(ids, lookup = defaultLookup, cache = null) {
    const list = [...new Set((Array.isArray(ids) ? ids : [])
        .filter((id) => typeof id === 'string' && POST_ID.test(id)))]
        .slice(0, 100);
    if (!list.length) return { ok: true, posts: [] };
    const known = cache ? await cache.parents(list).catch(() => []) : [];
    const knownIds = new Set(known.map((post) => post.id));
    const missing = list.filter((id) => !knownIds.has(id));
    const found = (await Promise.all(missing.map((id) => lookup(id).catch(() => null))))
        .filter(Boolean)
        .map((post) => ({ id: post.id, title: post.title, permalink: post.permalink, subreddit: post.subreddit }));
    if (cache && found.length) await cache.addParents(found);
    return {
        ok: true,
        posts: [...known.map(({ id, title, permalink, subreddit }) => ({ id, title, permalink, subreddit })), ...found],
    };
}

export function createMessageHandler({ archive = defaultArchive, lookup = defaultLookup, cache = defaultCache } = {}) {
    return async function handle(message, sender) {
        if (!isRedditSender(sender) || !message || typeof message !== 'object') {
            return { ok: false, items: [] };
        }
        if (message.type === MESSAGE.archivePage) return archive.page(message);
        if (message.type === MESSAGE.postInfo) return postInfo(message.ids, lookup, cache);
        return { ok: false, items: [] };
    };
}
