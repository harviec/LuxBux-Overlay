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
// Firefox = promise-based `browser`; Chrome/Edge = `chrome` (promises in MV3).
const ext = globalThis.browser || globalThis.chrome;

const BALANCE_URL = "https://luxthos.io/luxbux/api/me/balance";
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

let currentState = null;
ext.storage.local.get("state").then((r) => {
  currentState = (r && r.state) || null;
});

// ---- toolbar icon --------------------------------------------------------
// green  = on Twitch, luxthos.io reachable and logged in
// yellow = on Twitch, still connecting or missing the luxthos.io permission
// red    = on Twitch, but logged out / a fetch is failing
// gray   = not on a Twitch page (manifest default_icon)
const ICONS = {
  green: { 16: "icons/green-16.png", 32: "icons/green-32.png" },
  yellow: { 16: "icons/yellow-16.png", 32: "icons/yellow-32.png" },
  red: { 16: "icons/red-16.png", 32: "icons/red-32.png" },
  gray: { 16: "icons/gray-16.png", 32: "icons/gray-32.png" },
};
const TITLES = {
  green: "LuxBux — connected",
  yellow: "LuxBux — finishing setup (open this popup)",
  red: "LuxBux — not connected (check your luxthos.io login)",
  gray: "LuxBux — open a Twitch channel",
};

const twitchTabs = new Set();

function colorFor(state) {
  const s = state && state.status;
  if (s === "ok") return "green";
  if (s === "logged-out" || s === "error") return "red";
  if (s === "needs-permission") return "yellow";
  return "yellow"; // no reading yet — still connecting
}

async function paintTab(tabId, color) {
  try {
    await ext.action.setIcon({ tabId, path: ICONS[color] });
    await ext.action.setTitle({ tabId, title: TITLES[color] });
  } catch (e) {
    /* tab already gone */
  }
}

function paintAllTwitch() {
  const color = colorFor(currentState);
  for (const id of twitchTabs) paintTab(id, color);
}

// ---- balance polling ---------------------------------------------------
async function setState(patch) {
  currentState = { ...(currentState || {}), ...patch, at: Date.now() };
  await ext.storage.local.set({ state: currentState });
  paintAllTwitch();
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
  if (!(await hasHostAccess())) {
    await setState({ status: "needs-permission" });
    return;
  }
  try {
    const res = await fetch(BALANCE_URL, { credentials: "include", cache: "no-store" });

    if (res.status === 401) {
      await setState({ status: "logged-out" });
      return;
    }
    if (!res.ok) {
      await setState({ status: "error", detail: "HTTP " + res.status });
      return;
    }

    const data = await res.json();
    if (typeof data.balance !== "number") {
      await setState({ status: "error", detail: "unexpected response" });
      return;
    }
    await setState({ status: "ok", balance: data.balance });
  } catch (e) {
    await setState({ status: "error", detail: String((e && e.message) || e) });
  }
}

// ---- wiring ----------------------------------------------------------
ext.runtime.onInstalled.addListener(async () => {
  const { settings } = await ext.storage.local.get("settings");
  if (!settings) await ext.storage.local.set({ settings: DEFAULT_SETTINGS });
  poll(); // one fetch so the first Twitch tab shows a number immediately
});

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // A Twitch tab checking in: remember it and colour its icon. No fetch here —
  // the content script sends an explicit "refresh" when one is actually wanted.
  if (msg.t === "onTwitch") {
    const id = sender && sender.tab && sender.tab.id;
    if (id != null) {
      twitchTabs.add(id);
      paintTab(id, colorFor(currentState));
    }
    return;
  }

  if (msg.t === "refresh") {
    if (msg.force || Date.now() - lastPollAt >= MIN_GAP_MS) {
      poll().then(() => sendResponse(true));
      return true;
    }
    sendResponse(false);
    return;
  }
});

// Forget closed tabs; grey the icon when a tracked tab navigates away from Twitch
// (the content script re-checks in if the new page is still Twitch).
ext.tabs.onRemoved.addListener((tabId) => twitchTabs.delete(tabId));
ext.tabs.onUpdated.addListener((tabId, info) => {
  if (info && info.status === "loading" && twitchTabs.has(tabId)) {
    twitchTabs.delete(tabId);
    paintTab(tabId, "gray");
  }
});
