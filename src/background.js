// Polls luxthos.io for your LuxBux balance and stashes it in chrome.storage.
// The fetch runs here (the background context), not in the Twitch page, so the
// luxthos.io session cookie rides along as a first-party request.
//
// Cross-browser: the `chrome.*` namespace is also provided by Firefox MV3, so
// the same file runs as a Chrome/Edge service worker and a Firefox event page.

const BALANCE_URL = "https://luxthos.io/luxbux/api/me/balance";
const LUX_ORIGIN = "https://luxthos.io/*";
const ALARM = "luxbux-poll";
const POLL_MINUTES = 1;

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

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  poll();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  poll();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) poll();
});

// The overlay asks for a fresh pull when a Twitch tab regains focus or is clicked.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg === "luxbux:refresh") {
    poll().then(() => sendResponse(true));
    return true;
  }
});

// Toolbar-icon click = grant host access if we still need it (Firefox), then refresh.
chrome.action.onClicked.addListener(async () => {
  if (!(await hasHostAccess())) {
    try {
      await chrome.permissions.request({ origins: [LUX_ORIGIN] });
    } catch (e) {
      // Chrome won't request a manifest host permission (already granted); ignore.
    }
  }
  poll();
});
