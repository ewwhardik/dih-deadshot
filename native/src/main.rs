#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adblock;
mod bundle;
mod corsair;
mod discord_rpc;
mod ffi;
mod hw_analyzer;
mod inflate;
mod settings;
mod skins;

use crate::corsair::CorsairService;
use crate::discord_rpc::DiscordRpcService;
use crate::settings::SettingsStore;
use crate::skins::SkinManager;

use serde_json::{json, Value};
use std::ffi::c_void;
use std::fs;
use std::path::PathBuf;
use std::ptr;
use std::sync::{Arc, Mutex, RwLock};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2Controller,
    ICoreWebView2Controller2, ICoreWebView2Environment, ICoreWebView2_13, ICoreWebView2_19,
    ICoreWebView2_8,
    COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
};
use webview2_com::{
    wait_with_pump, AcceleratorKeyPressedEventHandler,
    AddScriptToExecuteOnDocumentCreatedCompletedHandler, CapturePreviewCompletedHandler,
    ClearBrowsingDataCompletedHandler, CoreWebView2EnvironmentOptions,
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    WebMessageReceivedEventHandler, WebResourceRequestedEventHandler,
};

use windows::core::{w, Error as WinError, Interface, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateSolidBrush, GetMonitorInfoW, MonitorFromWindow, HBRUSH, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, IStream, COINIT_APARTMENTTHREADED, STATFLAG_NONAME, STATSTG,
    STREAM_SEEK_SET,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryA};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows::Win32::UI::WindowsAndMessaging::{
    AdjustWindowRect, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    GetClientRect, GetMessageW, GetWindowLongPtrW, GetWindowPlacement, LoadImageW, MoveWindow,
    PostMessageW, PostQuitMessage, RegisterClassW, SendMessageW, SetWindowLongPtrW, SetWindowPos,
    ShowWindow, TranslateMessage, GWL_EXSTYLE, GWL_STYLE, HICON, HWND_NOTOPMOST, HWND_TOPMOST,
    ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTSIZE, LR_SHARED, MSG, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SW_SHOW,
    WINDOWPLACEMENT, WM_APP, WM_CLOSE, WM_DESTROY, WM_GETMINMAXINFO, WM_SETICON, WM_SIZE,
    WNDCLASSW, WS_EX_LAYERED, WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE,
};

const WM_APP_CORSAIR_FRAME: u32 = WM_APP + 1;
const WM_APP_RELOAD_GAME: u32 = WM_APP + 2;
const WM_APP_OPEN_STUDIO: u32 = WM_APP + 3;

struct AppState {
    user_data_dir: PathBuf,
    catalog: Value,
    settings: SettingsStore,
    settings_snap: Arc<RwLock<Value>>,
    skins: Arc<SkinManager>,
    corsair: Arc<CorsairService>,
    discord: Arc<DiscordRpcService>,
    main_hwnd: HWND,
    studio_hwnd: Option<HWND>,
    pending_studio_tab: String,
    pending_studio_weapon: String,
    dirty_skin_cache: bool,
    is_fullscreen: bool,
    applied_borderless_max: bool,
    saved_placement: WINDOWPLACEMENT,
    web_env: Option<ICoreWebView2Environment>,
    game_ctrl: Option<ICoreWebView2Controller>,
    game_wv: Option<ICoreWebView2>,
    studio_ctrl: Option<ICoreWebView2Controller>,
    studio_wv: Option<ICoreWebView2>,
}

type SharedApp = Arc<Mutex<AppState>>;

fn get_user_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("DIH_USER_DATA") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("dih-client");
    }
    PathBuf::from("dih-client-data")
}

fn enable_dark_titlebar(hwnd: HWND) {
    unsafe {
        if let Ok(dwm) = LoadLibraryA(windows::core::s!("dwmapi.dll")) {
            if let Some(proc) = GetProcAddress(dwm, windows::core::s!("DwmSetWindowAttribute")) {
                type DwmFn = unsafe extern "system" fn(HWND, u32, *const c_void, u32) -> i32;
                let func: DwmFn = std::mem::transmute(proc);
                let dark: i32 = 1;
                // DWMWA_USE_IMMERSIVE_DARK_MODE = 20
                let _ = func(hwnd, 20, &dark as *const i32 as *const c_void, 4);
            }
        }
    }
}

fn build_browser_args(perf: &Value, net: &Value) -> String {
    let mut args = vec![
        "--autoplay-policy=no-user-gesture-required".to_string(),
        "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling".to_string(),
    ];

    if net.get("lowLatencyNetworking").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--disable-background-networking".into());
        args.push("--disable-domain-reliability".into());
        args.push("--disable-component-update".into());
    }
    if net.get("quicTransport").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--enable-quic".into());
    }
    match net.get("customDnsPreset").and_then(|v| v.as_str()).unwrap_or("system") {
        "cloudflare" => {
            args.push("--dns-over-https-mode=secure".into());
            args.push("--dns-over-https-templates=https://cloudflare-dns.com/dns-query".into());
        }
        "google" => {
            args.push("--dns-over-https-mode=secure".into());
            args.push("--dns-over-https-templates=https://dns.google/dns-query".into());
        }
        "quad9" => {
            args.push("--dns-over-https-mode=secure".into());
            args.push("--dns-over-https-templates=https://dns.quad9.net/dns-query".into());
        }
        _ => {}
    }

    if perf.get("disableFrameRateLimit").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--disable-frame-rate-limit".into());
    }
    if perf.get("disableGpuVsync").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--disable-gpu-vsync".into());
    }
    if perf.get("forceHighPerformanceGpu").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--force-high-performance-gpu".into());
    }
    if perf.get("enableGpuRasterization").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--enable-gpu-rasterization".into());
    }
    if perf.get("enableZeroCopy").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--enable-zero-copy".into());
    }
    if perf.get("ignoreGpuBlocklist").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--ignore-gpu-blocklist".into());
    }
    if perf.get("antiBackgroundThrottle").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--disable-renderer-backgrounding".into());
        args.push("--disable-background-timer-throttling".into());
        args.push("--disable-backgrounding-occluded-windows".into());
    }
    if perf.get("disableSmoothScrolling").and_then(|v| v.as_bool()).unwrap_or(true) {
        args.push("--disable-smooth-scrolling".into());
    }
    if let Some(angle) = perf.get("angleBackend").and_then(|v| v.as_str()) {
        if angle != "default" && !angle.is_empty() {
            args.push(format!("--use-angle={angle}"));
        }
    }

    let js_heap = perf
        .get("jsHeapLimitMb")
        .and_then(|v| v.as_u64())
        .unwrap_or(4096)
        .clamp(512, 8192);
    args.push(format!("--js-flags=--max-old-space-size={js_heap}"));

    if perf.get("webviewMemoryMode").and_then(|v| v.as_str()) == Some("low") {
        args.push("--renderer-process-limit=1".into());
        args.push("--disk-cache-size=33554432".into());
        args.push("--media-cache-size=16777216".into());
    }

    args.join(" ")
}

fn post_json(wv: &ICoreWebView2, event_type: &str, payload: &Value) {
    let msg = json!({ "type": event_type, "payload": payload }).to_string();
    let w = HSTRING::from(msg);
    unsafe {
        let _ = wv.PostWebMessageAsJson(&w);
    }
}

fn post_rpc_response(wv: &ICoreWebView2, id: &Value, result: Result<Value, String>) {
    let msg = match result {
        Ok(res) => json!({ "type": "rpcResponse", "id": id, "result": res }),
        Err(err) => json!({ "type": "rpcResponse", "id": id, "error": err }),
    };
    let w = HSTRING::from(msg.to_string());
    unsafe {
        let _ = wv.PostWebMessageAsJson(&w);
    }
}

fn make_mem_stream(data: &[u8]) -> Option<IStream> {
    unsafe { SHCreateMemStream(Some(data)) }
}

