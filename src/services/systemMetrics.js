/**
 * Real PC Hardware, Display Refresh Rate, Process Priority & Live Telemetry Service.
 * Reports authentic hardware metrics without synthetic inflation.
 */

const os = require("os");
const net = require("net");
const { execFile } = require("child_process");

class SystemMetricsService {
  constructor() {
    this.prevCpuTimes = this._sampleCpuTimes();
    this.wmiInfo = {
      loaded: false,
      gpus: [],
      cpus: [],
      monitorMaxHz: null,
      monitorCurrentHz: null,
    };
    this.pingHistory = [];
    this.lastPing = {
      host: "deadshot.io",
      rttMs: null,
      avgMs: null,
      minMs: null,
      jitterMs: null,
      status: "pending",
      updatedAt: null,
    };
    this._electronApp = null;
    this._electronScreen = null;
    this._pingTimer = null;
  }

  attachElectron({ app, screen }) {
    this._electronApp = app;
    this._electronScreen = screen;
  }

  async init() {
    await this._probeWmiHardware();
    this.probeDeadshotLatency().catch(() => {});
  }

  startPingLoop(intervalMs = 4000) {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      this.probeDeadshotLatency().catch(() => {});
    }, intervalMs);
  }

  stopPingLoop() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _sampleCpuTimes() {
    return os.cpus().map((cpu) => {
      const t = cpu.times;
      const total = t.user + t.nice + t.sys + t.idle + t.irq;
      return { idle: t.idle, total };
    });
  }

  getCpuUsagePercent() {
    const current = this._sampleCpuTimes();
    let idleDelta = 0;
    let totalDelta = 0;
    const len = Math.min(this.prevCpuTimes.length, current.length);
    for (let i = 0; i < len; i++) {
      idleDelta += current[i].idle - this.prevCpuTimes[i].idle;
      totalDelta += current[i].total - this.prevCpuTimes[i].total;
    }
    this.prevCpuTimes = current;
    if (totalDelta <= 0) return 0;
    const pct = (1 - idleDelta / totalDelta) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  }

  _probeWmiHardware() {
    return new Promise((resolve) => {
      if (process.platform === "darwin") {
        execFile(
          "system_profiler",
          ["SPDisplaysDataType", "SPHardwareDataType", "-json"],
          { timeout: 6000 },
          (err, stdout) => {
            if (!err && stdout) {
              try {
                const parsed = JSON.parse(stdout);
                const dispData = parsed.SPDisplaysDataType || [];
                const hwData = (parsed.SPHardwareDataType || [])[0] || {};
                const gpus = [];
                for (const d of dispData) {
                  let hz = null;
                  const ndrvs = d.spdisplays_ndrvs || [];
                  for (const nd of ndrvs) {
                    const m = /(\d+)\s*Hz/i.exec(String(nd._spdisplays_resolution || nd.spdisplays_resolution || ""));
                    if (m) hz = Math.max(hz || 0, Number(m[1]));
                  }
                  const vramStr = String(d.spdisplays_vram || d._spdisplays_vram || "");
                  const vramM = /(\d+)\s*(GB|MB)/i.exec(vramStr);
                  const vramBytes = vramM
                    ? Number(vramM[1]) * (vramM[2].toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2)
                    : null;
                  gpus.push({
                    Name: d.sppci_model || hwData.chip_type || "Apple Metal GPU",
                    AdapterRAM: vramBytes,
                    CurrentRefreshRate: hz || 60,
                    MaxRefreshRate: hz || 60,
                    DriverVersion: d.spdisplays_metal || "Metal",
                  });
                }
                const cpuModel = hwData.chip_type || hwData.cpu_type || os.cpus()[0]?.model || "Apple CPU";
                const coreCountMatch = /^(\d+)/.exec(String(hwData.number_processors || ""));
                this.wmiInfo.gpus = gpus;
                this.wmiInfo.cpus = [{
                  Name: cpuModel,
                  NumberOfCores: coreCountMatch ? Number(coreCountMatch[1]) : os.cpus().length,
                  NumberOfLogicalProcessors: os.cpus().length,
                  MaxClockSpeed: os.cpus()[0]?.speed || 3200,
                }];
                if (gpus[0]) {
                  this.wmiInfo.monitorCurrentHz = gpus[0].CurrentRefreshRate;
                  this.wmiInfo.monitorMaxHz = gpus[0].MaxRefreshRate;
                }
              } catch {}
            }
            this.wmiInfo.loaded = true;
            resolve(this.wmiInfo);
          }
        );
        return;
      }

      if (process.platform === "linux") {
        execFile(
          "sh",
          ["-c", "lspci 2>/dev/null | grep -iE 'vga|3d|display' | head -n 3; echo '---'; xrandr --current 2>/dev/null | grep '\\*' | head -n 3"],
          { timeout: 5000 },
          (err, stdout) => {
            if (!err && stdout) {
              try {
                const [gpuSec = "", hzSec = ""] = stdout.split("---");
                const gpuLine = gpuSec.trim().split("\n").find(Boolean) || "";
                const gpuName = gpuLine.replace(/^.*:\s*/, "").trim() || "Linux GPU";
                const hzMatches = [...hzSec.matchAll(/(\d+(?:\.\d+)?)\s*\*/g)].map((m) => Math.round(Number(m[1])));
                const maxHz = hzMatches.length ? Math.max(...hzMatches) : 60;
                this.wmiInfo.gpus = [{
                  Name: gpuName,
                  CurrentRefreshRate: maxHz,
                  MaxRefreshRate: maxHz,
                }];
                this.wmiInfo.monitorCurrentHz = maxHz;
                this.wmiInfo.monitorMaxHz = maxHz;
              } catch {}
            }
            this.wmiInfo.loaded = true;
            resolve(this.wmiInfo);
          }
        );
        return;
      }

      if (process.platform !== "win32") {
        this.wmiInfo.loaded = true;
        return resolve(this.wmiInfo);
      }

      const psScript = [
        "$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,CurrentRefreshRate,MaxRefreshRate,CurrentHorizontalResolution,CurrentVerticalResolution,DriverVersion)",
        "$cpus = @(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed)",
        "[PSCustomObject]@{ gpus = $gpus; cpus = $cpus } | ConvertTo-Json -Depth 4 -Compress",
      ].join("; ");

      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        { timeout: 6000, windowsHide: true },
        (err, stdout) => {
          if (!err && stdout) {
            try {
              const parsed = JSON.parse(stdout.trim());
              const gpus = Array.isArray(parsed.gpus) ? parsed.gpus : parsed.gpus ? [parsed.gpus] : [];
              const cpus = Array.isArray(parsed.cpus) ? parsed.cpus : parsed.cpus ? [parsed.cpus] : [];
              this.wmiInfo.gpus = gpus;
              this.wmiInfo.cpus = cpus;
              const activeGpu = gpus.find((g) => Number(g.CurrentRefreshRate) > 0) || gpus[0];
              if (activeGpu) {
                this.wmiInfo.monitorCurrentHz = Number(activeGpu.CurrentRefreshRate) || null;
                this.wmiInfo.monitorMaxHz = Number(activeGpu.MaxRefreshRate) || null;
              }
            } catch {
              // Keep graceful defaults if WMI output could not be parsed
            }
          }
          this.wmiInfo.loaded = true;
          resolve(this.wmiInfo);
        }
      );
    });
  }

  async getDisplaysInfo() {
    if (!this._electronScreen) {
      const g = this.wmiInfo.gpus[0];
      return {
        primary: g
          ? {
              width: Number(g.CurrentHorizontalResolution) || null,
              height: Number(g.CurrentVerticalResolution) || null,
              displayFrequency: this.wmiInfo.monitorCurrentHz,
              maxRefreshRate: this.wmiInfo.monitorMaxHz,
              scaleFactor: 1,
            }
          : null,
        displays: [],
      };
    }

    const displays = this._electronScreen.getAllDisplays().map((d, idx) => ({
      id: d.id,
      index: idx,
      label: d.label || `Display ${idx + 1}`,
      width: d.size.width,
      height: d.size.height,
      physicalWidth: Math.round(d.size.width * d.scaleFactor),
      physicalHeight: Math.round(d.size.height * d.scaleFactor),
      scaleFactor: d.scaleFactor,
      displayFrequency: d.displayFrequency || this.wmiInfo.monitorCurrentHz || 60,
      maxRefreshRate: this.wmiInfo.monitorMaxHz || d.displayFrequency || 60,
      internal: Boolean(d.internal),
    }));

    const primaryRaw = this._electronScreen.getPrimaryDisplay();
    const primary = displays.find((d) => d.id === primaryRaw.id) || displays[0] || null;
    return { primary, displays };
  }

  async getGpuInfo() {
    let electronGpu = null;
    if (this._electronApp && typeof this._electronApp.getGPUInfo === "function") {
      try {
        electronGpu = await this._electronApp.getGPUInfo("basic");
      } catch {
        electronGpu = null;
      }
    }

    const wmiGpu =
      this.wmiInfo.gpus.find((g) => /nvidia|amd|radeon|geforce|rtx|gtx/i.test(String(g.Name || ""))) ||
      this.wmiInfo.gpus[0] ||
      null;

    return {
      primaryName: wmiGpu?.Name || electronGpu?.gpuDevice?.[0]?.deviceString || "Hardware GPU",
      vramBytes: wmiGpu?.AdapterRAM ? Number(wmiGpu.AdapterRAM) : null,
      vramGb: wmiGpu?.AdapterRAM ? Math.round((Number(wmiGpu.AdapterRAM) / 1024 ** 3) * 10) / 10 : null,
      driverVersion: wmiGpu?.DriverVersion || null,
      wmiAdapters: this.wmiInfo.gpus,
      chromiumDevices: electronGpu?.gpuDevice || [],
      featureStatus: this._electronApp?.getGPUFeatureStatus ? this._electronApp.getGPUFeatureStatus() : null,
    };
  }

  async getStaticHardwareSummary() {
    const cpus = os.cpus();
    const wmiCpu = this.wmiInfo.cpus[0];
    const displays = await this.getDisplaysInfo();
    const gpu = await this.getGpuInfo();
    const totalRamBytes = os.totalmem();

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron || null,
      chromeVersion: process.versions.chrome || null,
      cpu: {
        model: (wmiCpu?.Name || cpus[0]?.model || "Unknown CPU").trim(),
        physicalCores: wmiCpu?.NumberOfCores || Math.max(1, Math.floor(cpus.length / 2)),
        logicalProcessors: wmiCpu?.NumberOfLogicalProcessors || cpus.length,
        baseClockMhz: wmiCpu?.MaxClockSpeed || cpus[0]?.speed || 0,
      },
      memory: {
        totalBytes: totalRamBytes,
        totalGb: Math.round((totalRamBytes / 1024 ** 3) * 10) / 10,
      },
      gpu,
      displays,
    };
  }

  /**
   * Computes a deterministic PC Power Score (10-100) from real hardware telemetry
   * and returns the optimal preset profile & rendering settings for the machine.
   */
  async analyzeHardwarePower() {
    if (!this.wmiInfo.loaded) {
      await this._probeWmiHardware();
    }
    const hw = await this.getStaticHardwareSummary();
    const physCores = Number(hw.cpu?.physicalCores) || 2;
    const threads = Number(hw.cpu?.logicalProcessors) || physCores;
    const clockMhz = Number(hw.cpu?.baseClockMhz) || 2400;
    const cpuModel = String(hw.cpu?.model || "");
    const gpuName = String(hw.gpu?.primaryName || "");
    const vramGb = Number(hw.gpu?.vramGb) || 0;
    const ramGb = Number(hw.memory?.totalGb) || 4;
    const hz = Number(hw.displays?.primary?.maxRefreshRate || hw.displays?.primary?.displayFrequency) || 60;

    // 1. CPU score (0..35)
    let cpuScore = physCores >= 8 || threads >= 16 ? 22 : physCores >= 6 || threads >= 12 ? 18 : physCores >= 4 || threads >= 8 ? 13 : 7;
    cpuScore += clockMhz >= 3600 ? 6 : clockMhz >= 2600 ? 4 : 2;
    if (/celeron|pentium|athlon|atom|n4\d{3}|n3\d{3}/i.test(cpuModel)) {
      cpuScore = Math.max(5, cpuScore - 5);
    } else if (/i[579]-1[234]\d|ultra|ryzen\s*[579]\s*[579]\d{2}|ryzen\s*[79]/i.test(cpuModel)) {
      cpuScore += 7;
    } else if (/ryzen|core\s*i[3579]/i.test(cpuModel)) {
      cpuScore += 4;
    }
    cpuScore = Math.min(35, cpuScore);

    // 2. GPU score (0..35)
    let gpuTier = 8;
    const isHighDiscrete = /rtx\s*(30[789]|40\d|50\d)|rx\s*(6[89]\d{2}|7[789]\d{2}|90\d{2})/i.test(gpuName);
    const isMidDiscrete = /nvidia|geforce|rtx|gtx|radeon\s*rx|arc\s*[ab]\d/i.test(gpuName);
    const isGoodApu = /iris\s*xe|radeon\s*(780m|680m|vega\s*[78])|mx\d{3}/i.test(gpuName);
    if (isHighDiscrete) gpuTier = 30;
    else if (isMidDiscrete) gpuTier = 24;
    else if (isGoodApu) gpuTier = 15;
    const vramBonus = vramGb >= 8 ? 5 : vramGb >= 4 ? 4 : vramGb >= 2 ? 2 : 1;
    const gpuScore = Math.min(35, gpuTier + vramBonus);

    // 3. RAM & Display scores (0..15 each)
    const ramScore = ramGb >= 30 ? 15 : ramGb >= 15 ? 12 : ramGb >= 11 ? 9 : ramGb >= 7 ? 6 : 3;
    const hzScore = hz >= 240 ? 15 : hz >= 144 ? 12 : hz >= 100 ? 9 : hz >= 70 ? 7 : 6;
    const powerScore = Math.max(10, Math.min(100, cpuScore + gpuScore + ramScore + hzScore));

    let tier = "balanced_laptop";
    let tierLabel = "Balanced Competitive";
    let recommendedPreset = "balanced";
    let recommendedCanvasDprScale = 0.95;
    let recommendedReduceMotion = false;
    let recommendedHostRamTargetMb = 12;
    let recommendedPreferPCores = false;

    if (powerScore >= 76) {
      tier = "extreme_workstation";
      tierLabel = "Extreme Esports Workstation";
      recommendedPreset = "max_compute";
      recommendedCanvasDprScale = 1.0;
      recommendedHostRamTargetMb = 14;
      recommendedPreferPCores = threads >= 12;
    } else if (powerScore >= 54) {
      tier = "esports_desktop";
      tierLabel = "High-FPS Esports Rig";
      recommendedPreset = "max_compute";
      recommendedCanvasDprScale = 1.0;
      recommendedHostRamTargetMb = 12;
    } else if (powerScore < 36) {
      tier = "low_end_pc";
      tierLabel = "Battery / Low-End Device";
      recommendedPreset = "low_end";
      recommendedCanvasDprScale = 0.8;
      recommendedReduceMotion = true;
      recommendedHostRamTargetMb = 10;
    }

    return {
      powerScore,
      tier,
      tierLabel,
      recommendedPreset,
      breakdown: { cpuScore, gpuScore, ramScore, hzScore },
      recommendations: {
        presetMode: recommendedPreset,
        canvasDprScale: recommendedCanvasDprScale,
        reduceMotionUi: recommendedReduceMotion,
        hostRamTargetMb: recommendedHostRamTargetMb,
        preferPerformanceCores: recommendedPreferPCores,
        disablePowerThrottling: powerScore >= 36,
        webglLowLatency: true,
      },
      detectedSummary: `${cpuModel} (${physCores}C/${threads}T) • ${gpuName} • ${ramGb}GB RAM • ${hz}Hz`,
      hardware: hw,
    };
  }

  probeDeadshotLatency(host = "deadshot.io", port = 443, timeoutMs = 2500) {
    return new Promise((resolve) => {
      const start = performance.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (ok, errMsg = null) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {}

        if (ok) {
          const rtt = Math.round((performance.now() - start) * 10) / 10;
          this.pingHistory.push(rtt);
          if (this.pingHistory.length > 12) this.pingHistory.shift();

          const sum = this.pingHistory.reduce((a, b) => a + b, 0);
          const avg = Math.round((sum / this.pingHistory.length) * 10) / 10;
          const min = Math.min(...this.pingHistory);

          let jitter = 0;
          if (this.pingHistory.length >= 2) {
            let diffs = 0;
            for (let i = 1; i < this.pingHistory.length; i++) {
              diffs += Math.abs(this.pingHistory[i] - this.pingHistory[i - 1]);
            }
            jitter = Math.round((diffs / (this.pingHistory.length - 1)) * 10) / 10;
          }

          this.lastPing = {
            host,
            rttMs: rtt,
            avgMs: avg,
            minMs: min,
            jitterMs: jitter,
            status: "online",
            updatedAt: Date.now(),
          };
        } else {
          this.lastPing = {
            ...this.lastPing,
            host,
            status: errMsg || "unreachable",
            updatedAt: Date.now(),
          };
        }
        resolve(this.lastPing);
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false, "timeout"));
      socket.once("error", () => finish(false, "error"));
      socket.connect(port, host);
    });
  }

  getLiveMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuPercent = this.getCpuUsagePercent();

    let hostWorkingSetKb = Math.round(process.memoryUsage().rss / 1024);
    let clientWorkingSetKb = hostWorkingSetKb;
    let processBreakdown = [];
    if (this._electronApp && typeof this._electronApp.getAppMetrics === "function") {
      try {
        const metrics = this._electronApp.getAppMetrics();
        clientWorkingSetKb = metrics.reduce((acc, m) => acc + (m.memory?.workingSetSize || 0), 0);
        processBreakdown = metrics.map((m) => ({
          type: m.type,
          pid: m.pid,
          cpuPercent: Math.round((m.cpu?.percentChangelog || m.cpu?.percentCPUUsage || 0) * 10) / 10,
          workingSetMb: Math.round(((m.memory?.workingSetSize || 0) / 1024) * 10) / 10,
        }));
      } catch {
        // Ignore transient metric read failure
      }
    }

    const hostMb = Math.round((hostWorkingSetKb / 1024) * 10) / 10;
    const totalMb = Math.round((clientWorkingSetKb / 1024) * 10) / 10;

    return {
      timestamp: Date.now(),
      cpuPercent,
      ram: {
        usedGb: Math.round((usedMem / 1024 ** 3) * 10) / 10,
        totalGb: Math.round((totalMem / 1024 ** 3) * 10) / 10,
        usedPercent: Math.round((usedMem / totalMem) * 1000) / 10,
      },
      hostMemoryMb: hostMb,
      webviewMemoryMb: Math.max(0, Math.round((totalMb - hostMb) * 10) / 10),
      clientMemoryMb: totalMb,
      processBreakdown,
      network: this.lastPing,
      uptimeSec: Math.round(process.uptime()),
    };
  }

  applyProcessPriority(level = "above_normal") {
    try {
      const osPriorityMap = {
        normal: os.constants.priority.PRIORITY_NORMAL,
        above_normal: os.constants.priority.PRIORITY_ABOVE_NORMAL,
        high: os.constants.priority.PRIORITY_HIGH,
      };
      const target = osPriorityMap[level] ?? os.constants.priority.PRIORITY_ABOVE_NORMAL;
      os.setPriority(process.pid, target);
      if (this._electronApp && typeof this._electronApp.getAppMetrics === "function") {
        for (const m of this._electronApp.getAppMetrics()) {
          if (m.pid && m.pid !== process.pid) {
            try {
              os.setPriority(m.pid, target);
            } catch {
              // GPU/Utility processes may ignore priority changes safely
            }
          }
        }
      }
      return { ok: true, level };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = {
  SystemMetricsService,
};
