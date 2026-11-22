// What this browser has already restored, kept on this device only
// (storage.local, never synced or sent anywhere). It makes repeat visits paint
// instantly and keeps a profile readable while the archives are down. It is
// read only after the restriction check passes, so a removal applies to saved
// copies too.

const PREFIX = 'rosint:v1:';
const INDEX = `${PREFIX}index`;
const PARENTS = `${PREFIX}parents`;
const MAX_ENTRIES = 80; // username+kind lists
const MAX_ITEMS = 1000; // per list
const MAX_PARENTS = 3000;

export function memoryArea() {
    const map = new Map();
    return {
        async get(key) {
            if (key == null) return Object.fromEntries(map);
            return map.has(key) ? { [key]: map.get(key) } : {};
        },
        async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, value); },
        async remove(keys) { for (const key of [].concat(keys)) map.delete(key); },
        async clear() { map.clear(); },
    };
}

function defaultArea() {
    const api = globalThis.browser ?? globalThis.chrome;
    const area = api?.storage?.local;
    if (!area) return memoryArea();
    // Chrome's callback form also returns promises in MV3.
    return area;
}

// One writer per storage area. Every write here is read-modify-write on a
// shared key (the index, the parent titles), and overview saves posts and
// comments at the same moment, so unserialised writes could drop an index
// entry and leave a list that Forget would never find.
const queues = new WeakMap();

function serial(area, task) {
    const tail = queues.get(area) || Promise.resolve();
    const run = tail.then(task, task);
    queues.set(area, run.then(() => {}, () => {}));
    return run;
}

export function createArchiveCache({ area = defaultArea(), now = Date.now } = {}) {
    const keyFor = (username, kind) => `${PREFIX}${String(username).toLowerCase()}:${kind}`;

    async function read(key) {
        try {
            return (await area.get(key))?.[key] ?? null;
        } catch {
            return null;
        }
    }

    async function touch(key) {
        const index = (await read(INDEX)) || [];
        const next = [{ key, at: now() }, ...index.filter((entry) => entry.key !== key)];
        const evicted = next.slice(MAX_ENTRIES).map((entry) => entry.key);
        await area.set({ [INDEX]: next.slice(0, MAX_ENTRIES) });
        if (evicted.length) await area.remove(evicted);
    }

    return {
        async get(username, kind) {
            const entry = await read(keyFor(username, kind));
            if (!entry || !Array.isArray(entry.items)) return null;
            return entry;
        },
        // Merge a page into what is saved, newest first, bounded.
        add(username, kind, refs) {
            if (!Array.isArray(refs) || !refs.length) return Promise.resolve();
            return serial(area, async () => { try {
                const key = keyFor(username, kind);
                const existing = (await read(key))?.items || [];
                const byName = new Map(existing.map((ref) => [ref.fullname, ref]));
                for (const ref of refs) byName.set(ref.fullname, ref);
                const items = [...byName.values()]
                    .sort((a, b) => b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname))
                    .slice(0, MAX_ITEMS);
                await area.set({ [key]: { at: now(), items } });
                await touch(key);
            } catch { /* quota or storage unavailable: caching is best effort */ } });
        },
        async parents(ids) {
            const stored = (await read(PARENTS)) || {};
            return ids.map((id) => stored[id]).filter(Boolean);
        },
        addParents(posts) {
            if (!posts.length) return Promise.resolve();
            return serial(area, async () => { try {
                const stored = (await read(PARENTS)) || {};
                for (const post of posts) stored[post.id] = { ...post, at: now() };
                const entries = Object.entries(stored);
                const kept = entries.length > MAX_PARENTS
                    ? Object.fromEntries(entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_PARENTS))
                    : stored;
                await area.set({ [PARENTS]: kept });
            } catch { /* best effort */ } });
        },
        clear() {
            return serial(area, async () => {
                const index = (await read(INDEX)) || [];
                // Also sweep any list the index lost track of (older versions
                // could drop index entries under concurrent saves).
                let stray = [];
                try {
                    const everything = await area.get(null);
                    stray = Object.keys(everything || {}).filter((key) => key.startsWith(PREFIX));
                } catch { /* area.get(null) unsupported: index keys only */ }
                await area.remove([...new Set([INDEX, PARENTS, ...index.map((entry) => entry.key), ...stray])]);
            });
        },
        async size() {
            const index = (await read(INDEX)) || [];
            return index.length;
        },
    };
}