fn apply_window_settings(app: &SharedApp) {
    let (hwnd, wv_opt, s, is_fs, was_bmax) = {
        let g = app.lock().unwrap();
        (
            g.main_hwnd,
            g.game_wv.clone(),
            g.settings.get_all(),
            g.is_fullscreen,
            g.applied_borderless_max,
        )
    };
    let win = s.get("window").cloned().unwrap_or(Value::Null);
    let perf = s.get("performance").cloned().unwrap_or(Value::Null);
    let net = s.get("network").cloned().unwrap_or(Value::Null);
    let audio = s.get("audio").cloned().unwrap_or(Value::Null);

    let always_top = win.get("alwaysOnTop").and_then(|v| v.as_bool()).unwrap_or(false);
    let bmax = win.get("borderlessMaximized").and_then(|v| v.as_bool()).unwrap_or(false);
    let opacity = win.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0).clamp(0.3, 1.0);
    let muted = audio.get("masterMuted").and_then(|v| v.as_bool()).unwrap_or(false);
    let low_lat = perf.get("lowLatencyTimer").and_then(|v| v.as_bool()).unwrap_or(true);
    let no_sleep = perf.get("preventSleep").and_then(|v| v.as_bool()).unwrap_or(true);
    let disable_throttling = perf.get("disablePowerThrottling").and_then(|v| v.as_bool()).unwrap_or(true);
    let prio = perf.get("processPriority").and_then(|v| v.as_str()).unwrap_or("high");
    let prio_boost = perf.get("enablePriorityBoost").and_then(|v| v.as_bool()).unwrap_or(true);
    let prefer_p_cores = perf.get("preferPerformanceCores").and_then(|v| v.as_bool()).unwrap_or(false);
    let ping_interval_ms = perf.get("pingIntervalMs").and_then(|v| v.as_u64()).unwrap_or(3500);
    let mem_mode = perf.get("webviewMemoryMode").and_then(|v| v.as_str()).unwrap_or("normal");
    let host_ram_target = perf.get("hostRamTargetMb").and_then(|v| v.as_f64()).unwrap_or(12.0);
    let auto_ram_guard = perf.get("autoHostRamGuard").and_then(|v| v.as_bool()).unwrap_or(true);

    let ping_host = net.get("pingHost").and_then(|v| v.as_str()).unwrap_or("deadshot.io");
    let live_ping_probe = net.get("livePingProbe").and_then(|v| v.as_bool()).unwrap_or(true);

    let mut wv_pid = 0u32;
    if let Some(ref wv) = wv_opt {
        unsafe {
            let _ = wv.BrowserProcessId(&mut wv_pid);
        }
    }

    ffi::set_ping_interval_ms(ping_interval_ms);
    ffi::configure_telemetry(ping_host, live_ping_probe, host_ram_target, auto_ram_guard, wv_pid);
    ffi::apply_runtime_perf(low_lat, no_sleep, prio, disable_throttling, wv_pid);
    hw_analyzer::apply_advanced_win32_perf(prio_boost, prefer_p_cores);

    unsafe {
        if !hwnd.0.is_null() {
            if !is_fs && bmax != was_bmax {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                if bmax {
                    let mut wp = WINDOWPLACEMENT {
                        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                        ..Default::default()
                    };
                    let _ = GetWindowPlacement(hwnd, &mut wp);
                    app.lock().unwrap().saved_placement = wp;
                    let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    let mut mi = MONITORINFO {
                        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                        ..Default::default()
                    };
                    if GetMonitorInfoW(mon, &mut mi).as_bool() {
                        SetWindowLongPtrW(
                            hwnd,
                            GWL_STYLE,
                            (style & !(WS_OVERLAPPEDWINDOW.0 as isize)) | (WS_POPUP.0 as isize),
                        );
                        let _ = SetWindowPos(
                            hwnd,
                            None,
                            mi.rcWork.left,
                            mi.rcWork.top,
                            mi.rcWork.right - mi.rcWork.left,
                            mi.rcWork.bottom - mi.rcWork.top,
                            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
                        );
                        app.lock().unwrap().applied_borderless_max = true;
                    }
                } else {
                    SetWindowLongPtrW(
                        hwnd,
                        GWL_STYLE,
                        (style & !(WS_POPUP.0 as isize)) | (WS_OVERLAPPEDWINDOW.0 as isize),
                    );
                    let saved = app.lock().unwrap().saved_placement;
                    let _ = SetWindowPos(
                        hwnd,
                        None,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
                    );
                    if saved.length > 0 {
                        let _ = windows::Win32::UI::WindowsAndMessaging::SetWindowPlacement(hwnd, &saved);
                    }
                    app.lock().unwrap().applied_borderless_max = false;
                }
            }

            let insert_after = if always_top { HWND_TOPMOST } else { HWND_NOTOPMOST };
            let _ = SetWindowPos(hwnd, Some(insert_after), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if opacity < 0.995 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | (WS_EX_LAYERED.0 as isize));
                let _ = windows::Win32::UI::WindowsAndMessaging::SetLayeredWindowAttributes(
                    hwnd,
                    COLORREF(0),
                    (opacity * 255.0).round() as u8,
                    windows::Win32::UI::WindowsAndMessaging::LWA_ALPHA,
                );
            } else if (ex & (WS_EX_LAYERED.0 as isize)) != 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !(WS_EX_LAYERED.0 as isize));
            }
        }

        if let Some(wv) = wv_opt {
            if let Ok(wv8) = wv.cast::<ICoreWebView2_8>() {
                let _ = wv8.SetIsMuted(muted);
            }
            if let Ok(wv19) = wv.cast::<ICoreWebView2_19>() {
                let level = if mem_mode == "low" {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                };
                let _ = wv19.SetMemoryUsageTargetLevel(level);
            }
        }
    }
}

fn toggle_fullscreen_hwnd(app: &SharedApp) {
    let mut g = app.lock().unwrap();
    let hwnd = g.main_hwnd;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if !g.is_fullscreen {
            let mut wp = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            let _ = GetWindowPlacement(hwnd, &mut wp);
            g.saved_placement = wp;
            let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(mon, &mut mi).as_bool() {
                SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_OVERLAPPEDWINDOW.0 as isize) | (WS_POPUP.0 as isize));
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    mi.rcMonitor.left,
                    mi.rcMonitor.top,
                    mi.rcMonitor.right - mi.rcMonitor.left,
                    mi.rcMonitor.bottom - mi.rcMonitor.top,
                    SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
                );
                g.is_fullscreen = true;
            }
        } else {
            SetWindowLongPtrW(hwnd, GWL_STYLE, (style & !(WS_POPUP.0 as isize)) | (WS_OVERLAPPEDWINDOW.0 as isize));
            let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
            let _ = windows::Win32::UI::WindowsAndMessaging::SetWindowPlacement(hwnd, &g.saved_placement);
            g.is_fullscreen = false;
        }
    }
}

fn capture_screenshot_blocking(app: &SharedApp) -> Result<Value, String> {
    let (wv_opt, shots_dir) = {
        let g = app.lock().unwrap();
        (g.game_wv.clone(), g.user_data_dir.join("screenshots"))
    };
    let wv = wv_opt.ok_or("Game WebView not initialized")?;
    let _ = fs::create_dir_all(&shots_dir);
    let file_path = shots_dir.join(format!("dih-shot-{}.png", ffi::chrono_like_timestamp()));

    unsafe {
        let stream: IStream = SHCreateMemStream(None).ok_or("SHCreateMemStream failed")?;
        let (tx, rx) = std::sync::mpsc::channel();
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |res| {
            let _ = tx.send(res);
            Ok(())
        }));
        wv.CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            &stream,
            &handler,
        )
        .map_err(|e| e.to_string())?;
        let _ = wait_with_pump(rx).map_err(|e| format!("{e:?}"))?;

        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME).map_err(|e| e.to_string())?;
        let size = stat.cbSize as usize;
        let _ = stream.Seek(0, STREAM_SEEK_SET, None);
        let mut buf = vec![0u8; size];
        let mut read = 0u32;
        let _ = stream.Read(buf.as_mut_ptr() as *mut c_void, size as u32, Some(&mut read));
        buf.truncate(read as usize);
        fs::write(&file_path, &buf).map_err(|e| e.to_string())?;
    }

    Ok(json!({
        "ok": true,
        "filePath": file_path.to_string_lossy(),
    }))
}

