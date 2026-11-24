# Changelog

All notable changes to the extension. Versions match `manifest.json`.

## 1.4.0 (2026-11-24)

Quiet Reddit, and a bug-fix pass.

### Added
- **Quiet Reddit**, on by default with a switch in the popup. While you're
  signed out, Reddit's Google sign-in pop-up, sign-up rail, sign-up modals
  (on votes, comments and the timer) and "open the app" banners and sheets
  are removed, on desktop and Firefox for Android. Clicking **Log In** still
  opens Reddit's sign-in, and sign-in pages are left alone.
- NSFW while signed out: the "log in to confirm your age" gate is removed,
  blurred NSFW posts are shown, and the "Are you over 18?" guard is answered
  for you with Reddit's own `over18` cookie, so guarded communities open
  straight away.
- Adult communities and posts that Reddit tells signed-out visitors "don't
  exist" are filled in from Arctic Shift: the community's posts newest first
  with infinite scroll, or the post followed by its comments. Rows by
  accounts on the removal list are dropped, and removed posts stay hidden as
  they would on Reddit.
- Restored NSFW media is shown without the click-to-view veil while Quiet
  Reddit is on and you're signed out. Spoilers keep theirs.

### Fixed
- A restored feed whose first page didn't reach the bottom of the screen
  stopped loading until you scrolled. It now keeps going by itself.
- Signed out, every page of restored rows repeated a Reddit live lookup that
  Reddit always refuses. One refusal now covers the next five minutes.
- `createOrder()` without an explicit clock compared every row against
  `NaN` and hid them all.

### Changed
- A second content script (`quiet.js`, at `document_start`) runs on Reddit
  pages. Each bundle now runs in its own function scope so the two scripts
  can share the page's isolated world.
- The manifest description and store listing cover Quiet Reddit. No new
  permissions.

## 1.3.0 (2026-11-22)

Quality and store-readiness pass.

### Security
- Links whose target contains a backslash or control characters are no longer
  rendered. Browsers read `/\host` as `//host`, so a comment could show a
  Reddit-looking link that opened another site.
- Parent-post title links now validate the archive's permalink like every
  other link.
- Hostile comment text can no longer freeze the tab. Inline markdown nesting
  is capped and delimiter scans are memoised: 40,000 carets (`^^^…`) used to
  take about a minute to render and now take a few milliseconds.

### Fixed
- Logged-out viewers whose Reddit is not in English now get restored
  history. Reddit localises the hidden-history notice, which the extension
  only recognised in English; the notice block is now recognised by its
  structure.
- The SPA watcher no longer reads the layout of every restored row on each of
  Reddit's DOM changes, which caused jank while scrolling long feeds.
- A profile waiting for Reddit to mount its feed no longer re-sends three
  Reddit requests on every DOM change.
- Saved copies: posts and comments saved at the same moment could drop each
  other from the index, so **Forget** missed them. Writes are now serialised,
  and **Forget** also sweeps any list an older version lost track of.
- Copy link falls back to a selection copy when the clipboard API is blocked,
  instead of opening the item.
- After the extension updates, the old content script on open tabs stops
  cleanly instead of erroring.

### Changed
- Popup: actions sit side by side, the stats grid uses valid `dt`/`dd` order,
  status changes are announced once to screen readers instead of on every
  poll, and Firefox for Android gets a full-width sheet layout. The footer
  links to the source code.
- The 128px icon has the 16px padding the Chrome Web Store expects.
- Firefox manifest declares `browsingActivity` data transmission: the viewed
  profile's username is sent to the public archives.
- Both manifests list `www.reddit.com` as a host permission, and gain
  `short_name` and `homepage_url`.
- Builds are reproducible (fixed archive timestamps), and each build writes a
  source archive for store review.
- Live test scripts read profile names from the environment instead of
  hard-coding accounts.

## 1.2.0 (2026-11-16)

- Saved copies: profiles you've opened paint instantly and stay readable when
  both archives are down.
- Arctic Shift's transient "Timeout" errors are retried. PullPush gets a
  single attempt and a five-minute breaker.
- Popup shows each service's health as observed from real requests.

## 1.1.0 (2026-11-16)

- Rows redrawn to match Reddit's profile feed in light and dark mode.
- Provenance header, skeletons and an end-of-history marker.
- New AMOLED popup.
