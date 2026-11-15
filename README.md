# Dih Client v0.2 (`dih-deadhshot`)

Minimalist, obsidian-grey, uncapped-FPS **Deadshot.io** native Windows client engineered in **Rust + C + Win32 + Edge WebView2** (with Electron dual-host parity), built for peak WebGL frame pacing, **10–15 MB** native host RAM overhead, zero-stall networking, and **156+ built-in controls**.

**Developer & Credits**
- **GitHub:** [`ewwhardik`](https://github.com/ewwhardik) · Repository: [`ewwhardik/dih-deadhshot`](https://github.com/ewwhardik/dih-deadhshot)
- **Discord:** `ewwhardik`

---

## Application Overview

Dih wraps **Deadshot.io** inside a stripped Win32 native host (`Dih.exe`) + C timing/statistics kernel (`fast_stats.c`) without mutating game code, while eliminating wrapper overhead during active matches:

### 1. Compute Modes (`Max Compute` Default vs `Low-End Device`)
- **`Max Compute` (Default):** Uncapped `2000–3000+ FPS` flags (`--disable-frame-rate-limit`, `--disable-gpu-vsync`, `--force-high-performance-gpu`, `--enable-gpu-rasterization`, `--enable-zero-copy`, `--use-angle=d3d11`), `HIGH_PRIORITY_CLASS` applied across `Dih.exe` and every `msedgewebview2.exe` GPU/Renderer subprocess, Windows 11 **EcoQoS power throttling disabled**, `1ms` high-resolution scheduler timer (`timeBeginPeriod(1)`), `4096 MB` V8 heap ceiling, zero HUD backdrop-blur stalls, and display sleep lock.
- **`Balanced Esports`:** Uncapped FPS with `ABOVE_NORMAL_PRIORITY_CLASS` hybrid power scaling and `2048 MB` V8 heap.
- **`Low-End Device`:** Designed for 4–8 GB RAM laptops & integrated GPUs — enables WebView2 `LOW` memory target level (`ICoreWebView2_19`), `60 FPS` software frame pacer cap, `10 MB` host RAM guard target, `--renderer-process-limit=1`, compact disk/media cache caps, `1024 MB` V8 heap, and reduced HUD sampling cadence.

### 2. Host RAM Customization (`10–15 MB` Target)
- Live split readout tracks **Native Host (`Dih.exe`)** separately from the **WebView2 Chromium/WebGL subprocess tree**.
- Adjustable **`10–15 MB` Host RAM Target** slider with **Auto Host RAM Guard** gently trims excess working-set pages only on `Dih.exe` — never aggressively evicting WebGL/GPU textures on `msedgewebview2.exe`, preventing mid-gunfight page-fault hitches.

### 3. Network Latency & Zero-Stall Resource Interceptor
- **Targeted WebView2 Filtering:** Scopes `AddWebResourceRequestedFilter` strictly to Deadshot asset/skin/promo URLs and known ad/tracker domains (no wildcard `*` COM IPC bottleneck on game JS, WASM, matchmaking, or WebSockets).
- **Non-Blocking Background Ping & Jitter Engine:** Off-thread cached-DNS TCP probe + C-kernel jitter calculation prevents UI stalls while keeping `PING` / `JITTER` live inside the HUD.
- **QUIC & Encrypted DNS (DoH) Optimizer:** Supports `--enable-quic`, `--disable-background-networking`, `--disable-domain-reliability`, and optional Cloudflare (`1.1.1.1`), Google (`8.8.8.8`), or Quad9 (`9.9.9.9`) DNS-over-HTTPS presets, plus custom configurable Ping Target Host.

### 4. Genuine Hardware & Zero-GC Telemetry HUD
- **Hardware Detection:** `x86_64` `__cpuid` processor model, DXGI `IDXGIFactory1` GPU & dedicated VRAM, Win32 `EnumDisplaySettingsExW` current & max display refresh rates (`Hz`), Win32 `GetSystemTimes` CPU %, `GlobalMemoryStatusEx` RAM, and full child-process memory tree inspection.
- **Zero-Allocation Frame Metrics:** Fixed circular `Float64Array` buffers for unhooked `rAF` FPS, Min/Max bounds, `1%` low stability, sub-ms frametime sparkline, and Deadshot `dsio:settings:2` / `dsio:keybinds:2` live inspection.

### 5. 3D Gun Skin Studio, Asset Swapper & Corsair/OpenRGB
- **Client-Side Skin Changer (`F7`):** Instant in-memory & disk-cached weapon texture overrides across all 7 Deadshot weapon classes (26 official skins across wear tiers `0–4`, `*compsmall`/`*compmobile` sync, custom scope reticles, skybox swaps, and centered `1400×300` obsidian SVG Dih menu logo).
- **Custom 3D Skin Painter Studio:** Interactive Three.js `.glb` Draco weapon painter exporting custom `1024×1024` skins straight to `%APPDATA%\dih-client\custom-skins`.
- **Corsair HID & OpenRGB (`127.0.0.1:6742`):** Non-blocking OpenRGB SDK socket bridge + USB HID (`VID 0x1B1C`) scan driving 20 Hz 10-mode reactive RGB lighting (muzzle flash, reload sweep, ADS focus dim, FPS thermal gradient, ping aura, theme sync) and a 6×22 Virtual K70 Studio Lab.

---

## Controls & Default Hotkeys (Rebindable)

| Key | Action |
|---|---|
| `RightShift` or `O` | Open / Close Dih Command Center |
| `F5` | Reload Game & Textures |
| `F7` | Open Dih 3D Gun Skin Studio, Corsair RGB Lab & Deadshot RE Explorer |
| `F8` | Master Mute / Unmute Client |
| `F9` | Hide / Restore All HUD Overlays |
| `F10` | Capture PNG Screenshot (`%APPDATA%\dih-client\screenshots`) |
| `F11` | Toggle Borderless Fullscreen |
| `B` | Toggle Match Stopwatch |
| `[` / `]` / `\` | Decrement / Track Kills, Deaths & Assists inside K/D Tracker |

---

## Building & Running

### Quick Launch (Release ZIP)
1. Download `Dih-Client-v0.2-win-x64.zip` from [**Releases**](https://github.com/ewwhardik/dih-deadhshot/releases/tag/v0.2).
2. Extract anywhere and launch `Dih.exe` (Windows 10/11 x64 with Microsoft Edge WebView2 Runtime).

### Build Native Binary From Source
Requires Rust (`1.82+` with `x86_64-pc-windows-gnullvm` target & `rust-lld`), Node.js (`v20+`), and MSVC Build Tools (`cvtres.exe`).

```powershell
npm.cmd install
npm.cmd run build:native
```

Packaged output is generated in `dist\Dih\` (`Dih.exe`, `WebView2Loader.dll`, `assets/`, `swap/`, `studio/`).

### Automated Verification Suite
```powershell
npm.cmd test
```
Runs syntax checks, 156+ feature schema/default validation, compute preset & RAM guard checks, real Win32 hardware detection, OpenRGB binary packet tests, SkinManager resource tests, live Electron CDP Game+Studio end-to-end tests, and native `dist\Dih\Dih.exe --smoke-test` verification.