fn broadcast_settings(app: &SharedApp, updated: &Value) {
    let (gwv, swv, snap, skins) = {
        let g = app.lock().unwrap();
        (
            g.game_wv.clone(),
            g.studio_wv.clone(),
            Arc::clone(&g.settings_snap),
            Arc::clone(&g.skins),
        )
    };
    *snap.write().unwrap() = updated.clone();
    skins.prewarm_configured_skins(updated);
    if let Some(wv) = gwv {
        post_json(&wv, "settingsUpdated", updated);
    }
    if let Some(wv) = swv {
        post_json(&wv, "settingsUpdated", updated);
    }
}

fn handle_game_rpc(app: &SharedApp, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "getSettings" => Ok(app.lock().unwrap().settings.get_all()),
        "setSetting" => {
            let path = params.get("dotPath").and_then(|v| v.as_str()).unwrap_or("");
            let val = params.get("value").cloned().unwrap_or(Value::Null);
            let updated = {
                let mut g = app.lock().unwrap();
                let u = g.settings.set_setting(path, val);
                if path.starts_with("corsair") || path == "theme.accent" {
                    if let Some(c) = u.get("corsair") {
                        g.corsair.set_config(c.clone());
                    }
                }
                if path == "window.discordRpcEnabled"
                    || path == "window.discordPrivacyMode"
                    || path == "window.discordClientId"
                {
                    if let Some(w) = u.get("window") {
                        g.discord.set_config(w);
                    }
                }
                if path.starts_with("skins") {
                    g.skins.clear_mem_cache();
                    g.dirty_skin_cache = true;
                }
                u
            };
            apply_window_settings(app);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "updateSettings" => {
            let patch = params.get("patch").cloned().unwrap_or(Value::Null);
            let updated = {
                let mut g = app.lock().unwrap();
                let u = g.settings.update_settings(&patch);
                if let Some(c) = u.get("corsair") {
                    g.corsair.set_config(c.clone());
                }
                if patch.get("window").is_some() {
                    if let Some(w) = u.get("window") {
                        g.discord.set_config(w);
                    }
                }
                if patch.get("skins").is_some() {
                    g.skins.clear_mem_cache();
                    g.dirty_skin_cache = true;
                }
                u
            };
            apply_window_settings(app);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "applyThemePreset" => {
            let key = params.get("presetKey").and_then(|v| v.as_str()).unwrap_or("obsidianSlate");
            let updated = {
                let mut g = app.lock().unwrap();
                let u = g.settings.apply_theme_preset(key);
                if let Some(c) = u.get("corsair") {
                    g.corsair.set_config(c.clone());
                }
                u
            };
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "applyPerfPreset" => {
            let mode = params.get("mode").and_then(|v| v.as_str()).unwrap_or("max_compute");
            let updated = app.lock().unwrap().settings.apply_perf_preset(mode);
            apply_window_settings(app);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "resetAllSettings" => {
            let updated = app.lock().unwrap().settings.reset_all();
            apply_window_settings(app);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "exportProfile" => {
            let (hwnd, data) = {
                let g = app.lock().unwrap();
                (g.main_hwnd, g.settings.get_all())
            };
            let flt = ffi::wide_filter(&[("Dih Profile JSON", "*.json"), ("All Files", "*.*")]);
            if let Some(dest) = ffi::pick_save_file(hwnd, "dih-profile.json", &flt, "json", "Export Dih Profile") {
                let txt = serde_json::to_string_pretty(&data).unwrap();
                fs::write(&dest, txt).map_err(|e| e.to_string())?;
                Ok(json!({ "ok": true, "filePath": dest }))
            } else {
                Ok(json!({ "ok": false, "canceled": true }))
            }
        }
        "importProfile" => {
            let hwnd = app.lock().unwrap().main_hwnd;
            let flt = ffi::wide_filter(&[("Dih Profile JSON", "*.json"), ("All Files", "*.*")]);
            if let Some(src) = ffi::pick_open_file(hwnd, &flt, "Import Dih Profile") {
                let txt = fs::read_to_string(&src).map_err(|e| e.to_string())?;
                let parsed: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
                let updated = app.lock().unwrap().settings.update_settings(&parsed);
                apply_window_settings(app);
                broadcast_settings(app, &updated);
                Ok(json!({ "ok": true, "settings": updated }))
            } else {
                Ok(json!({ "ok": false, "canceled": true }))
            }
        }
        "getHudPositions" => Ok(app.lock().unwrap().settings.get_hud_positions()),
        "setHudPosition" => {
            let wid = params.get("widgetId").and_then(|v| v.as_str()).unwrap_or("");
            let pos = params.get("pos").cloned().unwrap_or(Value::Null);
            Ok(app.lock().unwrap().settings.set_hud_position(wid, pos))
        }
        "resetHudPositions" => Ok(app.lock().unwrap().settings.reset_hud_positions()),
        "getCatalog" => Ok(app.lock().unwrap().catalog.clone()),
        "getStaticHardware" => Ok(ffi::get_static_hardware()),
        "getLiveMetrics" => Ok(ffi::get_live_metrics()),
        "probePing" => Ok(ffi::probe_deadshot_latency()),
        "runHardwareAnalysis" => {
            let apply = params.get("applyRecommended").and_then(|v| v.as_bool()).unwrap_or(false);
            let hw = ffi::get_static_hardware();
            let analysis = hw_analyzer::analyze_hardware_power(&hw);
            let updated = if apply {
                let tier_preset = analysis["recommendedPreset"].as_str().unwrap_or("max_compute");
                let rec = analysis.get("recommendations").cloned().unwrap_or(Value::Null);
                let mut g = app.lock().unwrap();
                let _ = g.settings.apply_perf_preset(tier_preset);
                g.settings.update_settings(&json!({
                    "performance": {
                        "canvasDprScale": rec["canvasDprScale"].as_f64().unwrap_or(1.0),
                        "reduceMotionUi": rec["reduceMotionUi"].as_bool().unwrap_or(false),
                        "hostRamTargetMb": rec["hostRamTargetMb"].as_u64().unwrap_or(12),
                        "preferPerformanceCores": rec["preferPerformanceCores"].as_bool().unwrap_or(false),
                        "disablePowerThrottling": rec["disablePowerThrottling"].as_bool().unwrap_or(true),
                    },
                    "autoTune": {
                        "completed": true,
                        "lastScore": analysis["powerScore"].as_i64().unwrap_or(75),
                        "recommendedTier": analysis["tier"].as_str().unwrap_or("esports_desktop"),
                        "detectedSummary": analysis["detectedSummary"].as_str().unwrap_or(""),
                    }
                }))
            } else {
                app.lock().unwrap().settings.update_settings(&json!({
                    "autoTune": {
                        "lastScore": analysis["powerScore"].as_i64().unwrap_or(75),
                        "recommendedTier": analysis["tier"].as_str().unwrap_or("esports_desktop"),
                        "detectedSummary": analysis["detectedSummary"].as_str().unwrap_or(""),
                    }
                }))
            };
            if apply {
                apply_window_settings(app);
            }
            broadcast_settings(app, &updated);
            Ok(json!({ "analysis": analysis, "settings": updated }))
        }
        "setMasterMute" => {
            let muted = params.get("muted").and_then(|v| v.as_bool()).unwrap_or(false);
            let updated = app.lock().unwrap().settings.set_setting("audio.masterMuted", Value::Bool(muted));
            apply_window_settings(app);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "setAlwaysOnTop" => {
            let flag = params.get("flag").and_then(|v| v.as_bool()).unwrap_or(false);
            let updated = app.lock().unwrap().settings.set_setting("window.alwaysOnTop", Value::Bool(flag));
            apply_window_settings(app);
            Ok(updated)
        }
        "setWindowOpacity" => {
            let op = params.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0);
            let updated = app.lock().unwrap().settings.set_setting("window.opacity", json!(op));
            apply_window_settings(app);
            Ok(updated)
        }
        "toggleFullscreen" => {
            toggle_fullscreen_hwnd(app);
            Ok(json!({ "ok": true }))
        }
        "clearCache" => {
            let (cache_dir, wv_opt, skins) = {
                let g = app.lock().unwrap();
                (g.skins.asset_cache_dir.clone(), g.game_wv.clone(), Arc::clone(&g.skins))
            };
            skins.clear_mem_cache();
            let _ = fs::remove_dir_all(&cache_dir);
            let _ = fs::create_dir_all(&cache_dir);
            if let Some(wv) = wv_opt {
                if let Ok(wv13) = wv.cast::<ICoreWebView2_13>() {
                    if let Ok(prof) = unsafe { wv13.Profile() } {
                        if let Ok(prof2) = prof.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Profile2>() {
                            let h = ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(())));
                            unsafe {
                                let _ = prof2.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &h);
                            }
                        }
                    }
                }
            }
            Ok(json!({ "ok": true }))
        }
        "trimMemory" => Ok(ffi::trim_working_set()),
        "reloadGame" | "reloadGameWindow" => {
            let hwnd = app.lock().unwrap().main_hwnd;
            unsafe {
                let _ = PostMessageW(Some(hwnd), WM_APP_RELOAD_GAME, WPARAM(0), LPARAM(0));
            }
            Ok(json!({ "ok": true }))
        }
        "relaunchApp" => {
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(exe).spawn();
                std::process::exit(0);
            }
            Ok(json!({ "ok": true }))
        }
        "captureScreenshot" => capture_screenshot_blocking(app),
        "openFolders" => {
            let dir = app.lock().unwrap().skins.custom_skins_dir.clone();
            ffi::open_folder(&dir);
            Ok(json!({ "customSkinsDir": dir.to_string_lossy() }))
        }
        "openExternal" => {
            if let Some(u) = params.get("url").and_then(|v| v.as_str()) {
                if u.starts_with("https://") || u.starts_with("http://") {
                    ffi::shell_open_target(u);
                    return Ok(json!({ "ok": true }));
                }
            }
            Ok(json!({ "ok": false }))
        }
        "exportDiagnostics" => {
            let g = app.lock().unwrap();
            let diag = json!({
                "client": "Dih Native Client (Rust + Win32 + WebView2)",
                "version": "0.4.1",
                "author": "ewwhardik (GitHub & Discord: ewwhardik)",
                "hardware": ffi::get_static_hardware(),
                "liveMetrics": ffi::get_live_metrics(),
                "corsair": g.corsair.get_status(),
                "clientSnapshot": params.get("clientSnapshot").cloned().unwrap_or(Value::Null),
            });
            let out_path = g.user_data_dir.join(format!("dih-diagnostics-{}.json", ffi::chrono_like_timestamp()));
            fs::write(&out_path, serde_json::to_string_pretty(&diag).unwrap()).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "filePath": out_path.to_string_lossy() }))
        }
        "listCustomSkins" => Ok(app.lock().unwrap().skins.list_custom_skins("https://deadshot.io")),
        "saveCustomSkin" => rpc_save_custom_skin(app, params),
        "listSwapFiles" => Ok(app.lock().unwrap().skins.list_swap_files()),
        "rescanSwapFiles" => {
            let mut g = app.lock().unwrap();
            g.skins.rescan_swap_index();
            g.skins.clear_mem_cache();
            g.dirty_skin_cache = true;
            Ok(g.skins.list_swap_files())
        }
        "saveSkinPreset" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("Preset");
            let updated = app.lock().unwrap().settings.save_skin_preset(name);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "applySkinPreset" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("Preset");
            let updated = app.lock().unwrap().settings.apply_skin_preset(name);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "deleteSkinPreset" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let updated = app.lock().unwrap().settings.delete_skin_preset(name);
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "openStudio" => {
            let tab = params.get("tab").and_then(|v| v.as_str()).unwrap_or("corsair").to_string();
            let weapon = params.get("weapon").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let hwnd = {
                let mut g = app.lock().unwrap();
                g.pending_studio_tab = tab;
                g.pending_studio_weapon = weapon;
                g.main_hwnd
            };
            unsafe {
                let _ = PostMessageW(Some(hwnd), WM_APP_OPEN_STUDIO, WPARAM(0), LPARAM(0));
            }
            Ok(json!({ "ok": true }))
        }
        "getCorsairStatus" => Ok(app.lock().unwrap().corsair.get_status()),
        "rescanCorsair" => Ok(app.lock().unwrap().corsair.rescan_hardware()),
        "connectOpenRgb" => {
            let host = params.get("host").and_then(|v| v.as_str()).unwrap_or("127.0.0.1");
            let port = params.get("port").and_then(|v| v.as_u64()).unwrap_or(6742) as u16;
            Ok(app.lock().unwrap().corsair.connect_openrgb(host, port))
        }
        "getDiscordStatus" => Ok(app.lock().unwrap().discord.get_status()),
        "reconnectDiscordRpc" => Ok(app.lock().unwrap().discord.reconnect()),
        _ => Err(format!("Unknown RPC method: {method}")),
    }
}

