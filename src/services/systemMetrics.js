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
