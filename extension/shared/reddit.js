// Same-origin Reddit reads used by the content script. Nothing here is
// cross-origin: the browser attaches the viewer's session, so the live item
// state (score, edits, flair, NSFW blur preference) is exactly what the
// profile feed would show if the history were not hidden.

import { backoffDelayMs, retryAfterMs } from '../../src/postLookup.js';
import { INFO_BATCH } from './config.js';

const MAX_INFO_RETRY_AFTER_MS = 60000;

async function readJson(path, { fetchImpl = fetch, signal } = {}) {
    try {
        const response = await fetchImpl(path, {
            signal,
            credentials: 'include',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return { ok: false, status: response.status, json: null };
        return { ok: true, status: response.status, json: await response.json() };
    } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, status: 0, json: null };
    }
}

// A profile is treated as hidden only when the account itself resolves and both
// listings are empty. Suspended, missing, blocked or rate-limited responses are
// skipped instead of guessed at, so the extension never replaces a page it does
// not understand.
export async function detectHiddenHistory(username, { fetchImpl = fetch, signal } = {}) {
    const name = String(username || '').trim();
    if (!name) return { hidden: false, reason: 'no-user' };
    const user = encodeURIComponent(name);

    const about = await readJson(`/user/${user}/about.json?raw_json=1`, { fetchImpl, signal });
    if (!about.ok && (about.status === 401 || about.status === 403)) {
        // Logged-out viewers get 403 on every JSON endpoint. The caller can
        // still recognise Reddit's own hidden-history notice on the page.
        return { hidden: false, reason: 'refused' };
    }
    if (!about.ok || !about.json?.data || typeof about.json.data.name !== 'string') {
        return { hidden: false, reason: 'no-account' };
    }
    if (about.json.data.is_suspended === true) return { hidden: false, reason: 'suspended' };

    const [posts, comments] = await Promise.all([
        readJson(`/user/${user}/submitted.json?limit=1&raw_json=1`, { fetchImpl, signal }),
        readJson(`/user/${user}/comments.json?limit=1&raw_json=1`, { fetchImpl, signal }),
    ]);
    if (!posts.ok || !comments.ok) return { hidden: false, reason: 'listing-unavailable' };

    const postChildren = posts.json?.data?.children;
    const commentChildren = comments.json?.data?.children;
    if (!Array.isArray(postChildren) || !Array.isArray(commentChildren)) {
        return { hidden: false, reason: 'malformed' };
    }
    return {
        hidden: postChildren.length === 0 && commentChildren.length === 0,
        reason: 'ok',
        about: about.json.data,
    };
}

function abortReason(signal) {
    return signal?.reason instanceof Error ? signal.reason : new Error('Aborted');
}

// One /api/info.json request at a time, batched at the endpoint's 100-id limit,
// retrying only the statuses that can clear on their own. A batch that keeps
// failing is dropped rather than retried forever; the feed simply shows fewer
// archived items, with no error UI.
export function createInfoClient({
    fetchImpl = fetch,
    wait,
    now = Date.now,
    random = Math.random,
    batchSize = INFO_BATCH,
    retries = 3,
} = {}) {
    const sleep = wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let tail = Promise.resolve();

    async function request(chunk, signal) {
        const url = `/api/info.json?id=${chunk.join(',')}&raw_json=1&sr_detail=true`;
        for (let attempt = 0; ; attempt += 1) {
            let response = null;
            try {
                response = await fetchImpl(url, {
                    signal,
                    credentials: 'include',
                    headers: { Accept: 'application/json' },
                });
            } catch (error) {
                if (signal?.aborted) throw error;
            }
            if (response?.ok) {
                try {
                    const json = await response.json();
                    return json?.data?.children ?? null;
                } catch {
                    return null;
                }
            }
            if (response && response.status !== 429 && response.status < 500) return null;
            if (attempt >= retries) return null;
            const delay = retryAfterMs(response, now) ?? backoffDelayMs(attempt, random);
            if (delay > MAX_INFO_RETRY_AFTER_MS) return null;
            await sleep(delay);
        }
    }

    return function fetchInfo(ids, { signal } = {}) {
        // /api/info takes fullnames, not bare archive IDs. Keep the kind prefix:
        // posts and comments can have the same base36 ID.
        const unique = [...new Set(ids.filter((id) => typeof id === 'string' && /^t[13]_[a-z0-9]+$/i.test(id)).map((id) => id.toLowerCase()))];
        const run = tail.then(async () => {
            const children = [];
            for (let i = 0; i < unique.length; i += batchSize) {
                if (signal?.aborted) throw abortReason(signal);
                const batch = await request(unique.slice(i, i + batchSize), signal);
                if (!batch) throw new Error('Reddit live lookup unavailable');
                children.push(...batch);
            }
            return children;
        });
        tail = run.then(() => {}, () => {});
        return run;
    };
}
