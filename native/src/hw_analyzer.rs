//! Hardware Power Analyzer & Advanced Win32 Scheduling Optimizer.
//! Computes deterministic 10-100 PC Power Score and configures priority boost,
//! performance core affinity, and confirmation dialogs natively via Win32.

use serde_json::{json, Value};

#[cfg(windows)]
use windows::{
    core::w,
    Win32::{
        Foundation::{CloseHandle, HWND},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            SystemInformation::{GetSystemInfo, SYSTEM_INFO},
            Threading::{
                GetCurrentProcessId, GetProcessAffinityMask, OpenProcess, SetProcessAffinityMask,
                SetProcessPriorityBoost, PROCESS_QUERY_INFORMATION, PROCESS_SET_INFORMATION,
            },
        },
        UI::WindowsAndMessaging::{
            MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_YESNO,
        },
    },
};

fn contains_any_icase(haystack: &str, needles: &[&str]) -> bool {
    let lower = haystack.to_ascii_lowercase();
    needles.iter().any(|n| lower.contains(n))
}

/// Computes deterministic PC Power Score (10..100) from static DXGI/CPUID/Memory summary.
pub fn analyze_hardware_power(hw: &Value) -> Value {
    let cpu_model = hw["cpu"]["model"].as_str().unwrap_or("Unknown CPU");
    let phys_cores = hw["cpu"]["physicalCores"].as_u64().unwrap_or(4);
    let threads = hw["cpu"]["logicalProcessors"].as_u64().unwrap_or(phys_cores);
    let clock_mhz = hw["cpu"]["baseClockMhz"].as_u64().unwrap_or(2400);

    let gpu_name = hw["gpu"]["primaryName"].as_str().unwrap_or("Hardware GPU");
    let vram_gb = hw["gpu"]["vramGb"].as_f64().unwrap_or(0.0);
    let ram_gb = hw["memory"]["totalGb"].as_f64().unwrap_or(8.0);

    let hz = hw["displays"]["primary"]["maxRefreshRate"]
        .as_u64()
        .or_else(|| hw["displays"]["primary"]["displayFrequency"].as_u64())
        .unwrap_or(60);

    // 1. CPU score (0..35)
    let mut cpu_score: i64 = if phys_cores >= 8 || threads >= 16 {
        22
    } else if phys_cores >= 6 || threads >= 12 {
        18
    } else if phys_cores >= 4 || threads >= 8 {
        13
    } else {
        7
    };

    cpu_score += if clock_mhz >= 3600 {
        6
    } else if clock_mhz >= 2600 {
        4
    } else {
        2
    };

    if contains_any_icase(cpu_model, &["celeron", "pentium", "athlon", "atom", "n40", "n41", "n30"]) {
        cpu_score = (cpu_score - 5).max(5);
    } else if contains_any_icase(
        cpu_model,
        &[
            "i5-12", "i5-13", "i5-14", "i7-12", "i7-13", "i7-14", "i9-", "ultra", "ryzen 7",
            "ryzen 9", "ryzen 5 5", "ryzen 5 7", "ryzen 5 9",
        ],
    ) {
        cpu_score += 7;
    } else if contains_any_icase(cpu_model, &["ryzen", "core i3", "core i5", "core i7", "core i9"]) {
        cpu_score += 4;
    }
    cpu_score = cpu_score.clamp(5, 35);

    // 2. GPU score (0..35)
    let is_high_discrete = contains_any_icase(
        gpu_name,
        &[
            "rtx 40", "rtx 50", "rtx 307", "rtx 308", "rtx 309", "rx 68", "rx 69", "rx 77",
            "rx 78", "rx 79", "rx 90",
        ],
    );
    let is_mid_discrete = contains_any_icase(
        gpu_name,
        &["nvidia", "geforce", "rtx", "gtx", "radeon rx", "arc a", "arc b"],
    );
    let is_good_apu = contains_any_icase(gpu_name, &["iris xe", "780m", "680m", "vega 8", "vega 7", "mx"]);

    let gpu_tier = if is_high_discrete {
        30
    } else if is_mid_discrete {
        24
    } else if is_good_apu {
        15
    } else {
        8
    };
    let vram_bonus = if vram_gb >= 8.0 {
        5
    } else if vram_gb >= 4.0 {
        4
    } else if vram_gb >= 2.0 {
        2
    } else {
        1
    };
    let gpu_score = (gpu_tier + vram_bonus).min(35);

    // 3. RAM & Display scores (0..15 each)
    let ram_score = if ram_gb >= 30.0 {
        15
    } else if ram_gb >= 15.0 {
        12
    } else if ram_gb >= 11.0 {
        9
    } else if ram_gb >= 7.0 {
        6
    } else {
        3
    };
    let hz_score = if hz >= 240 {
        15
    } else if hz >= 144 {
        12
    } else if hz >= 100 {
        9
    } else if hz >= 70 {
        7
    } else {
        6
    };

    let power_score = (cpu_score + gpu_score + ram_score + hz_score).clamp(10, 100);

    let (
        tier,
        tier_label,
        recommended_preset,
        dpr_scale,
        reduce_motion,
        ram_target_mb,
        prefer_p_cores,
    ) = if power_score >= 76 {
        (
            "extreme_workstation",
            "Extreme Esports Workstation",
            "max_compute",
            1.0,
            false,
            14,
            threads >= 12,
        )
    } else if power_score >= 54 {
        (
            "esports_desktop",
            "High-FPS Esports Rig",
            "max_compute",
            1.0,
            false,
            12,
            false,
        )
    } else if power_score < 36 {
        (
            "low_end_pc",
            "Battery / Low-End Device",
            "low_end",
            0.8,
            true,
            10,
            false,
        )
    } else {
        (
            "balanced_laptop",
            "Balanced Competitive",
            "balanced",
            0.95,
            false,
            12,
            false,
        )
    };

    json!({
        "powerScore": power_score,
        "tier": tier,
        "tierLabel": tier_label,
        "recommendedPreset": recommended_preset,
        "breakdown": {
            "cpuScore": cpu_score,
            "gpuScore": gpu_score,
            "ramScore": ram_score,
            "hzScore": hz_score,
        },
        "recommendations": {
            "presetMode": recommended_preset,
            "canvasDprScale": dpr_scale,
            "reduceMotionUi": reduce_motion,
            "hostRamTargetMb": ram_target_mb,
            "preferPerformanceCores": prefer_p_cores,
            "disablePowerThrottling": power_score >= 36,
            "webglLowLatency": true,
        },
        "detectedSummary": format!(
            "{} ({}C/{}T) • {} • {:.1}GB RAM • {}Hz",
            cpu_model, phys_cores, threads, gpu_name, ram_gb, hz
        ),
        "hardware": hw,
    })
}

