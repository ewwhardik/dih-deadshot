use serde_json::Value;
use std::path::PathBuf;

pub const CATALOG_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/catalog.json"));
pub const DIH_LOGO_SVG: &[u8] = include_bytes!("../../swap/promo/dih-logo.svg");
pub const SCOPE_DOT_SVG: &[u8] = include_bytes!("../../swap/presets/scope-dot.svg");
pub const SCOPE_MINIMAL_SVG: &[u8] = include_bytes!("../../swap/presets/scope-minimal.svg");
pub const SCOPE_RANGEFINDER_SVG: &[u8] = include_bytes!("../../swap/presets/scope-rangefinder.svg");

const STYLES_CSS: &str = include_str!("../../src/renderer/styles.css");
const MOD_UTILS: &str = include_str!("../../src/renderer/utils.js");
const MOD_TELEMETRY: &str = include_str!("../../src/renderer/telemetryHud.js");
const MOD_KEYS: &str = include_str!("../../src/renderer/keysOverlay.js");
const MOD_CROSSHAIR: &str = include_str!("../../src/renderer/crosshairEngine.js");
const MOD_EXTRA: &str = include_str!("../../src/renderer/extraOverlays.js");
const MOD_FILTER: &str = include_str!("../../src/renderer/filterEngine.js");
const MOD_CORSAIR: &str = include_str!("../../src/renderer/corsairReactive.js");
const MOD_LEADERBOARD: &str = include_str!("../../src/renderer/leaderboardModal.js");
const MOD_CMD: &str = include_str!("../../src/renderer/commandCenter.js");
const MOD_MAIN: &str = include_str!("../../src/renderer/overlayMain.js");

pub fn parse_catalog() -> Value {
    serde_json::from_str(CATALOG_JSON).expect("Valid embedded catalog.json")
}

pub fn build_game_injection_script() -> String {
    let css_literal = serde_json::to_string(STYLES_CSS).unwrap();
    let combined_js = [
        MOD_UTILS,
        MOD_TELEMETRY,
        MOD_KEYS,
        MOD_CROSSHAIR,
        MOD_EXTRA,
        MOD_FILTER,
        MOD_CORSAIR,
        MOD_LEADERBOARD,
        MOD_CMD,
        MOD_MAIN,
    ]
    .join("\n\n");

    format!(
        r#"(function() {{
  try {{
    var u = new URL(window.location.href);
    var host = u.hostname;
    var ok = host === "deadshot.io" || host === "www.deadshot.io" || host === "127.0.0.1" || host === "localhost";
    if (!ok) return;
  }} catch (e) {{ return; }}
  function startDihOverlay() {{
    if (window.__DIH_INJECTED__) return;
    if (!document.body && !document.documentElement) {{
      document.addEventListener("DOMContentLoaded", startDihOverlay, {{ once: true }});
      return;
    }}
    window.__DIH_INJECTED__ = true;
    const DIH_SHADOW_CSS = {css_literal};
    const DIH_NS = {{}};
    {combined_js}
    if (typeof DIH_NS.boot === "function") {{
      DIH_NS.boot(DIH_SHADOW_CSS);
    }}
  }}
  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", startDihOverlay, {{ once: true }});
  }} else {{
    startDihOverlay();
  }}
}})();"#
    )
}

pub fn resolve_studio_dir() -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("studio"));
            candidates.push(dir.join("..\\..\\src\\studio"));
            candidates.push(dir.join("..\\..\\..\\src\\studio"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("studio"));
        candidates.push(cwd.join("src").join("studio"));
        candidates.push(cwd.join("..\\src\\studio"));
    }
    for c in candidates {
        if c.join("studio.html").exists() {
            return c;
        }
    }
    PathBuf::from("src\\studio")
}
