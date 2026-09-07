# LuxBux Overlay

A tiny browser extension that floats your **LuxBux** balance (from
`luxthos.io/luxbux/`) on top of Twitch. Only *you* see it — it's painted in your
own browser, not composited into anyone's stream.

## How it works

- `luxthos.io` serves the balance from a small JSON endpoint,
  `GET /luxbux/api/me/balance` → `{ "balance": 100 }`, authenticated by your
  normal luxthos.io login cookie.
- `background.js` (the extension's service worker) fetches that endpoint every
  ~60s. Because the request is made from the extension, your luxthos.io session
  cookie is sent as a first-party request — no scraping, no separate login.
- `overlay.js` draws the box on `twitch.tv` and updates it whenever the stored
  balance changes. Drag it anywhere (position is remembered); single-click it to
  refresh immediately.
- If you're not logged into luxthos.io in this browser, the box shows
  **"log in"** — visit luxthos.io, log in with Twitch, then click the box.

## Install (Chrome / Edge)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `luxbux-overlay` folder.
4. Open (or reload) a `twitch.tv` tab. The gold box appears top-right.

Make sure you're logged into `luxthos.io` in the same browser profile.

## Tweaks

- **Size / colours:** `overlay.css` — `.luxbux-value` `font-size` is the main
  dial (currently `21px`; the site uses `40px`).
- **Default corner:** `#luxbux-overlay` `top` / `right` in `overlay.css`.
- **Poll rate:** `POLL_MINUTES` in `background.js` (Chrome's alarm minimum is
  ~1 min; focus/click refreshes fill the gaps).
- **Where it shows:** the `matches` array in `manifest.json`. Use
  `"<all_urls>"` to float it on every site.

## Firefox

Firefox needs a couple of manifest changes (`browser_specific_settings` with an
add-on id, and `background.scripts` instead of `background.service_worker`).
Ask if you want a Firefox build.

## Notes

- This only reads your own balance through the same API the site's own page
  uses. It doesn't touch anyone else's stream or data.
- The Space Grotesk font is loaded from Google Fonts to match the site; if
  Twitch's content policy blocks it, the box falls back to your system font.