fn rpc_save_custom_skin(app: &SharedApp, params: &Value) -> Result<Value, String> {
    let apply_now = params.get("applyImmediately").and_then(|v| v.as_bool()).unwrap_or(false);
    let weapon_id = params.get("weaponId").and_then(|v| v.as_str()).unwrap_or("ar").to_string();
    let saved = app.lock().unwrap().skins.save_custom_skin(params)?;
    if apply_now {
        let file_name = saved.get("fileName").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let updated = {
            let mut g = app.lock().unwrap();
            g.skins.clear_mem_cache();
            g.dirty_skin_cache = true;
            g.settings.set_setting("skins.swapperEnabled", Value::Bool(true));
            g.settings.set_setting(
                &format!("skins.weapons.{weapon_id}"),
                json!({ "mode": "custom", "officialId": "default", "wear": 0, "customFile": file_name }),
            )
        };
        broadcast_settings(app, &updated);
    }
    Ok(saved)
}

fn handle_studio_rpc(app: &SharedApp, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "getInitBundle" => {
            let g = app.lock().unwrap();
            Ok(json!({
                "settings": g.settings.get_all(),
                "catalog": g.catalog,
                "customSkins": g.skins.list_custom_skins("https://studio.dih.local"),
                "hardware": ffi::get_static_hardware(),
                "corsair": g.corsair.get_status(),
            }))
        }
        "listCustomSkins" => Ok(app.lock().unwrap().skins.list_custom_skins("https://studio.dih.local")),
        "ensureDeadshotAsset" => {
            let rel = params.get("relPath").and_then(|v| v.as_str()).ok_or("Missing relPath")?;
            let path = app.lock().unwrap().skins.ensure_cached_deadshot_asset(rel)?;
            let clean = rel.trim_start_matches('/');
            Ok(json!({
                "ok": true,
                "path": path.to_string_lossy(),
                "customUrl": format!("https://studio.dih.local/__dih_cache/{clean}"),
            }))
        }
        "saveCustomSkin" => rpc_save_custom_skin(app, params),
        "deleteCustomSkin" => {
            let fname = params.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
            Ok(json!(app.lock().unwrap().skins.delete_custom_skin(fname)))
        }
        "importSkinFile" => {
            let hwnd = {
                let g = app.lock().unwrap();
                g.studio_hwnd.unwrap_or(g.main_hwnd)
            };
            let weapon_id = params.get("weaponId").and_then(|v| v.as_str()).unwrap_or("ar");
            let flt = ffi::wide_filter(&[("Images", "*.webp;*.png;*.jpg"), ("All Files", "*.*")]);
            if let Some(src) = ffi::pick_open_file(hwnd, &flt, "Import Weapon Skin Texture") {
                app.lock().unwrap().skins.import_skin_from_disk(&src, weapon_id)
            } else {
                Ok(json!({ "ok": false, "canceled": true }))
            }
        }
        "equipWeaponSkin" => {
            let wid = params.get("weaponId").and_then(|v| v.as_str()).unwrap_or("ar");
            let mode = params.get("mode").and_then(|v| v.as_str()).unwrap_or("custom");
            let off = params.get("officialId").and_then(|v| v.as_str()).unwrap_or("default");
            let wear = params.get("wear").and_then(|v| v.as_u64()).unwrap_or(0);
            let cfile = params.get("customFile").and_then(|v| v.as_str()).unwrap_or("");
            let updated = {
                let mut g = app.lock().unwrap();
                g.skins.clear_mem_cache();
                g.dirty_skin_cache = true;
                g.settings.set_setting("skins.swapperEnabled", Value::Bool(true));
                g.settings.set_setting(
                    &format!("skins.weapons.{wid}"),
                    json!({ "mode": mode, "officialId": off, "wear": wear, "customFile": cfile }),
                )
            };
            broadcast_settings(app, &updated);
            Ok(updated)
        }
        "corsairTestPulse" => {
            let kind = params.get("kind").and_then(|v| v.as_str()).unwrap_or("fire");
            Ok(app.lock().unwrap().corsair.test_pulse(kind))
        }
        "registerWebHidDevice" => Ok(app.lock().unwrap().corsair.get_status()),
        _ => handle_game_rpc(app, method, params),
    }
}

