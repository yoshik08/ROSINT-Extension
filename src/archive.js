// Arctic Shift + PullPush listing client shared by the website (src/App.jsx)
// and the browser extension (extension/shared/). One implementation of the
// two-archive merge, ID dedupe and timestamp pagination.
//
// Moved verbatim out of App.jsx so the extension never grows a second copy of
// this logic; App.jsx now imports from here.
import { fetchWithBackoff } from "./postLookup.js";

export const ARCTIC   = "https://arctic-shift.photon-reddit.com";
export const PULLPUSH = "https://api.pullpush.io";
export const LIMIT = 100;

export function buildUrls(username, type, pagination = {}, dateFilters = {}) {
    const base = [
        `limit=${LIMIT}`,
        `sort=desc`,
        `author=${encodeURIComponent(username)}`,
    ];

    if (dateFilters.subreddit) {
        base.push(`subreddit=${encodeURIComponent(dateFilters.subreddit)}`);
    }

    // NSFW is a post-only field; Arctic Shift honors over_18 server-side.
    if (type === "posts" && dateFilters.over18 != null) {
        base.push(`over_18=${dateFilters.over18}`);
    }

    if (pagination.before) {
        base.push(`before=${pagination.before}`);
    } else if (dateFilters.dateTo) {
        base.push(`before=${dateFilters.dateTo}`);
    }

    if (pagination.after) {
        base.push(`after=${pagination.after}`);
    } else if (dateFilters.dateFrom) {
        base.push(`after=${dateFilters.dateFrom}`);
    }

    const qs = base.join("&");

    // Keyword search: the param name differs per archive (and per type on
    // Arctic). Arctic only allows it alongside author/subreddit — author is
    // always present here — and rejects it for very active users; fetchBoth
    // treats that failure as a degrade to PullPush, not an Arctic outage.
    let arcticQs = qs;
    let pullpushQs = qs;
    if (dateFilters.keywords) {
        const kw = encodeURIComponent(dateFilters.keywords);
        arcticQs += type === "posts" ? `&query=${kw}` : `&body=${kw}`;
        pullpushQs += `&q=${kw}`;
    }

    return {
        arctic: type === "posts"
            ? `${ARCTIC}/api/posts/search?${arcticQs}`
            : `${ARCTIC}/api/comments/search?${arcticQs}`,
        pullpush: type === "posts"
            ? `${PULLPUSH}/reddit/search/submission/?test&${pullpushQs}`
            : `${PULLPUSH}/reddit/search/comment/?test&${pullpushQs}`,
    };
}

// Retries with exponential backoff (see fetchWithBackoff), but only for
// failures that can plausibly clear on their own: 429 rate limits, 5xx, and
// network errors. Deterministic 4xx (404s, Arctic's 422 keyword rejection for
// very active users) fail fast so fetchBoth can degrade to PullPush
// immediately instead of stalling behind doomed retries.
export async function safeFetch(url, { retry = true, onRetry, timeoutMs, retryTimeouts = false } = {}) {
    const res = await fetchWithBackoff(url, {
        init: { headers: { Accept: "application/json" } },
        retries: retry ? undefined : 0,
        onRetry,
        timeoutMs,
        // Arctic Shift answers an overloaded query with 422 {"error":"Timeout..."}.
        // That clears on retry, unlike its keyword rejection, so it is only
        // retried when the caller knows no keyword filter is involved.
        retryWhen: retryTimeouts ? isArcticTimeout : undefined,
    });
    if (!res) return { data: [], ok: false };
    try {
        const json = await res.json();
        return { data: json?.data ?? [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

export async function isArcticTimeout(res) {
    if (res.status !== 422) return false;
    const text = await res.clone().text();
    return /timeout/i.test(text);
}

// Same classification the website shows and scripts/lib/archive.mjs reports.
export function getStatus(item, type) {
    const text = type === "posts" ? item.selftext : item.body;
    return {
        removed: text === "[removed]" || (type === "posts" && !!item.removed_by_category),
        deleted: text === "[deleted]" || item.author === "[deleted]",
    };
}

// Merge archive result sets and drop duplicates by ID, newest first. This is
// the merge the website has always used, lifted out of fetchBoth so the
// extension dedupes Arctic Shift + PullPush exactly the same way.
export function mergeArchiveItems(...lists) {
    const seen = new Set();
    const merged = [];
    for (const item of lists.flat()) {
        if (item?.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    }
    return merged.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0));
}

// One page of an author's history, newest first. `isBlocked` is injected so the
// website passes its restriction check and the extension worker passes the same
// check built on its own service client.
export async function fetchArchivePage({
    username,
    type,
    pagination = {},
    dateFilters = {},
    isBlocked,
    onRetry,
    // Optional: once Arctic Shift has answered, wait at most this long for
    // PullPush (whose retries can take ~20s while it is down). Unset keeps
    // waiting for both, as the website does.
    pullpushGraceMs,
    // Optional per-attempt timeout for both archives.
    timeoutMs,
    // Skip PullPush entirely (the extension's circuit breaker uses this).
    skipPullpush = false,
    // Retry PullPush 429/5xx with backoff. It asks automated clients not to
    // hammer it, so the extension makes a single attempt.
    retryPullpush = true,
} = {}) {
    // Recheck on pagination too; a removal may have been approved since search.
    if (isBlocked && await isBlocked(username)) {
        return { items: [], sources: [], arcticDown: false, restricted: true };
    }
    const { arctic, pullpush } = buildUrls(username, type, pagination, dateFilters);
    // Without a keyword filter, Arctic's 422 can only be its transient
    // "Timeout", so it is retried like a 429.
    const retryTimeouts = !dateFilters.keywords;
    const pullpushPending = skipPullpush
        ? Promise.resolve({ data: [], ok: false, skipped: true })
        : safeFetch(pullpush, { onRetry, timeoutMs, retry: retryPullpush });
    const arcticRes = await safeFetch(arctic, { onRetry, timeoutMs, retryTimeouts });
    let pullpushRes;
    if (pullpushGraceMs != null && arcticRes.ok) {
        let timer;
        pullpushRes = await Promise.race([
            pullpushPending,
            new Promise((resolve) => { timer = setTimeout(() => resolve({ data: [], ok: false }), pullpushGraceMs); }),
        ]);
        clearTimeout(timer);
    } else {
        pullpushRes = await pullpushPending;
    }

    const sources = [];

    if (arcticRes.ok && arcticRes.data.length > 0) sources.push("Arctic Shift");
    if (pullpushRes.ok && pullpushRes.data.length > 0) sources.push("PullPush");

    let result = mergeArchiveItems(arcticRes.data, pullpushRes.data);

    // PullPush ignores the over_18 param, so filter NSFW client-side (posts only;
    // comments have no over_18 field). Arctic results already match — harmless here.
    if (type === "posts" && dateFilters.over18 != null) {
        result = result.filter((p) => p.over_18 === dateFilters.over18);
    }

    // "Deleted only": keep just removed/deleted items. Client-side only —
    // neither archive can filter on status server-side.
    if (dateFilters.deletedOnly) {
        result = result.filter((item) => {
            const s = getStatus(item, type);
            return s.removed || s.deleted;
        });
    }

    result.sort((a, b) => b.created_utc - a.created_utc);
    // A failed keyword search on Arctic (rejected for very active users) is
    // not an outage — degrade to PullPush-only instead of the maintenance screen.
    return {
        items: result,
        sources,
        arcticDown: !arcticRes.ok && !dateFilters.keywords,
        pullpushDown: !pullpushRes.ok && !pullpushRes.skipped,
        restricted: false,
    };
}

