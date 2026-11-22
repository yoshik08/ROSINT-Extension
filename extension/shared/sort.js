// Ordering for injected items. New and Top mirror the profile feed's own
// dropdown; Hot uses Reddit's published hot ranking applied to the live score
// and age we hydrated from /api/info.json.

export const SORT_MODES = ['new', 'hot', 'top'];

export const TOP_RANGES = {
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
    all: Infinity,
};

const SORT_ALIASES = { new: 'new', hot: 'hot', top: 'top', best: 'hot', relevance: 'new' };

// Reads the profile feed's own URL state, which is what its dropdown writes:
// /user/<name>/?sort=top&t=week. Defaults match a fresh profile visit.
export function readSort(search = '', fallback = 'new') {
    let params;
    try {
        params = new URLSearchParams(search);
    } catch {
        params = new URLSearchParams();
    }
    const mode = SORT_ALIASES[(params.get('sort') || '').toLowerCase()] || fallback;
    const range = (params.get('t') || 'all').toLowerCase();
    return { mode, range: Object.hasOwn(TOP_RANGES, range) ? range : 'all' };
}

// Reddit's hot formula: log10 of the positive score, a sign bonus, and one
// point per 12.5 hours of age (45000 seconds). Seconds are compared directly
// here, so the common constant cancels out.
export function hotRank(score, createdUtc) {
    const s = Number(score) || 0;
    return Math.log10(Math.max(Math.abs(s), 1)) + (s > 0 ? 1 : s < 0 ? -1 : 0) + createdUtc / 45000;
}

export function compareForSort(a, b, mode) {
    if (mode === 'top') {
        return (b.score || 0) - (a.score || 0) || b.createdUtc - a.createdUtc;
    }
    if (mode === 'hot') {
        return hotRank(b.score, b.createdUtc) - hotRank(a.score, a.createdUtc) || b.createdUtc - a.createdUtc;
    }
    return b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname);
}

// `items` are hydrated entries: { fullname, kind, createdUtc, score, ... }.
// Top honours the dropdown's time filter; new/hot ignore it like Reddit does.
export function orderItems(items, { mode = 'new', range = 'all', now = Date.now() } = {}) {
    const cutoff = mode === 'top' && Number.isFinite(TOP_RANGES[range])
        ? now / 1000 - TOP_RANGES[range]
        : -Infinity;
    return items
        .filter((item) => (item.createdUtc || 0) >= cutoff)
        .sort((a, b) => compareForSort(a, b, mode));
}

// Resolves the current dropdown state into an in-range test and a comparator.
// Top honours the dropdown's time filter (out-of-range rows are hidden rather
// than dropped, so switching back to New restores them without a refetch);
// new/hot ignore the filter exactly like Reddit does.
export function createOrder({ mode = 'new', range = 'all', now = Date.now } = {}) {
    const cutoff = mode === 'top' && Number.isFinite(TOP_RANGES[range])
        ? now / 1000 - TOP_RANGES[range]
        : -Infinity;
    return {
        mode,
        inRange: (item) => (item.createdUtc || 0) >= cutoff,
        compare: (a, b) => compareForSort(a, b, mode),
    };
}

