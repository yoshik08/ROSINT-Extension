# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/yoshik08/ROSINT-Extension/security/advisories/new)
rather than in a public issue. Include the browser and extension version,
steps to reproduce, and the impact you expect.

You'll get an acknowledgement within a few days. Fixes ship as a new store
release, and the advisory is published once users have had time to update.

## Scope

In scope:

- Script execution or HTML injection from archive or Reddit data rendered by
  the extension.
- Links or navigation that leave Reddit while appearing internal.
- Any way to view a restricted (removed) account's history through the
  extension, including from saved copies.
- Messages from web pages or other extensions being accepted by the
  extension's worker.
- Data leaving the browser beyond what [PRIVACY.md](PRIVACY.md) describes.

Out of scope: the availability or content of Reddit, Arctic Shift or PullPush,
and issues that need a malicious extension or local access already installed
on the device.

## Supported versions

Only the latest released version gets security fixes.
