// Turns /api/info.json children into renderable live items, dropping exactly
// what Reddit stops listing: deleted authors, author-deleted text, mod-removed
// items and anything carrying removed_by_category. Edited items stay, with the
// current text, because Reddit still lists them.

import { fullnameOf } from './pagination.js';

const GONE_TEXT = new Set(['[deleted]', '[removed]']);

function isGoneText(text) {
    return typeof text === 'string' && GONE_TEXT.has(text.trim());
}

export function isVisibleChild(child) {
    if (!child || (child.kind !== 't3' && child.kind !== 't1')) return false;
    const data = child.data;
    if (!data || typeof data.id !== 'string') return false;
    if (data.author === '[deleted]') return false;
    if (data.removed_by_category) return false;
    if (child.kind === 't3') {
        if (data.removed) return false;
        if (isGoneText(data.selftext)) return false;
    } else {
        if (data.removed) return false;
        if (data.body == null || isGoneText(data.body)) return false;
    }
    return true;
}

export function hydrateChild(child) {
    if (!isVisibleChild(child)) return null;
    const kind = child.kind === 't3' ? 'posts' : 'comments';
    const data = child.data;
    const createdUtc = Number(data.created_utc) || 0;
    return {
        kind,
        id: data.id,
        fullname: typeof data.name === 'string' ? data.name : fullnameOf(kind, data.id),
        createdUtc,
        score: Number(data.score) || 0,
        data,
    };
}

// Children arrive in request order, not profile order, so sort them back to
// newest-first and drop duplicates by fullname.
export function hydrateChildren(children) {
    const seen = new Set();
    const out = [];
    for (const child of children || []) {
        const item = hydrateChild(child);
        if (!item || seen.has(item.fullname)) continue;
        seen.add(item.fullname);
        out.push(item);
    }
    return out.sort((a, b) => b.createdUtc - a.createdUtc);
}

// A parent post title powers the native "commented in r/x" header on comment
// cards. Missing parents (removed posts) simply leave the header as Reddit
// renders it for a comment whose post is unavailable.
export function parentTitlesFrom(posts) {
    const titles = new Map();
    for (const post of posts || []) {
        if (typeof post?.id === 'string' && typeof post.title === 'string') {
            titles.set(post.id, post);
        }
    }
    return titles;
}
