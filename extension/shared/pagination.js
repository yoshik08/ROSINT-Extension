// Timestamp pagination and the archive item shape the worker hands back.
//
// Arctic Shift's `before` is exclusive (verified against the live API: asking
// for before=<t> omits the item whose created_utc is exactly t). Requesting
// `before = newestOldest + 1` therefore re-includes the boundary second, so a
// page boundary shared by several items can never drop one. The duplicate
// boundary items are removed by fullname, which is why pages have neither gaps
// nor repeated rows.

export function fullnameOf(kind, id) {
    return `${kind === 'posts' ? 't3' : 't1'}_${id}`;
}

// Keep only what the content script needs: a stable fullname, its kind and the
// timestamp used for ordering and for the next cursor.
export function toRef(kind, item) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9]+$/i.test(item.id)) return null;
    const createdUtc = Number(item.created_utc);
    if (!Number.isFinite(createdUtc) || createdUtc <= 0) return null;
    // Keep renderable data, never archive-supplied HTML or executable markup.
    const data = {};
    for (const key of ['author', 'author_fullname', 'title', 'body', 'selftext', 'permalink', 'subreddit', 'subreddit_id', 'score', 'num_comments', 'link_id', 'link_title', 'parent_id', 'removed', 'removed_by_category', 'over_18', 'spoiler', 'is_self', 'is_video', 'is_gallery', 'url', 'url_overridden_by_dest', 'post_hint', 'domain', 'thumbnail', 'link_flair_text', 'stickied', 'locked', 'archived']) {
        if (['string', 'number', 'boolean'].includes(typeof item[key])) data[key] = item[key];
    }
    // Pick only known media fields. URL validation happens again at rendering.
    const images = [];
    const gallery = item.gallery_data?.items;
    if (Array.isArray(gallery)) {
        for (const entry of gallery.slice(0, 20)) {
            const media = item.media_metadata?.[entry.media_id];
            const source = media?.s;
            if (media?.e === 'Image' && typeof source?.u === 'string') images.push({ url: source.u, width: source.x, height: source.y });
        }
    } else {
        const preview = item.preview?.images?.[0]?.source;
        if (typeof preview?.url === 'string') images.push({ url: preview.url, width: preview.width, height: preview.height });
    }
    if (images.length) data.images = images;
    const video = item.secure_media?.reddit_video || item.media?.reddit_video;
    if (typeof video?.fallback_url === 'string') data.video = { url: video.fallback_url, width: video.width, height: video.height, hasAudio: video.has_audio === true };
    data.id = item.id;
    data.name = fullnameOf(kind, item.id);
    data.created_utc = createdUtc;
    return { kind, id: item.id, fullname: data.name, createdUtc, data };
}

export function mergeRefs(...lists) {
    const seen = new Set();
    const out = [];
    for (const ref of lists.flat()) {
        if (!ref || seen.has(ref.fullname)) continue;
        seen.add(ref.fullname);
        out.push(ref);
    }
    return out.sort(compareRefs);
}

// Newest first; equal timestamps tie-break on fullname so DOM order is stable
// between renders.
export function compareRefs(a, b) {
    return b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname);
}

// The `before` value for the page after `refs`. Inclusive on purpose (see the
// note at the top); `previous` lets the caller stop when a page cannot advance.
export function cursorAfter(refs, previous = null) {
    if (!refs.length) return null;
    const oldest = refs.reduce((min, ref) => (ref.createdUtc < min ? ref.createdUtc : min), Infinity);
    const next = oldest + 1;
    if (previous != null && next >= previous) return null;
    return next;
}

// Interleave two already sorted ref lists (overview tab).
export function interleave(left, right) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
        out.push(compareRefs(left[i], right[j]) <= 0 ? left[i++] : right[j++]);
    }
    while (i < left.length) out.push(left[i++]);
    while (j < right.length) out.push(right[j++]);
    return out;
}
