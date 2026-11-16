//! Native Win32 Named-Pipe Discord Rich Presence Client (no external crates).
//! Connects to \\.\pipe\discord-ipc-0..9 using standard 8-byte LE framing
//! [op: u32 LE][len: u32 LE][JSON payload] and sets SET_ACTIVITY with buttons.

use serde_json::{json, Value};
use std::ffi::c_void;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use windows::core::HSTRING;
#[cfg(windows)]
use windows::Win32::Foundation::{
    CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
};
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_NONE, OPEN_EXISTING,
};
#[cfg(windows)]
use windows::Win32::System::Threading::GetCurrentProcessId;

pub const DEFAULT_DISCORD_APP_ID: &str = "1571744646219169873";

#[derive(Clone)]
struct RpcConfig {
    enabled: bool,
    privacy_mode: bool,
    app_id: String,
    mode: String,
    weapon: String,
    skin_name: String,
}

struct RpcInner {
    cfg: RpcConfig,
    connected: bool,
    app_name: String,
    pipe_name: String,
    last_error: String,
    start_epoch_sec: u64,
    dirty: bool,
}

pub struct DiscordRpcService {
    inner: Arc<Mutex<RpcInner>>,
}

fn unix_now_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(1700000000)
}

fn rpc_buttons() -> Value {
    json!([
        {
            "label": "Download Dih",
            "url": "https://github.com/ewwhardik/dih-deadshot/releases/latest"
        },
        {
            "label": "Live Showcase",
            "url": "https://ewwhardik.github.io/dih-deadshot/"
        }
    ])
}

#[cfg(windows)]
fn write_frame(handle: HANDLE, opcode: u32, payload: &Value) -> Result<(), String> {
    let body = payload.to_string().into_bytes();
    let len = body.len() as u32;
    let mut pkt = Vec::with_capacity(8 + body.len());
    pkt.extend_from_slice(&opcode.to_le_bytes());
    pkt.extend_from_slice(&len.to_le_bytes());
    pkt.extend_from_slice(&body);

    let mut written = 0u32;
    let ok = unsafe { WriteFile(handle, Some(&pkt), Some(&mut written), None) };
    if ok.is_err() || written as usize != pkt.len() {
        return Err("Failed writing Discord IPC frame".into());
    }
    Ok(())
}

#[cfg(windows)]
fn read_exact_bytes(handle: HANDLE, len: usize) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; len];
    let mut offset = 0usize;
    while offset < len {
        let mut read = 0u32;
        let res = unsafe { ReadFile(handle, Some(&mut buf[offset..]), Some(&mut read), None) };
        if res.is_err() || read == 0 {
            return Err("Discord IPC pipe closed".into());
        }
        offset += read as usize;
    }
    Ok(buf)
}

#[cfg(windows)]
fn read_frame(handle: HANDLE) -> Result<(u32, Value), String> {
    let hdr = read_exact_bytes(handle, 8)?;
    let op = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
    let len = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
    if len > 1_048_576 {
        return Err("Oversized Discord IPC frame".into());
    }
    let body = read_exact_bytes(handle, len)?;
    let parsed = serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null);
    Ok((op, parsed))
}

#[cfg(windows)]
fn open_discord_pipe() -> Option<(HANDLE, String)> {
    for idx in 0..10 {
        let pipe = format!(r"\\.\pipe\discord-ipc-{idx}");
        let w = HSTRING::from(&pipe);
        let handle = unsafe {
            CreateFileW(
                &w,
                GENERIC_READ.0 | GENERIC_WRITE.0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
        };
        if let Ok(h) = handle {
            if h != INVALID_HANDLE_VALUE && !h.is_invalid() {
                return Some((h, pipe));
            }
        }
    }
    None
}

#[cfg(windows)]
fn send_activity(handle: HANDLE, cfg: &RpcConfig, start_epoch_sec: u64, seq: u64) -> Result<String, String> {
    let pid = unsafe { GetCurrentProcessId() };
    let (details, state) = if cfg.privacy_mode {
        ("Playing Deadshot.io via Dih", "Private Session")
    } else {
        ("The client feels like hacking!", "755.5 KB Uncapped Engine • 201 Controls")
    };

    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": pid,
            "activity": {
                "details": details,
                "state": state,
                "timestamps": { "start": start_epoch_sec },
                "assets": {
                    "large_image": "dih_logo",
                    "large_text": "Dih Client — Uncapped deadshot.io"
                },
                "buttons": rpc_buttons(),
                "instance": false
            }
        },
        "nonce": format!("dih-{seq}")
    });

    write_frame(handle, 1, &payload)?;
    let (op, resp) = read_frame(handle)?;
    if op == 2 || resp.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
        let msg = resp
            .pointer("/data/message")
            .or_else(|| resp.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Discord rejected SET_ACTIVITY");
        return Err(msg.to_string());
    }
    let resolved_name = resp
        .pointer("/data/name")
        .and_then(|v| v.as_str())
        .unwrap_or("Dih deadshot.io")
        .to_string();
    Ok(resolved_name)
}

