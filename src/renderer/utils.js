/**
 * Shared Shadow DOM utilities, Dual-Host Native WebView2 + Electron Bridge,
 * Draggable Snap Engine, WebAudio Feedback & Deadshot localStorage bridge.
 */

DIH_NS.utils = (function () {
  function createNativeWebView2Bridge() {
    let seq = 1;
    const pending = new Map();
    const settingsListeners = new Set();
    const actionListeners = new Set();

    window.chrome.webview.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "rpcResponse" && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      } else if (msg.type === "settingsUpdated") {
        settingsListeners.forEach((cb) => cb(msg.payload));
      } else if (msg.type === "action") {
        actionListeners.forEach((cb) => cb(msg.payload));
      }
    });

    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = seq++;
        pending.set(id, { resolve, reject });
        window.chrome.webview.postMessage({ type: "rpc", id, method, params });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`RPC timeout: ${method}`));
          }
        }, 8000);
      });

    const fire = (method, params = {}) => {
      window.chrome.webview.postMessage({ type: "notify", method, params });
    };

    return {
      isNativeHost: true,
      getSettings: () => rpc("getSettings"),
      setSetting: (dotPath, value) => rpc("setSetting", { dotPath, value }),
      updateSettings: (patch) => rpc("updateSettings", { patch }),
      applyThemePreset: (presetKey) => rpc("applyThemePreset", { presetKey }),
      applyPerfPreset: (mode) => rpc("applyPerfPreset", { mode }),
      resetAllSettings: () => rpc("resetAllSettings"),
      exportProfile: () => rpc("exportProfile"),
      importProfile: () => rpc("importProfile"),
      getHudPositions: () => rpc("getHudPositions"),
      setHudPosition: (widgetId, pos) => rpc("setHudPosition", { widgetId, pos }),
      resetHudPositions: () => rpc("resetHudPositions"),
      getCatalog: () => rpc("getCatalog"),
      getStaticHardware: () => rpc("getStaticHardware"),
      getLiveMetrics: () => rpc("getLiveMetrics"),
      probePing: () => rpc("probePing"),
      setMasterMute: (muted) => rpc("setMasterMute", { muted }),
      setAlwaysOnTop: (flag) => rpc("setAlwaysOnTop", { flag }),
      setWindowOpacity: (opacity) => rpc("setWindowOpacity", { opacity }),
      toggleFullscreen: () => rpc("toggleFullscreen"),
      clearCache: () => rpc("clearCache"),
      trimMemory: () => rpc("trimMemory"),
      relaunchApp: () => rpc("relaunchApp"),
      reloadGame: () => rpc("reloadGame"),
      captureScreenshot: () => rpc("captureScreenshot"),
      openFolders: () => rpc("openFolders"),
      openExternal: (url) => rpc("openExternal", { url }),
      exportDiagnostics: (clientSnapshot) => rpc("exportDiagnostics", { clientSnapshot }),
      listCustomSkins: () => rpc("listCustomSkins"),
      saveCustomSkin: (payload) => rpc("saveCustomSkin", payload),
      listSwapFiles: () => rpc("listSwapFiles"),
      rescanSwapFiles: () => rpc("rescanSwapFiles"),
      saveSkinPreset: (name) => rpc("saveSkinPreset", { name }),
      applySkinPreset: (name) => rpc("applySkinPreset", { name }),
      deleteSkinPreset: (name) => rpc("deleteSkinPreset", { name }),
      openStudio: (tab = "corsair", weapon = "") => rpc("openStudio", { tab, weapon }),
      getCorsairStatus: () => rpc("getCorsairStatus"),
      rescanCorsair: () => rpc("rescanCorsair"),
      connectOpenRgb: (host, port) => rpc("connectOpenRgb", { host, port }),
      corsairUpdateTelemetry: (patch) => fire("corsairUpdateTelemetry", patch),
      updateDiscordState: (state) => fire("updateDiscordState", state),
      getDiscordStatus: () => rpc("getDiscordStatus"),
      reconnectDiscordRpc: () => rpc("reconnectDiscordRpc"),
      onSettingsChanged: (cb) => {
        settingsListeners.add(cb);
        return () => settingsListeners.delete(cb);
      },
      onAction: (cb) => {
        actionListeners.add(cb);
        return () => actionListeners.delete(cb);
      },
    };
  }

  function getHostApi() {
    if (window.dih) return window.dih;
    if (window.chrome?.webview) {
      if (!DIH_NS._nativeBridge) DIH_NS._nativeBridge = createNativeWebView2Bridge();
      return DIH_NS._nativeBridge;
    }
    return null;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null) continue;
      if (k === "className") node.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        node.setAttribute(k, String(v));
      }
    }
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === null || child === undefined) continue;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function makeBrandSvg(size = 18) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.innerHTML =
      '<circle cx="12" cy="12" r="8" stroke="var(--dih-accent, #d4d8df)" stroke-width="1.8"/>' +
      '<line x1="2" y1="12" x2="7.5" y2="12" stroke="var(--dih-text, #f2f4f7)" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="16.5" y1="12" x2="22" y2="12" stroke="var(--dih-text, #f2f4f7)" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="12" y1="2" x2="12" y2="7.5" stroke="var(--dih-text, #f2f4f7)" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="12" y1="16.5" x2="12" y2="22" stroke="var(--dih-text, #f2f4f7)" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="12" cy="12" r="2" fill="#ffffff"/>';
    return svg;
  }

  // Custom properties on the shadow host cascade into every node, so only write the ones
  // that actually changed — otherwise each settings toggle restyles the whole overlay + menu.
  function applyThemeVars(hostEl, settings) {
    if (!hostEl || !settings?.theme) return;
    const t = settings.theme;
    const s = hostEl.style;
    const vars = {
      "--dih-accent": t.accent || "#d4d8df",
      "--dih-surface": t.surface || "#121317",
      "--dih-elevated": t.elevated || "#1a1c22",
      "--dih-text": t.textPrimary || "#f2f4f7",
      "--dih-muted": t.textSecondary || "#9097a3",
      "--dih-border": t.border || "rgba(255,255,255,0.085)",
      "--dih-opacity": String(t.bgOpacity ?? 0.88),
      "--dih-blur": `${Number(t.blurPx ?? 14)}px`,
      "--dih-radius": `${Number(t.compactCornerRadius ?? 10)}px`,
      "--dih-key-move": t.keyMove || "#d4d8df",
      "--dih-key-action": t.keyAction || "#9ba3b0",
    };
    for (const k in vars) {
      if (s.getPropertyValue(k) !== vars[k]) s.setProperty(k, vars[k]);
    }
    hostEl.classList.toggle("dih-hud-blur", settings.performance?.noBackdropBlurHud === false);
    hostEl.classList.toggle("dih-reduce-motion", Boolean(settings.performance?.reduceMotionUi));
    hostEl.classList.toggle("dih-hud-locked", Boolean(settings.esportsHud?.lockHudDrag));
  }

  let lastEarlyPerf = "";
  function syncEarlyPerfStorage(settings) {
    try {
      const p = settings?.performance || {};
      const next = JSON.stringify({
        webglLowLatency: p.webglLowLatency !== false,
        canvasDprScale: Number(p.canvasDprScale ?? 1.0) || 1.0,
      });
      // localStorage writes are synchronous; skip the no-op ones on every settings refresh.
      if (next !== lastEarlyPerf) {
        lastEarlyPerf = next;
        window.localStorage.setItem("__dih_early_perf", next);
      }
    } catch {}
  }

  function makeDraggable(element, widgetId, getSettings, savedPositions = {}) {
    if (!element) return;
    element.classList.add("dih-draggable");
    const api = getHostApi();

    const applySaved = (pos) => {
      if (!pos) return;
      element.style.left = `${Math.max(4, Math.min(window.innerWidth - 60, pos.x))}px`;
      element.style.top = `${Math.max(4, Math.min(window.innerHeight - 40, pos.y))}px`;
      element.style.right = "auto";
      element.style.bottom = "auto";
    };

    if (savedPositions && savedPositions[widgetId]) applySaved(savedPositions[widgetId]);

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    element.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (typeof getSettings === "function" && getSettings()?.esportsHud?.lockHudDrag) return;
      if (e.target && e.target.closest("button, input, select")) return;
      dragging = true;
      const rect = element.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      let nextX = origLeft + (e.clientX - startX);
      let nextY = origTop + (e.clientY - startY);
      const s = typeof getSettings === "function" ? getSettings() : null;
      if (s?.hud?.snapToGrid !== false) {
        nextX = Math.round(nextX / 8) * 8;
        nextY = Math.round(nextY / 8) * 8;
      }
      nextX = Math.max(4, Math.min(window.innerWidth - element.offsetWidth - 4, nextX));
      nextY = Math.max(4, Math.min(window.innerHeight - element.offsetHeight - 4, nextY));
      element.style.left = `${nextX}px`;
      element.style.top = `${nextY}px`;
      element.style.right = "auto";
      element.style.bottom = "auto";
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      const rect = element.getBoundingClientRect();
      api?.setHudPosition?.(widgetId, { x: Math.round(rect.left), y: Math.round(rect.top) });
    });
  }

  let audioCtx = null;
  let limiterNode = null;
  let audioLimiterEnabled = true;

  function setAudioOptions(opts = {}) {
    if (typeof opts.limiterEnabled === "boolean") {
      audioLimiterEnabled = opts.limiterEnabled;
    }
  }

  function ensureLimiter(ctx) {
    if (!limiterNode) {
      limiterNode = ctx.createDynamicsCompressor();
      limiterNode.threshold.setValueAtTime(-12, ctx.currentTime);
      limiterNode.knee.setValueAtTime(6, ctx.currentTime);
      limiterNode.ratio.setValueAtTime(12, ctx.currentTime);
      limiterNode.attack.setValueAtTime(0.002, ctx.currentTime);
      limiterNode.release.setValueAtTime(0.08, ctx.currentTime);
      limiterNode.connect(ctx.destination);
    }
    return limiterNode;
  }

  function playTone(type = "click", volume = 0.35) {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      if (audioLimiterEnabled) {
        gain.connect(ensureLimiter(audioCtx));
      } else {
        gain.connect(audioCtx.destination);
      }

      const vol = Math.max(0.01, Math.min(0.6, Number(volume) * 0.25));
      if (type === "kill") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(740, now);
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.08);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === "alarm") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1174, now + 0.12);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.start(now);
        osc.stop(now + 0.34);
      } else if (type === "shot") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(190, now + 0.045);
        gain.gain.setValueAtTime(vol * 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
      } else if (type === "hitmarker") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(1920, now);
        osc.frequency.exponentialRampToValueAtTime(2480, now + 0.025);
        gain.gain.setValueAtTime(vol * 0.72, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.start(now);
        osc.stop(now + 0.05);
      } else {
        osc.type = "sine";
        osc.frequency.setValueAtTime(620, now);
        gain.gain.setValueAtTime(vol * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        osc.start(now);
        osc.stop(now + 0.04);
      }
    } catch {}
  }

  function readDeadshotSettings() {
    try {
      const raw = window.localStorage.getItem("dsio:settings:2");
      if (!raw) return null;
      const data = JSON.parse(raw);
      const slot = (idx) => data?.[1]?.[idx]?.[1]?.[1];
      return {
        raw: data,
        rawMouse: slot(5) ?? null,
        sensitivity: slot(7) ?? null,
        zoomSensitivity: slot(8) ?? null,
        antialias: slot(9) ?? null,
        showStats: slot(11) ?? null,
        renderScale: slot(12) ?? null,
        crosshairHide: slot(14) ?? null,
        snowfall: slot(34) ?? null,
        fov: slot(35) ?? null,
      };
    } catch {
      return null;
    }
  }

  function readDeadshotKeybinds() {
    try {
      const raw = window.localStorage.getItem("dsio:keybinds:2");
      if (!raw) return null;
      const data = JSON.parse(raw);
      const list = data?.[1];
      if (!Array.isArray(list)) return null;
      return list.map((entry, idx) => ({
        index: idx,
        value: entry?.[1]?.[1] ?? entry?.[1] ?? entry,
      }));
    } catch {
      return null;
    }
  }

  function writeDeadshotSetting(index, value) {
    try {
      const raw = window.localStorage.getItem("dsio:settings:2");
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data?.[1]?.[index]?.[1]) {
        data[1][index][1][1] = value;
        window.localStorage.setItem("dsio:settings:2", JSON.stringify(data));
        return true;
      }
    } catch {}
    return false;
  }

  function encodeCrosshairCode(cfg) {
    const compact = {
      t: cfg.type,
      c: cfg.color,
      o: cfg.outlineEnabled ? 1 : 0,
      oc: cfg.outlineColor,
      ow: cfg.outlineWidth,
      s: cfg.size,
      th: cfg.thickness,
      g: cfg.gap,
      d: cfg.dotSize,
      a: cfg.opacity,
      r: cfg.rotation,
      tk: cfg.tacticalTicks ? 1 : 0,
    };
    return "DIH-XHAIR:" + btoa(JSON.stringify(compact));
  }

  function decodeCrosshairCode(codeStr) {
    const clean = String(codeStr || "").trim();
    if (!clean.startsWith("DIH-XHAIR:")) throw new Error("Code must start with DIH-XHAIR:");
    const json = JSON.parse(atob(clean.slice(10)));
    return {
      enabled: true,
      type: json.t || "CrossDot",
      color: json.c || "#f2f4f7",
      outlineEnabled: Boolean(json.o ?? 1),
      outlineColor: json.oc || "#0a0b0d",
      outlineWidth: Number(json.ow ?? 1.5),
      size: Number(json.s ?? 14),
      thickness: Number(json.th ?? 2),
      gap: Number(json.g ?? 4),
      dotSize: Number(json.d ?? 2.5),
      opacity: Number(json.a ?? 0.95),
      rotation: Number(json.r ?? 0),
      tacticalTicks: Boolean(json.tk),
    };
  }

  let activeDarkMenuCleanup = null;

  function closeDarkSelects() {
    if (typeof activeDarkMenuCleanup === "function") {
      const fn = activeDarkMenuCleanup;
      activeDarkMenuCleanup = null;
      fn();
    }
  }

  /**
   * Custom Obsidian-dark dropdown menu that replaces OS native <select> popups
   * (fixing Windows WebView2 white-on-white <option> contrast and clipped borders).
   */
  function createDarkSelect(shadowRoot, options = [], opts = {}) {
    const {
      value = "",
      className = "dih-select",
      style = null,
      asNumber = false,
      onChange = null,
    } = opts || {};

    let items = (options || []).map((o) => ({
      value: String(o?.value ?? ""),
      label: String(o?.label ?? o?.value ?? ""),
    }));

    const labelEl = el("span", { className: "dih-csel-label" }, "");
    const chev = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chev.setAttribute("width", "12");
    chev.setAttribute("height", "12");
    chev.setAttribute("viewBox", "0 0 24 24");
    chev.setAttribute("fill", "none");
    chev.setAttribute("stroke", "currentColor");
    chev.setAttribute("stroke-width", "2.2");
    chev.setAttribute("stroke-linecap", "round");
    chev.setAttribute("stroke-linejoin", "round");
    chev.setAttribute("class", "dih-csel-chev");
    chev.innerHTML = '<polyline points="6 9 12 15 18 9"/>';

    const btn = el("button", {
      type: "button",
      className: `${className} dih-csel-btn`,
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
    }, [labelEl, chev]);

    if (style && typeof style === "object") Object.assign(btn.style, style);

    let currentValue = "";
    const resolveMatch = (raw) => {
      const s = String(raw ?? "");
      let found = items.find((o) => o.value === s);
      if (!found && asNumber && s !== "" && !Number.isNaN(Number(s))) {
        const n = Number(s);
        found = items.find((o) => o.value !== "" && !Number.isNaN(Number(o.value)) && Number(o.value) === n);
      }
      if (!found && s === "") {
        found = items.find((o) => o.value === "") || items[0] || null;
      }
      return found;
    };

    const syncLabel = (raw) => {
      const matched = resolveMatch(raw);
      currentValue = matched ? matched.value : String(raw ?? "");
      labelEl.textContent = matched
        ? matched.label
        : currentValue !== ""
          ? (asNumber ? `${currentValue}x` : currentValue)
          : items[0]?.label || "Select...";
    };

    Object.defineProperty(btn, "value", {
      configurable: true,
      get() {
        return currentValue;
      },
      set(v) {
        syncLabel(v);
      },
    });

    btn.setOptions = (nextOpts, nextVal) => {
      items = (nextOpts || []).map((o) => ({
        value: String(o?.value ?? ""),
        label: String(o?.label ?? o?.value ?? ""),
      }));
      syncLabel(nextVal !== undefined ? nextVal : currentValue);
    };

    syncLabel(value);

    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const wasOpen = btn.classList.contains("open");
      closeDarkSelects();
      if (wasOpen) return;

      const hostTarget = shadowRoot || btn.getRootNode() || document.body;
      const menu = el("div", { className: "dih-csel-menu", role: "listbox" });
      for (const opt of items) {
        const isSel = opt.value === currentValue;
        const optBtn = el("button", {
          type: "button",
          role: "option",
          "aria-selected": String(isSel),
          className: `dih-csel-opt${isSel ? " active" : ""}`,
          onClick: (e) => {
            e.stopPropagation();
            const changed = currentValue !== opt.value;
            syncLabel(opt.value);
            closeDarkSelects();
            if (changed) {
              btn.dispatchEvent(new Event("change", { bubbles: true }));
              if (typeof onChange === "function") onChange(opt.value);
            }
          },
        }, [
          el("span", { className: "dih-csel-opt-txt" }, opt.label),
          isSel ? el("span", { className: "dih-csel-check" }, "✓") : null,
        ]);
        menu.appendChild(optBtn);
      }

      const rect = btn.getBoundingClientRect();
      const estH = Math.min(248, items.length * 32 + 10);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const openUp = spaceBelow < estH && rect.top > estH;
      const topPx = openUp
        ? Math.max(8, rect.top - estH - 4)
        : Math.min(window.innerHeight - estH - 8, rect.bottom + 4);
      const widthPx = Math.max(rect.width, 165);
      const leftPx = Math.max(8, Math.min(rect.left, window.innerWidth - widthPx - 8));

      menu.style.left = `${Math.round(leftPx)}px`;
      menu.style.top = `${Math.round(topPx)}px`;
      menu.style.minWidth = `${Math.round(rect.width)}px`;
      menu.style.maxWidth = `${Math.min(340, window.innerWidth - 16)}px`;

      btn.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      hostTarget.appendChild(menu);

      const onOutside = (e) => {
        const path = typeof e.composedPath === "function" ? e.composedPath() : [];
        if (path.includes(menu) || path.includes(btn)) return;
        closeDarkSelects();
      };
      const onScroll = (e) => {
        const path = typeof e.composedPath === "function" ? e.composedPath() : [];
        if (path.includes(menu)) return;
        closeDarkSelects();
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeDarkSelects();
          btn.focus();
        }
      };

      activeDarkMenuCleanup = () => {
        btn.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
        menu.remove();
        window.removeEventListener("pointerdown", onOutside, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", closeDarkSelects);
        window.removeEventListener("keydown", onKey, true);
      };

      setTimeout(() => {
        if (!menu.isConnected) return;
        window.addEventListener("pointerdown", onOutside, true);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", closeDarkSelects);
        window.addEventListener("keydown", onKey, true);
      }, 0);
    });

    return btn;
  }

  function showToast(toastStack, text) {
    if (!toastStack) return;
    const item = el("div", { className: "dih-card dih-toast" }, [
      el("span", { className: "dih-toast-dot" }),
      el("span", {}, text),
    ]);
    toastStack.appendChild(item);
    setTimeout(() => {
      item.style.opacity = "0";
      item.style.transition = "opacity 160ms ease";
      setTimeout(() => item.remove(), 180);
    }, 2400);
  }

  return {
    getHostApi,
    el,
    makeBrandSvg,
    applyThemeVars,
    syncEarlyPerfStorage,
    makeDraggable,
    setAudioOptions,
    playTone,
    readDeadshotSettings,
    readDeadshotKeybinds,
    writeDeadshotSetting,
    encodeCrosshairCode,
    decodeCrosshairCode,
    createDarkSelect,
    closeDarkSelects,
    showToast,
  };
})();
