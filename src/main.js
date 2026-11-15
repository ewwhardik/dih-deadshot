/**
 * Dih Client Main Process
 * Uncapped FPS Chromium flags, stealth browser config, single-pass WebRequest skin/adblock pipeline,
 * real hardware/display telemetry, Corsair OpenRGB/WebHID bridge & isolated Studio window.
 */

const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  protocol,
  screen,
  dialog,
  shell,
  powerSaveBlocker,
} = require("electron");

const { THEME_PRESETS } = require("./data/defaultSettings");
const {
  WEAPONS,
  WEAPON_BALLISTICS,
  MELEE_AND_UTILITY_MODELS,
  OFFICIAL_SKINS,
  SHADER_SKINS,
  DIH_SKIN_PACKS,
  CHARACTER_ASSETS,
  ENVIRONMENT_AND_UI_ASSETS,
  MAPS,
  DSIO_SETTINGS_KEYS,
  DSIO_KEYBIND_KEYS,
  STORAGE_KEYS,
} = require("./data/deadshotCatalog");
const { FEATURE_CATEGORIES, FEATURE_REGISTRY } = require("./data/featureRegistry");
const { SettingsStore } = require("./services/settingsStore");
const { SystemMetricsService } = require("./services/systemMetrics");
const { CorsairBridgeService } = require("./services/corsairBridge");
const { SkinManagerService } = require("./services/skinManager");
const { DiscordRpcService } = require("./services/discordRpc");

// Must be set before SettingsStore initialization & app.whenReady()
const appRoot = path.resolve(__dirname, "..");
const userDataOverride =
  process.env.DIH_USER_DATA || path.join(app.getPath("appData"), "dih-client");
app.setPath("userData", userDataOverride);

