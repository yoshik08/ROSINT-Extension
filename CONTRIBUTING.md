# Contributing

Thanks for helping. Bug reports, fixes and improvements are welcome.

## Setup

```bash
npm install
npm run check
```

`npm run check` runs eslint, the core and extension test suites, the build
and `web-ext lint`. CI runs the same command on every pull request.

Load the built extension unpacked as described in the [README](README.md#install).
After editing anything in `extension/shared/`, rebuild with
`npm run build` and reload the extension.

## Ground rules

- **Edit `extension/shared/`, never the generated files** in
  `extension/chrome/` or `extension/firefox/` (only `manifest.json` is
  source there).
- **No HTML from data.** Archive and Reddit text must become DOM nodes or text
  nodes. A test fails on `innerHTML`, `insertAdjacentHTML`, `eval` and similar
  sinks.
- **Restrictions first.** Any new path to archive data, saved copies included,
  must go through the restriction gate and fail closed.
- **No new permissions or hosts** without discussion in an issue first. Every
  permission has to be justified in the store listing.
- **Keep the bundler happy.** Modules are concatenated into classic scripts:
  only relative static imports, named exports, and top-level names unique
  across all bundled modules.
- **Be kind to the archives.** Don't loop the live scripts. PullPush asks
  automated clients to back off.
- Add or update tests with every behaviour change.

## Code in `src/`

`src/` holds the archive, retry and restriction clients that rosint.dev also
uses. Changes there affect both projects, so explain the website impact in
your pull request.

## Releases

1. Bump `version` in both manifests and `package.json`, and add a
   `CHANGELOG.md` entry.
2. Run `npm run check`.
3. Upload `extension/dist/rosint-chrome.zip` to the Chrome Web Store, and
   `extension/dist/rosint-firefox.zip` plus `rosint-source-<version>.zip` to
   Firefox Add-ons. See [store/LISTING.md](store/LISTING.md).
4. Tag `v<version>` and attach the three archives to a GitHub release.
