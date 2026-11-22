# Shared clients

These modules are also used by the [rosint.dev](https://rosint.dev) website,
so the site and the extension can never disagree about how archives are
paged and merged, or about who is restricted.

| Module | Purpose |
| --- | --- |
| `archive.js` | Arctic Shift + PullPush requests, merge/dedupe, timestamp pagination |
| `postLookup.js` | Retry with backoff and `Retry-After`, batched parent-post lookups |
| `blocklistClient.js` | Removal-service client (fails closed) |
| `restrictions.js` | The restriction check: static hashes plus the removal service |
| `blockedHashes.js` | SHA-256 hashes of accounts that requested removal |
| `normalizeUsername.js` | Strips URLs, `u/` prefixes and `@` from usernames |

Comments that mention `App.jsx` or `scripts/` refer to the website's
repository. The extension bundles these files with
`extension/scripts/build.mjs`; they are covered by `tests/` and the
extension's own suites.
