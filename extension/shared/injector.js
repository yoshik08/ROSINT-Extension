// Content-script engine: decide whether to run, page the archive through the
// worker, hydrate same-origin, then render restored rows in a feed of our own
// directly below the profile controls. One run per profile tab; every run owns
// an AbortController so navigating away cannot leave a stale injection behind.
//
// States (snapshot().phase):
//   detecting → not-hidden                      (page left exactly as Reddit drew it)
//   detecting → waiting-for-feed                 (retried on the next DOM change)
//   detecting → loading-archive → ready          (rows shown, Reddit's empty panel hidden)
//                               → empty | restricted | error   (panel restored, header explains)

import { SCROLL_ROOT_MARGIN, TAB_KINDS } from './config.js';
import { createFeedView } from './feedView.js';
import { hydrateChildren, parentTitlesFrom } from './hydration.js';
import { createItem, findEmptyState, findFeed, findHiddenPanel, fullnamesIn } from './nativeFeed.js';
import { setParentTitle } from './visibleCard.js';
import { cursorAfter, mergeRefs } from './pagination.js';
import { createOrder, readSort } from './sort.js';

// Bound the catch-up loop so a history that is almost entirely deleted cannot
// turn one scroll into dozens of archive requests.
const MAX_ROUNDS = 5;
const AUTO_RETRY_MS = 5000;
// While a hidden profile waits for Reddit to mount its feed, every DOM change
// retries the run. The detection answer is reused for this long so those
// retries never repeat the three Reddit JSON requests.
const DETECTION_REUSE_MS = 30000;
const ENTRANCE = { duration: 360, stagger: 32, cap: 8, easing: 'cubic-bezier(.23,1,.32,1)' };

function noop() {}

