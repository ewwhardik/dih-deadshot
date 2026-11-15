use serde_json::{json, Value};
use std::arch::x86_64::__cpuid;
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::c_void;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
    SetupDiGetDeviceInterfaceDetailW, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT,
    SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W,
};
use windows::Win32::Devices::HumanInterfaceDevice::{
    HidD_GetAttributes, HidD_GetHidGuid, HidD_GetProductString, HIDD_ATTRIBUTES,
};
use windows::Win32::Foundation::{
    CloseHandle, FILETIME, GENERIC_READ, HANDLE, HWND, INVALID_HANDLE_VALUE, MAX_PATH,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows::Win32::Graphics::Gdi::{
    EnumDisplaySettingsExW, EnumDisplaySettingsW, DEVMODEW, EDS_RAWMODE, ENUM_CURRENT_SETTINGS,
};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryDataAvailable,
    WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest,
    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER,
    WINHTTP_QUERY_STATUS_CODE,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Memory::{SetProcessWorkingSetSizeEx, SETPROCESSWORKINGSETSIZEEX_FLAGS};
use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};
use windows::Win32::System::ProcessStatus::{
    EmptyWorkingSet, GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
};
use windows::Win32::System::SystemInformation::{
    GetSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetSystemTimes, OpenProcess, ProcessPowerThrottling,
    SetPriorityClass, SetProcessInformation, ABOVE_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS,
    NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
    PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
    PROCESS_POWER_THROTTLING_STATE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION,
    PROCESS_VM_READ,
};
use windows::Win32::UI::Controls::Dialogs::{
    GetOpenFileNameW, GetSaveFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_OVERWRITEPROMPT,
    OPENFILENAMEW,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN, SW_SHOWNORMAL};

extern "C" {
    fn dih_calc_jitter(rtts: *const f64, count: usize, out_mean: *mut f64, out_jitter: *mut f64);
}

struct LiveState {
    started_at: Instant,
    prev_idle: u64,
    prev_kernel: u64,
    prev_user: u64,
    timer_period_1ms: bool,
    rtt_window: VecDeque<f64>,
    last_ping_status: String,
    last_rtt_ms: Option<f64>,
    last_mean_ms: Option<f64>,
    last_jitter_ms: Option<f64>,
    ping_host: String,
    live_ping_enabled: bool,
    host_ram_target_mb: f64,
    auto_host_ram_guard: bool,
    webview_browser_pid: u32,
    cached_addr_host: String,
    cached_addr: Option<SocketAddr>,
    addr_resolved_at: Option<Instant>,
    last_probe_at: Option<Instant>,
    probe_in_flight: bool,
    last_host_trim_at: Option<Instant>,
    bg_started: bool,
}

static LIVE_STATE: OnceLock<Mutex<LiveState>> = OnceLock::new();
static STATIC_HW_CACHE: OnceLock<Value> = OnceLock::new();

fn state_lock() -> &'static Mutex<LiveState> {
    LIVE_STATE.get_or_init(|| {
        let (idle, kernel, user) = read_sys_times();
        Mutex::new(LiveState {
            started_at: Instant::now(),
            prev_idle: idle,
            prev_kernel: kernel,
            prev_user: user,
            timer_period_1ms: false,
            rtt_window: VecDeque::with_capacity(24),
            last_ping_status: "idle".to_string(),
            last_rtt_ms: None,
            last_mean_ms: None,
            last_jitter_ms: None,
            ping_host: "deadshot.io".to_string(),
            live_ping_enabled: true,
            host_ram_target_mb: 12.0,
            auto_host_ram_guard: true,
            webview_browser_pid: 0,
            cached_addr_host: String::new(),
            cached_addr: None,
            addr_resolved_at: None,
            last_probe_at: None,
            probe_in_flight: false,
            last_host_trim_at: None,
            bg_started: false,
        })
    })
}

pub fn to_wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_slice_to_string(slice: &[u16]) -> String {
    let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
    String::from_utf16_lossy(&slice[..end]).trim().to_string()
}

fn ft_to_u64(ft: FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

fn read_sys_times() -> (u64, u64, u64) {
    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_ok() {
            return (ft_to_u64(idle), ft_to_u64(kernel), ft_to_u64(user));
        }
    }
    (0, 0, 0)
}

