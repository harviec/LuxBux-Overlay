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
  const askGame = () => msg({ t: "refreshGame" }); // dungeon / recovery status
  // Tells the background "a Twitch tab is here" so it colours the toolbar icon
  // and keeps the balance fresh even on non-Luxthos channels.
  const ping = () => msg({ t: "onTwitch", allowed: onAllowed, live: streamLive() });

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

  const labelEl = box.querySelector(".luxbux-label");
  const valueEl = box.querySelector(".luxbux-value");
  const deltaEl = box.querySelector(".luxbux-delta");
  let shown = null; // last numeric balance we rendered

  // Game state (from /game/api/play, via the background): while a dungeon run or
  // a post-death recovery is active, the chip alternates every few seconds
  // between the LuxBux number and the time left.
  const ALT_MS = 4500;
  let latest = null; // last full state object
  let game = null; // latest.game
  let earnHoldUntil = 0; // pin the balance view briefly after earning
  let curPhase = 0; // 0 = balance, 1 = time

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  }

  // What the "time" half of the alternation shows right now, or null if neither
  // a run nor a recovery is in progress.
  function timeView(now) {
    if (game && game.lockedUntil && game.lockedUntil > now) {
      return { label: "Recovering", value: fmtDur(game.lockedUntil - now), mod: "is-recovering" };
    }
    if (game && game.endsAt && game.endsAt > now && game.dungeon) {
      return { label: "In dungeon", value: fmtDur(game.endsAt - now), mod: "is-dungeon" };
    }
    return null;
  }

  // Stash the state and react to earnings; the actual painting is done by tick().
  function render(state) {
    if (!state) return;
    latest = state;
    game = state.game || null;

    box.classList.toggle("is-problem", state.status !== "ok");
    if (state.status !== "ok") {
      box.classList.remove("is-dungeon", "is-recovering", "show-time", "is-swapping");
    }

    if (state.status === "needs-permission") {
      labelEl.textContent = "LuxBux";
      valueEl.textContent = "enable";
      box.title = "Open the LuxBux toolbar popup and grant luxthos.io access";
      return;
    }
    if (state.status === "logged-out") {
      labelEl.textContent = "LuxBux";
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

    if (shown != null && bal > shown) {
      deltaEl.textContent = "+" + (bal - shown).toLocaleString("en-US");
      deltaEl.classList.add("is-shown");
      replay(valueEl, "is-bumped");
      replay(box, "is-earning");
      earnHoldUntil = Date.now() + 3500; // let the "+N" be seen on the balance view
      setTimeout(() => deltaEl.classList.remove("is-shown"), 3000);
    }
    shown = bal;
    tick();
  }

  // Runs every second: ticks the countdown and flips balance <-> time.
  function tick() {
    if (!latest || latest.status !== "ok") return;
    const now = Date.now();
    const tv = timeView(now);

    box.classList.toggle("is-dungeon", !!tv && tv.mod === "is-dungeon");
    box.classList.toggle("is-recovering", !!tv && tv.mod === "is-recovering");

    const phase = tv && now >= earnHoldUntil ? Math.floor(now / ALT_MS) % 2 : 0;

    if (phase === 1 && tv) {
      box.classList.add("show-time");
      if (phase !== curPhase) swap(tv.label, tv.value);
      else valueEl.textContent = tv.value; // keep the seconds moving
    } else {
      box.classList.remove("show-time");
      const balText = latest.balance.toLocaleString("en-US");
      if (phase !== curPhase) swap("LuxBux", balText);
      else valueEl.textContent = balText;
    }
    curPhase = phase;
  }

  // Brief cross-fade when the two views trade places.
  function swap(label, value) {
    box.classList.add("is-swapping");
    setTimeout(() => {
      labelEl.textContent = label;
      valueEl.textContent = value;
      box.classList.remove("is-swapping");
    }, 160);
  }

  setInterval(tick, 1000);

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

  // Is the stream on this page actually live? Used to stop the 15s polling when
  // it's offline — the balance can't move from watch time then. Errs toward
  // "live" so we never miss a poll while the page is still settling.
  let channelSince = performance.now();
  function streamLive() {
    const v = document.querySelector("video");
    if (v && v.readyState >= 2 && v.duration === Infinity) return true;
    if (document.querySelector('[data-a-target="animated-channel-viewers-count"]')) return true;
    const st = document.querySelector('[class*="ChannelStatusTextIndicator"]');
    if (st && /live/i.test(st.textContent || "")) return true;
    return performance.now() - channelSince < 8000; // still loading — don't assume
  }

  function applyGate() {
    const show = allowedHere();
    box.hidden = !show;
    box.style.display = show ? "" : "none";
    if (show) {
      if (!onAllowed && !document.hidden) {
        ask(); // warm the value on arrival
        askGame(); // ...and the dungeon status
      }
      scheduleReposition();
    }
    onAllowed = show;
  }

  // ---- position: pinned to the player (default) or the window ------------
  // pos anchors one corner of the box to a *fraction* of the host rect, so the
  // box holds the same relative spot on the video whether it's normal, theater
  // or fullscreen size — not a fixed pixel inset that drifts as the player grows.
  //   { cx: "l"|"r", cy: "t"|"b", ax: 0..1, ay: 0..1 }
  const DEFAULT_INSET = 0.015;
  let drag = null;
  let pos = null;

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

  function defaultPos() {
    return growsLeft()
      ? { cx: "r", ax: 1 - DEFAULT_INSET, cy: "t", ay: DEFAULT_INSET * 2 }
      : { cx: "l", ax: DEFAULT_INSET, cy: "t", ay: DEFAULT_INSET * 2 };
  }

  // Older builds stored pixel insets; fold those into the fractional model once,
  // measured against whatever host we have now (close enough — a drag re-pins it).
  function normalisePos(host) {
    if (!pos) return;
    if (typeof pos.ax === "number" && typeof pos.ay === "number" && pos.cx && pos.cy) return;
    const W = host.width || innerWidth;
    const H = host.height || innerHeight;
    let cx = "l";
    let cy = "t";
    let axPx = 12;
    let ayPx = 12;
    if (pos.hEdge === "right") { cx = "r"; axPx = pos.h != null ? pos.h : 12; }
    else if (pos.hEdge === "left") { cx = "l"; axPx = pos.h != null ? pos.h : 12; }
    else if (pos.left != null) { cx = "l"; axPx = parseInt(pos.left, 10) || 12; }
    if (pos.vEdge === "bottom") { cy = "b"; ayPx = pos.v != null ? pos.v : 12; }
    else { cy = "t"; ayPx = pos.v != null ? pos.v : parseInt(pos.top, 10) || 12; }
    pos = {
      cx,
      cy,
      ax: cx === "l" ? clamp(axPx / W, 0, 1) : clamp(1 - axPx / W, 0, 1),
      ay: cy === "t" ? clamp(ayPx / H, 0, 1) : clamp(1 - ayPx / H, 0, 1),
    };
    ext.storage.local.set({ pos });
  }

  function reposition() {
    if (drag || box.hidden) return;
    const host = hostRect();
    normalisePos(host);
    const w = box.offsetWidth || 90;
    const h = box.offsetHeight || 40;
    const p = pos || defaultPos();

    const anchorX = host.left + clamp(p.ax, 0, 1) * host.width;
    const anchorY = host.top + clamp(p.ay, 0, 1) * host.height;
    const left = p.cx === "l" ? anchorX : anchorX - w;
    const top = p.cy === "t" ? anchorY : anchorY - h;

    // Travel is bounded by the host AND the viewport, so the box rides the
    // visible part of the player as it scrolls under Twitch's chrome, then
    // tucks away once the player is basically gone.
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

  // Store where the box sits as a fraction of the host, anchored to the corner
  // it grows away from vertically/horizontally.
  function savePos() {
    const b = box.getBoundingClientRect();
    const host = hostRect();
    if (!host.width || !host.height) return;
    const cx = growsLeft() ? "r" : "l";
    const cy = b.top + b.height / 2 < host.top + host.height / 2 ? "t" : "b";
    const px = cx === "l" ? b.left : b.right;
    const py = cy === "t" ? b.top : b.bottom;
    pos = {
      cx,
      cy,
      ax: clamp((px - host.left) / host.width, 0, 1),
      ay: clamp((py - host.top) / host.height, 0, 1),
    };
    ext.storage.local.set({ pos });
    reposition();
  }

  function loadPos(saved) {
    pos = saved || null; // normalised lazily on first reposition()
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
    if (changes.state) {
      render(changes.state.newValue);
      if (!document.hidden) ping(); // nudge the background to recolour this tab's icon
    }
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
  let wasLive = null; // unknown until the first check
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      channelSince = performance.now();
      wasLive = null;
      applyGate();
    }
    watchPlayer();
    reposition();
    // React the moment live status flips: repaint the toolbar icon, and refresh
    // the balance when a stream we're watching comes online.
    if (onAllowed && !document.hidden) {
      const live = streamLive();
      if (live !== wasLive) {
        ping();
        if (live) {
          ask();
          askGame();
        }
        wasLive = live;
      }
    }
  }, 1000);

  // Dungeon / recovery status changes slowly (runs last hours) — poll it far less
  // often than the balance, and only while actually watching a live stream.
  setInterval(() => {
    if (onAllowed && streamLive() && !document.hidden) askGame();
  }, 90000);

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
  // Every 15s while the tab is visible: check in (keeps the toolbar icon
  // current — no network). Refresh the balance only on an allowed channel
  // whose stream is actually live; when it's offline the number can't move
  // from watch time, so there's nothing to fetch.
  setInterval(() => {
    if (document.hidden) return;
    ping();
    if (onAllowed && streamLive()) ask();
  }, REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    ping();
    if (onAllowed) {
      ask(); // one refresh on refocus, live or not
      askGame();
    }
  });
})();
