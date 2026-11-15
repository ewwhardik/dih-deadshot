/**
 * Zero-Churn Telemetry HUD:
 * Real RAF FPS + Min/Max + 1%/0.1% lows, sub-ms frametime, differential DOM updates,
 * Monitor Hz, Ping/Jitter, CPU/GPU/RAM & Deadshot dsio sens/FOV.
 */

DIH_NS.createTelemetryHud = function createTelemetryHud(shadowRoot, getSettings, staticHw, savedPositions) {
  const { el, makeDraggable, readDeadshotSettings, getHostApi } = DIH_NS.utils;

  const root = el("div", { className: "dih-card dih-telemetry" });
  root.addEventListener("dblclick", async () => {
    const cur = getSettings().hud?.telemetryViewMode === "minimal" ? "minimal" : "complete";
    await getHostApi()?.setSetting?.("hud.telemetryViewMode", cur === "minimal" ? "complete" : "minimal");
  });
  const viewSwitchBtn = el("button", {
    className: "dih-mini-btn",
    title: "Switch Minimal / Complete Telemetry (F6)",
    style: { padding: "1px 5px", fontSize: "9px", marginLeft: "4px" },
    onClick: async (e) => {
      e.stopPropagation();
      const cur = getSettings().hud?.telemetryViewMode === "minimal" ? "minimal" : "complete";
      await getHostApi()?.setSetting?.("hud.telemetryViewMode", cur === "minimal" ? "complete" : "minimal");
    },
  }, "MIN");
  const header = el("div", { className: "dih-tel-header" }, [
    el("div", { className: "dih-tel-brand" }, [
      el("span", { className: "dih-tel-brand-dot" }),
      el("span", {}, staticHw?.nativeBackend ? "DIH NATIVE" : "DIH TELEMETRY"),
    ]),
    el("div", { style: { display: "flex", alignItems: "center", gap: "4px" } }, [
      el("span", { className: "dih-mono", style: { fontSize: "10px", color: "var(--dih-muted)" } }),
      viewSwitchBtn,
    ]),
  ]);
  const hzEl = header.lastChild.firstChild;

  const fpsValEl = el("span", { className: "dih-mono dih-tel-fps-main" }, "--");
  const fpsWrap = el("div", { style: { display: "flex", alignItems: "baseline" } }, [
    fpsValEl,
    el("span", { className: "dih-tel-fps-unit" }, "FPS"),
  ]);
  const lowsEl = el("div", { className: "dih-mono dih-tel-lows" }, "1% -- • FT --ms");
  const fpsRow = el("div", { className: "dih-tel-fps-row" }, [fpsWrap, lowsEl]);

  const sparkCanvas = el("canvas", { className: "dih-tel-spark", width: "228", height: "26" });
  const sparkCtx = sparkCanvas.getContext("2d");

  const grid = el("div", { className: "dih-tel-grid dih-mono" });
  const kvPing = createKv("PING");
  const kvCpu = createKv("CPU");
  const kvRam = createKv("RAM");
  const kvApp = createKv("CLIENT");
  const kvSens = createKv("SENS");
  const kvFov = createKv("FOV");
  grid.append(kvPing.row, kvCpu.row, kvRam.row, kvApp.row, kvSens.row, kvFov.row);

  const gpuRow = el("div", { className: "dih-tel-gpu dih-mono" }, [
    el("span", {}, ""),
    el("span", {}, ""),
  ]);

  root.append(header, fpsRow, sparkCanvas, grid, gpuRow);
  shadowRoot.appendChild(root);
  makeDraggable(root, "telemetry", getSettings, savedPositions);

  function createKv(label) {
    const val = el("span", { className: "dih-tel-v" }, "--");
    const row = el("div", { className: "dih-tel-kv" }, [
      el("span", { className: "dih-tel-k" }, label),
      val,
    ]);
    return { row, val };
  }

  function setTextDiff(node, nextText) {
    if (node._lastTxt !== nextText) {
      node._lastTxt = nextText;
      node.textContent = nextText;
    }
  }

  const FRAME_CAP = 180;
  const frameDurations = new Float64Array(FRAME_CAP);
  const sortScratch = new Float64Array(FRAME_CAP);
  let frameHead = 0;
  let frameCount = 0;

  const SPARK_CAP = 48;
  const sparkSamples = new Float64Array(SPARK_CAP);
  let sparkHead = 0;
  let sparkCount = 0;

  let lastTs = performance.now();
  let frameCounter = 0;
  let lastFpsSampleTs = performance.now();
  let currentFps = 0;
  let minFps = 0;
  let maxFps = 0;
  let avgFrameTimeMs = 0;
  let onePctLow = 0;
  let latestSystem = null;
  let dead = false;
  let sysPollCounter = 0;

  const origRaf = window.requestAnimationFrame.bind(window);
  let activeCap = 0;
  let rafWrapped = false;

  // One allow/skip decision per frame timestamp (all rAF callbacks of a frame share `ts`), on a
  // drift-free schedule so the effective rate lands on the cap instead of rounding down to it.
  let pacedFrameTs = -1;
  let pacedAllow = true;
  let pacedNextDue = 0;
  function pacedFrameAllowed(ts) {
    if (ts !== pacedFrameTs) {
      pacedFrameTs = ts;
      const interval = 1000 / activeCap;
      pacedAllow = ts >= pacedNextDue - 1;
      if (pacedAllow) pacedNextDue = ts - pacedNextDue > interval ? ts + interval : pacedNextDue + interval;
    }
    return pacedAllow;
  }

  function applyFpsPacerConfig(capNum) {
    const cap = Math.max(0, Math.round(Number(capNum || 0)));
    if (cap === activeCap) return;
    activeCap = cap;
    pacedNextDue = 0;
    if (cap > 0 && !rafWrapped) {
      rafWrapped = true;
      window.requestAnimationFrame = function pacedRaf(cb) {
        if (activeCap <= 0) return origRaf(cb);
        return origRaf(function step(ts) {
          if (activeCap <= 0 || pacedFrameAllowed(ts)) cb(ts);
          else window.requestAnimationFrame(cb);
        });
      };
    } else if (cap === 0 && rafWrapped) {
      rafWrapped = false;
      window.requestAnimationFrame = origRaf;
    }
  }

  // While the Command Center is open the player isn't aiming, so pace the game's rAF to the
  // monitor refresh rate: no visible change, but it frees the main thread + GPU for the menu.
  let menuOpen = false;
  function effectiveCap() {
    const user = Math.max(0, Math.round(Number(getSettings().performance?.softwareFpsCap || 0)));
    if (!menuOpen) return user;
    const menuCap = Math.max(60, currentHz);
    return user > 0 ? Math.min(user, menuCap) : menuCap;
  }

  const primaryDisplay = staticHw?.displays?.primary;
  const currentHz = primaryDisplay?.displayFrequency || 60;
  const maxHz = primaryDisplay?.maxRefreshRate || currentHz;
  const gpuShort = String(staticHw?.gpu?.primaryName || "GPU")
    .replace(/NVIDIA GeForce /i, "")
    .replace(/AMD Radeon /i, "");
  const gpuVram = staticHw?.gpu?.vramGb ? `${staticHw.gpu.vramGb}GB` : "";

  function computePercentiles() {
    if (frameCount < 10) return;
    for (let i = 0; i < frameCount; i++) {
      sortScratch[i] = frameDurations[i];
    }
    const view = sortScratch.subarray(0, frameCount);
    view.sort();
    const idx1 = Math.max(0, frameCount - 1 - Math.max(0, Math.floor(frameCount * 0.01) - 1));
    onePctLow = Math.round(1000 / Math.max(0.05, view[idx1]));
  }

  function drawSparkline(accentColor) {
    if (!sparkCtx || sparkCount < 2) return;
    const w = sparkCanvas.width;
    const h = sparkCanvas.height;
    sparkCtx.clearRect(0, 0, w, h);

    const startIdx = sparkCount === SPARK_CAP ? sparkHead : 0;
    let maxFt = 8;
    for (let i = 0; i < sparkCount; i++) {
      const v = sparkSamples[(startIdx + i) % SPARK_CAP];
      if (v > maxFt) maxFt = v;
    }

    sparkCtx.strokeStyle = accentColor || "#d4d8df";
    sparkCtx.lineWidth = 1.4;
    sparkCtx.beginPath();
    const step = w / Math.max(1, sparkCount - 1);
    for (let i = 0; i < sparkCount; i++) {
      const v = sparkSamples[(startIdx + i) % SPARK_CAP];
      const x = i * step;
      const ratio = Math.min(1, v / maxFt);
      const y = h - 3 - ratio * (h - 6);
      if (i === 0) sparkCtx.moveTo(x, y);
      else sparkCtx.lineTo(x, y);
    }
    sparkCtx.stroke();
  }

  let dsCache = null;
  let dsReadAt = -1e9;
  const dateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

  function render() {
    const s = getSettings();
    applyFpsPacerConfig(effectiveCap());
    const hud = s.hud || {};
    const hidden = !hud.enabled || !hud.statsEnabled;
    root.classList.toggle("dih-hidden", hidden);
    if (hidden) return;

    const viewMode = hud.telemetryViewMode === "minimal" ? "minimal" : "complete";
    const effectiveLayout = viewMode === "minimal" ? "minimal_pill" : hud.statsLayout || "compact_card";
    const layoutCls = `layout-${effectiveLayout}`;
    if (!root.classList.contains(layoutCls)) {
      root.classList.remove("layout-compact_card", "layout-top_bar", "layout-minimal_pill");
      root.classList.add(layoutCls);
    }

    const isBar = effectiveLayout === "top_bar" || effectiveLayout === "minimal_pill";
    const isMinimal = effectiveLayout === "minimal_pill";
    sparkCanvas.classList.toggle("dih-hidden", !hud.showFrametimeGraph || isBar);
    header.classList.toggle("dih-hidden", isMinimal);
    grid.classList.toggle("dih-hidden", isMinimal);
    gpuRow.classList.toggle("dih-hidden", (!hud.showGpu && !hud.showTime && !hud.showDate && !hud.showUptime) || isBar);

    fpsWrap.classList.toggle("dih-hidden", !hud.showFps);
    setTextDiff(fpsValEl, currentFps ? String(currentFps) : "--");

    if (hud.fpsColorCoded !== false && currentFps > 0) {
      const refTarget = Number(s.performance?.softwareFpsCap) > 0 ? Number(s.performance.softwareFpsCap) : currentHz;
      fpsValEl.style.color =
        currentFps >= refTarget * 2 ? "#7de0a6" : currentFps >= refTarget ? "var(--dih-text)" : "#e2b866";
    } else {
      fpsValEl.style.color = "var(--dih-text)";
    }

    hzEl.classList.toggle("dih-hidden", !hud.showMonitorHz);
    setTextDiff(hzEl, currentHz === maxHz ? `${currentHz}Hz` : `${currentHz}/${maxHz}Hz`);

    const parts = [];
    if (isMinimal) {
      if (hud.showPing && latestSystem?.network && typeof latestSystem.network.rttMs === "number") {
        parts.push(`${Math.round(latestSystem.network.rttMs)}ms`);
      }
      if (hud.showFrameTime) {
        parts.push(`${avgFrameTimeMs.toFixed(1)}ft`);
      }
      if (hud.showMonitorHz) {
        parts.push(`${currentHz}Hz`);
      }
    } else {
      if (hud.showOnePercentLow) parts.push(`1% ${onePctLow || "--"}`);
      if (hud.showMinMaxFps && maxFps > 0) parts.push(`${minFps}/${maxFps}`);
      if (hud.showFrameTime) parts.push(`${avgFrameTimeMs.toFixed(1)}ms`);
    }
    setTextDiff(lowsEl, parts.join(" • "));
    lowsEl.classList.toggle("dih-hidden", parts.length === 0);

    const net = latestSystem?.network;
    kvPing.row.classList.toggle("dih-hidden", !hud.showPing && !hud.showJitter);
    if (net && typeof net.rttMs === "number") {
      const pTxt = hud.showPing ? `${Math.round(net.rttMs)}ms` : "";
      const jTxt = hud.showJitter && typeof net.jitterMs === "number" ? `±${net.jitterMs.toFixed(0)}` : "";
      setTextDiff(kvPing.val, [pTxt, jTxt].filter(Boolean).join(" "));
    } else {
      setTextDiff(kvPing.val, net?.status === "offline" ? "OFFLINE" : "--ms");
    }

    kvCpu.row.classList.toggle("dih-hidden", !hud.showCpu);
    setTextDiff(kvCpu.val, latestSystem ? `${latestSystem.cpuPercent.toFixed(0)}%` : "--%");

    kvRam.row.classList.toggle("dih-hidden", !hud.showRam);
    setTextDiff(kvRam.val, latestSystem ? `${latestSystem.ram.usedGb}/${latestSystem.ram.totalGb}G` : "--G");

    kvApp.row.classList.toggle("dih-hidden", !hud.showClientRam);
    if (latestSystem) {
      const hostM = latestSystem.hostMemoryMb != null ? Number(latestSystem.hostMemoryMb).toFixed(1) : null;
      const totM = Number(latestSystem.clientMemoryMb || 0).toFixed(0);
      setTextDiff(kvApp.val, hostM != null ? `${hostM}M/${totM}M` : `${totM}M`);
    } else {
      setTextDiff(kvApp.val, "--M");
    }

    // Game settings blob lives in localStorage; re-parse at most every 2s instead of 4x/sec.
    const nowMs = performance.now();
    if (nowMs - dsReadAt > 2000) {
      dsReadAt = nowMs;
      dsCache = readDeadshotSettings();
    }
    const ds = dsCache;
    kvSens.row.classList.toggle("dih-hidden", !hud.showSens);
    setTextDiff(kvSens.val, ds?.sensitivity != null ? String(ds.sensitivity) : "--");

    kvFov.row.classList.toggle("dih-hidden", !hud.showFov);
    setTextDiff(kvFov.val, ds?.fov != null ? `${ds.fov}°` : "--");

    const gpuText = hud.showGpu ? `${gpuShort} ${gpuVram}`.trim() : "";
    const clockParts = [];
    if (hud.showDate) {
      clockParts.push(dateFmt.format(new Date()));
    }
    if (hud.showTime) {
      clockParts.push(timeFmt.format(new Date()));
    }
    if (hud.showUptime && latestSystem) {
      const m = Math.floor(latestSystem.uptimeSec / 60);
      const sec = latestSystem.uptimeSec % 60;
      clockParts.push(`${m}m${String(sec).padStart(2, "0")}s`);
    }
    setTextDiff(gpuRow.firstChild, gpuText);
    setTextDiff(gpuRow.lastChild, clockParts.join(" • "));

    if (hud.showFrametimeGraph && !isBar) {
      drawSparkline(s.theme?.accent);
    }
  }

  function rafTick(now) {
    if (dead) return;
    const dt = Math.max(0.05, now - lastTs);
    lastTs = now;
    frameCounter++;
    frameDurations[frameHead] = dt;
    frameHead = (frameHead + 1) % FRAME_CAP;
    if (frameCount < FRAME_CAP) frameCount++;

    const sampleMs = getSettings().performance?.presetMode === "low_end" ? 500 : 250;
    if (now - lastFpsSampleTs >= sampleMs) {
      const elapsed = now - lastFpsSampleTs;
      currentFps = Math.round((frameCounter * 1000) / elapsed);
      avgFrameTimeMs = elapsed / Math.max(1, frameCounter);
      if (currentFps > 0) {
        if (minFps === 0 || currentFps < minFps) minFps = currentFps;
        if (currentFps > maxFps) maxFps = currentFps;
      }
      sparkSamples[sparkHead] = avgFrameTimeMs;
      sparkHead = (sparkHead + 1) % SPARK_CAP;
      if (sparkCount < SPARK_CAP) sparkCount++;

      computePercentiles();
      frameCounter = 0;
      lastFpsSampleTs = now;
      render();
    }

    origRaf(rafTick);
  }

  async function sampleSystemMetrics(forcePing = false) {
    if (dead) return;
    const s = getSettings();
    const hud = s.hud || {};
    if (!hud.enabled || !hud.statsEnabled) return;
    try {
      const api = getHostApi();
      const [sys, ping] = await Promise.all([
        api?.getLiveMetrics?.(),
        forcePing && (hud.showPing || hud.showJitter) && s.network?.livePingProbe !== false
          ? api?.probePing?.()
          : Promise.resolve(null),
      ]);
      if (sys) {
        if (ping && sys.network) {
          sys.network = { ...sys.network, ...ping };
        }
        latestSystem = sys;
      }
      render();
    } catch {}
  }

  const sysInterval = setInterval(() => {
    sysPollCounter++;
    sampleSystemMetrics(sysPollCounter % 2 === 0);
  }, 1500);
  sampleSystemMetrics(true);

  origRaf(rafTick);
  render();

  return {
    getCurrentMetrics: () => ({
      fps: currentFps,
      minFps,
      maxFps,
      onePercentLow: onePctLow,
      frameTimeMs: avgFrameTimeMs,
      monitorHz: currentHz,
      maxMonitorHz: maxHz,
      pingMs: latestSystem?.network?.rttMs ?? null,
    }),
    getLatestSystem: () => latestSystem,
    resetFpsBounds: () => {
      minFps = 0;
      maxFps = 0;
    },
    refresh: render,
    setMenuOpen: (open) => {
      menuOpen = Boolean(open);
      applyFpsPacerConfig(effectiveCap());
    },
    destroy: () => {
      dead = true;
      clearInterval(sysInterval);
      if (rafWrapped) window.requestAnimationFrame = origRaf;
    },
  };
};