fn cpuid_cpu_brand() -> (String, String) {
    let max_basic = __cpuid(0);
    let mut vendor_bytes = [0u8; 12];
    vendor_bytes[0..4].copy_from_slice(&max_basic.ebx.to_le_bytes());
    vendor_bytes[4..8].copy_from_slice(&max_basic.edx.to_le_bytes());
    vendor_bytes[8..12].copy_from_slice(&max_basic.ecx.to_le_bytes());
    let vendor = String::from_utf8_lossy(&vendor_bytes).trim().to_string();

    let ext = __cpuid(0x8000_0000);
    if ext.eax < 0x8000_0004 {
        return (vendor, "x86_64 Processor".to_string());
    }
    let mut raw = [0u8; 48];
    for (idx, leaf) in [0x8000_0002u32, 0x8000_0003u32, 0x8000_0004u32].iter().enumerate() {
        let r = __cpuid(*leaf);
        let base = idx * 16;
        raw[base..base + 4].copy_from_slice(&r.eax.to_le_bytes());
        raw[base + 4..base + 8].copy_from_slice(&r.ebx.to_le_bytes());
        raw[base + 8..base + 12].copy_from_slice(&r.ecx.to_le_bytes());
        raw[base + 12..base + 16].copy_from_slice(&r.edx.to_le_bytes());
    }
    let brand = String::from_utf8_lossy(&raw)
        .trim_matches('\0')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (vendor, brand)
}

fn query_primary_display() -> (u32, u32, u32, u32) {
    let mut cur_w = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1) as u32;
    let mut cur_h = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1) as u32;
    let mut cur_hz = 60u32;
    let mut max_hz = 60u32;

    unsafe {
        let mut dm = DEVMODEW {
            dmSize: std::mem::size_of::<DEVMODEW>() as u16,
            ..Default::default()
        };
        if EnumDisplaySettingsW(PCWSTR::null(), ENUM_CURRENT_SETTINGS, &mut dm).as_bool() {
            if dm.dmPelsWidth > 0 {
                cur_w = dm.dmPelsWidth;
            }
            if dm.dmPelsHeight > 0 {
                cur_h = dm.dmPelsHeight;
            }
            if dm.dmDisplayFrequency > 1 {
                cur_hz = dm.dmDisplayFrequency;
                max_hz = cur_hz;
            }
        }
        let mut mode_idx = 0u32;
        loop {
            let mut mode_dm = DEVMODEW {
                dmSize: std::mem::size_of::<DEVMODEW>() as u16,
                ..Default::default()
            };
            if !EnumDisplaySettingsExW(
                PCWSTR::null(),
                windows::Win32::Graphics::Gdi::ENUM_DISPLAY_SETTINGS_MODE(mode_idx),
                &mut mode_dm,
                EDS_RAWMODE,
            )
            .as_bool()
            {
                break;
            }
            if mode_dm.dmDisplayFrequency > max_hz && mode_dm.dmDisplayFrequency <= 1000 {
                max_hz = mode_dm.dmDisplayFrequency;
            }
            mode_idx += 1;
            if mode_idx > 2048 {
                break;
            }
        }
    }

    (cur_w, cur_h, cur_hz, max_hz)
}

fn query_dxgi_primary_gpu() -> (String, String) {
    unsafe {
        let Ok(factory): Result<IDXGIFactory1, _> = CreateDXGIFactory1() else {
            return ("Hardware GPU".to_string(), "?".to_string());
        };
        let mut best_name = String::new();
        let mut best_vram: usize = 0;

        let mut i = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            let adapter: IDXGIAdapter1 = adapter;
            if let Ok(desc) = adapter.GetDesc1() {
                let is_sw = (desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32)) != 0;
                let name = wide_slice_to_string(&desc.Description);
                let vram = desc.DedicatedVideoMemory;
                if best_name.is_empty() || (!is_sw && vram >= best_vram) {
                    best_name = name;
                    best_vram = vram;
                    if !is_sw && vram > 0 {
                        // keep checking if an even larger discrete GPU exists
                    }
                }
            }
            i += 1;
        }
        if best_name.is_empty() {
            best_name = "Hardware GPU".to_string();
        }
        let vram_gb = if best_vram > 0 {
            format!("{:.1}", best_vram as f64 / (1024.0 * 1024.0 * 1024.0))
        } else {
            "Shared".to_string()
        };
        (best_name, vram_gb)
    }
}

