# Privacy policy

_Rosint Hidden History browser extension. Last updated: November 22, 2026._

Rosint Hidden History has no accounts, no analytics, no advertising and no
tracking. The developer runs no server that receives your data. This page
lists every network request the extension makes and everything it stores.

## What leaves your browser

The extension makes requests only on Reddit profile pages, and goes beyond
Reddit itself only for profiles that hide their history:

| Recipient | What is sent | Why |
| --- | --- | --- |
| **Reddit** (`www.reddit.com`) | On a profile page: requests for that profile and for the items being restored, with your normal Reddit session, the same way Reddit's own page makes them. | To tell whether the profile hides its history, and to show each item's current text and score. |
| **Arctic Shift** (`arctic-shift.photon-reddit.com`) and **PullPush** (`api.pullpush.io`) | The username of the profile you're viewing, and post ids for comment headers. | These public archives hold the restored posts and comments. |
| **Rosint removal service** (`removal.rosint.dev`) | Nothing about you or the profile. The extension downloads the full list of removed accounts (as SHA-256 hashes) and checks it locally. | So accounts that asked to be removed are never shown. |

Like any web request, these reach the recipient with your IP address and
browser user agent. Their own privacy policies apply. Rosint sends no
identifier of its own, and no cookies or credentials go to the archives or
the removal service.

Opening the extension's popup downloads the same removal list to show
whether the removal service is reachable. On other Reddit pages and on other
websites, the extension makes no requests.

## What is stored on your device

Posts and comments the extension has already restored are kept in your
browser's extension storage (`storage.local`): up to 80 profile lists and the
titles of their parent posts. They let profiles open instantly and stay
readable while the archives are down. They are never synced or sent anywhere,
and they're checked against the removal list before being shown.

To delete them, click **Forget** in the extension's popup, or remove the
extension.

## Removal requests

To keep a Reddit account's history out of Rosint, use
[removal.rosint.dev](https://removal.rosint.dev/). Once a removal is approved,
the extension stops showing that account, including copies already saved in
browsers.

## Changes and contact

Changes to this policy are published in this repository with the release that
introduces them. For questions, open an issue at
https://github.com/yoshik08/ROSINT-Extension/issues.
