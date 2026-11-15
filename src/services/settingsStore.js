/**
 * Persistent settings and HUD layout storage for Dih Client.
 */

const fs = require("fs");
const path = require("path");
const { DEFAULT_SETTINGS, THEME_PRESETS } = require("../data/defaultSettings");

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function deepMerge(base, override) {
  const out = clone(base);
  if (!isPlainObject(override)) return out;
  for (const [key, val] of Object.entries(override)) {
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], val);
    } else if (val !== undefined) {
      out[key] = clone(val);
    }
  }
  return out;
}

class SettingsStore {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.settingsFile = path.join(userDataPath, "dih-settings.json");
    this.positionsFile = path.join(userDataPath, "dih-hud-positions.json");
    this.settings = clone(DEFAULT_SETTINGS);
    this.hudPositions = {};
    this._ensureDir();
    this.load();
  }

  _ensureDir() {
    fs.mkdirSync(this.userDataPath, { recursive: true });
  }

  load() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, "utf8");
        const parsed = JSON.parse(raw);
        this.settings = deepMerge(DEFAULT_SETTINGS, parsed);
      } else {
        this.settings = clone(DEFAULT_SETTINGS);
        this.save();
      }
    } catch {
      this.settings = clone(DEFAULT_SETTINGS);
    }

    try {
      if (fs.existsSync(this.positionsFile)) {
        const rawPos = fs.readFileSync(this.positionsFile, "utf8");
        const parsedPos = JSON.parse(rawPos);
        if (isPlainObject(parsedPos)) this.hudPositions = parsedPos;
      }
    } catch {
      this.hudPositions = {};
    }

    return this.settings;
  }

  save() {
    this._ensureDir();
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), "utf8");
  }

  savePositions() {
    this._ensureDir();
    fs.writeFileSync(this.positionsFile, JSON.stringify(this.hudPositions, null, 2), "utf8");
  }

  getAll() {
    return clone(this.settings);
  }

  get(dotPath) {
    if (!dotPath) return this.getAll();
    const parts = String(dotPath).split(".");
    let cur = this.settings;
    for (const p of parts) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  }

  set(dotPath, value) {
    const parts = String(dotPath).split(".");
    if (!parts.length) return this.settings;
    let cur = this.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!isPlainObject(cur[part])) cur[part] = {};
      cur = cur[part];
    }
    cur[parts[parts.length - 1]] = clone(value);
    this.save();
    return this.getAll();
  }

  updateMany(patch) {
    this.settings = deepMerge(this.settings, patch);
    this.save();
    return this.getAll();
  }

  applyThemePreset(presetKey) {
    const preset = THEME_PRESETS[presetKey];
    if (!preset) return null;
    this.settings.theme = {
      ...this.settings.theme,
      preset: presetKey,
      ...clone(preset),
    };
    if (this.settings.corsair?.syncWithTheme && preset.accent) {
      this.settings.corsair.primaryColor = preset.accent;
    }
    this.save();
    return this.getAll();
  }

  applyPerfPreset(mode) {
    const normalized = mode === "uncapped_esports" ? "max_compute" : mode;
    if (normalized === "max_compute") {
      this.settings.performance = {
        ...this.settings.performance,
        disableFrameRateLimit: true,
        disableGpuVsync: true,
        forceHighPerformanceGpu: true,
        enableGpuRasterization: true,
        enableZeroCopy: true,
        antiBackgroundThrottle: true,
        ignoreGpuBlocklist: true,
        disablePowerThrottling: true,
        lowLatencyTimer: true,
        preventSleep: true,
        noBackdropBlurHud: true,
        gpuCachePrewarm: true,
        angleBackend: "d3d11",
        processPriority: "high",
        softwareFpsCap: 0,
        hostRamTargetMb: 12,
        autoHostRamGuard: true,
        webviewMemoryMode: "normal",
        jsHeapLimitMb: 4096,
        presetMode: "max_compute",
        enablePriorityBoost: true,
        disableSmoothScrolling: true,
        webglLowLatency: true,
        canvasDprScale: 1.0,
        reduceMotionUi: false,
      };
      this.settings.network = {
        ...this.settings.network,
        lowLatencyNetworking: true,
        quicTransport: true,
      };
      if (this.settings.hud) {
        this.settings.hud.showFrametimeGraph = true;
      }
    } else if (normalized === "balanced") {
      this.settings.performance = {
        ...this.settings.performance,
        disableFrameRateLimit: true,
        disableGpuVsync: false,
        forceHighPerformanceGpu: true,
        enableGpuRasterization: true,
        enableZeroCopy: true,
        antiBackgroundThrottle: true,
        ignoreGpuBlocklist: true,
        disablePowerThrottling: true,
        lowLatencyTimer: true,
        preventSleep: true,
        noBackdropBlurHud: true,
        processPriority: "above_normal",
        softwareFpsCap: 0,
        hostRamTargetMb: 12,
        autoHostRamGuard: true,
        webviewMemoryMode: "normal",
        jsHeapLimitMb: 2048,
        presetMode: "balanced",
        enablePriorityBoost: true,
        preferPerformanceCores: false,
        webglLowLatency: true,
        canvasDprScale: 0.95,
        reduceMotionUi: false,
      };
    } else if (normalized === "low_end") {
      this.settings.performance = {
        ...this.settings.performance,
        disableFrameRateLimit: true,
        disableGpuVsync: false,
        forceHighPerformanceGpu: false,
        enableGpuRasterization: true,
        enableZeroCopy: false,
        antiBackgroundThrottle: false,
        ignoreGpuBlocklist: false,
        disablePowerThrottling: false,
        lowLatencyTimer: true,
        preventSleep: false,
        noBackdropBlurHud: true,
        gpuCachePrewarm: false,
        processPriority: "normal",
        softwareFpsCap: 60,
        hostRamTargetMb: 10,
        autoHostRamGuard: true,
        webviewMemoryMode: "low",
        jsHeapLimitMb: 1024,
        presetMode: "low_end",
        enablePriorityBoost: false,
        preferPerformanceCores: false,
        webglLowLatency: true,
        canvasDprScale: 0.8,
        reduceMotionUi: true,
      };
      if (this.settings.hud) {
        this.settings.hud.showFrametimeGraph = false;
      }
    }
    this.save();
    return this.getAll();
  }

  resetAll() {
    this.settings = clone(DEFAULT_SETTINGS);
    this.save();
    return this.getAll();
  }

  getHudPositions() {
    return clone(this.hudPositions);
  }

  setHudPosition(widgetId, pos) {
    if (!widgetId || !isPlainObject(pos)) return this.getHudPositions();
    this.hudPositions[widgetId] = {
      x: Number(pos.x) || 0,
      y: Number(pos.y) || 0,
    };
    this.savePositions();
    return this.getHudPositions();
  }

  resetHudPositions() {
    this.hudPositions = {};
    this.savePositions();
    return {};
  }

  exportBundle() {
    return {
      schema: "dih-profile-v1",
      exportedAt: new Date().toISOString(),
      settings: this.getAll(),
      hudPositions: this.getHudPositions(),
    };
  }

  importBundle(payload) {
    if (!isPlainObject(payload)) throw new Error("Invalid profile JSON");
    const candidate = isPlainObject(payload.settings) ? payload.settings : payload;
    this.settings = deepMerge(DEFAULT_SETTINGS, candidate);
    this.save();
    if (isPlainObject(payload.hudPositions)) {
      this.hudPositions = clone(payload.hudPositions);
      this.savePositions();
    }
    return this.getAll();
  }
}

module.exports = {
  SettingsStore,
  deepMerge,
};