pub fn get_static_hardware() -> Value {
    STATIC_HW_CACHE
        .get_or_init(|| {
            let (vendor, cpu_model) = cpuid_cpu_brand();
            let mut sys_info = SYSTEM_INFO::default();
            unsafe { GetSystemInfo(&mut sys_info) };
            let logical = sys_info.dwNumberOfProcessors.max(1);
            let physical = (logical / 2).max(1);

            let mut mem = MEMORYSTATUSEX {
                dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
                ..Default::default()
            };
            let total_gb = unsafe {
                if GlobalMemoryStatusEx(&mut mem).is_ok() {
                    format!("{:.1}", mem.ullTotalPhys as f64 / (1024.0 * 1024.0 * 1024.0))
                } else {
                    "16.0".to_string()
                }
            };

            let (gpu_name, vram_gb) = query_dxgi_primary_gpu();
            let (disp_w, disp_h, disp_hz, max_hz) = query_primary_display();

            json!({
                "nativeBackend": true,
                "engine": "Rust + Win32 + WebView2",
                "cpu": {
                    "model": cpu_model,
                    "vendor": vendor,
                    "physicalCores": physical,
                    "logicalProcessors": logical,
                },
                "memory": {
                    "totalGb": total_gb,
                },
                "gpu": {
                    "primaryName": gpu_name,
                    "vramGb": vram_gb,
                },
                "displays": {
                    "primary": {
                        "width": disp_w,
                        "height": disp_h,
                        "displayFrequency": disp_hz,
                        "maxRefreshRate": max_hz,
                    }
                }
            })
        })
        .clone()
}

fn collect_child_pids(extra_root_pid: u32) -> Vec<u32> {
    unsafe {
        let cur_pid = GetCurrentProcessId();
        let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
        if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut pe = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut pe).is_ok() {
                loop {
                    children_map
                        .entry(pe.th32ParentProcessID)
                        .or_default()
                        .push(pe.th32ProcessID);
                    if Process32NextW(snap, &mut pe).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }

        let mut visited: HashSet<u32> = HashSet::new();
        let mut queue: VecDeque<u32> = VecDeque::new();
        let mut out: Vec<u32> = Vec::new();
        visited.insert(cur_pid);
        queue.push_back(cur_pid);
        if extra_root_pid > 0 && visited.insert(extra_root_pid) {
            queue.push_back(extra_root_pid);
            out.push(extra_root_pid);
        }

        while let Some(pid) = queue.pop_front() {
            if let Some(kids) = children_map.get(&pid) {
                for &kid in kids {
                    if visited.insert(kid) {
                        out.push(kid);
                        queue.push_back(kid);
                    }
                }
            }
        }
        out
    }
}

fn measure_split_memory_mb() -> (f64, f64, f64) {
    unsafe {
        let mut host_bytes: usize = 0;
        let mut webview_bytes: usize = 0;

        let mut pmc = PROCESS_MEMORY_COUNTERS::default();
        pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        if GetProcessMemoryInfo(GetCurrentProcess(), &mut pmc, pmc.cb).is_ok() {
            host_bytes = pmc.WorkingSetSize;
        }

        let wv_root_pid = state_lock().lock().unwrap().webview_browser_pid;
        for pid in collect_child_pids(wv_root_pid) {
            if let Ok(hproc) = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                false,
                pid,
            ) {
                let mut c_pmc = PROCESS_MEMORY_COUNTERS::default();
                c_pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                if GetProcessMemoryInfo(hproc, &mut c_pmc, c_pmc.cb).is_ok() {
                    webview_bytes = webview_bytes.saturating_add(c_pmc.WorkingSetSize);
                }
                let _ = CloseHandle(hproc);
            }
        }

        let host_mb = host_bytes as f64 / (1024.0 * 1024.0);
        let webview_mb = webview_bytes as f64 / (1024.0 * 1024.0);
        (host_mb, webview_mb, host_mb + webview_mb)
    }
}

