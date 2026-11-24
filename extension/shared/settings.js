// The extension's only setting: Quiet Reddit, on unless the viewer turns it
// off in the popup. Kept in storage.local next to saved copies; it never syncs.

export const QUIET_KEY = 'rosint:quiet';

function storageArea(api) {
    return api?.storage?.local ?? null;
}

// Missing or unreadable storage means the default: on.
export async function readQuiet(api = globalThis.browser ?? globalThis.chrome) {
    try {
        const area = storageArea(api);
        if (!area) return true;
        const stored = await area.get(QUIET_KEY);
        return stored?.[QUIET_KEY] !== false;
    } catch {
        return true;
    }
}

export async function writeQuiet(on, api = globalThis.browser ?? globalThis.chrome) {
    await storageArea(api)?.set({ [QUIET_KEY]: Boolean(on) });
}

// Calls back with the new value whenever the popup flips the switch.
export function onQuietChange(listener, api = globalThis.browser ?? globalThis.chrome) {
    const changed = api?.storage?.onChanged;
    if (!changed) return () => {};
    const handler = (changes, area) => {
        if (area && area !== 'local') return;
        if (!changes || !Object.hasOwn(changes, QUIET_KEY)) return;
        listener(changes[QUIET_KEY].newValue !== false);
    };
    changed.addListener(handler);
    return () => {
        try { changed.removeListener(handler); } catch { /* runtime gone */ }
    };
}
