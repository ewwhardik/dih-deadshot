use serde_json::Value;

pub const CATALOG_CORE_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/catalog_core.json"));
pub const DIH_LOGO_SVG: &[u8] = include_bytes!("../../swap/promo/dih-logo.svg");
pub const SCOPE_DOT_SVG: &[u8] = include_bytes!("../../swap/presets/scope-dot.svg");
pub const SCOPE_MINIMAL_SVG: &[u8] = include_bytes!("../../swap/presets/scope-minimal.svg");
pub const SCOPE_RANGEFINDER_SVG: &[u8] = include_bytes!("../../swap/presets/scope-rangefinder.svg");

pub const GZ_OVERLAY_BUNDLE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/overlay_bundle.js.gz"));
pub const GZ_CATALOG_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/studio_catalog.js.gz"));
const GZ_STUDIO_HTML: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/studio_html.gz"));
const GZ_STUDIO_CSS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/studio_css.gz"));
const GZ_STUDIO_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/studio_js.gz"));

pub struct EmbeddedStudioAsset {
    pub bytes: &'static [u8],
    pub mime: &'static str,
    pub gzipped: bool,
}

pub fn resolve_embedded_studio_asset(rel: &str) -> Option<EmbeddedStudioAsset> {
    let clean = rel.trim_start_matches('/');
    match clean {
        "" | "studio.html" => Some(EmbeddedStudioAsset { bytes: GZ_STUDIO_HTML, mime: "text/html; charset=utf-8", gzipped: true }),
        "studio.css" => Some(EmbeddedStudioAsset { bytes: GZ_STUDIO_CSS, mime: "text/css; charset=utf-8", gzipped: true }),
        "catalog.js" => Some(EmbeddedStudioAsset { bytes: GZ_CATALOG_JS, mime: "application/javascript; charset=utf-8", gzipped: true }),
        "studio.js" => Some(EmbeddedStudioAsset { bytes: GZ_STUDIO_JS, mime: "application/javascript; charset=utf-8", gzipped: true }),
        "dih-icon.png" | "../assets/dih-icon.png" => Some(EmbeddedStudioAsset { bytes: DIH_LOGO_SVG, mime: "image/svg+xml", gzipped: false }),
        _ => None,
    }
}

pub fn parse_catalog() -> Value {
    serde_json::from_str(CATALOG_CORE_JSON).expect("Valid embedded catalog_core.json")
}

pub fn build_game_injection_script() -> String {
    r#"(function() {
  try {
    var u = new URL(window.location.href);
    var host = u.hostname;
    var ok = host === "deadshot.io" || host === "www.deadshot.io" || host === "127.0.0.1" || host === "localhost";
    if (!ok) return;
  } catch (e) { return; }
  // Do NOT monkeypatch HTMLCanvasElement.prototype.getContext; Deadshot's pkg-bootstrap integrity check
  // blocks modified getContext.toString() ("Couldn't load the game").
  if (!window.__DIH_EARLY_PERF__) {
    window.__DIH_EARLY_PERF__ = true;
    var earlyCfg = {};
    try { earlyCfg = JSON.parse(localStorage.getItem("__dih_early_perf") || "{}"); } catch(_) {}
    var dprScale = Number(earlyCfg.canvasDprScale);
    if (dprScale >= 0.5 && dprScale <= 1.5 && Math.abs(dprScale - 1) > 0.02) {
      var origDpr = Number(window.devicePixelRatio) || 1;
      try {
        Object.defineProperty(window, "devicePixelRatio", {
          get: function() { return Math.max(0.5, Math.min(2.5, origDpr * dprScale)); },
          configurable: true
        });
      } catch(_) {}
    }
  }
  function loadDihBundle() {
    if (window.__DIH_INJECTED__) return;
    var target = document.head || document.documentElement || document.body;
    if (!target) {
      document.addEventListener("DOMContentLoaded", loadDihBundle, { once: true });
      return;
    }
    window.__DIH_INJECTED__ = true;
    ["/__dih_catalog.js", "/__dih_bundle.js"].forEach(function(src) {
      var s = document.createElement("script");
      s.async = false;
      s.src = src;
      target.appendChild(s);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadDihBundle, { once: true });
  } else {
    loadDihBundle();
  }
})();"#.to_string()
}
