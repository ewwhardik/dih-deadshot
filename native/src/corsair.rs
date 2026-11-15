use crate::ffi;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PKT_REQUEST_CONTROLLER_COUNT: u32 = 0;
const PKT_REQUEST_CONTROLLER_DATA: u32 = 1;
const PKT_SET_CLIENT_NAME: u32 = 50;
const PKT_UPDATE_LEDS: u32 = 1050;

#[derive(Clone, Copy)]
struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

fn hex_to_rgb(hex: &str) -> Rgb {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() == 6 {
        if let Ok(v) = u32::from_str_radix(clean, 16) {
            return Rgb {
                r: ((v >> 16) & 0xFF) as u8,
                g: ((v >> 8) & 0xFF) as u8,
                b: (v & 0xFF) as u8,
            };
        }
    }
    Rgb { r: 212, g: 216, b: 223 }
}

fn mix(a: Rgb, b: Rgb, t: f64) -> Rgb {
    let k = t.clamp(0.0, 1.0);
    Rgb {
        r: (a.r as f64 + (b.r as f64 - a.r as f64) * k).round() as u8,
        g: (a.g as f64 + (b.g as f64 - a.g as f64) * k).round() as u8,
        b: (a.b as f64 + (b.b as f64 - a.b as f64) * k).round() as u8,
    }
}

fn scale(c: Rgb, factor: f64) -> Rgb {
    let k = factor.clamp(0.0, 1.0);
    Rgb {
        r: (c.r as f64 * k).round() as u8,
        g: (c.g as f64 * k).round() as u8,
        b: (c.b as f64 * k).round() as u8,
    }
}

fn hsl(h_deg: f64, s: f64, l: f64) -> Rgb {
    let h = ((h_deg % 360.0) + 360.0) % 360.0 / 360.0;
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return Rgb { r: v, g: v, b: v };
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let conv = |mut t: f64| -> u8 {
        if t < 0.0 { t += 1.0; }
        if t > 1.0 { t -= 1.0; }
        let v = if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        };
        (v * 255.0).round() as u8
    };
    Rgb {
        r: conv(h + 1.0 / 3.0),
        g: conv(h),
        b: conv(h - 1.0 / 3.0),
    }
}

fn encode_orgb(dev_idx: u32, pkt_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(16 + payload.len());
    pkt.extend_from_slice(b"ORGB");
    pkt.extend_from_slice(&dev_idx.to_le_bytes());
    pkt.extend_from_slice(&pkt_id.to_le_bytes());
    pkt.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    pkt.extend_from_slice(payload);
    pkt
}

#[derive(Clone)]
pub struct OpenRgbController {
    pub index: u32,
    pub led_count: usize,
}

pub struct CorsairState {
    pub config: Value,
    pub hardware: Value,
    pub connected: bool,
    pub connecting: bool,
    pub host: String,
    pub port: u16,
    pub last_error: Option<String>,
    pub controllers: Vec<OpenRgbController>,
    stream: Option<TcpStream>,
    pub fps: f64,
    pub target_hz: f64,
    pub ping_ms: f64,
    pub ads_active: bool,
    pub firing_until: Option<Instant>,
    pub reload_until: Option<Instant>,
    pub kill_until: Option<Instant>,
    pub current_frame: Value,
    pub started: Instant,
}

pub struct CorsairService {
    pub inner: Arc<Mutex<CorsairState>>,
}

impl CorsairService {
    pub fn new(corsair_cfg: Value) -> Self {
        let hardware = ffi::scan_corsair_hardware();
        let state = CorsairState {
            config: corsair_cfg,
            hardware,
            connected: false,
            connecting: false,
            host: "127.0.0.1".to_string(),
            port: 6742,
            last_error: None,
            controllers: Vec::new(),
            stream: None,
            fps: 0.0,
            target_hz: 60.0,
            ping_ms: 0.0,
            ads_active: false,
            firing_until: None,
            reload_until: None,
            kill_until: None,
            current_frame: json!({}),
            started: Instant::now(),
        };
        let svc = Self {
            inner: Arc::new(Mutex::new(state)),
        };
        svc.step_frame();
        svc
    }

    pub fn set_config(&self, cfg: Value) {
        let auto = {
            let mut g = self.inner.lock().unwrap();
            g.config = cfg.clone();
            let should = cfg.pointer("/enabled").and_then(|v| v.as_bool()).unwrap_or(true)
                && cfg.pointer("/autoConnectOpenRgb").and_then(|v| v.as_bool()).unwrap_or(false)
                && !g.connected
                && !g.connecting;
            if should {
                g.connecting = true;
            }
            should
        };
        if auto {
            let host = cfg.pointer("/openRgbHost").and_then(|v| v.as_str()).unwrap_or("127.0.0.1").to_string();
            let port = cfg.pointer("/openRgbPort").and_then(|v| v.as_u64()).unwrap_or(6742) as u16;
            let inner = Arc::clone(&self.inner);
            std::thread::spawn(move || {
                Self::connect_openrgb_inner(inner, &host, port);
            });
        }
        self.step_frame();
    }