fn trim_host_only_if_needed(target_mb: f64, force: bool) -> (f64, f64) {
    let clamped_target = target_mb.clamp(8.0, 64.0);
    let (host_before, _, _) = measure_split_memory_mb();
    if force || host_before > clamped_target + 1.0 {
        unsafe {
            let hproc = GetCurrentProcess();
            let _ = EmptyWorkingSet(hproc);
            let max_bytes = (clamped_target * 1024.0 * 1024.0) as usize;
            let min_bytes = (6usize * 1024 * 1024).min(max_bytes);
            let _ = SetProcessWorkingSetSizeEx(hproc, min_bytes, max_bytes, SETPROCESSWORKINGSETSIZEEX_FLAGS(0));
        }
    }
    let (host_after, _, _) = measure_split_memory_mb();
    (host_before, host_after)
}

fn parse_ping_host_port(raw: &str) -> (&str, u16) {
    let trimmed = raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let authority = trimmed.split('/').next().unwrap_or("deadshot.io").trim();
    if authority.is_empty() {
        return ("deadshot.io", 443);
    }
    if let Some((h, p_str)) = authority.rsplit_once(':') {
        if let Ok(p) = p_str.parse::<u16>() {
            if !h.is_empty() {
                return (h, p);
            }
        }
    }
    (authority, 443)
}

fn run_ping_probe_sync() {
    let (host_str, cached_opt) = {
        let mut g = state_lock().lock().unwrap();
        let host = g.ping_host.clone();
        let fresh = g.cached_addr_host == host
            && g.addr_resolved_at
                .map(|t| t.elapsed() < Duration::from_secs(60))
                .unwrap_or(false);
        let addr = if fresh { g.cached_addr } else { None };
        if g.probe_in_flight {
            return;
        }
        g.probe_in_flight = true;
        (host, addr)
    };

    let addr = match cached_opt {
        Some(sa) => Some(sa),
        None => {
            let (h, p) = parse_ping_host_port(&host_str);
            let resolved = (h, p)
                .to_socket_addrs()
                .ok()
                .and_then(|mut it| it.next());
            let mut g = state_lock().lock().unwrap();
            g.cached_addr_host = host_str.clone();
            g.cached_addr = resolved;
            g.addr_resolved_at = Some(Instant::now());
            resolved
        }
    };

    let measured = addr.and_then(|sa| {
        let t0 = Instant::now();
        TcpStream::connect_timeout(&sa, Duration::from_millis(850))
            .ok()
            .map(|_| t0.elapsed().as_secs_f64() * 1000.0)
    });

    let mut guard = state_lock().lock().unwrap();
    guard.probe_in_flight = false;
    guard.last_probe_at = Some(Instant::now());
    match measured {
        Some(rtt) => {
            if guard.rtt_window.len() >= 20 {
                guard.rtt_window.pop_front();
            }
            guard.rtt_window.push_back(rtt);
            let slice: Vec<f64> = guard.rtt_window.iter().copied().collect();
            let mut mean = rtt;
            let mut jitter = 0.0;
            unsafe {
                dih_calc_jitter(slice.as_ptr(), slice.len(), &mut mean, &mut jitter);
            }
            guard.last_ping_status = "online".to_string();
            guard.last_rtt_ms = Some((rtt * 10.0).round() / 10.0);
            guard.last_mean_ms = Some((mean * 10.0).round() / 10.0);
            guard.last_jitter_ms = Some((jitter * 10.0).round() / 10.0);
        }
        None => {
            guard.cached_addr = None;
            guard.addr_resolved_at = None;
            guard.last_ping_status = "offline".to_string();
            guard.last_rtt_ms = None;
            guard.last_mean_ms = None;
            guard.last_jitter_ms = None;
        }
    }
}

pub fn configure_telemetry(
    ping_host: &str,
    live_ping_enabled: bool,
    host_ram_target_mb: f64,
    auto_host_ram_guard: bool,
    webview_browser_pid: u32,
) {
    let host_clean = if ping_host.trim().is_empty() {
        "deadshot.io".to_string()
    } else {
        ping_host.trim().to_string()
    };
    let mut g = state_lock().lock().unwrap();
    if g.ping_host != host_clean {
        g.ping_host = host_clean;
        g.cached_addr = None;
        g.addr_resolved_at = None;
        g.rtt_window.clear();
    }
    g.live_ping_enabled = live_ping_enabled;
    g.host_ram_target_mb = host_ram_target_mb.clamp(8.0, 64.0);
    g.auto_host_ram_guard = auto_host_ram_guard;
    if webview_browser_pid > 0 {
        g.webview_browser_pid = webview_browser_pid;
    }
}

