// Worker-side service: restriction check first, then one archive page of ids.
// Everything it returns is either ids for the content script to hydrate
// same-origin, or an empty result that leaves the page untouched.
//
// Resilience, in order:
//   1. Arctic Shift's transient 422 "Timeout", 429s, 5xx and hung requests are
//      retried with backoff (src/archive.js), each attempt capped at 15s.
//   2. PullPush gets one attempt (no retries) and a 2s grace period once Arctic
//      answers; after any failure it is skipped for five minutes. It rate
//      limits hard and asks automated clients to back off.
//   3. When both archives fail, the copy this browser saved earlier is served
//      and labelled as such. Saved copies are only read after the restriction
//      check passes.

import { fetchArchivePage, LIMIT } from '../../src/archive.js';
import { normalizeUsername } from '../../src/normalizeUsername.js';
import { createArchiveCache } from './cache.js';
import { isKind } from './config.js';
import { toRef } from './pagination.js';
import { createRestrictionGate } from './restrictions.js';

// Reddit usernames are [A-Za-z0-9_-]; anything else is a malformed request.
const USERNAME = /^[a-z0-9_-]{2,32}$/i;

// Arctic Shift carries nearly all history; PullPush only fills gaps. When it
// is slow or down, its retries would hold every page for ~20s (and past
// Firefox's 30s event-page idle limit), so it gets a short grace period.
const PULLPUSH_GRACE_MS = 2000;
const PULLPUSH_COOLDOWN_MS = 5 * 60 * 1000;
const ATTEMPT_TIMEOUT_MS = 15000;

export function createArchiveService({
    gate = createRestrictionGate(),
    page = fetchArchivePage,
    pageSize = LIMIT,
    cache = createArchiveCache(),
    now = Date.now,
} = {}) {
    let pullpushOpenUntil = 0;

    async function saved(username, kind, health) {
        const entry = await cache.get(username, kind).catch(() => null);
        if (!entry?.items?.length) return null;
        return { ok: true, restricted: false, items: entry.items, done: true, cached: true, cachedAt: entry.at, health };
    }

    return {
        async page(request = {}) {
            const username = normalizeUsername(request.username);
            const kind = request.kind;
            if (!USERNAME.test(username) || !isKind(kind)) {
                return { ok: false, items: [], done: true };
            }

            const before = Number(request.before);
            const pagination = Number.isFinite(before) && before > 0 ? { before } : {};

            // Restriction first, before any archive request or saved copy.
            if (await gate(username)) {
                return { ok: true, restricted: true, items: [], done: true };
            }

            if (request.cacheOnly) {
                return (await saved(username, kind)) ?? { ok: true, restricted: false, items: [], done: false, cached: false };
            }

            const skipPullpush = now() < pullpushOpenUntil;
            let result;
            try {
                result = await page({
                    username,
                    type: kind,
                    pagination,
                    dateFilters: {},
                    isBlocked: gate,
                    pullpushGraceMs: PULLPUSH_GRACE_MS,
                    timeoutMs: ATTEMPT_TIMEOUT_MS,
                    skipPullpush,
                    retryPullpush: false,
                });
            } catch {
                return (await saved(username, kind)) ?? { ok: false, items: [], done: true };
            }
            if (!result || result.restricted) {
                return { ok: true, restricted: true, items: [], done: true };
            }
            if (result.pullpushDown) pullpushOpenUntil = now() + PULLPUSH_COOLDOWN_MS;

            const health = {
                arctic: !result.arcticDown,
                pullpush: skipPullpush ? 'paused' : result.pullpushDown !== true,
            };
            const items = (result.items || []).map((item) => toRef(kind, item)).filter(Boolean);
            if (!items.length) {
                if (result.arcticDown) {
                    // Both archives failed: fall back to what this browser saved.
                    return (await saved(username, kind, health)) ?? { ok: false, restricted: false, items: [], done: true, health };
                }
                return { ok: true, restricted: false, items: [], done: true, health };
            }
            await cache.add(username, kind, items);
            return {
                ok: true,
                restricted: false,
                health,
                items,
                // A short page means this author's archive is exhausted.
                done: items.length < pageSize,
            };
        },
        clear: () => cache.clear(),
    };
}
