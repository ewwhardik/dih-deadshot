function createNativeStudioBridge() {
  if (!window.chrome?.webview) return null;
  let seq = 1;
  const pending = new Map();
  const corsairListeners = new Set();
  const settingsListeners = new Set();
  const tabListeners = new Set();

  window.chrome.webview.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "rpcResponse" && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    } else if (msg.type === "corsairFrame") {
      corsairListeners.forEach((cb) => cb(msg.payload));
    } else if (msg.type === "settingsUpdated") {
      settingsListeners.forEach((cb) => cb(msg.payload));
    } else if (msg.type === "studioTab") {
      tabListeners.forEach((cb) => cb(msg.payload));
    }
  });

  function rpc(method, params = {}) {
    const id = seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Studio RPC timeout: ${method}`));
        }
      }, 15000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      window.chrome.webview.postMessage({ type: "rpc", id, method, params });
    });
  }

  return {
    isNativeHost: true,
    getInitBundle: () => rpc("studioGetInit"),
    setSetting: (path, value) => rpc("setSetting", { path, value }),
    reloadGameWindow: () => rpc("reloadGame"),
    openFolders: () => rpc("openFolders"),
    openExternal: (url) => rpc("openExternal", { url }),
    getCorsairStatus: () => rpc("getCorsairStatus"),
    rescanCorsair: () => rpc("rescanCorsair"),
    connectOpenRgb: (host, port) => rpc("connectOpenRgb", { host, port }),
    corsairTestPulse: (pulseType) => rpc("corsairTestPulse", { pulseType }),
    registerWebHidDevice: (info) => rpc("registerWebHidDevice", info),
    onCorsairFrame: (cb) => {
      corsairListeners.add(cb);
      return () => corsairListeners.delete(cb);
    },
    onSettingsChanged: (cb) => {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    onSwitchTab: (cb) => {
      tabListeners.add(cb);
      return () => tabListeners.delete(cb);
    },
  };
}

const api = window.dihStudio || createNativeStudioBridge();
const toastEl = document.getElementById("studioToast");

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// --- Init Bundle ---
const bundle = await api.getInitBundle();
let settings = bundle.settings;
const catalog = window.__DIH_CATALOG__ || bundle.catalog;
const hw = bundle.hardware;

const primaryDisp = hw?.displays?.primary;
document.getElementById("hwBanner").textContent =
  `${hw?.cpu?.model || "CPU"} • ${hw?.gpu?.primaryName || "GPU"} • ${primaryDisp?.displayFrequency || 60}Hz`;

// --- Navigation Tabs ---
const tabBtns = document.querySelectorAll(".tab-btn");
const views = document.querySelectorAll(".studio-view");

function switchTab(tabPayload) {
  const isObj = tabPayload && typeof tabPayload === "object";
  const tabId = isObj ? (tabPayload.tab || "corsair") : String(tabPayload || "corsair");
  const validTab = document.getElementById(`view-${tabId}`) ? tabId : "corsair";

  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === validTab));
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${validTab}`));
}

tabBtns.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
const urlParams = new URLSearchParams(window.location.search);
const urlTab = urlParams.get("tab");
api.onSwitchTab((t) => switchTab(t));

document.getElementById("btnOfficialEditor")?.addEventListener("click", () => {
  api?.openExternal?.("https://deadshot.io/skineditor/");
});
document.getElementById("btnOpenFolder")?.addEventListener("click", () => api.openFolders());
document.getElementById("btnReloadGame")?.addEventListener("click", async () => {
  await api.reloadGameWindow();
  showToast("Reloading Deadshot window with updated textures");
});
document.getElementById("btnPainterCorsair")?.addEventListener("click", () => switchTab("corsair"));
document.getElementById("btnPainterFolder")?.addEventListener("click", () => api.openFolders());
document.getElementById("btnAimCorsair")?.addEventListener("click", () => switchTab("corsair"));
document.getElementById("btnAimExplorer")?.addEventListener("click", () => switchTab("explorer"));

api.onSettingsChanged?.((next) => {
  settings = next;
});

if (urlTab) {
  switchTab(urlTab);
} else {
  switchTab("corsair");
}

// =========================================================================
// TAB: CORSAIR RGB & VIRTUAL KEYBOARD LAB
// =========================================================================
const virtualKbd = document.getElementById("virtualKbd");
const virtualStrip = document.getElementById("virtualStrip");
const kbdLabels = [
  ["ESC", "", "F1", "F2", "F3", "F4", "", "F5", "F6", "F7", "F8", "", "F9", "F10", "F11", "F12", "PS", "SL", "PB", "M1", "M2", "MU"],
  ["~", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "BKSP", "INS", "HM", "PU", "NL", "/", "*", "-", "+"],
  ["TAB", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "DEL", "ED", "PD", "7", "8", "9", "+", ""],
  ["CAP", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "ENT", "ENT", "", "", "", "4", "5", "6", "+", ""],
  ["SHF", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "SHF", "", "UP", "", "1", "2", "3", "ENT", "", "", ""],
  ["CTL", "WIN", "ALT", "SPC", "SPC", "SPC", "SPC", "ALT", "FN", "APP", "CTL", "LT", "DN", "RT", "0", ".", "", "", "", "", "", ""],
];

