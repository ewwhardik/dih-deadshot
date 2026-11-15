/**
 * Renderer -> Host Corsair Reactive Telemetry Bridge.
 * Streams input fire/ADS/reload triggers + live FPS/ping via Electron or Native WebView2.
 */

DIH_NS.createCorsairReactive = function createCorsairReactive(getSettings, getMetrics) {
  const api = DIH_NS.utils.getHostApi();
  let adsDown = false;

  window.addEventListener(
    "mousedown",
    (e) => {
      const s = getSettings();
      if (!s.corsair?.enabled) return;
      if (e.button === 0 && document.pointerLockElement) {
        api?.corsairUpdateTelemetry?.({ fired: true });
      } else if (e.button === 2) {
        adsDown = true;
        api?.corsairUpdateTelemetry?.({ adsActive: true });
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "mouseup",
    (e) => {
      if (e.button === 2 && adsDown) {
        adsDown = false;
        api?.corsairUpdateTelemetry?.({ adsActive: false });
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "keydown",
    (e) => {
      const s = getSettings();
      if (!s.corsair?.enabled) return;
      if (e.code === "KeyR" && document.pointerLockElement) {
        api?.corsairUpdateTelemetry?.({ reloaded: true });
      }
    },
    { passive: true }
  );

  const syncTimer = setInterval(() => {
    const s = getSettings();
    if (!s.corsair?.enabled) return;
    const m = typeof getMetrics === "function" ? getMetrics() : null;
    if (!m) return;
    api?.corsairUpdateTelemetry?.({
      fps: m.fps || 0,
      targetHz: Number(s.performance?.softwareFpsCap) > 0 ? Number(s.performance.softwareFpsCap) : (m.monitorHz || 75),
      pingMs: typeof m.pingMs === "number" ? m.pingMs : 0,
    });
  }, 600);

  return {
    destroy: () => clearInterval(syncTimer),
  };
};
