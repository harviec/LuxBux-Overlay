// Toolbar popup: shows the current balance and lets you edit which channels the
// overlay appears on.

// Firefox = promise-based `browser`; Chrome/Edge = `chrome` (promises in MV3).
const ext = globalThis.browser || globalThis.chrome;

const $ = (s) => document.querySelector(s);
const LUX_ORIGIN = "https://luxthos.io/*";
const DEFAULTS = {
  showAll: false,
  channels: ["luxthos", "luxthoshobbies"],
  grow: "left",
  anchor: "player",
  gamePollSec: 30,
};
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n) || lo));
const HINT = "One channel per line — the name from its URL.";

const send = (m) => Promise.resolve(ext.runtime.sendMessage(m)).catch(() => {});

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
  if (state.status === "ok") el.textContent = Number(state.balance).toLocaleString("en-US");
  else if (state.status === "logged-out") el.textContent = "log in";
  else if (state.status === "needs-permission") el.textContent = "no access";
  else el.textContent = "—";
}

async function hasAccess() {
  try {
    return await ext.permissions.contains({ origins: [LUX_ORIGIN] });
  } catch (e) {
    return true;
  }
}

function pick(name, values, fallback) {
  const el = $(`input[name="${name}"]:checked`);
  return el && values.includes(el.value) ? el.value : fallback;
}

function readForm() {
  return {
    showAll: $('input[name="scope"]:checked').value === "all",
    grow: pick("grow", ["left", "right"], "left"),
    anchor: pick("anchor", ["player", "window"], "player"),
    gamePollSec: clampInt(parseInt($("#gamepoll").value, 10), 15, 120),
    channels: parseChannels($("#channels").value),
  };
}

function syncGamePollLabel() {
  $("#gamepollVal").textContent = $("#gamepoll").value + "s";
}

function syncDisabled() {
  $("#channels").disabled = $('input[name="scope"]:checked').value === "all";
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await ext.storage.local.set({ settings: readForm() });
      const h = $("#hint");
      h.textContent = "Saved ✓";
      h.classList.add("is-saved");
      setTimeout(() => {
        h.textContent = HINT;
        h.classList.remove("is-saved");
      }, 1400);
    } catch (e) {
      $("#hint").textContent = "Couldn't save: " + (e && e.message || e);
    }
  }, 400);
}

async function init() {
  let settings = DEFAULTS;
  let state;
  try {
    const r = (await ext.storage.local.get(["settings", "state"])) || {};
    if (r.settings) settings = { ...DEFAULTS, ...r.settings };
    state = r.state;
  } catch (e) {
    /* first run / storage unavailable — fall back to defaults */
  }

  renderState(state);
  $("#channels").value = (settings.channels || []).join("\n");
  $(`input[name="scope"][value="${settings.showAll ? "all" : "list"}"]`).checked = true;
  $(`input[name="grow"][value="${settings.grow === "right" ? "right" : "left"}"]`).checked = true;
  $(`input[name="anchor"][value="${settings.anchor === "window" ? "window" : "player"}"]`).checked = true;
  $("#gamepoll").value = clampInt(settings.gamePollSec, 15, 120);
  syncDisabled();
  syncGamePollLabel();
  $("#grant").hidden = await hasAccess();

  document.addEventListener("input", (e) => {
    if (e.target.name === "scope") syncDisabled();
    if (e.target.id === "gamepoll") syncGamePollLabel();
    scheduleSave();
  });

  $("#refresh").addEventListener("click", () => send({ t: "refresh", force: true }));

  $("#grant").addEventListener("click", async () => {
    try {
      await ext.permissions.request({ origins: [LUX_ORIGIN] });
    } catch (e) {
      /* Chrome: already a manifest grant */
    }
    $("#grant").hidden = await hasAccess();
    send({ t: "refresh", force: true });
  });

  ext.storage.onChanged.addListener((c, area) => {
    if (area === "local" && c.state) renderState(c.state.newValue);
  });
}

init();