const keyCells = [];
for (let r = 0; r < 6; r++) {
  const row = [];
  for (let c = 0; c < 22; c++) {
    const cell = document.createElement("div");
    cell.className = "kbd-key";
    cell.textContent = kbdLabels[r]?.[c] || "";
    virtualKbd.appendChild(cell);
    row.push(cell);
  }
  keyCells.push(row);
}

const stripCells = [];
for (let i = 0; i < 16; i++) {
  const led = document.createElement("div");
  led.className = "strip-led";
  virtualStrip.appendChild(led);
  stripCells.push(led);
}

let latestCorsairState = bundle.corsair || {};

function renderCorsairStatus(st) {
  if (!st) return;
  if (st.hardware || st.openRgb) {
    latestCorsairState = { ...latestCorsairState, ...st };
  }
  const merged = st.frame ? { ...latestCorsairState, frame: st.frame } : latestCorsairState;

  document.getElementById("corsairBanner").textContent = merged.frame?.statusBanner || "Corsair Bridge Ready";
  document.getElementById("corsairMeta").textContent =
    `iCUE: ${merged.hardware?.icueRunning ? "ON" : "OFF"} • USB VID_1B1C: ${merged.hardware?.usbCorsairDevices?.length || 0} • OpenRGB: ${merged.openRgb?.connected ? "CONNECTED" : "IDLE"}`;

  const hwItems = [
    ...(merged.hardware?.usbCorsairDevices || []).map((d) => `USB: ${d.name} (${d.status})`),
    ...(merged.hardware?.webHidDevices || []).map((d) => `WebHID: ${d.productName}`),
    ...(merged.openRgb?.controllers || []).map((c) => `OpenRGB: ${c.name} (${c.type})`),
  ];
  document.getElementById("corsairHwList").textContent = hwItems.length
    ? hwItems.join(" | ")
    : "No physical Corsair HID devices detected yet. Virtual visualizer always reflects active RGB output. For iCUE keyboards/fans, enable OpenRGB SDK Server or pair via WebHID (VID 0x1B1C).";

  const f = merged.frame;
  if (f?.keyGrid?.length) {
    for (let r = 0; r < Math.min(6, f.keyGrid.length); r++) {
      for (let c = 0; c < Math.min(22, f.keyGrid[r].length); c++) {
        const rgb = f.keyGrid[r][c];
        const cell = keyCells[r][c];
        cell.style.backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.26)`;
        cell.style.borderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`;
        cell.style.boxShadow = `0 0 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
      }
    }
    for (let i = 0; i < Math.min(16, f.strip?.length || 0); i++) {
      const rgb = f.strip[i];
      stripCells[i].style.backgroundColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      stripCells[i].style.boxShadow = `0 0 10px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`;
    }
  }
}

renderCorsairStatus(bundle.corsair);
api.onCorsairFrame((frame) => renderCorsairStatus({ ...bundle.corsair, frame }));

const corsairModeSelect = document.getElementById("corsairModeSelect");
corsairModeSelect.value = settings.corsair?.mode || "reactive_tactical";
corsairModeSelect.addEventListener("change", () => api.setSetting("corsair.mode", corsairModeSelect.value));

const rngRgbBright = document.getElementById("rngRgbBright");
rngRgbBright.value = settings.corsair?.brightness ?? 85;
document.getElementById("lblRgbBright").textContent = `${rngRgbBright.value}%`;
rngRgbBright.addEventListener("input", () => {
  document.getElementById("lblRgbBright").textContent = `${rngRgbBright.value}%`;
});
rngRgbBright.addEventListener("change", () => api.setSetting("corsair.brightness", Number(rngRgbBright.value)));

document.querySelectorAll("[data-pulse]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const frame = await api.corsairTestPulse(btn.dataset.pulse);
    renderCorsairStatus({ frame });
  });
});

document.getElementById("btnCorsairRescan").addEventListener("click", async () => {
  const st = await api.rescanCorsair();
  renderCorsairStatus(st);
  showToast("Hardware scan completed");
});

document.getElementById("btnConnectOpenRgb").addEventListener("click", async () => {
  const st = await api.connectOpenRgb(settings.corsair?.openRgbHost, settings.corsair?.openRgbPort);
  renderCorsairStatus(st);
  showToast(st.openRgb?.connected ? "OpenRGB SDK Connected" : st.openRgb?.lastError || "Unable to connect OpenRGB");
});

document.getElementById("btnPairWebHid").addEventListener("click", async () => {
  try {
    if (!navigator.hid) return showToast("WebHID API unavailable");
    const devs = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x1b1c }] });
    if (!devs.length) return showToast("No Corsair HID device selected");
    for (const d of devs) {
      await api.registerWebHidDevice({
        vendorId: d.vendorId,
        productId: d.productId,
        productName: d.productName,
        opened: d.opened,
      });
    }
    renderCorsairStatus(await api.getCorsairStatus());
    showToast(`Linked ${devs.length} Corsair HID device(s)`);
  } catch (err) {
    showToast(`WebHID: ${err.message}`);
  }
});

// =========================================================================
// TAB: REVERSE-ENGINEERED DEADSHOT.IO PROJECT EXPLORER
// =========================================================================
const explorerContent = document.getElementById("explorerContent");
const explorerSearch = document.getElementById("explorerSearch");

function renderExplorer(filter = "") {
  const q = filter.trim().toLowerCase();
  explorerContent.innerHTML = "";

  if (!q) {
    const overviewCard = document.createElement("div");
    overviewCard.className = "exp-card";
    overviewCard.innerHTML = `
      <div class="group-label">Application Overview &amp; Developer Credits</div>
      <div class="exp-list">
        <div class="exp-item"><span>Client Name &amp; Build</span><span class="mono muted">Dih Client v0.4.1 (${api?.isNativeHost ? "Native Rust + Win32 + WebView2" : "Electron"})</span></div>
        <div class="exp-item"><span>Developer GitHub</span><span class="mono" style="cursor:pointer;text-decoration:underline;" id="expGhLink">github.com/ewwhardik</span></div>
        <div class="exp-item"><span>Developer Discord</span><span class="mono" style="cursor:pointer;" id="expDcLink">ewwhardik (Click to Copy)</span></div>
        <div class="exp-item"><span>Core Subsystems</span><span class="mono muted">Uncapped FPS Telemetry • 2D .frag Shader Baker • Corsair/OpenRGB HID • ${catalog.FEATURE_REGISTRY?.length || 201} Modules (3D Studio &amp; Aim Trainer Coming Soon)</span></div>
      </div>
    `;
    explorerContent.appendChild(overviewCard);
    overviewCard.querySelector("#expGhLink")?.addEventListener("click", () => {
      api?.openExternal?.("https://github.com/ewwhardik");
    });
    overviewCard.querySelector("#expDcLink")?.addEventListener("click", async () => {
      await navigator.clipboard?.writeText("ewwhardik");
      showToast("Copied Discord username: ewwhardik");
    });
  }

  const sections = [
    {
      title: "Weapons, Models & UV Masks",
      items: Object.entries(catalog.WEAPONS).map(([id, w]) => ({
        left: `${w.name} [${id}]`,
        right: `${w.model} • ${w.texture}${w.mask ? " • " + w.mask : ""}`,
      })),
    },
    {
      title: "Official Static Skins Pool (26)",
      items: catalog.OFFICIAL_SKINS.map((s) => ({
        left: `${s.name} (${s.rarity})`,
        right: `skins/compressed/${s.id}<weapon><0-4>.webp`,
      })),
    },
    {
      title: "Official Shader Skins (10)",
      items: catalog.SHADER_SKINS.map((s) => ({
        left: `${s.name} (${s.rarity})`,
        right: s.textures.join(", "),
      })),
    },
    {
      title: "Maps & Melee Assets",
      items: [
        ...catalog.MAPS.map((m) => ({ left: `${m.name} (${m.location})`, right: m.folder })),
        ...catalog.MELEE_AND_UTILITY_MODELS.map((m) => ({ left: m.name, right: m.model })),
      ],
    },
    {
      title: "dsio:settings:2 Indexed Schema (36 Keys)",
      items: catalog.DSIO_SETTINGS_KEYS.map((k, idx) => ({
        left: `Slot [${idx}]`,
        right: k,
      })),
    },
    {
      title: "Storage Keys, Characters & Environment Assets",
      items: [
        ...catalog.STORAGE_KEYS.map((k) => ({ left: "localStorage Key", right: k })),
        ...(catalog.CHARACTER_ASSETS || []).map((c) => ({ left: `Character: ${c.name}`, right: c.path })),
        ...Object.entries(catalog.ENVIRONMENT_AND_UI_ASSETS).flatMap(([grp, list]) =>
          list.map((item) => ({ left: `${grp}: ${item.name}`, right: item.path }))
        ),
      ],
    },
  ];

  for (const sec of sections) {
    const filtered = sec.items.filter(
      (i) => !q || i.left.toLowerCase().includes(q) || i.right.toLowerCase().includes(q)
    );
    if (!filtered.length) continue;

    const card = document.createElement("div");
    card.className = "exp-card";
    card.innerHTML = `<div class="group-label">${sec.title} (${filtered.length})</div><div class="exp-list"></div>`;
    const listEl = card.querySelector(".exp-list");
    for (const item of filtered) {
      const row = document.createElement("div");
      row.className = "exp-item";
      row.innerHTML = `<span>${item.left}</span><span class="mono muted">${item.right}</span>`;
      listEl.appendChild(row);
    }
    explorerContent.appendChild(card);
  }
}

explorerSearch.addEventListener("input", () => renderExplorer(explorerSearch.value));
renderExplorer();