export function createInjector({
    doc = document,
    win = globalThis,
    archive = null,
    info = null,
    postInfo = null,
    detect = null,
    now = Date.now,
    createObserver = null,
    autoRetryMs = AUTO_RETRY_MS,
} = {}) {
    if (!archive || !info || !detect) {
        // Wiring is missing: stay inert instead of half-injecting.
        return { start: noop, stop: noop, refreshSort: noop, more: noop, snapshot: () => null, status: () => null };
    }

    let current = null;

    function start({ username, tab, autoRetried = false } = {}) {
        if (!username || !TAB_KINDS[tab]) return null;
        const key = `${String(username).toLowerCase()}:${tab}`;
        if (current && current.key === key && !current.killed && !current.waitingForFeed && current.feed?.isConnected !== false) {
            return current.ready; // Never inject a second time.
        }
        const previous = current && current.key === key && current.waitingForFeed ? current.detection : null;
        stop();
        const state = {
            key,
            detection: previous && now() - previous.at < DETECTION_REUSE_MS ? previous : null,
            username,
            tab,
            controller: new AbortController(),
            killed: false,
            loading: false,
            phase: 'detecting',
            feed: null,
            waitingForFeed: false,
            placeholder: null,
            panelStyle: null,
            empty: null,
            concealed: false,
            view: null,
            observer: null,
            onScroll: null,
            revealed: false,
            failure: null,
            failedKinds: new Set(),
            liveKinds: new Set(),
            savedAt: null,
            offlineAt: null,
            autoRetried: Boolean(autoRetried),
            parents: new Map(),
            restricted: false,
            error: null,
            native: new Set(),
            items: new Map(),
            cursors: { posts: null, comments: null },
            done: { posts: false, comments: false },
        };
        current = state;
        state.ready = load(state).catch((error) => {
            if (state.killed) return;
            state.error = error?.message || 'Unknown rendering error';
            state.phase = 'error';
            state.view?.message('error');
            if (globalThis.__ROSINT_DEBUG__) console.error('[rosint]', error);
        });
        return state.ready;
    }

    async function load(state) {
        const { signal } = state.controller;
        let detection = state.detection?.result;
        if (!detection) {
            try {
                detection = await detect(state.username, { signal });
            } catch {
                return;
            }
            if (state.killed) return;
            state.detection = { result: detection, at: now() };
        }
        if (!detection?.hidden) {
            state.phase = 'not-hidden';
            state.reason = detection?.reason || null;
            return;
        }

        const feed = findFeed(doc);
        if (!feed) {
            state.waitingForFeed = true;
            state.phase = 'waiting-for-feed';
            return;
        }

        state.feed = feed;
        state.placeholder = findHiddenPanel(doc) === feed ? feed : null;
        state.empty = rememberEmpty(feed);
        state.native = fullnamesIn(feed);
        mount(state);
        await paintSaved(state);
        await loadMore(state);
    }

    // Stale-while-revalidate: rows this browser saved on an earlier visit are
    // drawn at once (after the worker's restriction check), then the archives
    // are asked for anything newer.
    async function paintSaved(state) {
        const responses = await Promise.all(TAB_KINDS[state.tab].map((kind) =>
            archive({ username: state.username, kind, cacheOnly: true }).catch(() => null)));
        if (state.killed || current !== state) return;
        const refs = [];
        for (const response of responses) {
            if (response?.restricted) { state.restricted = true; continue; }
            if (response?.ok && response.cached && Array.isArray(response.items)) {
                state.savedAt = Math.max(state.savedAt || 0, response.cachedAt || 0) || Date.now();
                refs.push(...response.items.filter((ref) => ref?.fullname && !state.native.has(ref.fullname)));
            }
        }
        if (state.restricted) return;
        if (refs.length) {
            await addItems(state, mergeRefs(refs));
            if (state.items.size) state.view.ready({ ...counts(state), done: false, savedAt: state.savedAt, refreshing: true });
        }
    }

    // The feed is ours: a sibling placed before Reddit's hidden-history panel
    // (or appended inside its feed). Reddit's panel is concealed while rows or
    // skeletons are on screen and comes back whenever there is nothing to show.
    function mount(state) {
        const view = createFeedView({
            doc,
            username: state.username,
            tab: state.tab,
            onRetry: () => retry(state),
        });
        state.view = view;
        view.root.setAttribute('data-rosint', state.key);
        if (state.placeholder) state.placeholder.before(view.root);
        else state.feed.appendChild(view.root);
        view.loading();
        conceal(state);
        observe(state);
    }

    function conceal(state) {
        if (state.concealed) return;
        state.concealed = true;
        if (state.placeholder) {
            state.panelStyle = state.placeholder.getAttribute('style');
            state.placeholder.style.setProperty('display', 'none', 'important');
        }
        if (state.empty) state.empty.element.style.display = 'none';
    }

    function reveal(state) {
        if (!state.concealed) return;
        state.concealed = false;
        if (state.placeholder) {
            if (state.panelStyle !== null) state.placeholder.setAttribute('style', state.panelStyle);
            else state.placeholder.removeAttribute('style');
        }
        if (state.empty) state.empty.element.style.display = state.empty.display;
    }

    // Reddit's empty state is remembered, not removed: it comes back untouched
    // when the viewer navigates to another page.
    function rememberEmpty(feed) {
        const element = findEmptyState(feed);
        if (!element) return null;
        return { element, display: element.style.display };
    }

    function observe(state) {
        const sentinel = state.view.sentinel;
        if (createObserver) {
            state.observer = createObserver(() => loadMore(state));
            state.observer?.observe?.(sentinel);
            return;
        }
        const Observer = win.IntersectionObserver;
        if (Observer) {
            state.observer = new Observer((entries) => {
                if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) loadMore(state);
            }, { rootMargin: SCROLL_ROOT_MARGIN });
            state.observer.observe(sentinel);
            return;
        }
        state.onScroll = () => {
            const scrolling = doc.scrollingElement || doc.documentElement;
            if (!scrolling) return;
            if (scrolling.scrollTop + (win.innerHeight || 0) >= scrolling.scrollHeight - 800) loadMore(state);
        };
        win.addEventListener?.('scroll', state.onScroll, { passive: true });
    }

    function unobserve(state) {
        state.observer?.disconnect?.();
        state.observer = null;
        if (state.onScroll) win.removeEventListener?.('scroll', state.onScroll);
        state.onScroll = null;
    }

    const pendingKinds = (state) => TAB_KINDS[state.tab].filter((kind) => !state.done[kind]);

    async function loadMore(state) {
        if (current !== state || state.killed || state.loading || !state.view) return;
        if (!pendingKinds(state).length) return;

        state.loading = true;
        state.phase = 'loading-archive';
        state.failure = null;
        state.failedKinds = new Set();
        if (state.items.size) state.view.loadingMore(true);
        try {
            let added = 0;
            for (let round = 0; round < MAX_ROUNDS; round += 1) {
                const pending = pendingKinds(state);
                if (!pending.length) break;

                // Kinds are independent pages: ask for them together and
                // render each one as soon as it answers.
                await Promise.all(pending.map(async (kind) => {
                    const response = await archive({
                        username: state.username,
                        kind,
                        before: state.cursors[kind],
                    });
                    if (state.killed || current !== state) return;
                    if (!response || !response.ok) {
                        state.failure = response?.error === 'host-permission-required' ? 'permission' : 'error';
                        state.error = response?.error || 'Archive request failed';
                        state.failedKinds.add(kind);
                        state.done[kind] = true;
                        return;
                    }
                    if (response.restricted) {
                        state.restricted = true;
                        state.done[kind] = true;
                        return;
                    }
                    if (response.cached) state.offlineAt = response.cachedAt || Date.now();
                    else state.liveKinds.add(kind);
                    const refs = Array.isArray(response.items) ? response.items : [];
                    const next = cursorAfter(refs, state.cursors[kind]);
                    state.cursors[kind] = next;
                    state.done[kind] = Boolean(response.done) || next == null;
                    const fresh = mergeRefs(refs.filter((ref) => ref?.fullname && !state.native.has(ref.fullname)))
                        .filter((ref) => !state.items.has(ref.fullname));
                    if (fresh.length) {
                        const count = await addItems(state, fresh);
                        added += count;
                    }
                }));

                if (state.killed || current !== state) return;
                if (added > 0) break;
                if (!pendingKinds(state).length) break;
            }
        } catch (error) {
            if (!state.killed && current === state) {
                state.failure = 'error';
                state.error = error?.message || 'Rendering failed';
            }
        } finally {
            if (current === state && !state.killed) {
                state.loading = false;
                settle(state);
            }
        }
    }

    function counts(state) {
        const out = { posts: 0, comments: 0 };
        let oldest = null;
        let archived = false;
        for (const { item } of state.items.values()) {
            out[item.kind] += 1;
            if (oldest === null || item.createdUtc < oldest) oldest = item.createdUtc;
            if (item.archived) archived = true;
        }
        return { counts: out, oldest, archived };
    }

    // Decide what the header says once a request settles.
    function settle(state) {
        const view = state.view;
        view.loadingMore(false);
        const done = !pendingKinds(state).length;
        const live = state.liveKinds.size > 0;
        if (state.items.size) {
            state.phase = 'ready';
            conceal(state);
            const { counts: byKind, oldest, archived } = counts(state);
            const offline = !live && (state.offlineAt || state.savedAt) ? (state.offlineAt || state.savedAt) : null;
            view.ready({ counts: byKind, archived, done: done && !state.failure && !offline, oldest, offlineAt: offline });
            if (state.failure && !offline) {
                if (scheduleAutoRetry(state, () => {
                    for (const kind of state.failedKinds) state.done[kind] = false;
                    loadMore(state);
                })) view.retrying(true);
                else view.partialError();
            } else if (!state.failure) state.error = null;
            if (done && !state.failure) unobserve(state);
            return;
        }
        // Nothing to show: hand the page back to Reddit's own panel and say why.
        reveal(state);
        if (state.restricted) {
            state.phase = 'restricted';
            unobserve(state);
            view.sentinel.remove();
            view.message('restricted');
        } else if (state.failure) {
            state.phase = 'error';
            if (state.failure === 'error' && scheduleAutoRetry(state, () => retry(state, { auto: true }))) {
                view.message('retrying');
                return;
            }
            unobserve(state);
            view.sentinel.remove();
            view.message(state.failure);
        } else {
            state.phase = 'empty';
            unobserve(state);
            view.sentinel.remove();
            view.message('empty');
        }
    }

    // One quiet automatic retry per run: Arctic Shift's overload errors
    // usually clear within seconds, so the viewer should not have to click.
    function scheduleAutoRetry(state, action) {
        if (state.autoRetried || autoRetryMs == null) return false;
        state.autoRetried = true;
        state.retryTimer = win.setTimeout(() => {
            if (state.killed || current !== state) return;
            action();
        }, autoRetryMs);
        return true;
    }

    // Hydrate with the viewer's own session, drop what Reddit would not list,
    // and render the survivors.
    async function addItems(state, refs) {
        let children;
        let archived = false;
        try {
            state.phase = 'checking-live';
            children = await info(refs.map((ref) => ref.fullname), { signal: state.controller.signal });
        } catch {
            if (state.controller.signal.aborted) return 0;
            archived = true;
            children = refs.filter((ref) => ref.data).map((ref) => ({ kind: ref.kind === 'posts' ? 't3' : 't1', data: ref.data }));
        }
        if (state.killed || current !== state) return 0;

        const live = hydrateChildren(children);
        const byFullname = new Map(live.map((item) => [item.fullname, item]));

        let added = 0;
        state.phase = 'rendering';
        const fresh = [];
        for (const ref of refs) {
            const item = byFullname.get(ref.fullname);
            if (!item || state.items.has(item.fullname)) continue;
            const parent = item.kind === 'comments' && typeof item.data.link_id === 'string'
                ? state.parents.get(item.data.link_id.replace(/^t3_/, '')) ?? null
                : null;
            item.archived = archived;
            const element = createItem(item.kind, item, {
                index: state.items.size,
                doc,
                parent,
                now: now(),
            });
            if (!element) break;
            state.items.set(item.fullname, { item, element });
            fresh.push(element);
            added += 1;
        }
        if (added) {
            conceal(state);
            reorder(state);
            if (!state.revealed) {
                state.revealed = true;
                state.view.ready({ ...counts(state), done: false, refreshing: true });
                entrance(fresh);
            }
            fillParents(state, live);
        }
        return added;
    }

    // Parent post titles for comment headers arrive after the rows are on
    // screen, so a slow lookup never holds the feed back.
    function fillParents(state, live) {
        if (!postInfo) return;
        const ids = [...new Set(live
            .filter((item) => item.kind === 'comments' && typeof item.data.link_id === 'string' && !item.data.link_title)
            .map((item) => item.data.link_id.replace(/^t3_/, ''))
            .filter((id) => !state.parents.has(id)))];
        if (!ids.length) return;
        Promise.resolve(postInfo(ids)).then((posts) => {
            if (state.killed || current !== state) return;
            for (const [id, post] of parentTitlesFrom(posts)) state.parents.set(id, post);
            for (const { item, element } of state.items.values()) {
                if (item.kind !== 'comments' || typeof item.data.link_id !== 'string') continue;
                const parent = state.parents.get(item.data.link_id.replace(/^t3_/, ''));
                if (parent) setParentTitle(element, item.data, parent, doc);
            }
        }, () => {});
    }

    // The one authored moment: the first rows settle in as the skeletons leave.
    function entrance(elements) {
        if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const visible = elements.filter((element) => !element.hidden).slice(0, ENTRANCE.cap);
        visible.forEach((element, index) => {
            element.animate?.([
                { opacity: 0, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'none' },
            ], { duration: ENTRANCE.duration, delay: index * ENTRANCE.stagger, easing: ENTRANCE.easing, fill: 'backwards' });
        });
    }

    // Re-append in the current dropdown order.
    function reorder(state) {
        if (!state.view) return;
        const sort = readSort(win.location?.search || '', 'new');
        const order = createOrder({ mode: sort.mode, range: sort.range, now: now() });
        const entries = [...state.items.values()];
        for (const entry of entries) entry.element.hidden = !order.inRange(entry.item);
        entries.sort((a, b) => order.compare(a.item, b.item));
        const fragment = doc.createDocumentFragment();
        for (const entry of entries) fragment.appendChild(entry.element);
        state.view.list.appendChild(fragment);
    }

    function retry(state, { auto = false } = {}) {
        if (current !== state) return;
        const { username, tab } = state;
        stop();
        start({ username, tab, autoRetried: auto });
    }

    function stop() {
        const state = current;
        if (!state) return;
        current = null;
        state.killed = true;
        state.controller.abort();
        if (state.retryTimer) win.clearTimeout?.(state.retryTimer);
        unobserve(state);
        reveal(state);
        state.view?.remove();
    }

    function refreshSort() {
        if (current && !current.killed) reorder(current);
    }

    function more() {
        if (current) return loadMore(current);
        return undefined;
    }

    // Cheap identity check for the SPA watcher, which runs on every DOM change:
    // no counting and no layout reads.
    function status() {
        if (!current) return null;
        return {
            key: current.key,
            feedConnected: current.feed ? current.feed.isConnected : false,
            phase: current.phase,
        };
    }

    function snapshot() {
        if (!current) return null;
        const { counts: byKind, oldest, archived } = counts(current);
        return {
            key: current.key,
            username: current.username,
            tab: current.tab,
            feedConnected: current.feed ? current.feed.isConnected : false,
            fullnames: [...current.items.keys()],
            emptyHidden: current.empty ? current.empty.element.style.display === 'none' : false,
            loading: current.loading,
            error: current.error || null,
            failure: current.failure,
            restricted: current.restricted,
            phase: current.phase,
            savedAt: current.savedAt,
            offlineAt: current.liveKinds.size ? null : current.offlineAt,
            retrying: Boolean(current.retryTimer) && current.phase !== 'ready' ? true : undefined,
            reason: current.reason || null,
            count: current.items.size,
            counts: byKind,
            oldest,
            archived,
            done: !pendingKinds(current).length,
            visibleCount: [...current.items.values()].filter(({ element }) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && !element.hidden;
            }).length,
        };
    }

    return { start, stop, refreshSort, more, snapshot, status };
}
