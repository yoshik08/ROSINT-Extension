// Feed discovery, visible fallback cards, and Reddit attribute metadata.

import { fillVisibleCard } from './visibleCard.js';

export const POST_TAGS = ['shreddit-post'];
export const COMMENT_TAGS = ['shreddit-profile-comment', 'shreddit-comment'];
export const ITEM_TAGS = [...POST_TAGS, ...COMMENT_TAGS];
export const ITEM_SELECTOR = [...ITEM_TAGS, 'article[data-rosint-item]'].join(',');

export const FEED_SELECTORS = [
    'shreddit-feed#main-feed',
    'shreddit-feed',
    '[data-testid="profile-feed"]',
    'main [role="feed"]',
];

const EMPTY_SELECTORS = [
    '[slot*="empty" i]',
    '[data-testid*="empty" i]',
    '[id*="empty" i]',
    '[class*="empty" i]',
];

const FULLNAME_ATTRS = ['id', 'post-id', 'data-fullname', 'data-post-id', 'thingid', 'thing-id', 'comment-id'];

// Tags of the profile's feed tabs. Anything else (/user/x/comments/<id>/... or
// saved/upvoted) is not a profile overview feed and is left alone.
const TAB_SEGMENTS = {
    '': 'overview',
    overview: 'overview',
    submitted: 'posts',
    posts: 'posts',
    comments: 'comments',
};

export function parseProfilePath(pathname) {
    const match = /^\/(?:user|u)\/([^/]+)(?:\/([^/]*))?\/?$/i.exec(pathname || '');
    if (!match) return null;
    // decodeURIComponent can throw on malformed input; treat it as not-a-profile.
    let username;
    try {
        username = decodeURIComponent(match[1]);
    } catch {
        return null;
    }
    if (!username) return null;
    const segment = (match[2] || '').toLowerCase();
    const tab = TAB_SEGMENTS[segment];
    if (!tab) return null;
    return { username, tab };
}

export function findFeed(doc = document) {
    const hidden = findHiddenPanel(doc);
    if (hidden) return hidden;
    for (const selector of FEED_SELECTORS) {
        const feed = doc.querySelector(selector);
        if (feed) return feed;
    }
    // Hidden profiles can omit shreddit-feed entirely. Use only the explicit
    // hidden-history panel, never the whole main element (which holds tabs).
    return findHiddenPanel(doc);
}

const HIDDEN_NOTICE = /likes to keep their (?:posts|comments|activity|history) hidden/i;

export function findHiddenPanel(doc = document) {
    // One text read per main region first: almost every page has no notice,
    // and this runs on DOM changes while a profile is waiting for its feed.
    const regions = [...doc.querySelectorAll('main, #main-content, [role="main"]')];
    if (!regions.some((region) => HIDDEN_NOTICE.test(region.textContent || ''))) return null;
    for (const element of doc.querySelectorAll('main *, #main-content *, [role="main"] *')) {
        if (element.closest('[data-rosint-item]')) continue;
        if (!HIDDEN_NOTICE.test(element.textContent || '')) continue;
        if ([...element.children].some((child) => HIDDEN_NOTICE.test(child.textContent || ''))) continue;
        // Keep the welcome illustration and heading with the message, while
        // avoiding ancestors that also contain profile navigation.
        let panel = element;
        for (let i = 0; i < 30 && panel.parentElement; i += 1) {
            const parent = panel.parentElement;
            if (parent.matches('main, #main-content, [role="main"]')
                || parent.querySelector('nav, [role="tab"], [role="tablist"], faceplate-tabgroup, shreddit-feed, shreddit-sort-dropdown, a[href$="/submitted/"], a[href$="/comments/"]')) break;
            panel = parent;
        }
        return panel;
    }
    return null;
}

// Reddit localises the notice text for logged-out viewers ("blendet seine
// Beiträge gern aus", …), so the English pattern above misses it. The notice
// block itself is stable: the profile feed's empty-state container with the
// waving-Snoo illustration. On its own that block could also be a profile
// that simply has no posts, so it is only trusted when Reddit refused the
// JSON check (logged out), where nothing better is available.
const NOTICE_BLOCK = 'shreddit-feed #empty-feed-content';
const NOTICE_CREATIVE = '[data-testid="empty-state-creative"] img[src*="snoo_wave" i]';

export function findNoticeBlock(doc = document) {
    const block = doc.querySelector(NOTICE_BLOCK);
    if (!block || !block.querySelector(NOTICE_CREATIVE)) return null;
    const feed = block.closest('shreddit-feed') || block;
    if (feed.querySelector(POST_TAGS.concat(COMMENT_TAGS).join(','))) return null;
    return block;
}

export function itemsIn(feed) {
    return feed ? [...feed.querySelectorAll(ITEM_SELECTOR)] : [];
}

export function itemFullname(element) {
    const tag = element.tagName.toLowerCase();
    const kind = POST_TAGS.includes(tag) ? 'posts' : 'comments';
    for (const attr of FULLNAME_ATTRS) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        if (/^t[13]_[a-z0-9]+$/i.test(value)) return value.toLowerCase();
        if (/^[a-z0-9]+$/i.test(value)) return `${kind === 'posts' ? 't3' : 't1'}_${value.toLowerCase()}`;
    }
    return null;
}

