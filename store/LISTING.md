# Store listing

Copy and answers for the Chrome Web Store and Firefox Add-ons (AMO)
submission forms. Keep them in step with [PRIVACY.md](../PRIVACY.md) and the
manifests.

## Packages

| Store | Upload |
| --- | --- |
| Chrome Web Store | `extension/dist/rosint-chrome.zip` |
| Firefox Add-ons | `extension/dist/rosint-firefox.zip`, plus `extension/dist/rosint-source-<version>.zip` when asked for source code |

Build both with `npm run check`.

## Name and summary

**Name:** Rosint Hidden History

**Summary** (132 characters max; the same text as the manifest description):

> See what Reddit hides: hidden profile histories from public archives, and no sign-in nags or NSFW gates while signed out.

**Category:** Chrome: Social & Communication. Firefox: Social & Communication.

## Description

> When a Reddit account hides its posts and comments, Rosint fills its profile back in with the history that public archives saved: right on the profile, drawn to look like Reddit's own feed, in light and dark mode.
>
> • Built into the profile. Open a profile that hides its history and its posts and comments appear where they would be. Scroll for more, and sort with Reddit's own New/Hot/Top menu.
> • Honest about sources. A header says how many items were restored and whether they were checked against Reddit just now or are archived copies. Empty, restricted and failed lookups are explained.
> • Respects removals. Accounts that asked to be removed from Rosint are never shown, and nothing is shown when that can't be confirmed.
> • Fast on revisits. Profiles you've opened paint instantly from a copy kept on your device, and stay readable when the archives are down.
> • Quiet Reddit. While you're signed out, Reddit stops asking: no Google sign-in pop-up, no sign-up sheets when you vote, no "open the app" banners, and no "log in to confirm your age" gate. NSFW posts show without the blur, and adult communities Reddit won't show signed-out visitors are filled in from the public archive. One switch in the popup turns it off.
> • Private. No accounts, no analytics, no tracking. Open source.
>
> Restored history comes from the public Arctic Shift and PullPush archives. Rosint is not affiliated with Reddit, Arctic Shift or PullPush.
>
> To keep your own history out of Rosint, request removal at removal.rosint.dev.

**Homepage / support:** https://github.com/yoshik08/ROSINT-Extension
**Privacy policy URL:** https://github.com/yoshik08/ROSINT-Extension/blob/main/PRIVACY.md

## Images

- Icon: `extension/shared/assets/icons/icon-128.png` (96px artwork, 16px padding).
- Screenshots, 1280x800: generate with
  `npm run ext:store:shots -- <hidden profile>`, which writes
  `extension/dist/store/`. These show a real account's history, so use a profile
  you're comfortable publishing (your own, for example).
- Popup states (for the description or a promo tile): `store/screenshots/`.

## Chrome: privacy practices tab

**Single purpose:**
> Shows Reddit content that Reddit hides from the viewer: the history of profiles that hide it (from public archives), and, while signed out, posts Reddit puts behind sign-in prompts and mature-content gates.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Keeps posts and comments the user has already restored on this device so profiles open instantly and stay readable during archive outages. Never synced; cleared by "Forget" in the popup. |
| Host `www.reddit.com` | Content scripts run on Reddit pages: on profiles they detect hidden history, insert restored rows and read Reddit's own JSON for the profile being viewed; for signed-out viewers they remove Reddit's sign-in prompts and mature-content gates. |
| Host `arctic-shift.photon-reddit.com` | Public archive the restored posts and comments come from. |
| Host `api.pullpush.io` | Second public archive, used to fill gaps. |
| Host `removal.rosint.dev` | Downloads the removal list so accounts that requested removal are never shown. |

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension.

**Data usage:** tick **Web history** only. The username of the Reddit profile
being viewed is sent to the public archives to retrieve its history, and,
for signed-out viewers with Quiet Reddit on, the name of an adult community
or post id that Reddit refused to show. Leave every other category unticked.

**Mature content:** the extension contains none, but it shows Reddit's NSFW
posts to signed-out adults. Mark the listing as mature (18+) where the form
offers it.

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Firefox: submission notes

- The manifest declares `data_collection_permissions.required: ["browsingActivity"]`
  for the same reason (the viewed profile's username goes to the archives).
  Firefox shows this in the install prompt.
- **Notes to reviewer:**
  > The bundles (quiet.js, content.js, background.js, popup.js) are generated by a dependency-free concatenating bundler; nothing is minified. To rebuild: unzip the source archive, run `node extension/scripts/build.mjs` (Node 20.11+), and compare `extension/firefox/`. Builds are reproducible. To test: open https://www.reddit.com/user/<any account that hides its history>/. Restored rows appear under the profile tabs. A public profile such as /user/spez/ is left untouched. Quiet Reddit: signed out, open https://www.reddit.com/r/AskReddit/ (no Google sign-in pop-up or sign-up rail; voting no longer opens a sign-up modal; Log In still works) and an NSFW community (no age gate, posts unblurred). It can be switched off in the popup.
- License: MIT.
