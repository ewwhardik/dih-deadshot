/**
 * Context-isolated Preload Bridge for the Deadshot game window.
 * Keeps Node/Electron globals hidden while exposing typed Dih client APIs.
 */

const { contextBridge, ipcRenderer, webFrame } = require("electron");

// High-performance GPU & desync/vsync hints are enforced natively via Chromium flags.
// Never monkeypatch HTMLCanvasElement.prototype.getContext because Deadshot's pkg-bootstrap checks native toString().
try {
  webFrame.executeJavaScript(
    `(function(){
      if(window.__DIH_EARLY_PERF__) return;
      window.__DIH_EARLY_PERF__ = true;
      var cfg = {};
      try { cfg = JSON.parse(localStorage.getItem("__dih_early_perf") || "{}"); } catch(_) {}
      var scale = Number(cfg.canvasDprScale);
      if (scale >= 0.5 && scale <= 1.5 && Math.abs(scale - 1) > 0.02) {
        var origDpr = Number(window.devicePixelRatio) || 1;
        try {
          Object.defineProperty(window, "devicePixelRatio", {
            get: function() { return Math.max(0.5, Math.min(2.5, origDpr * scale)); },
            configurable: true
          });
        } catch(_) {}
      }
    })();`,
    false
  );
} catch {}

const api = {
  // Settings & profiles
  getSettings: () => ipcRenderer.invoke("dih:get-settings"),
  setSetting: (dotPath, value) => ipcRenderer.invoke("dih:set-setting", dotPath, value),
  updateSettings: (patch) => ipcRenderer.invoke("dih:update-settings", patch),
  applyThemePreset: (presetKey) => ipcRenderer.invoke("dih:apply-theme-preset", presetKey),
  applyPerfPreset: (mode) => ipcRenderer.invoke("dih:apply-perf-preset", mode),
  resetAllSettings: () => ipcRenderer.invoke("dih:reset-all-settings"),
  exportProfile: () => ipcRenderer.invoke("dih:export-profile"),
  importProfile: () => ipcRenderer.invoke("dih:import-profile"),

  // HUD widget coordinates
  getHudPositions: () => ipcRenderer.invoke("dih:get-hud-positions"),
  setHudPosition: (widgetId, pos) => ipcRenderer.invoke("dih:set-hud-position", widgetId, pos),
  resetHudPositions: () => ipcRenderer.invoke("dih:reset-hud-positions"),

  // Catalogs & feature registry
  getCatalog: () => ipcRenderer.invoke("dih:get-catalog"),

  // Hardware & real telemetry
  getStaticHardware: () => ipcRenderer.invoke("dih:get-static-hardware"),
  getLiveMetrics: () => ipcRenderer.invoke("dih:get-live-metrics"),
  probePing: () => ipcRenderer.invoke("dih:probe-ping"),
  runHardwareAnalysis: (applyRecommended = false) =>
    ipcRenderer.invoke("dih:run-hardware-analysis", Boolean(applyRecommended)),

  // Window, audio & maintenance actions
  setMasterMute: (muted) => ipcRenderer.invoke("dih:set-master-mute", muted),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke("dih:set-always-on-top", flag),
  setWindowOpacity: (opacity) => ipcRenderer.invoke("dih:set-window-opacity", opacity),
  toggleFullscreen: () => ipcRenderer.invoke("dih:toggle-fullscreen"),
  clearCache: () => ipcRenderer.invoke("dih:clear-cache"),
  trimMemory: () => ipcRenderer.invoke("dih:trim-memory"),
  relaunchApp: () => ipcRenderer.invoke("dih:relaunch-app"),
  reloadGame: () => ipcRenderer.invoke("dih:reload-game"),
  captureScreenshot: () => ipcRenderer.invoke("dih:capture-screenshot"),
  openFolders: () => ipcRenderer.invoke("dih:open-folders"),
  openExternal: (url) => ipcRenderer.invoke("dih:open-external", url),
  exportDiagnostics: (clientSnapshot) => ipcRenderer.invoke("dih:export-diagnostics", clientSnapshot),

  // Skins & 3D Studio
  listCustomSkins: () => ipcRenderer.invoke("dih:list-custom-skins"),
  saveCustomSkin: (payload) => ipcRenderer.invoke("dih:save-custom-skin", payload),
  listSwapFiles: () => ipcRenderer.invoke("dih:list-swap-files"),
  rescanSwapFiles: () => ipcRenderer.invoke("dih:rescan-swap-files"),
  saveSkinPreset: (name) => ipcRenderer.invoke("dih:save-skin-preset", name),
  applySkinPreset: (name) => ipcRenderer.invoke("dih:apply-skin-preset", name),
  deleteSkinPreset: (name) => ipcRenderer.invoke("dih:delete-skin-preset", name),
  openStudio: (tab = "painter", weapon = "") => ipcRenderer.invoke("dih:open-studio", { tab, weapon }),

  // Corsair & OpenRGB
  getCorsairStatus: () => ipcRenderer.invoke("dih:corsair-status"),
  rescanCorsair: () => ipcRenderer.invoke("dih:corsair-rescan"),
  connectOpenRgb: (host, port) => ipcRenderer.invoke("dih:corsair-connect-openrgb", host, port),
  corsairUpdateTelemetry: (patch) => ipcRenderer.send("dih:corsair-telemetry", patch),
  registerWebHidDevice: (info) => ipcRenderer.invoke("dih:corsair-webhid-register", info),

  // Discord RPC
  updateDiscordState: (state) => ipcRenderer.send("dih:discord-state", state),
  getDiscordStatus: () => ipcRenderer.invoke("dih:discord-status"),
  reconnectDiscordRpc: () => ipcRenderer.invoke("dih:discord-reconnect"),

  // Main -> Renderer push subscriptions
  onSettingsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("dih:settings-updated", listener);
    return () => ipcRenderer.removeListener("dih:settings-updated", listener);
  },
  onAction: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("dih:action", listener);
    return () => ipcRenderer.removeListener("dih:action", listener);
  },
};

contextBridge.exposeInMainWorld("dih", api);
