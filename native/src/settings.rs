use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub struct SettingsStore {
    settings_path: PathBuf,
    hud_path: PathBuf,
    defaults: Value,
    theme_presets: Value,
    current: Value,
    hud_positions: Value,
}

pub fn deep_merge(base: &Value, patch: &Value) -> Value {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            let mut merged = b.clone();
            for (k, v) in p {
                if let Some(existing) = merged.get(k) {
                    merged.insert(k.clone(), deep_merge(existing, v));
                } else {
                    merged.insert(k.clone(), v.clone());
                }
            }
            Value::Object(merged)
        }
        (_, p) => p.clone(),
    }
}

pub fn set_by_dot_path(target: &mut Value, dot_path: &str, value: Value) {
    let parts: Vec<&str> = dot_path.split('.').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return;
    }
    let mut cur = target;
    for part in &parts[..parts.len() - 1] {
        if !cur.is_object() {
            *cur = Value::Object(Map::new());
        }
        let obj = cur.as_object_mut().unwrap();
        cur = obj.entry((*part).to_string()).or_insert_with(|| Value::Object(Map::new()));
    }
    if !cur.is_object() {
        *cur = Value::Object(Map::new());
    }
    cur.as_object_mut()
        .unwrap()
        .insert(parts[parts.len() - 1].to_string(), value);
}

