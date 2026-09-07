// Draws the little floating LuxBux box on Twitch and keeps it in sync with
// whatever background.js last stored. Drag to move (position is remembered),
// single-click to force a refresh.

(() => {
  if (window.__luxbuxOverlay) return;
  window.__luxbuxOverlay = true;

  // Best-effort: match the site's display font. If Twitch's CSP blocks this,
  // it silently falls back to the system stack below.
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
    const problem = state.status !== "ok";
    box.classList.toggle("is-problem", problem);

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

  chrome.storage.local.get(["state", "pos"]).then((r) => {
    if (r.pos) {
      box.style.left = r.pos.left;
      box.style.top = r.pos.top;
      box.style.right = "auto";
    }
    render(r.state);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.state) render(changes.state.newValue);
  });

  // ---- drag to move / click to refresh -------------------------------------
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
      chrome.storage.local.set({ pos: { left: box.style.left, top: box.style.top } });
    } else {
      chrome.runtime.sendMessage("luxbux:refresh");
    }
    drag = null;
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) chrome.runtime.sendMessage("luxbux:refresh");
  });
})();
