/**
 * Default configuration schema for Dih Client.
 * Grey, premium, minimalist aesthetic by default.
 * Tuned for zero compositor blur overhead during high-FPS WebGL rendering.
 */

const THEME_PRESETS = {
  obsidianSlate: {
    name: "Obsidian Slate",
    accent: "#d4d8df",
    surface: "#121317",
    elevated: "#1a1c22",
    textPrimary: "#f2f4f7",
    textSecondary: "#9097a3",
    border: "rgba(255, 255, 255, 0.085)",
    bgOpacity: 0.88,
    blurPx: 14,
    keyMove: "#d4d8df",
    keyAction: "#9ba3b0",
  },
  titaniumMist: {
    name: "Titanium Mist",
    accent: "#e6e8ec",
    surface: "#1b1d21",
    elevated: "#24272c",
    textPrimary: "#ffffff",
    textSecondary: "#a7adb8",
    border: "rgba(255, 255, 255, 0.11)",
    bgOpacity: 0.86,
    blurPx: 16,
    keyMove: "#e6e8ec",
    keyAction: "#adb4c0",
  },
  carbonStealth: {
    name: "Carbon Stealth",
    accent: "#9ca3b0",
    surface: "#0b0c0e",
    elevated: "#131519",
    textPrimary: "#e5e7eb",
    textSecondary: "#787f8c",
    border: "rgba(255, 255, 255, 0.065)",
    bgOpacity: 0.93,
    blurPx: 10,
    keyMove: "#b0b7c3",
    keyAction: "#787f8c",
  },
  platinumArctic: {
    name: "Platinum Frost",
    accent: "#f5f7fa",
    surface: "#17191d",
    elevated: "#202329",
    textPrimary: "#f8fafc",
    textSecondary: "#9ea5b0",
    border: "rgba(255, 255, 255, 0.14)",
    bgOpacity: 0.84,
    blurPx: 18,
    keyMove: "#f5f7fa",
    keyAction: "#cbd2dc",
  },
};