fn vkey_matches_hotkey(vkey: u32, hotkey: &str) -> bool {
    let hk = hotkey.trim();
    if hk.is_empty() {
        return false;
    }
    let normalized = hk
        .strip_prefix("Key")
        .or_else(|| hk.strip_prefix("Digit"))
        .unwrap_or(hk);
    if normalized.len() == 1 {
        let ch = normalized.as_bytes()[0].to_ascii_uppercase();
        if ch.is_ascii_alphanumeric() {
            return vkey == ch as u32;
        }
    }
    if let Some(num) = hk.strip_prefix('F').or_else(|| hk.strip_prefix('f')) {
        if let Ok(n) = num.parse::<u32>() {
            if (1..=12).contains(&n) {
                return vkey == 0x70 + (n - 1);
            }
        }
    }
    match hk.to_ascii_lowercase().as_str() {
        "insert" => vkey == 0x2D,
        "delete" => vkey == 0x2E,
        "home" => vkey == 0x24,
        "end" => vkey == 0x23,
        "pageup" => vkey == 0x21,
        "pagedown" => vkey == 0x22,
        "escape" => vkey == 0x1B,
        "tab" => vkey == 0x09,
        "space" => vkey == 0x20,
        "rightshift" | "rshift" => vkey == 0xA1 || vkey == 0x10,
        _ => false,
    }
}

fn attach_resource_interceptor(
    wv: &ICoreWebView2,
    app: &SharedApp,
    filter_patterns: &[&str],
    is_studio: bool,
) {
    unsafe {
        for pat in filter_patterns {
            let wpat = HSTRING::from(*pat);
            let _ = wv.AddWebResourceRequestedFilter(&wpat, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
        }
        let (env, settings_snap, skins) = {
            let g = app.lock().unwrap();
            (
                g.web_env.clone(),
                Arc::clone(&g.settings_snap),
                Arc::clone(&g.skins),
            )
        };
        let mut tok = 0i64;
        let _ = wv.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()); };
                let Ok(req) = args.Request() else { return Ok(()); };
                let mut uri_ptr = PWSTR(ptr::null_mut());
                if req.Uri(&mut uri_ptr).is_err() || uri_ptr.0.is_null() {
                    return Ok(());
                }
                let uri = uri_ptr.to_string().unwrap_or_default();
                CoTaskMemFree(Some(uri_ptr.0 as *const c_void));

                let Some(env_ref) = env.as_ref() else { return Ok(()); };
                let settings_guard = settings_snap.read().unwrap();

                if is_studio {
                    let clean_url = uri.split(['?', '#']).next().unwrap_or(&uri);
                    if let Some(rel) = clean_url.strip_prefix("https://studio.dih.local/") {
                        if let Some(emb) = bundle::resolve_embedded_studio_asset(rel) {
                            let decoded;
                            let bytes = if emb.gzipped {
                                decoded = crate::inflate::gzip(emb.bytes).unwrap_or_default();
                                decoded.as_slice()
                            } else {
                                emb.bytes
                            };
                            if let Some(stream) = make_mem_stream(bytes) {
                                let hdr = format!(
                                    "Content-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store",
                                    emb.mime
                                );
                                let headers = HSTRING::from(hdr);
                                if let Ok(resp) = env_ref.CreateWebResourceResponse(Some(&stream), 200, w!("OK"), &headers) {
                                    let _ = args.SetResponse(Some(&resp));
                                }
                            }
                            return Ok(());
                        }
                    }
                } else {
                    let clean_url = uri.split(['?', '#']).next().unwrap_or(&uri);
                    let emb_js_gz = if clean_url.ends_with("/__dih_bundle.js") {
                        Some(bundle::GZ_OVERLAY_BUNDLE)
                    } else if clean_url.ends_with("/__dih_catalog.js") {
                        Some(bundle::GZ_CATALOG_JS)
                    } else {
                        None
                    };
                    if let Some(gz_bytes) = emb_js_gz {
                        let plain = crate::inflate::gzip(gz_bytes).unwrap_or_default();
                        if let Some(stream) = make_mem_stream(&plain) {
                            let headers = HSTRING::from(
                                "Content-Type: application/javascript; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store",
                            );
                            if let Ok(resp) = env_ref.CreateWebResourceResponse(Some(&stream), 200, w!("OK"), &headers) {
                                let _ = args.SetResponse(Some(&resp));
                            }
                        }
                        return Ok(());
                    }
                    let adblock_on = settings_guard
                        .pointer("/window/adblockerEnabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    if adblock_on && adblock::is_ad_or_tracker_url(&uri) {
                        let (status, reason, mime, body) = adblock::blocked_ad_response(&uri);
                        let stream_opt = if body.is_empty() { None } else { make_mem_stream(body) };
                        let headers = HSTRING::from(format!(
                            "Content-Type: {mime}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store"
                        ));
                        let reason_h = HSTRING::from(reason);
                        if let Ok(resp) = env_ref.CreateWebResourceResponse(stream_opt.as_ref(), status as i32, &reason_h, &headers) {
                            let _ = args.SetResponse(Some(&resp));
                        }
                        return Ok(());
                    }
                }

                if let Some(res) = skins.resolve_web_request(&uri, &settings_guard) {
                    if let Some(stream) = make_mem_stream(&res.bytes) {
                        let headers = HSTRING::from(format!(
                            "Content-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store",
                            res.mime
                        ));
                        if let Ok(resp) = env_ref.CreateWebResourceResponse(Some(&stream), 200, w!("OK"), &headers) {
                            let _ = args.SetResponse(Some(&resp));
                        }
                    }
                }
                Ok(())
            })),
            &mut tok,
        );
    }
}

