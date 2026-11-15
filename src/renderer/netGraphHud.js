/**
 * Esports Pro HUD Widgets:
 * 1. Scrolling Net-Graph (FPS curve, frametime jitter bars & RTT ping)
 * 2. Compact Match Session Summary Pill (Shots, Streak, Uptime)
 * 3. Active Weapon Slot Badge (1 Primary / 2 Secondary / 3 Melee)
 * 4. Tactical Reload Progress Bar (triggered on R while pointer-locked)
 * 5. Raw Mouse Pointer Lock Status LED Pill
 */

DIH_NS.createNetGraphHud = function createNetGraphHud(shadowRoot, getSettings, savedPositions) {
  const { el, makeDraggable } = DIH_NS.utils;

  // --- 1. Esports Net-Graph ---
  const ngRoot = el("div", { className: "dih-card dih-netgraph-widget" });
  ngRoot.style.left = "16px";
  ngRoot.style.bottom = "14px";
  const ngHead = el("div", { className: "dih-ng-head dih-mono" }, [
    el("span", {}, "NET-GRAPH"),
    el("span", { className: "dih-ng-stats" }, "-- FPS • -- ms"),
  ]);
  const ngCanvas = document.createElement("canvas");
  ngCanvas.width = 224;
  ngCanvas.height = 56;
  ngCanvas.className = "dih-ng-canvas";
  const ngCtx = ngCanvas.getContext("2d");
  ngRoot.append(ngHead, ngCanvas);
  const ngStatsEl = ngHead.querySelector(".dih-ng-stats");
  shadowRoot.appendChild(ngRoot);
  makeDraggable(ngRoot, "netGraph", getSettings, savedPositions);

  const ngCap = 72;
  const fpsHist = new Float32Array(ngCap);
  const ftHist = new Float32Array(ngCap);
  const pingHist = new Float32Array(ngCap);
  let ngHeadIdx = 0;

  // --- 2. Match Session Summary ---
  const sessRoot = el("div", { className: "dih-card dih-session-widget" });
  sessRoot.style.left = "264px";
  sessRoot.style.bottom = "14px";
  const sessShots = el("span", { className: "dih-mono" }, "0");
  const sessReloads = el("span", { className: "dih-mono" }, "0");
  const sessTime = el("span", { className: "dih-mono" }, "0m 00s");
  sessRoot.append(
    el("div", { className: "dih-widget-label" }, [el("span", {}, "MATCH SESSION"), el("span", { className: "dih-mono" }, "LIVE")]),
    el("div", { className: "dih-ng-sess-grid" }, [
      el("div", { className: "dih-kd-cell" }, [el("span", { className: "dih-tel-k" }, "SHOTS"), sessShots]),
      el("div", { className: "dih-kd-cell" }, [el("span", { className: "dih-tel-k" }, "RELOADS"), sessReloads]),
      el("div", { className: "dih-kd-cell" }, [el("span", { className: "dih-tel-k" }, "TIME"), sessTime]),
    ])
  );
  shadowRoot.appendChild(sessRoot);
  makeDraggable(sessRoot, "sessionStats", getSettings, savedPositions);

  // --- 3. Active Weapon Slot Badge ---
  const slotRoot = el("div", { className: "dih-card dih-slot-badge dih-mono" }, "1 • PRIMARY");
  slotRoot.style.right = "16px";
  slotRoot.style.bottom = "56px";
  shadowRoot.appendChild(slotRoot);
  makeDraggable(slotRoot, "weaponSlot", getSettings, savedPositions);

  // --- 4. Pointer Lock Status LED Pill ---
  const lockRoot = el("div", { className: "dih-card dih-lock-pill dih-mono" });
  lockRoot.style.left = "50%";
  lockRoot.style.top = "10px";
  lockRoot.style.transform = "translateX(-50%)";
  const lockDot = el("span", { className: "dih-lock-dot" });
  const lockLabel = el("span", {}, "MENU CURSOR");
  lockRoot.append(lockDot, lockLabel);
  shadowRoot.appendChild(lockRoot);

  // --- 5. Tactical Reload Bar ---
  const reloadWrap = el("div", { className: "dih-reload-bar-wrap dih-hidden" });
  const reloadFill = el("div", { className: "dih-reload-bar-fill" });
  const reloadText = el("div", { className: "dih-reload-bar-txt dih-mono" }, "RELOADING...");
  reloadWrap.append(reloadFill, reloadText);
  shadowRoot.appendChild(reloadWrap);

  let shotCount = 0;
  let reloadCount = 0;
  const startedAt = Date.now();
  let reloadRaf = 0;

  function triggerReloadBar(durationMs) {
    if (reloadRaf) cancelAnimationFrame(reloadRaf);
    const dur = Math.max(800, Math.min(4500, Number(durationMs) || 1850));
    const t0 = performance.now();
    reloadWrap.classList.remove("dih-hidden");
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      reloadFill.style.width = `${(p * 100).toFixed(1)}%`;
      reloadText.textContent = `RELOAD ${((dur * (1 - p)) / 1000).toFixed(1)}s`;
      if (p < 1) {
        reloadRaf = requestAnimationFrame(step);
      } else {
        reloadRaf = 0;
        reloadWrap.classList.add("dih-hidden");
      }
    };
    reloadRaf = requestAnimationFrame(step);
  }

  function updatePointerLockUi() {
    const locked = Boolean(document.pointerLockElement);
    lockDot.classList.toggle("locked", locked);
    lockLabel.textContent = locked ? "RAW LOCKED" : "MENU CURSOR";
  }

  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button === 0 && document.pointerLockElement) {
        shotCount++;
        sessShots.textContent = String(shotCount);
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "keydown",
    (e) => {
      const s = getSettings();
      if (e.key === "1") slotRoot.textContent = "1 • PRIMARY";
      else if (e.key === "2") slotRoot.textContent = "2 • SIDEARM";
      else if (e.key === "3") slotRoot.textContent = "3 • MELEE";
      else if (e.code === "KeyR" && document.pointerLockElement) {
        reloadCount++;
        sessReloads.textContent = String(reloadCount);
        if (s.hud?.enabled !== false && s.esportsHud?.reloadProgressBar) {
          triggerReloadBar(s.esportsHud?.reloadDurationMs || 1850);
        }
      }
    },
    { passive: true }
  );

  document.addEventListener("pointerlockchange", updatePointerLockUi, { passive: true });
  updatePointerLockUi();

  function drawNetGraph(s, snap) {
    const fps = Number(snap?.fps) || 0;
    const ft = Number(snap?.frameTimeMs) || (fps > 0 ? 1000 / fps : 16.6);
    const ping = typeof snap?.pingMs === "number" ? snap.pingMs : 0;

    fpsHist[ngHeadIdx] = fps;
    ftHist[ngHeadIdx] = ft;
    pingHist[ngHeadIdx] = ping;
    ngHeadIdx = (ngHeadIdx + 1) % ngCap;

    const warnThresh = Number(s.esportsHud?.fpsWarningThreshold) || 60;
    const lowFps = fps > 0 && fps < warnThresh;
    ngStatsEl.textContent = `${fps} FPS • ${ft.toFixed(1)}ms • ${ping > 0 ? `${ping}ms` : "--ms"}`;
    ngStatsEl.style.color = lowFps ? "#d96464" : "var(--dih-accent)";

    const w = ngCanvas.width;
    const h = ngCanvas.height;
    ngCtx.clearRect(0, 0, w, h);

    // Subtle baseline grid
    ngCtx.strokeStyle = "rgba(255,255,255,0.06)";
    ngCtx.lineWidth = 1;
    ngCtx.beginPath();
    ngCtx.moveTo(0, h * 0.5);
    ngCtx.lineTo(w, h * 0.5);
    ngCtx.stroke();

    const maxFps = Math.max(120, ...(fpsHist.filter ? Array.from(fpsHist) : [240]));
    const stepX = w / (ngCap - 1);

    // Frametime spike bars
    ngCtx.fillStyle = "rgba(212, 216, 223, 0.18)";
    for (let i = 0; i < ngCap; i++) {
      const idx = (ngHeadIdx + i) % ngCap;
      const barH = Math.min(h * 0.45, (ftHist[idx] / 33.3) * (h * 0.45));
      ngCtx.fillRect(i * stepX, h - barH, Math.max(1.5, stepX - 0.8), barH);
    }

    // FPS line
    ngCtx.strokeStyle = lowFps ? "#d96464" : getComputedStyle(shadowRoot.host).getPropertyValue("--dih-accent").trim() || "#d4d8df";
    ngCtx.lineWidth = 1.6;
    ngCtx.beginPath();
    for (let i = 0; i < ngCap; i++) {
      const idx = (ngHeadIdx + i) % ngCap;
      const x = i * stepX;
      const y = h - 4 - Math.min(1, fpsHist[idx] / maxFps) * (h - 10);
      if (i === 0) ngCtx.moveTo(x, y);
      else ngCtx.lineTo(x, y);
    }
    ngCtx.stroke();

    // Ping line (amber hairline)
    ngCtx.strokeStyle = "rgba(226, 184, 102, 0.78)";
    ngCtx.lineWidth = 1;
    ngCtx.beginPath();
    for (let i = 0; i < ngCap; i++) {
      const idx = (ngHeadIdx + i) % ngCap;
      const x = i * stepX;
      const y = h - 3 - Math.min(1, pingHist[idx] / 180) * (h * 0.48);
      if (i === 0) ngCtx.moveTo(x, y);
      else ngCtx.lineTo(x, y);
    }
    ngCtx.stroke();
  }

  function applyVisibility() {
    const s = getSettings();
    const hudOn = s.hud?.enabled !== false;
    const ep = s.esportsHud || {};
    const scale = Math.max(0.75, Math.min(1.35, Number(ep.hudScale) || 1));
    const opacity = Math.max(0.35, Math.min(1, Number(ep.hudOpacity) ?? 0.92));

    for (const w of [ngRoot, sessRoot, slotRoot, lockRoot]) {
      w.style.opacity = String(opacity);
      if (w !== lockRoot) {
        w.style.zoom = String(scale);
      }
    }

    ngRoot.classList.toggle("dih-hidden", !(hudOn && ep.netGraphEnabled));
    sessRoot.classList.toggle("dih-hidden", !(hudOn && ep.sessionStatsEnabled));
    slotRoot.classList.toggle("dih-hidden", !(hudOn && ep.weaponSlotBadge));
    lockRoot.classList.toggle("dih-hidden", !(hudOn && ep.pointerLockBadge !== false));
  }

  function update(snap) {
    const s = getSettings();
    if (s.hud?.enabled === false) return;
    if (s.esportsHud?.netGraphEnabled) {
      drawNetGraph(s, snap);
    }
    if (s.esportsHud?.sessionStatsEnabled) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = String(elapsed % 60).padStart(2, "0");
      sessTime.textContent = `${mins}m ${secs}s`;
    }
  }

  applyVisibility();

  return {
    refresh: applyVisibility,
    update,
    destroy: () => {
      if (reloadRaf) cancelAnimationFrame(reloadRaf);
    },
  };
};
