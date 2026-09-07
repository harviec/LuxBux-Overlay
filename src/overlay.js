// Draws the little floating LuxBux box on Twitch and keeps it in sync with
// whatever background.js last stored. Drag to move (position is remembered),
// single-click to force a refresh. Same file for Chrome, Edge and Firefox.
//
// The box only appears on the channels chosen in the toolbar popup (default:
// luxthos + luxthoshobbies), or everywhere if "All Twitch channels" is picked.
// By default it's pinned to a corner of the video player and tracks it through
// scroll, theater mode and fullscreen; the popup can switch it to the window.

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
  const DEFAULTS = {
    showAll: false,
    channels: ["luxthos", "luxthoshobbies"],
    grow: "left", // which way the box expands as the number gets more digits
    anchor: "player", // "player" tracks the video; "window" pins to the viewport
  };

  // Twitch renames classes often — first match with a plausible size wins,
  // then the <video> element as a last resort.
  const PLAYER_SELECTORS = [
    ".video-player__container",
    "[data-a-target='video-player']",
    ".persistent-player",
    ".video-player",
  ];

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
    if (show) {
      if (!onAllowed && !document.hidden) ask(); // warm the value on arrival
      scheduleReposition();
    }
    onAllowed = show;
  }

  // ---- position: pinned to the player (default) or the window ------------
  let drag = null;
  let pos = null; // { hEdge, h, vEdge, v } — insets from a corner of hostRect()

  const anchorsToPlayer = () => !settings || settings.anchor !== "window";
  const growsLeft = () => !settings || settings.grow !== "right";

  function applyGrow() {
    box.classList.toggle("grow-left", growsLeft());
    box.classList.toggle("grow-right", !growsLeft());
  }

  function playerEl() {
    for (const s of PLAYER_SELECTORS) {
      const el = document.querySelector(s);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 240 && r.height > 120) return el;
      }
    }
    const v = document.querySelector("video");
    return v && v.getBoundingClientRect().width > 240 ? v : null;
  }

  // The rectangle the box is positioned within: the player, or the viewport.
  function hostRect() {
    if (anchorsToPlayer()) {
      const el = playerEl();
      if (el) return el.getBoundingClientRect();
    }
    return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
  }

  function reposition() {
    if (drag || box.hidden) return;
    const host = hostRect();
    const w = box.offsetWidth || 90;
    const h = box.offsetHeight || 40;
    const p = pos || { hEdge: growsLeft() ? "right" : "left", h: 12, vEdge: "top", v: 12 };

    let left = p.hEdge === "left" ? host.left + p.h : host.right - p.h - w;
    let top = p.vEdge === "top" ? host.top + p.v : host.bottom - p.v - h;

    // Vertical/horizontal travel is bounded by the host AND the viewport, so the
    // box rides the visible part of the player as it scrolls under Twitch's
    // chrome, then tucks away once the player is basically gone.
    const loL = Math.max(2, host.left + 2);
    const hiL = Math.min(innerWidth - w - 2, host.right - w - 2);
    const loT = Math.max(2, host.top + 2);
    const hiT = Math.min(innerHeight - h - 2, host.bottom - h - 2);
    if (hiL < loL || hiT < loT) {
      box.style.visibility = "hidden";
      return;
    }
    box.style.visibility = "";
    box.style.left = Math.round(clamp(left, loL, hiL)) + "px";
    box.style.top = Math.round(clamp(top, loT, hiT)) + "px";
    box.style.right = "auto";
    box.style.bottom = "auto";
  }

  // Turn the box's current on-screen rect into corner insets and remember them.
  function savePos() {
    const b = box.getBoundingClientRect();
    const host = hostRect();
    const hEdge = growsLeft() ? "right" : "left";
    const vEdge = b.top + b.height / 2 < host.top + host.height / 2 ? "top" : "bottom";
    pos = {
      hEdge,
      vEdge,
      h: Math.round(hEdge === "left" ? b.left - host.left : host.right - b.right),
      v: Math.round(vEdge === "top" ? b.top - host.top : host.bottom - b.bottom),
    };
    ext.storage.local.set({ pos });
    reposition();
  }

  function loadPos(saved) {
    if (!saved) return (pos = null);
    if (saved.hEdge && saved.vEdge) return (pos = saved);
    // migrate earlier shapes: {hEdge,h,top} then {left,top}
    if (saved.hEdge) {
      return (pos = { hEdge: saved.hEdge, h: saved.h, vEdge: "top", v: parseInt(saved.top, 10) || 12 });
    }
    if (saved.left != null) {
      return (pos = {
        hEdge: "left",
        h: parseInt(saved.left, 10) || 12,
        vEdge: "top",
        v: parseInt(saved.top, 10) || 12,
      });
    }
    pos = null;
  }

  let rafPending = 0;
  function scheduleReposition() {
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = 0;
      reposition();
    });
  }

  function onFullscreenChange() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fs || document.documentElement;
    // A fixed box outside the fullscreen subtree isn't rendered — follow it in.
    if (box.parentElement !== parent) parent.appendChild(box);
    scheduleReposition();
  }

  let ro = null;
  let roEl = null;
  function watchPlayer() {
    const el = anchorsToPlayer() ? playerEl() : null;
    if (el === roEl) return;
    if (ro) ro.disconnect();
    roEl = el;
    if (el && window.ResizeObserver) {
      ro = new ResizeObserver(scheduleReposition);
      ro.observe(el);
    }
  }

  addEventListener("scroll", scheduleReposition, { passive: true, capture: true });
  addEventListener("resize", scheduleReposition);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  // ---- load + react to storage ------------------------------------------
  Promise.resolve(ext.storage.local.get(["settings", "state", "pos"]))
    .then((r) => {
      r = r || {};
      if (r.settings) settings = { ...DEFAULTS, ...r.settings };
      loadPos(r.pos);
      applyGrow();
      render(r.state);
      applyGate();
      watchPlayer();
      reposition();
    })
    .catch(() => applyGate());

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.state) render(changes.state.newValue);
    if (changes.settings) {
      const before = { grow: growsLeft(), player: anchorsToPlayer() };
      settings = { ...DEFAULTS, ...changes.settings.newValue };
      applyGrow();
      watchPlayer();
      // Keep the box where it sits, but re-derive the anchor for the new mode.
      if ((growsLeft() !== before.grow || anchorsToPlayer() !== before.player) && !box.hidden) {
        savePos();
      } else {
        reposition();
      }
      applyGate();
    }
  });

  ping(); // register this tab with the background right away

  // Catch-all: channel switches (SPA), theater toggles, player re-mounts.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      applyGate();
    }
    watchPlayer();
    reposition();
  }, 1000);

  // ---- drag to move / click to refresh ---------------------------------
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
    box.style.bottom = "auto";
  });

  box.addEventListener("pointerup", () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) savePos();
    else ask(true); // manual click: refresh now, skip the debounce
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