impl DiscordRpcService {
    pub fn new(win_cfg: &Value) -> Arc<Self> {
        let enabled = win_cfg
            .get("discordRpcEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let privacy_mode = win_cfg
            .get("discordPrivacyMode")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let app_id = win_cfg
            .get("discordClientId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_DISCORD_APP_ID)
            .to_string();

        let svc = Arc::new(Self {
            inner: Arc::new(Mutex::new(RpcInner {
                cfg: RpcConfig {
                    enabled,
                    privacy_mode,
                    app_id,
                    mode: "In Match".into(),
                    weapon: "Uncapped Engine".into(),
                    skin_name: "201 Controls".into(),
                },
                connected: false,
                app_name: String::new(),
                pipe_name: String::new(),
                last_error: String::new(),
                start_epoch_sec: unix_now_sec(),
                dirty: true,
            })),
        });

        Self::spawn_worker(Arc::clone(&svc));
        svc
    }

    fn spawn_worker(svc: Arc<Self>) {
        std::thread::spawn(move || {
            #[cfg(windows)]
            {
                let mut handle_opt: Option<usize> = None;
                let mut active_app_id = String::new();
                let mut seq: u64 = 1;

                loop {
                    let (cfg, start_sec, needs_sync) = {
                        let mut g = svc.inner.lock().unwrap();
                        let d = g.dirty;
                        g.dirty = false;
                        (g.cfg.clone(), g.start_epoch_sec, d)
                    };

                    if !cfg.enabled || cfg.app_id.trim().is_empty() {
                        if let Some(raw) = handle_opt.take() {
                            let h = HANDLE(raw as *mut c_void);
                            let _ = write_frame(h, 2, &json!({}));
                            unsafe { let _ = CloseHandle(h); }
                        }
                        {
                            let mut g = svc.inner.lock().unwrap();
                            g.connected = false;
                            g.pipe_name.clear();
                            if cfg.enabled && cfg.app_id.trim().is_empty() {
                                g.last_error = "Set your Discord App ID (named 'Dih deadshot.io') in Visuals & Sync -> Privacy".into();
                            } else {
                                g.last_error.clear();
                            }
                        }
                        std::thread::sleep(Duration::from_millis(1200));
                        continue;
                    }

                    if handle_opt.is_some() && active_app_id != cfg.app_id {
                        if let Some(raw) = handle_opt.take() {
                            let h = HANDLE(raw as *mut c_void);
                            let _ = write_frame(h, 2, &json!({}));
                            unsafe { let _ = CloseHandle(h); }
                        }
                        svc.inner.lock().unwrap().connected = false;
                    }

                    if handle_opt.is_none() {
                        if let Some((h, pipe)) = open_discord_pipe() {
                            let hs = json!({ "v": 1, "client_id": cfg.app_id });
                            let res = write_frame(h, 0, &hs).and_then(|_| read_frame(h));
                            match res {
                                Ok((1, val)) if val.get("evt").and_then(|v| v.as_str()) == Some("READY") => {
                                    let app_nm = val
                                        .pointer("/data/application/name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    seq += 1;
                                    match send_activity(h, &cfg, start_sec, seq) {
                                        Ok(resolved_nm) => {
                                            active_app_id = cfg.app_id.clone();
                                            handle_opt = Some(h.0 as usize);
                                            let mut g = svc.inner.lock().unwrap();
                                            g.connected = true;
                                            g.pipe_name = pipe;
                                            g.app_name = if app_nm.is_empty() { resolved_nm } else { app_nm };
                                            g.last_error.clear();
                                        }
                                        Err(e) => {
                                            unsafe { let _ = CloseHandle(h); }
                                            let mut g = svc.inner.lock().unwrap();
                                            g.connected = false;
                                            g.last_error = e;
                                        }
                                    }
                                }
                                Ok((op, val)) => {
                                    unsafe { let _ = CloseHandle(h); }
                                    let msg = val
                                        .get("message")
                                        .or_else(|| val.pointer("/data/message"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(if op == 2 { "Invalid Client ID" } else { "Discord handshake rejected" });
                                    let mut g = svc.inner.lock().unwrap();
                                    g.connected = false;
                                    g.last_error = msg.to_string();
                                }
                                Err(e) => {
                                    unsafe { let _ = CloseHandle(h); }
                                    let mut g = svc.inner.lock().unwrap();
                                    g.connected = false;
                                    g.last_error = e;
                                }
                            }
                        } else {
                            let mut g = svc.inner.lock().unwrap();
                            g.connected = false;
                            g.last_error = "Discord desktop IPC pipe not detected".into();
                        }
                        std::thread::sleep(Duration::from_millis(2500));
                        continue;
                    }

                    if needs_sync {
                        if let Some(raw) = handle_opt {
                            let h = HANDLE(raw as *mut c_void);
                            seq += 1;
                            match send_activity(h, &cfg, start_sec, seq) {
                                Ok(resolved_nm) => {
                                    let mut g = svc.inner.lock().unwrap();
                                    if g.app_name.is_empty() {
                                        g.app_name = resolved_nm;
                                    }
                                    g.last_error.clear();
                                }
                                Err(e) => {
                                    unsafe { let _ = CloseHandle(h); }
                                    handle_opt = None;
                                    let mut g = svc.inner.lock().unwrap();
                                    g.connected = false;
                                    g.last_error = e;
                                }
                            }
                        }
                    }

                    std::thread::sleep(Duration::from_millis(800));
                }
            }
        });
    }

    pub fn set_config(&self, win_cfg: &Value) {
        let enabled = win_cfg
            .get("discordRpcEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let privacy_mode = win_cfg
            .get("discordPrivacyMode")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let app_id = win_cfg
            .get("discordClientId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_DISCORD_APP_ID)
            .to_string();

        let mut g = self.inner.lock().unwrap();
        g.cfg.enabled = enabled;
        g.cfg.privacy_mode = privacy_mode;
        g.cfg.app_id = app_id;
        g.dirty = true;
    }

    pub fn update_state(&self, state: &Value) {
        let mut g = self.inner.lock().unwrap();
        if let Some(m) = state.get("mode").and_then(|v| v.as_str()) {
            g.cfg.mode = m.to_string();
        }
        if let Some(w) = state.get("weapon").and_then(|v| v.as_str()) {
            g.cfg.weapon = w.to_string();
        }
        if let Some(s) = state.get("skinName").and_then(|v| v.as_str()) {
            g.cfg.skin_name = s.to_string();
        }
        g.dirty = true;
    }

    pub fn reconnect(&self) -> Value {
        {
            let mut g = self.inner.lock().unwrap();
            g.dirty = true;
        }
        self.get_status()
    }

    pub fn get_status(&self) -> Value {
        let g = self.inner.lock().unwrap();
        json!({
            "enabled": g.cfg.enabled,
            "connected": g.connected,
            "appId": g.cfg.app_id,
            "appName": g.app_name,
            "pipeName": g.pipe_name,
            "lastError": g.last_error,
            "details": if g.cfg.privacy_mode { "Playing Deadshot.io via Dih" } else { "The client feels like hacking!" },
            "state": if g.cfg.privacy_mode { "Private Session" } else { "755.5 KB Uncapped Engine • 201 Controls" },
            "buttons": rpc_buttons(),
        })
    }
}
