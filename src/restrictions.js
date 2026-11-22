// Usernames that have requested removal. Lowercase, no "u/" prefix.
// SHA-256 hashes of removed usernames (lowercased, "u/" stripped).
import { normalizeUsername } from "./normalizeUsername.js";

// Hash of the normalized, lowercased username. Hashed so the names appear
// nowhere in the repo or the shipped bundle.
export async function hashUsername(name) {
    const norm = normalizeUsername(name).toLowerCase();
    if (!norm) return "";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One restriction rule for both front ends: a static hash hit, or the removal
// service's dynamic answer, refuses every archive request. The browser
// extension builds this with the same list and its own blocklist client, so the
// website and the extension can never disagree about who is restricted.
export function createRestrictionCheck({ blockedHashes, dynamicallyBlocked }) {
    return async function isBlockedUser(name) {
        const hex = await hashUsername(name);
        if (!hex) return false;
        return blockedHashes.includes(hex) || await dynamicallyBlocked(hex);
    };
}
