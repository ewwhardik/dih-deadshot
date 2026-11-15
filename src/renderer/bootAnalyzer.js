/**
 * Animated Boot Loading & PC Hardware Power Analyzer Overlay.
 * Probes authentic CPU, DXGI/Metal GPU, RAM, and Display Refresh Rate,
 * computes a 0-100 Power Score, and auto-configures the optimal Dih profile.
 */

DIH_NS.createBootAnalyzer = function createBootAnalyzer({
  shadowRoot,
  getSettings,
  setSettingsLocal,
  onRefreshAll,
  toast,
}) {
  const { getHostApi, el, makeBrandSvg, syncEarlyPerfStorage } = DIH_NS.utils;
  const api = getHostApi();

  let activeRoot = null;
  let closeTimer = null;
  let rafId = 0;

  const TIER_DESCS = {
    extreme_workstation: "Uncapped 2000-3000+ FPS Max Compute, High Win32 priority, P-core affinity ready, 4GB heap & native 1.0x render scale.",
    esports_desktop: "Max Compute uncapped engine, EcoQoS off, High priority, WebGL low-latency desync & 12MB host shell guard.",
    balanced_laptop: "Balanced competitive scheduling, 2GB V8 heap, 0.95x sharp render scale & thermally smart frame pacing.",
    low_end_pc: "Low-End boost mode: WebView2 low-memory target, 10MB host cap, 0.80x WebGL DPR scaling & zero-motion UI.",
  };

  function cleanup() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (activeRoot) {
      activeRoot.classList.add("closing");
      const node = activeRoot;
      activeRoot = null;
      setTimeout(() => {
        if (node.parentNode) node.remove();
      }, 240);
    }
  }

  async function run({ forceShow = false, applyRecommended = false } = {}) {
    const s = getSettings();
    const isAutoTest =
      Boolean(window.navigator?.webdriver) ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost";

    if (!forceShow && (isAutoTest || s.autoTune?.bootSplashEnabled === false)) {
      return null;
    }

    cleanup();

    const needsFirstAutoTune =
      !s.autoTune?.completed && s.autoTune?.autoAnalyzeOnFirstRun !== false;
    const shouldApply = applyRecommended || needsFirstAutoTune;

    const phaseLabel = el("div", { className: "dih-boot-phase dih-mono" }, "[PHASE 1/3] INITIALIZING DIH ENGINE");
    const progressFill = el("div", { className: "dih-boot-bar-fill" });
    const scoreEl = el("div", { className: "dih-boot-score dih-mono" }, "--");
    const tierBadge = el("div", { className: "dih-badge dih-mono" }, "PROBING HARDWARE...");

    const cpuVal = el("div", { className: "dih-mono dih-boot-hwv" }, "Scanning CPU...");
    const gpuVal = el("div", { className: "dih-mono dih-boot-hwv" }, "Enumerating GPU...");
    const ramVal = el("div", { className: "dih-mono dih-boot-hwv" }, "Reading Memory...");
    const hzVal = el("div", { className: "dih-mono dih-boot-hwv" }, "Checking Display Hz...");

    const cpuBar = el("div", { className: "dih-boot-mini-fill" });
    const gpuBar = el("div", { className: "dih-boot-mini-fill" });
    const ramBar = el("div", { className: "dih-boot-mini-fill" });
    const hzBar = el("div", { className: "dih-boot-mini-fill" });

    const recSummary = el(
      "div",
      { className: "dih-boot-summary" },
      shouldApply
        ? "Detecting processor, GPU VRAM, system memory & refresh rate to auto-configure optimal Dih Client settings..."
        : "Re-verifying hardware telemetry & engine flags..."
    );

    const skipBtn = el(
      "button",
      {
        className: "dih-btn primary",
        onClick: (e) => {
          e.stopPropagation();
          cleanup();
        },
      },
      "Enter Game"
    );

    const card = el(
      "div",
      { className: "dih-card dih-boot-card", onClick: (e) => e.stopPropagation() },
      [
        el("div", { className: "dih-boot-top" }, [
          el("div", { className: "dih-boot-brand" }, [
            el("div", { className: "dih-boot-spinner" }, [makeBrandSvg(26)]),
            el("div", {}, [
              el("div", { className: "dih-boot-title" }, "DIH CLIENT"),
              phaseLabel,
            ]),
          ]),
          el("div", { style: { textAlign: "right" } }, [
            el("div", { className: "dih-mono", style: { fontSize: "9.5px", color: "var(--dih-muted)" } }, "PC POWER INDEX"),
            el("div", { style: { display: "flex", alignItems: "baseline", gap: "4px", justifyContent: "flex-end" } }, [
              scoreEl,
              el("span", { className: "dih-mono", style: { fontSize: "11px", color: "var(--dih-muted)" } }, "/100"),
            ]),
          ]),
        ]),

        el("div", { className: "dih-boot-bar-track" }, [progressFill]),

        el("div", { className: "dih-grid-2", style: { marginTop: "6px" } }, [
          el("div", { className: "dih-boot-tile" }, [
            el("div", { className: "dih-tel-k" }, "PROCESSOR (CPU)"),
            cpuVal,
            el("div", { className: "dih-boot-mini-track" }, [cpuBar]),
          ]),
          el("div", { className: "dih-boot-tile" }, [
            el("div", { className: "dih-tel-k" }, "GRAPHICS ADAPTER"),
            gpuVal,
            el("div", { className: "dih-boot-mini-track" }, [gpuBar]),
          ]),
          el("div", { className: "dih-boot-tile" }, [
            el("div", { className: "dih-tel-k" }, "SYSTEM MEMORY"),
            ramVal,
            el("div", { className: "dih-boot-mini-track" }, [ramBar]),
          ]),
          el("div", { className: "dih-boot-tile" }, [
            el("div", { className: "dih-tel-k" }, "DISPLAY & ENGINE"),
            hzVal,
            el("div", { className: "dih-boot-mini-track" }, [hzBar]),
          ]),
        ]),

        el("div", { className: "dih-boot-foot" }, [
          el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", flex: 1 } }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, [
              tierBadge,
            ]),
            recSummary,
          ]),
          skipBtn,
        ]),
      ]
    );

    const overlay = el(
      "div",
      {
        className: "dih-boot-overlay",
        onClick: () => cleanup(),
      },
      [card]
    );

    activeRoot = overlay;
    shadowRoot.appendChild(overlay);
    progressFill.style.width = "28%";

    const onEsc = (e) => {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", onEsc);
        cleanup();
      }
    };
    window.addEventListener("keydown", onEsc, { passive: true });

    let result = null;
    try {
      await new Promise((r) => setTimeout(r, 240));
      phaseLabel.textContent = "[PHASE 2/3] ANALYZING HARDWARE POWER";
      progressFill.style.width = "64%";

      result = await api?.runHardwareAnalysis?.(shouldApply);
      if (result?.settings) {
        setSettingsLocal(result.settings);
        syncEarlyPerfStorage?.(result.settings);
        onRefreshAll?.();
      }

      const an = result?.analysis;
      if (an) {
        const hw = an.hardware || {};
        const bd = an.breakdown || {};
        const disp = hw.displays?.primary || {};
        cpuVal.textContent = `${hw.cpu?.model || "CPU"} (${hw.cpu?.physicalCores || "?"}C/${hw.cpu?.logicalProcessors || "?"}T)`;
        gpuVal.textContent = `${hw.gpu?.primaryName || "GPU"}${hw.gpu?.vramGb ? ` (${hw.gpu.vramGb} GB)` : ""}`;
        ramVal.textContent = `${hw.memory?.totalGb || "?"} GB Physical RAM`;
        hzVal.textContent = `${disp.displayFrequency || 60} Hz${disp.maxRefreshRate ? ` / Max ${disp.maxRefreshRate} Hz` : ""} • ${an.recommendedPreset.toUpperCase()}`;

        cpuBar.style.width = `${Math.round(((bd.cpuScore || 20) / 35) * 100)}%`;
        gpuBar.style.width = `${Math.round(((bd.gpuScore || 20) / 35) * 100)}%`;
        ramBar.style.width = `${Math.round(((bd.ramScore || 8) / 15) * 100)}%`;
        hzBar.style.width = `${Math.round(((bd.hzScore || 6) / 15) * 100)}%`;

        phaseLabel.textContent = shouldApply
          ? "[PHASE 3/3] OPTIMAL SETTINGS APPLIED"
          : "[PHASE 3/3] HARDWARE BENCHMARK READY";
        progressFill.style.width = "100%";

        tierBadge.textContent = `${an.tierLabel} • ${an.recommendedPreset.toUpperCase()}`;
        recSummary.textContent = TIER_DESCS[an.tier] || an.detectedSummary;

        const targetScore = Number(an.powerScore) || 70;
        const startT = performance.now();
        const animDur = 450;
        const stepScore = (now) => {
          const p = Math.min(1, (now - startT) / animDur);
          scoreEl.textContent = String(Math.round(targetScore * p));
          if (p < 1 && activeRoot) {
            rafId = requestAnimationFrame(stepScore);
          } else {
            scoreEl.textContent = String(targetScore);
          }
        };
        rafId = requestAnimationFrame(stepScore);

        if (shouldApply && toast) {
          toast(`PC Auto-Tuned: ${an.tierLabel} (${targetScore}/100) -> ${an.recommendedPreset.toUpperCase()}`);
        }
      }
    } catch {
      phaseLabel.textContent = "[READY] ENGINE INITIALIZED";
      progressFill.style.width = "100%";
      tierBadge.textContent = "STANDARD PROFILE";
    }

    const holdMs = forceShow ? 3400 : shouldApply ? 2100 : 1200;
    closeTimer = setTimeout(() => cleanup(), holdMs);
    return result;
  }

  return {
    run,
    dismiss: cleanup,
  };
};
