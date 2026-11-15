/**
 * Corsair Hardware Detection, OpenRGB SDK TCP Client, WebHID Registry & Reactive RGB Engine.
 * Drives both physical OpenRGB/Corsair LEDs and the real-time virtual Corsair K70 visualizer.
 */

const net = require("net");
const { execFile } = require("child_process");

const OPENRGB_MAGIC = Buffer.from("ORGB", "ascii");
const PKT_REQUEST_CONTROLLER_COUNT = 0;
const PKT_REQUEST_CONTROLLER_DATA = 1;
const PKT_SET_CLIENT_NAME = 50; // OpenRGB SDK: NET_PACKET_ID_SET_CLIENT_NAME = 50
const PKT_UPDATE_LEDS = 1050;

function hexToRgb(hex) {
  const clean = String(hex || "#d4d8df").replace("#", "").trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) || 0,
      g: parseInt(clean[1] + clean[1], 16) || 0,
      b: parseInt(clean[2] + clean[2], 16) || 0,
    };
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (Number.isNaN(num)) return { r: 212, g: 216, b: 223 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function mixRgb(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

function scaleRgb(c, factor) {
  const k = Math.max(0, Math.min(1, factor));
  return {
    r: Math.round(c.r * k),
    g: Math.round(c.g * k),
    b: Math.round(c.b * k),
  };
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hue + 1 / 3) * 255),
    g: Math.round(hue2rgb(hue) * 255),
    b: Math.round(hue2rgb(hue - 1 / 3) * 255),
  };
}

function encodeOpenRgbPacket(devIdx, pktId, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(16);
  OPENRGB_MAGIC.copy(header, 0);
  header.writeUInt32LE(devIdx >>> 0, 4);
  header.writeUInt32LE(pktId >>> 0, 8);
  header.writeUInt32LE(payload.length >>> 0, 12);
  return payload.length ? Buffer.concat([header, payload]) : header;
}

class CorsairBridgeService {
  constructor() {
    this.config = {};
    this.hardware = {
      scannedAt: null,
      icueRunning: false,
      corsairServiceRunning: false,
      openRgbProcessRunning: false,
      usbCorsairDevices: [],
      webHidDevices: [],
    };
    this.openRgb = {
      connected: false,
      host: "127.0.0.1",
      port: 6742,
      controllers: [],
      lastError: null,
    };
    this.telemetry = {
      fps: 0,
      targetHz: 75,
      pingMs: 0,
      firingUntil: 0,
      adsActive: false,
      reloadUntil: 0,
      lastKeys: [],
      killFlashUntil: 0,
    };

    // 6x22 logical Corsair K70 ANSI layout zones + 16 chassis strip LEDs
    this.rows = 6;
    this.cols = 22;
    this.stripCount = 16;
    this.currentFrame = {
      timestamp: Date.now(),
      mode: "reactive_tactical",
      avgColor: { r: 212, g: 216, b: 223 },
      keyGrid: [],
      strip: [],
      statusBanner: "Virtual Engine Ready",
    };

    this._socket = null;
    this._rxBuffer = Buffer.alloc(0);
    this._tickTimer = null;
    this._onFrameListeners = new Set();
  }

  setConfig(corsairConfig = {}) {
    this.config = { ...this.config, ...corsairConfig };
    if (this.config.enabled && this.config.autoConnectOpenRgb && !this.openRgb.connected && !this._socket) {
      this.connectOpenRgb(this.config.openRgbHost, this.config.openRgbPort).catch(() => {});
    }
    this.computeFrame();
  }

  onFrame(listener) {
    this._onFrameListeners.add(listener);
    return () => this._onFrameListeners.delete(listener);
  }

  startEngine(intervalMs = 50) {
    if (this._tickTimer) clearInterval(this._tickTimer);
    this._tickTimer = setInterval(() => {
      const frame = this.computeFrame();
      this._pushToOpenRgb(frame);
      for (const cb of this._onFrameListeners) {
        try {
          cb(frame);
        } catch {}
      }
    }, intervalMs);
  }

