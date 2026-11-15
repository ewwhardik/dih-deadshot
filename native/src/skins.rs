use crate::bundle;
use crate::ffi;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

pub struct SkinManager {
    pub custom_skins_dir: PathBuf,
    pub user_swap_dir: PathBuf,
    pub asset_cache_dir: PathBuf,
    pub catalog: Value,
    mem_cache: Mutex<HashMap<String, Vec<u8>>>,
    in_flight: Arc<Mutex<HashSet<String>>>,
}

pub struct WebResourceBytes {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

fn sanitize_name(raw: &str) -> String {
    let clean: String = raw
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = clean.trim_matches('-');
    if trimmed.is_empty() {
        "custom-skin".to_string()
    } else {
        trimmed.chars().take(64).collect()
    }
}

pub fn mime_from_ext(path: &str) -> &'static str {
    let low = path.to_ascii_lowercase();
    if low.ends_with(".webp") {
        "image/webp"
    } else if low.ends_with(".svg") {
        "image/svg+xml"
    } else if low.ends_with(".png") {
        "image/png"
    } else if low.ends_with(".jpg") || low.ends_with(".jpeg") {
        "image/jpeg"
    } else if low.ends_with(".glb") {
        "model/gltf-binary"
    } else if low.ends_with(".wasm") {
        "application/wasm"
    } else if low.ends_with(".js") || low.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if low.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if low.ends_with(".json") {
        "application/json"
    } else {
        "application/octet-stream"
    }
}

fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let cleaned = rel.trim_start_matches('/').replace('\\', "/");
    if cleaned.contains("..") {
        return None;
    }
    Some(base.join(cleaned))
}

impl SkinManager {
    pub fn new(user_data_dir: &Path, catalog: Value) -> Self {
        let mgr = Self {
            custom_skins_dir: user_data_dir.join("custom-skins"),
            user_swap_dir: user_data_dir.join("swap"),
            asset_cache_dir: user_data_dir.join("asset-cache"),
            catalog,
            mem_cache: Mutex::new(HashMap::new()),
            in_flight: Arc::new(Mutex::new(HashSet::new())),
        };
        mgr.ensure_dirs();
        mgr
    }

    pub fn clear_mem_cache(&self) {
        if let Ok(mut g) = self.mem_cache.lock() {
            g.clear();
        }
    }

    fn read_cached_bytes(&self, cache_key: &str, path: &Path) -> Option<Vec<u8>> {
        if let Ok(g) = self.mem_cache.lock() {
            if let Some(hit) = g.get(cache_key) {
                return Some(hit.clone());
            }
        }
        let bytes = fs::read(path).ok()?;
        if bytes.len() <= 8 * 1024 * 1024 {
            if let Ok(mut g) = self.mem_cache.lock() {
                if g.len() >= 48 {
                    g.clear();
                }
                g.insert(cache_key.to_string(), bytes.clone());
            }
        }
        Some(bytes)
    }

    pub fn game_filter_patterns(&self) -> Vec<String> {
        let mut patterns = vec![
            "https://deadshot.io/promo/*".to_string(),
            "https://www.deadshot.io/promo/*".to_string(),
            "https://deadshot.io/images/scope.webp*".to_string(),
            "https://www.deadshot.io/images/scope.webp*".to_string(),
            "https://deadshot.io/weapons/*".to_string(),
            "https://www.deadshot.io/weapons/*".to_string(),
            "https://deadshot.io/__dih_custom/*".to_string(),
            "https://www.deadshot.io/__dih_custom/*".to_string(),
            "https://deadshot.io/__dih_cache/*".to_string(),
            "https://www.deadshot.io/__dih_cache/*".to_string(),
        ];
        if let Some(arr) = self.list_swap_files().as_array() {
            let mut dirs = BTreeSet::new();
            for item in arr {
                if let Some(s) = item.as_str() {
                    if let Some((top, _)) = s.split_once('/') {
                        if !top.is_empty() && !matches!(top, "promo" | "weapons" | "__dih_custom" | "__dih_cache") {
                            dirs.insert(top.to_string());
                        }
                    } else if !s.is_empty() {
                        dirs.insert(s.to_string());
                    }
                }
            }
            for top in dirs {
                patterns.push(format!("https://deadshot.io/{top}*"));
                patterns.push(format!("https://www.deadshot.io/{top}*"));
            }
        }
        patterns
    }