static PING_INTERVAL_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(3500);

pub fn set_ping_interval_ms(ms: u64) {
    PING_INTERVAL_MS.store(ms.clamp(1000, 15000), std::sync::atomic::Ordering::Relaxed);
}

pub fn start_background_telemetry() {
    let should_spawn = {
        let mut g = state_lock().lock().unwrap();
        if g.bg_started {
            false
        } else {
            g.bg_started = true;
            true
        }
    };
    if !should_spawn {
        return;
    }
    std::thread::spawn(|| {
        // Initial non-blocking probe right away
        run_ping_probe_sync();
        loop {
            let sleep_ms = PING_INTERVAL_MS
                .load(std::sync::atomic::Ordering::Relaxed)
                .clamp(1000, 15000);
            std::thread::sleep(Duration::from_millis(sleep_ms));
            let (live_ping, auto_guard, target_mb, due_trim) = {
                let g = state_lock().lock().unwrap();
                let trim_ready = g
                    .last_host_trim_at
                    .map(|t| t.elapsed() >= Duration::from_secs(8))
                    .unwrap_or(true);
                (
                    g.live_ping_enabled,
                    g.auto_host_ram_guard,
                    g.host_ram_target_mb,
                    trim_ready,
                )
            };
            if auto_guard && due_trim {
                let (before, after) = trim_host_only_if_needed(target_mb, false);
                if (before - after).abs() > 0.25 {
                    state_lock().lock().unwrap().last_host_trim_at = Some(Instant::now());
                }
            }
            if live_ping {
                run_ping_probe_sync();
            }
        }
    });
}

