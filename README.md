# LuxBux Overlay

A small browser extension that floats your **LuxBux** balance (from
[luxthos.io/luxbux/](https://luxthos.io/luxbux/)) on top of Twitch. Only *you*
see it — it's drawn in your own browser, not composited into anyone's stream.

One shared codebase for **Chrome**, **Edge**, and **Firefox** (142+).

## Features

- Compact gold balance chip, styled after luxthos.io's own card.
- Refreshes every **15 s** while a Twitch tab is open and visible — the same
  cadence the site's page uses — with a "+N" pop when you earn.
- Shows **only on the channels you pick** (default: `luxthos`,
  `luxthoshobbies`), or everywhere. Editable from the toolbar popup.
- By default it's **pinned to the video player** and tracks it through page
  scroll, theater mode and fullscreen. Its spot is stored as a fraction of the
  player, so it holds the same position relative to the video at every size
  rather than drifting. Can be switched to window-pinned in the popup.
- Drag it anywhere; the spot is remembered across reloads. It stays pinned to
  a corner and grows inward as the number gains digits, so it never slides off
  screen. Grow direction is a setting.
- The **toolbar icon is a status light** (green / yellow / red / gray).

## How it works

- luxthos.io serves the balance from a small JSON endpoint,
  `GET /luxbux/api/me/balance` → `{ "balance": 100 }`, authenticated by your
  normal luxthos.io login cookie.
- `src/background.js` (a service worker on Chrome/Edge, an event page on
  Firefox) does the fetch. Because the request comes from the extension your
  luxthos.io session cookie is sent as a first-party request — no scraping, no
  separate login. Requests from multiple tabs / clicks are debounced; a
  1-minute alarm is a slow fallback for a long-hidden tab.
- `src/overlay.js` runs on `*://*.twitch.tv/*`, draws the chip, and reads the
  stored balance. It parses the channel from the URL (handling `/moderator/…`,
  `/popout/…`, and `player.twitch.tv`) and follows Twitch's in-page navigation,
  so the chip shows/hides on channel changes without a reload. Position is a
  fraction of the player's bounding box, recomputed on scroll / resize / a
  `ResizeObserver` (theater mode) / `fullscreenchange` — where the chip is also
  moved into the fullscreen element so it stays visible.
- `src/popup.html` is the toolbar popup: balance readout, a refresh button, the
  channel list, and the grow-direction choice. Settings live in
  `chrome.storage.local` and autosave.

Nothing leaves your browser except the request to luxthos.io. No analytics, no
other hosts (the display font is the only optional external load — see Notes).

## Toolbar icon colour

| Colour | Meaning |
| --- | --- |
| 🟢 green | On Twitch, luxthos.io reachable and logged in |
| 🟡 yellow | On Twitch, still connecting — or the luxthos.io permission isn't granted yet (open the popup) |
| 🔴 red | On Twitch, but logged out of luxthos.io or a fetch is failing |
| ⚪ gray | Not on a Twitch page |

It's per-tab, so switching tabs updates it. The chip itself also shows
**"log in"** or **"enable"** when something needs your attention.

## The popup

Click the toolbar icon. In **Firefox** a just-loaded add-on's icon often sits in
the `»` overflow / extensions menu — pin it, or open the same screen via
`about:addons` → LuxBux Overlay → **Options**.

- **Show the overlay on** — *These channels* (one per line; accepts a name,
  `@name`, or a full `twitch.tv/…` URL, normalised on save) or *All Twitch
  channels*.
- **Pin the overlay to** — *The video player* (tracks it through theater and
  fullscreen) or *The browser window* (fixed on screen).
- **When the number gets longer, grow** — *← Left* (stay pinned to the right)
  or *Right →* (stay pinned to the left). The "+N" pop follows it.

Changes save automatically and apply to open Twitch tabs immediately.

## Layout

```
src/                     shared, unbundled extension code
  background.js           fetch + debounce + poll alarm + toolbar icon
  overlay.js              the chip: channel gating, player/window anchoring, SPA nav
  overlay.css             chip styling
  popup.html/.js/.css     toolbar popup / options page
  icons/                  generated status discs (gold/gray/green/yellow/red)
manifests/
  manifest.chrome.json    Chrome + Edge (MV3 service worker)
  manifest.firefox.json   Firefox 142+ (MV3 event page, gecko id, data-consent)
tools/make-icons.mjs      regenerates src/icons/ (pure Node, no deps)
build.ps1 / build.sh      assemble dist/chrome + dist/firefox (+ zips)
```

`src/` is loadable as-is during development; `background.js` / `overlay.js` /
`popup.js` all start from `const ext = globalThis.browser || globalThis.chrome`
so the same code gets promise-based APIs on every browser.

## Build

```bash
./build.ps1
```

(or `./build.sh` on a POSIX shell) — writes:

```
dist/chrome/    dist/firefox/            load-unpacked folders
dist/luxbux-overlay-chrome.zip
dist/luxbux-overlay-firefox.zip
```

Each folder is `src/` plus the right `manifest.json`. `dist/` is git-ignored.

## Install — Chrome / Edge

1. `./build.ps1`
2. Open `chrome://extensions` (or `edge://extensions`) and turn on
   **Developer mode**.
3. **Load unpacked** → select `dist/chrome`.
4. Open or reload `twitch.tv/luxthos`.

Be logged into `luxthos.io` in the same browser profile. Pin the extension icon
to reach the popup.

## Install — Firefox

**Temporary** (simplest; removed on restart):

1. `./build.ps1`
2. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
   `dist/firefox/manifest.json`.
3. If the chip shows **"enable"**, open the popup and click
   **Grant luxthos.io access**.

**Permanent** (regular Firefox requires a signed build):

1. Free account at <https://addons.mozilla.org>.
2. Submit `dist/luxbux-overlay-firefox.zip` as an **unlisted** add-on — it stays
   private and Mozilla auto-signs it.
3. Download the signed `.xpi` → `about:addons` → gear →
   **Install Add-on From File…**.

`npx web-ext sign --channel unlisted` does the same from the command line.
Firefox **Developer Edition / Nightly** can skip signing with
`about:config` → `xpinstall.signatures.required` = `false`.

Lint a build with `npx web-ext lint --source-dir dist/firefox`.

## Tweaks

| Want to change | Where |
| --- | --- |
| Chip size | `.luxbux-value` `font-size` in `src/overlay.css` (`21px`; site uses `40px`) |
| Starting corner | `#luxbux-overlay` `top` / `right` in `src/overlay.css` (until first drag) |
| Refresh rate | `REFRESH_MS` in `src/overlay.js` (`15000`); keep it above `MIN_GAP_MS` in `src/background.js` |
| Default channels / grow / anchor | `DEFAULTS` in `src/overlay.js` and `DEFAULT_SETTINGS` in `src/background.js` |
| Player detection (if Twitch renames classes) | `PLAYER_SELECTORS` in `src/overlay.js` |
| Run beyond Twitch | `matches` in both manifests (`"<all_urls>"` — channel gating still applies unless "all" is picked) |
| Icon colours | `COLORS` in `tools/make-icons.mjs`, then rerun it; `ICONS` / `TITLES` / `colorFor()` in `src/background.js` |

## Notes

- This reads only your own balance, through the same API the site's own page
  uses. It doesn't touch anyone else's stream or data.
- Player-pinned: as you scroll and the player slides under Twitch's header the
  chip rides the visible edge, then hides once the player is essentially gone —
  it reappears when you scroll back. Switch to window-pinned if you'd rather it
  always stay put.
- Space Grotesk is loaded from Google Fonts to match the site; if a browser's
  content policy blocks it, the chip falls back to the system font.
- Not affiliated with Luxthos. Personal tool, not published to any store.
