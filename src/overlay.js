// Draws the little floating LuxBux box on Twitch and keeps it in sync with
// whatever background.js last stored. Drag to move (position is remembered),
// single-click to force a refresh. Same file for Chrome, Edge and Firefox.
//
// The box only appears on the channels chosen in the toolbar popup (default:
// luxthos + luxthoshobbies), or everywhere if "All Twitch channels" is picked.

(() => {
  // Firefox injects content scripts into child frames (incl. about:blank ones
  // Twitch spawns); only ever run in the real top page.
  if (window.top !== window.self) return;
  // Idempotent: never end up with two boxes even if the script runs twice.
  if (window.__luxbuxOverlay || document.getElementById("luxbux-overlay")) return;
  window.__luxbuxOverlay = true;

  // Firefox = promise-based `browser`; Chrome/Edge = `chrome` (promises in MV3).
  const ext = globalThis.browser || globalThis.chrome;

  const REFRESH_MS = 15000; // same cadence luxthos.io's own page uses
  const DEFAULTS = { showAll: false, channels: ["luxthos", "luxthoshobbies"] };

  const msg = (m) => Promise.resolve(ext.runtime.sendMessage(m)).catch(() => {});
  const ask = (force) => msg({ t: "refresh", force: !!force });
  // Tells the background "a Twitch tab is here" so it colours the toolbar icon
  // and keeps the balance fresh even on non-Luxthos channels.
  const ping = () => msg({ t: "onTwitch" });

  // Best-effort: match the site's display font. If Twitch's CSP blocks this,
  // it silently falls back to the system stack in overlay.css.
  if (!document.getElementById("luxbux-font")) {
    const link = document.createElement("link");
    link.id = "luxbux-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap";
    document.head.appendChild(link);
  }

  const box = document.createElement("div");
  box.id = "luxbux-overlay";
  box.title = "LuxBux";
  box.hidden = true; // stays hidden until we know we're on an allowed channel
  // Inline fallback in case overlay.css is blocked — keeps a hidden box hidden.
  box.style.display = "none";
  box.innerHTML =
    '<div class="luxbux-label">LuxBux</div>' +
    '<div class="luxbux-value-wrap">' +
    '<span class="luxbux-value">—</span>' +
    '<span class="luxbux-delta"></span>' +
    "</div>";
  document.documentElement.appendChild(box);

  const valueEl = box.querySelector(".luxbux-value");
  const deltaEl = box.querySelector(".luxbux-delta");
  let shown = null; // last numeric balance we rendered

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function render(state) {
    if (!state) return;
    box.classList.toggle("is-problem", state.status !== "ok");

    if (state.status === "needs-permission") {
      valueEl.textContent = "enable";
      box.title = "Open the LuxBux toolbar popup and grant luxthos.io access";
      return;
    }
    if (state.status === "logged-out") {
      valueEl.textContent = "log in";
      box.title = "Open luxthos.io and log in with Twitch, then click here";
      return;
    }
    if (state.status === "error") {
      box.title = "Can't reach luxthos.io (" + (state.detail || "error") + ") — retrying";
      if (shown == null) valueEl.textContent = "—";
      return;
    }

    box.title = "LuxBux · click to refresh";
    const bal = state.balance;
    valueEl.textContent = bal.toLocaleString("en-US");

    if (shown != null && bal > shown) {
      deltaEl.textContent = "+" + (bal - shown).toLocaleString("en-US");
      deltaEl.classList.add("is-shown");
      replay(valueEl, "is-bumped");
      replay(box, "is-earning");
      setTimeout(() => deltaEl.classList.remove("is-shown"), 3000);
    }
    shown = bal;
  }

  // ---- which channel are we on, and is it allowed? ------------------------
  let settings = DEFAULTS;
  let onAllowed = false;

  function currentChannel() {
    if (location.hostname === "player.twitch.tv") {
      return (new URLSearchParams(location.search).get("channel") || "").toLowerCase();
    }
    const parts = location.pathname.split("/").filter(Boolean);
    let seg = (parts[0] || "").toLowerCase();
    // /moderator/<channel>, /popout/<channel>/chat
    if ((seg === "moderator" || seg === "popout") && parts[1]) seg = parts[1].toLowerCase();
    return seg;
  }

  function allowedHere() {
    if (settings && settings.showAll === true) return true;
    const list = (settings && settings.channels) || [];
    const ch = currentChannel();
    return !!ch && list.some((c) => String(c).toLowerCase() === ch);
  }

  function applyGate() {
    const show = allowedHere();
    box.hidden = !show;
    box.style.display = show ? "" : "none";
    if (show && !onAllowed && !document.hidden) ask(); // warm the value on arrival
    onAllowed = show;
  }

  // ---- load + react to storage ------------------------------------------
  Promise.resolve(ext.storage.local.get(["settings", "state", "pos"]))
    .then((r) => {
      r = r || {};
      if (r.settings) settings = { ...DEFAULTS, ...r.settings };
      if (r.pos) {
        box.style.left = r.pos.left;
        box.style.top = r.pos.top;
        box.style.right = "auto";
      }
      render(r.state);
      applyGate();
    })
    .catch(() => applyGate());

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.state) render(changes.state.newValue);
    if (changes.settings) {
      settings = { ...DEFAULTS, ...changes.settings.newValue };
      applyGate();
    }
  });

  ping(); // register this tab with the background right away

  // Twitch is a single-page app — watch for channel changes without a reload.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      applyGate();
    }
  }, 700);

  // ---- drag to move / click to refresh ---------------------------------
  let drag = null;

  box.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, rect: box.getBoundingClientRect(), moved: false };
    box.setPointerCapture(e.pointerId);
  });

  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    box.style.left = drag.rect.left + dx + "px";
    box.style.top = drag.rect.top + dy + "px";
    box.style.right = "auto";
  });

  box.addEventListener("pointerup", () => {
    if (!drag) return;
    if (drag.moved) {
      ext.storage.local.set({ pos: { left: box.style.left, top: box.style.top } });
    } else {
      ask(true); // manual click: refresh now, skip the debounce
    }
    drag = null;
  });

  // ---- keep it live ---------------------------------------------------
  // Every 15s while visible: check in (icon + warm value). On an allowed
  // channel that also refreshes the number the box is showing.
  setInterval(() => {
    if (document.hidden) return;
    ping();
    if (onAllowed) ask();
  }, REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    ping();
    if (onAllowed) ask();
  });
})();