pub fn get_live_metrics() -> Value {
    let mut mem = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe {
        let _ = GlobalMemoryStatusEx(&mut mem);
    }
    let total_gb = mem.ullTotalPhys as f64 / (1024.0 * 1024.0 * 1024.0);
    let avail_gb = mem.ullAvailPhys as f64 / (1024.0 * 1024.0 * 1024.0);
    let used_gb = (total_gb - avail_gb).max(0.0);

    let (idle, kernel, user) = read_sys_times();
    let (host_mb, webview_mb, client_mb) = measure_split_memory_mb();

    let mut guard = state_lock().lock().unwrap();
    let d_idle = idle.saturating_sub(guard.prev_idle);
    let d_kernel = kernel.saturating_sub(guard.prev_kernel);
    let d_user = user.saturating_sub(guard.prev_user);
    guard.prev_idle = idle;
    guard.prev_kernel = kernel;
    guard.prev_user = user;

    let d_total = d_kernel.saturating_add(d_user);
    let cpu_pct = if d_total > 0 {
        (((d_total.saturating_sub(d_idle)) as f64 / d_total as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    json!({
        "cpuPercent": (cpu_pct * 10.0).round() / 10.0,
        "ram": {
            "usedGb": format!("{:.1}", used_gb),
            "totalGb": format!("{:.1}", total_gb),
            "usedPercent": mem.dwMemoryLoad,
        },
        "hostMemoryMb": (host_mb * 10.0).round() / 10.0,
        "webviewMemoryMb": webview_mb.round(),
        "clientMemoryMb": client_mb.round(),
        "hostRamTargetMb": guard.host_ram_target_mb,
        "uptimeSec": guard.started_at.elapsed().as_secs(),
        "network": {
            "host": guard.ping_host,
            "status": guard.last_ping_status,
            "rttMs": guard.last_rtt_ms,
            "meanMs": guard.last_mean_ms,
            "jitterMs": guard.last_jitter_ms,
        }
    })
}

pub fn probe_deadshot_latency() -> Value {
    let should_kick = {
        let g = state_lock().lock().unwrap();
        !g.probe_in_flight
            && g.last_probe_at
                .map(|t| t.elapsed() >= Duration::from_millis(900))
                .unwrap_or(true)
    };
    if should_kick {
        std::thread::spawn(|| {
            run_ping_probe_sync();
        });
    }

    let guard = state_lock().lock().unwrap();
    json!({
        "host": guard.ping_host,
        "status": guard.last_ping_status,
        "rttMs": guard.last_rtt_ms,
        "jitterMs": guard.last_jitter_ms,
        "meanMs": guard.last_mean_ms,
    })
}

unsafe fn apply_perf_to_handle(h: HANDLE, priority: &str, disable_power_throttling: bool) {
    let class = match priority {
        "high" => HIGH_PRIORITY_CLASS,
        "above_normal" => ABOVE_NORMAL_PRIORITY_CLASS,
        _ => NORMAL_PRIORITY_CLASS,
    };
    let _ = SetPriorityClass(h, class);

    let state = if disable_power_throttling {
        PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED
                | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
            StateMask: 0,
        }
    } else {
        PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: 0,
            StateMask: 0,
        }
    };
    let _ = SetProcessInformation(
        h,
        ProcessPowerThrottling,
        &state as *const _ as *const c_void,
        std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
    );
}

pub fn apply_runtime_perf(
    low_latency_timer: bool,
    prevent_sleep: bool,
    priority: &str,
    disable_power_throttling: bool,
    webview_browser_pid: u32,
) {
    unsafe {
        apply_perf_to_handle(GetCurrentProcess(), priority, disable_power_throttling);

        for pid in collect_child_pids(webview_browser_pid) {
            if let Ok(h) = OpenProcess(PROCESS_SET_INFORMATION, false, pid) {
                apply_perf_to_handle(h, priority, disable_power_throttling);
                let _ = CloseHandle(h);
            }
        }

        if prevent_sleep {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }

        let mut guard = state_lock().lock().unwrap();
        if webview_browser_pid > 0 {
            guard.webview_browser_pid = webview_browser_pid;
        }
        if low_latency_timer && !guard.timer_period_1ms {
            timeBeginPeriod(1);
            guard.timer_period_1ms = true;
        } else if !low_latency_timer && guard.timer_period_1ms {
            timeEndPeriod(1);
            guard.timer_period_1ms = false;
        }
    }
}

pub fn trim_working_set() -> Value {
    let target = state_lock().lock().unwrap().host_ram_target_mb;
    let (_, webview_before, client_before) = measure_split_memory_mb();
    let (host_before, host_after) = trim_host_only_if_needed(target, true);
    let freed = (host_before - host_after).max(0.0);
    json!({
        "ok": true,
        "freedMb": (freed * 10.0).round() / 10.0,
        "afterMb": (host_after + webview_before).round(),
        "hostBeforeMb": (host_before * 10.0).round() / 10.0,
        "hostAfterMb": (host_after * 10.0).round() / 10.0,
        "webviewMb": webview_before.round(),
        "clientBeforeMb": client_before.round(),
    })
}

pub fn scan_corsair_hardware() -> Value {
    let mut icue_running = false;
    let mut corsair_service_running = false;
    let mut openrgb_running = false;

    unsafe {
        if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut pe = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut pe).is_ok() {
                loop {
                    let exe = wide_slice_to_string(&pe.szExeFile).to_ascii_lowercase();
                    if exe.contains("icue") {
                        icue_running = true;
                    }
                    if exe.contains("corsair") {
                        corsair_service_running = true;
                    }
                    if exe.contains("openrgb") {
                        openrgb_running = true;
                    }
                    if Process32NextW(snap, &mut pe).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
    }

    let mut usb_devices = Vec::new();
    let mut seen_pids = Vec::new();
    unsafe {
        let hid_guid = HidD_GetHidGuid();
        if let Ok(dev_info) = SetupDiGetClassDevsW(
            Some(&hid_guid),
            PCWSTR::null(),
            None,
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        ) {
            let mut idx = 0u32;
            loop {
                let mut if_data = SP_DEVICE_INTERFACE_DATA {
                    cbSize: std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
                    ..Default::default()
                };
                if SetupDiEnumDeviceInterfaces(dev_info, None, &hid_guid, idx, &mut if_data).is_err() {
                    break;
                }
                idx += 1;

                let mut req_len = 0u32;
                let _ = SetupDiGetDeviceInterfaceDetailW(dev_info, &if_data, None, 0, Some(&mut req_len), None);
                if req_len < 8 || req_len > 4096 {
                    continue;
                }

                let mut buf = vec![0u8; req_len as usize];
                let detail = buf.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
                (*detail).cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;

                if SetupDiGetDeviceInterfaceDetailW(
                    dev_info,
                    &if_data,
                    Some(detail),
                    req_len,
                    None,
                    None,
                )
                .is_ok()
                {
                    let dev_path_ptr = (*detail).DevicePath.as_ptr();
                    if let Ok(fh) = CreateFileW(
                        PCWSTR(dev_path_ptr),
                        0, // query-only metadata access without exclusive claim
                        FILE_SHARE_READ | FILE_SHARE_WRITE,
                        None,
                        OPEN_EXISTING,
                        FILE_ATTRIBUTE_NORMAL,
                        None,
                    ) {
                        let mut attrs = HIDD_ATTRIBUTES {
                            Size: std::mem::size_of::<HIDD_ATTRIBUTES>() as u32,
                            ..Default::default()
                        };
                        if HidD_GetAttributes(fh, &mut attrs) && attrs.VendorID == 0x1B1C {
                            if !seen_pids.contains(&attrs.ProductID) {
                                seen_pids.push(attrs.ProductID);
                                let mut name_buf = [0u16; 128];
                                let prod_name = if HidD_GetProductString(
                                    fh,
                                    name_buf.as_mut_ptr() as *mut c_void,
                                    (name_buf.len() * 2) as u32,
                                ) {
                                    let s = wide_slice_to_string(&name_buf);
                                    if s.is_empty() {
                                        format!("Corsair HID (PID {:04X})", attrs.ProductID)
                                    } else {
                                        s
                                    }
                                } else {
                                    format!("Corsair HID (PID {:04X})", attrs.ProductID)
                                };
                                usb_devices.push(json!({
                                    "vendorId": "0x1B1C",
                                    "productId": format!("0x{:04X}", attrs.ProductID),
                                    "name": prod_name,
                                }));
                            }
                        }
                        let _ = CloseHandle(fh);
                    }
                }
            }
            let _ = SetupDiDestroyDeviceInfoList(dev_info);
        }
    }
    // Keep unused import suppression clean for HANDLE / GENERIC_READ / INVALID_HANDLE_VALUE
    let _ = (HANDLE::default(), GENERIC_READ, INVALID_HANDLE_VALUE);

    json!({
        "scannedAt": chrono_like_timestamp(),
        "icueRunning": icue_running,
        "corsairServiceRunning": corsair_service_running,
        "openRgbProcessRunning": openrgb_running,
        "usbCorsairDevices": usb_devices,
        "webHidDevices": [],
    })
}

pub fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("epoch-{secs}")
}

pub fn shell_open_target(target: &str) {
    let op = to_wide_null("open");
    let tgt = to_wide_null(target);
    unsafe {
        ShellExecuteW(
            None,
            PCWSTR(op.as_ptr()),
            PCWSTR(tgt.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

pub fn open_folder(path: &Path) {
    shell_open_target(&path.to_string_lossy());
}

pub fn pick_open_file(hwnd: HWND, filter_pairs_double_null: &[u16], title: &str) -> Option<String> {
    let mut file_buf = [0u16; MAX_PATH as usize * 2];
    let title_w = to_wide_null(title);
    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: hwnd,
        lpstrFilter: PCWSTR(filter_pairs_double_null.as_ptr()),
        lpstrFile: PWSTR(file_buf.as_mut_ptr()),
        nMaxFile: file_buf.len() as u32,
        lpstrTitle: PCWSTR(title_w.as_ptr()),
        Flags: OFN_EXPLORER | OFN_FILEMUSTEXIST,
        ..Default::default()
    };
    unsafe {
        if GetOpenFileNameW(&mut ofn).as_bool() {
            return Some(wide_slice_to_string(&file_buf));
        }
    }
    None
}

pub fn pick_save_file(hwnd: HWND, default_name: &str, filter_pairs_double_null: &[u16], def_ext: &str, title: &str) -> Option<String> {
    let mut file_buf = [0u16; MAX_PATH as usize * 2];
    let def_w: Vec<u16> = default_name.encode_utf16().collect();
    let copy_len = def_w.len().min(file_buf.len() - 1);
    file_buf[..copy_len].copy_from_slice(&def_w[..copy_len]);
    let title_w = to_wide_null(title);
    let ext_w = to_wide_null(def_ext);

    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: hwnd,
        lpstrFilter: PCWSTR(filter_pairs_double_null.as_ptr()),
        lpstrFile: PWSTR(file_buf.as_mut_ptr()),
        nMaxFile: file_buf.len() as u32,
        lpstrTitle: PCWSTR(title_w.as_ptr()),
        lpstrDefExt: PCWSTR(ext_w.as_ptr()),
        Flags: OFN_EXPLORER | OFN_OVERWRITEPROMPT,
        ..Default::default()
    };
    unsafe {
        if GetSaveFileNameW(&mut ofn).as_bool() {
            return Some(wide_slice_to_string(&file_buf));
        }
    }
    None
}

pub fn wide_filter(parts: &[(&str, &str)]) -> Vec<u16> {
    let mut out = Vec::new();
    for (label, pattern) in parts {
        out.extend(label.encode_utf16());
        out.push(0);
        out.extend(pattern.encode_utf16());
        out.push(0);
    }
    out.push(0);
    out
}

pub fn https_get_deadshot(rel_path: &str, user_agent: &str) -> Result<Vec<u8>, String> {
    let ua = to_wide_null(user_agent);
    let host = to_wide_null("deadshot.io");
    let verb = to_wide_null("GET");
    let clean = format!("/{}", rel_path.trim_start_matches('/'));
    let path_w = to_wide_null(&clean);

    unsafe {
        let sess = WinHttpOpen(
            PCWSTR(ua.as_ptr()),
            WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        );
        if sess.is_null() {
            return Err("WinHttpOpen failed".into());
        }
        let conn = WinHttpConnect(sess, PCWSTR(host.as_ptr()), 443, 0);
        if conn.is_null() {
            let _ = WinHttpCloseHandle(sess);
            return Err("WinHttpConnect failed".into());
        }
        let req = WinHttpOpenRequest(
            conn,
            PCWSTR(verb.as_ptr()),
            PCWSTR(path_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            std::ptr::null_mut(),
            WINHTTP_FLAG_SECURE,
        );
        if req.is_null() {
            let _ = WinHttpCloseHandle(conn);
            let _ = WinHttpCloseHandle(sess);
            return Err("WinHttpOpenRequest failed".into());
        }

        let ok_send = WinHttpSendRequest(req, None, None, 0, 0, 0).is_ok()
            && WinHttpReceiveResponse(req, std::ptr::null_mut()).is_ok();
        if !ok_send {
            let _ = WinHttpCloseHandle(req);
            let _ = WinHttpCloseHandle(conn);
            let _ = WinHttpCloseHandle(sess);
            return Err(format!("WinHTTP request failed for {clean}"));
        }

        let mut status: u32 = 0;
        let mut slen = std::mem::size_of::<u32>() as u32;
        let _ = WinHttpQueryHeaders(
            req,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some(&mut status as *mut u32 as *mut c_void),
            &mut slen,
            std::ptr::null_mut(),
        );
        if status >= 400 {
            let _ = WinHttpCloseHandle(req);
            let _ = WinHttpCloseHandle(conn);
            let _ = WinHttpCloseHandle(sess);
            return Err(format!("HTTP {status} for {clean}"));
        }

        let mut out = Vec::new();
        loop {
            let mut avail: u32 = 0;
            if WinHttpQueryDataAvailable(req, &mut avail).is_err() || avail == 0 {
                break;
            }
            let chunk_len = avail.min(65536) as usize;
            let mut buf = vec![0u8; chunk_len];
            let mut read: u32 = 0;
            if WinHttpReadData(req, buf.as_mut_ptr() as *mut c_void, chunk_len as u32, &mut read).is_err() || read == 0 {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
        }

        let _ = WinHttpCloseHandle(req);
        let _ = WinHttpCloseHandle(conn);
        let _ = WinHttpCloseHandle(sess);
        Ok(out)
    }
}
