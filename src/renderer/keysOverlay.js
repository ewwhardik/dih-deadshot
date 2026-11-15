/**
 * Minimalist Draggable Keystrokes Overlay + Real LMB/RMB CPS Tracker.
 */

DIH_NS.createKeysOverlay = function createKeysOverlay(shadowRoot, getSettings, savedPositions) {
  const { el, makeDraggable } = DIH_NS.utils;

  const root = el("div", { className: "dih-card dih-keys-widget" });

  function makeCap(label, sub = "") {
    const subEl = sub ? el("span", { className: "dih-key-sub dih-mono" }, sub) : null;
    const cap = el("div", { className: "dih-key-cap" }, [el("span", {}, label), subEl]);
    return { cap, subEl };
  }

  const kBlank1 = el("div");
  const kW = makeCap("W");
  const kBlank2 = el("div");
  const kA = makeCap("A");
  const kS = makeCap("S");
  const kD = makeCap("D");
  const topGrid = el("div", { className: "dih-keys-grid" }, [
    kBlank1,
    kW.cap,
    kBlank2,
    kA.cap,
    kS.cap,
    kD.cap,
  ]);

  const kLmb = makeCap("LMB", "0 CPS");
  const kRmb = makeCap("RMB", "0 CPS");
  const mouseGrid = el("div", { className: "dih-keys-row2" }, [kLmb.cap, kRmb.cap]);

  const kShift = makeCap("SHIFT");
  const kSpace = makeCap("SPACE");
  kSpace.cap.classList.add("dih-key-space");
  kShift.cap.classList.add("dih-key-space");
  const utilRow = el("div", { className: "dih-keys-row2" }, [kShift.cap, kSpace.cap]);

  const vecPuck = el("div", {
    style: {
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: "var(--dih-accent)",
      transform: "translate(0px, 0px)",
      transition: "transform 45ms linear",
    },
  });
  const vecRow = el(
    "div",
    {
      className: "dih-hidden",
      style: {
        marginTop: "6px",
        padding: "4px 6px",
        borderRadius: "6px",
        border: "1px solid var(--dih-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        fontSize: "9.5px",
        color: "var(--dih-muted)",
      },
    },
    [
      el("span", { className: "dih-mono" }, "AIM VEC"),
      el(
        "div",
        {
          style: {
            width: "28px",
            height: "18px",
            borderRadius: "4px",
            background: "rgba(255,255,255,0.03)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          },
        },
        [vecPuck]
      ),
    ]
  );

  root.append(topGrid, mouseGrid, utilRow, vecRow);
  shadowRoot.appendChild(root);
  makeDraggable(root, "keys", getSettings, savedPositions);

  const lmbClicks = [];
  const rmbClicks = [];
  let showMouseVec = false;
  let vecResetTimer = null;

  function pruneClicks(arr, now) {
    while (arr.length && now - arr[0] > 1000) arr.shift();
    return arr.length;
  }

  function updateVisibility() {
    const s = getSettings();
    const visible = Boolean(s.hud?.enabled && s.hud?.keysOverlayEnabled);
    root.classList.toggle("dih-hidden", !visible);
    const showCps = s.hud?.keysShowCps !== false;
    kLmb.subEl.style.display = showCps ? "block" : "none";
    kRmb.subEl.style.display = showCps ? "block" : "none";
    showMouseVec = Boolean(visible && s.hud?.keysShowMouseVector);
    vecRow.classList.toggle("dih-hidden", !showMouseVec);
  }

  window.addEventListener(
    "mousemove",
    (e) => {
      if (!showMouseVec) return;
      const mx = Math.max(-10, Math.min(10, (e.movementX || 0) * 0.45));
      const my = Math.max(-6, Math.min(6, (e.movementY || 0) * 0.45));
      vecPuck.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
      clearTimeout(vecResetTimer);
      vecResetTimer = setTimeout(() => {
        vecPuck.style.transform = "translate(0px, 0px)";
      }, 90);
    },
    { passive: true }
  );

  function setKeyState(code, down) {
    const map = {
      KeyW: kW.cap,
      KeyA: kA.cap,
      KeyS: kS.cap,
      KeyD: kD.cap,
      ShiftLeft: kShift.cap,
      ShiftRight: kShift.cap,
      Space: kSpace.cap,
    };
    const target = map[code];
    if (target) {
      target.classList.toggle("active-move", down);
    }
  }

  window.addEventListener("keydown", (e) => setKeyState(e.code, true), { passive: true });
  window.addEventListener("keyup", (e) => setKeyState(e.code, false), { passive: true });

  window.addEventListener(
    "mousedown",
    (e) => {
      const now = performance.now();
      if (e.button === 0) {
        kLmb.cap.classList.add("active-action");
        lmbClicks.push(now);
      } else if (e.button === 2) {
        kRmb.cap.classList.add("active-action");
        rmbClicks.push(now);
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "mouseup",
    (e) => {
      if (e.button === 0) kLmb.cap.classList.remove("active-action");
      else if (e.button === 2) kRmb.cap.classList.remove("active-action");
    },
    { passive: true }
  );

  window.addEventListener("blur", () => {
    for (const c of [kW.cap, kA.cap, kS.cap, kD.cap, kShift.cap, kSpace.cap]) {
      c.classList.remove("active-move");
    }
    kLmb.cap.classList.remove("active-action");
    kRmb.cap.classList.remove("active-action");
  });

  const cpsTimer = setInterval(() => {
    const s = getSettings();
    if (!s.hud?.enabled || !s.hud?.keysOverlayEnabled) return;
    const now = performance.now();
    // Only touch the DOM when the number changes (10 Hz timer would otherwise relayout the HUD constantly).
    const l = `${pruneClicks(lmbClicks, now)} CPS`;
    const r = `${pruneClicks(rmbClicks, now)} CPS`;
    if (kLmb.subEl.textContent !== l) kLmb.subEl.textContent = l;
    if (kRmb.subEl.textContent !== r) kRmb.subEl.textContent = r;
  }, 100);

  updateVisibility();

  return {
    refresh: updateVisibility,
    destroy: () => clearInterval(cpsTimer),
  };
};
