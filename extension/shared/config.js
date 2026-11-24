// Constants shared by the content script, the worker and the build script.
// No settings live here: the extension has no options surface on purpose.

export const REMOVAL_ORIGIN = 'https://removal.rosint.dev';
export const REDDIT_ORIGIN = 'https://www.reddit.com';

// Archive page size. Must stay in sync with src/archive.js (LIMIT), which is
// what actually builds the request.
export const PAGE_LIMIT = 100;

// /api/info.json accepts at most 100 ids per request.
export const INFO_BATCH = 100;

// Start the next archive page this far before the sentinel is on screen, so the
// feed never visibly runs out while scrolling.
export const SCROLL_ROOT_MARGIN = '800px';

export const MESSAGE = {
    connectionStatus: 'rosint/connection-status',
    retry: 'rosint/retry',
    profileStatus: 'rosint/profile-status',
    archivePage: 'rosint/archive-page',
    postInfo: 'rosint/post-info',
    clearSaved: 'rosint/clear-saved',
    health: 'rosint/health',
    communityPage: 'rosint/community-page',
    threadPage: 'rosint/thread-page',
};

// Messages that read the archives, so they need the archive host grants.
export const ARCHIVE_MESSAGES = new Set([MESSAGE.archivePage, MESSAGE.communityPage, MESSAGE.threadPage]);

// Feed tabs Reddit exposes on a profile. Overview interleaves both kinds.
export const TAB_KINDS = {
    overview: ['posts', 'comments'],
    posts: ['posts'],
    comments: ['comments'],
};

export function isKind(value) {
    return value === 'posts' || value === 'comments';
}

export function isTab(value) {
    return Object.hasOwn(TAB_KINDS, value);
}
