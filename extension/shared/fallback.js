// Signed-out fallback for adult communities and posts. Reddit tells signed-out
// viewers that many NSFW communities "don't exist" (and their posts with
// them), behind its "log in to confirm your age" gate. With Quiet Reddit on,
// that refusal is replaced by Arctic Shift's copy: the community's posts
// newest first with infinite scroll, or the post followed by its comments.
//
// Only pages Reddit put behind its NSFW gate are touched, so a mistyped or
// banned community still gets Reddit's own "not found".

import { MESSAGE, SCROLL_ROOT_MARGIN } from './config.js';
import { createFeedView } from './feedView.js';
import { hydrateChildren } from './hydration.js';
import { createItem } from './nativeFeed.js';
import { cursorAfter, mergeRefs } from './pagination.js';
import { quietState } from './quiet.js';

const COMMUNITY_PATH = /^\/r\/([A-Za-z0-9_]{2,21})(?:\/(?:hot|new|top|rising|controversial|best))?\/?$/i;
const THREAD_PATH = /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,16})(?:\/[^/]*(?:\/[a-z0-9]+)?)?\/?$/i;
const FALLBACK_ROUNDS = 5;
// Rows one scroll should add before the next page waits for the viewer.
const FALLBACK_FILL = 8;
const FALLBACK_RETRY_MS = 5000;
const PAGE_STYLE = 'display:block;box-sizing:border-box;width:100%;max-width:756px;margin:0 auto;padding:16px 16px 64px;';

export function parseArchivePath(pathname) {
    const community = COMMUNITY_PATH.exec(pathname || '');
    if (community) return { scope: 'community', subreddit: community[1], key: `r:${community[1].toLowerCase()}` };
    const thread = THREAD_PATH.exec(pathname || '');
    if (thread) return { scope: 'thread', subreddit: thread[1], post: thread[2].toLowerCase(), key: `t:${thread[2].toLowerCase()}` };
    return null;
}

// Reddit's two refusals: the community page's error block, and the post
// page's "Community not found" guard, which (unlike a community that really
// does not exist) still carries the community's id.
export function findRefusal(doc) {
    const message = doc.querySelector('#community-content-error-message');
    if (message) {
        const main = message.closest('main');
        let block = message.parentElement || message;
        if (main) {
            block = message;
            while (block.parentElement && block.parentElement !== main) block = block.parentElement;
        }
        return { kind: 'community', block, main };
    }
    for (const guard of doc.querySelectorAll('guard-community-modal[subredditid]')) {
        if (!guard.querySelector('#nsfw-action-button')) return { kind: 'guard', block: guard, main: doc.querySelector('main') };
    }
    return null;
}

// The page this fallback may take over, or null.
export function archiveTarget(doc, win) {
    const quiet = quietState(doc);
    if (!quiet.on || !quiet.signedOut) return null;
    const target = parseArchivePath(win.location?.pathname);
    if (!target) return null;
    const gated = (quiet.nsfwGatePath && parseArchivePath(quiet.nsfwGatePath)?.key === target.key)
        || Boolean(doc.querySelector('rpl-dialog[dialog-id*="nsfw_blocking"], [id*="nsfw_blocking"]'));
    if (!gated) return null;
    const refusal = findRefusal(doc);
    return refusal ? { ...target, refusal } : null;
}