const DEFAULT_SETTINGS = {
  clientName: "Dih",
  firstLaunchComplete: true,
  hotkeys: {
    toggleGui: "RightShift",
    toggleGuiAlt: "o",
    hideAllHud: "F9",
    openStudio: "F7",
    screenshot: "F10",
    muteMaster: "F8",
    stopwatchToggle: "b",
    quickReload: "F5",
  },
  performance: {
    disableFrameRateLimit: true,
    disableGpuVsync: true,
    forceHighPerformanceGpu: true,
    enableGpuRasterization: true,
    enableZeroCopy: true,
    antiBackgroundThrottle: true,
    ignoreGpuBlocklist: true,
    disablePowerThrottling: true, // Disables Windows 11 Efficiency Mode / EcoQoS throttling
    angleBackend: "d3d11", // d3d11 | default | vulkan | gl | d3d11on12
    processPriority: "high", // normal | above_normal | high
    softwareFpsCap: 0, // 0 = uncapped native, >0 = target FPS limiter
    lowLatencyTimer: true, // Win32 timeBeginPeriod(1)
    preventSleep: true, // Win32 SetThreadExecutionState
    noBackdropBlurHud: true, // Prevents Chromium GPU blur copy stall over 2000FPS WebGL
    gpuCachePrewarm: true,
    hostRamTargetMb: 12, // Keep native Dih.exe host working set compact inside 10-15 MB
    autoHostRamGuard: true, // Softly guards host RAM without paging active GPU/WebGL memory
    webviewMemoryMode: "normal", // normal (Max Compute keep-hot) | low (Low-End Device footprint)
    jsHeapLimitMb: 4096, // 512 | 1024 | 2048 | 4096 MB V8 heap ceiling
    presetMode: "max_compute", // max_compute (default) | balanced | low_end
  },
  network: {
    lowLatencyNetworking: true, // Stops Edge background updater/telemetry traffic spikes
    quicTransport: true, // Enables HTTP/3 QUIC transport for faster asset fetches
    customDnsPreset: "system", // system | cloudflare | google | quad9 (DNS-over-HTTPS)
    pingHost: "deadshot.io",
    livePingProbe: true, // Non-blocking background TCP RTT & jitter probe
  },
  window: {
    autoFullscreen: false,
    borderlessMaximized: false,
    alwaysOnTop: false,
    opacity: 1.0,
    hardwareAcceleration: true,
    adblockerEnabled: true,
    discordRpcEnabled: true,
    discordPrivacyMode: false,
    userAgentStealth: true,
  },
  theme: {
    preset: "obsidianSlate",
    ...THEME_PRESETS.obsidianSlate,
    customCssEnabled: true,
    minimalistGameUi: true,
    compactCornerRadius: 10,
    density: "cozy", // cozy | compact
  },
  hud: {
    enabled: true,
    statsEnabled: true,
    statsLayout: "compact_card", // compact_card | top_bar | minimal_pill
    showFps: true,
    fpsColorCoded: true,
    showMinMaxFps: true,
    showOnePercentLow: true,
    showFrameTime: true,
    showFrametimeGraph: true,
    showMonitorHz: true,
    showPing: true,
    showJitter: true,
    showCpu: true,
    showGpu: true,
    showRam: true,
    showClientRam: true,
    showSens: true,
    showFov: true,
    showTime: true,
    showDate: false,
    showUptime: true,
    watermarkEnabled: true,
    watermarkText: "DIH CLIENT",
    watermarkOpacity: 0.42,
    keysOverlayEnabled: false,
    keysShowCps: true,
    keysShowMouseVector: false,
    kdTrackerEnabled: false,
    sessionKpmEnabled: true,
    stopwatchEnabled: false,
    warmupTimerEnabled: false,
    warmupDurationSec: 180,
    reactionWidgetEnabled: false,
    mouseDpi: 800,
    compactKeybindsHint: false,
    mediaWidgetEnabled: false,
    companionGifEnabled: false,
    companionGifPath: "",
    companionGifScale: 0.65,
    companionGifOpacity: 0.92,
    snapToGrid: true,
    streamerPrivacyBlur: false,
  },
  crosshair: {
    enabled: false,
    type: "CrossDot", // Dot | Cross | CrossDot | Circle | CircleDot | XShaped | TCross | Chevron | Brackets | Custom
    color: "#f2f4f7",
    outlineEnabled: true,
    outlineColor: "#0a0b0d",
    outlineWidth: 1.5,
    size: 14,
    thickness: 2,
    gap: 4,
    dotSize: 2.5,
    opacity: 0.95,
    rotation: 0,
    hideOnAds: true,
    shrinkOnAds: false,
    recoilBloom: true,
    hitFlashOnShot: false,
    hitFlashColor: "#ffffff",
    tacticalTicks: false,
    mixBlendInvert: false,
    customSvgOrUrl: "",
    perWeaponProfiles: false,
    weaponProfiles: {
      slot1: "CrossDot",
      slot2: "Dot",
      slot3: "CircleDot",
    },
  },
  skins: {
    swapperEnabled: true,
    syncSmallIcons: true,
    syncMobileVariants: true,
    activePresetName: "Custom Loadout",
    weapons: {
      ar: { mode: "default", officialId: "default", wear: 0, customFile: "" },
      smg: { mode: "default", officialId: "default", wear: 0, customFile: "" },
      awp: { mode: "default", officialId: "default", wear: 0, customFile: "" },
      shotgun: { mode: "default", officialId: "default", wear: 0, customFile: "" },
      dmr: { mode: "default", officialId: "default", wear: 0, customFile: "" },
      pistol: { mode: "default", officialId: "default", wear: 0, customFile: "" },
      lmg: { mode: "default", officialId: "default", wear: 0, customFile: "" },
    },
    extraSwaps: {
      scope: "default", // default | dih_minimal | dih_dot | dih_rangefinder | custom
      logo: "dih_grey", // default | dih_grey | custom
      skybox: "default", // default | dih_graphite | dih_slate | custom
    },
    presets: {},
  },
  corsair: {
    enabled: true,
    openRgbHost: "127.0.0.1",
    openRgbPort: 6742,
    autoConnectOpenRgb: true,
    webHidEnabled: true,
    mode: "reactive_tactical", // static_slate | breathing | spectrum | fps_thermal | ping_health | reactive_tactical | audio_pulse | ads_focus | reload_sweep | keymap_zones
    primaryColor: "#d4d8df",
    secondaryColor: "#4b515c",
    fireFlashColor: "#ffffff",
    adsColor: "#7ea8ff",
    reloadColor: "#e2b866",
    lowFpsColor: "#d96464",
    highFpsColor: "#58c98a",
    brightness: 85,
    speed: 1.0,
    highlightWasd: true,
    flashOnShoot: true,
    dimOnAds: true,
    syncWithTheme: true,
  },
  visuals: {
    filterEnabled: false,
    brightness: 100,
    contrast: 105,
    saturation: 112,
    hueRotate: 0,
    sepia: 0,
    grayscale: 0,
    sharpnessBoost: false,
    blueLightShield: false,
    preset: "clean", // clean | esports_vibrance | crisp_clarity | noir_slate | night_shield
    scopeVignetteEnhancer: false,
  },
  audio: {
    masterMuted: false,
    clientFeedbackVolume: 0.45,
    playClientKillTone: false,
    playClientHeadshotTone: false,
    audioLimiterEnabled: false,
  },
  deadshotSync: {
    autoSyncOnLoad: false,
    targetFov: null,
    targetRenderScale: null,
    targetAntialias: null,
    hideNativeCrosshair: false,
  },
};

module.exports = {
  THEME_PRESETS,
  DEFAULT_SETTINGS,
};