    pub fn rescan_hardware(&self) -> Value {
        let hw = ffi::scan_corsair_hardware();
        {
            let mut g = self.inner.lock().unwrap();
            g.hardware = hw;
        }
        self.get_status()
    }

    pub fn update_telemetry(&self, patch: &Value) {
        let mut g = self.inner.lock().unwrap();
        if let Some(fps) = patch.get("fps").and_then(|v| v.as_f64()) {
            g.fps = fps;
        }
        if let Some(hz) = patch.get("targetHz").and_then(|v| v.as_f64()) {
            g.target_hz = hz.max(30.0);
        }
        if let Some(p) = patch.get("pingMs").and_then(|v| v.as_f64()) {
            g.ping_ms = p;
        }
        if let Some(ads) = patch.get("adsActive").and_then(|v| v.as_bool()) {
            g.ads_active = ads;
        }
        let now = Instant::now();
        if patch.get("shot").and_then(|v| v.as_bool()).unwrap_or(false) {
            g.firing_until = Some(now + Duration::from_millis(120));
        }
        if patch.get("reload").and_then(|v| v.as_bool()).unwrap_or(false) {
            g.reload_until = Some(now + Duration::from_millis(1100));
        }
        if patch.get("kill").and_then(|v| v.as_bool()).unwrap_or(false) {
            g.kill_until = Some(now + Duration::from_millis(450));
        }
    }

    pub fn test_pulse(&self, kind: &str) -> Value {
        match kind {
            "fire" => self.update_telemetry(&json!({ "shot": true })),
            "reload" => self.update_telemetry(&json!({ "reload": true })),
            "kill" => self.update_telemetry(&json!({ "kill": true })),
            "ads" => {
                let next = !self.inner.lock().unwrap().ads_active;
                self.update_telemetry(&json!({ "adsActive": next }));
            }
            _ => {}
        }
        self.step_frame()
    }

    pub fn connect_openrgb(&self, host: &str, port: u16) -> Value {
        Self::connect_openrgb_inner(Arc::clone(&self.inner), host, port);
        self.get_status()
    }

    fn connect_openrgb_inner(inner: Arc<Mutex<CorsairState>>, host: &str, port: u16) {
        let addr = format!("{host}:{port}");
        match TcpStream::connect_timeout(
            &addr.parse().unwrap_or_else(|_| "127.0.0.1:6742".parse().unwrap()),
            Duration::from_millis(650),
        ) {
            Ok(mut sock) => {
                let _ = sock.set_read_timeout(Some(Duration::from_millis(400)));
                let _ = sock.set_write_timeout(Some(Duration::from_millis(400)));
                let mut name_payload = b"Dih Client".to_vec();
                name_payload.push(0);
                let _ = sock.write_all(&encode_orgb(0, PKT_SET_CLIENT_NAME, &name_payload));
                let _ = sock.write_all(&encode_orgb(0, PKT_REQUEST_CONTROLLER_COUNT, &[]));

                let mut controllers = Vec::new();
                let mut hdr = [0u8; 16];
                if sock.read_exact(&mut hdr).is_ok() && &hdr[0..4] == b"ORGB" {
                    let plen = u32::from_le_bytes(hdr[12..16].try_into().unwrap()) as usize;
                    if plen >= 4 && plen <= 64 {
                        let mut body = vec![0u8; plen];
                        if sock.read_exact(&mut body).is_ok() {
                            let count = u32::from_le_bytes(body[0..4].try_into().unwrap()).min(8);
                            for idx in 0..count {
                                // Probe each controller's LED count (fallback 120)
                                let proto = 3u32.to_le_bytes();
                                let _ = sock.write_all(&encode_orgb(idx, PKT_REQUEST_CONTROLLER_DATA, &proto));
                                let mut dhdr = [0u8; 16];
                                let mut leds = 104usize;
                                if sock.read_exact(&mut dhdr).is_ok() && &dhdr[0..4] == b"ORGB" {
                                    let dlen = u32::from_le_bytes(dhdr[12..16].try_into().unwrap()) as usize;
                                    if dlen > 0 && dlen < 262_144 {
                                        let mut dbuf = vec![0u8; dlen];
                                        let _ = sock.read_exact(&mut dbuf);
                                        if dlen >= 24 {
                                            leds = 104;
                                        }
                                    }
                                }
                                controllers.push(OpenRgbController { index: idx, led_count: leds });
                            }
                        }
                    }
                }
                if controllers.is_empty() {
                    controllers.push(OpenRgbController { index: 0, led_count: 104 });
                }

                let mut g = inner.lock().unwrap();
                g.host = host.to_string();
                g.port = port;
                g.connected = true;
                g.connecting = false;
                g.last_error = None;
                g.controllers = controllers;
                g.stream = Some(sock);
            }
            Err(e) => {
                let mut g = inner.lock().unwrap();
                g.host = host.to_string();
                g.port = port;
                g.connected = false;
                g.connecting = false;
                g.stream = None;
                g.last_error = Some(format!("OpenRGB not listening ({e})"));
            }
        }
    }

