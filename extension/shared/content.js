// Content-script shell. Reddit is a single-page app, so this watches the URL
// and the DOM, then hands the current profile/tab to the injector. Nothing is
// drawn here: the injector owns the DOM and always aborts its own run before a
// new one starts.

import { MESSAGE } from './config.js';
import { createFallback } from './fallback.js';
import { createInjector } from './injector.js';
import { findHiddenPanel, findNoticeBlock, parseProfilePath } from './nativeFeed.js';
import { quietState } from './quiet.js';
import { createInfoClient, detectHiddenHistory } from './reddit.js';

const isPromiseApi = typeof globalThis.browser !== 'undefined' && typeof globalThis.browser?.runtime?.sendMessage === 'function';
const MESSAGE_TIMEOUT_MS = 90000;

function send(message) {
    try {
        if (isPromiseApi) {
            return Promise.race([
                globalThis.browser.runtime.sendMessage(message).catch(() => null),
                new Promise((resolve) => setTimeout(() => resolve(null), MESSAGE_TIMEOUT_MS)),
            ]);
        }
        return Promise.race([
            new Promise((resolve) => globalThis.chrome.runtime.sendMessage(message, (response) => {
                // Reading lastError marks it handled (no console noise when the
                // worker is restarting); the caller treats null as a failure.
                if (globalThis.chrome.runtime.lastError) resolve(null);
                else resolve(response ?? null);
            })),
            new Promise((resolve) => setTimeout(() => resolve(null), MESSAGE_TIMEOUT_MS)),
        ]);
    } catch {
        return Promise.resolve(null);
    }
}

export function boot({ doc = document, win = window } = {}) {
    // Only the top-level Reddit page owns a profile feed.
    if (win.top !== win) return null;

    const info = createInfoClient();
    const injector = createInjector({
        doc,
        win,
        archive: (request) => send({ type: MESSAGE.archivePage, ...request }),
        info: (ids, options) => info(ids, options),
        postInfo: async (ids) => (await send({ type: MESSAGE.postInfo, ids }))?.posts ?? [],
        detect: async (username, options) => {
            if (findHiddenPanel(doc)) return { hidden: true, reason: 'hidden-panel' };
            const result = await detectHiddenHistory(username, options);
            // Logged out (JSON refused) in a language other than English: the
            // notice text is localised, so recognise the notice block instead.
            if (!result.hidden && result.reason === 'refused' && findNoticeBlock(doc)) {
                return { hidden: true, reason: 'notice-block' };
            }
            return result;
        },
        // Quiet Reddit, signed out: restored NSFW media is shown like the
        // rest of the page instead of behind a click.
        revealNsfw: () => {
            const quiet = quietState(doc);
            return quiet.on && quiet.signedOut;
        },
    });
    // Signed out with Quiet Reddit on: NSFW communities and posts Reddit
    // refuses to show come from the archive instead.
    const fallback = createFallback({ doc, win, archive: (message) => send(message) });

    let scheduled = false;
    const hadRuntime = Boolean((globalThis.browser ?? globalThis.chrome)?.runtime?.id);
    let lastHref = win.location.href;
    let lastSortKey = '';
    let lastKey = '';

    function sync() {
        const profile = parseProfilePath(win.location.pathname);
        if (!profile) {
            injector.stop();
            lastKey = '';
            fallback.sync();
            return;
        }
        fallback.stop();
        const key = `${profile.username.toLowerCase()}:${profile.tab}`;
        const state = injector.status();
        const sameRun = state && state.key === key && state.feedConnected !== false;
        if (sameRun && key === lastKey) {
            // Same profile and tab: only a dropdown change can need work. The
            // sort key guard keeps our own DOM writes from looping back here.
            const sortKey = win.location.search;
            if (sortKey !== lastSortKey) {
                lastSortKey = sortKey;
                injector.refreshSort();
            }
            return;
        }
        lastKey = key;
        lastSortKey = win.location.search;
        injector.start(profile); // start() aborts any previous run
    }

    function schedule() {
        // After the extension is updated or removed, this copy of the script is
        // orphaned: its runtime is gone. Put the page back and stop watching.
        if (hadRuntime && !(globalThis.browser ?? globalThis.chrome)?.runtime?.id) {
            shutdown();
            return;
        }
        if (scheduled) return;
        scheduled = true;
        win.setTimeout(() => {
            scheduled = false;
            sync();
        }, 50);
    }

    const observer = new win.MutationObserver(schedule);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    win.addEventListener('popstate', schedule);

    // Reddit's SPA navigation does not always mutate a node we observe before
    // the next paint, and pushState is not observable from an isolated world.
    // A slow href poll closes that gap; it is a string compare, no work.
    const poll = win.setInterval(() => {
        if (win.location.href === lastHref) return;
        lastHref = win.location.href;
        schedule();
    }, 1000);

    sync();

    const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
    function retry(message, sender, sendResponse) {
        if (sender.id !== runtime?.id) return false;
        if (message?.type === MESSAGE.profileStatus) {
            sendResponse({ ok: true, state: injector.snapshot(), archive: fallback.status() });
            return false;
        }
        if (message?.type !== MESSAGE.retry) return false;
        injector.stop();
        fallback.stop();
        lastKey = '';
        sync();
        sendResponse({ ok: true });
        return false;
    }
    runtime?.onMessage?.addListener(retry);

    function shutdown() {
        try { runtime?.onMessage?.removeListener(retry); } catch { /* runtime already gone */ }
        win.clearInterval(poll);
        observer.disconnect();
        win.removeEventListener('popstate', schedule);
        injector.stop();
        fallback.stop();
    }

    return { injector, fallback, sync, stop: shutdown };
}

if (typeof window !== 'undefined' && !globalThis.__rosintHiddenHistoryLoaded) {
    globalThis.__rosintHiddenHistoryLoaded = true;
    boot();
}
