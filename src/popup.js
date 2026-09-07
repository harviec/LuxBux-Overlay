// Toolbar popup: shows the current balance and lets you edit which channels the
// overlay appears on.

const $ = (s) => document.querySelector(s);
const LUX_ORIGIN = "https://luxthos.io/*";
const DEFAULTS = { showAll: false, channels: ["luxthos", "luxthoshobbies"] };
const HINT = "One channel per line — the name from its URL.";

// Accepts "luxthos", "@luxthos", "twitch.tv/luxthos/videos", full URLs, commas.
function parseChannels(text) {
  const seen = new Set();
  for (let tok of text.split(/[\s,]+/)) {
    tok = tok
      .trim()
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/^(https?:\/\/)?(www\.|m\.)?twitch\.tv\//, "")
      .replace(/[/?#].*$/, "");
    if (/^[a-z0-9_]{2,25}$/.test(tok)) seen.add(tok);
  }
  return [...seen];
}

function renderState(state) {
  const el = $("#balValue");
  if (!state) return void (el.textContent = "—");
  if (state.status === "ok") el.textContent = state.balance.toLocaleString("en-US");
  else if (state.status === "logged-out") el.textContent = "log in";
  else if (state.status === "needs-permission") el.textContent = "no access";
  else el.textContent = "—";
}

async function hasAccess() {
  try {
    return await chrome.permissions.contains({ origins: [LUX_ORIGIN] });
  } catch (e) {
    return true;
  }
}

function readForm() {
  const showAll = $('input[name="scope"]:checked').value === "all";
  return { showAll, channels: parseChannels($("#channels").value) };
}

function syncDisabled() {
  $("#channels").disabled = $('input[name="scope"]:checked').value === "all";
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ settings: readForm() });
    const h = $("#hint");
    h.textContent = "Saved ✓";
    h.classList.add("is-saved");
    setTimeout(() => {
      h.textContent = HINT;
      h.classList.remove("is-saved");
    }, 1400);
  }, 400);
}

async function init() {
  const { settings = DEFAULTS, state } = await chrome.storage.local.get(["settings", "state"]);
  renderState(state);

  $("#channels").value = (settings.channels || []).join("\n");
  $(`input[name="scope"][value="${settings.showAll ? "all" : "list"}"]`).checked = true;
  syncDisabled();

  $("#grant").hidden = await hasAccess();

  document.addEventListener("input", (e) => {
    if (e.target.name === "scope") syncDisabled();
    scheduleSave();
  });

  $("#refresh").addEventListener("click", () =>
    chrome.runtime.sendMessage({ t: "refresh", force: true }).catch(() => {})
  );

  $("#grant").addEventListener("click", async () => {
    try {
      await chrome.permissions.request({ origins: [LUX_ORIGIN] });
    } catch (e) {
      /* Chrome: already a manifest grant */
    }
    $("#grant").hidden = await hasAccess();
    chrome.runtime.sendMessage({ t: "refresh", force: true }).catch(() => {});
  });

  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && c.state) renderState(c.state.newValue);
  });
}

init();