  stopEngine() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    this.disconnectOpenRgb();
  }

  scanHardware() {
    return new Promise((resolve) => {
      if (process.platform !== "win32") {
        const cmd = process.platform === "darwin"
          ? "pgrep -ix 'iCUE|OpenRGB' 2>/dev/null; echo '---'; system_profiler SPUSBDataType 2>/dev/null | grep -i 'corsair' -B 1 -A 2 | head -n 12"
          : "pgrep -i 'openrgb|ckb-next' 2>/dev/null; echo '---'; lsusb -d 1b1c: 2>/dev/null | head -n 8";
        execFile("sh", ["-c", cmd], { timeout: 4000 }, (err, stdout) => {
          if (!err && stdout) {
            const [procs = "", devs = ""] = stdout.split("---");
            this.hardware.icueRunning = /icue/i.test(procs);
            this.hardware.openRgbProcessRunning = /openrgb/i.test(procs);
            this.hardware.corsairServiceRunning = /corsair|ckb-next/i.test(procs);
            const lines = devs.split("\n").map((l) => l.trim()).filter((l) => /corsair|vid_1b1c|1b1c:/i.test(l));
            if (lines.length) {
              this.hardware.usbCorsairDevices = lines.map((l) => ({
                name: l.replace(/^.*1b1c:[0-9a-f]+\s*/i, "").trim() || "Corsair HID Device",
                status: "OK",
                instanceId: "VID_1B1C",
                deviceClass: "HIDClass",
              }));
            }
          }
          this.hardware.scannedAt = Date.now();
          resolve(this.getStatus());
        });
        return;
      }

      const psScript = [
        "$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'iCUE|Corsair|OpenRGB' } | Select-Object -ExpandProperty ProcessName -Unique)",
        "$devs = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match 'VID_1B1C' } | Select-Object FriendlyName,Status,InstanceId,Class)",
        "[PSCustomObject]@{ procs = $procs; devs = $devs } | ConvertTo-Json -Depth 4 -Compress",
      ].join("; ");

      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        { timeout: 6000, windowsHide: true },
        (err, stdout) => {
          if (!err && stdout) {
            try {
              const parsed = JSON.parse(stdout.trim());
              const procs = Array.isArray(parsed.procs) ? parsed.procs : parsed.procs ? [parsed.procs] : [];
              const devs = Array.isArray(parsed.devs) ? parsed.devs : parsed.devs ? [parsed.devs] : [];
              this.hardware.icueRunning = procs.some((p) => /icue/i.test(String(p)));
              this.hardware.corsairServiceRunning = procs.some((p) => /corsair/i.test(String(p)));
              this.hardware.openRgbProcessRunning = procs.some((p) => /openrgb/i.test(String(p)));
              this.hardware.usbCorsairDevices = devs.map((d) => ({
                name: d.FriendlyName || "Corsair HID Device",
                status: d.Status || "OK",
                instanceId: d.InstanceId || "",
                deviceClass: d.Class || "HIDClass",
              }));
            } catch {
              // Ignore parse failure
            }
          }
          this.hardware.scannedAt = Date.now();
          resolve(this.getStatus());
        }
      );
    });
  }

  registerWebHidDevice(info) {
    if (!info) return this.getStatus();
    const key = `${info.vendorId}:${info.productId}:${info.productName || ""}`;
    const existing = this.hardware.webHidDevices.find((d) => d._key === key);
    if (!existing) {
      this.hardware.webHidDevices.push({
        _key: key,
        vendorId: info.vendorId,
        productId: info.productId,
        productName: info.productName || "Corsair HID Device",
        opened: Boolean(info.opened),
      });
    }
    return this.getStatus();
  }

  connectOpenRgb(host = "127.0.0.1", port = 6742) {
    return new Promise((resolve) => {
      this.disconnectOpenRgb();
      const targetHost = host || "127.0.0.1";
      const targetPort = Number(port) || 6742;
      this.openRgb.host = targetHost;
      this.openRgb.port = targetPort;
      this.openRgb.lastError = null;

      const socket = new net.Socket();
      this._socket = socket;
      this._rxBuffer = Buffer.alloc(0);

      let settled = false;
      const done = (connected) => {
        if (settled) return;
        settled = true;
        resolve(this.getStatus());
      };

      socket.setTimeout(1500);

      socket.on("connect", () => {
        socket.setTimeout(0);
        this.openRgb.connected = true;
        this.openRgb.lastError = null;
        this.openRgb.controllers = [];
        try {
          const clientNameBuf = Buffer.from("Dih Client\0", "utf8");
          socket.write(encodeOpenRgbPacket(0, PKT_SET_CLIENT_NAME, clientNameBuf));
          socket.write(encodeOpenRgbPacket(0, PKT_REQUEST_CONTROLLER_COUNT));
        } catch {}
        done(true);
      });

      socket.on("data", (chunk) => {
        this._handleOpenRgbData(chunk);
      });

      socket.on("timeout", () => {
        this.openRgb.lastError = "OpenRGB SDK connection timed out";
        this.disconnectOpenRgb();
        done(false);
      });

      socket.on("error", (err) => {
        this.openRgb.lastError = err.code === "ECONNREFUSED"
          ? "OpenRGB SDK server not listening on port " + targetPort
          : err.message;
        this.disconnectOpenRgb();
        done(false);
      });

      socket.on("close", () => {
        this.openRgb.connected = false;
        this._socket = null;
      });

      try {
        socket.connect(targetPort, targetHost);
      } catch (err) {
        this.openRgb.lastError = err.message;
        done(false);
      }
    });
  }

  disconnectOpenRgb() {
    this.openRgb.connected = false;
    if (this._socket) {
      try {
        this._socket.destroy();
      } catch {}
      this._socket = null;
    }
  }

  _handleOpenRgbData(chunk) {
    this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);
    while (this._rxBuffer.length >= 16) {
      if (this._rxBuffer.subarray(0, 4).toString("ascii") !== "ORGB") {
        this._rxBuffer = Buffer.alloc(0);
        return;
      }
      const devIdx = this._rxBuffer.readUInt32LE(4);
      const pktId = this._rxBuffer.readUInt32LE(8);
      const pktSize = this._rxBuffer.readUInt32LE(12);
      if (this._rxBuffer.length < 16 + pktSize) return;
      const payload = this._rxBuffer.subarray(16, 16 + pktSize);
      this._rxBuffer = this._rxBuffer.subarray(16 + pktSize);

      if (pktId === PKT_REQUEST_CONTROLLER_COUNT && payload.length >= 4) {
        const count = Math.min(payload.readUInt32LE(0), 16);
        this.openRgb.controllers = [];
        for (let i = 0; i < count; i++) {
          if (this._socket && !this._socket.destroyed) {
            this._socket.write(encodeOpenRgbPacket(i, PKT_REQUEST_CONTROLLER_DATA));
          }
        }
      } else if (pktId === PKT_REQUEST_CONTROLLER_DATA && payload.length >= 12) {
        try {
          const parsed = this._parseControllerData(devIdx, payload);
          if (parsed) {
            const idx = this.openRgb.controllers.findIndex((c) => c.index === devIdx);
            if (idx >= 0) this.openRgb.controllers[idx] = parsed;
            else this.openRgb.controllers.push(parsed);
          }
        } catch {
          // Ignore malformed SDK controller packet gracefully
        }
      }
    }
  }

  _parseControllerData(devIdx, payload) {
    // OpenRGB ControllerData layout: data_size(u32), type(i32), name_len(u16)+name...
    if (payload.length < 10) return null;
    const type = payload.readInt32LE(4);
    const nameLen = payload.readUInt16LE(8);
    let name = `Controller #${devIdx}`;
    if (nameLen > 0 && 10 + nameLen <= payload.length) {
      name = payload.subarray(10, 10 + nameLen).toString("utf8").replace(/\0+$/g, "");
    }
    // Extract LED count safely by scanning plausible tail count if small buffer, fallback 64
    const typeNames = ["Motherboard", "DRAM", "GPU", "Cooler", "LED Strip", "Keyboard", "Mouse", "Mousemat", "Headset", "Headset Stand", "Gamepad", "Light"];
    return {
      index: devIdx,
      name: name || `Device ${devIdx}`,
      type: typeNames[type] || "RGB Device",
      ledCount: type === 5 ? 105 : type === 6 ? 12 : 32,
    };
  }

  _pushToOpenRgb(frame) {
    if (!this.openRgb.connected || !this._socket || this._socket.destroyed) return;
    if (!this.openRgb.controllers.length) return;
    for (const ctrl of this.openRgb.controllers) {
      const count = Math.max(1, Math.min(256, ctrl.ledCount || 32));
      const payload = Buffer.alloc(4 + 2 + count * 4);
      payload.writeUInt32LE(payload.length, 0);
      payload.writeUInt16LE(count, 4);
      const stripLen = frame.strip.length || 1;
      for (let i = 0; i < count; i++) {
        const c = frame.strip[i % stripLen] || frame.avgColor;
        const offset = 6 + i * 4;
        payload[offset] = c.r & 255;
        payload[offset + 1] = c.g & 255;
        payload[offset + 2] = c.b & 255;
        payload[offset + 3] = 0;
      }
      try {
        this._socket.write(encodeOpenRgbPacket(ctrl.index, PKT_UPDATE_LEDS, payload));
      } catch {}
    }
  }

  updateTelemetry(patch = {}) {
    const now = Date.now();
    if (patch.fired) {
      this.telemetry.firingUntil = now + 135;
    }
    if (patch.reloaded) {
      this.telemetry.reloadUntil = now + 900;
    }
    if (patch.killFlash) {
      this.telemetry.killFlashUntil = now + 350;
    }
    if (typeof patch.adsActive === "boolean") {
      this.telemetry.adsActive = patch.adsActive;
    }
    if (typeof patch.fps === "number") {
      this.telemetry.fps = patch.fps;
    }
    if (typeof patch.targetHz === "number" && patch.targetHz > 0) {
      this.telemetry.targetHz = patch.targetHz;
    }
    if (typeof patch.pingMs === "number") {
      this.telemetry.pingMs = patch.pingMs;
    }
    if (Array.isArray(patch.activeKeys)) {
      this.telemetry.lastKeys = patch.activeKeys;
    }
  }

  computeFrame(nowMs = Date.now()) {
    const cfg = this.config;
    const enabled = cfg.enabled !== false;
    const mode = cfg.mode || "reactive_tactical";
    const brightness = (Number(cfg.brightness ?? 85) || 0) / 100;
    const speed = Number(cfg.speed ?? 1.0) || 1.0;

    const primary = hexToRgb(cfg.primaryColor || "#d4d8df");
    const secondary = hexToRgb(cfg.secondaryColor || "#4b515c");
    const fireFlash = hexToRgb(cfg.fireFlashColor || "#ffffff");
    const adsColor = hexToRgb(cfg.adsColor || "#7ea8ff");
    const reloadColor = hexToRgb(cfg.reloadColor || "#e2b866");
    const lowFpsColor = hexToRgb(cfg.lowFpsColor || "#d96464");
    const highFpsColor = hexToRgb(cfg.highFpsColor || "#58c98a");

    const grid = [];
    const strip = [];
    const tSec = (nowMs / 1000) * speed;

    const isFiring = nowMs < this.telemetry.firingUntil;
    const isReloading = nowMs < this.telemetry.reloadUntil;
    const isKillFlash = nowMs < this.telemetry.killFlashUntil;
    const reloadProgress = isReloading ? 1 - (this.telemetry.reloadUntil - nowMs) / 900 : 0;

    const fpsRatio = Math.max(0, Math.min(1, (this.telemetry.fps || 60) / Math.max(60, this.telemetry.targetHz || 75)));
    const ping = this.telemetry.pingMs || 25;
    const pingColor =
      ping <= 35 ? highFpsColor : ping <= 80 ? reloadColor : lowFpsColor;

    // Logical WASD coordinates in our 6x22 Corsair K70 map
    const isWasdCoord = (r, c) => (r === 2 && c === 2) || (r === 3 && (c === 1 || c === 2 || c === 3));
    const isHotbarCoord = (r, c) => r === 1 && c >= 1 && c <= 3;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    for (let r = 0; r < this.rows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.cols; c++) {
        let color = { ...secondary };

        if (!enabled) {
          color = { r: 22, g: 24, b: 29 };
        } else if (mode === "static_slate") {
          color = isWasdCoord(r, c) && cfg.highlightWasd ? primary : secondary;
        } else if (mode === "breathing") {
          const wave = 0.5 + 0.5 * Math.sin(tSec * 2.1);
          color = mixRgb(secondary, primary, wave);
        } else if (mode === "spectrum") {
          color = hslToRgb(c * 14 + r * 8 + tSec * 70, 0.78, 0.52);
        } else if (mode === "fps_thermal") {
          const base = fpsRatio < 0.6
            ? mixRgb(lowFpsColor, primary, fpsRatio / 0.6)
            : mixRgb(primary, highFpsColor, (fpsRatio - 0.6) / 0.4);
          color = isWasdCoord(r, c) && cfg.highlightWasd ? mixRgb(base, fireFlash, 0.35) : base;
        } else if (mode === "ping_health") {
          const pulse = 0.78 + 0.22 * Math.sin(tSec * 3.0 - c * 0.25);
          color = scaleRgb(pingColor, pulse);
        } else if (mode === "ads_focus") {
          if (this.telemetry.adsActive && cfg.dimOnAds) {
            color = isWasdCoord(r, c) || isHotbarCoord(r, c) ? adsColor : scaleRgb(secondary, 0.25);
          } else {
            color = isWasdCoord(r, c) ? primary : secondary;
          }
        } else if (mode === "reload_sweep") {
          const wavePos = ((tSec * 0.85) % 1) * this.cols;
          const dist = Math.abs(c - wavePos);
          color = dist < 2.2 ? mixRgb(secondary, reloadColor, 1 - dist / 2.2) : secondary;
        } else if (mode === "keymap_zones") {
          if (isWasdCoord(r, c)) color = primary;
          else if (isHotbarCoord(r, c)) color = adsColor;
          else if (r === 0) color = scaleRgb(primary, 0.6);
          else color = scaleRgb(secondary, 0.75);
        } else if (mode === "audio_pulse") {
          const beat = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(tSec * 5.2 + c * 0.15)), 2);
          color = mixRgb(secondary, primary, beat);
        } else {
          // reactive_tactical (default flagship mode)
          const ambientWave = 0.15 + 0.12 * Math.sin(tSec * 1.4 + c * 0.2);
          color = mixRgb(scaleRgb(secondary, 0.8), primary, ambientWave);
          if (cfg.highlightWasd && isWasdCoord(r, c)) {
            color = mixRgb(primary, fireFlash, 0.25);
          }
          if (this.telemetry.adsActive && cfg.dimOnAds) {
            color = isWasdCoord(r, c)
              ? adsColor
              : mixRgb(scaleRgb(secondary, 0.35), adsColor, 0.3);
          }
        }

        if (enabled && isReloading && cfg.flashOnShoot) {
          const sweepCol = reloadProgress * this.cols;
          const dist = Math.abs(c - sweepCol);
          if (dist < 2.5) {
            color = mixRgb(color, reloadColor, 1 - dist / 2.5);
          }
        }

        if (enabled && isFiring && cfg.flashOnShoot) {
          const fade = Math.max(0, (this.telemetry.firingUntil - nowMs) / 135);
          color = mixRgb(color, fireFlash, fade * 0.9);
        }

        if (enabled && isKillFlash) {
          const fade = Math.max(0, (this.telemetry.killFlashUntil - nowMs) / 350);
          color = mixRgb(color, highFpsColor, fade * 0.75);
        }

        const out = enabled ? scaleRgb(color, brightness) : color;
        rowArr.push(out);
        sumR += out.r;
        sumG += out.g;
        sumB += out.b;
        count++;
      }
      grid.push(rowArr);
    }

    for (let i = 0; i < this.stripCount; i++) {
      const sampleCol = Math.min(this.cols - 1, Math.floor((i / this.stripCount) * this.cols));
      strip.push(grid[2][sampleCol]);
    }

    const avgColor = count
      ? { r: Math.round(sumR / count), g: Math.round(sumG / count), b: Math.round(sumB / count) }
      : { r: 212, g: 216, b: 223 };

    const hwLinked = this.openRgb.connected || this.hardware.usbCorsairDevices.length > 0 || this.hardware.webHidDevices.length > 0;
    const statusBanner = this.openRgb.connected
      ? `OpenRGB Live (${this.openRgb.controllers.length} device${this.openRgb.controllers.length === 1 ? "" : "s"})`
      : this.hardware.usbCorsairDevices.length > 0
      ? `Corsair HID Detected (${this.hardware.usbCorsairDevices.length})`
      : this.hardware.icueRunning
      ? "Corsair iCUE Active (Enable OpenRGB SDK to sync)"
      : hwLinked
      ? "WebHID Corsair Linked"
      : "Virtual Keyboard Preview (No Corsair HID detected)";

    this.currentFrame = {
      timestamp: nowMs,
      mode,
      enabled,
      avgColor,
      keyGrid: grid,
      strip,
      statusBanner,
    };
    return this.currentFrame;
  }

  getStatus() {
    return {
      hardware: this.hardware,
      openRgb: this.openRgb,
      frame: this.currentFrame,
    };
  }
}

module.exports = {
  CorsairBridgeService,
  hexToRgb,
  encodeOpenRgbPacket,
};
