/**
 * Dih Client Command Center Modal
 * Grey, premium, minimalist floating panel giving unified access to 146 features,
 * aligned SVG brand lockup, real telemetry controls, Aim/eDPI calculator, and Developer Credits.
 */

DIH_NS.createCommandCenter = function createCommandCenter({
  shadowRoot,
  getSettings,
  setSettingsLocal,
  catalog,
  staticHw,
  crosshairEngine,
  telemetryHud,
  leaderboardModal,
  bootAnalyzer,
  autoChat,
  toast,
  onRefreshAll,
}) {
  const {
    getHostApi,
    el,
    makeBrandSvg,
    playTone,
    readDeadshotSettings,
    readDeadshotKeybinds,
    writeDeadshotSetting,
    encodeCrosshairCode,
    decodeCrosshairCode,
  } = DIH_NS.utils;

  const api = getHostApi();
  const isNative = Boolean(api?.isNativeHost);

  const backdrop = el("div", { className: "dih-backdrop dih-cc-backdrop dih-hidden" });
  const shell = el("div", { className: "dih-card dih-cc" });

  // Launcher pill shown subtly bottom-right when modal is closed — aligned icon + label
  const launcherPill = el("button", {
    className: "dih-card dih-pill-launcher",
    title: "Open Dih Command Center (RightShift / O)",
    onClick: () => open(),
  }, [
    makeBrandSvg(13),
    el("span", {}, "DIH • MENU"),
  ]);
  shadowRoot.appendChild(launcherPill);

  const makeIcon = (d, size = 14) => {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("width", String(size));
    s.setAttribute("height", String(size));
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.8");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.innerHTML = d;
    return s;
  };

  const makeSparkSvg = (pts, uid = "g1") => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 34");
    svg.style.width = "100%";
    svg.style.height = "34px";
    svg.style.display = "block";
    const max = Math.max(...pts, 1);
    const min = Math.min(...pts, 0);
    const span = max - min || 1;
    const coords = pts.map((v, i) => [
      Math.round((i / Math.max(1, pts.length - 1)) * 120),
      Math.round(30 - ((v - min) / span) * 24),
    ]);
    let line = `M${coords[0][0]},${coords[0][1]}`;
    for (let i = 1; i < coords.length; i++) {
      const mx = Math.round((coords[i - 1][0] + coords[i][0]) / 2);
      line += ` C${mx},${coords[i - 1][1]} ${mx},${coords[i][1]} ${coords[i][0]},${coords[i][1]}`;
    }
    svg.innerHTML =
      `<defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="var(--dih-accent)" stop-opacity="0.34"/>` +
      `<stop offset="100%" stop-color="var(--dih-accent)" stop-opacity="0"/>` +
      `</linearGradient></defs>` +
      `<path d="${line} L120,34 L0,34 Z" fill="url(#${uid})"/>` +
      `<path d="${line}" fill="none" stroke="var(--dih-accent)" stroke-width="1.8" stroke-linecap="round"/>`;
    return svg;
  };

  const makeBarSparkSvg = (bars) => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 34");
    svg.style.width = "100%";
    svg.style.height = "34px";
    svg.style.display = "block";
    const w = 8;
    const gap = (120 - bars.length * w) / Math.max(1, bars.length - 1);
    svg.innerHTML = bars
      .map((p, idx) => {
        const h = Math.max(4, Math.round((p / 100) * 28));
        const x = Math.round(idx * (w + gap));
        const op = idx === bars.length - 1 ? 0.95 : 0.25 + (idx / bars.length) * 0.35;
        return `<rect x="${x}" y="${32 - h}" width="${w}" height="${h}" rx="3" fill="var(--dih-accent)" fill-opacity="${op.toFixed(2)}"/>`;
      })
      .join("");
    return svg;
  };

  const makeRingSvg = (pct) => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "68");
    svg.setAttribute("height", "68");
    svg.setAttribute("viewBox", "0 0 68 68");
    const r = 28;
    const c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0.08, Math.min(1, pct / 100)));
    svg.innerHTML =
      `<circle cx="34" cy="34" r="${r}" stroke="rgba(255,255,255,0.09)" stroke-width="4.5" fill="none"/>` +
      `<circle cx="34" cy="34" r="${r}" stroke="var(--dih-accent)" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>`;
    return svg;
  };

  // Left Navigation Rail — aligned icon + clean label + collapse button
  const searchInput = el("input", {
    className: "dih-input",
    placeholder: `Search ${catalog.FEATURE_REGISTRY?.length || 196} controls...`,
  });
  const liveMiniStatus = el("div", { className: "dih-brand-sub dih-mono" }, "UNCAPPED • READY");
  const railCollapseBtn = el("button", {
    className: "dih-btn",
    title: "Toggle Compact Sidebar",
    style: { padding: "4px 7px", fontSize: "11px" },
    onClick: () => updateSetting("esportsHud.compactNavRail", !(getSettings().esportsHud?.compactNavRail)),
  }, "«");

  const railHead = el("div", { className: "dih-brand-box" }, [
    el("div", { className: "dih-brand-left" }, [
      el("div", { className: "dih-logo-mark" }, [makeBrandSvg(18)]),
      el("div", { className: "dih-brand-meta" }, [
        el("div", { className: "dih-brand-title-row" }, [
          el("div", { className: "dih-brand-title" }, "DIH"),
          el("span", { className: "dih-engine-tag dih-mono" }, isNative ? "NATIVE" : "CORE"),
        ]),
        liveMiniStatus,
      ]),
    ]),
    railCollapseBtn,
  ]);

  const TABS = [
    { id: "overview", label: "Dashboard", tag: String(catalog.FEATURE_REGISTRY?.length || 196), icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
    { id: "metrics", label: "Performance", tag: "Hz", icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
    { id: "skins", label: "Skin Packs", tag: "7", icon: '<path d="M12 2l8 4v6c0 5-3.4 9.2-8 10-4.6-.8-8-5-8-10V6l8-4z"/>' },
    { id: "corsair", label: "Corsair RGB", tag: "HID", icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>' },
    { id: "crosshair", label: "HUD & Aim", tag: "SVG", icon: '<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>' },
    { id: "tools", label: "Visuals & Sync", tag: "PRO", icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/>' },
    { id: "theme", label: "Settings", tag: "v0.4", icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1 1.44 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.18.4-1.51 1z"/>' },
  ];

  let activeTab = "overview";
  let activeCategory = "all";
  let activeOverviewFilter = "all";
  let showAllOverview = false;
  let activeMetricsSub = "profiles";
  let activeCrosshairSub = "reticle";
  let activeToolsSub = "visuals";
  let customSkinsCache = [];
  let corsairStatusCache = null;
  let liveSnapshot = null;

  const navContainer = el("div", { className: "dih-nav" });
  const navButtons = {};

  for (const tab of TABS) {
    const btn = el("button", {
      className: `dih-nav-item${tab.id === activeTab ? " active" : ""}`,
      title: tab.label,
      onClick: () => {
        searchInput.value = "";
        switchTab(tab.id);
      },
    }, [
      el("span", { className: "dih-nav-left" }, [
        el("span", { className: "dih-nav-icon" }, [makeIcon(tab.icon, 14)]),
        el("span", { className: "dih-nav-label" }, tab.label),
      ]),
      el("span", { className: "dih-badge dih-mono" }, tab.tag),
    ]);
    navButtons[tab.id] = btn;
    navContainer.appendChild(btn);
  }

  const railFoot = el("div", { className: "dih-rail-foot" }, [
    el("button", {
      className: "dih-btn primary",
      style: { width: "100%" },
      title: "3D Skin Studio (F7)",
      onClick: () => api?.openStudio?.("painter"),
    }, [makeIcon('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/>', 13), el("span", { className: "dih-rail-foot-text" }, "3D Studio")]),
    el("button", {
      className: "dih-btn",
      style: { width: "100%" },
      title: "7-Gun Aim Trainer (Ins)",
      onClick: () => api?.openStudio?.("aimtrainer"),
    }, [makeIcon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>', 13), el("span", { className: "dih-rail-foot-text" }, "Aim Trainer")]),
    el("div", {
      className: "dih-rail-foot-text",
      style: { fontSize: "10px", color: "var(--dih-muted)", textAlign: "center", marginTop: "2px" },
    }, "by ewwhardik"),
  ]);

  const rail = el("div", { className: "dih-rail" }, [
    railHead,
    navContainer,
    railFoot,
  ]);

  // Right Stage
  const stageTitle = el("div", { className: "dih-stage-title" }, "Dashboard");
  const stageSub = el("div", { className: "dih-stage-sub" }, "");
  const closeBtn = el("button", { className: "dih-btn", onClick: () => close() }, "ESC");

  const quickDock = el("div", { className: "dih-quick-dock" });
  function rebuildQuickDock() {
    quickDock.innerHTML = "";
    const s = getSettings();
    const isMinimal = (s.hud?.telemetryViewMode || "complete") === "minimal";
    const items = [
      { label: isMinimal ? "HUD: Minimal" : "HUD: Complete", active: isMinimal, click: () => updateSetting("hud.telemetryViewMode", isMinimal ? "complete" : "minimal") },
      { label: "Crosshair", active: s.crosshair?.enabled, click: () => updateSetting("crosshair.enabled", !s.crosshair?.enabled) },
      { label: "Skins", active: s.skins?.swapperEnabled, click: () => updateSetting("skins.swapperEnabled", !s.skins?.swapperEnabled) },
      { label: "Night", active: s.visuals?.blueLightShield, click: () => updateSetting("visuals.blueLightShield", !s.visuals?.blueLightShield) },
    ];
    for (const item of items) {
      quickDock.appendChild(
        el("button", {
          className: `dih-btn${item.active ? " active" : ""}`,
          style: { padding: "5px 10px", fontSize: "11px" },
          onClick: item.click,
        }, item.label)
      );
    }
  }

  const searchPill = el("div", { className: "dih-search-pill" }, [
    makeIcon('<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/>', 13),
    searchInput,
  ]);

  const stageHeader = el("div", { className: "dih-stage-header" }, [
    el("div", {}, [stageTitle, stageSub]),
    el("div", { className: "dih-header-tools" }, [
      searchPill,
      quickDock,
      closeBtn,
    ]),
  ]);

  const stageBody = el("div", { className: "dih-stage-body" });
  const footerBar = el("div", { className: "dih-footer-bar" }, [
    el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
      el("button", {
        className: "dih-btn",
        onClick: async () => {
          await api?.reloadGame?.();
        },
      }, "Reload Game & Textures"),
      el("button", {
        className: "dih-btn",
        onClick: async () => {
          const res = await api?.captureScreenshot?.();
          toast(res?.ok ? `Screenshot saved: ${res.filePath}` : "Screenshot failed");
        },
      }, "Screenshot (F10)"),
      el("button", {
        className: "dih-btn",
        onClick: () => triggerAction("trimMemory"),
      }, "Trim RAM"),
    ]),
    el("span", { className: "dih-badge dih-mono" }, `${catalog.FEATURE_REGISTRY?.length || 196} FEATURES • ewwhardik`),
  ]);

  const stage = el("div", { className: "dih-stage" }, [stageHeader, stageBody, footerBar]);
  shell.append(rail, stage);
  backdrop.appendChild(shell);
  shadowRoot.appendChild(backdrop);

  // --- Helpers ---
  function getPath(obj, dotPath) {
    return String(dotPath || "").split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
  }

  async function updateSetting(dotPath, value) {
    const updated = await api?.setSetting?.(dotPath, value);
    if (updated) setSettingsLocal(updated);
    onRefreshAll();
    renderStage();
  }

  async function triggerAction(actionId) {
    if (!actionId) return;
    if (actionId === "clearCache") {
      await api?.clearCache?.();
      toast("Renderer HTTP/shader cache cleared");
    } else if (actionId === "trimMemory") {
      const res = await api?.trimMemory?.();
      toast(res?.freedMb ? `Trimmed working set (~${res.freedMb} MB freed)` : "Trimmed client working set RAM");
    } else if (actionId === "relaunchApp") {
      await api?.relaunchApp?.();
    } else if (actionId.startsWith("applyPerfPreset:")) {
      const mode = actionId.split(":")[1];
      const updated = await api?.applyPerfPreset?.(mode);
      if (updated) setSettingsLocal(updated);
      toast(`Applied ${mode} profile (relaunch to apply boot flags if changed)`);
    } else if (actionId.startsWith("applyTheme:")) {
      const preset = actionId.split(":")[1];
      const updated = await api?.applyThemePreset?.(preset);
      if (updated) setSettingsLocal(updated);
      toast(`Theme switched to ${preset}`);
    } else if (actionId === "resetHudPositions") {
      await api?.resetHudPositions?.();
      toast("HUD positions reset");
    } else if (actionId === "resetFpsBounds") {
      telemetryHud?.resetFpsBounds?.();
      toast("Min/Max FPS bounds reset");
    } else if (actionId === "captureScreenshot") {
      const res = await api?.captureScreenshot?.();
      toast(res?.ok ? `Saved ${res.filePath}` : "Screenshot error");
    } else if (actionId === "toggleAllHud") {
      const cur = getSettings().hud?.enabled !== false;
      await updateSetting("hud.enabled", !cur);
    } else if (actionId === "toggleFullscreen") {
      await api?.toggleFullscreen?.();
    } else if (actionId === "resetStopwatch") {
      toast("Use B in-game or click the Stopwatch widget Reset button");
    } else if (actionId.startsWith("openStudio:")) {
      const parts = actionId.split(":");
      await api?.openStudio?.(parts[1] || "painter", parts[2] || "");
    } else if (actionId === "rescanSwapFiles") {
      const list = await api?.rescanSwapFiles?.();
      toast(`Rescanned swap folder (${Array.isArray(list) ? list.length : 0} local overrides indexed)`);
    } else if (actionId === "testAutoChat") {
      const res = await autoChat?.triggerManualSend?.();
      toast(res?.ok ? `Sent chat: "${res.message}"` : (res?.reason || "Open Deadshot match chat first to test auto-message"));
    } else if (actionId === "openLeaderboard") {
      close();
      leaderboardModal.open();
    } else if (actionId === "openFolders") {
      await api?.openFolders?.();
    } else if (actionId.startsWith("openExternal:")) {
      const url = actionId.slice("openExternal:".length);
      await api?.openExternal?.(url);
    } else if (actionId === "rescanCorsair") {
      corsairStatusCache = await api?.rescanCorsair?.();
      toast("Rescanned Corsair USB HID & OpenRGB");
    } else if (actionId.startsWith("setCorsairMode:")) {
      await updateSetting("corsair.mode", actionId.split(":")[1]);
    } else if (actionId === "saveSkinPreset") {
      const name = window.prompt("Enter Skin Loadout Preset name:", "Obsidian Setup");
      if (name) {
        const updated = await api?.saveSkinPreset?.(name);
        if (updated) setSettingsLocal(updated);
        toast(`Saved skin preset "${name}"`);
      }
    } else if (actionId === "shuffleSkins") {
      const pool = catalog.OFFICIAL_SKINS?.filter((x) => x.id !== "default") || [];
      if (pool.length) {
        const nextWeapons = {};
        for (const weaponId of Object.keys(catalog.WEAPONS || {})) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          nextWeapons[weaponId] = { mode: "official", officialId: pick.id, wear: 0, customFile: "" };
        }
        const updated = await api?.updateSettings?.({ skins: { swapperEnabled: true, weapons: nextWeapons } });
        if (updated) setSettingsLocal(updated);
        toast("Randomized skins across all 7 guns — Reload Game Textures to apply");
      }
    } else if (actionId === "resetSkins") {
      const nextWeapons = {};
      for (const weaponId of Object.keys(catalog.WEAPONS || {})) {
        nextWeapons[weaponId] = { mode: "default", officialId: "default", wear: 0, customFile: "" };
      }
      const updated = await api?.updateSettings?.({ skins: { weapons: nextWeapons } });
      if (updated) setSettingsLocal(updated);
      toast("Reset all 7 gun skins to Deadshot defaults");
    } else if (actionId === "copyCrosshairCode") {
      try {
        const code = encodeCrosshairCode(getSettings().crosshair || {});
        await navigator.clipboard?.writeText(code);
        toast("Copied crosshair share code to clipboard");
      } catch {
        toast("Copy manually from Crosshair & HUD tab");
      }
    } else if (actionId === "copyLobbyInvite") {
      try {
        await navigator.clipboard?.writeText(window.location.href);
        toast(`Copied lobby URL: ${window.location.href}`);
      } catch {
        toast("Could not access clipboard");
      }
    } else if (actionId === "runHardwareAnalysis") {
      close();
      if (bootAnalyzer?.run) {
        await bootAnalyzer.run({ forceShow: true, applyRecommended: true });
      } else {
        const res = await api?.runHardwareAnalysis?.(true);
        if (res?.settings) setSettingsLocal(res.settings);
        if (res?.analysis) {
          toast(`PC Score ${res.analysis.powerScore}/100 -> ${res.analysis.recommendedPreset.toUpperCase()}`);
        }
      }
      return;
    } else if (actionId.startsWith("applyCrosshairPro:")) {
      const pid = actionId.split(":")[1];
      const PRO_XHAIRS = {
        dih_minimal: { enabled: true, type: "CrossDot", color: "#d4d8df", outlineEnabled: true, outlineColor: "#0a0b0d", outlineWidth: 1.5, size: 7, thickness: 1.5, gap: 3, dotSize: 1.5, opacity: 0.96, rotation: 0, tacticalTicks: false },
        tenz: { enabled: true, type: "Cross", color: "#57f2f2", outlineEnabled: true, outlineColor: "#0a0b0d", outlineWidth: 1, size: 8, thickness: 2, gap: 4, dotSize: 0, opacity: 0.96, rotation: 0, tacticalTicks: false },
        scream: { enabled: true, type: "Dot", color: "#ffffff", outlineEnabled: true, outlineColor: "#000000", outlineWidth: 1.5, size: 4, thickness: 2, gap: 0, dotSize: 2.5, opacity: 1, rotation: 0, tacticalTicks: false },
        circle_tac: { enabled: true, type: "CircleDot", color: "#f2f4f7", outlineEnabled: true, outlineColor: "#0a0b0d", outlineWidth: 1.2, size: 8, thickness: 1.5, gap: 4, dotSize: 1.5, opacity: 0.95, rotation: 0, tacticalTicks: true },
      };
      const patch = PRO_XHAIRS[pid] || PRO_XHAIRS.dih_minimal;
      const updated = await api?.updateSettings?.({ crosshair: patch });
      if (updated) setSettingsLocal(updated);
      toast(`Applied Pro Crosshair: ${pid}`);
    } else if (actionId === "exportDiagnostics") {
      const res = await api?.exportDiagnostics?.({
        telemetry: telemetryHud?.getCurrentMetrics?.(),
        deadshotConfig: readDeadshotSettings(),
      });
      if (res?.ok) toast(`Exported diagnostics: ${res.filePath}`);
    }
    onRefreshAll();
    renderStage();
  }

  function makeToggleCard(title, desc, dotPath) {
    const val = Boolean(getPath(getSettings(), dotPath));
    const sw = el("div", {
      className: `dih-switch${val ? " on" : ""}`,
      onClick: () => updateSetting(dotPath, !val),
    });
    return el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, title),
        desc ? el("div", { className: "dih-row-desc" }, desc) : null,
      ]),
      sw,
    ]);
  }

  function makeSelectCard(title, desc, dotPath, options, asNumber = false) {
    const val = getPath(getSettings(), dotPath);
    const sel = el("select", { className: "dih-select" }, options.map((o) =>
      el("option", { value: o.value, selected: String(val) === String(o.value) ? "selected" : null }, o.label)
    ));
    sel.value = String(val ?? "");
    sel.addEventListener("change", () => updateSetting(dotPath, asNumber ? Number(sel.value) : sel.value));
    return el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [el("div", { className: "dih-row-title" }, title), desc ? el("div", { className: "dih-row-desc" }, desc) : null]),
      sel,
    ]);
  }

  function makeSliderCard(title, dotPath, min, max, step = 1, unit = "") {
    const val = Number(getPath(getSettings(), dotPath) ?? min);
    const readout = el("span", { className: "dih-mono dih-badge" }, `${val}${unit}`);
    const range = el("input", {
      type: "range",
      className: "dih-range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(val),
    });
    range.addEventListener("input", () => {
      readout.textContent = `${range.value}${unit}`;
    });
    range.addEventListener("change", () => updateSetting(dotPath, Number(range.value)));
    return el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [el("div", { className: "dih-row-title" }, title)]),
      el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [readout, range]),
    ]);
  }

  function makeColorCard(title, dotPath) {
    const val = getPath(getSettings(), dotPath) || "#d4d8df";
    const hex = el("span", { className: "dih-mono", style: { fontSize: "11px", color: "var(--dih-muted)" } }, val);
    const picker = el("input", { type: "color", className: "dih-color", value: String(val).slice(0, 7) });
    picker.addEventListener("change", () => {
      hex.textContent = picker.value;
      updateSetting(dotPath, picker.value);
    });
    return el("div", { className: "dih-panel dih-row" }, [
      el("div", { className: "dih-row-title" }, title),
      el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [hex, picker]),
    ]);
  }

  function makeSubTabs(items, currentId, onPick) {
    return el("div", { className: "dih-subtabs" },
      items.map((it) =>
        el("button", {
          className: `dih-subtab${currentId === it.id ? " active" : ""}`,
          onClick: () => {
            onPick(it.id);
            renderStage();
          },
        }, it.label)
      )
    );
  }

  async function togglePinFeature(featureId) {
    const s = getSettings();
    const cur = Array.isArray(s.esportsHud?.pinnedFeatureIds) ? [...s.esportsHud.pinnedFeatureIds] : [];
    const idx = cur.indexOf(featureId);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.unshift(featureId);
    await updateSetting("esportsHud.pinnedFeatureIds", cur.slice(0, 10));
  }

  function buildCreditsCard() {
    return el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row" }, [
        el("div", { style: { display: "flex", alignItems: "center", gap: "12px" } }, [
          el("div", { className: "dih-logo-mark" }, [makeBrandSvg(22)]),
          el("div", {}, [
            el("div", { className: "dih-row-title" }, "Dih Client v0.4 — Application Overview & Developer Credits"),
            el("div", { className: "dih-row-desc" },
              `High-FPS (${isNative ? "Native Rust + Win32 + WebView2 Single-Binary <1 MB EXE" : "Electron Cross-Platform"}) minimalist Deadshot.io client featuring zero-leak Venatus/Prebid adblocking, O(1) Omniverse-style skin swaps & equipped overrides, Minimal & Complete telemetry, F1–F9 HUD hide shortcuts, Auto-Join chat, 7-gun Aim Trainer, Corsair RGB, and ${catalog.FEATURE_REGISTRY?.length || 196} live controls.`
            ),
            el("div", { className: "dih-row-desc dih-mono", style: { marginTop: "4px", color: "var(--dih-accent)" } },
              "Developer: ewwhardik • GitHub: github.com/ewwhardik/dih-deadshot • Discord: ewwhardik"
            ),
          ]),
        ]),
        el("div", { style: { display: "flex", gap: "6px", flexShrink: "0", flexWrap: "wrap" } }, [
          el("button", {
            className: "dih-btn primary",
            onClick: () => triggerAction("openExternal:https://github.com/ewwhardik/dih-deadshot"),
          }, "GitHub Repo"),
          el("button", {
            className: "dih-btn",
            onClick: () => triggerAction("openExternal:https://ewwhardik.github.io/dih-deadshot/"),
          }, "Showcase Site"),
          el("button", {
            className: "dih-btn",
            onClick: async () => {
              await navigator.clipboard?.writeText("ewwhardik");
              toast("Copied Discord username: ewwhardik");
            },
          }, "Discord: ewwhardik"),
        ]),
      ]),
    ]);
  }

  // --- Tab Renderers ---
  function renderOverview() {
    const query = searchInput.value.trim().toLowerCase();
    const m = telemetryHud?.getCurrentMetrics?.() || {};
    const primary = staticHw?.displays?.primary;

    stageTitle.textContent = query ? `Results for "${searchInput.value.trim()}"` : "Dashboard";
    stageSub.textContent = query
      ? "Instant live toggles matching your query"
      : `${primary?.displayFrequency || 60}Hz • ${staticHw?.gpu?.primaryName || "GPU Ready"}`;

    const s = getSettings();
    const pinnedIds = Array.isArray(s.esportsHud?.pinnedFeatureIds) ? s.esportsHud.pinnedFeatureIds : [];
    const pinnedSet = new Set(pinnedIds);

    if (!query) {
      const autoTune = s.autoTune || {};
      const powerScore = Number(autoTune.lastScore) || 78;
      const tierText = String(autoTune.recommendedTier || "esports_desktop").replace(/_/g, " ").toUpperCase();
      const activeMode = s.performance?.presetMode || "max_compute";
      const curFps = m.fps || (primary?.displayFrequency || 144);
      const hostMb = liveSnapshot?.hostMemoryMb != null ? `${Number(liveSnapshot.hostMemoryMb).toFixed(1)} MB` : "1.7 MB";
      const pingMs = liveSnapshot?.network?.rttMs ? `${Math.round(liveSnapshot.network.rttMs)} ms` : "14 ms";

      // Row 1: 4 Visual Bento KPI Cards (Sparklines, Bars & Gauge)
      const kpiRow = el("div", { className: "dih-grid-4" }, [
        el("div", { className: "dih-kpi-card" }, [
          el("div", { className: "dih-kpi-top" }, [
            el("span", { className: "dih-tel-k" }, "FRAME RATE"),
            el("span", { className: "dih-kpi-icon" }, [makeIcon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>', 13)]),
          ]),
          el("div", { className: "dih-kpi-val" }, `${curFps} FPS`),
          makeSparkSvg([0.78, 0.85, 0.82, 0.91, 0.94, 0.89, 0.97, 1].map((x) => curFps * x), "dihG1"),
          el("div", { className: "dih-kpi-sub" }, `${primary?.displayFrequency || 60}Hz Sync • 1% Low ${m.low1Fps || "--"}`),
        ]),
        el("div", { className: "dih-kpi-card" }, [
          el("div", { className: "dih-kpi-top" }, [
            el("span", { className: "dih-tel-k" }, "HOST SHELL"),
            el("span", { className: "dih-kpi-icon" }, [makeIcon('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="10" x2="16" y2="10"/>', 13)]),
          ]),
          el("div", { className: "dih-kpi-val" }, hostMb),
          makeBarSparkSvg([96, 84, 72, 58, 42, 26, 14, 10]),
          el("div", { className: "dih-kpi-sub" }, isNative ? "Rust + Win32 Zero Bloat" : "Minimal Electron Shell"),
        ]),
        el("div", { className: "dih-kpi-card" }, [
          el("div", { className: "dih-kpi-top" }, [
            el("span", { className: "dih-tel-k" }, "LATENCY"),
            el("span", { className: "dih-kpi-icon" }, [makeIcon('<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.05a6 6 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>', 13)]),
          ]),
          el("div", { className: "dih-kpi-val" }, pingMs),
          makeSparkSvg([24, 19, 21, 16, 17, 14, 15, 13], "dihG2"),
          el("div", { className: "dih-kpi-sub" }, "DoH + QUIC Enabled"),
        ]),
        el("div", { className: "dih-kpi-card" }, [
          el("div", { className: "dih-kpi-top" }, [
            el("span", { className: "dih-tel-k" }, "POWER INDEX"),
            el("span", { className: "dih-badge dih-mono" }, activeMode === "max_compute" ? "MAX" : activeMode === "low_end" ? "ECO" : "BAL"),
          ]),
          el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginTop: "2px" } }, [
            el("div", { className: "dih-score-ring" }, [
              makeRingSvg(powerScore),
              el("span", { className: "dih-mono", style: { fontSize: "19px", fontWeight: "700", lineHeight: "1" } }, String(powerScore)),
              el("span", { className: "dih-mono", style: { fontSize: "8px", color: "var(--dih-muted)" } }, "/100"),
            ]),
            el("div", { style: { minWidth: "0" } }, [
              el("div", { className: "dih-row-title", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, tierText),
              el("div", { className: "dih-kpi-sub", style: { marginTop: "4px" } }, `${staticHw?.memory?.totalGb || 16} GB RAM`),
              el("button", { className: "dih-btn", style: { marginTop: "6px", padding: "3px 9px", fontSize: "10.5px" }, onClick: () => triggerAction("runHardwareAnalysis") }, "Re-Scan"),
            ]),
          ]),
        ]),
      ]);

      // Row 2: Visual Hardware Matrix + 2x3 Visual Quick Tiles
      const cpuPct = Math.min(100, Math.max(25, ((staticHw?.cpu?.physicalCores || 6) / 16) * 100));
      const gpuPct = staticHw?.gpu?.vramMb ? Math.min(100, Math.max(30, (staticHw.gpu.vramMb / 12288) * 100)) : 74;
      const ramPct = Math.min(100, Math.max(25, ((staticHw?.memory?.totalGb || 16) / 32) * 100));
      const hzPct = Math.min(100, Math.max(25, ((primary?.displayFrequency || 60) / 240) * 100));

      const hwCard = el("div", { className: "dih-hero-hw", style: { flexDirection: "column", alignItems: "stretch", gap: "12px" } }, [
        el("div", { className: "dih-row" }, [
          el("div", {}, [
            el("div", { className: "dih-row-title" }, "Compute Profile & Rig Bars"),
            el("div", { className: "dih-kpi-sub" }, autoTune.detectedSummary || `${staticHw?.cpu?.model || "CPU"} • ${staticHw?.gpu?.primaryName || "GPU"}`),
          ]),
          el("div", { className: "dih-subtabs" }, [
            { id: "max_compute", label: "Max" },
            { id: "balanced", label: "Balanced" },
            { id: "low_end", label: "Low-End" },
          ].map((p) =>
            el("button", {
              className: `dih-subtab${activeMode === p.id ? " active" : ""}`,
              style: { padding: "4px 10px", fontSize: "11px" },
              onClick: () => triggerAction(`applyPerfPreset:${p.id}`),
            }, p.label)
          )),
        ]),
        el("div", { className: "dih-hw-bars" }, [
          { lbl: "CPU", val: `${staticHw?.cpu?.physicalCores || 6}C`, pct: cpuPct },
          { lbl: "GPU", val: staticHw?.gpu?.vramMb ? `${Math.round(staticHw.gpu.vramMb / 1024)}G` : "DX12", pct: gpuPct },
          { lbl: "RAM", val: `${staticHw?.memory?.totalGb || 16}G`, pct: ramPct },
          { lbl: "REFRESH", val: `${primary?.displayFrequency || 60}Hz`, pct: hzPct },
        ].map((b) =>
          el("div", { className: "dih-hw-bar-col" }, [
            el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "10.5px" } }, [
              el("span", { style: { color: "var(--dih-muted)" } }, b.lbl),
              el("span", { className: "dih-mono" }, b.val),
            ]),
            el("div", { className: "dih-hw-track" }, [el("div", { className: "dih-hw-fill", style: { width: `${Math.round(b.pct)}%` } })]),
          ])
        )),
      ]);

      const matrixTiles = [
        { label: "Crosshair", on: s.crosshair?.enabled, icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>', click: () => updateSetting("crosshair.enabled", !s.crosshair?.enabled) },
        { label: "Adblocker", on: s.window?.adblockerEnabled !== false, icon: '<path d="M12 2l8 4v6c0 5-3.4 9.2-8 10-4.6-.8-8-5-8-10V6l8-4z"/>', click: () => updateSetting("window.adblockerEnabled", !(s.window?.adblockerEnabled !== false)) },
        { label: "Skin Swap", on: s.skins?.swapperEnabled, icon: '<polygon points="12 2 19 21 12 17 5 21 12 2"/>', click: () => updateSetting("skins.swapperEnabled", !s.skins?.swapperEnabled) },
        { label: "Telemetry", on: s.hud?.statsEnabled, icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>', click: () => updateSetting("hud.statsEnabled", !s.hud?.statsEnabled) },
        { label: "Auto Chat", on: s.esportsHud?.autoJoinMessageEnabled, icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', click: () => updateSetting("esportsHud.autoJoinMessageEnabled", !s.esportsHud?.autoJoinMessageEnabled) },
        { label: "Royal Pack", on: false, icon: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7l4 5-4 5-4-5z"/>', click: () => switchTab("skins") },
      ];

      const matrixCard = el("div", { className: "dih-panel", style: { display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "8px" } }, [
        el("div", { className: "dih-row" }, [
          el("span", { className: "dih-row-title" }, "Quick Visual Toggles"),
          el("button", { className: "dih-btn", style: { padding: "3px 9px", fontSize: "10.5px" }, onClick: () => triggerAction("copyLobbyInvite") }, "Copy Invite"),
        ]),
        el("div", { className: "dih-tile-matrix" },
          matrixTiles.map((t) =>
            el("button", { className: `dih-tile-btn${t.on ? " on" : ""}`, onClick: t.click }, [
              makeIcon(t.icon, 16),
              el("span", {}, t.label),
            ])
          )
        ),
      ]);

      const bentoRow = el("div", { className: "dih-bento-asym" }, [hwCard, matrixCard]);

      const pinnedFeats = (catalog.FEATURE_REGISTRY || []).filter((f) => pinnedIds.includes(f.id));
      const favStrip = el("div", { className: "dih-fav-strip" },
        pinnedFeats.length
          ? pinnedFeats.map((pf) => {
              const isOn = pf.settingPath ? Boolean(getPath(s, pf.settingPath)) : false;
              return el("button", {
                className: `dih-btn${isOn ? " primary" : ""}`,
                style: { padding: "4px 10px", fontSize: "11px" },
                onClick: () => (pf.actionId ? triggerAction(pf.actionId) : updateSetting(pf.settingPath, !isOn)),
              }, `★ ${pf.title.replace(/\s*\(.*?\)\s*/g, "").slice(0, 24)}`);
            })
          : [el("span", { className: "dih-badge" }, "Tip: Click ★ on any module below to pin here")]
      );

      const categories = ["all", ...new Set((catalog.FEATURE_REGISTRY || []).map((f) => f.category))];
      const chipRow = el("div", { className: "dih-chip-row" },
        categories.map((cat) =>
          el("button", {
            className: `dih-chip${activeCategory === cat ? " active" : ""}`,
            onClick: () => {
              activeCategory = cat;
              showAllOverview = cat !== "all";
              renderStage();
            },
          }, cat.toUpperCase())
        )
      );

      const stateChips = el("div", { className: "dih-chip-row" },
        [
          { id: "all", label: showAllOverview ? `All (${catalog.FEATURE_REGISTRY.length})` : "Featured (4)" },
          { id: "enabled", label: "Active On" },
          { id: "pinned", label: "Pinned ★" },
          { id: "restart", label: "Boot Flags" },
        ].map((fc) =>
          el("button", {
            className: `dih-chip${activeOverviewFilter === fc.id ? " active" : ""}`,
            onClick: () => {
              if (fc.id === "all") showAllOverview = activeOverviewFilter === "all" ? !showAllOverview : false;
              activeOverviewFilter = fc.id;
              renderStage();
            },
          }, fc.label)
        )
      );

      stageBody.append(
        kpiRow,
        bentoRow,
        favStrip,
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, [
          chipRow,
          stateChips,
        ])
      );
    }

    let filtered = catalog.FEATURE_REGISTRY.filter((f) => {
      if (!query && activeCategory !== "all" && f.category !== activeCategory) return false;
      if (!query && activeOverviewFilter === "enabled") {
        if (!f.settingPath || !getPath(getSettings(), f.settingPath)) return false;
      } else if (!query && activeOverviewFilter === "pinned") {
        if (!pinnedSet.has(f.id)) return false;
      } else if (!query && activeOverviewFilter === "restart") {
        if (!f.requiresRestart) return false;
      }
      if (!query) return true;
      return (
        f.title.toLowerCase().includes(query) ||
        f.description.toLowerCase().includes(query) ||
        f.category.toLowerCase().includes(query) ||
        f.id.toLowerCase().includes(query)
      );
    });

    const isDefaultSlice = !query && activeCategory === "all" && activeOverviewFilter === "all" && !showAllOverview;
    if (isDefaultSlice && filtered.length > 4) {
      filtered = filtered.slice(0, 4);
    }

    if (!filtered.length) {
      stageBody.appendChild(el("div", { className: "dih-panel" }, "No features matched that filter."));
      return;
    }

    const listGrid = el("div", { className: "dih-grid-2" });
    for (const feat of filtered) {
      let ctrl;
      if (feat.controlType === "toggle" && feat.settingPath) {
        const cur = Boolean(getPath(getSettings(), feat.settingPath));
        ctrl = el("div", {
          className: `dih-switch${cur ? " on" : ""}`,
          onClick: () => updateSetting(feat.settingPath, !cur),
        });
      } else if (feat.actionId) {
        ctrl = el("button", { className: "dih-btn", onClick: () => triggerAction(feat.actionId) }, "Run");
      } else if (feat.settingPath) {
        ctrl = el("button", {
          className: "dih-btn",
          onClick: () => {
            const tabMap = {
              performance: "metrics",
              metrics: "metrics",
              hud: "metrics",
              skins: "skins",
              corsair: "corsair",
              crosshair: "crosshair",
              visuals: "tools",
              audio: "tools",
              window: "tools",
              hotkeys: "theme",
              theme: "theme",
            };
            searchInput.value = "";
            switchTab(tabMap[feat.category] || "metrics");
          },
        }, "Open");
      }

      const isPinned = pinnedSet.has(feat.id);
      const pinBtn = el("button", {
        className: `dih-pin-btn${isPinned ? " pinned" : ""}`,
        title: isPinned ? "Unpin favorite" : "Pin to Favorites strip",
        onClick: (e) => {
          e.stopPropagation();
          togglePinFeature(feat.id);
        },
      }, isPinned ? "★" : "☆");

      listGrid.appendChild(
        el("div", { className: "dih-panel dih-row", title: feat.description }, [
          el("div", { style: { minWidth: "0" } }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
              pinBtn,
              el("span", { className: "dih-row-title" }, feat.title),
              feat.requiresRestart ? el("span", { className: "dih-badge" }, "Boot") : null,
            ]),
            el("div", { className: "dih-kpi-sub", style: { marginLeft: "22px" } }, feat.description),
          ]),
          ctrl,
        ])
      );
    }
    stageBody.appendChild(listGrid);
    if (isDefaultSlice) {
      stageBody.appendChild(
        el("div", { style: { display: "flex", justifyContent: "center" } }, [
          el("button", {
            className: "dih-btn",
            onClick: () => { showAllOverview = true; renderStage(); },
          }, `Show All ${catalog.FEATURE_REGISTRY.length} Controls ↓`),
        ])
      );
    }
  }

  function renderMetricsAndPerf() {
    stageTitle.textContent = "Compute, RAM & Network";
    stageSub.textContent = "Hardware profile • 10–15 MB host target • Low-latency tuning";

    const s = getSettings();
    const perf = s.performance || {};
    const netCfg = s.network || {};
    const sys = telemetryHud?.getLatestSystem?.() || liveSnapshot || {};
    const activeMode = perf.presetMode || "max_compute";

    const d = staticHw?.displays?.primary;
    const hwCard = el("div", { className: "dih-grid-2" }, [
      el("div", { className: "dih-panel" }, [
        el("div", { className: "dih-tel-k" }, "CPU & MEMORY"),
        el("div", { className: "dih-row-title", style: { marginTop: "4px" } }, staticHw?.cpu?.model || "CPU"),
        el("div", { className: "dih-row-desc dih-mono" }, `${staticHw?.cpu?.physicalCores || "?"}C / ${staticHw?.cpu?.logicalProcessors || "?"}T • ${staticHw?.memory?.totalGb || "?"} GB RAM`),
      ]),
      el("div", { className: "dih-panel" }, [
        el("div", { className: "dih-tel-k" }, "GPU & DISPLAY"),
        el("div", { className: "dih-row-title", style: { marginTop: "4px" } }, `${staticHw?.gpu?.primaryName || "GPU"} (${staticHw?.gpu?.vramGb || "?"} GB)`),
        el("div", { className: "dih-row-desc dih-mono" }, `${d?.width || 1920}x${d?.height || 1080} • ${d?.displayFrequency || 60}Hz / ${d?.maxRefreshRate || 60}Hz`),
      ]),
    ]);

    const MODE_CARDS = [
      { id: "max_compute", title: "Max Compute", desc: "High priority • EcoQoS OFF • Uncapped" },
      { id: "balanced", title: "Balanced", desc: "Uncapped • Hybrid GPU • 2GB Heap" },
      { id: "low_end", title: "Low-End", desc: "60 FPS cap • 10MB host • 1GB Heap" },
    ];

    const modeGrid = el("div", { className: "dih-grid-3" },
      MODE_CARDS.map((mc) =>
        el("div", {
          className: "dih-panel",
          style: {
            borderColor: activeMode === mc.id ? "var(--dih-accent)" : undefined,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "8px",
          },
        }, [
          el("div", {}, [
            el("div", { className: "dih-row-title" }, mc.title),
            el("div", { className: "dih-row-desc" }, mc.desc),
          ]),
          el("button", {
            className: `dih-btn${activeMode === mc.id ? " primary" : ""}`,
            onClick: () => triggerAction(`applyPerfPreset:${mc.id}`),
          }, activeMode === mc.id ? "Active" : "Switch Mode"),
        ])
      )
    );

    const hostMbStr = sys.hostMemoryMb != null ? `${Number(sys.hostMemoryMb).toFixed(1)} MB` : "-- MB";
    const wvMbStr = sys.webviewMemoryMb != null ? `${Number(sys.webviewMemoryMb).toFixed(0)} MB` : "-- MB";
    const totMbStr = sys.clientMemoryMb != null ? `${Number(sys.clientMemoryMb).toFixed(0)} MB` : "-- MB";

    const ramLiveBanner = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "Memory Budget & Actions"),
        el("div", { className: "dih-row-desc dih-mono" }, `Host ${hostMbStr}/${perf.hostRamTargetMb ?? 12} MB • WebView ${wvMbStr} • Total ${totMbStr}`),
      ]),
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
        el("button", { className: "dih-btn", onClick: () => triggerAction("resetFpsBounds") }, "Reset FPS"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("trimMemory") }, "Trim RAM"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("clearCache") }, "Purge Cache"),
        el("button", { className: "dih-btn primary", onClick: () => triggerAction("relaunchApp") }, "Relaunch"),
      ]),
    ]);

    const ramControlsGrid = el("div", { className: "dih-grid-2" }, [
      makeSliderCard("Host RAM Cap (MB)", "performance.hostRamTargetMb", 10, 15, 1, " MB"),
      makeToggleCard("Auto Host RAM Guard", "Keeps Dih.exe under 15 MB", "performance.autoHostRamGuard"),
      makeSelectCard("WebView2 Memory Mode", "Runtime cache policy", "performance.webviewMemoryMode", [
        { value: "normal", label: "Normal (Peak FPS)" },
        { value: "low", label: "Low Memory" },
      ]),
      makeSelectCard("V8 JS Heap Ceiling", "Requires restart", "performance.jsHeapLimitMb", [
        { value: "1024", label: "1024 MB" },
        { value: "2048", label: "2048 MB" },
        { value: "4096", label: "4096 MB (Max)" },
      ], true),
    ]);

    const pingHostInput = el("input", {
      className: "dih-input dih-mono",
      style: { flex: "1", minWidth: "140px" },
      value: netCfg.pingHost || "deadshot.io",
      placeholder: "deadshot.io",
    });
    const pingResultBadge = el("span", { className: "dih-badge dih-mono" },
      sys.network?.rttMs != null ? `${Math.round(sys.network.rttMs)}ms (±${Number(sys.network.jitterMs || 0).toFixed(1)}ms)` : "Idle"
    );
    const networkHostBar = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "Live Ping Target & Latency Tester"),
        el("div", { className: "dih-row-desc" }, "Background async probe never stalls the WebGL UI thread"),
      ]),
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, [
        pingHostInput,
        pingResultBadge,
        el("button", {
          className: "dih-btn primary",
          onClick: async () => {
            await updateSetting("network.pingHost", pingHostInput.value.trim() || "deadshot.io");
            const r = await api?.probePing?.();
            if (r?.rttMs != null) {
              toast(`Ping ${pingHostInput.value}: ${Math.round(r.rttMs)}ms (±${Number(r.jitterMs || 0).toFixed(1)}ms)`);
            } else {
              toast(`Probed ${pingHostInput.value} (${r?.status || "pending"})`);
            }
          },
        }, "Save & Test Ping"),
      ]),
    ]);

    const networkGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Low-Latency Networking Flags", "Disables background telemetry/reporting noise (Restart)", "network.lowLatencyNetworking"),
      makeToggleCard("Enable HTTP/3 QUIC Transport", "Reduces UDP/TLS connection & handshake stalls (Restart)", "network.quicTransport"),
      makeSelectCard("Encrypted DNS Resolver (DoH)", "Bypass congested ISP resolvers (Restart)", "network.customDnsPreset", [
        { value: "system", label: "System Default DNS" },
        { value: "cloudflare", label: "Cloudflare (1.1.1.1 DoH)" },
        { value: "google", label: "Google (8.8.8.8 DoH)" },
        { value: "quad9", label: "Quad9 (9.9.9.9 DoH)" },
      ]),
      makeToggleCard("Real-Time Background Ping & Jitter Probe", "Continuously updates PING/JITTER in HUD cleanly", "network.livePingProbe"),
    ]);

    const perfGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Disable Frame Rate Limit", "--disable-frame-rate-limit (Uncapped 2000–3000+ FPS)", "performance.disableFrameRateLimit"),
      makeToggleCard("Disable GPU VSync", "--disable-gpu-vsync (Zero display blanking stall)", "performance.disableGpuVsync"),
      makeSliderCard("Software Frame Pacer Cap (0 = Uncapped)", "performance.softwareFpsCap", 0, 300, 30, " FPS"),
      makeToggleCard("Disable Windows 11 EcoQoS Throttling", "Prevents efficiency-core throttling on hybrid CPUs", "performance.disablePowerThrottling"),
      makeToggleCard("Zero-Blur Overlay HUD (Anti-Lag)", "Removes expensive backdrop-filter over 3D WebGL canvas", "performance.noBackdropBlurHud"),
      makeToggleCard("Windows 1ms Low-Latency Timer", "Native timeBeginPeriod(1) high-resolution scheduling", "performance.lowLatencyTimer"),
      makeToggleCard("Prevent Windows Display Sleep", "SetThreadExecutionState active while playing", "performance.preventSleep"),
      makeToggleCard("Force Discrete High-Perf GPU", "Prioritize dedicated NVIDIA/AMD GPU over iGPU", "performance.forceHighPerformanceGpu"),
      makeToggleCard("Hardware GPU Rasterization", "Accelerate compositor surfaces via GPU", "performance.enableGpuRasterization"),
      makeToggleCard("Zero-Copy Texture Uploads", "--enable-zero-copy GPU buffer path", "performance.enableZeroCopy"),
      makeToggleCard("Anti-Background Throttling", "Prevents timer slowdown in unfocused state", "performance.antiBackgroundThrottle"),
      makeToggleCard("Ignore GPU Blocklist", "Bypass conservative driver feature blocks", "performance.ignoreGpuBlocklist"),
      makeToggleCard("GPU Cache Prewarm", "Pre-fetches configured swaps & pipeline cleanly", "performance.gpuCachePrewarm"),
      makeToggleCard("Zero-Stall Ad & Tracker Blocker", "Targeted WebView2 ad-domain blocking (0 game JS/WS impact)", "window.adblockerEnabled"),
      makeSelectCard("ANGLE Graphics Backend", "Direct3D / Vulkan / OpenGL shader translation", "performance.angleBackend", [
        { value: "default", label: "Auto / Default" },
        { value: "d3d11", label: "Direct3D 11" },
        { value: "d3d11on12", label: "Direct3D 12 (on12)" },
        { value: "vulkan", label: "Vulkan" },
        { value: "gl", label: "OpenGL" },
      ]),
      makeSelectCard("Windows Process CPU Priority", "Applies to host + WebView2 GPU/renderer tree", "performance.processPriority", [
        { value: "normal", label: "Normal (Low-End Friendly)" },
        { value: "above_normal", label: "Above Normal" },
        { value: "high", label: "High (Max Compute Default)" },
      ]),
      makeToggleCard("Win32 Dynamic Priority Boost", "SetProcessPriorityBoost fast scheduler wakeups", "performance.enablePriorityBoost"),
      makeToggleCard("P-Core Primary Affinity Mask", "Focuses threads on primary performance cores (8+T CPUs)", "performance.preferPerformanceCores"),
      makeToggleCard("Focus-Aware Priority Scaling", "Auto-relaxes CPU priority when alt-tabbed", "performance.focusPriorityScaling"),
      makeToggleCard("Disable Smooth Scrolling (Restart)", "--disable-smooth-scrolling input latency cleanup", "performance.disableSmoothScrolling"),
      makeToggleCard("WebGL2 Low-Latency Desync", "high-performance + desynchronized canvas attributes", "performance.webglLowLatency"),
      makeSliderCard("WebGL Render DPR Scaler (Reload)", "performance.canvasDprScale", 0.5, 1.25, 0.05, "x"),
      makeToggleCard("Animated PC Boot Analyzer Splash", "Probes CPU/GPU/RAM/Hz smoothly on launch", "autoTune.bootSplashEnabled"),
      makeToggleCard("Auto-Tune Best Settings First Run", "Automatically configures optimal profile from PC power", "autoTune.autoAnalyzeOnFirstRun"),
    ]);

    const pingRateCard = makeSliderCard("Ping Probe Interval", "performance.pingIntervalMs", 1500, 10000, 500, " ms");
    networkGrid.appendChild(pingRateCard);

    const hudGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Show Real Telemetry HUD (F4)", "Real unhooked FPS + system metrics (Press F4 to toggle)", "hud.statsEnabled"),
      makeSelectCard("Telemetry View Mode (F6)", "Switch between 1-line Minimal Pill and Complete Card (or press F6 / double-click HUD)", "hud.telemetryViewMode", [
        { value: "complete", label: "Complete Card (Full Telemetry)" },
        { value: "minimal", label: "Minimal Pill (1-Line FPS / Ping / FT)" },
      ]),
      makeSelectCard("Telemetry Layout Mode", "Visual arrangement when in Complete view", "hud.statsLayout", [
        { value: "compact_card", label: "Compact Card" },
        { value: "top_bar", label: "Top Bar" },
        { value: "minimal_pill", label: "Minimal Pill" },
      ]),
      makeToggleCard("Live Esports Net-Graph", "Scrolling FPS, frametime spikes & RTT curve canvas", "esportsHud.netGraphEnabled"),
      makeToggleCard("Compact Match Session Summary", "Live shots, reloads & match timer pill", "esportsHud.sessionStatsEnabled"),
      makeToggleCard("Active Weapon Slot Badge", "Shows 1 PRIMARY / 2 SIDEARM / 3 MELEE", "esportsHud.weaponSlotBadge"),
      makeToggleCard("Tactical Reload Progress Bar (R)", "Animated reload bar while pointer-locked", "esportsHud.reloadProgressBar"),
      makeSliderCard("Reload Duration Calibration", "esportsHud.reloadDurationMs", 800, 3800, 50, " ms"),
      makeToggleCard("Pointer Lock Status LED Badge", "Shows RAW LOCKED vs MENU CURSOR state", "esportsHud.pointerLockBadge"),
      makeSliderCard("Low-FPS Alert Threshold", "esportsHud.fpsWarningThreshold", 30, 240, 15, " FPS"),
      makeToggleCard("Real FPS Counter", "Live zero-GC requestAnimationFrame delta rate", "hud.showFps"),
      makeToggleCard("Hz Color-Coded FPS Value", "Green >= 2x target, White >= target, Gold below", "hud.fpsColorCoded"),
      makeToggleCard("Min / Max FPS Bounds", "Tracks session lowest & peak FPS inside HUD", "hud.showMinMaxFps"),
      makeToggleCard("1% Low FPS", "Zero-allocation circular buffer 1% low stability", "hud.showOnePercentLow"),
      makeToggleCard("Frametime (ms)", "Exact millisecond interval per frame", "hud.showFrameTime"),
      makeToggleCard("Frametime Sparkline Graph", "Live scrolling frame spike chart", "hud.showFrametimeGraph"),
      makeToggleCard("Monitor Current/Max Hz", "Detected Windows display refresh capability", "hud.showMonitorHz"),
      makeToggleCard("Real Server Ping", "Live async TCP RTT probe to configured host", "hud.showPing"),
      makeToggleCard("Network Jitter", "C-kernel rolling latency variance (ms)", "hud.showJitter"),
      makeToggleCard("System CPU %", "Real OS CPU tick delta usage", "hud.showCpu"),
      makeToggleCard("System RAM", "Physical memory used/total", "hud.showRam"),
      makeToggleCard("Host & Tree RAM Split", "Displays native Host (10–15M) / total WebView footprint", "hud.showClientRam"),
      makeToggleCard("Deadshot Sensitivity & FOV", "Live readout from dsio:settings:2", "hud.showSens"),
      makeToggleCard("Clock & Session Uptime", "Local clock + client timer", "hud.showTime"),
      makeToggleCard("Date in Telemetry Footer", "Shows Month/Day beside clock", "hud.showDate"),
      makeToggleCard("Mouse Aim Vector Indicator", "Directional aim puck inside Keystrokes overlay", "hud.keysShowMouseVector"),
      makeToggleCard("Compact Bottom Hotkey Hint Bar", "Subtle micro shortcut bar when playing", "hud.compactKeybindsHint"),
      makeToggleCard("Magnetic 8px HUD Grid Snap", "Auto-align dragged overlays cleanly", "hud.snapToGrid"),
      makeToggleCard("Lock HUD Positions (No Drag)", "Prevents accidental widget dragging in-game", "esportsHud.lockHudDrag"),
    ]);

    const subBar = makeSubTabs(
      [
        { id: "profiles", label: "Profiles, RAM & Boot" },
        { id: "engine", label: "Engine & WebGL Flags" },
        { id: "network", label: "Network & DoH DNS" },
        { id: "hud", label: "Telemetry & Net-Graph" },
      ],
      activeMetricsSub,
      (id) => { activeMetricsSub = id; }
    );

    stageBody.append(subBar);
    if (activeMetricsSub === "profiles") {
      stageBody.append(
        hwCard,
        el("div", { className: "dih-section-title" }, "COMPUTE & DEVICE PROFILES"),
        modeGrid,
        el("div", { className: "dih-section-title" }, "HOST RAM CUSTOMIZATION (10–15 MB TARGET)"),
        ramLiveBanner,
        ramControlsGrid
      );
    } else if (activeMetricsSub === "engine") {
      stageBody.append(
        el("div", { className: "dih-section-title" }, "NATIVE ENGINE, WIN32 & WEBGL2 OPTIMIZATIONS"),
        perfGrid
      );
    } else if (activeMetricsSub === "network") {
      stageBody.append(
        el("div", { className: "dih-section-title" }, "NETWORK LATENCY, QUIC & DOH DNS OPTIMIZER"),
        networkHostBar,
        networkGrid
      );
    } else {
      stageBody.append(
        el("div", { className: "dih-section-title" }, "TELEMETRY & ESPORTS HUD WIDGETS"),
        hudGrid
      );
    }
  }

  function renderSkins() {
    stageTitle.textContent = "Skin Packs & Studio";
    stageSub.textContent = "Shader packs • Custom .webp swaps • 3D editor";

    const s = getSettings();
    const topBar = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Master Client-Side Skin Swapper", "Intercepts Deadshot weapon & UI textures before load", "skins.swapperEnabled"),
      el("div", { className: "dih-panel dih-row" }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, "3D Gun Skin Creator & Batch Loadout"),
          el("div", { className: "dih-row-desc" }, `${customSkinsCache.length} custom Studio skin(s) saved`),
        ]),
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, [
          el("button", { className: "dih-btn primary", onClick: () => api?.openStudio?.("painter") }, "Create Skin"),
          el("button", { className: "dih-btn", onClick: () => triggerAction("rescanSwapFiles") }, "Rescan Swap/"),
          el("button", { className: "dih-btn", onClick: () => triggerAction("shuffleSkins") }, "Shuffle All"),
          el("button", { className: "dih-btn", onClick: () => triggerAction("resetSkins") }, "Reset"),
          el("button", { className: "dih-btn", onClick: () => api?.openFolders?.() }, "Folder"),
        ]),
      ]),
    ]);

    const syncOpts = el("div", { className: "dih-grid-3" }, [
      makeToggleCard("Override Account Skins", "Swap skins/* even when equipped", "skins.overrideEquippedGameSkin"),
      makeToggleCard("Sync Small HUD Icons", "Updates *compsmall.webp icons", "skins.syncSmallIcons"),
      makeToggleCard("Sync Mobile Variants", "Updates *compmobile.webp", "skins.syncMobileVariants"),
    ]);

    const packStatusEl = el("div", { className: "dih-row-desc dih-mono" }, "WebGL UV bake -> auto-equip 7 guns");

    const loadRelImageCanvas = (relPath) =>
      new Promise((resolve) => {
        if (!relPath) return resolve(null);
        const img = new Image();
        img.crossOrigin = "anonymous";
        const timer = setTimeout(() => resolve(null), 4000);
        img.onload = () => {
          clearTimeout(timer);
          try {
            const c = document.createElement("canvas");
            c.width = 1024;
            c.height = 1024;
            c.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
            resolve(c);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        img.src = `https://deadshot.io/${String(relPath).replace(/^\/+/, "")}`;
      });

    const bakeAndApplyPack = async ({ packName, palette = null, fragSource = null }) => {
      const baker = window.DihSkinPackBaker;
      if (!baker) return toast("Shader baker not available in this context");
      if (typeof api?.saveCustomSkin !== "function") return toast("Custom skin API unavailable");
      const entries = Object.entries(catalog.WEAPONS || {});
      for (let i = 0; i < entries.length; i++) {
        const [weaponId, weapon] = entries[i];
        packStatusEl.textContent = `Baking ${weapon.shortName} (${i + 1}/${entries.length})...`;
        const [baseCanvas, maskCanvas] = await Promise.all([
          loadRelImageCanvas(weapon.texture),
          weapon.mask ? loadRelImageCanvas(weapon.mask) : Promise.resolve(null),
        ]);
        let outCanvas;
        if (fragSource) {
          outCanvas = baker.bakeFragmentShaderToCanvas(fragSource, {
            weaponId,
            baseCanvas,
            maskCanvas,
            width: 1024,
            height: 1024,
          });
        } else {
          outCanvas = document.createElement("canvas");
          outCanvas.width = 1024;
          outCanvas.height = 1024;
          baker.paintCustomPackToContext(outCanvas.getContext("2d"), {
            weaponId,
            palette,
            baseCanvas,
            maskCanvas,
            width: 1024,
            height: 1024,
          });
        }
        await api.saveCustomSkin({
          name: `${packName}-${weapon.shortName}`,
          weaponId,
          dataUrl: outCanvas.toDataURL("image/webp", 0.9),
          applyImmediately: true,
        });
      }
      customSkinsCache = (await api?.listCustomSkins?.()) || customSkinsCache;
      packStatusEl.textContent = `Equipped ${packName} on all ${entries.length} weapons!`;
      toast(`Applied ${packName} across all ${entries.length} weapons -> reload textures to view`);
      render();
    };

    const builtInPacks = Object.values(window.DihSkinPackBaker?.BUILT_IN_SHADER_PACKS || {});
    const packGrid = el("div", { className: "dih-grid-3" },
      builtInPacks.map((pk) =>
        el("div", { className: "dih-panel", style: { display: "flex", flexDirection: "column", gap: "8px" } }, [
          el("div", { style: { display: "flex", gap: "4px", height: "8px", borderRadius: "4px", overflow: "hidden" } }, [
            el("span", { style: { flex: "1", background: pk.palette?.primary || "#12151b" } }),
            el("span", { style: { flex: "1", background: pk.palette?.secondary || "#850611" } }),
            el("span", { style: { flex: "1", background: pk.palette?.trim || "#d1a152" } }),
            el("span", { style: { flex: "1", background: pk.palette?.accent || "#ede0ad" } }),
          ]),
          el("div", { className: "dih-row" }, [
            el("div", {}, [
              el("div", { className: "dih-row-title" }, pk.name),
              el("div", { className: "dih-row-desc" }, pk.frag ? "GLSL suit shader pack (All 7 Guns)" : `Procedural ${pk.palette?.pattern} pack`),
            ]),
            el("button", {
              className: pk.id === "royalflush" ? "dih-btn primary" : "dih-btn",
              onClick: () => bakeAndApplyPack({ packName: pk.name, palette: pk.palette, fragSource: pk.frag || null }),
            }, "Equip All 7"),
          ]),
        ])
      )
    );

    const customPackName = el("input", { className: "dih-input", value: "Custom-Pack", placeholder: "Pack name...", style: { width: "160px" } });
    const colPrimary = el("input", { type: "color", value: "#850611", title: "Primary Color", style: { width: "36px", height: "30px", padding: "0", border: "none", background: "transparent", cursor: "pointer" } });
    const colSecondary = el("input", { type: "color", value: "#12151b", title: "Secondary Color", style: { width: "36px", height: "30px", padding: "0", border: "none", background: "transparent", cursor: "pointer" } });
    const colTrim = el("input", { type: "color", value: "#d1a152", title: "Trim Color", style: { width: "36px", height: "30px", padding: "0", border: "none", background: "transparent", cursor: "pointer" } });
    const patSel = el("select", { className: "dih-select" }, [
      el("option", { value: "carbon" }, "Carbon Weave"),
      el("option", { value: "topo" }, "Topo Contours"),
      el("option", { value: "tiger" }, "Tiger Stripe"),
      el("option", { value: "suits" }, "Royal Flush GLSL Shader"),
    ]);
    const fragUploadInp = el("input", { type: "file", accept: ".frag,.glsl,.fs,.txt", style: { display: "none" } });
    fragUploadInp.addEventListener("change", async () => {
      const f = fragUploadInp.files?.[0];
      if (!f) return;
      try {
        const fragSource = await f.text();
        const nm = (f.name.replace(/\.(frag|glsl|fs|txt)$/i, "") || "ShaderPack").slice(0, 24);
        await bakeAndApplyPack({ packName: nm, fragSource });
      } catch (err) {
        toast(`Shader bake failed: ${err?.message || err}`);
      } finally {
        fragUploadInp.value = "";
      }
    });

    const customPackCard = el("div", { className: "dih-panel", style: { display: "flex", flexDirection: "column", gap: "10px" } }, [
      el("div", { className: "dih-row" }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, "Custom 7-Gun Skin Pack Builder & .frag Baker"),
          packStatusEl,
        ]),
        el("button", { className: "dih-btn", onClick: () => fragUploadInp.click() }, "Import .frag All 7"),
      ]),
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } }, [
        customPackName,
        colPrimary,
        colSecondary,
        colTrim,
        patSel,
        el("button", {
          className: "dih-btn primary",
          onClick: () =>
            bakeAndApplyPack({
              packName: customPackName.value.trim() || "Custom-Pack",
              palette: {
                primary: colPrimary.value,
                secondary: colSecondary.value,
                trim: colTrim.value,
                accent: colTrim.value,
                pattern: patSel.value,
              },
            }),
        }, "Bake & Equip All 7"),
        fragUploadInp,
      ]),
    ]);

    // Custom Studio Vault Quick-Equip cards with thumbnails
    const vaultBlock = customSkinsCache.length
      ? el("div", { className: "dih-grid-3" },
          customSkinsCache.map((cs) =>
            el("div", { className: "dih-panel", style: { display: "flex", alignItems: "center", gap: "10px" } }, [
              el("img", { className: "dih-vault-thumb", src: cs.customUrl || cs.url || "", alt: cs.name }),
              el("div", { style: { flex: "1", minWidth: "0" } }, [
                el("div", { className: "dih-row-title", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, cs.name),
                el("div", { className: "dih-row-desc dih-mono" }, `${cs.weaponId.toUpperCase()} • ${Math.round(((cs.sizeBytes ?? cs.bytes) || 0) / 1024)} KB`),
              ]),
              el("button", {
                className: "dih-btn",
                onClick: async () => {
                  await updateSetting(`skins.weapons.${cs.weaponId}`, {
                    mode: "custom",
                    officialId: "default",
                    wear: 0,
                    customFile: cs.fileName,
                  });
                  toast(`Equipped ${cs.name} on ${cs.weaponId.toUpperCase()}`);
                },
              }, "Equip"),
            ])
          )
        )
      : el("div", { className: "dih-panel dih-row-desc" }, "No custom skins saved yet. Click \"Create Skin\" to paint one in 3D Studio.");

    const weaponsGrid = el("div", { className: "dih-grid-2" });
    for (const [weaponId, weapon] of Object.entries(catalog.WEAPONS)) {
      const cfg = s.skins?.weapons?.[weaponId] || { mode: "default", officialId: "default", wear: 0, customFile: "" };

      const modeSel = el("select", { className: "dih-select" }, [
        el("option", { value: "default", selected: cfg.mode === "default" ? "selected" : null }, "Default Game Skin"),
        el("option", { value: "official", selected: cfg.mode === "official" ? "selected" : null }, "Official Skin Pool"),
        el("option", { value: "custom", selected: cfg.mode === "custom" ? "selected" : null }, "Custom Studio Skin"),
      ]);

      const officialSel = el("select", { className: "dih-select", style: { flex: "1" } },
        catalog.OFFICIAL_SKINS.map((sk) =>
          el("option", { value: sk.id, selected: cfg.officialId === sk.id ? "selected" : null }, `${sk.name} (${sk.rarity})`)
        )
      );

      const wearSel = el("select", { className: "dih-select" },
        [0, 1, 2, 3, 4].map((w) => el("option", { value: String(w), selected: Number(cfg.wear) === w ? "selected" : null }, `Wear ${w}`))
      );

      const customSel = el("select", { className: "dih-select", style: { flex: "1" } }, [
        el("option", { value: "" }, customSkinsCache.length ? "-- Choose Custom Skin --" : "-- None yet (Open Studio) --"),
        ...customSkinsCache.map((cs) =>
          el("option", { value: cs.fileName, selected: cfg.customFile === cs.fileName ? "selected" : null }, `${cs.name} [${cs.weaponId.toUpperCase()}]`)
        ),
      ]);

      const saveWeaponCfg = async (patch) => {
        const next = { ...cfg, ...patch };
        await updateSetting(`skins.weapons.${weaponId}`, next);
        toast(`${weapon.shortName} updated -> reload game textures to view in match`);
      };

      modeSel.addEventListener("change", () => saveWeaponCfg({ mode: modeSel.value }));
      officialSel.addEventListener("change", () => saveWeaponCfg({ mode: "official", officialId: officialSel.value }));
      wearSel.addEventListener("change", () => saveWeaponCfg({ wear: Number(wearSel.value) }));
      customSel.addEventListener("change", () => saveWeaponCfg({ mode: "custom", customFile: customSel.value }));

      weaponsGrid.appendChild(
        el("div", { className: "dih-panel", style: { display: "flex", flexDirection: "column", gap: "8px" } }, [
          el("div", { className: "dih-row" }, [
            el("div", {}, [
              el("div", { className: "dih-row-title" }, weapon.name),
              el("div", { className: "dih-row-desc dih-mono" }, weapon.texture),
            ]),
            modeSel,
          ]),
          el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, [
            ...(cfg.mode === "custom" ? [customSel] : [officialSel, wearSel]),
            el("button", {
              className: "dih-btn",
              title: `Open ${weapon.shortName} in 3D Skin Studio`,
              onClick: () => api?.openStudio?.("painter", weaponId),
            }, "3D"),
            el("button", {
              className: "dih-btn",
              title: `Practice ${weapon.shortName} spray in Aim Trainer`,
              onClick: () => api?.openStudio?.("aimtrainer", weaponId),
            }, "Aim"),
          ]),
        ])
      );
    }

    const extraGrid = el("div", { className: "dih-grid-3" }, [
      makeSelectCard("Scope Reticle Swap", "Custom images/scope.webp", "skins.extraSwaps.scope", [
        { value: "default", label: "Deadshot Default" },
        { value: "dih_minimal", label: "Dih Minimal Cross" },
        { value: "dih_dot", label: "Dih Micro-Dot" },
        { value: "dih_rangefinder", label: "Dih Mil-Dot Rangefinder" },
      ]),
      makeSelectCard("Client Menu Logo", "Centered 1400x300 promo/logo.webp", "skins.extraSwaps.logo", [
        { value: "dih_grey", label: "Dih Minimalist Grey" },
        { value: "default", label: "Deadshot Default" },
      ]),
      makeSelectCard("Skybox Swap Folder", "Reads user swap/skybox/", "skins.extraSwaps.skybox", [
        { value: "default", label: "Default Sky" },
        { value: "dih_graphite", label: "Custom swap/skybox/dih_graphite" },
      ]),
    ]);

    stageBody.append(
      topBar,
      syncOpts,
      el("div", { className: "dih-section-title" }, "SHADER & CUSTOM SKIN PACKS (ALL 7 GUNS)"),
      packGrid,
      customPackCard,
      el("div", { className: "dih-section-title" }, "CUSTOM STUDIO VAULT (1-CLICK EQUIP)"),
      vaultBlock,
      el("div", { className: "dih-section-title" }, "WEAPON LOADOUT SKIN CHANGER"),
      weaponsGrid,
      el("div", { className: "dih-section-title" }, "ENVIRONMENT, SCOPE & BRANDING SWAPS"),
      extraGrid
    );
  }

  function renderCorsair() {
    stageTitle.textContent = "Corsair RGB & OpenRGB";
    stageSub.textContent = "HID VID 0x1B1C • OpenRGB 6742 • Virtual K70";

    const st = corsairStatusCache || {};
    const hwSummary = st.frame?.statusBanner || "Checking hardware...";
    const statusCard = el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row" }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, hwSummary),
          el("div", { className: "dih-row-desc dih-mono" },
            `iCUE: ${st.hardware?.icueRunning ? "On" : "Off"} • USB: ${st.hardware?.usbCorsairDevices?.length || 0} • OpenRGB: ${st.openRgb?.connected ? "Linked" : "Idle"}`
          ),
        ]),
        el("div", { style: { display: "flex", gap: "8px" } }, [
          el("button", { className: "dih-btn", onClick: () => triggerAction("rescanCorsair") }, "Rescan USB"),
          el("button", { className: "dih-btn primary", onClick: () => api?.openStudio?.("corsair") }, "Virtual K70"),
        ]),
      ]),
    ]);

    const openRgbConnect = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "OpenRGB SDK Server"),
        el("div", { className: "dih-row-desc" }, "Sync K70, Vengeance & fans on port 6742"),
      ]),
      el("button", {
        className: "dih-btn",
        onClick: async () => {
          const s = getSettings().corsair || {};
          corsairStatusCache = await api?.connectOpenRgb?.(s.openRgbHost, s.openRgbPort);
          toast(corsairStatusCache?.openRgb?.connected ? "OpenRGB SDK connected" : (corsairStatusCache?.openRgb?.lastError || "OpenRGB not listening"));
          renderStage();
        },
      }, "Connect :6742"),
    ]);

    const grid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Master RGB Engine", "Hardware & virtual lighting", "corsair.enabled"),
      makeSelectCard("Effect Mode", "Reactive telemetry lighting", "corsair.mode", [
        { value: "reactive_tactical", label: "Reactive Tactical (Fire + ADS + Reload)" },
        { value: "fps_thermal", label: "FPS Thermal Gradient" },
        { value: "ping_health", label: "Ping Health Aura" },
        { value: "breathing", label: "Obsidian Breathing" },
        { value: "spectrum", label: "Precision Spectrum Wave" },
        { value: "ads_focus", label: "ADS Focus Dimmer" },
        { value: "reload_sweep", label: "Reload Sweep Wave" },
        { value: "keymap_zones", label: "Tactical Keymap Zones" },
        { value: "audio_pulse", label: "Rhythm Audio Pulse" },
        { value: "static_slate", label: "Static Minimalist Slate" },
      ]),
      makeToggleCard("Auto-Connect OpenRGB", "Link port 6742 on boot", "corsair.autoConnectOpenRgb"),
      makeToggleCard("WebHID Corsair Access", "USB HID VID_1B1C", "corsair.webHidEnabled"),
      makeToggleCard("WASD Cluster Glow", "Distinct slate movement keys", "corsair.highlightWasd"),
      makeToggleCard("Muzzle & Reload Flash", "Flash shot • Sweep R reload", "corsair.flashOnShoot"),
      makeToggleCard("ADS Focus Dimming", "Dims chassis on right-click", "corsair.dimOnAds"),
      makeToggleCard("Sync with Theme", "Follows active client accent", "corsair.syncWithTheme"),
      makeSliderCard("Brightness", "corsair.brightness", 5, 100, 5, "%"),
      makeSliderCard("Animation Speed", "corsair.speed", 0.2, 3, 0.1, "x"),
      makeColorCard("Primary Color", "corsair.primaryColor"),
      makeColorCard("Secondary Color", "corsair.secondaryColor"),
      makeColorCard("Fire Flash Color", "corsair.fireFlashColor"),
      makeColorCard("ADS Accent Color", "corsair.adsColor"),
    ]);

    stageBody.append(statusCard, openRgbConnect, grid);
  }

  function renderCrosshairAndHud() {
    stageTitle.textContent = "Crosshair, HUD & Chat";
    stageSub.textContent = "SVG reticle • F1–F9 hides • Auto-Join match chat";

    const s = getSettings();
    const previewBox = el("div", { className: "dih-xhair-preview" });
    crosshairEngine.renderSvgToContainer(previewBox, s.crosshair, 0, false);

    const shareInput = el("input", {
      className: "dih-input dih-mono",
      style: { flex: "1", fontSize: "11px" },
      value: encodeCrosshairCode(s.crosshair || {}),
    });

    const shareRow = el("div", { className: "dih-panel", style: { display: "flex", flexDirection: "column", gap: "8px" } }, [
      el("div", { className: "dih-row-title" }, "Shareable Crosshair Code (DIH-XHAIR:...)"),
      el("div", { style: { display: "flex", gap: "6px" } }, [
        shareInput,
        el("button", {
          className: "dih-btn",
          onClick: async () => {
            await navigator.clipboard?.writeText(shareInput.value);
            toast("Copied DIH-XHAIR code");
          },
        }, "Copy"),
        el("button", {
          className: "dih-btn primary",
          onClick: async () => {
            try {
              const decoded = decodeCrosshairCode(shareInput.value);
              const updated = await api?.updateSettings?.({ crosshair: decoded });
              if (updated) setSettingsLocal(updated);
              onRefreshAll();
              renderStage();
              toast("Imported crosshair configuration");
            } catch (e) {
              toast(e?.message || "Invalid DIH-XHAIR code");
            }
          },
        }, "Import"),
      ]),
    ]);

    const topGrid = el("div", { className: "dih-grid-2" }, [
      previewBox,
      el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, [
        makeToggleCard("Enable Custom Crosshair", "Renders clean Dih SVG crosshair center-screen", "crosshair.enabled"),
        makeSelectCard("Reticle Geometry", "Choose from 10 calibrated shapes", "crosshair.type", [
          { value: "CrossDot", label: "Cross + Center Dot" },
          { value: "Cross", label: "Classic Cross" },
          { value: "Dot", label: "Minimal Precision Dot" },
          { value: "CircleDot", label: "Circle + Dot" },
          { value: "Circle", label: "Clean Circle" },
          { value: "XShaped", label: "X-Reticle + Dot" },
          { value: "TCross", label: "T-Cross (Open Top)" },
          { value: "Chevron", label: "Chevron Arrow" },
          { value: "Brackets", label: "Side Brackets" },
          { value: "Custom", label: "Custom SVG Markup / Image URL" },
        ]),
      ]),
    ]);

    const xhairGrid = el("div", { className: "dih-grid-2" }, [
      makeSliderCard("Arm Size", "crosshair.size", 2, 40, 1, "px"),
      makeSliderCard("Line Thickness", "crosshair.thickness", 1, 8, 0.5, "px"),
      makeSliderCard("Center Gap", "crosshair.gap", 0, 24, 1, "px"),
      makeSliderCard("Center Dot Radius", "crosshair.dotSize", 0.5, 8, 0.5, "px"),
      makeSliderCard("Opacity", "crosshair.opacity", 0.1, 1, 0.05, ""),
      makeSliderCard("Rotation Angle", "crosshair.rotation", 0, 45, 5, "°"),
      makeColorCard("Crosshair Color", "crosshair.color"),
      makeColorCard("Outline Color", "crosshair.outlineColor"),
      makeToggleCard("Contrast Outline Stroke", "Keeps crosshair readable over skyboxes", "crosshair.outlineEnabled"),
      makeToggleCard("Tactical Stadia Range Ticks", "Fine mil-dot ticks on horizontal crosshair arms", "crosshair.tacticalTicks"),
      makeToggleCard("Mix-Blend Difference Invert", "Auto-inverts crosshair color over bright/dark walls", "crosshair.mixBlendInvert"),
      makeToggleCard("Hide on Right-Click ADS", "Prevents reticle double-vision when scoped", "crosshair.hideOnAds"),
      makeToggleCard("Shrink Smoothly on ADS", "Tightens scale if not hidden on ADS", "crosshair.shrinkOnAds"),
      makeToggleCard("Dynamic Recoil Bloom", "GPU transform expansion while firing", "crosshair.recoilBloom"),
      makeToggleCard("Shot Flash Confirmation", "GPU brightness confirmation on click", "crosshair.hitFlashOnShot"),
      makeToggleCard("Diagonal X Hitmarker Flash", "Crisp 4-tick X hitmarker over crosshair on click", "crosshairPro.hitmarkerFlash"),
      makeToggleCard("Dynamic WASD Velocity Spread", "Expands gap subtly when moving with WASD", "crosshairPro.velocitySpread"),
      makeToggleCard("ADS Sniper Dot-Only Mode", "Collapses crosshair down to center dot on RMB ADS", "crosshairPro.sniperDotOnlyMode"),
      makeToggleCard("Per-Slot (1/2/3) Reticle Auto-Swap", "Changes reticle style per weapon slot", "crosshair.perWeaponProfiles"),
      makeColorCard("Independent Center Dot Color", "crosshairPro.centerDotColor"),
      makeSliderCard("Outline Stroke Alpha", "crosshairPro.outlineOpacity", 0.1, 1.0, 0.05, ""),
    ]);

    const proXhairBar = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "1-Click Pro Reticle Presets"),
        el("div", { className: "dih-row-desc" }, "Instant calibrated competitive reticles"),
      ]),
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, [
        el("button", { className: "dih-btn primary", onClick: () => triggerAction("applyCrosshairPro:dih_minimal") }, "Dih Minimal"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("applyCrosshairPro:tenz") }, "Classic Cyan 1-4-2-2"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("applyCrosshairPro:scream") }, "Pure Tap Dot"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("applyCrosshairPro:circle_tac") }, "Tactical Circle"),
      ]),
    ]);

    const customInput = el("input", {
      className: "dih-input",
      placeholder: "Paste <svg>...</svg> or https://... URL for 'Custom' geometry",
      value: s.crosshair?.customSvgOrUrl || "",
    });
    customInput.addEventListener("change", () => updateSetting("crosshair.customSvgOrUrl", customInput.value));

    const widgetsGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Master HUD (F9)", "Panic hide/show all overlays", "hud.enabled"),
      makeToggleCard("Telemetry Card (F4)", "FPS, ping & hardware card", "hud.statsEnabled"),
      makeToggleCard("Custom Reticle (F2)", "Centered SVG crosshair", "crosshair.enabled"),
      makeToggleCard("Keystrokes + CPS (F3)", "WASD & click-rate pill", "hud.keysOverlayEnabled"),
      makeToggleCard("Watermark Tag (F1)", "Minimal client corner badge", "hud.watermarkEnabled"),
      makeSliderCard("HUD Scale", "esportsHud.hudScale", 0.75, 1.35, 0.05, "x"),
      makeSliderCard("HUD Opacity", "esportsHud.hudOpacity", 0.4, 1.0, 0.05, ""),
      makeToggleCard("Lock HUD Grid", "Prevent accidental drag", "esportsHud.lockHudDrag"),
      makeToggleCard("Net-Graph Strip", "Live FPS/FT/Ping sparkline", "esportsHud.netGraphEnabled"),
      makeToggleCard("Match Session Pill", "Shots, reloads & timer", "esportsHud.sessionStatsEnabled"),
      makeToggleCard("Weapon Slot Badge", "1 Primary • 2 Side • 3 Melee", "esportsHud.weaponSlotBadge"),
      makeToggleCard("Reload Ring (R)", "Reticle reload progress", "esportsHud.reloadProgressBar"),
      makeToggleCard("Pointer Lock LED", "Raw lock vs cursor state", "esportsHud.pointerLockBadge"),
      makeToggleCard("K / D / A Counter", "Track kills ([ / ]) & ratio", "hud.kdTrackerEnabled"),
      makeToggleCard("KPM & Streak", "Kills-per-minute rate", "hud.sessionKpmEnabled"),
      makeToggleCard("Stopwatch (B)", "Centisecond round clock", "hud.stopwatchEnabled"),
      makeToggleCard("Warmup Timer", "Goal countdown + chime", "hud.warmupTimerEnabled"),
      makeSliderCard("Warmup Seconds", "hud.warmupDurationSec", 60, 1800, 60, "s"),
      makeToggleCard("Reaction Tester", "Built-in reflex benchmark", "hud.reactionWidgetEnabled"),
      makeToggleCard("Companion Badge", "Custom GIF/PNG overlay", "hud.companionGifEnabled"),
      makeToggleCard("Streamer Privacy Blur", "Blurs lobby username", "hud.streamerPrivacyBlur"),
    ]);

    const autoChatMsgInput = el("input", {
      className: "dih-input",
      placeholder: "Dih User Joined",
      maxLength: "120",
      value: s.autoChat?.message ?? "Dih User Joined",
    });
    autoChatMsgInput.addEventListener("change", () => {
      updateSetting("autoChat.message", autoChatMsgInput.value.trim() || "Dih User Joined");
    });

    const autoChatCard = el("div", { className: "dih-panel", style: { display: "flex", flexDirection: "column", gap: "8px" } }, [
      el("div", { className: "dih-row" }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, "Auto-Join Match Chat Message"),
          el("div", { className: "dih-row-desc" }, "Automatically sends your custom chat message when entering a Deadshot match (Default: \"Dih User Joined\")"),
        ]),
        el("button", { className: "dih-btn primary", onClick: () => triggerAction("testAutoChat") }, "Test Send Now"),
      ]),
      el("div", { className: "dih-grid-2" }, [
        makeToggleCard("Enable Auto-Join Chat", "Sends message through [Enter] to use chat on match load", "autoChat.enabled"),
        makeToggleCard("Once Per Match Join", "Waits for returning to lobby before sending again", "autoChat.onlyOnMatchJoin"),
        makeSliderCard("Match Load Delay", "autoChat.delayMs", 300, 5000, 100, " ms"),
        makeSliderCard("Anti-Spam Cooldown", "autoChat.cooldownMs", 5000, 60000, 1000, " ms"),
      ]),
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
        el("span", { className: "dih-tel-k", style: { whiteSpace: "nowrap" } }, "CHAT MESSAGE:"),
        autoChatMsgInput,
      ]),
    ]);

    const gifInput = el("input", {
      className: "dih-input",
      placeholder: "Companion GIF/PNG URL or data:image/... URL",
      value: s.hud?.companionGifPath || "",
    });
    gifInput.addEventListener("change", () => updateSetting("hud.companionGifPath", gifInput.value));

    const xSub = makeSubTabs(
      [
        { id: "reticle", label: "Custom Crosshair Studio" },
        { id: "hud", label: "HUD Widgets, Chat & Locks" },
      ],
      activeCrosshairSub,
      (id) => { activeCrosshairSub = id; }
    );

    stageBody.append(xSub);
    if (activeCrosshairSub === "reticle") {
      stageBody.append(topGrid, proXhairBar, shareRow, customInput, xhairGrid);
    } else {
      stageBody.append(
        el("div", { className: "dih-section-title" }, "ESPORTS HUD OVERLAYS & INDIVIDUAL HIDE HOTKEYS"),
        widgetsGrid,
        el("div", { className: "dih-section-title" }, "MATCH JOIN AUTO-CHAT AUTOMATION"),
        autoChatCard,
        gifInput
      );
    }
  }

  function renderVisualsAudioSync() {
    stageTitle.textContent = "Visual Grading, Aim/eDPI & Deadshot Sync";
    stageSub.textContent = "Real-time GPU color filters, eDPI / cm-360° calculator & dsio:settings:2 / dsio:keybinds:2 inspector";

    const s = getSettings();
    const ds = readDeadshotSettings();
    const binds = readDeadshotKeybinds();

    const dpi = Number(s.hud?.mouseDpi || 800);
    const inGameSens = Number(ds?.sensitivity ?? 1);
    const eDpi = Math.round(dpi * inGameSens);
    const cmPer360 = inGameSens > 0 ? ((2.54 * 16363) / Math.max(1, eDpi)).toFixed(1) : "--";

    const dpiInput = el("input", {
      type: "number",
      className: "dih-input dih-mono",
      style: { width: "92px" },
      min: "100",
      max: "25600",
      step: "50",
      value: String(dpi),
    });
    dpiInput.addEventListener("change", () => {
      updateSetting("hud.mouseDpi", Math.max(100, Math.min(25600, Number(dpiInput.value) || 800)));
    });

    const aimCard = el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row", style: { marginBottom: "8px" } }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, "eDPI & Estimated cm/360° Calculator"),
          el("div", { className: "dih-row-desc dih-mono" },
            `Mouse DPI x dsio:settings:2 Sens (${ds?.sensitivity ?? "--"}) => eDPI: ${eDpi} • Est. ${cmPer360} cm/360°`
          ),
        ]),
        el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
          el("span", { className: "dih-tel-k" }, "DPI:"),
          dpiInput,
        ]),
      ]),
    ]);

    const syncPanel = el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row", style: { marginBottom: "8px" } }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, "Direct Deadshot dsio:settings:2 Inspector"),
          el("div", { className: "dih-row-desc dih-mono" },
            ds
              ? `FOV: ${ds.fov ?? "--"}° • Sens: ${ds.sensitivity ?? "--"} • RawMouse: ${ds.rawMouse ?? "--"} • Scale: ${ds.renderScale ?? "--"} • AA: ${ds.antialias ?? "--"}`
              : "Deadshot settings key will appear once Deadshot finishes initializing."
          ),
        ]),
        el("button", { className: "dih-btn", onClick: () => { close(); leaderboardModal.open(); } }, "Live Leaderboards"),
      ]),
      ds
        ? el("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, [
            el("span", { className: "dih-tel-k" }, "SET FOV:"),
            ...[75, 90, 100, 105, 110].map((fovVal) =>
              el("button", {
                className: `dih-btn${Number(ds.fov) === fovVal ? " primary" : ""}`,
                onClick: () => {
                  writeDeadshotSetting(35, fovVal);
                  toast(`Wrote FOV ${fovVal}° to dsio:settings:2`);
                  renderStage();
                },
              }, `${fovVal}°`)
            ),
            el("button", {
              className: "dih-btn",
              onClick: () => {
                writeDeadshotSetting(5, !ds.rawMouse);
                toast(`Toggled Deadshot Raw Mouse Input -> ${!ds.rawMouse}`);
                renderStage();
              },
            }, `RawMouse (${ds.rawMouse ? "ON" : "OFF"})`),
            el("button", {
              className: "dih-btn",
              onClick: () => {
                writeDeadshotSetting(9, !ds.antialias);
                toast(`Toggled Deadshot Antialias -> ${!ds.antialias}`);
                renderStage();
              },
            }, `Antialias (${ds.antialias ? "ON" : "OFF"})`),
          ])
        : null,
    ]);

    const keybindCard = el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row-title", style: { marginBottom: "6px" } }, "Live dsio:keybinds:2 Bindings Inspector (29 Slots)"),
      binds
        ? el("div", {
            className: "dih-mono",
            style: { display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "10.5px" },
          },
            (catalog.DSIO_KEYBIND_KEYS || []).slice(0, binds.length).map((name, idx) =>
              el("span", { className: "dih-badge" }, `${name}: ${binds[idx]?.value ?? "-"}`)
            )
          )
        : el("div", { className: "dih-row-desc" }, "Log into or load Deadshot game lobby once to populate dsio:keybinds:2."),
    ]);

    const VISUAL_PRESETS = {
      clean: { filterEnabled: false, brightness: 100, contrast: 100, saturation: 100, hueRotate: 0, sepia: 0, grayscale: 0, sharpnessBoost: 0 },
      esports_vibrance: { filterEnabled: true, brightness: 104, contrast: 112, saturation: 132, hueRotate: 0, sepia: 0, grayscale: 0, sharpnessBoost: 25 },
      crisp_clarity: { filterEnabled: true, brightness: 102, contrast: 116, saturation: 108, hueRotate: 0, sepia: 0, grayscale: 0, sharpnessBoost: 55 },
      noir_slate: { filterEnabled: true, brightness: 98, contrast: 118, saturation: 45, hueRotate: 0, sepia: 0, grayscale: 70, sharpnessBoost: 15 },
    };

    const presetSel = el("select", { className: "dih-select" }, [
      el("option", { value: "clean", selected: s.visuals?.preset === "clean" ? "selected" : null }, "Clean Native"),
      el("option", { value: "esports_vibrance", selected: s.visuals?.preset === "esports_vibrance" ? "selected" : null }, "Esports Contrast + Vibrance"),
      el("option", { value: "crisp_clarity", selected: s.visuals?.preset === "crisp_clarity" ? "selected" : null }, "Crisp Clarity + Sharpen"),
      el("option", { value: "noir_slate", selected: s.visuals?.preset === "noir_slate" ? "selected" : null }, "Monochrome Noir Slate"),
    ]);
    presetSel.value = s.visuals?.preset || "clean";
    presetSel.addEventListener("change", async () => {
      const pKey = presetSel.value;
      const pVals = VISUAL_PRESETS[pKey] || VISUAL_PRESETS.clean;
      const updated = await api?.updateSettings?.({ visuals: { preset: pKey, ...pVals } });
      if (updated) setSettingsLocal(updated);
      onRefreshAll();
      renderStage();
      toast(`Applied ${pKey} visual preset`);
    });
    const visPresetCard = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "Quick Filter Preset"),
        el("div", { className: "dih-row-desc" }, "Applies preset color grading & sharpen values immediately"),
      ]),
      presetSel,
    ]);

    const visGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Enable Visual Color Grading", "Applies clean CSS GPU filter onto Deadshot canvas", "visuals.filterEnabled"),
      makeToggleCard("Night Shield (Warm Eye Relief)", "Subtle warm filter for late sessions", "visuals.blueLightShield"),
      makeToggleCard("Scope Edge Vignette Enhancer", "Crisp dark slate radial border framing", "visuals.scopeVignetteEnhancer"),
      visPresetCard,
      makeSliderCard("Brightness", "visuals.brightness", 50, 150, 2, "%"),
      makeSliderCard("Contrast", "visuals.contrast", 60, 160, 2, "%"),
      makeSliderCard("Saturation", "visuals.saturation", 0, 200, 5, "%"),
      makeSliderCard("Hue Rotate", "visuals.hueRotate", 0, 360, 5, "°"),
      makeSliderCard("Canvas Edge Sharpen Boost", "visuals.sharpnessBoost", 0, 100, 5, "%"),
      makeSliderCard("SVG Gamma Black Equalizer", "visuals.blackEqualizer", 0, 50, 2, ""),
      makeSliderCard("Digital Vibrance Boost", "visuals.digitalVibranceBoost", 0, 100, 5, "%"),
      makeSliderCard("Scope Vignette Darkness", "visuals.vignetteDarkness", 10, 90, 5, "%"),
      makeToggleCard("Clean Hide Lobby Promo Banners", "Conceals distracting web promos around menus", "visuals.cleanHideGamePromo"),
      makeToggleCard("High-Contrast Menu Cursor", "Crisp crosshair cursor across obsidian surfaces", "visuals.highContrastCursor"),
      makeToggleCard("Auto-Sync to Deadshot On Load", "Writes target FOV/scale/AA automatically into dsio:settings:2", "deadshotSync.autoSyncOnLoad"),
      makeSliderCard("Sync Target FOV", "deadshotSync.targetFov", 60, 120, 5, "°"),
      makeSelectCard("Sync Render Scale", "Deadshot canvas resolution factor", "deadshotSync.targetRenderScale", [
        { value: "0.75", label: "0.75x (Low-End GPU Boost)" },
        { value: "1", label: "1.0x Native" },
        { value: "1.25", label: "1.25x Crisp" },
        { value: "1.5", label: "1.5x Ultra" },
      ], true),
      makeToggleCard("Sync Target Antialias", "Controls Deadshot WebGL MSAA toggle", "deadshotSync.targetAntialias"),
      makeToggleCard("Hide Deadshot Native Crosshair", "Avoids double crosshair when using Dih reticle", "deadshotSync.hideNativeCrosshair"),
    ]);

    const winAudioGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Client Master Mute (F8)", "Silences client output instantly", "audio.masterMuted"),
      makeToggleCard("Audio Peak Soft Limiter", "Prevents clipping across overlapping synth tones", "audio.audioLimiterEnabled"),
      makeToggleCard("Crisp Hitmarker Audio Tick", "Synthesized precision transient on locked click", "audio.hitmarkerSoundEnabled"),
      makeToggleCard("Tactical Click / Kill Chime", "Clean WebAudio feedback when logging kills", "audio.playClientKillTone"),
      makeToggleCard("Shot Synthesis Micro-Tick", "Subtle audio transient on trigger pull", "audio.playClientHeadshotTone"),
      makeSliderCard("Client Feedback Volume", "audio.clientFeedbackVolume", 0, 1, 0.05, ""),
      makeToggleCard("Suppress Right-Click Context Menu", "Stops browser menu popups during fast ADS flicks", "privacyPro.blockContextMenu"),
      makeToggleCard("Confirm Before Window Close", "Prevents accidental mid-match close / Alt+F4", "privacyPro.confirmOnClose"),
      makeToggleCard("Always On Top", "Pins Dih above all desktop windows", "window.alwaysOnTop"),
      makeToggleCard("Borderless Fullscreen (F11)", "Enables immersive fullscreen on launch", "window.autoFullscreen"),
      makeToggleCard("Borderless Maximized Window", "Maximizes cleanly to monitor work area without window frame", "window.borderlessMaximized"),
      makeSliderCard("Window Master Opacity", "window.opacity", 0.35, 1, 0.05, ""),
      makeToggleCard("Discord Rich Presence", "Shows active Dih session in Discord", "window.discordRpcEnabled"),
      makeToggleCard("Discord Privacy Mode", "Hides weapon & skin details from Discord status", "window.discordPrivacyMode"),
      makeToggleCard("User-Agent Stealth", "Strips wrapper signatures (restart required)", "window.userAgentStealth"),
    ]);

    const toolsSub = makeSubTabs(
      [
        { id: "visuals", label: "Visuals, Black EQ & Sharpen" },
        { id: "aim", label: "Aim/eDPI & dsio:settings:2" },
        { id: "audio", label: "Audio, Window & Privacy" },
      ],
      activeToolsSub,
      (id) => { activeToolsSub = id; }
    );

    stageBody.append(toolsSub);
    const trainerCard = el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row", style: { marginBottom: "8px" } }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, "Deadshot 7-Gun Ballistic Aim Trainer (Insert)"),
          el("div", { className: "dih-row-desc" },
            "Pointer-Lock 3D trainer matched to Deadshot AR/SMG/AWP/Shotgun/DMR/Pistol/LMG RPM, spray recoil patterns, reload timings, and your live Dih crosshair."
          ),
        ]),
        el("button", {
          className: "dih-btn primary",
          onClick: () => api?.openStudio?.("aimtrainer", "ar"),
        }, "Launch Aim Trainer"),
      ]),
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, [
        { id: "ar", label: "AR Spray Control (650 RPM)" },
        { id: "smg", label: "Vector SMG Tracking (960 RPM)" },
        { id: "awp", label: "AWP Quick-Scope Flicks" },
        { id: "shotgun", label: "Shotgun 8-Pellet Entry" },
        { id: "dmr", label: "DMR Headshot Tap" },
      ].map((g) =>
        el("button", {
          className: "dih-btn",
          onClick: () => api?.openStudio?.("aimtrainer", g.id),
        }, g.label)
      )),
    ]);

    if (activeToolsSub === "visuals") {
      stageBody.append(el("div", { className: "dih-section-title" }, "CANVAS COLOR GRADING, BLACK EQ & OPTICS"), visGrid);
    } else if (activeToolsSub === "aim") {
      stageBody.append(trainerCard, aimCard, syncPanel, keybindCard);
    } else {
      stageBody.append(el("div", { className: "dih-section-title" }, "AUDIO, WINDOW & PRIVACY"), winAudioGrid);
    }
  }

  function renderThemeAndProfiles() {
    stageTitle.textContent = "Minimalist Theme, Hotkeys, Profiles & Overview";
    stageSub.textContent = "Obsidian & Titanium palettes • Interactive shortcut rebinding • Credits: ewwhardik";

    const s = getSettings();
    const presetRow = el("div", { className: "dih-grid-2" },
      Object.entries(catalog.THEME_PRESETS || {}).map(([key, preset]) =>
        el("div", { className: "dih-panel dih-row" }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
            el("span", { style: { width: "18px", height: "18px", borderRadius: "4px", background: preset.surface, border: `2px solid ${preset.accent}` } }),
            el("div", {}, [
              el("div", { className: "dih-row-title" }, preset.name),
              el("div", { className: "dih-row-desc dih-mono" }, `${preset.surface} • ${preset.accent}`),
            ]),
          ]),
          el("button", {
            className: `dih-btn${s.theme?.preset === key ? " primary" : ""}`,
            onClick: () => triggerAction(`applyTheme:${key}`),
          }, "Apply"),
        ])
      )
    );

    const customTheme = el("div", { className: "dih-grid-2" }, [
      makeColorCard("Custom Accent Color", "theme.accent"),
      makeColorCard("Custom Surface Base", "theme.surface"),
      makeSelectCard("Command Center UI Density", "Switch between comfortable & ultra-compact grid", "theme.density", [
        { value: "cozy", label: "Cozy (Standard Spacing)" },
        { value: "compact", label: "Compact (Dense View)" },
      ]),
      makeSliderCard("Command Modal Frosted Glass Blur", "theme.blurPx", 0, 32, 2, "px"),
      makeSliderCard("Panel Surface Opacity", "theme.bgOpacity", 0.35, 1, 0.02, ""),
      makeSliderCard("Corner Radius", "theme.compactCornerRadius", 0, 18, 1, "px"),
      makeToggleCard("Deadshot Native Menu & Logo Polish", "Aligns centered logo & dark matte lobby chrome", "theme.minimalistGameUi"),
      makeToggleCard("Compact Navigation Rail", "Slims Command Center left sidebar width", "esportsHud.compactNavRail"),
      makeToggleCard("Reduce UI Motion / Animations", "Instant zero-lag transitions across modals & HUD", "performance.reduceMotionUi"),
    ]);

    // Interactive Hotkey Rebinding (aligned 1:1 with DEFAULT_SETTINGS.hotkeys & Win32/DOM listeners)
    const HOTKEY_DEFS = [
      { key: "toggleGui", label: "Toggle Command Center", def: "RightShift" },
      { key: "hideAllHud", label: "Toggle All HUD Overlays", def: "F9" },
      { key: "toggleTelemetry", label: "Toggle Telemetry HUD", def: "F4" },
      { key: "toggleTelemetryView", label: "Switch Minimal / Complete HUD", def: "F6" },
      { key: "toggleCrosshair", label: "Toggle Custom Crosshair", def: "F2" },
      { key: "toggleKeysOverlay", label: "Toggle Keystrokes Overlay", def: "F3" },
      { key: "toggleWatermark", label: "Toggle Top-Right Watermark", def: "F1" },
      { key: "openStudio", label: "Open 3D Skin Studio", def: "F7" },
      { key: "openAimTrainer", label: "Open 7-Gun Aim Trainer", def: "Insert" },
      { key: "muteMaster", label: "Master Mute Client", def: "F8" },
      { key: "screenshot", label: "Capture Screenshot", def: "F10" },
      { key: "fullscreen", label: "Toggle Borderless Fullscreen", def: "F11" },
      { key: "stopwatchToggle", label: "Toggle Match Stopwatch", def: "KeyB" },
      { key: "quickReload", label: "Reload Game & Textures", def: "F5" },
    ];

    const bindGrid = el("div", { className: "dih-grid-2" },
      HOTKEY_DEFS.map((hk) => {
        const curCode = s.hotkeys?.[hk.key] || hk.def;
        const btn = el("button", { className: "dih-btn dih-mono" }, curCode);
        btn.addEventListener("click", () => {
          btn.textContent = "Press Key...";
          const listener = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            window.removeEventListener("keydown", listener, true);
            if (ev.code === "Escape") {
              btn.textContent = curCode;
              return;
            }
            updateSetting(`hotkeys.${hk.key}`, ev.code);
            playTone("click", 0.4);
            toast(`Rebound "${hk.label}" -> ${ev.code}`);
          };
          window.addEventListener("keydown", listener, true);
        });
        return el("div", { className: "dih-panel dih-row" }, [
          el("div", { className: "dih-row-title" }, hk.label),
          btn,
        ]);
      })
    );

    const actions = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "Profiles, HUD Reset & Diagnostics"),
        el("div", { className: "dih-row-desc" }, "Portable backup of all settings, skins configuration, and HUD widget positions."),
      ]),
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
        el("button", { className: "dih-btn", onClick: async () => { const r = await api?.exportProfile?.(); if (r?.ok) toast(`Exported to ${r.filePath}`); } }, "Export Profile"),
        el("button", { className: "dih-btn", onClick: async () => { const r = await api?.importProfile?.(); if (r?.ok) { setSettingsLocal(r.settings); onRefreshAll(); renderStage(); toast("Imported profile"); } } }, "Import Profile"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("exportDiagnostics") }, "Export Diagnostics"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("resetHudPositions") }, "Reset HUD Grid"),
        el("button", { className: "dih-btn", onClick: async () => { const r = await api?.resetAllSettings?.(); if (r) { setSettingsLocal(r); onRefreshAll(); renderStage(); toast("Factory defaults restored"); } } }, "Factory Reset"),
      ]),
    ]);

    stageBody.append(
      buildCreditsCard(),
      el("div", { className: "dih-section-title" }, "PREMIUM GREY PRESETS"),
      presetRow,
      el("div", { className: "dih-section-title" }, "FINE SURFACE, DENSITY & GLASS TUNING"),
      customTheme,
      el("div", { className: "dih-section-title" }, "INTERACTIVE HOTKEY REBINDER"),
      bindGrid,
      actions
    );
  }

  function renderStage() {
    const s = getSettings();
    shell.classList.toggle("compact", s.theme?.density === "compact");
    shell.classList.toggle("compact-rail", Boolean(s.esportsHud?.compactNavRail));
    rebuildQuickDock();
    stageBody.innerHTML = "";
    const hasQuery = Boolean(searchInput.value.trim());
    if (hasQuery || activeTab === "overview") renderOverview();
    else if (activeTab === "metrics") renderMetricsAndPerf();
    else if (activeTab === "skins") renderSkins();
    else if (activeTab === "corsair") renderCorsair();
    else if (activeTab === "crosshair") renderCrosshairAndHud();
    else if (activeTab === "tools") renderVisualsAudioSync();
    else if (activeTab === "theme") renderThemeAndProfiles();
  }

  function switchTab(tabId) {
    activeTab = tabId;
    for (const [id, btn] of Object.entries(navButtons)) {
      btn.classList.toggle("active", id === tabId);
    }
    renderStage();
  }

  searchInput.addEventListener("input", () => renderStage());

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  async function open() {
    bootAnalyzer?.dismiss?.();
    backdrop.classList.remove("dih-hidden");
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    try {
      customSkinsCache = (await api?.listCustomSkins?.()) || [];
      corsairStatusCache = await api?.getCorsairStatus?.();
      liveSnapshot = await api?.getLiveMetrics?.();
      const m = telemetryHud?.getCurrentMetrics?.();
      if (m) liveMiniStatus.textContent = `${m.fps || 0} FPS • ${m.monitorHz || 60}HZ`;
    } catch {}
    renderStage();
  }

  function close() {
    backdrop.classList.add("dih-hidden");
  }

  function isOpen() {
    return !backdrop.classList.contains("dih-hidden");
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  return {
    open,
    close,
    toggle,
    isOpen,
    refresh: () => {
      if (isOpen()) renderStage();
    },
  };
};
