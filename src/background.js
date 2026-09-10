// Fetches your LuxBux balance from luxthos.io and stashes it in extension
// storage. The fetch runs here (the background context), not in the Twitch
// page, so the luxthos.io session cookie rides along as a first-party request.
//
// Polling is entirely driven by an open Twitch tab: the content script asks for
// a refresh on arrival, on tab-focus, and every 15s *only while the stream it's
// on is live*. Nothing is fetched when no tab is open, the tab is hidden, or the
// channel is offline. Manual refresh (toolbar popup / clicking the chip) always
// works.
//
// Cross-browser: runs as a Chrome/Edge service worker and a Firefox event page.
// Both suspend when idle, so nothing here relies on in-memory state surviving —
// `state` is always read back from storage.
// Firefox = promise-based `browser`; Chrome/Edge = `chrome` (promises in MV3).
const ext = globalThis.browser || globalThis.chrome;

const BALANCE_URL = "https://luxthos.io/luxbux/api/me/balance";
const GAME_URL = "https://luxthos.io/game/api/play";
const LUX_ORIGIN = "https://luxthos.io/*";

// Which channels the overlay shows on, until the popup changes it.
const DEFAULT_SETTINGS = {
  showAll: false,
  channels: ["luxthos", "luxthoshobbies"],
  grow: "left", // direction the box expands as the number gets longer
  anchor: "player", // "player" tracks the video; "window" pins to the viewport
};

// Collapse near-simultaneous refresh requests (multiple tabs, a click landing
// right after a tick) into one fetch. A forced request skips this.
const MIN_GAP_MS = 8000;
let lastPollAt = 0;

// The game-state endpoint is heavier and dungeon runs last hours, so poll it
// far less often than the balance.
const GAME_MIN_GAP_MS = 60000;
let lastGamePollAt = 0;