impl SettingsStore {
    pub fn load(user_data_dir: &Path, catalog_root: &Value) -> Self {
        let _ = fs::create_dir_all(user_data_dir);
        let settings_path = user_data_dir.join("dih-settings.json");
        let hud_path = user_data_dir.join("dih-hud-positions.json");

        let defaults = catalog_root
            .get("DEFAULT_SETTINGS")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let theme_presets = catalog_root
            .get("THEME_PRESETS")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));

        let mut current = fs::read_to_string(&settings_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .map(|saved| deep_merge(&defaults, &saved))
            .unwrap_or_else(|| defaults.clone());

        if let Some(mode) = current.pointer("/performance/presetMode").and_then(|v| v.as_str()) {
            let mapped = match mode {
                "uncapped_esports" => Some("max_compute"),
                "balanced_native" => Some("balanced"),
                _ => None,
            };
            if let Some(m) = mapped {
                set_by_dot_path(&mut current, "performance.presetMode", Value::String(m.into()));
            }
        }

        // Normalize legacy low-opacity test override back to premium grey-white slate
        if current.pointer("/theme/surface").and_then(|v| v.as_str()) == Some("#0033ff") {
            if let Some(def_theme) = defaults.get("theme").cloned() {
                set_by_dot_path(&mut current, "theme", def_theme);
            }
        }

        let hud_positions = fs::read_to_string(&hud_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| Value::Object(Map::new()));

        let store = Self {
            settings_path,
            hud_path,
            defaults,
            theme_presets,
            current,
            hud_positions,
        };
        store.save();
        store
    }

    pub fn save(&self) {
        if let Ok(txt) = serde_json::to_string_pretty(&self.current) {
            let _ = fs::write(&self.settings_path, txt);
        }
    }

    fn save_hud(&self) {
        if let Ok(txt) = serde_json::to_string_pretty(&self.hud_positions) {
            let _ = fs::write(&self.hud_path, txt);
        }
    }

    pub fn get_all(&self) -> Value {
        self.current.clone()
    }

    pub fn set_setting(&mut self, dot_path: &str, value: Value) -> Value {
        set_by_dot_path(&mut self.current, dot_path, value);
        if dot_path == "theme.accent" || dot_path == "corsair.syncWithTheme" {
            let sync = self
                .current
                .pointer("/corsair/syncWithTheme")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if sync {
                if let Some(accent) = self.current.pointer("/theme/accent").cloned() {
                    set_by_dot_path(&mut self.current, "corsair.primaryColor", accent);
                }
            }
        }
        self.save();
        self.current.clone()
    }

    pub fn update_settings(&mut self, patch: &Value) -> Value {
        self.current = deep_merge(&self.current, patch);
        self.save();
        self.current.clone()
    }

    pub fn apply_theme_preset(&mut self, preset_key: &str) -> Value {
        if let Some(preset) = self.theme_presets.get(preset_key) {
            if let Some(theme_obj) = self.current.get_mut("theme").and_then(|v| v.as_object_mut()) {
                theme_obj.insert("preset".to_string(), Value::String(preset_key.to_string()));
                if let Some(p_obj) = preset.as_object() {
                    for (k, v) in p_obj {
                        theme_obj.insert(k.clone(), v.clone());
                    }
                }
            }
            let sync = self
                .current
                .pointer("/corsair/syncWithTheme")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if sync {
                if let Some(accent) = self.current.pointer("/theme/accent").cloned() {
                    set_by_dot_path(&mut self.current, "corsair.primaryColor", accent);
                }
            }
            self.save();
        }
        self.current.clone()
    }

    pub fn apply_perf_preset(&mut self, mode: &str) -> Value {
        let canonical = match mode {
            "uncapped_esports" | "max_compute" => "max_compute",
            "balanced_native" | "balanced" => "balanced",
            "low_end" => "low_end",
            other => other,
        };
        if let Some(perf) = self.current.get_mut("performance").and_then(|v| v.as_object_mut()) {
            perf.insert("presetMode".to_string(), Value::String(canonical.to_string()));
            match canonical {
                "max_compute" => {
                    perf.insert("disableFrameRateLimit".into(), Value::Bool(true));
                    perf.insert("disableGpuVsync".into(), Value::Bool(true));
                    perf.insert("forceHighPerformanceGpu".into(), Value::Bool(true));
                    perf.insert("enableGpuRasterization".into(), Value::Bool(true));
                    perf.insert("enableZeroCopy".into(), Value::Bool(true));
                    perf.insert("antiBackgroundThrottle".into(), Value::Bool(true));
                    perf.insert("ignoreGpuBlocklist".into(), Value::Bool(true));
                    perf.insert("noBackdropBlurHud".into(), Value::Bool(true));
                    perf.insert("lowLatencyTimer".into(), Value::Bool(true));
                    perf.insert("preventSleep".into(), Value::Bool(true));
                    perf.insert("disablePowerThrottling".into(), Value::Bool(true));
                    perf.insert("processPriority".into(), Value::String("high".into()));
                    perf.insert("angleBackend".into(), Value::String("d3d11".into()));
                    perf.insert("gpuCachePrewarm".into(), Value::Bool(true));
                    perf.insert("softwareFpsCap".into(), serde_json::json!(0));
                    perf.insert("webviewMemoryMode".into(), Value::String("normal".into()));
                    perf.insert("jsHeapLimitMb".into(), serde_json::json!(4096));
                    perf.insert("hostRamTargetMb".into(), serde_json::json!(12));
                    perf.insert("autoHostRamGuard".into(), Value::Bool(true));
                    perf.insert("enablePriorityBoost".into(), Value::Bool(true));
                    perf.insert("disableSmoothScrolling".into(), Value::Bool(true));
                    perf.insert("webglLowLatency".into(), Value::Bool(true));
                    perf.insert("canvasDprScale".into(), serde_json::json!(1.0));
                    perf.insert("reduceMotionUi".into(), Value::Bool(false));
                }
                "balanced" => {
                    perf.insert("disableFrameRateLimit".into(), Value::Bool(true));
                    perf.insert("disableGpuVsync".into(), Value::Bool(false));
                    perf.insert("forceHighPerformanceGpu".into(), Value::Bool(true));
                    perf.insert("enableGpuRasterization".into(), Value::Bool(true));
                    perf.insert("enableZeroCopy".into(), Value::Bool(true));
                    perf.insert("antiBackgroundThrottle".into(), Value::Bool(true));
                    perf.insert("ignoreGpuBlocklist".into(), Value::Bool(true));
                    perf.insert("noBackdropBlurHud".into(), Value::Bool(true));
                    perf.insert("lowLatencyTimer".into(), Value::Bool(true));
                    perf.insert("preventSleep".into(), Value::Bool(true));
                    perf.insert("disablePowerThrottling".into(), Value::Bool(true));
                    perf.insert("processPriority".into(), Value::String("above_normal".into()));
                    perf.insert("softwareFpsCap".into(), serde_json::json!(0));
                    perf.insert("webviewMemoryMode".into(), Value::String("normal".into()));
                    perf.insert("jsHeapLimitMb".into(), serde_json::json!(2048));
                    perf.insert("hostRamTargetMb".into(), serde_json::json!(12));
                    perf.insert("autoHostRamGuard".into(), Value::Bool(true));
                    perf.insert("enablePriorityBoost".into(), Value::Bool(true));
                    perf.insert("preferPerformanceCores".into(), Value::Bool(false));
                    perf.insert("webglLowLatency".into(), Value::Bool(true));
                    perf.insert("canvasDprScale".into(), serde_json::json!(0.95));
                    perf.insert("reduceMotionUi".into(), Value::Bool(false));
                }
                "low_end" => {
                    perf.insert("disableFrameRateLimit".into(), Value::Bool(true));
                    perf.insert("disableGpuVsync".into(), Value::Bool(false));
                    perf.insert("forceHighPerformanceGpu".into(), Value::Bool(false));
                    perf.insert("enableGpuRasterization".into(), Value::Bool(true));
                    perf.insert("enableZeroCopy".into(), Value::Bool(false));
                    perf.insert("antiBackgroundThrottle".into(), Value::Bool(false));
                    perf.insert("ignoreGpuBlocklist".into(), Value::Bool(false));
                    perf.insert("noBackdropBlurHud".into(), Value::Bool(true));
                    perf.insert("lowLatencyTimer".into(), Value::Bool(true));
                    perf.insert("preventSleep".into(), Value::Bool(false));
                    perf.insert("disablePowerThrottling".into(), Value::Bool(false));
                    perf.insert("processPriority".into(), Value::String("normal".into()));
                    perf.insert("softwareFpsCap".into(), serde_json::json!(60));
                    perf.insert("webviewMemoryMode".into(), Value::String("low".into()));
                    perf.insert("jsHeapLimitMb".into(), serde_json::json!(1024));
                    perf.insert("hostRamTargetMb".into(), serde_json::json!(10));
                    perf.insert("autoHostRamGuard".into(), Value::Bool(true));
                    perf.insert("enablePriorityBoost".into(), Value::Bool(false));
                    perf.insert("preferPerformanceCores".into(), Value::Bool(false));
                    perf.insert("webglLowLatency".into(), Value::Bool(true));
                    perf.insert("canvasDprScale".into(), serde_json::json!(0.8));
                    perf.insert("reduceMotionUi".into(), Value::Bool(true));
                }
                _ => {}
            }
            self.save();
        }
        self.current.clone()
    }

    pub fn reset_all(&mut self) -> Value {
        self.current = self.defaults.clone();
        self.save();
        self.current.clone()
    }

    pub fn get_hud_positions(&self) -> Value {
        self.hud_positions.clone()
    }

    pub fn set_hud_position(&mut self, widget_id: &str, pos: Value) -> Value {
        if let Some(obj) = self.hud_positions.as_object_mut() {
            obj.insert(widget_id.to_string(), pos);
        }
        self.save_hud();
        self.hud_positions.clone()
    }

    pub fn reset_hud_positions(&mut self) -> Value {
        self.hud_positions = Value::Object(Map::new());
        self.save_hud();
        self.hud_positions.clone()
    }

    pub fn save_skin_preset(&mut self, name: &str) -> Value {
        let weapons = self
            .current
            .pointer("/skins/weapons")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let extra = self
            .current
            .pointer("/skins/extraSwaps")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let entry = serde_json::json!({ "weapons": weapons, "extraSwaps": extra });
        set_by_dot_path(&mut self.current, &format!("skins.presets.{name}"), entry);
        set_by_dot_path(&mut self.current, "skins.activePresetName", Value::String(name.into()));
        self.save();
        self.current.clone()
    }

    pub fn apply_skin_preset(&mut self, name: &str) -> Value {
        if let Some(preset) = self.current.pointer(&format!("/skins/presets/{name}")).cloned() {
            if let Some(w) = preset.get("weapons") {
                set_by_dot_path(&mut self.current, "skins.weapons", w.clone());
            }
            if let Some(ex) = preset.get("extraSwaps") {
                set_by_dot_path(&mut self.current, "skins.extraSwaps", ex.clone());
            }
            set_by_dot_path(&mut self.current, "skins.activePresetName", Value::String(name.into()));
            self.save();
        }
        self.current.clone()
    }

    pub fn delete_skin_preset(&mut self, name: &str) -> Value {
        if let Some(presets) = self.current.pointer_mut("/skins/presets").and_then(|v| v.as_object_mut()) {
            presets.remove(name);
            self.save();
        }
        self.current.clone()
    }
}
