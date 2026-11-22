import { BLOCKED_HASHES } from '../../src/blockedHashes.js';
import { createBlocklistClient } from '../../src/blocklistClient.js';
import { createRestrictionCheck } from '../../src/restrictions.js';
import { REMOVAL_ORIGIN } from './config.js';

// The extension's restriction gate: the website's static hashes plus the same
// removal-service client, with the extension's own origin (the worker's host
// permission bypasses CORS). createBlocklistClient fails closed — any outage,
// timeout or malformed payload answers "restricted", so the feed stays
// untouched exactly like rosint.dev does.
export function createRestrictionGate({
    origin = REMOVAL_ORIGIN,
    fetchImpl,
    blockedHashes = BLOCKED_HASHES,
    now,
} = {}) {
    const dynamicallyBlocked = createBlocklistClient({
        origin,
        ...(fetchImpl ? { fetcher: fetchImpl } : {}),
        ...(now ? { now } : {}),
    });
    return createRestrictionCheck({ blockedHashes, dynamicallyBlocked });
}
