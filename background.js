// Polls luxthos.io for your LuxBux balance and stashes it in chrome.storage.
// The fetch runs here (the service worker), not in the Twitch page, so the
// luxthos.io session cookie rides along as a first-party request.

const BALANCE_URL = "https://luxthos.io/luxbux/api/me/balance";
const ALARM = "luxbux-poll";
const POLL_MINUTES = 1;

async function setState(patch) {
  const { state = {} } = await chrome.storage.local.get("state");
  await chrome.storage.local.set({ state: { ...state, ...patch, at: Date.now() } });
}

async function poll() {
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
    await setState({ status: "error", detail: String(e && e.message || e) });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  poll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
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

// Toolbar-icon click = manual refresh.
chrome.action.onClicked.addListener(poll);
