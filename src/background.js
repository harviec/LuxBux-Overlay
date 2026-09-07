// Polls luxthos.io for your LuxBux balance and stashes it in chrome.storage.
// The fetch runs here (the background context), not in the Twitch page, so the
// luxthos.io session cookie rides along as a first-party request.
//
// Cross-browser: the `chrome.*` namespace is also provided by Firefox MV3, so
// the same file runs as a Chrome/Edge service worker and a Firefox event page.

const BALANCE_URL = "https://luxthos.io/luxbux/api/me/balance";
const LUX_ORIGIN = "https://luxthos.io/*";
const ALARM = "luxbux-poll";

// Which channels the overlay shows on, until the popup changes it.
const DEFAULT_SETTINGS = { showAll: false, channels: ["luxthos", "luxthoshobbies"] };

// The open Twitch tab drives the fast 15s cadence (see overlay.js); this alarm
// is only a slow backstop for when a tab is open but long-hidden/throttled.
const POLL_MINUTES = 1;

// Collapse near-simultaneous refresh requests (multiple tabs, a click landing
// right after a tick) into one fetch. A forced request skips this.
const MIN_GAP_MS = 8000;
let lastPollAt = 0;

async function setState(patch) {
  const { state = {} } = await chrome.storage.local.get("state");
  await chrome.storage.local.set({ state: { ...state, ...patch, at: Date.now() } });
}

// Firefox MV3 can treat host permissions as opt-in; Chrome/Edge grant them at
// install. Either way, confirm before we bother fetching.
async function hasHostAccess() {
  try {
    return await chrome.permissions.contains({ origins: [LUX_ORIGIN] });
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

function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
}

chrome.runtime.onInstalled.addListener(async () => {
  ensureAlarm();
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  poll();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  poll();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) poll();
});

// The overlay pings every 15s while its tab is visible, on focus, and on click.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.t === "refresh") {
    if (!msg.force && Date.now() - lastPollAt < MIN_GAP_MS) {
      sendResponse(false);
      return;
    }
    poll().then(() => sendResponse(true));
    return true;
  }
});