export function fullnamesIn(feed, { includeInjected = false } = {}) {
    const found = new Set();
    for (const element of itemsIn(feed)) {
        if (!includeInjected && element.hasAttribute('data-rosint-item')) continue;
        const fullname = itemFullname(element);
        if (fullname) found.add(fullname);
    }
    return found;
}

// Reddit renders an empty state inside the feed when it has nothing to list.
// Hide that single block (restoring it on navigation) instead of removing it.
// A feed that already has native items has no empty state to replace.
export function findEmptyState(feed) {
    if (!feed || itemsIn(feed).length > 0) return null;
    if (findHiddenPanel(feed.ownerDocument) === feed) {
        // The panel itself is the container: hide its original children only.
        return null;
    }
    // Reddit's own empty-state container, as a whole (not just its picture).
    const notice = feed.querySelector('#empty-feed-content');
    if (notice) return notice;
    for (const selector of EMPTY_SELECTORS) {
        const candidate = feed.querySelector(selector);
        if (candidate && !candidate.closest('[data-rosint-item]')) return candidate;
    }
    const children = [...feed.children].filter((element) =>
        !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)
        && !element.hasAttribute('data-rosint-sentinel'));
    const visible = children.filter((element) => (element.textContent || '').trim().length > 0);
    return visible.length === 1 ? visible[0] : null;
}

// Known tag names, not a capability check. Rendering does not gate on these.
export function resolveItemTag(kind) {
    return (kind === 'posts' ? POST_TAGS : COMMENT_TAGS)[0];
}

function isoFromSeconds(seconds) {
    const utc = Number(seconds);
    return Number.isFinite(utc) && utc > 0 ? new Date(utc * 1000).toISOString() : null;
}

function absolute(permalink) {
    if (typeof permalink !== 'string' || !permalink.startsWith('/')) return null;
    return `https://www.reddit.com${permalink}`;
}

// Reddit's post-type values, retained as metadata on fallback cards.
export function postTypeOf(data) {
    if (data.is_gallery) return 'gallery';
    if (data.poll_data) return 'poll';
    if (data.is_video) return 'video';
    if (data.is_self) return 'text';
    if (typeof data.post_hint === 'string' && data.post_hint) return data.post_hint;
    if (/\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i.test(data.url_overridden_by_dest || data.url || '')) return 'image';
    return 'link';
}

// Attributes Reddit's profile feed sets on a post item. Only values that exist
// on the live item are written; anything absent is left off so the component
// falls back to its own default, exactly like a server-rendered item.
export function postAttributes(data, index = 0) {
    const permalink = typeof data.permalink === 'string' ? data.permalink : null;
    return {
        id: data.name,
        'post-id': data.name || `t3_${data.id}`,
        permalink,
        'content-href': absolute(permalink),
        author: data.author,
        'author-id': data.author_fullname,
        'subreddit-prefixed-name': data.subreddit ? `r/${data.subreddit}` : null,
        'subreddit-id': data.subreddit_id,
        'created-timestamp': isoFromSeconds(data.created_utc),
        score: String(Number(data.score) || 0),
        'comment-count': String(Number(data.num_comments) || 0),
        'post-title': data.title,
        'post-type': postTypeOf(data),
        domain: data.domain,
        'view-context': 'UserProfileFeed',
        feedindex: String(index),
        nsfw: data.over_18 ? '' : null,
        spoiler: data.spoiler ? '' : null,
        pinned: data.stickied ? '' : null,
        locked: data.locked ? '' : null,
        archived: data.archived ? '' : null,
    };
}

// Comment items on the comments tab carry the parent post title, which is what
// the native "commented in r/x · <post title>" header renders.
export function commentAttributes(data, index = 0, parent = null) {
    const permalink = typeof data.permalink === 'string' ? data.permalink : null;
    return {
        thingid: data.name,
        'comment-id': data.id,
        postid: data.link_id,
        parentid: data.parent_id,
        depth: '0',
        permalink,
        'content-href': absolute(permalink),
        author: data.author,
        'author-id': data.author_fullname,
        score: String(Number(data.score) || 0),
        'created-timestamp': isoFromSeconds(data.created_utc),
        'subreddit-prefixed-name': data.subreddit ? `r/${data.subreddit}` : null,
        'post-title': parent?.title ?? null,
        'parent-permalink': absolute(parent?.permalink),
        'view-context': 'UserProfileFeed',
        feedindex: String(index),
        nsfw: data.over_18 ? '' : null,
        spoiler: data.spoiler ? '' : null,
        stickied: data.stickied ? '' : null,
    };
}

// Build a visible row without requiring Reddit component registration. A native
// HTML replacement may be substituted later, after checking its actual layout.
export function createItem(kind, live, { index = 0, doc = document, parent = null, now } = {}) {
    const element = doc.createElement('article');
    element.setAttribute('data-rosint-item', '');
    element.setAttribute('data-rosint-fullname', live.fullname);
    element.setAttribute('data-rosint-renderer', 'visible-card');
    element.setAttribute('data-rosint-kind', kind);
    element.setAttribute('view-type', 'cardView');

    const attributes = kind === 'posts'
        ? postAttributes(live.data, index)
        : commentAttributes(live.data, index, parent);
    for (const [name, value] of Object.entries(attributes)) {
        if (value == null) continue;
        element.setAttribute(name, value);
    }

    fillVisibleCard(element, kind, live, { doc, parent, now });
    return element;
}

