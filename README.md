# LuxBux Overlay

A tiny browser extension that floats your **LuxBux** balance (from
`luxthos.io/luxbux/`) on top of Twitch. Only *you* see it — it's painted in your
own browser, not composited into anyone's stream.

Works on **Chrome**, **Edge**, and **Firefox** from one shared codebase.

## How it works

- `luxthos.io` serves the balance from a small JSON endpoint,
  `GET /luxbux/api/me/balance` → `{ "balance": 100 }`, authenticated by your
  normal luxthos.io login cookie.
- While a Twitch tab is open and visible, the overlay refreshes every **15s** —
  the same cadence luxthos.io's own page uses. `src/background.js` does the
  actual fetch (from the extension, so your luxthos.io session cookie is sent as
  a first-party request — no scraping, no separate login) and a 1-minute alarm
  is a slow fallback for a long-hidden tab.
- `src/overlay.js` draws the box on `twitch.tv` and updates it whenever the
  stored balance changes. Drag it anywhere (position is remembered); single-click
  it to refresh immediately.
- The box only appears on the channels you choose (see below); on every other
  channel it stays hidden and the extension does nothing. Twitch's in-page
  navigation is handled, so switching channels shows/hides it without a reload.
- Box states: a number (normal), **"log in"** (not logged into luxthos.io in this
  browser — visit the site, log in, then click the box), **"enable"** (Firefox
  only — open the toolbar popup and grant luxthos.io access).

## Toolbar icon colour

The extension icon is a status light:

| Colour | Meaning |
| --- | --- |
| 🟢 green | On Twitch, luxthos.io reachable and logged in |
| 🟡 yellow | On Twitch, still connecting — or the luxthos.io permission isn't granted yet (open the popup) |
| 🔴 red | On Twitch, but logged out of luxthos.io or a fetch is failing |
| ⚪ gray | Not on a Twitch page |

It's per-tab, so switching tabs updates it.

## Choosing which channels

Click the extension's toolbar icon for a small popup (in **Firefox** a
just-loaded add-on's icon often sits in the » overflow / extensions menu — pin
it, or reach the same screen via `about:addons` → LuxBux Overlay → **Options**):

- **These channels** — a text box, one channel per line. Defaults to `luxthos`
  and `luxthoshobbies`. Paste a name, an `@name`, or a full `twitch.tv/...` URL;
  it's normalised on save.
- **All Twitch channels** — show the overlay everywhere on Twitch.

Changes save automatically and take effect on open Twitch tabs immediately.

## Layout

```
src/                     shared code
  background.js           fetches the balance, debounces, drives the icon
  overlay.js              draws the box, channel gating, SPA nav watch
  overlay.css             box styling
  popup.html/.js/.css     toolbar popup — balance + channel list editor
  icons/                  generated status discs (gold/gray/green/yellow/red)
manifests/
  manifest.chrome.json   Chrome + Edge (MV3 service worker)
  manifest.firefox.json  Firefox 142+ (MV3 event page + gecko id)
tools/make-icons.mjs     regenerates src/icons/ (pure Node)
build.ps1 / build.sh     assembles dist/chrome + dist/firefox (+ zips)
```

## Build

```powershell
./build.ps1
```

(or `./build.sh` on a POSIX shell). Produces:

```
dist/chrome/    dist/firefox/          <- load-unpacked folders
dist/luxbux-overlay-chrome.zip
dist/luxbux-overlay-firefox.zip
```

For quick dev you can also just load `manifests/manifest.chrome.json`'s folder by
hand, but the build script keeps the two manifests in sync with `src/`.

## Install — Chrome / Edge

1. `./build.ps1`
2. Chrome: `chrome://extensions` · Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. **Load unpacked** → select `dist/chrome`.
5. Open/reload `twitch.tv/luxthos`. The gold box appears top-right.

Be logged into `luxthos.io` in the same browser profile. Pin the extension icon
to reach the channel-list popup.

## Install — Firefox

**Temporary (simplest, gone on restart):**

1. `./build.ps1`
2. Go to `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on…** → pick `dist/firefox/manifest.json`.
4. If the box shows **"enable"**, open the toolbar popup and click
   **Grant luxthos.io access**.

**Permanent, regular Firefox** (needs a signed build — Mozilla requires it):

1. Make a free account at <https://addons.mozilla.org>.
2. Submit `dist/luxbux-overlay-firefox.zip` as an **unlisted** add-on (it's only
   for you; it won't appear in the store). Mozilla auto-signs it.
3. Download the signed `.xpi`, then in `about:addons` use the gear →
   **Install Add-on From File…**.

Alternatively `npx web-ext sign --channel unlisted` does the same from the
command line, or use Firefox **Developer Edition / Nightly / ESR** with
`about:config` → `xpinstall.signatures.required` = `false` and install the zip
directly.

## Tweaks

- **Size / colours:** `src/overlay.css` — `.luxbux-value` `font-size` is the main
  dial (currently `21px`; the site uses `40px`).
- **Default corner:** `#luxbux-overlay` `top` / `right` in `src/overlay.css`.
- **Poll rate:** `REFRESH_MS` in `src/overlay.js` (default `15000`). The
  `MIN_GAP_MS` debounce in `src/background.js` should stay below that.
- **Which channels:** the toolbar popup. The baked-in default is in
  `DEFAULT_SETTINGS` (`src/background.js`) and `DEFAULTS` (`src/overlay.js`).
- **Beyond Twitch:** the `matches` array in both manifests. Use `"<all_urls>"`
  to run it on every site (channel gating still applies unless "all" is picked).
- **Icon colours:** `ICONS` / `TITLES` / `colorFor()` in `src/background.js`;
  regenerate the discs with `node tools/make-icons.mjs` after editing `COLORS`.

## Notes

- This only reads your own balance through the same API the site's own page
  uses. It doesn't touch anyone else's stream or data.
- The Space Grotesk font is loaded from Google Fonts to match the site; if a
  browser's content policy blocks it, the box falls back to the system font.