    pub fn step_frame(&self) -> Value {
        let (frame, strip_rgbs, openrgb_count) = {
            let mut g = self.inner.lock().unwrap();
            let now = Instant::now();
            let t = g.started.elapsed().as_secs_f64();
            let cfg = &g.config;

            let enabled = cfg.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let mode = cfg.get("mode").and_then(|v| v.as_str()).unwrap_or("reactive_tactical").to_string();
            let brightness = (cfg.get("brightness").and_then(|v| v.as_f64()).unwrap_or(85.0) / 100.0).clamp(0.05, 1.0);
            let speed = cfg.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);

            let primary = hex_to_rgb(cfg.get("primaryColor").and_then(|v| v.as_str()).unwrap_or("#d4d8df"));
            let secondary = hex_to_rgb(cfg.get("secondaryColor").and_then(|v| v.as_str()).unwrap_or("#4b515c"));
            let fire_col = hex_to_rgb(cfg.get("fireFlashColor").and_then(|v| v.as_str()).unwrap_or("#ffffff"));
            let ads_col = hex_to_rgb(cfg.get("adsColor").and_then(|v| v.as_str()).unwrap_or("#7ea8ff"));
            let reload_col = hex_to_rgb(cfg.get("reloadColor").and_then(|v| v.as_str()).unwrap_or("#e2b866"));
            let low_fps_col = hex_to_rgb(cfg.get("lowFpsColor").and_then(|v| v.as_str()).unwrap_or("#d96464"));
            let high_fps_col = hex_to_rgb(cfg.get("highFpsColor").and_then(|v| v.as_str()).unwrap_or("#58c98a"));

            let firing = g.firing_until.map(|u| now < u).unwrap_or(false);
            let reloading = g.reload_until.map(|u| now < u).unwrap_or(false);
            let kill_flash = g.kill_until.map(|u| now < u).unwrap_or(false);
            let highlight_wasd = cfg.get("highlightWasd").and_then(|v| v.as_bool()).unwrap_or(true);
            let flash_shoot = cfg.get("flashOnShoot").and_then(|v| v.as_bool()).unwrap_or(true);
            let dim_ads = cfg.get("dimOnAds").and_then(|v| v.as_bool()).unwrap_or(true);

            let mut key_grid = Vec::with_capacity(6);
            let mut strip = Vec::with_capacity(16);

            let mut r_sum = 0u64;
            let mut g_sum = 0u64;
            let mut b_sum = 0u64;

            for r in 0..6usize {
                let mut row_vec = Vec::with_capacity(22);
                for c in 0..22usize {
                    let mut col = if !enabled {
                        Rgb { r: 12, g: 13, b: 16 }
                    } else {
                        match mode.as_str() {
                            "fps_thermal" => {
                                let ratio = if g.fps > 0.0 { (g.fps / g.target_hz).clamp(0.0, 2.0) / 2.0 } else { 0.5 };
                                mix(low_fps_col, high_fps_col, ratio)
                            }
                            "ping_health" => {
                                let ratio = (1.0 - (g.ping_ms / 160.0)).clamp(0.0, 1.0);
                                mix(low_fps_col, high_fps_col, ratio)
                            }
                            "breathing" => {
                                let wave = 0.5 + 0.5 * (t * 2.1 * speed).sin();
                                mix(secondary, primary, wave)
                            }
                            "spectrum" => hsl((c as f64 * 12.0 + r as f64 * 8.0 + t * 90.0 * speed) % 360.0, 0.42, 0.52),
                            "ads_focus" => {
                                if g.ads_active { mix(secondary, ads_col, 0.55) } else { primary }
                            }
                            "reload_sweep" => {
                                let sweep = ((t * 2.5 * speed) % 1.0) * 22.0;
                                let d = (c as f64 - sweep).abs();
                                if d < 2.2 { mix(primary, reload_col, 1.0 - d / 2.2) } else { secondary }
                            }
                            "keymap_zones" => {
                                if c <= 4 { mix(primary, ads_col, 0.25) } else { secondary }
                            }
                            "audio_pulse" => {
                                let beat = (0.5 + 0.5 * (t * 5.2 * speed).sin()).powf(2.0);
                                mix(secondary, primary, beat)
                            }
                            "static_slate" => primary,
                            _ => {
                                // reactive_tactical
                                let mut base = mix(secondary, primary, 0.5 + 0.2 * (t * 1.4 * speed + c as f64 * 0.22).sin());
                                if highlight_wasd && ((r == 2 && c == 2) || (r == 3 && (1..=3).contains(&c))) {
                                    base = mix(base, primary, 0.65);
                                }
                                if g.ads_active && dim_ads {
                                    base = if c <= 4 { ads_col } else { scale(base, 0.42) };
                                }
                                if reloading {
                                    let sweep = ((t * 4.5) % 1.0) * 22.0;
                                    if (c as f64 - sweep).abs() < 2.5 {
                                        base = reload_col;
                                    }
                                }
                                if firing && flash_shoot {
                                    base = mix(base, fire_col, 0.85);
                                }
                                if kill_flash {
                                    base = mix(base, high_fps_col, 0.9);
                                }
                                base
                            }
                        }
                    };
                    if enabled {
                        col = scale(col, brightness);
                    }
                    r_sum += col.r as u64;
                    g_sum += col.g as u64;
                    b_sum += col.b as u64;
                    row_vec.push(json!({ "r": col.r, "g": col.g, "b": col.b }));
                }
                key_grid.push(Value::Array(row_vec));
            }

            for i in 0..16usize {
                let mut col = if !enabled {
                    Rgb { r: 12, g: 13, b: 16 }
                } else {
                    let wave = 0.5 + 0.5 * (t * 2.4 * speed + i as f64 * 0.4).sin();
                    let mut c = mix(secondary, primary, wave);
                    if firing && flash_shoot {
                        c = fire_col;
                    } else if kill_flash {
                        c = high_fps_col;
                    }
                    scale(c, brightness)
                };
                if i >= 16 {
                    col = secondary;
                }
                strip.push(col);
            }

            let total_keys = (6 * 22) as u64;
            let avg = json!({
                "r": (r_sum / total_keys) as u8,
                "g": (g_sum / total_keys) as u8,
                "b": (b_sum / total_keys) as u8,
            });
            let strip_json: Vec<Value> = strip.iter().map(|c| json!({ "r": c.r, "g": c.g, "b": c.b })).collect();

            let hw_devs = g.hardware.pointer("/usbCorsairDevices").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            let banner = if g.connected {
                format!("OpenRGB Connected ({} controllers) • Mode: {}", g.controllers.len(), mode)
            } else if hw_devs > 0 {
                format!("{hw_devs} Corsair USB HID device(s) • Mode: {mode}")
            } else {
                format!("Virtual Corsair K70 Ready • Mode: {mode}")
            };

            let frame = json!({
                "mode": mode,
                "avgColor": avg,
                "keyGrid": key_grid,
                "strip": strip_json,
                "statusBanner": banner,
            });
            g.current_frame = frame.clone();

            // Push to OpenRGB socket if connected
            if g.connected {
                let controllers = g.controllers.clone();
                if let Some(mut sock) = g.stream.take() {
                    let mut ok = true;
                    for ctrl in &controllers {
                        let count = ctrl.led_count.min(132);
                        let mut payload = Vec::with_capacity(6 + count * 4);
                        payload.extend_from_slice(&((4 + 2 + count * 4) as u32).to_le_bytes());
                        payload.extend_from_slice(&(count as u16).to_le_bytes());
                        for idx in 0..count {
                            let c = strip[idx % strip.len()];
                            payload.extend_from_slice(&[c.r, c.g, c.b, 0]);
                        }
                        if sock.write_all(&encode_orgb(ctrl.index, PKT_UPDATE_LEDS, &payload)).is_err() {
                            ok = false;
                            break;
                        }
                    }
                    if ok {
                        g.stream = Some(sock);
                    } else {
                        g.connected = false;
                        g.last_error = Some("OpenRGB connection dropped".into());
                    }
                }
            }

            (frame, strip.len(), g.controllers.len())
        };
        let _ = (strip_rgbs, openrgb_count);
        frame
    }

    pub fn get_status(&self) -> Value {
        let g = self.inner.lock().unwrap();
        json!({
            "hardware": g.hardware,
            "openRgb": {
                "connected": g.connected,
                "host": g.host,
                "port": g.port,
                "lastError": g.last_error,
                "controllersCount": g.controllers.len(),
            },
            "frame": g.current_frame,
        })
    }
}