fn attach_game_webview(hwnd: HWND, env: &ICoreWebView2Environment, app: &SharedApp, target_url: &str) -> Result<(), WinError> {
    let (tx, rx) = std::sync::mpsc::channel();
    let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |err, ctrl| {
        let _ = tx.send(err.map(|_| ctrl.expect("ctrl")));
        Ok(())
    }));
    unsafe {
        env.CreateCoreWebView2Controller(hwnd, &handler)?;
    }
    let ctrl: ICoreWebView2Controller = wait_with_pump(rx).map_err(|_| WinError::from(windows::Win32::Foundation::E_FAIL))??;

    unsafe {
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let _ = ctrl.SetBounds(rect);
        if let Ok(ctrl2) = ctrl.cast::<ICoreWebView2Controller2>() {
            let _ = ctrl2.SetDefaultBackgroundColor(webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_COLOR {
                A: 255,
                R: 14,
                G: 15,
                B: 18,
            });
        }
        let _ = ctrl.SetIsVisible(true);
    }

    let wv: ICoreWebView2 = unsafe { ctrl.CoreWebView2()? };

    unsafe {
        if let Ok(settings) = wv.Settings() {
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsStatusBarEnabled(false);
            // Keep Chromium's native User-Agent matching Sec-CH-UA / userAgentData
            // so Deadshot's pkg-bootstrap never reports ua-brand-mismatch.
        }

        // Inject shadow DOM overlay script cleanly before first navigation
        let inj = HSTRING::from(bundle::build_game_injection_script());
        let wv_init = wv.clone();
        let _ = AddScriptToExecuteOnDocumentCreatedCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                wv_init
                    .AddScriptToExecuteOnDocumentCreated(&inj, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }),
            Box::new(|err, _id| err),
        );
        let mut tok = 0i64;

        // Targeted Deadshot asset swaps + Ad/Tracker blocks (zero COM overhead on game JS/WASM/WS)
        let mut owned_patterns: Vec<String> = adblock::AD_FILTER_PATTERNS
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        owned_patterns.extend(app.lock().unwrap().skins.game_filter_patterns());
        let pat_refs: Vec<&str> = owned_patterns.iter().map(String::as_str).collect();
        attach_resource_interceptor(&wv, app, &pat_refs, false);

        // Handle RPC / Fire-and-Forget messages from overlay
        let app_msg = app.clone();
        let wv_msg = wv.clone();
        let _ = wv.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()); };
                let mut json_ptr = PWSTR(ptr::null_mut());
                if args.WebMessageAsJson(&mut json_ptr).is_ok() && !json_ptr.0.is_null() {
                    let raw = json_ptr.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(json_ptr.0 as *const c_void));
                    if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                        let kind = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let method = val.get("method").and_then(|v| v.as_str()).unwrap_or("");
                        let params = val.get("params").cloned().unwrap_or(Value::Null);
                        if kind == "rpc" {
                            let id = val.get("id").cloned().unwrap_or(json!(0));
                            let res = handle_game_rpc(&app_msg, method, &params);
                            post_rpc_response(&wv_msg, &id, res);
                        } else if kind == "notify" {
                            if method == "corsairUpdateTelemetry" {
                                app_msg.lock().unwrap().corsair.update_telemetry(&params);
                            } else if method == "updateDiscordState" {
                                app_msg.lock().unwrap().discord.update_state(&params);
                            }
                        }
                    }
                }
                Ok(())
            })),
            &mut tok,
        );

        // Dynamic Native Accelerator Hotkeys (honors user-rebound keys even under Pointer Lock)
        let app_acc = app.clone();
        let wv_acc = wv.clone();
        let snap_acc = Arc::clone(&app.lock().unwrap().settings_snap);
        let _ = ctrl.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_ctrl, args| {
                let Some(args) = args else { return Ok(()); };
                let mut kind = Default::default();
                let _ = args.KeyEventKind(&mut kind);
                if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                    let mut vkey = 0u32;
                    if args.VirtualKey(&mut vkey).is_ok() {
                        let (
                            hk_studio,
                            hk_trainer,
                            hk_mute,
                            hk_hud,
                            hk_telemetry,
                            hk_tview,
                            hk_xhair,
                            hk_keys,
                            hk_watermark,
                            hk_shot,
                            hk_fs,
                            hk_reload,
                        ) = {
                            let g = snap_acc.read().unwrap();
                            let hk = |k: &str, def: &str| -> String {
                                g.pointer(&format!("/hotkeys/{k}"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(def)
                                    .to_string()
                            };
                            (
                                hk("openStudio", "F7"),
                                hk("openAimTrainer", "Insert"),
                                hk("muteMaster", "F8"),
                                hk("hideAllHud", "F9"),
                                hk("toggleTelemetry", "F4"),
                                hk("toggleTelemetryView", "F6"),
                                hk("toggleCrosshair", "F2"),
                                hk("toggleKeysOverlay", "F3"),
                                hk("toggleWatermark", "F1"),
                                hk("screenshot", "F10"),
                                hk("fullscreen", "F11"),
                                hk("quickReload", "F5"),
                            )
                        };
                        if vkey_matches_hotkey(vkey, &hk_studio) {
                            let _ = args.SetHandled(true);
                            let h = {
                                let mut g = app_acc.lock().unwrap();
                                g.pending_studio_tab = "corsair".into();
                                g.pending_studio_weapon.clear();
                                g.main_hwnd
                            };
                            let _ = PostMessageW(Some(h), WM_APP_OPEN_STUDIO, WPARAM(0), LPARAM(0));
                        } else if vkey_matches_hotkey(vkey, &hk_trainer) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toast:7-Gun Aim Trainer — Coming Soon"));
                        } else if vkey_matches_hotkey(vkey, &hk_mute) {
                            let _ = args.SetHandled(true);
                            let muted = !snap_acc
                                .read()
                                .unwrap()
                                .pointer("/audio/masterMuted")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let _ = handle_game_rpc(&app_acc, "setMasterMute", &json!({ "muted": muted }));
                        } else if vkey_matches_hotkey(vkey, &hk_hud) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toggleAllHud"));
                        } else if vkey_matches_hotkey(vkey, &hk_telemetry) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toggleTelemetry"));
                        } else if vkey_matches_hotkey(vkey, &hk_tview) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toggleTelemetryView"));
                        } else if vkey_matches_hotkey(vkey, &hk_xhair) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toggleCrosshair"));
                        } else if vkey_matches_hotkey(vkey, &hk_keys) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toggleKeysOverlay"));
                        } else if vkey_matches_hotkey(vkey, &hk_watermark) {
                            let _ = args.SetHandled(true);
                            post_json(&wv_acc, "action", &json!("toggleWatermark"));
                        } else if vkey_matches_hotkey(vkey, &hk_shot) {
                            let _ = args.SetHandled(true);
                            if let Ok(r) = capture_screenshot_blocking(&app_acc) {
                                let fp = r.get("filePath").and_then(|v| v.as_str()).unwrap_or("Saved");
                                post_json(&wv_acc, "action", &json!(format!("toast:Screenshot: {fp}")));
                            }
                        } else if vkey_matches_hotkey(vkey, &hk_fs) {
                            let _ = args.SetHandled(true);
                            toggle_fullscreen_hwnd(&app_acc);
                        } else if vkey_matches_hotkey(vkey, &hk_reload) {
                            let _ = args.SetHandled(true);
                            let h = app_acc.lock().unwrap().main_hwnd;
                            let _ = PostMessageW(Some(h), WM_APP_RELOAD_GAME, WPARAM(0), LPARAM(0));
                        }
                    }
                }
                Ok(())
            })),
            &mut tok,
        );
    }

    {
        let mut g = app.lock().unwrap();
        g.game_ctrl = Some(ctrl);
        g.game_wv = Some(wv.clone());
    }
    apply_window_settings(app);

    unsafe {
        let nav_url = HSTRING::from(target_url);
        wv.Navigate(&nav_url)?;
    }
    Ok(())
}

fn open_or_focus_studio(app: &SharedApp) {
    let (existing, tab, weapon) = {
        let g = app.lock().unwrap();
        (g.studio_hwnd, g.pending_studio_tab.clone(), g.pending_studio_weapon.clone())
    };
    if let Some(shwnd) = existing {
        unsafe {
            let _ = ShowWindow(shwnd, SW_SHOW);
            let _ = windows::Win32::UI::Input::KeyboardAndMouse::SetFocus(Some(shwnd));
        }
        if let Some(swv) = app.lock().unwrap().studio_wv.clone() {
            post_json(&swv, "studioTab", &json!({ "tab": tab, "weapon": weapon }));
        }
        return;
    }

    let env_opt = app.lock().unwrap().web_env.clone();
    let Some(env) = env_opt else { return; };

    let hwnd = unsafe {
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let title = w!("Dih Studio — Corsair RGB & Project Explorer");
        let cls = w!("DihStudioWindowClass");
        let icon: HICON = LoadImageW(
            Some(hinst.into()),
            PCWSTR(1 as *const u16),
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_SHARED,
        )
        .map(|h| HICON(h.0))
        .unwrap_or_default();

        let h = CreateWindowExW(
            Default::default(),
            cls,
            title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            120,
            80,
            1320,
            860,
            None,
            None,
            Some(hinst.into()),
            Some(Arc::as_ptr(app) as *const c_void),
        )
        .unwrap_or_default();
        if !icon.is_invalid() {
            SendMessageW(h, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(icon.0 as isize)));
            SendMessageW(h, WM_SETICON, Some(WPARAM(ICON_SMALL as usize)), Some(LPARAM(icon.0 as isize)));
        }
        enable_dark_titlebar(h);
        h
    };
    if hwnd.0.is_null() {
        return;
    }

    app.lock().unwrap().studio_hwnd = Some(hwnd);

    let (tx, rx) = std::sync::mpsc::channel();
    let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |err, ctrl| {
        let _ = tx.send(err.map(|_| ctrl.expect("ctrl")));
        Ok(())
    }));
    if unsafe { env.CreateCoreWebView2Controller(hwnd, &handler) }.is_err() {
        return;
    }
    let Ok(Ok(ctrl)) = wait_with_pump(rx) else { return; };

    unsafe {
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let _ = ctrl.SetBounds(rect);
        let _ = ctrl.SetIsVisible(true);
        let Ok(wv) = ctrl.CoreWebView2() else { return; };

        attach_resource_interceptor(&wv, app, &["https://studio.dih.local/*"], true);

        let app_msg = app.clone();
        let wv_msg = wv.clone();
        let mut tok = 0i64;
        let _ = wv.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |_s, args| {
                let Some(args) = args else { return Ok(()); };
                let mut ptr_s = PWSTR(ptr::null_mut());
                if args.WebMessageAsJson(&mut ptr_s).is_ok() && !ptr_s.0.is_null() {
                    let raw = ptr_s.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(ptr_s.0 as *const c_void));
                    if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                        if val.get("type").and_then(|v| v.as_str()) == Some("rpc") {
                            let id = val.get("id").cloned().unwrap_or(json!(0));
                            let method = val.get("method").and_then(|v| v.as_str()).unwrap_or("");
                            let params = val.get("params").cloned().unwrap_or(Value::Null);
                            let res = handle_studio_rpc(&app_msg, method, &params);
                            post_rpc_response(&wv_msg, &id, res);
                        }
                    }
                }
                Ok(())
            })),
            &mut tok,
        );

        {
            let mut g = app.lock().unwrap();
            g.studio_ctrl = Some(ctrl);
            g.studio_wv = Some(wv.clone());
        }

        let nav = if weapon.is_empty() {
            HSTRING::from(format!("https://studio.dih.local/studio.html?tab={tab}"))
        } else {
            HSTRING::from(format!("https://studio.dih.local/studio.html?tab={tab}&weapon={weapon}"))
        };
        let _ = wv.Navigate(&nav);
    }
}