#[cfg(windows)]
fn collect_tree_pids() -> Vec<u32> {
    let root = unsafe { GetCurrentProcessId() };
    let mut pids = vec![root];
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return pids;
        };
        let mut pairs: Vec<(u32, u32)> = Vec::new();
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);

        let mut i = 0;
        while i < pids.len() {
            let parent = pids[i];
            for &(pid, ppid) in &pairs {
                if ppid == parent && !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
            i += 1;
        }
    }
    pids
}

/// Applies Win32 SetProcessPriorityBoost and optional primary-core affinity mask across Dih + WebView2 tree.
pub fn apply_advanced_win32_perf(enable_priority_boost: bool, prefer_perf_cores: bool) {
    #[cfg(windows)]
    unsafe {
        let mut sys_info = SYSTEM_INFO::default();
        GetSystemInfo(&mut sys_info);
        let logical_count = sys_info.dwNumberOfProcessors;

        for pid in collect_tree_pids() {
            if let Ok(hproc) =
                OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, false, pid)
            {
                // bDisablePriorityBoost = FALSE enables dynamic OS boost for wakeups
                let _ = SetProcessPriorityBoost(hproc, !enable_priority_boost);

                let mut proc_mask: usize = 0;
                let mut sys_mask: usize = 0;
                if GetProcessAffinityMask(hproc, &mut proc_mask, &mut sys_mask).is_ok()
                    && sys_mask != 0
                {
                    if prefer_perf_cores && logical_count >= 8 {
                        // Prefer primary logical group / lower 8-12 primary P-cores while never leaving zero mask
                        let mut target_mask: usize = 0;
                        let limit = (logical_count / 2).clamp(4, 12);
                        let mut picked = 0u32;
                        for bit in 0..usize::BITS {
                            let m = 1usize << bit;
                            if (sys_mask & m) != 0 {
                                target_mask |= m;
                                picked += 1;
                                if picked >= limit {
                                    break;
                                }
                            }
                        }
                        if target_mask != 0 {
                            let _ = SetProcessAffinityMask(hproc, target_mask);
                        }
                    } else if proc_mask != sys_mask {
                        let _ = SetProcessAffinityMask(hproc, sys_mask);
                    }
                }
                let _ = CloseHandle(hproc);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (enable_priority_boost, prefer_perf_cores);
}

#[cfg(windows)]
pub fn confirm_close_dialog(hwnd: HWND) -> bool {
    unsafe {
        let res = MessageBoxW(
            Some(hwnd),
            w!("Close Dih Client and exit Deadshot.io?"),
            w!("Confirm Exit — Dih Client"),
            MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2,
        );
        res == IDYES
    }
}
