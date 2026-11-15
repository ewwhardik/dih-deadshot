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

  // Left Navigation Rail — aligned symmetrical mark + DIH CLIENT + engine badge
  const searchInput = el("input", {
    className: "dih-input",
    placeholder: `Search ${catalog.FEATURE_REGISTRY?.length || 146} features...`,
  });
  const liveMiniStatus = el("div", { className: "dih-brand-sub dih-mono" }, "UNCAPPED • READY");
  const railHead = el("div", { className: "dih-brand-box" }, [
    el("div", { className: "dih-brand-left" }, [
      el("div", { className: "dih-logo-mark" }, [makeBrandSvg(20)]),
      el("div", { className: "dih-brand-meta" }, [
        el("div", { className: "dih-brand-title-row" }, [
          el("div", { className: "dih-brand-title" }, "DIH CLIENT"),
          el("span", { className: "dih-engine-tag dih-mono" }, isNative ? "RUST NATIVE" : "ELECTRON"),
        ]),
        liveMiniStatus,
      ]),
    ]),
  ]);

  const TABS = [
    { id: "overview", label: "Overview & Search", tag: String(catalog.FEATURE_REGISTRY?.length || 146) },
    { id: "metrics", label: "PC Metrics & Perf", tag: "2000+" },
    { id: "skins", label: "Skin Changer", tag: "7 GUNS" },
    { id: "corsair", label: "Corsair & RGB", tag: "HID" },
    { id: "crosshair", label: "Crosshair & HUD", tag: "SVG" },
    { id: "tools", label: "Visuals, Aim & Sync", tag: "DSIO" },
    { id: "theme", label: "Theme, Binds & About", tag: "v2.0" },
  ];

  let activeTab = "overview";
  let activeCategory = "all";
  let customSkinsCache = [];
  let corsairStatusCache = null;
  let liveSnapshot = null;

  const navContainer = el("div", { className: "dih-nav" });
  const navButtons = {};

  for (const tab of TABS) {
    const btn = el("button", {
      className: `dih-nav-item${tab.id === activeTab ? " active" : ""}`,
      onClick: () => {
        searchInput.value = "";
        switchTab(tab.id);
      },
    }, [
      el("span", {}, tab.label),
      el("span", { className: "dih-badge dih-mono" }, tab.tag),
    ]);
    navButtons[tab.id] = btn;
    navContainer.appendChild(btn);
  }

  const railFoot = el("div", { className: "dih-rail-foot" }, [
    el("button", {
      className: "dih-btn primary",
      style: { width: "100%" },
      onClick: () => api?.openStudio?.("painter"),
    }, "3D Skin Studio (F7)"),
    el("button", {
      className: "dih-btn",
      style: { width: "100%" },
      onClick: () => api?.openStudio?.("explorer"),
    }, "Deadshot RE Explorer"),
    el("div", {
      style: {
        marginTop: "2px",
        fontSize: "10px",
        color: "var(--dih-muted)",
        textAlign: "center",
      },
    }, "dev: ewwhardik • GitHub & Discord"),
  ]);

  const rail = el("div", { className: "dih-rail" }, [
    railHead,
    el("div", { className: "dih-search-box" }, searchInput),
    navContainer,
    railFoot,
  ]);

  // Right Stage
  const stageTitle = el("div", { className: "dih-stage-title" }, "Command Center");
  const stageSub = el("div", { className: "dih-stage-sub" }, "");
  const closeBtn = el("button", { className: "dih-btn", onClick: () => close() }, "ESC / Close");

  const quickDock = el("div", { className: "dih-quick-dock" });
  function rebuildQuickDock() {
    quickDock.innerHTML = "";
    const s = getSettings();
    const items = [
      { label: "Crosshair", active: s.crosshair?.enabled, click: () => updateSetting("crosshair.enabled", !s.crosshair?.enabled) },
      { label: "Telemetry", active: s.hud?.statsEnabled, click: () => updateSetting("hud.statsEnabled", !s.hud?.statsEnabled) },
      { label: "Zero-Blur HUD", active: s.performance?.noBackdropBlurHud !== false, click: () => updateSetting("performance.noBackdropBlurHud", !(s.performance?.noBackdropBlurHud !== false)) },
      { label: "Night Shield", active: s.visuals?.blueLightShield, click: () => updateSetting("visuals.blueLightShield", !s.visuals?.blueLightShield) },
      { label: "Skin Swapper", active: s.skins?.swapperEnabled, click: () => updateSetting("skins.swapperEnabled", !s.skins?.swapperEnabled) },
      { label: "3D Studio", active: false, click: () => api?.openStudio?.("painter") },
    ];
    for (const item of items) {
      quickDock.appendChild(
        el("button", {
          className: `dih-btn${item.active ? " active" : ""}`,
          style: { padding: "4px 9px", fontSize: "10.5px" },
          onClick: item.click,
        }, item.label)
      );
    }
  }

  const stageHeader = el("div", { className: "dih-stage-header" }, [
    el("div", {}, [stageTitle, stageSub]),
    el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" } }, [
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
    el("span", { className: "dih-badge dih-mono" }, `${catalog.FEATURE_REGISTRY?.length || 156} FEATURES • ewwhardik`),
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
      await api?.openStudio?.(actionId.split(":")[1]);
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

  function buildCreditsCard() {
    return el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row" }, [
        el("div", { style: { display: "flex", alignItems: "center", gap: "12px" } }, [
          el("div", { className: "dih-logo-mark" }, [makeBrandSvg(22)]),
          el("div", {}, [
            el("div", { className: "dih-row-title" }, "Dih Client v0.2 — Application Overview & Developer Credits"),
            el("div", { className: "dih-row-desc" },
              `High-FPS (${isNative ? "Native Rust + Win32 + WebView2" : "Electron"}) minimalist Deadshot.io client featuring Max Compute / Low-End profiles, 10–15 MB host RAM budget, network optimizer, unhooked telemetry, 3D skin studio, Corsair/OpenRGB reactive lighting, and ${catalog.FEATURE_REGISTRY?.length || 156} live controls.`
            ),
            el("div", { className: "dih-row-desc dih-mono", style: { marginTop: "4px", color: "var(--dih-accent)" } },
              "Developer: ewwhardik • GitHub: github.com/ewwhardik • Discord: ewwhardik"
            ),
          ]),
        ]),
        el("div", { style: { display: "flex", gap: "6px", flexShrink: "0", flexWrap: "wrap" } }, [
          el("button", {
            className: "dih-btn primary",
            onClick: () => triggerAction("openExternal:https://github.com/ewwhardik"),
          }, "GitHub: ewwhardik"),
          el("button", {
            className: "dih-btn",
            onClick: async () => {
              await navigator.clipboard?.writeText("ewwhardik");
              toast("Copied Discord username: ewwhardik");
            },
          }, "Copy Discord: ewwhardik"),
        ]),
      ]),
    ]);
  }

  // --- Tab Renderers ---
  function renderOverview() {
    const query = searchInput.value.trim().toLowerCase();
    const m = telemetryHud?.getCurrentMetrics?.() || {};
    const primary = staticHw?.displays?.primary;

    stageTitle.textContent = query ? `Feature Search: "${searchInput.value.trim()}"` : "Dih Command Center";
    stageSub.textContent = query
      ? "Direct live controls matching your query"
      : `${catalog.FEATURE_REGISTRY.length} verified client modules • Created by ewwhardik`;

    if (!query) {
      const tiles = el("div", { className: "dih-grid-3" }, [
        el("div", { className: "dih-stat-tile" }, [
          el("div", { className: "dih-tel-k" }, "REAL FPS / MONITOR HZ"),
          el("div", { className: "dih-stat-tile-val dih-mono" }, `${m.fps || "--"} / ${primary?.displayFrequency || 60}Hz`),
        ]),
        el("div", { className: "dih-stat-tile" }, [
          el("div", { className: "dih-tel-k" }, "GPU ADAPTER"),
          el("div", { className: "dih-stat-tile-val", style: { fontSize: "13px" } }, staticHw?.gpu?.primaryName || "Hardware GPU"),
        ]),
        el("div", { className: "dih-stat-tile" }, [
          el("div", { className: "dih-tel-k" }, "PING / MIN–MAX FPS"),
          el("div", { className: "dih-stat-tile-val dih-mono" },
            `${liveSnapshot?.network?.rttMs ? Math.round(liveSnapshot.network.rttMs) + "ms" : "--ms"} • ${m.minFps || "--"}-${m.maxFps || "--"}`
          ),
        ]),
      ]);

      const activeMode = getSettings().performance?.presetMode || "max_compute";
      const quickActions = el("div", { className: "dih-panel" }, [
        el("div", { className: "dih-row" }, [
          el("div", {}, [
            el("div", { className: "dih-row-title" }, "Performance Compute Profiles & Studio"),
            el("div", { className: "dih-row-desc" }, "Defaults to Max Compute (uncapped 2000–3000+ FPS, 12MB host budget). Switch to Low-End anytime."),
          ]),
          el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
            el("button", {
              className: `dih-btn${activeMode === "max_compute" ? " primary" : ""}`,
              onClick: () => triggerAction("applyPerfPreset:max_compute"),
            }, "Max Compute [Default]"),
            el("button", {
              className: `dih-btn${activeMode === "low_end" ? " primary" : ""}`,
              onClick: () => triggerAction("applyPerfPreset:low_end"),
            }, "Low-End Device"),
            el("button", { className: "dih-btn", onClick: () => api?.openStudio?.("painter") }, "3D Skin Studio"),
            el("button", { className: "dih-btn", onClick: () => { close(); leaderboardModal.open(); } }, "Leaderboards"),
          ]),
        ]),
      ]);

      const categories = ["all", ...new Set((catalog.FEATURE_REGISTRY || []).map((f) => f.category))];
      const chipRow = el("div", { className: "dih-chip-row" },
        categories.map((cat) =>
          el("button", {
            className: `dih-chip${activeCategory === cat ? " active" : ""}`,
            onClick: () => {
              activeCategory = cat;
              renderStage();
            },
          }, cat.toUpperCase())
        )
      );

      stageBody.append(
        tiles,
        quickActions,
        buildCreditsCard(),
        el("div", { className: "dih-section-title" }, "ALL FEATURES CATALOG"),
        chipRow
      );
    }

    const filtered = catalog.FEATURE_REGISTRY.filter((f) => {
      if (!query && activeCategory !== "all" && f.category !== activeCategory) return false;
      if (!query) return true;
      return (
        f.title.toLowerCase().includes(query) ||
        f.description.toLowerCase().includes(query) ||
        f.category.toLowerCase().includes(query) ||
        f.id.toLowerCase().includes(query)
      );
    });

    if (!filtered.length) {
      stageBody.appendChild(el("div", { className: "dih-panel" }, "No features matched that search."));
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
        }, "Configure");
      }

      listGrid.appendChild(
        el("div", { className: "dih-panel dih-row" }, [
          el("div", {}, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
              el("span", { className: "dih-row-title" }, feat.title),
              feat.requiresRestart ? el("span", { className: "dih-badge" }, "Restart") : null,
            ]),
            el("div", { className: "dih-row-desc" }, feat.description),
          ]),
          ctrl,
        ])
      );
    }
    stageBody.appendChild(listGrid);
  }

  function renderMetricsAndPerf() {
    stageTitle.textContent = "PC Metrics, Compute Modes, RAM & Network Optimizer";
    stageSub.textContent = "Max Compute [Default] vs Low-End Device • 10–15 MB Native Host RAM Target • QUIC & DoH";

    const s = getSettings();
    const perf = s.performance || {};
    const netCfg = s.network || {};
    const sys = telemetryHud?.getLatestSystem?.() || liveSnapshot || {};
    const activeMode = perf.presetMode || "max_compute";

    const d = staticHw?.displays?.primary;
    const hwCard = el("div", { className: "dih-grid-2" }, [
      el("div", { className: "dih-panel" }, [
        el("div", { className: "dih-tel-k" }, "PROCESSOR & MEMORY"),
        el("div", { className: "dih-row-title", style: { marginTop: "4px" } }, staticHw?.cpu?.model || "CPU"),
        el("div", { className: "dih-row-desc dih-mono" }, `${staticHw?.cpu?.physicalCores || "?"}C / ${staticHw?.cpu?.logicalProcessors || "?"}T • ${staticHw?.memory?.totalGb || "?"} GB RAM`),
      ]),
      el("div", { className: "dih-panel" }, [
        el("div", { className: "dih-tel-k" }, "GPU & DISPLAY REFRESH"),
        el("div", { className: "dih-row-title", style: { marginTop: "4px" } }, `${staticHw?.gpu?.primaryName || "GPU"} (${staticHw?.gpu?.vramGb || "?"} GB)`),
        el("div", { className: "dih-row-desc dih-mono" }, `${d?.width || 1920}x${d?.height || 1080} • Current ${d?.displayFrequency || 60}Hz / Max ${d?.maxRefreshRate || 60}Hz`),
      ]),
    ]);

    const MODE_CARDS = [
      {
        id: "max_compute",
        title: "Max Compute [Default]",
        desc: "Peak compute & lowest frame times: High Priority, EcoQoS OFF, Uncapped FPS, 4GB V8 Heap, 12MB host target.",
      },
      {
        id: "balanced",
        title: "Balanced Esports",
        desc: "Uncapped FPS with hybrid GPU/power tuning, Above Normal CPU priority & 2GB V8 Heap.",
      },
      {
        id: "low_end",
        title: "Low-End Device Mode",
        desc: "For 4–8GB RAM / iGPUs: 60 FPS pace cap, 10MB Host RAM target, WebView2 Low Memory mode, 1GB V8 Heap.",
      },
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
        el("div", { className: "dih-row-title" }, "Native Host RAM Budget (10–15 MB) & Process Actions"),
        el("div", { className: "dih-row-desc dih-mono" }, `Host (Dih.exe): ${hostMbStr} / Target ${perf.hostRamTargetMb ?? 12} MB • WebView2: ${wvMbStr} • Total Tree: ${totMbStr}`),
      ]),
      el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
        el("button", { className: "dih-btn", onClick: () => triggerAction("resetFpsBounds") }, "Reset Min/Max"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("trimMemory") }, "Trim Host RAM Now"),
        el("button", { className: "dih-btn", onClick: () => triggerAction("clearCache") }, "Purge Cache"),
        el("button", { className: "dih-btn primary", onClick: () => triggerAction("relaunchApp") }, "Relaunch & Apply Flags"),
      ]),
    ]);

    const ramControlsGrid = el("div", { className: "dih-grid-2" }, [
      makeSliderCard("Host RAM Target (10–15 MB)", "performance.hostRamTargetMb", 10, 15, 1, " MB"),
      makeToggleCard("Auto Host RAM Guard", "Keeps native Dih.exe inside 10–15 MB without starving WebGL GPU memory", "performance.autoHostRamGuard"),
      makeSelectCard("WebView2 Memory Target Level", "Chromium runtime working-set policy (live)", "performance.webviewMemoryMode", [
        { value: "normal", label: "Normal (Peak FPS & Caching)" },
        { value: "low", label: "Low Memory (Low-End Devices)" },
      ]),
      makeSelectCard("V8 JavaScript Heap Ceiling", "Requires restart to apply browser boot flag", "performance.jsHeapLimitMb", [
        { value: "1024", label: "1024 MB (Low-End / 4GB PC)" },
        { value: "2048", label: "2048 MB (Balanced)" },
        { value: "4096", label: "4096 MB (Max Compute)" },
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
    ]);

    const hudGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Show Real Telemetry HUD", "Real unhooked FPS + system metrics", "hud.statsEnabled"),
      makeSelectCard("Telemetry Layout Mode", "Visual arrangement on screen", "hud.statsLayout", [
        { value: "compact_card", label: "Compact Card" },
        { value: "top_bar", label: "Top Bar" },
        { value: "minimal_pill", label: "Minimal Pill" },
      ]),
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
    ]);

    stageBody.append(
      hwCard,
      el("div", { className: "dih-section-title" }, "COMPUTE & DEVICE PROFILES"),
      modeGrid,
      el("div", { className: "dih-section-title" }, "HOST RAM CUSTOMIZATION (10–15 MB TARGET)"),
      ramLiveBanner,
      ramControlsGrid,
      el("div", { className: "dih-section-title" }, "NETWORK LATENCY & DNS OPTIMIZER"),
      networkHostBar,
      networkGrid,
      el("div", { className: "dih-section-title" }, "NATIVE ENGINE & UNCAPPED FPS FLAGS"),
      perfGrid,
      el("div", { className: "dih-section-title" }, "TELEMETRY HUD WIDGET FIELDS"),
      hudGrid
    );
  }

  function renderSkins() {
    stageTitle.textContent = "In-Client Skin Changer & Asset Swaps";
    stageSub.textContent = "Change weapon textures cleanly on any account, apply wear tiers 0–4, or paint custom .webp skins in 3D Studio";

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
          el("button", { className: "dih-btn", onClick: () => triggerAction("shuffleSkins") }, "Shuffle All"),
          el("button", { className: "dih-btn", onClick: () => triggerAction("resetSkins") }, "Reset"),
          el("button", { className: "dih-btn", onClick: () => api?.openFolders?.() }, "Folder"),
        ]),
      ]),
    ]);

    const syncOpts = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Sync Small HUD Weapon Icons", "Updates *compsmall.webp HUD thumbnails to match weapon skin", "skins.syncSmallIcons"),
      makeToggleCard("Sync Mobile Texture Variants", "Updates *compmobile.webp variants cleanly", "skins.syncMobileVariants"),
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
          el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
            cfg.mode === "custom" ? [customSel] : [officialSel, wearSel]
          ),
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
      el("div", { className: "dih-section-title" }, "CUSTOM STUDIO VAULT (1-CLICK EQUIP)"),
      vaultBlock,
      el("div", { className: "dih-section-title" }, "WEAPON LOADOUT SKIN CHANGER"),
      weaponsGrid,
      el("div", { className: "dih-section-title" }, "ENVIRONMENT, SCOPE & BRANDING SWAPS"),
      extraGrid
    );
  }

  function renderCorsair() {
    stageTitle.textContent = "Corsair Lights, OpenRGB SDK & Reactive RGB";
    stageSub.textContent = "Real Corsair HID (VID 0x1B1C) / OpenRGB SDK (6742) integration + Virtual K70 Visualizer";

    const st = corsairStatusCache || {};
    const hwSummary = st.frame?.statusBanner || "Checking hardware...";
    const statusCard = el("div", { className: "dih-panel" }, [
      el("div", { className: "dih-row" }, [
        el("div", {}, [
          el("div", { className: "dih-row-title" }, `Status: ${hwSummary}`),
          el("div", { className: "dih-row-desc dih-mono" },
            `iCUE: ${st.hardware?.icueRunning ? "Running" : "Not detected"} • USB HID (1B1C): ${st.hardware?.usbCorsairDevices?.length || 0} • OpenRGB: ${st.openRgb?.connected ? "Connected" : "Idle"}`
          ),
        ]),
        el("div", { style: { display: "flex", gap: "8px" } }, [
          el("button", { className: "dih-btn", onClick: () => triggerAction("rescanCorsair") }, "Rescan USB"),
          el("button", { className: "dih-btn primary", onClick: () => api?.openStudio?.("corsair") }, "Open Virtual K70 Lab"),
        ]),
      ]),
    ]);

    const openRgbConnect = el("div", { className: "dih-panel dih-row" }, [
      el("div", {}, [
        el("div", { className: "dih-row-title" }, "Connect OpenRGB SDK Bridge"),
        el("div", { className: "dih-row-desc" }, "Start OpenRGB's SDK Server (Settings -> SDK Server) to sync Corsair K70/Vengeance/fans hardware directly."),
      ]),
      el("button", {
        className: "dih-btn",
        onClick: async () => {
          const s = getSettings().corsair || {};
          corsairStatusCache = await api?.connectOpenRgb?.(s.openRgbHost, s.openRgbPort);
          toast(corsairStatusCache?.openRgb?.connected ? "OpenRGB SDK connected" : (corsairStatusCache?.openRgb?.lastError || "OpenRGB not listening"));
          renderStage();
        },
      }, "Connect 127.0.0.1:6742"),
    ]);

    const grid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("Master Corsair RGB Engine", "Enable hardware & virtual reactive lighting", "corsair.enabled"),
      makeSelectCard("Lighting Effect Mode", "Dynamic reactive & telemetry effects", "corsair.mode", [
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
      makeToggleCard("Auto-Connect OpenRGB on Boot", "Automatically link port 6742 when available", "corsair.autoConnectOpenRgb"),
      makeToggleCard("WebHID Corsair Access", "Permits USB HID VID_1B1C pairing", "corsair.webHidEnabled"),
      makeToggleCard("Highlight WASD Cluster", "Keep movement cluster distinct in slate/platinum", "corsair.highlightWasd"),
      makeToggleCard("Muzzle Flash & Reload Pulses", "Flash white on shot & sweep amber on R reload", "corsair.flashOnShoot"),
      makeToggleCard("ADS Focus Dimming", "Lowers outer chassis glare on Right-Click ADS", "corsair.dimOnAds"),
      makeToggleCard("Sync Primary RGB with Dih Theme", "Matches keyboard lighting to Obsidian/Titanium accent", "corsair.syncWithTheme"),
      makeSliderCard("Master LED Brightness", "corsair.brightness", 5, 100, 5, "%"),
      makeSliderCard("Effect Animation Speed", "corsair.speed", 0.2, 3, 0.1, "x"),
      makeColorCard("Primary Zone Color", "corsair.primaryColor"),
      makeColorCard("Secondary Ambient Color", "corsair.secondaryColor"),
      makeColorCard("Fire Muzzle Flash Color", "corsair.fireFlashColor"),
      makeColorCard("ADS Focus Accent Color", "corsair.adsColor"),
    ]);

    stageBody.append(statusCard, openRgbConnect, grid);
  }

  function renderCrosshairAndHud() {
    stageTitle.textContent = "Custom Crosshair Studio & HUD Widgets";
    stageSub.textContent = "GPU-transformed SVG reticle with stadia ticks + KPM, Warmup Countdown & Reaction widgets";

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
      makeToggleCard("Per-Slot (1/2/3) Reticle Auto-Swap", "Changes reticle style per weapon slot", "crosshair.perWeaponProfiles"),
    ]);

    const customInput = el("input", {
      className: "dih-input",
      placeholder: "Paste <svg>...</svg> or https://... URL for 'Custom' geometry",
      value: s.crosshair?.customSvgOrUrl || "",
    });
    customInput.addEventListener("change", () => updateSetting("crosshair.customSvgOrUrl", customInput.value));

    const widgetsGrid = el("div", { className: "dih-grid-2" }, [
      makeToggleCard("All HUD Overlays Master (F9)", "Panic hide/restore all HUD cards cleanly", "hud.enabled"),
      makeToggleCard("Keystrokes + CPS Overlay", "WASD + Space + Shift + LMB/RMB CPS monitor", "hud.keysOverlayEnabled"),
      makeToggleCard("Session K / D / A Tracker", "Track kills ([ / ]) & ratio live", "hud.kdTrackerEnabled"),
      makeToggleCard("Kills-Per-Minute & Streak", "Displays real KPM rate & current streak inside K/D widget", "hud.sessionKpmEnabled"),
      makeToggleCard("Match Stopwatch (B)", "Centisecond speedrun / round timer", "hud.stopwatchEnabled"),
      makeToggleCard("Warmup Goal Countdown Timer", "Practice countdown widget with alarm chime", "hud.warmupTimerEnabled"),
      makeSliderCard("Warmup Goal Duration", "hud.warmupDurationSec", 60, 1800, 60, "s"),
      makeToggleCard("Millisecond Reaction Trainer", "Interactive reflex tester inside HUD", "hud.reactionWidgetEnabled"),
      makeToggleCard("Top-Right Watermark", "Minimalist monochrome client tag", "hud.watermarkEnabled"),
      makeToggleCard("Companion GIF / Image Badge", "Draggable animated badge overlay", "hud.companionGifEnabled"),
      makeToggleCard("Streamer Username Privacy Blur", "Blurs lobby username against stream snipers", "hud.streamerPrivacyBlur"),
    ]);

    const gifInput = el("input", {
      className: "dih-input",
      placeholder: "Companion GIF/PNG URL or data:image/... URL",
      value: s.hud?.companionGifPath || "",
    });
    gifInput.addEventListener("change", () => updateSetting("hud.companionGifPath", gifInput.value));

    stageBody.append(
      topGrid,
      shareRow,
      customInput,
      xhairGrid,
      el("div", { className: "dih-section-title" }, "EXTRA HUD WIDGETS"),
      widgetsGrid,
      gifInput
    );
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
      makeToggleCard("Tactical Click / Kill Chime", "Clean WebAudio feedback when logging kills", "audio.playClientKillTone"),
      makeToggleCard("Shot Synthesis Micro-Tick", "Subtle audio transient on trigger pull", "audio.playClientHeadshotTone"),
      makeSliderCard("Client Feedback Volume", "audio.clientFeedbackVolume", 0, 1, 0.05, ""),
      makeToggleCard("Always On Top", "Pins Dih above all desktop windows", "window.alwaysOnTop"),
      makeToggleCard("Borderless Fullscreen (F11)", "Enables immersive fullscreen on launch", "window.autoFullscreen"),
      makeToggleCard("Borderless Maximized Window", "Maximizes cleanly to monitor work area without window frame", "window.borderlessMaximized"),
      makeSliderCard("Window Master Opacity", "window.opacity", 0.35, 1, 0.05, ""),
      makeToggleCard("Discord Rich Presence", "Shows active Dih session in Discord", "window.discordRpcEnabled"),
      makeToggleCard("Discord Privacy Mode", "Hides weapon & skin details from Discord status", "window.discordPrivacyMode"),
      makeToggleCard("User-Agent Stealth", "Strips wrapper signatures (restart required)", "window.userAgentStealth"),
    ]);

    stageBody.append(
      aimCard,
      syncPanel,
      keybindCard,
      el("div", { className: "dih-section-title" }, "CANVAS COLOR GRADING & OPTICS"),
      visGrid,
      el("div", { className: "dih-section-title" }, "AUDIO, WINDOW & PRIVACY"),
      winAudioGrid
    );
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
    ]);

    // Interactive Hotkey Rebinding (aligned 1:1 with DEFAULT_SETTINGS.hotkeys & Win32/DOM listeners)
    const HOTKEY_DEFS = [
      { key: "toggleGui", label: "Toggle Command Center", def: "RightShift" },
      { key: "hideAllHud", label: "Toggle All HUD Overlays", def: "F9" },
      { key: "openStudio", label: "Open 3D Skin Studio", def: "F7" },
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