unsafe extern "system" fn main_wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == windows::Win32::UI::WindowsAndMessaging::WM_NCCREATE {
        let cs = lparam.0 as *const windows::Win32::UI::WindowsAndMessaging::CREATESTRUCTW;
        if !cs.is_null() {
            SetWindowLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA, (*cs).lpCreateParams as isize);
        }
    }
    let ptr_val = GetWindowLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA);
    let app_opt = if ptr_val != 0 {
        Some(&*(ptr_val as *const Mutex<AppState>))
    } else {
        None
    };

    match msg {
        WM_SIZE => {
            if let Some(m) = app_opt {
                if let Some(ctrl) = m.lock().unwrap().game_ctrl.clone() {
                    let mut rect = RECT::default();
                    let _ = GetClientRect(hwnd, &mut rect);
                    let _ = ctrl.SetBounds(rect);
                }
            }
            LRESULT(0)
        }
        WM_GETMINMAXINFO => {
            let mmi = lparam.0 as *mut windows::Win32::UI::WindowsAndMessaging::MINMAXINFO;
            if !mmi.is_null() {
                (*mmi).ptMinTrackSize = POINT { x: 960, y: 600 };
            }
            LRESULT(0)
        }
        WM_APP_RELOAD_GAME => {
            if let Some(m) = app_opt {
                let (wv_opt, needs_flush, skins_ref) = {
                    let mut g = m.lock().unwrap();
                    let flush = g.dirty_skin_cache;
                    g.dirty_skin_cache = false;
                    (g.game_wv.clone(), flush, Arc::clone(&g.skins))
                };
                if let Some(wv) = wv_opt {
                    if needs_flush {
                        skins_ref.clear_mem_cache();
                        let mut cleared_async = false;
                        if let Ok(wv13) = wv.cast::<ICoreWebView2_13>() {
                            if let Ok(prof) = wv13.Profile() {
                                if let Ok(prof2) = prof.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Profile2>() {
                                    let wv_reload = wv.clone();
                                    let h = ClearBrowsingDataCompletedHandler::create(Box::new(move |_| {
                                        let _ = wv_reload.Reload();
                                        Ok(())
                                    }));
                                    if prof2.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &h).is_ok() {
                                        cleared_async = true;
                                    }
                                }
                            }
                        }
                        if !cleared_async {
                            let _ = wv.Reload();
                        }
                    } else {
                        let _ = wv.Reload();
                    }
                }
            }
            LRESULT(0)
        }
        WM_APP_OPEN_STUDIO => {
            if let Some(m) = app_opt {
                let raw_ptr = m as *const Mutex<AppState>;
                Arc::increment_strong_count(raw_ptr);
                let cloned = Arc::from_raw(raw_ptr);
                open_or_focus_studio(&cloned);
            }
            LRESULT(0)
        }
        WM_APP_CORSAIR_FRAME => {
            if let Some(m) = app_opt {
                let (swv, frame) = {
                    let g = m.lock().unwrap();
                    (g.studio_wv.clone(), g.corsair.current_frame())
                };
                if let Some(wv) = swv {
                    post_json(&wv, "corsairFrame", &frame);
                }
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        WM_CLOSE => {
            if let Some(m) = app_opt {
                let confirm = m.lock().unwrap().settings.get_all()["privacyPro"]["confirmOnClose"]
                    .as_bool()
                    .unwrap_or(false);
                if confirm && !hw_analyzer::confirm_close_dialog(hwnd) {
                    return LRESULT(0);
                }
            }
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        windows::Win32::UI::WindowsAndMessaging::WM_ACTIVATE => {
            if let Some(m) = app_opt {
                let perf = m.lock().unwrap().settings.get_all().get("performance").cloned().unwrap_or(Value::Null);
                if perf.get("focusPriorityScaling").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let inactive = (wparam.0 & 0xFFFF) == 0;
                    let low_lat = perf.get("lowLatencyTimer").and_then(|v| v.as_bool()).unwrap_or(true);
                    let no_sleep = perf.get("preventSleep").and_then(|v| v.as_bool()).unwrap_or(true);
                    let disable_throt = perf.get("disablePowerThrottling").and_then(|v| v.as_bool()).unwrap_or(true);
                    let prio = if inactive { "normal" } else { perf.get("processPriority").and_then(|v| v.as_str()).unwrap_or("high") };
                    let mut wv_pid = 0u32;
                    if let Some(ref wv) = m.lock().unwrap().game_wv {
                        let _ = wv.BrowserProcessId(&mut wv_pid);
                    }
                    ffi::apply_runtime_perf(low_lat, no_sleep, prio, disable_throt, wv_pid);
                }
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe extern "system" fn studio_wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == windows::Win32::UI::WindowsAndMessaging::WM_NCCREATE {
        let cs = lparam.0 as *const windows::Win32::UI::WindowsAndMessaging::CREATESTRUCTW;
        if !cs.is_null() {
            SetWindowLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA, (*cs).lpCreateParams as isize);
        }
    }
    let ptr_val = GetWindowLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA);
    let app_opt = if ptr_val != 0 {
        Some(&*(ptr_val as *const Mutex<AppState>))
    } else {
        None
    };

    match msg {
        WM_SIZE => {
            if let Some(m) = app_opt {
                if let Some(ctrl) = m.lock().unwrap().studio_ctrl.clone() {
                    let mut rect = RECT::default();
                    let _ = GetClientRect(hwnd, &mut rect);
                    let _ = ctrl.SetBounds(rect);
                }
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            if let Some(m) = app_opt {
                let mut g = m.lock().unwrap();
                g.studio_ctrl = None;
                g.studio_wv = None;
                g.studio_hwnd = None;
            }
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

trait CorsairFrameHelper {
    fn current_frame(&self) -> Value;
}
impl CorsairFrameHelper for CorsairService {
    fn current_frame(&self) -> Value {
        self.inner.lock().unwrap().current_frame.clone()
    }
}

fn create_webview2_env(user_data: &PathBuf, extra_args: &str) -> Result<ICoreWebView2Environment, WinError> {
    let opts = CoreWebView2EnvironmentOptions::default();
    unsafe {
        opts.set_additional_browser_arguments(extra_args.to_string());
    }
    let env_opts: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2EnvironmentOptions = opts.into();
    let udf = HSTRING::from(user_data.join("wv2-profile").to_string_lossy().to_string());

    let (tx, rx) = std::sync::mpsc::channel();
    let cb = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |err, env| {
        let _ = tx.send(err.map(|_| env.expect("env")));
        Ok(())
    }));
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &udf, Some(&env_opts), &cb)?;
    }
    wait_with_pump(rx).map_err(|_| WinError::from(windows::Win32::Foundation::E_FAIL))?
}

fn run_smoke_test(app: &SharedApp, smoke_out: Option<String>, test_url: Option<String>) -> i32 {
    let g = app.lock().unwrap();
    let static_hw = ffi::get_static_hardware();
    let live = ffi::get_live_metrics();
    let feat_count = g.catalog
        .get("FEATURE_COUNT")
        .and_then(|v| v.as_u64())
        .or_else(|| g.catalog.pointer("/FEATURE_REGISTRY").and_then(|v| v.as_array()).map(|a| a.len() as u64))
        .unwrap_or(0);
    let corsair_st = g.corsair.get_status();
    let inj_len = bundle::build_game_injection_script().len();
    let report = json!({
        "ok": true,
        "engine": "Dih Native Rust + C + Win32 + WebView2",
        "version": "0.4.1",
        "author": "ewwhardik",
        "featureCount": feat_count,
        "injectionScriptBytes": inj_len,
        "overlayBundleGzipBytes": bundle::GZ_OVERLAY_BUNDLE.len(),
        "studioExists": bundle::resolve_embedded_studio_asset("studio.html").is_some(),
        "threeJsRemoved": bundle::resolve_embedded_studio_asset("vendor/three/build/three.module.min.js").is_none(),
        "aimTrainerRemoved": bundle::resolve_embedded_studio_asset("aimTrainer.js").is_none(),
        "adblockBlockedTest": adblock::is_ad_or_tracker_url("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"),
        "adblockVenatusTest": adblock::is_ad_or_tracker_url("https://hb.vntsm.com/v4/live/vms/sites/deadshot.io/index.js"),
        "adblockAtmtdTest": adblock::is_ad_or_tracker_url("https://edge.atmtd.com/script.js"),
        "adblockAllowedGame": !adblock::is_ad_or_tracker_url("https://deadshot.io/promo/logo.webp"),
        "logoSwapMime": g.skins.resolve_web_request("https://deadshot.io/promo/logo.webp", &g.settings.get_all()).map(|r| r.mime),
        "staticHardware": static_hw,
        "liveMetrics": live,
        "corsair": corsair_st,
        "testUrl": test_url,
    });
    if let Some(p) = smoke_out {
        let _ = fs::write(p, serde_json::to_string_pretty(&report).unwrap());
    }
    0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let smoke_mode = args.iter().any(|a| a == "--smoke-test");
    let smoke_out = args
        .iter()
        .find_map(|a| a.strip_prefix("--smoke-test-out=").map(str::to_string));

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    let user_data_dir = get_user_data_dir();
    let catalog = bundle::parse_catalog();
    let settings = SettingsStore::load(&user_data_dir, &catalog);
    let current = settings.get_all();
    let corsair_cfg = current.get("corsair").cloned().unwrap_or(Value::Null);
    let win_cfg = current.get("window").cloned().unwrap_or(Value::Null);
    let skins = Arc::new(SkinManager::new(&user_data_dir, catalog.clone()));
    let corsair = Arc::new(CorsairService::new(corsair_cfg));
    let discord = DiscordRpcService::new(&win_cfg);
    let settings_snap = Arc::new(RwLock::new(current.clone()));

    let app = Arc::new(Mutex::new(AppState {
        user_data_dir: user_data_dir.clone(),
        catalog,
        settings,
        settings_snap,
        skins: Arc::clone(&skins),
        corsair,
        discord,
        main_hwnd: HWND::default(),
        studio_hwnd: None,
        pending_studio_tab: "corsair".to_string(),
        pending_studio_weapon: String::new(),
        dirty_skin_cache: false,
        is_fullscreen: false,
        applied_borderless_max: false,
        saved_placement: WINDOWPLACEMENT::default(),
        web_env: None,
        game_ctrl: None,
        game_wv: None,
        studio_ctrl: None,
        studio_wv: None,
    }));

    let test_url = std::env::var("DIH_TEST_URL").ok().filter(|s| !s.trim().is_empty());
    if smoke_mode {
        std::process::exit(run_smoke_test(&app, smoke_out, test_url));
    }

    skins.prewarm_configured_skins(&current);
    ffi::start_background_telemetry();
    // Apply initial CPU priority + EcoQoS bypass + 1ms timer + sleep lock + telemetry config
    apply_window_settings(&app);

    let hinst = unsafe { GetModuleHandleW(None).unwrap_or_default() };
    let icon: HICON = unsafe {
        LoadImageW(
            Some(hinst.into()),
            PCWSTR(1 as *const u16),
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_SHARED,
        )
        .map(|h| HICON(h.0))
        .unwrap_or_default()
    };
    let dark_brush = unsafe { CreateSolidBrush(COLORREF(0x00120F0E)) };

    unsafe {
        let wc_main = WNDCLASSW {
            lpfnWndProc: Some(main_wnd_proc),
            hInstance: hinst.into(),
            lpszClassName: w!("DihClientWindowClass"),
            hIcon: icon,
            hbrBackground: HBRUSH(dark_brush.0),
            ..Default::default()
        };
        RegisterClassW(&wc_main);

        let wc_studio = WNDCLASSW {
            lpfnWndProc: Some(studio_wnd_proc),
            hInstance: hinst.into(),
            lpszClassName: w!("DihStudioWindowClass"),
            hIcon: icon,
            hbrBackground: HBRUSH(dark_brush.0),
            ..Default::default()
        };
        RegisterClassW(&wc_studio);
    }

    let hw = ffi::get_static_hardware();
    let sw = hw.pointer("/displays/primary/width").and_then(|v| v.as_i64()).unwrap_or(1440) as i32;
    let sh = hw.pointer("/displays/primary/height").and_then(|v| v.as_i64()).unwrap_or(900) as i32;
    let w = (sw * 9 / 10).min(1440).max(960);
    let h = (sh * 9 / 10).min(900).max(600);
    let x = ((sw - w) / 2).max(20);
    let y = ((sh - h) / 2).max(20);

    let hwnd = unsafe {
        let mut r = RECT { left: 0, top: 0, right: w, bottom: h };
        let _ = AdjustWindowRect(&mut r, WS_OVERLAPPEDWINDOW, false);
        let hw_win = CreateWindowExW(
            Default::default(),
            w!("DihClientWindowClass"),
            w!("Dih Client — Deadshot.io (Native)"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            x,
            y,
            r.right - r.left,
            r.bottom - r.top,
            None,
            None,
            Some(hinst.into()),
            Some(Arc::as_ptr(&app) as *const c_void),
        )
        .unwrap();
        if !icon.is_invalid() {
            SendMessageW(hw_win, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(icon.0 as isize)));
            SendMessageW(hw_win, WM_SETICON, Some(WPARAM(ICON_SMALL as usize)), Some(LPARAM(icon.0 as isize)));
        }
        enable_dark_titlebar(hw_win);
        let _ = MoveWindow(hw_win, x, y, w, h, true);
        let _ = ShowWindow(hw_win, SW_SHOW);
        hw_win
    };

    app.lock().unwrap().main_hwnd = hwnd;

    if app
        .lock()
        .unwrap()
        .settings
        .get_all()
        .pointer("/window/autoFullscreen")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        toggle_fullscreen_hwnd(&app);
    }

    let (perf_cfg, net_cfg) = {
        let g = app.lock().unwrap();
        let all = g.settings.get_all();
        (
            all.get("performance").cloned().unwrap_or(Value::Null),
            all.get("network").cloned().unwrap_or(Value::Null),
        )
    };
    let browser_args = build_browser_args(&perf_cfg, &net_cfg);
    if let Ok(env) = create_webview2_env(&user_data_dir, &browser_args) {
        app.lock().unwrap().web_env = Some(env.clone());
        let url = test_url.unwrap_or_else(|| "https://deadshot.io/".to_string());
        let _ = attach_game_webview(hwnd, &env, &app, &url);
    }

    // Background 20Hz Corsair & OpenRGB engine thread (STA-safe: only touches Send+Sync Arc<CorsairService>)
    let corsair_bg = app.lock().unwrap().corsair.clone();
    let hwnd_raw = hwnd.0 as usize;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = corsair_bg.step_frame();
        unsafe {
            let _ = PostMessageW(
                Some(HWND(hwnd_raw as *mut c_void)),
                WM_APP_CORSAIR_FRAME,
                WPARAM(0),
                LPARAM(0),
            );
        }
    });

    // Clean single-threaded Win32 STA message loop
    let mut msg = MSG::default();
    unsafe {
        while GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