    pub fn trigger_async_cache_download(&self, rel_path: &str) {
        let clean = rel_path.trim_start_matches('/').to_string();
        let Some(dst) = safe_join(&self.asset_cache_dir, &clean) else {
            return;
        };
        if dst.exists() && dst.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            return;
        }
        {
            let mut inflight = self.in_flight.lock().unwrap();
            if inflight.contains(&clean) {
                return;
            }
            inflight.insert(clean.clone());
        }
        let inflight_ref = Arc::clone(&self.in_flight);
        std::thread::spawn(move || {
            if let Some(parent) = dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(buf) = ffi::https_get_deadshot(&clean, BROWSER_UA) {
                let _ = fs::write(&dst, &buf);
            }
            if let Ok(mut g) = inflight_ref.lock() {
                g.remove(&clean);
            }
        });
    }

    pub fn prewarm_configured_skins(&self, settings: &Value) {
        let Some(weapons) = settings.pointer("/skins/weapons").and_then(|v| v.as_object()) else {
            return;
        };
        for (weapon_id, cfg) in weapons {
            let mode = cfg.get("mode").and_then(|v| v.as_str()).unwrap_or("default");
            if mode == "official" {
                let official_id = cfg.get("officialId").and_then(|v| v.as_str()).unwrap_or("default");
                if official_id != "default" {
                    let wear = cfg.get("wear").and_then(|v| v.as_u64()).unwrap_or(0);
                    let target_rel = self.resolve_official_rel_path(official_id, weapon_id, wear);
                    self.trigger_async_cache_download(&target_rel);
                }
            }
        }
    }

    pub fn ensure_dirs(&self) {
        let _ = fs::create_dir_all(&self.custom_skins_dir);
        let _ = fs::create_dir_all(&self.user_swap_dir);
        let _ = fs::create_dir_all(&self.asset_cache_dir);
    }

    pub fn list_custom_skins(&self, origin: &str) -> Value {
        self.ensure_dirs();
        let mut items = Vec::new();
        if let Ok(rd) = fs::read_dir(&self.custom_skins_dir) {
            for ent in rd.flatten() {
                let p = ent.path();
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if !matches!(ext.as_str(), "webp" | "png" | "jpg" | "jpeg") {
                    continue;
                }
                let file_name = ent.file_name().to_string_lossy().to_string();
                let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("skin");
                let meta_path = self.custom_skins_dir.join(format!("{stem}.dihskin.json"));
                let meta: Value = fs::read_to_string(&meta_path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or(Value::Null);
                let size_bytes = ent.metadata().map(|m| m.len()).unwrap_or(0);
                let url = format!("{origin}/__dih_custom/{file_name}");
                items.push(json!({
                    "fileName": file_name,
                    "name": meta.get("name").and_then(|v| v.as_str()).unwrap_or(stem),
                    "weaponId": meta.get("weaponId").and_then(|v| v.as_str()).unwrap_or("ar"),
                    "author": meta.get("author").and_then(|v| v.as_str()).unwrap_or("You"),
                    "createdAt": meta.get("createdAt").and_then(|v| v.as_str()).unwrap_or(""),
                    "sizeBytes": size_bytes,
                    "bytes": size_bytes,
                    "customUrl": url,
                    "url": url,
                    "recipe": meta.get("recipe").cloned().unwrap_or(Value::Null),
                }));
            }
        }
        Value::Array(items)
    }

    pub fn list_swap_files(&self) -> Value {
        let mut out = Vec::new();
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            if let Ok(rd) = fs::read_dir(dir) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        walk(root, &p, out);
                    } else if let Ok(rel) = p.strip_prefix(root) {
                        out.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
        walk(&self.user_swap_dir, &self.user_swap_dir, &mut out);
        json!(out)
    }

    pub fn save_custom_skin(&self, payload: &Value) -> Result<Value, String> {
        self.ensure_dirs();
        let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("Custom-Skin");
        let weapon_id = payload.get("weaponId").and_then(|v| v.as_str()).unwrap_or("ar");
        let data_url = payload.get("dataUrl").and_then(|v| v.as_str()).ok_or("Missing dataUrl")?;

        let (ext, b64_part) = if let Some(rest) = data_url.strip_prefix("data:image/png;base64,") {
            ("png", rest)
        } else if let Some(rest) = data_url.strip_prefix("data:image/webp;base64,") {
            ("webp", rest)
        } else if let Some(idx) = data_url.find(";base64,") {
            ("webp", &data_url[idx + 8..])
        } else {
            return Err("Invalid base64 image dataUrl".into());
        };

        let bytes = B64.decode(b64_part).map_err(|e| e.to_string())?;
        let stem = format!("{}-{}", sanitize_name(name), ffi::chrono_like_timestamp());
        let file_name = format!("{stem}.{ext}");
        let file_path = self.custom_skins_dir.join(&file_name);
        fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;
        self.clear_mem_cache();

        let meta_path = self.custom_skins_dir.join(format!("{stem}.dihskin.json"));
        let meta = json!({
            "name": name,
            "weaponId": weapon_id,
            "author": "You",
            "createdAt": ffi::chrono_like_timestamp(),
            "recipe": payload.get("recipe").cloned().unwrap_or(Value::Null),
        });
        let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap());

        Ok(json!({
            "fileName": file_name,
            "name": name,
            "weaponId": weapon_id,
            "sizeBytes": bytes.len(),
            "customUrl": format!("https://studio.dih.local/__dih_custom/{file_name}"),
        }))
    }

    pub fn delete_custom_skin(&self, file_name: &str) -> bool {
        let Some(target) = safe_join(&self.custom_skins_dir, file_name) else {
            return false;
        };
        let mut ok = false;
        if target.exists() && fs::remove_file(&target).is_ok() {
            ok = true;
            self.clear_mem_cache();
            if let Some(stem) = target.file_stem().and_then(|s| s.to_str()) {
                let _ = fs::remove_file(self.custom_skins_dir.join(format!("{stem}.dihskin.json")));
            }
        }
        ok
    }

    pub fn import_skin_from_disk(&self, src: &str, weapon_id: &str) -> Result<Value, String> {
        self.ensure_dirs();
        let src_path = Path::new(src);
        let bytes = fs::read(src_path).map_err(|e| e.to_string())?;
        let ext = src_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("webp")
            .to_ascii_lowercase();
        let raw_stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("Imported");
        let stem = format!("{}-{}", sanitize_name(raw_stem), ffi::chrono_like_timestamp());
        let file_name = format!("{stem}.{ext}");
        fs::write(self.custom_skins_dir.join(&file_name), &bytes).map_err(|e| e.to_string())?;

        let meta_path = self.custom_skins_dir.join(format!("{stem}.dihskin.json"));
        let meta = json!({
            "name": raw_stem,
            "weaponId": weapon_id,
            "author": "Imported",
            "createdAt": ffi::chrono_like_timestamp(),
        });
        let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap());

        Ok(json!({
            "ok": true,
            "saved": {
                "fileName": file_name,
                "name": raw_stem,
                "weaponId": weapon_id,
                "sizeBytes": bytes.len(),
                "customUrl": format!("https://studio.dih.local/__dih_custom/{file_name}"),
            }
        }))
    }

    pub fn ensure_cached_deadshot_asset(&self, rel_path: &str) -> Result<PathBuf, String> {
        let clean = rel_path.trim_start_matches('/');
        let dst = safe_join(&self.asset_cache_dir, clean).ok_or("Invalid asset path")?;
        if dst.exists() && dst.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(dst);
        }
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let buf = ffi::https_get_deadshot(clean, BROWSER_UA)?;
        fs::write(&dst, &buf).map_err(|e| e.to_string())?;
        Ok(dst)
    }

    fn resolve_official_rel_path(&self, skin_id: &str, weapon_id: &str, wear: u64) -> String {
        let is_nowear = self
            .catalog
            .pointer("/OFFICIAL_SKINS")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|s| s.get("id").and_then(|x| x.as_str()) == Some(skin_id))
            })
            .and_then(|s| s.get("type").and_then(|x| x.as_str()))
            == Some("static_nowear");
        if is_nowear {
            format!("skins/compressed/{skin_id}{weapon_id}.webp")
        } else {
            let w = wear.min(4);
            format!("skins/compressed/{skin_id}{weapon_id}{w}.webp")
        }
    }

    pub fn resolve_web_request(&self, url: &str, settings: &Value) -> Option<WebResourceBytes> {
        let stripped = url.split('?').next().unwrap_or(url);
        let lower = stripped.to_ascii_lowercase();

        // 1. Direct Studio / Game custom skin thumbnail URLs
        if let Some(idx) = stripped.find("/__dih_custom/") {
            let file_name = &stripped[idx + "/__dih_custom/".len()..];
            if let Some(path) = safe_join(&self.custom_skins_dir, file_name) {
                if let Some(bytes) = self.read_cached_bytes(&format!("custom:{file_name}"), &path) {
                    return Some(WebResourceBytes {
                        bytes,
                        mime: mime_from_ext(file_name),
                    });
                }
            }
            return None;
        }

        // 2. Studio cached Deadshot asset proxy
        if let Some(idx) = stripped.find("/__dih_cache/") {
            let rel = &stripped[idx + "/__dih_cache/".len()..];
            if let Ok(path) = self.ensure_cached_deadshot_asset(rel) {
                if let Some(bytes) = self.read_cached_bytes(&format!("cache:{rel}"), &path) {
                    return Some(WebResourceBytes {
                        bytes,
                        mime: mime_from_ext(rel),
                    });
                }
            }
            return None;
        }

        // Only rewrite deadshot.io URLs from here down
        let rel_path = if let Some(rest) = lower
            .strip_prefix("https://deadshot.io/")
            .or_else(|| lower.strip_prefix("https://www.deadshot.io/"))
        {
            rest
        } else {
            return None;
        };

        // 3. Direct user swap directory override (<userData>/swap/<rel>)
        if let Some(override_file) = safe_join(&self.user_swap_dir, rel_path) {
            if override_file.is_file() {
                if let Some(bytes) = self.read_cached_bytes(&format!("swap:{rel_path}"), &override_file) {
                    return Some(WebResourceBytes {
                        bytes,
                        mime: mime_from_ext(rel_path),
                    });
                }
            }
        }

        let swapper_enabled = settings
            .pointer("/skins/swapperEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !swapper_enabled {
            return None;
        }

        // 4. Logo swap (centered 1400x300 Dih logo matching Deadshot aspect ratio)
        if rel_path == "promo/logo.webp" {
            let logo_mode = settings
                .pointer("/skins/extraSwaps/logo")
                .and_then(|v| v.as_str())
                .unwrap_or("dih_grey");
            if logo_mode == "dih_grey" {
                return Some(WebResourceBytes {
                    bytes: bundle::DIH_LOGO_SVG.to_vec(),
                    mime: "image/svg+xml",
                });
            }
        }

        // 5. Scope reticle swap
        if rel_path == "images/scope.webp" {
            let scope_mode = settings
                .pointer("/skins/extraSwaps/scope")
                .and_then(|v| v.as_str())
                .unwrap_or("default");
            let svg_bytes: Option<&[u8]> = match scope_mode {
                "dih_minimal" => Some(bundle::SCOPE_MINIMAL_SVG),
                "dih_dot" => Some(bundle::SCOPE_DOT_SVG),
                "dih_rangefinder" => Some(bundle::SCOPE_RANGEFINDER_SVG),
                _ => None,
            };
            if let Some(b) = svg_bytes {
                return Some(WebResourceBytes {
                    bytes: b.to_vec(),
                    mime: "image/svg+xml",
                });
            }
        }

        // 6. Weapon skins swap (weapons/<folder>/<name>comp[mobile|small].webp)
        let sync_small = settings
            .pointer("/skins/syncSmallIcons")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let sync_mobile = settings
            .pointer("/skins/syncMobileVariants")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if let Some(weapons_map) = self.catalog.get("WEAPONS").and_then(|v| v.as_object()) {
            for (weapon_id, meta) in weapons_map {
                let main_tex = meta.get("texture").and_then(|v| v.as_str()).unwrap_or("");
                let legacy_tex = meta.get("legacyTexture").and_then(|v| v.as_str()).unwrap_or("");
                let mob_tex = meta.get("mobileTexture").and_then(|v| v.as_str()).unwrap_or("");
                let small_tex = meta.get("smallTexture").and_then(|v| v.as_str()).unwrap_or("");

                let matches = rel_path == main_tex
                    || (!legacy_tex.is_empty() && rel_path == legacy_tex)
                    || (sync_mobile && rel_path == mob_tex)
                    || (sync_small && rel_path == small_tex);
                if !matches {
                    continue;
                }

                let cfg = settings.pointer(&format!("/skins/weapons/{weapon_id}"))?;
                let mode = cfg.get("mode").and_then(|v| v.as_str()).unwrap_or("default");
                if mode == "custom" {
                    let file_name = cfg.get("customFile").and_then(|v| v.as_str()).unwrap_or("");
                    if !file_name.is_empty() {
                        if let Some(p) = safe_join(&self.custom_skins_dir, file_name) {
                            if let Some(bytes) = self.read_cached_bytes(&format!("custom:{file_name}"), &p) {
                                return Some(WebResourceBytes {
                                    bytes,
                                    mime: mime_from_ext(file_name),
                                });
                            }
                        }
                    }
                } else if mode == "official" {
                    let official_id = cfg.get("officialId").and_then(|v| v.as_str()).unwrap_or("default");
                    if official_id != "default" {
                        let wear = cfg.get("wear").and_then(|v| v.as_u64()).unwrap_or(0);
                        let target_rel = self.resolve_official_rel_path(official_id, weapon_id, wear);
                        if let Some(cached_path) = safe_join(&self.asset_cache_dir, target_rel.trim_start_matches('/')) {
                            if cached_path.exists() && cached_path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                                if let Some(bytes) = self.read_cached_bytes(&format!("official:{target_rel}"), &cached_path) {
                                    return Some(WebResourceBytes {
                                        bytes,
                                        mime: "image/webp",
                                    });
                                }
                            } else {
                                // Never block the COM WebView2 UI thread waiting on HTTPS downloads.
                                self.trigger_async_cache_download(&target_rel);
                            }
                        }
                    }
                }
            }
        }

        None
    }
}