export function createFallback({
    doc = document,
    win = window,
    archive = null,
    now = Date.now,
    createObserver = null,
    autoRetryMs = FALLBACK_RETRY_MS,
} = {}) {
    let current = null;

    function sync() {
        const target = archive ? archiveTarget(doc, win) : null;
        if (!target) {
            // Keep a running feed while Reddit re-renders around it; drop it
            // once the viewer navigates somewhere else.
            if (current && parseArchivePath(win.location?.pathname)?.key === current.key && current.view.root.isConnected) return;
            stop();
            return;
        }
        if (current && current.key === target.key && !current.killed && current.view.root.isConnected) return;
        stop();
        start(target);
    }

    function start(target) {
        const kinds = target.scope === 'thread' ? ['posts', 'comments'] : ['posts'];
        const state = {
            key: target.key,
            target,
            kinds,
            items: new Map(),
            cursors: { posts: null, comments: null },
            done: { posts: false, comments: false },
            loading: false,
            killed: false,
            failure: null,
            restricted: false,
            dropped: 0,
            autoRetried: false,
            retryTimer: null,
            hidden: [],
            page: null,
            observer: null,
            view: null,
        };
        state.view = createFeedView({
            doc,
            tab: target.scope === 'thread' ? 'overview' : 'posts',
            scope: target.scope,
            name: target.subreddit,
            onRetry: () => restart(state),
        });
        state.view.root.setAttribute('data-rosint', target.key);
        current = state;
        mount(state);
        state.view.loading();
        observe(state);
        loadMore(state);
    }

    function hide(state, element) {
        if (!element) return;
        state.hidden.push({ element, style: element.getAttribute('style') });
        element.style.setProperty('display', 'none', 'important');
    }

    function mount(state) {
        const { refusal } = state.target;
        if (refusal.kind === 'community' && refusal.main && refusal.block.parentElement === refusal.main) {
            refusal.main.insertBefore(state.view.root, refusal.block);
        } else {
            // The refused post page has no layout of its own: give the rows a
            // centred column below Reddit's header.
            const page = doc.createElement('div');
            page.setAttribute('data-rosint-page', '');
            page.style.cssText = PAGE_STYLE;
            page.appendChild(state.view.root);
            const header = doc.querySelector('reddit-header-large, reddit-header-small, header');
            if (header?.parentElement) header.after(page);
            else (doc.body || doc.documentElement).appendChild(page);
            // Reddit's header is fixed; start the column just below it.
            const below = (header?.getBoundingClientRect?.().bottom || 0) - page.getBoundingClientRect().top;
            if (below > 0) page.style.paddingTop = `${Math.round(below + 16)}px`;
            state.page = page;
        }
        hide(state, refusal.block);
        // The refusal held the page still; the rows need to scroll.
        doc.body?.classList.remove('rpl-scroll-lock');
    }

    function observe(state) {
        const sentinel = state.view.sentinel;
        if (createObserver) {
            state.observer = createObserver(() => loadMore(state));
            state.observer?.observe?.(sentinel);
            return;
        }
        const Observer = win.IntersectionObserver;
        if (!Observer) return;
        state.observer = new Observer((entries) => {
            if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) loadMore(state);
        }, { rootMargin: SCROLL_ROOT_MARGIN });
        state.observer.observe(sentinel);
    }

    function unobserve(state) {
        state.observer?.disconnect?.();
        state.observer = null;
    }

    // Observing again reports whether the sentinel is still on screen, so a
    // page that did not fill the viewport loads the next one by itself.
    function rearm(state) {
        state.observer?.unobserve?.(state.view.sentinel);
        state.observer?.observe?.(state.view.sentinel);
    }

    const pending = (state) => state.kinds.filter((kind) => !state.done[kind]);

    function request(state, kind) {
        const { target } = state;
        const before = state.cursors[kind];
        return target.scope === 'community'
            ? { type: MESSAGE.communityPage, subreddit: target.subreddit, before }
            : { type: MESSAGE.threadPage, post: target.post, kind, before };
    }

    async function loadMore(state) {
        if (current !== state || state.killed || state.loading || !pending(state).length) return;
        state.loading = true;
        state.failure = null;
        if (state.items.size) state.view.loadingMore(true);
        try {
            let added = 0;
            // Busy adult communities have most posts removed (96 of the
            // newest 100 in one, Nov 2026), so keep reading pages until there
            // is enough to fill the screen.
            for (let round = 0; round < FALLBACK_ROUNDS && pending(state).length && added < FALLBACK_FILL; round += 1) {
                await Promise.all(pending(state).map(async (kind) => {
                    const response = await Promise.resolve(archive(request(state, kind))).catch(() => null);
                    if (state.killed || current !== state) return;
                    if (!response?.ok) {
                        state.failure = response?.error === 'host-permission-required' ? 'permission' : 'error';
                        state.done[kind] = true;
                        state.failedKind = kind;
                        return;
                    }
                    if (response.restricted) state.restricted = true;
                    const refs = Array.isArray(response.items) ? response.items : [];
                    const next = cursorAfter(refs, state.cursors[kind]);
                    state.cursors[kind] = next;
                    state.done[kind] = Boolean(response.done) || next == null;
                    added += render(state, mergeRefs(refs).filter((ref) => ref?.fullname && !state.items.has(ref.fullname)));
                }));
                if (state.killed || current !== state) break;
            }
            state.lastAdded = added;
        } finally {
            if (current === state && !state.killed) {
                state.loading = false;
                settle(state);
            }
        }
    }

    function render(state, refs) {
        const children = refs.filter((ref) => ref.data).map((ref) => ({ kind: ref.kind === 'posts' ? 't3' : 't1', data: ref.data }));
        const visible = hydrateChildren(children);
        // Removed and deleted rows are left out, as Reddit leaves them out.
        state.dropped += children.length - visible.length;
        let added = 0;
        for (const item of visible) {
            if (state.items.has(item.fullname)) continue;
            item.archived = true;
            const element = createItem(item.kind, item, { index: state.items.size, doc, now: now(), revealNsfw: true });
            if (!element) continue;
            state.items.set(item.fullname, { item, element });
            added += 1;
        }
        if (added) reorder(state);
        return added;
    }

    // The post leads its thread; everything else is newest first.
    function reorder(state) {
        const entries = [...state.items.values()].sort((a, b) =>
            (a.item.kind === b.item.kind ? 0 : a.item.kind === 'posts' ? -1 : 1)
            || b.item.createdUtc - a.item.createdUtc
            || a.item.fullname.localeCompare(b.item.fullname));
        const fragment = doc.createDocumentFragment();
        for (const entry of entries) fragment.appendChild(entry.element);
        state.view.list.appendChild(fragment);
    }

    function counts(state) {
        const out = { posts: 0, comments: 0 };
        let oldest = null;
        for (const { item } of state.items.values()) {
            out[item.kind] += 1;
            if (oldest === null || item.createdUtc < oldest) oldest = item.createdUtc;
        }
        return { counts: out, oldest };
    }

    function settle(state) {
        const { view } = state;
        view.loadingMore(false);
        const done = !pending(state).length;
        if (state.items.size) {
            const { counts: byKind, oldest } = counts(state);
            view.ready({ counts: byKind, archived: true, done: done && !state.failure, oldest });
            if (state.failure) {
                if (scheduleRetry(state, () => {
                    state.done[state.failedKind] = false;
                    loadMore(state);
                })) view.retrying();
                else view.partialError();
            }
            if (done && !state.failure) unobserve(state);
            else if (!done && state.lastAdded) rearm(state);
            return;
        }
        unobserve(state);
        if (state.restricted) {
            view.message('restricted');
        } else if (!state.failure && state.dropped) {
            view.message('removed');
        } else if (state.failure) {
            if (state.failure === 'error' && scheduleRetry(state, () => restart(state, { auto: true }))) {
                view.message('retrying');
                return;
            }
            view.message(state.failure);
        } else {
            view.message('empty');
        }
        view.sentinel.remove();
    }

    // One quiet retry: Arctic Shift's overload errors usually clear quickly.
    function scheduleRetry(state, action) {
        if (state.autoRetried || autoRetryMs == null) return false;
        state.autoRetried = true;
        state.retryTimer = win.setTimeout(() => {
            if (!state.killed && current === state) action();
        }, autoRetryMs);
        return true;
    }

    function restart(state, { auto = false } = {}) {
        if (current !== state) return;
        const { target } = state;
        stop();
        start(target);
        if (auto && current) current.autoRetried = true;
    }

    function stop() {
        const state = current;
        if (!state) return;
        current = null;
        state.killed = true;
        if (state.retryTimer) win.clearTimeout(state.retryTimer);
        unobserve(state);
        state.view.remove();
        state.page?.remove();
        for (const { element, style } of state.hidden) {
            if (style === null) element.removeAttribute('style');
            else element.setAttribute('style', style);
        }
    }

    function status() {
        if (!current) return null;
        const { counts: byKind, oldest } = counts(current);
        return {
            key: current.key,
            scope: current.target.scope,
            subreddit: current.target.subreddit,
            counts: byKind,
            oldest,
            loading: current.loading,
            restricted: current.restricted,
            failure: current.failure,
        };
    }

    return { sync, stop, status };
}