if (process.env.DIH_ALLOW_MULTI_INSTANCE !== "1") {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "custom",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const settingsStore = new SettingsStore(userDataOverride);
const systemMetrics = new SystemMetricsService();
const corsairBridge = new CorsairBridgeService();
const skinManager = new SkinManagerService({ userDataPath: userDataOverride, appRoot });
const discordRpc = new DiscordRpcService();

const bootSettings = settingsStore.getAll();

function applyBootChromiumSwitches(cfg) {
  const perf = cfg.performance || {};
  const win = cfg.window || {};
  const net = cfg.network || {};

  if (win.hardwareAcceleration === false) {
    app.disableHardwareAcceleration();
    return;
  }

  if (perf.disableFrameRateLimit) {
    app.commandLine.appendSwitch("disable-frame-rate-limit");
  }
  if (perf.disableGpuVsync) {
    app.commandLine.appendSwitch("disable-gpu-vsync");
  }
  if (perf.forceHighPerformanceGpu) {
    app.commandLine.appendSwitch("force_high_performance_gpu");
  }
  if (perf.enableGpuRasterization) {
    app.commandLine.appendSwitch("enable-gpu-rasterization");
  }
  if (perf.enableZeroCopy) {
    app.commandLine.appendSwitch("enable-zero-copy");
  }
  if (perf.ignoreGpuBlocklist) {
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
  }
  if (perf.antiBackgroundThrottle) {
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
    app.commandLine.appendSwitch("disable-ipc-flooding-protection");
  }
  if (perf.disableSmoothScrolling !== false) {
    app.commandLine.appendSwitch("disable-smooth-scrolling");
  }
  if (perf.angleBackend && perf.angleBackend !== "default") {
    if (process.platform === "win32") {
      app.commandLine.appendSwitch("use-angle", perf.angleBackend);
    } else if (process.platform === "darwin" && (perf.angleBackend === "metal" || perf.angleBackend === "gl")) {
      app.commandLine.appendSwitch("use-angle", perf.angleBackend);
    } else if (process.platform === "linux" && (perf.angleBackend === "vulkan" || perf.angleBackend === "gl")) {
      app.commandLine.appendSwitch("use-angle", perf.angleBackend);
    }
  }
  const heapMb = Number(perf.jsHeapLimitMb) || 4096;
  if (heapMb >= 256) {
    app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${heapMb}`);
  }
  if (perf.webviewMemoryMode === "low") {
    app.commandLine.appendSwitch("disk-cache-size", "67108864");
    app.commandLine.appendSwitch("media-cache-size", "33554432");
    app.commandLine.appendSwitch("renderer-process-limit", "1");
  }
  if (net.lowLatencyNetworking !== false) {
    app.commandLine.appendSwitch("disable-background-networking");
    app.commandLine.appendSwitch("disable-domain-reliability");
    app.commandLine.appendSwitch("disable-component-update");
  }
  if (net.quicTransport !== false) {
    app.commandLine.appendSwitch("enable-quic");
  }
  if (win.userAgentStealth !== false) {
    app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");
  }
  app.commandLine.appendSwitch("enable-features", "WebHID");
}

applyBootChromiumSwitches(bootSettings);

let mainWindow = null;
let studioWindow = null;
let adBlocker = null;
let powerSaveId = null;

function broadcastSettings(updated) {
  for (const win of [mainWindow, studioWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("dih:settings-updated", updated);
    }
  }
}

function getCleanUserAgent(rawUa) {
  return String(rawUa || "")
    .replace(/\sElectron\/[^\s]+/gi, "")
    .replace(/\sdih-client\/[^\s]+/gi, "");
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".json": "application/json",
    ".css": "text/css",
    ".js": "application/javascript",
    ".wasm": "application/wasm",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
  };
  return map[ext] || "application/octet-stream";
}

const AD_BLOCKED_HOSTS = [
  "vntsm.com",
  "vntsm.io",
  "venatusmedia.com",
  "atmtd.com",
  "googlesyndication.com",
  "doubleclick.net",
  "googleadservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "casalemedia.com",
  "criteo.com",
  "criteo.net",
  "amazon-adsystem.com",
  "prebid.org",
  "scorecardresearch.com",
  "quantserve.com",
  "taboola.com",
  "outbrain.com",
  "sharethrough.com",
  "3lift.com",
  "smartadserver.com",
  "indexww.com",
  "adsrvr.org",
  "demdex.net",
  "krxd.net",
  "lijit.com",
  "bidswitch.net",
  "id5-sync.com",
  "adingo.jp",
  "adsystem.com",
  "gumgum.com",
  "media.net",
  "undertone.com",
  "teads.tv",
  "yellowblue.io",
  "clean.gg",
];

function isBlockedAdUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    for (const bad of AD_BLOCKED_HOSTS) {
      if (host === bad || host.endsWith("." + bad)) return true;
    }
    const lower = (host + u.pathname).toLowerCase();
    return (
      lower.includes("/prebid") ||
      lower.includes("vntsm.") ||
      lower.includes("/pagead/") ||
      lower.includes("hb.js")
    );
  } catch {
    return false;
  }
}

function setupCustomProtocol() {
  protocol.handle("custom", async (request) => {
    try {
      const u = new URL(request.url);
      const segs = decodeURIComponent(u.pathname).replace(/^\/+/, "").split("/").filter(Boolean);
      if (segs[0] === "__ad_stub__") {
        const stubType = segs[1] || "empty.js";
        if (stubType === "empty.json") {
          return new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }
        return new Response("/* blocked */", {
          status: 200,
          headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" },
        });
      }
    } catch {}
    const resolved = skinManager.resolveCustomProtocolPath(request.url);
    if (!resolved) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
    try {
      const data = await fs.promises.readFile(resolved);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": getMimeType(resolved),
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("Read Error", { status: 500 });
    }
  });
}

async function initAdBlocker() {
  if (process.env.DIH_SKIP_ADBLOCK_NETWORK === "1") return null;
  try {
    const { ElectronBlocker } = require("@ghostery/adblocker-electron");
    const fetchFn = require("cross-fetch");
    adBlocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchFn);
    return adBlocker;
  } catch {
    adBlocker = null;
    return null;
  }
}

function setupSessionPipeline(ses) {
  // Unified single-pass WebRequest pipeline: skin/swapper FIRST, then adblocker
  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const liveSettings = settingsStore.settings;
    const swap = skinManager.resolveRequest(details.url, liveSettings);
    if (swap && swap.redirectURL) {
      return callback({ redirectURL: swap.redirectURL });
    }

    if (liveSettings.window?.adblockerEnabled) {
      if (isBlockedAdUrl(details.url)) {
        if (details.resourceType === "script") {
          return callback({ redirectURL: "custom://dih/__ad_stub__/empty.js" });
        }
        if (details.resourceType === "xhr" || details.resourceType === "fetch") {
          return callback({ redirectURL: "custom://dih/__ad_stub__/empty.json" });
        }
        return callback({ cancel: true });
      }
      if (adBlocker) {
        return adBlocker.onBeforeRequest(details, callback);
      }
    }

    return callback({});
  });

  ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    const liveSettings = settingsStore.settings;
    if (liveSettings.window?.adblockerEnabled && adBlocker) {
      return adBlocker.onHeadersReceived(details, callback);
    }
    return callback({});
  });

  // WebHID permissions strictly for Corsair USB Vendor ID 0x1B1C
  ses.setPermissionCheckHandler((_wc, permission) => {
    if (permission === "hid" || permission === "fullscreen" || permission === "pointerLock") {
      return Boolean(settingsStore.settings.corsair?.webHidEnabled !== false);
    }
    return false;
  });

  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType === "hid" && details.device?.vendorId === 0x1b1c) {
      return Boolean(settingsStore.settings.corsair?.webHidEnabled !== false);
    }
    return false;
  });

  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const corsairDevice = (details.deviceList || []).find((d) => d.vendorId === 0x1b1c);
    callback(corsairDevice ? corsairDevice.deviceId : "");
  });
}

function buildInjectedRendererScript() {
  const rendererDir = path.join(__dirname, "renderer");
  const cssPath = path.join(rendererDir, "styles.css");
  const moduleFiles = [
    "utils.js",
    "bootAnalyzer.js",
    "telemetryHud.js",
    "netGraphHud.js",
    "keysOverlay.js",
    "crosshairEngine.js",
    "extraOverlays.js",
    "filterEngine.js",
    "corsairReactive.js",
    "leaderboardModal.js",
    "autoChat.js",
    "../studio/shaderBaker.js",
    "commandCenter.js",
    "overlayMain.js",
  ];

  const cssText = fs.readFileSync(cssPath, "utf8");
  const chunks = moduleFiles.map((file) => {
    const full = path.join(rendererDir, file);
    return `/* === ${file} === */\n${fs.readFileSync(full, "utf8")}`;
  });

  return `(function() {
  if (window.__DIH_INJECTED__) return;
  window.__DIH_INJECTED__ = true;
  const DIH_SHADOW_CSS = ${JSON.stringify(cssText)};
  const DIH_NS = {};
  ${chunks.join("\n\n")}
  if (typeof DIH_NS.boot === "function") {
    DIH_NS.boot(DIH_SHADOW_CSS);
  }
})();`;
}

function shouldInjectOverlay(url) {
  if (!url) return false;
  if (process.env.DIH_TEST_URL && url.startsWith(process.env.DIH_TEST_URL)) return true;
  try {
    const u = new URL(url);
    return u.hostname === "deadshot.io" || u.hostname === "www.deadshot.io";
  } catch {
    return false;
  }
}

function createMainWindow() {
  const s = settingsStore.getAll();
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.workAreaSize;
  const width = Math.min(1440, Math.round(bounds.width * 0.9));
  const height = Math.min(900, Math.round(bounds.height * 0.9));

  const icoCandidate = path.join(appRoot, "assets", "dih-icon.ico");
  const pngCandidate = path.join(appRoot, "assets", "dih-icon-512.png");
  const pngFallback = path.join(appRoot, "assets", "dih-icon.png");
  const iconCandidate =
    process.platform === "win32" && fs.existsSync(icoCandidate)
      ? icoCandidate
      : fs.existsSync(pngCandidate)
      ? pngCandidate
      : pngFallback;
  const winOpts = {
    width,
    height,
    minWidth: 960,
    minHeight: 600,
    title: "Dih Client — Deadshot.io",
    backgroundColor: "#0e0f12",
    autoHideMenuBar: true,
    show: false,
    fullscreen: Boolean(s.window?.autoFullscreen),
    alwaysOnTop: Boolean(s.window?.alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: !Boolean(s.performance?.antiBackgroundThrottle),
      webgl: true,
      spellcheck: false,
    },
  };
  if (fs.existsSync(iconCandidate)) winOpts.icon = iconCandidate;

  mainWindow = new BrowserWindow(winOpts);
  if (s.window?.opacity && s.window.opacity < 1) {
    mainWindow.setOpacity(Math.max(0.3, Math.min(1, Number(s.window.opacity))));
  }
  if (s.window?.borderlessMaximized && !s.window?.autoFullscreen) {
    mainWindow.maximize();
  }

  if (s.window?.userAgentStealth !== false) {
    const cleanUa = getCleanUserAgent(mainWindow.webContents.userAgent);
    mainWindow.webContents.userAgent = cleanUa;
  }

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Safe external & auth popup handling
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowInAppPopup =
      /^https:\/\/(accounts\.google\.com|discord\.com|login\.deadshot\.io|deadshot\.io|auth\.crazygames\.com)/i.test(url);
    if (allowInAppPopup) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: "#0e0f12",
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    const currentUrl = mainWindow.webContents.getURL();
    if (shouldInjectOverlay(currentUrl)) {
      try {
        const script = buildInjectedRendererScript();
        await mainWindow.webContents.executeJavaScript(script, false);
      } catch (err) {
        console.error("[Dih] Renderer injection error:", err);
      }
    }
    systemMetrics.applyProcessPriority(settingsStore.settings.performance?.processPriority || "above_normal");
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === "F12" && input.control && input.shift) {
      mainWindow.webContents.toggleDevTools();
    } else if (input.key === "F7") {
      event.preventDefault();
      openStudioWindow({ tab: "corsair" });
    } else if (input.key === "Insert") {
      event.preventDefault();
      mainWindow.webContents.send("dih:action", "toast:7-Gun Aim Trainer — Coming Soon");
    } else if (input.key === "F8") {
      event.preventDefault();
      const nextMute = !Boolean(settingsStore.settings.audio?.masterMuted);
      const updated = settingsStore.set("audio.masterMuted", nextMute);
      mainWindow.webContents.setAudioMuted(nextMute);
      broadcastSettings(updated);
    } else if (input.key === "F10") {
      event.preventDefault();
      captureMainWindowScreenshot().then((res) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("dih:action", { type: "screenshotResult", payload: res });
        }
      });
    }
  });

  mainWindow.on("focus", () => {
    const perf = settingsStore.settings.performance || {};
    if (perf.focusPriorityScaling) {
      systemMetrics.applyProcessPriority(perf.processPriority || "high");
    }
  });

  mainWindow.on("blur", () => {
    const perf = settingsStore.settings.performance || {};
    if (perf.focusPriorityScaling) {
      systemMetrics.applyProcessPriority("normal");
    }
  });

  mainWindow.on("close", (e) => {
    if (settingsStore.settings.privacyPro?.confirmOnClose) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Keep Playing", "Exit Dih Client"],
        defaultId: 0,
        cancelId: 0,
        title: "Confirm Exit — Dih Client",
        message: "Close Dih Client and exit Deadshot.io?",
      });
      if (choice === 0) {
        e.preventDefault();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.close();
    }
  });

  const targetUrl = process.env.DIH_TEST_URL || "https://deadshot.io/";
  mainWindow.loadURL(targetUrl).catch((err) => {
    console.error("[Dih] Failed loading URL:", err.message);
  });
}

function openStudioWindow(targetArg = "corsair") {
  const isObj = targetArg && typeof targetArg === "object";
  const initialTab = isObj ? (targetArg.tab || "corsair") : String(targetArg || "corsair");
  const targetWeapon = isObj && targetArg.weapon ? String(targetArg.weapon) : "";

  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    studioWindow.focus();
    studioWindow.webContents.send("dih:studio-tab", targetWeapon ? { tab: initialTab, weapon: targetWeapon } : initialTab);
    return;
  }

  const icoCandidate = path.join(appRoot, "assets", "dih-icon.ico");
  const pngHiCandidate = path.join(appRoot, "assets", "dih-icon-512.png");
  const pngCandidate = path.join(appRoot, "assets", "dih-icon.png");
  const studioIcon =
    process.platform === "win32" && fs.existsSync(icoCandidate)
      ? icoCandidate
      : fs.existsSync(pngHiCandidate)
      ? pngHiCandidate
      : pngCandidate;
  const studioOpts = {
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    title: "Dih Studio — Corsair RGB & Project Explorer",
    backgroundColor: "#0e0f12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preloadStudio.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
    },
  };
  if (fs.existsSync(studioIcon)) studioOpts.icon = studioIcon;
  studioWindow = new BrowserWindow(studioOpts);

  studioWindow.loadFile(path.join(__dirname, "studio", "studio.html"), {
    query: targetWeapon ? { tab: initialTab, weapon: targetWeapon } : { tab: initialTab },
  });

  studioWindow.on("closed", () => {
    studioWindow = null;
  });
}

async function captureMainWindowScreenshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: "No active game window" };
  try {
    const img = await mainWindow.webContents.capturePage();
    const outDir = path.join(app.getPath("pictures"), "Dih");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(outDir, `dih-shot-${stamp}.png`);
    fs.writeFileSync(filePath, img.toPNG());
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getCatalogBundle() {
  return {
    version: app.getVersion(),
    clientName: "Dih",
    THEME_PRESETS,
    WEAPONS,
    WEAPON_BALLISTICS,
    MELEE_AND_UTILITY_MODELS,
    OFFICIAL_SKINS,
    SHADER_SKINS,
    DIH_SKIN_PACKS,
    CHARACTER_ASSETS,
    ENVIRONMENT_AND_UI_ASSETS,
    MAPS,
    DSIO_SETTINGS_KEYS,
    DSIO_KEYBIND_KEYS,
    STORAGE_KEYS,
    FEATURE_CATEGORIES,
    FEATURE_REGISTRY,
  };
}

function applyRuntimeSettingSideEffects(dotPath, value) {
  if (dotPath === "audio.masterMuted" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setAudioMuted(Boolean(value));
  }
  if (dotPath === "window.alwaysOnTop" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(Boolean(value));
  }
  if (dotPath === "window.opacity" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(Math.max(0.3, Math.min(1, Number(value) || 1)));
  }
  if (dotPath === "window.autoFullscreen" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(Boolean(value));
  }
  if (dotPath === "window.borderlessMaximized" && mainWindow && !mainWindow.isDestroyed()) {
    if (value) mainWindow.maximize();
    else mainWindow.unmaximize();
  }
  if (dotPath === "performance.processPriority") {
    systemMetrics.applyProcessPriority(value);
  }
  if (dotPath === "performance.pingIntervalMs") {
    const ms = Math.max(1000, Math.min(15000, Number(value) || 3500));
    systemMetrics.startPingLoop(ms);
  }
  if (dotPath === "window.discordRpcEnabled" || dotPath === "window.discordPrivacyMode") {
    discordRpc.setConfig({
      enabled: settingsStore.settings.window?.discordRpcEnabled,
      privacyMode: settingsStore.settings.window?.discordPrivacyMode,
    });
  }
  if (dotPath === "theme.accent" && settingsStore.settings.corsair?.syncWithTheme) {
    settingsStore.set("corsair.primaryColor", value);
    corsairBridge.setConfig(settingsStore.settings.corsair);
  }
  if (String(dotPath).startsWith("corsair.")) {
    corsairBridge.setConfig(settingsStore.settings.corsair);
  }
  if (String(dotPath).startsWith("skins.")) {
    session.defaultSession.clearCache().catch(() => {});
  }
}

function setupIpcHandlers() {
  ipcMain.handle("dih:get-settings", () => settingsStore.getAll());

  ipcMain.handle("dih:set-setting", (_ev, dotPath, value) => {
    const updated = settingsStore.set(dotPath, value);
    applyRuntimeSettingSideEffects(dotPath, value);
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:update-settings", (_ev, patch) => {
    const updated = settingsStore.updateMany(patch);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setAudioMuted(Boolean(updated.audio?.masterMuted));
      mainWindow.setAlwaysOnTop(Boolean(updated.window?.alwaysOnTop));
      mainWindow.setOpacity(Math.max(0.3, Math.min(1, Number(updated.window?.opacity ?? 1))));
    }
    corsairBridge.setConfig(updated.corsair);
    discordRpc.setConfig({
      enabled: updated.window?.discordRpcEnabled,
      privacyMode: updated.window?.discordPrivacyMode,
    });
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:apply-theme-preset", (_ev, presetKey) => {
    const updated = settingsStore.applyThemePreset(presetKey);
    if (updated) {
      if (updated.corsair?.syncWithTheme) {
        corsairBridge.setConfig({
          ...updated.corsair,
          primaryColor: updated.theme.accent,
        });
      }
      broadcastSettings(updated);
    }
    return updated || settingsStore.getAll();
  });

  ipcMain.handle("dih:apply-perf-preset", (_ev, mode) => {
    const updated = settingsStore.applyPerfPreset(mode);
    systemMetrics.applyProcessPriority(updated.performance.processPriority);
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:reset-all-settings", () => {
    const updated = settingsStore.resetAll();
    corsairBridge.setConfig(updated.corsair);
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:export-profile", async () => {
    const bundle = settingsStore.exportBundle();
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Export Dih Client Profile",
      defaultPath: path.join(app.getPath("documents"), "dih-profile.json"),
      filters: [{ name: "JSON Profile", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), "utf8");
    return { ok: true, filePath };
  });

  ipcMain.handle("dih:import-profile", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Import Dih Client Profile",
      properties: ["openFile"],
      filters: [{ name: "JSON Profile", extensions: ["json"] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    const raw = fs.readFileSync(filePaths[0], "utf8");
    const parsed = JSON.parse(raw);
    const updated = settingsStore.importBundle(parsed);
    corsairBridge.setConfig(updated.corsair);
    broadcastSettings(updated);
    return { ok: true, settings: updated };
  });

  ipcMain.handle("dih:get-hud-positions", () => settingsStore.getHudPositions());
  ipcMain.handle("dih:set-hud-position", (_ev, widgetId, pos) => settingsStore.setHudPosition(widgetId, pos));
  ipcMain.handle("dih:reset-hud-positions", () => settingsStore.resetHudPositions());

  ipcMain.handle("dih:get-catalog", () => getCatalogBundle());

  ipcMain.handle("dih:get-static-hardware", () => systemMetrics.getStaticHardwareSummary());
  ipcMain.handle("dih:get-live-metrics", () => systemMetrics.getLiveMetrics());
  ipcMain.handle("dih:probe-ping", () => {
    const host = settingsStore.settings.network?.pingHost || "deadshot.io";
    return systemMetrics.probeDeadshotLatency(host);
  });
  ipcMain.handle("dih:run-hardware-analysis", async (_ev, applyRecommended = false) => {
    const analysis = await systemMetrics.analyzeHardwarePower();
    let updated = settingsStore.getAll();
    if (applyRecommended) {
      updated = settingsStore.applyPerfPreset(analysis.recommendedPreset);
      const rec = analysis.recommendations || {};
      updated = settingsStore.updateMany({
        performance: {
          canvasDprScale: rec.canvasDprScale ?? 1.0,
          reduceMotionUi: Boolean(rec.reduceMotionUi),
          hostRamTargetMb: rec.hostRamTargetMb ?? 12,
          preferPerformanceCores: Boolean(rec.preferPerformanceCores),
          disablePowerThrottling: rec.disablePowerThrottling !== false,
        },
        autoTune: {
          completed: true,
          lastScore: analysis.powerScore,
          recommendedTier: analysis.tier,
          detectedSummary: analysis.detectedSummary,
        },
      });
      systemMetrics.applyProcessPriority(updated.performance?.processPriority || "high");
      broadcastSettings(updated);
    } else {
      updated = settingsStore.updateMany({
        autoTune: {
          lastScore: analysis.powerScore,
          recommendedTier: analysis.tier,
          detectedSummary: analysis.detectedSummary,
        },
      });
      broadcastSettings(updated);
    }
    return { analysis, settings: updated };
  });

  ipcMain.handle("dih:set-master-mute", (_ev, muted) => {
    const updated = settingsStore.set("audio.masterMuted", Boolean(muted));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setAudioMuted(Boolean(muted));
    }
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:set-always-on-top", (_ev, flag) => {
    const updated = settingsStore.set("window.alwaysOnTop", Boolean(flag));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(Boolean(flag));
    }
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:set-window-opacity", (_ev, opacity) => {
    const clamped = Math.max(0.3, Math.min(1, Number(opacity) || 1));
    const updated = settingsStore.set("window.opacity", clamped);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(clamped);
    }
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:toggle-fullscreen", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  ipcMain.handle("dih:clear-cache", async () => {
    await session.defaultSession.clearCache();
    return { ok: true };
  });

  ipcMain.handle("dih:reload-game", async () => {
    await session.defaultSession.clearCache();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
    return { ok: true };
  });

  ipcMain.handle("dih:trim-memory", () => {
    const before = process.memoryUsage().rss;
    try { global.gc?.(); } catch {}
    const after = process.memoryUsage().rss;
    return { ok: true, freedMb: Math.max(0, Math.round((before - after) / 1048576)) };
  });

  ipcMain.handle("dih:relaunch-app", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("dih:capture-screenshot", () => captureMainWindowScreenshot());

  ipcMain.handle("dih:open-folders", async () => {
    skinManager.ensureDirectories();
    await shell.openPath(skinManager.customSkinsDir);
    return skinManager.getPaths();
  });

  ipcMain.handle("dih:open-external", async (_ev, rawUrl) => {
    try {
      const u = new URL(String(rawUrl || ""));
      if (u.protocol === "https:" || u.protocol === "http:") {
        await shell.openExternal(u.toString());
        return { ok: true };
      }
    } catch {}
    return { ok: false };
  });

  ipcMain.handle("dih:export-diagnostics", async (_ev, clientSnapshot = {}) => {
    const hw = await systemMetrics.getStaticHardwareSummary();
    const live = systemMetrics.getLiveMetrics();
    const diag = {
      generatedAt: new Date().toISOString(),
      client: "Dih Client",
      version: app.getVersion(),
      hardware: hw,
      liveMetrics: live,
      corsair: corsairBridge.getStatus(),
      skins: {
        customCount: skinManager.listCustomSkins().length,
        swapCount: skinManager.listSwapFiles().length,
      },
      settings: settingsStore.getAll(),
      rendererSnapshot: clientSnapshot,
    };
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save Dih Client Diagnostics",
      defaultPath: path.join(app.getPath("documents"), "dih-diagnostics.json"),
      filters: [{ name: "JSON Diagnostics", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(diag, null, 2), "utf8");
    return { ok: true, filePath };
  });

  // Skins & Asset Studio handlers
  ipcMain.handle("dih:list-custom-skins", () => skinManager.listCustomSkins());
  ipcMain.handle("dih:list-swap-files", () => skinManager.listSwapFiles());
  ipcMain.handle("dih:rescan-swap-files", () => skinManager.rescanSwapIndex());

  ipcMain.handle("dih:ensure-asset", (_ev, relPath) => skinManager.ensureCachedDeadshotAsset(relPath));

  ipcMain.handle("dih:save-custom-skin", (_ev, payload) => {
    const saved = skinManager.saveCustomSkin(payload);
    if (payload.applyImmediately) {
      const updated = settingsStore.updateMany({
        skins: {
          swapperEnabled: true,
          weapons: {
            [saved.weaponId]: {
              mode: "custom",
              officialId: "default",
              wear: 0,
              customFile: saved.fileName,
            },
          },
        },
      });
      broadcastSettings(updated);
      session.defaultSession.clearCache().catch(() => {});
    }
    return saved;
  });

  ipcMain.handle("dih:delete-custom-skin", (_ev, fileName) => skinManager.deleteCustomSkin(fileName));

  ipcMain.handle("dih:import-skin-file", async (_ev, weaponId = "ar") => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Import Weapon Skin Texture (.webp / .png / .jpg)",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["webp", "png", "jpg", "jpeg"] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    const src = filePaths[0];
    const ext = path.extname(src).toLowerCase().replace(".", "");
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const base64 = fs.readFileSync(src).toString("base64");
    const saved = skinManager.saveCustomSkin({
      name: path.basename(src, path.extname(src)),
      weaponId,
      dataUrl: `data:${mime};base64,${base64}`,
    });
    return { ok: true, saved };
  });

  ipcMain.handle("dih:equip-weapon-skin", (_ev, { weaponId, mode, officialId, wear, customFile }) => {
    if (!WEAPONS[weaponId]) throw new Error("Invalid weaponId");
    const updated = settingsStore.updateMany({
      skins: {
        swapperEnabled: true,
        weapons: {
          [weaponId]: {
            mode: mode || "default",
            officialId: officialId || "default",
            wear: Number(wear) || 0,
            customFile: customFile || "",
          },
        },
      },
    });
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:save-skin-preset", (_ev, name) => {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("Preset name required");
    const currentWeapons = settingsStore.get("skins.weapons");
    const updated = settingsStore.set(`skins.presets.${clean}`, currentWeapons);
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:apply-skin-preset", (_ev, name) => {
    const preset = settingsStore.get(`skins.presets.${name}`);
    if (!preset) return settingsStore.getAll();
    const updated = settingsStore.updateMany({
      skins: { activePresetName: name, weapons: preset },
    });
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:delete-skin-preset", (_ev, name) => {
    const presets = { ...(settingsStore.get("skins.presets") || {}) };
    delete presets[name];
    const updated = settingsStore.set("skins.presets", presets);
    broadcastSettings(updated);
    return updated;
  });

  ipcMain.handle("dih:open-studio", (_ev, targetArg = "corsair") => {
    openStudioWindow(targetArg);
    return { ok: true };
  });

  ipcMain.handle("dih:studio-init-bundle", async () => ({
    settings: settingsStore.getAll(),
    catalog: getCatalogBundle(),
    hardware: await systemMetrics.getStaticHardwareSummary(),
    customSkins: skinManager.listCustomSkins(),
    swapFiles: skinManager.listSwapFiles(),
    skinPaths: skinManager.getPaths(),
    corsair: corsairBridge.getStatus(),
  }));

  // Corsair & OpenRGB
  ipcMain.handle("dih:corsair-status", () => corsairBridge.getStatus());
  ipcMain.handle("dih:corsair-rescan", () => corsairBridge.scanHardware());
  ipcMain.handle("dih:corsair-connect-openrgb", (_ev, host, port) =>
    corsairBridge.connectOpenRgb(host, port)
  );
  ipcMain.handle("dih:corsair-webhid-register", (_ev, info) =>
    corsairBridge.registerWebHidDevice(info)
  );
  ipcMain.handle("dih:corsair-test-pulse", (_ev, kind) => {
    if (kind === "fire") corsairBridge.updateTelemetry({ fired: true });
    else if (kind === "reload") corsairBridge.updateTelemetry({ reloaded: true });
    else if (kind === "kill") corsairBridge.updateTelemetry({ killFlash: true });
    else if (kind === "ads") corsairBridge.updateTelemetry({ adsActive: !corsairBridge.telemetry.adsActive });
    return corsairBridge.computeFrame();
  });

  ipcMain.on("dih:corsair-telemetry", (_ev, patch) => {
    corsairBridge.updateTelemetry(patch);
  });

  ipcMain.on("dih:discord-state", (_ev, state) => {
    discordRpc.updateActivity(state);
  });
}

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  setupCustomProtocol();
  setupIpcHandlers();

  await systemMetrics.init();
  const pingMs = Math.max(1000, Math.min(15000, Number(settingsStore.settings.performance?.pingIntervalMs) || 3500));
  systemMetrics.startPingLoop(pingMs);

  corsairBridge.setConfig(settingsStore.settings.corsair);
  corsairBridge.scanHardware().catch(() => {});
  corsairBridge.startEngine(50);

  // Stream live virtual Corsair keyboard frames only while Studio window is open
  corsairBridge.onFrame((frame) => {
    if (studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.webContents.send("dih:corsair-frame", frame);
    }
  });

  discordRpc.setConfig({
    enabled: settingsStore.settings.window?.discordRpcEnabled,
    privacyMode: settingsStore.settings.window?.discordPrivacyMode,
  });

  if (settingsStore.settings.performance?.antiBackgroundThrottle) {
    powerSaveId = powerSaveBlocker.start("prevent-app-suspension");
  }

  await initAdBlocker();
  setupSessionPipeline(session.defaultSession);
  createMainWindow();
});

app.on("window-all-closed", () => {
  systemMetrics.stopPingLoop();
  corsairBridge.stopEngine();
  discordRpc.stop();
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
