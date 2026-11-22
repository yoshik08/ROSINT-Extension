import { REMOVAL_ORIGIN } from './config.js';

export const REQUIRED_ORIGINS = [
    '*://www.reddit.com/*',
    'https://arctic-shift.photon-reddit.com/*',
    'https://api.pullpush.io/*',
    'https://removal.rosint.dev/*',
];

export async function missingOrigins(api = globalThis.browser ?? globalThis.chrome) {
    const checks = await Promise.all(REQUIRED_ORIGINS.map(async (origin) =>
        await api.permissions.contains({ origins: [origin] }) ? null : origin));
    return checks.filter(Boolean);
}

export async function connectionStatus({ api = globalThis.browser ?? globalThis.chrome, fetchImpl = fetch } = {}) {
    const missing = await missingOrigins(api);
    if (missing.length) return { ok: false, error: 'host-permission-required', missing };
    try {
        // This must run in the extension background, where host grants apply.
        const response = await fetchImpl(`${REMOVAL_ORIGIN}/api/config`, {
            credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = await response.json();
        if (typeof config.featuresEnabled !== 'boolean') throw new Error('Invalid configuration');
        if (config.featuresEnabled) {
            const list = await fetchImpl(`${REMOVAL_ORIGIN}/api/blocklist`, {
                credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
            });
            if (!list.ok) throw new Error(`Blocklist HTTP ${list.status}`);
            const payload = await list.json();
            if (!Array.isArray(payload.hashes) || payload.hashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid blocklist');
        }
        return { ok: true, missing: [] };
    } catch (error) {
        return { ok: false, error: 'connection-failed', detail: error.message, missing: [] };
    }
}
