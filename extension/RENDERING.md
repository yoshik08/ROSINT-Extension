# Rendering

## Where the feed goes

The restored feed is one `[data-rosint-feed]` element placed directly before
Reddit's hidden-history panel (or appended inside `shreddit-feed` when a profile
has a feed but nothing in it). Reddit's panel is hidden only while rows or
skeletons are on screen. Whenever there is nothing to show (empty archive,
restricted account, outage) the panel comes back and the Rosint header above it
says why. Navigating away removes the feed and restores Reddit's markup exactly.

```
[data-rosint-feed]
  [data-rosint-header]   shadow root: provenance header + first-load skeletons
  [data-rosint-list]     restored rows (article[data-rosint-item], one shadow root each)
  [data-rosint-footer]   shadow root: next-page skeleton, end-of-history marker
  [data-rosint-sentinel] infinite-scroll trigger
```

## Rows

`shared/visibleCard.js` draws each row to match Reddit's profile feed, measured
from the live site (Nov 2026): posts 4px/16px padding with a 16px hover radius,
comments 8px/16px, 24px community avatar, 18/24 semibold titles, 14/21 body,
32px action pills. Colours come from Reddit's theme variables
(`--color-neutral-*`, `--color-secondary-*`, `--color-primary`), so light and
dark mode follow the page; fallbacks are Reddit's light values.

* Text is Reddit-flavoured markdown rendered by `shared/markdown.js` into DOM
  nodes. Archive text is never parsed as HTML; links keep only http(s) and
  Reddit-relative targets and open external sites with `noopener`.
* Times read "24m ago" with the full date on hover. Rows whose live state could
  not be checked carry `data-rosint-archived` and say so in that tooltip; the
  header says it once for the whole feed.
* Long bodies are measured and clamped (6 lines for posts, 12 for comments)
  with a "Show more" toggle.
* Galleries have arrow buttons, dots, a counter and arrow-key support. Slides
  that fail, or that load Reddit's/Imgur's deleted-image placeholder, are
  dropped; with none left the media block is removed.
* NSFW and spoiler media are blurred behind a reveal button.
* Votes and comments link to the real item on Reddit; Share copies its link.
  Nothing simulates a vote.

## Native HTML upgrade (removed in 1.1.0)

1.0.x swapped rows for Reddit's own server-rendered cards fetched from
`/by_id/` or the permalink. On the live site those pages return post-detail
markup (back button, page-sized title), so upgraded rows looked unlike the feed
around them, and logged-out viewers get 403 for `/by_id/` anyway. The rows above
are now the only renderer.

## Verification

* `npm run ext:test` covers markdown, formatting, cards, the injector state
  machine, pagination, restrictions and sanitisation (happy-dom).
* `npm run ext:test:e2e` runs the packaged Chrome build against controlled
  network responses.
* `npm run ext:live:chrome` runs the packaged Chrome build against the real
  removal service and archives on a reddit.com-origin fixture page (automated
  Chromium gets Reddit's "Prove your humanity" challenge, so Reddit's own markup
  is a fixture there).
* `npm run ext:live:firefox -- <user> [--dark] [--width 420] [--scroll]` and
  `npm run ext:live:spa -- <user>` run the packaged Firefox add-on headless on
  the real reddit.com profile, with screenshots in `extension/dist/live/`.
* `npm run ext:live:timing -- <user>` times navigation to first row on the real
  page in Firefox, cold and on a revisit (Nov 2026: 5.2s cold including 2.6s of
  Reddit page load; revisit rows appear with the page at 1.9s).
* `npm run ext:outage` (Chrome) fills the saved copy from the real archives,
  then fails every archive request and checks the saved copy is shown, and that
  a never-seen profile retries once and then explains the outage.
* `npm run ext:popup:shots` renders every popup state to `extension/dist/popup/`.