const ROMAN = ["I", "II", "III", "IV", "V"];
function tsToMs(s) {
  if (!s) return null;
  const str = String(s);
  const iso = /[zZ]$|[+\-]\d\d:?\d\d$/.test(str) ? str.replace(" ", "T") : str.replace(" ", "T") + "Z";
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

// ---- toolbar icon --------------------------------------------------------
// green  = on an allowed channel, connected, stream live (polling)
// blue   = on an allowed channel, connected, stream offline (idle)
// yellow = on Twitch, still connecting or missing the luxthos.io permission
// red    = on Twitch, but logged out / a fetch is failing
// gray   = not on a Twitch page (manifest default_icon)
const RGB = {
  green: [0x3f, 0xba, 0x74],
  blue: [0x4a, 0x95, 0xe0],
  yellow: [0xf0, 0xbe, 0x46],
  red: [0xe2, 0x5c, 0x5c],
  gray: [0x82, 0x8a, 0xa0],
};
const ICON_PATHS = {
  green: { 16: "icons/green-16.png", 32: "icons/green-32.png" },
  blue: { 16: "icons/blue-16.png", 32: "icons/blue-32.png" },
  yellow: { 16: "icons/yellow-16.png", 32: "icons/yellow-32.png" },
  red: { 16: "icons/red-16.png", 32: "icons/red-32.png" },
  gray: { 16: "icons/gray-16.png", 32: "icons/gray-32.png" },
};
const TITLES = {
  green: "LuxBux — connected · stream live",
  blue: "LuxBux — connected · stream offline",
  yellow: "LuxBux — finishing setup (open this popup)",
  red: "LuxBux — not connected (check your luxthos.io login)",
  gray: "LuxBux — open a Twitch channel",
};

// tabId -> { live, allowed } from that tab's last check-in. Transient: the
// content script re-sends it every 15s and whenever it changes.
const tabInfo = new Map();

function colorFor(state, info) {
  const s = state && state.status;
  if (s === "logged-out" || s === "error") return "red";
  if (s === "needs-permission") return "yellow";
  if (s !== "ok") return "yellow"; // no reading yet — still connecting
  if (info && info.allowed && info.live === false) return "blue";
  return "green";
}

// Draw the coloured disc as ImageData — more reliable than a `path` from a
// suspended background than it sounds, especially on Firefox event pages.
const _iconCache = {};
function iconData(color) {
  if (_iconCache[color] !== undefined) return _iconCache[color];
  const rgb = RGB[color] || RGB.gray;
  const dark = `rgb(${(rgb[0] * 0.58) | 0},${(rgb[1] * 0.58) | 0},${(rgb[2] * 0.58) | 0})`;
  try {
    const out = {};
    for (const size of [16, 32]) {
      const cv = new OffscreenCanvas(size, size);
      const g = cv.getContext("2d");
      const c = size / 2;
      g.beginPath();
      g.arc(c, c, size * 0.42, 0, Math.PI * 2);
      g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      g.fill();
      g.lineWidth = Math.max(1, size * 0.09);
      g.strokeStyle = dark;
      g.stroke();
      out[size] = g.getImageData(0, 0, size, size);
    }
    _iconCache[color] = out;
  } catch (e) {
    _iconCache[color] = null; // no OffscreenCanvas — caller falls back to path
  }
  return _iconCache[color];
}

async function paintTab(tabId, colorOverride) {
  let color = colorOverride;
  if (!color) {
    const { state } = await ext.storage.local.get("state");
    color = colorFor(state, tabInfo.get(tabId));
  }
  const data = iconData(color);
  const iconArg = data ? { tabId, imageData: data } : { tabId, path: ICON_PATHS[color] };
  try {
    await ext.action.setIcon(iconArg);
    await ext.action.setTitle({ tabId, title: TITLES[color] });
  } catch (e) {
    try {
      await ext.action.setIcon({ tabId, path: ICON_PATHS[color] });
      await ext.action.setTitle({ tabId, title: TITLES[color] });
    } catch (e2) {
      console.warn("[LuxBux] setIcon failed", color, (e2 && e2.message) || e2);
    }
  }
}

async function paintAll() {
  const { state } = await ext.storage.local.get("state");
  await Promise.all([...tabInfo].map(([id, info]) => paintTab(id, colorFor(state, info))));
}

// ---- balance polling ---------------------------------------------------
async function setState(patch) {
  const { state: prev = {} } = await ext.storage.local.get("state");
  const next = { ...prev, ...patch, at: Date.now() };
  await ext.storage.local.set({ state: next });
  await paintAll();
}

// Firefox MV3 can treat host permissions as opt-in; Chrome/Edge grant them at
// install. Either way, confirm before we bother fetching.
async function hasHostAccess() {
  try {
    return await ext.permissions.contains({ origins: [LUX_ORIGIN] });
  } catch (e) {
    return true; // permissions API hiccup — let the fetch itself be the test
  }
}

async function poll() {
  lastPollAt = Date.now();
  if (!(await hasHostAccess())) return setState({ status: "needs-permission" });
  try {
    const res = await fetch(BALANCE_URL, { credentials: "include", cache: "no-store" });
    if (res.status === 401) return setState({ status: "logged-out" });
    if (!res.ok) return setState({ status: "error", detail: "HTTP " + res.status });
    const data = await res.json();
    if (typeof data.balance !== "number") return setState({ status: "error", detail: "bad response" });
    return setState({ status: "ok", balance: data.balance });
  } catch (e) {
    return setState({ status: "error", detail: String((e && e.message) || e) });
  }
}

// GET /game/api/play -> full game state. We keep only what the chip needs:
// whether a dungeon run or a post-death recovery is in progress, and when it ends.
async function pollGame() {
  lastGamePollAt = Date.now();
  if (!(await hasHostAccess())) return;
  try {
    const res = await fetch(GAME_URL, { credentials: "include", cache: "no-store" });
    if (!res.ok) return setState({ game: { off: true } });
    const d = await res.json();
    if (!d || d.error) return setState({ game: { off: true } });

    const game = {};
    const run = d.run;
    if (run && run.tier != null) {
      const dg = (d.dungeons || []).find(
        (x) => run.tier >= x.fromTier && run.tier <= x.fromTier + ROMAN.length - 1
      );
      const numeral = dg ? ROMAN[run.tier - dg.fromTier] : "";
      game.dungeon = dg ? (dg.name + (numeral ? " " + numeral : "")) : "a dungeon";
      game.endsAt = tsToMs(run.endsAt);
    }
    const lockedUntil = tsToMs(d.lockedUntil);
    if (lockedUntil && lockedUntil > Date.now()) game.lockedUntil = lockedUntil;

    return setState({ game });
  } catch (e) {
    /* transient — the next poll tries again; leave the last game state in place */
  }
}

// ---- wiring ----------------------------------------------------------
ext.runtime.onInstalled.addListener(async () => {
  const { settings } = await ext.storage.local.get("settings");
  if (!settings) await ext.storage.local.set({ settings: DEFAULT_SETTINGS });
  await poll(); // one fetch so the first Twitch tab shows a number immediately
});

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // A Twitch tab checking in: record live/allowed state and colour its icon.
  // `return true` + sendResponse keeps the background alive until the async
  // setIcon resolves — without it Firefox suspends the event page first and
  // the icon never updates.
  if (msg.t === "onTwitch") {
    const id = sender && sender.tab && sender.tab.id;
    if (id == null) return;
    tabInfo.set(id, { live: !!msg.live, allowed: !!msg.allowed });
    paintTab(id).finally(() => sendResponse(true));
    return true;
  }

  if (msg.t === "refresh") {
    if (msg.force || Date.now() - lastPollAt >= MIN_GAP_MS) {
      poll().finally(() => sendResponse(true));
      return true;
    }
    sendResponse(false);
    return;
  }

  if (msg.t === "refreshGame") {
    if (Date.now() - lastGamePollAt >= GAME_MIN_GAP_MS) {
      pollGame().finally(() => sendResponse(true));
      return true;
    }
    sendResponse(false);
    return;
  }
});

// Forget closed tabs; grey the icon when a tracked tab navigates away from Twitch
// (the content script re-checks in if the new page is still Twitch).
ext.tabs.onRemoved.addListener((tabId) => tabInfo.delete(tabId));
ext.tabs.onUpdated.addListener((tabId, info) => {
  if (info && info.status === "loading" && tabInfo.has(tabId)) {
    tabInfo.delete(tabId);
    paintTab(tabId, "gray");
  }
});
