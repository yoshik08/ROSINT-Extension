# Privacy policy

_Rosint Hidden History browser extension. Last updated: November 24, 2026._

Rosint Hidden History has no accounts, no analytics, no advertising and no
tracking. The developer runs no server that receives your data. This page
lists every network request the extension makes and everything it stores.

## What leaves your browser

The extension makes requests only on Reddit, and goes beyond Reddit itself
only for profiles that hide their history and, while you're signed out, for
adult communities and posts that Reddit won't show you:

| Recipient | What is sent | Why |
| --- | --- | --- |
| **Reddit** (`www.reddit.com`) | On a profile page: requests for that profile and for the items being restored, with your normal Reddit session, the same way Reddit's own page makes them. | To tell whether the profile hides its history, and to show each item's current text and score. |
| **Arctic Shift** (`arctic-shift.photon-reddit.com`) and **PullPush** (`api.pullpush.io`) | The username of the profile you're viewing, and post ids for comment headers. With Quiet Reddit on and signed out, Arctic Shift also receives the name of a community, or the id of a post, that Reddit refused to show you. | These public archives hold the restored posts and comments. |
| **Rosint removal service** (`removal.rosint.dev`) | Nothing about you or the profile. The extension downloads the full list of removed accounts (as SHA-256 hashes) and checks it locally. | So accounts that asked to be removed are never shown. |

Like any web request, these reach the recipient with your IP address and
browser user agent. Their own privacy policies apply. Rosint sends no
identifier of its own, and no cookies or credentials go to the archives or
the removal service.

Opening the extension's popup downloads the same removal list to show
whether the removal service is reachable. On other Reddit pages and on other
websites, the extension makes no requests.

## Quiet Reddit

Quiet Reddit is on by default and can be switched off in the popup. While
you're signed out of Reddit it removes Reddit's sign-in prompts, app banners
and mature-content gates from the page, and shows NSFW posts Reddit has
already sent without the blur. This happens entirely in your browser and
sends nothing anywhere.

To answer Reddit's "Are you over 18?" question the way you would, it sets
Reddit's own `over18=true` cookie on reddit.com, the same cookie Reddit sets
when you click "Yes, I'm Over 18". It never touches Reddit's sign-in cookies
or your account, and does nothing while you're signed in.

## What is stored on your device

Posts and comments the extension has already restored are kept in your
browser's extension storage (`storage.local`): up to 80 profile lists and the
titles of their parent posts. They let profiles open instantly and stay
readable while the archives are down. They are never synced or sent anywhere,
and they're checked against the removal list before being shown.

To delete them, click **Forget** in the extension's popup, or remove the
extension.

The Quiet Reddit switch is stored the same way (on or off, nothing else).

## Removal requests

To keep a Reddit account's history out of Rosint, use
[removal.rosint.dev](https://removal.rosint.dev/). Once a removal is approved,
the extension stops showing that account, including copies already saved in
browsers.

## Changes and contact

Changes to this policy are published in this repository with the release that
introduces them. For questions, open an issue at
https://github.com/yoshik08/ROSINT-Extension/issues.
