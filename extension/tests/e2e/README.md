# Live end-to-end tests

These suites drive a real browser against reddit.com with the built extension
loaded. They are skipped unless both usernames are provided:

| Variable | Meaning |
| --- | --- |
| `REDDIT_HIDDEN_USER` | a profile whose post/comment history is hidden (the extension must fill it) |
| `REDDIT_VISIBLE_USER` | a profile with visible history (used as the pixel reference and the "untouched" control) |
| `ROSINT_E2E_HEADED` | optional; set to run Firefox with a visible window |

```bash
npm run ext:build

# Chrome (Playwright's bundled Chromium, headed because extensions load there)
npx playwright install chromium
REDDIT_HIDDEN_USER=hidden_account REDDIT_VISIBLE_USER=visible_account npm run ext:test:e2e

# Firefox (needs geckodriver on PATH; installs dist/rosint-firefox.zip temporarily)
# Windows (PowerShell):
$env:REDDIT_HIDDEN_USER='hidden_account'; $env:REDDIT_VISIBLE_USER='visible_account'; npm run ext:test:e2e
```

The style assertion compares computed `font-family`, `font-size`,
`font-weight`, `line-height`, `color`, `background-color`, `padding`, `margin`
and the item's left edge and width against a native item on the visible
profile. Height is measured but not compared: two different posts differ in
body length, which is content, not chrome.

Both suites assert the same five things: a hidden profile gets items, an
injected item is pixel-identical to a native one, a visible profile is
untouched, tab switching injects the right kind per tab, and scrolling loads a
second archive page.
