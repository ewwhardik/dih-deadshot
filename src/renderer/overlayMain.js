/**
 * Main Shadow DOM Entrypoint for In-Game Renderer UI Modules.
 * Works identically on Native Rust + C/Win32 WebView2 AND Electron hosts.
 */

DIH_NS.boot = async function boot(shadowCss) {
  const { getHostApi, el, applyThemeVars, syncEarlyPerfStorage, showToast, setAudioOptions, readDeadshotSettings, writeDeadshotSetting } = DIH_NS.utils;
  const api = getHostApi();
  if (!api) {
    console.warn("[Dih] Host IPC API unavailable");
    return;
  }

  const host = document.createElement("div");
  host.id = "dih-shadow-host";
  const shadowRoot = host.attachShadow({ mode: "open" });

  const styleNode = document.createElement("style");
  styleNode.textContent = shadowCss;
  shadowRoot.appendChild(styleNode);

  (document.body || document.documentElement).appendChild(host);

  const toastStack = el("div", { className: "dih-toast-stack" });
  shadowRoot.appendChild(toastStack);
  const toast = (text) => showToast(toastStack, text);

  let settings = await api.getSettings();
  const [catalog, staticHw, savedPositions] = await Promise.all([
    api.getCatalog(),
    api.getStaticHardware(),
    api.getHudPositions(),
  ]);

  const getSettings = () => settings;
  const setSettingsLocal = (next) => {
    if (next) settings = next;
  };

  applyThemeVars(host, settings);
  syncEarlyPerfStorage(settings);

  const telemetryHud = DIH_NS.createTelemetryHud(shadowRoot, getSettings, staticHw, savedPositions);
  const netGraphHud = DIH_NS.createNetGraphHud
    ? DIH_NS.createNetGraphHud(shadowRoot, getSettings, savedPositions)
    : null;
  const keysOverlay = DIH_NS.createKeysOverlay(shadowRoot, getSettings, savedPositions);
  const crosshairEngine = DIH_NS.createCrosshairEngine(shadowRoot, getSettings);
  const extraOverlays = DIH_NS.createExtraOverlays(shadowRoot, getSettings, savedPositions);
  const filterEngine = DIH_NS.createFilterEngine(shadowRoot, getSettings);
  const corsairReactive = DIH_NS.createCorsairReactive(getSettings, telemetryHud.getCurrentMetrics);
  const leaderboardModal = DIH_NS.createLeaderboardModal(shadowRoot);

  let commandCenter = null;
  let bootAnalyzer = null;

  const netGraphTimer = setInterval(() => {
    const s = getSettings();
    if (netGraphHud && s.hud?.enabled !== false && (s.esportsHud?.netGraphEnabled || s.esportsHud?.sessionStatsEnabled)) {
      netGraphHud.update(telemetryHud.getCurrentMetrics?.());
    }
  }, 260);

  window.addEventListener("contextmenu", (e) => {
    if (getSettings()?.privacyPro?.blockContextMenu !== false) {
      if (e.target?.tagName === "CANVAS" || document.pointerLockElement) {
        e.preventDefault();
      }
    }
  });

  function syncDeadshotConfigFromClient(force = false) {
    const cfg = settings.deadshotSync || {};
    if (!force && !cfg.autoSyncOnLoad) return false;
    const ds = readDeadshotSettings();
    if (!ds) return false;
    let changed = false;
    if (cfg.targetFov != null) {
      changed = writeDeadshotSetting(35, Number(cfg.targetFov)) || changed;
    }
    if (cfg.targetRenderScale != null) {
      changed = writeDeadshotSetting(12, Number(cfg.targetRenderScale)) || changed;
    }
    if (typeof cfg.targetAntialias === "boolean") {
      changed = writeDeadshotSetting(9, cfg.targetAntialias) || changed;
    }
    if (typeof cfg.hideNativeCrosshair === "boolean") {
      changed = writeDeadshotSetting(14, cfg.hideNativeCrosshair) || changed;
    }
    return changed;
  }

  let syncTries = 0;
  const syncBootTimer = setInterval(() => {
    syncTries++;
    if (syncDeadshotConfigFromClient(false) || syncTries >= 12) {
      clearInterval(syncBootTimer);
    }
  }, 1000);

  function refreshAll() {
    applyThemeVars(host, settings);
    syncEarlyPerfStorage(settings);
    setAudioOptions({ limiterEnabled: settings.audio?.audioLimiterEnabled !== false });
    telemetryHud.refresh();
    netGraphHud?.refresh?.();
    keysOverlay.refresh();
    crosshairEngine.refresh();
    extraOverlays.refresh();
    filterEngine.refresh();
    commandCenter?.refresh();
  }

  bootAnalyzer = DIH_NS.createBootAnalyzer
    ? DIH_NS.createBootAnalyzer({
        shadowRoot,
        getSettings,
        setSettingsLocal,
        onRefreshAll: refreshAll,
        toast,
      })
    : null;

  commandCenter = DIH_NS.createCommandCenter({
    shadowRoot,
    getSettings,
    setSettingsLocal,
    catalog,
    staticHw,
    crosshairEngine,
    telemetryHud,
    leaderboardModal,
    bootAnalyzer,
    toast,
    onRefreshAll: refreshAll,
  });

  if (bootAnalyzer) {
    bootAnalyzer.run({ forceShow: false, applyRecommended: false }).catch(() => {});
  }

  api.onSettingsChanged((updated) => {
    settings = updated;
    refreshAll();
  });

  api.onAction((action) => {
    if (action?.type === "screenshotResult") {
      toast(
        action.payload?.ok
          ? `Screenshot saved: ${action.payload.filePath}`
          : "Screenshot capture failed"
      );
    } else if (action?.type === "toggleCommandCenter") {
      commandCenter.toggle();
    } else if (action?.type === "toggleAllHud") {
      api.setSetting("hud.enabled", !(settings.hud?.enabled !== false)).then((next) => {
        settings = next;
        refreshAll();
      });
    }
  });

  // Global Hotkeys inside Game window (native Win32 host handles F7/F8/F10 too, avoiding double triggers)
  window.addEventListener("keydown", async (e) => {
    const tag = e.target?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable;

    const guiKey = settings.hotkeys?.toggleGui || "RightShift";
    const guiAlt = (settings.hotkeys?.toggleGuiAlt || "o").toLowerCase();
    const hideKey = settings.hotkeys?.hideAllHud || "F9";

    const matchesKey = (binding) => {
      if (!binding) return false;
      if (binding === "RightShift" || binding === "ShiftRight") return e.code === "ShiftRight";
      if (e.code === binding) return true;
      const stripped = binding.replace(/^(Key|Digit)/i, "").toLowerCase();
      return e.key.toLowerCase() === stripped;
    };

    if (matchesKey(guiKey)) {
      e.preventDefault();
      commandCenter.toggle();
      return;
    }

    if (e.key === "Escape" && commandCenter.isOpen()) {
      e.preventDefault();
      commandCenter.close();
      return;
    }

    if (typing) return;

    if (matchesKey(guiAlt)) {
      e.preventDefault();
      commandCenter.toggle();
    } else if (matchesKey(hideKey)) {
      e.preventDefault();
      const next = !(settings.hud?.enabled !== false);
      settings = await api.setSetting("hud.enabled", next);
      refreshAll();
      toast(next ? "HUD Overlays Restored" : `Clean Mode: HUD Hidden (${hideKey})`);
    }
  });

  const hz = staticHw?.displays?.primary?.displayFrequency || 60;
  const maxHz = staticHw?.displays?.primary?.maxRefreshRate || hz;
  const engineName = staticHw?.nativeBackend ? "Native Rust+Win32" : "Client Ready";
  toast(`Dih ${engineName} • ${hz}${maxHz !== hz ? `/${maxHz}` : ""}Hz • RightShift or O`);
};
