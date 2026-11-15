import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

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

  const rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = seq++;
      pending.set(id, { resolve, reject });
      window.chrome.webview.postMessage({ type: "rpc", id, method, params });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Studio RPC timeout: ${method}`));
        }
      }, 15000);
    });

  return {
    isNativeHost: true,
    getInitBundle: () => rpc("getInitBundle"),
    setSetting: (dotPath, value) => rpc("setSetting", { dotPath, value }),
    ensureDeadshotAsset: (relPath) => rpc("ensureDeadshotAsset", { relPath }),
    listCustomSkins: () => rpc("listCustomSkins"),
    saveCustomSkin: (payload) => rpc("saveCustomSkin", payload),
    deleteCustomSkin: (fileName) => rpc("deleteCustomSkin", { fileName }),
    importSkinFile: () => rpc("importSkinFile"),
    equipWeaponSkin: (payload) => rpc("equipWeaponSkin", payload),
    getCorsairStatus: () => rpc("getCorsairStatus"),
    rescanCorsair: () => rpc("rescanCorsair"),
    connectOpenRgb: (host, port) => rpc("connectOpenRgb", { host, port }),
    corsairTestPulse: (kind) => rpc("corsairTestPulse", { kind }),
    registerWebHidDevice: (info) => rpc("registerWebHidDevice", info),
    openFolders: () => rpc("openFolders"),
    reloadGameWindow: () => rpc("reloadGameWindow"),
    openExternal: (url) => rpc("openExternal", { url }),
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
const catalog = bundle.catalog;
let customSkins = bundle.customSkins || [];
const hw = bundle.hardware;

const primaryDisp = hw?.displays?.primary;
document.getElementById("hwBanner").textContent =
  `${hw?.cpu?.model || "CPU"} • ${hw?.gpu?.primaryName || "GPU"} • ${primaryDisp?.displayFrequency || 60}Hz`;

// --- Navigation Tabs ---
const tabBtns = document.querySelectorAll(".tab-btn");
const views = document.querySelectorAll(".studio-view");

let rendererInitialized = false;

function switchTab(tabId) {
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${tabId}`));
  if (tabId === "painter" && rendererInitialized) resizeRenderer();
}

tabBtns.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
const urlTab = new URLSearchParams(window.location.search).get("tab");
api.onSwitchTab((t) => switchTab(t));

document.getElementById("btnOpenFolder").addEventListener("click", () => api.openFolders());
document.getElementById("btnReloadGame").addEventListener("click", async () => {
  await api.reloadGameWindow();
  showToast("Reloading Deadshot window with updated textures");
});

// =========================================================================
// TAB 1: 2D UV SKIN PAINTER + LIVE 3D THREE.JS .GLB PREVIEWER
// =========================================================================
const uvCanvas = document.getElementById("uvCanvas");
const uvCtx = uvCanvas.getContext("2d", { willReadFrequently: true });
const maskCanvas = document.getElementById("maskCanvas");
const maskCtx = maskCanvas.getContext("2d");
const uvStatus = document.getElementById("uvStatus");
const glStage = document.getElementById("glStage");
const glCaption = document.getElementById("glCaption");

const weaponSelect = document.getElementById("weaponSelect");
const baseSkinSelect = document.getElementById("baseSkinSelect");
const chkAutoSpin = document.getElementById("chkAutoSpin");
const chkFlipY = document.getElementById("chkFlipY");

for (const [id, w] of Object.entries(catalog.WEAPONS)) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = `${w.name} (${id.toUpperCase()})`;
  weaponSelect.appendChild(opt);
}

for (const sk of catalog.OFFICIAL_SKINS) {
  const opt = document.createElement("option");
  opt.value = sk.id;
  opt.textContent = `Base: ${sk.name}`;
  baseSkinSelect.appendChild(opt);
}

// Offscreen original snapshot (for eraser & color-grading reset)
const baseSnapshotCanvas = document.createElement("canvas");
baseSnapshotCanvas.width = 1024;
baseSnapshotCanvas.height = 1024;
const baseSnapshotCtx = baseSnapshotCanvas.getContext("2d", { willReadFrequently: true });

let undoStack = [];
let showMask = true;
let activeTool = "brush";
let currentWeaponId = "ar";

function pushUndo() {
  undoStack.push(uvCtx.getImageData(0, 0, 1024, 1024));
  if (undoStack.length > 20) undoStack.shift();
}

// --- Three.js Scene ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
camera.position.set(1.3, 0.55, 1.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
glStage.insertBefore(renderer.domElement, glCaption);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xd8dde6, 1.25));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.75);
keyLight.position.set(2.5, 3.2, 2.4);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9cb2cf, 0.9);
rimLight.position.set(-2.5, 1.5, -2.2);
scene.add(rimLight);

const canvasTexture = new THREE.CanvasTexture(uvCanvas);
canvasTexture.flipY = false;
canvasTexture.colorSpace = THREE.SRGBColorSpace;
canvasTexture.needsUpdate = true;

chkFlipY.addEventListener("change", () => {
  canvasTexture.flipY = chkFlipY.checked;
  canvasTexture.needsUpdate = true;
});

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("./vendor/three/jsm/libs/draco/gltf/");
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

let activeModelRoot = null;

function applyTextureToModel(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.material = new THREE.MeshStandardMaterial({
        map: canvasTexture,
        roughness: 0.42,
        metalness: 0.28,
      });
    }
  });
  canvasTexture.needsUpdate = true;
}

function buildFallbackWeaponMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.14));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 12));
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.95, 0.03, 0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.1));
  grip.position.set(-0.18, -0.22, 0);
  grip.rotation.z = -0.22;
  group.add(body, barrel, grip);
  return group;
}

async function load3dModel(weaponId) {
  const w = catalog.WEAPONS[weaponId];
  if (activeModelRoot) {
    scene.remove(activeModelRoot);
    activeModelRoot = null;
  }

  glCaption.textContent = `Loading ${w.model}...`;
  try {
    const asset = await api.ensureDeadshotAsset(w.model);
    await new Promise((resolve, reject) => {
      gltfLoader.load(
        asset.customUrl,
        (gltf) => {
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const scale = 1.65 / maxDim;
          root.scale.setScalar(scale);
          root.position.sub(center.multiplyScalar(scale));
          activeModelRoot = root;
          applyTextureToModel(root);
          scene.add(root);
          glCaption.textContent = `${w.name} • Live 3D GLTF`;
          resolve();
        },
        undefined,
        reject
      );
    });
  } catch {
    activeModelRoot = buildFallbackWeaponMesh();
    applyTextureToModel(activeModelRoot);
    scene.add(activeModelRoot);
    glCaption.textContent = `${w.name} • Offline Fallback Geometry`;
  }
}

function drawImageUrlToCanvas(url, targetCtx, width = 1024, height = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      targetCtx.clearRect(0, 0, width, height);
      targetCtx.drawImage(img, 0, 0, width, height);
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
}

function paintSlateFallback() {
  const g = uvCtx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, "#23262e");
  g.addColorStop(1, "#14161b");
  uvCtx.fillStyle = g;
  uvCtx.fillRect(0, 0, 1024, 1024);
  uvCtx.strokeStyle = "rgba(212,216,223,0.12)";
  uvCtx.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 64) {
    uvCtx.beginPath();
    uvCtx.moveTo(i, 0);
    uvCtx.lineTo(i, 1024);
    uvCtx.stroke();
    uvCtx.beginPath();
    uvCtx.moveTo(0, i);
    uvCtx.lineTo(1024, i);
    uvCtx.stroke();
  }
}

async function loadWeaponBaseTexture(weaponId, baseSkinId = "default") {
  currentWeaponId = weaponId;
  const w = catalog.WEAPONS[weaponId];
  uvStatus.textContent = `Fetching ${w.shortName}...`;
  undoStack = [];

  const relPath =
    baseSkinId === "default"
      ? w.texture
      : baseSkinId === "ice"
      ? `skins/compressed/ice${weaponId}.webp`
      : `skins/compressed/${baseSkinId}${weaponId}0.webp`;

  try {
    const res = await api.ensureDeadshotAsset(relPath);
    await drawImageUrlToCanvas(res.customUrl, uvCtx);
    uvStatus.textContent = `Loaded ${relPath}`;
  } catch {
    paintSlateFallback();
    uvStatus.textContent = `Base Slate UV (Offline fallback)`;
  }

  baseSnapshotCtx.clearRect(0, 0, 1024, 1024);
  baseSnapshotCtx.drawImage(uvCanvas, 0, 0);
  canvasTexture.needsUpdate = true;

  // Load UV mask overlay if available for this gun
  maskCtx.clearRect(0, 0, 1024, 1024);
  if (w.mask) {
    try {
      const mRes = await api.ensureDeadshotAsset(w.mask);
      await drawImageUrlToCanvas(mRes.customUrl, maskCtx);
    } catch {}
  }
  maskCanvas.style.display = showMask ? "block" : "none";
}

function resizeRenderer() {
  if (!rendererInitialized) return;
  const rect = glStage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  renderer.setSize(rect.width, rect.height);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

rendererInitialized = true;
window.addEventListener("resize", resizeRenderer);
resizeRenderer();
if (urlTab) switchTab(urlTab);

function animate3d() {
  requestAnimationFrame(animate3d);
  if (activeModelRoot && chkAutoSpin.checked) {
    activeModelRoot.rotation.y += 0.004;
  }
  controls.update();
  renderer.render(scene, camera);
}
animate3d();

// --- Painting Interactions ---
const paintColorA = document.getElementById("paintColorA");
const paintColorB = document.getElementById("paintColorB");
const rngBrushSize = document.getElementById("rngBrushSize");
const rngBrushAlpha = document.getElementById("rngBrushAlpha");
const lblBrushSize = document.getElementById("lblBrushSize");
const lblBrushAlpha = document.getElementById("lblBrushAlpha");

rngBrushSize.addEventListener("input", () => (lblBrushSize.textContent = `${rngBrushSize.value}px`));
rngBrushAlpha.addEventListener("input", () => (lblBrushAlpha.textContent = `${rngBrushAlpha.value}%`));

document.querySelectorAll(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");
    activeTool = btn.dataset.tool;
  });
});

document.getElementById("btnToggleMask").addEventListener("click", (e) => {
  showMask = !showMask;
  maskCanvas.style.display = showMask ? "block" : "none";
  e.target.textContent = `UV Mask: ${showMask ? "ON" : "OFF"}`;
});

document.getElementById("btnUndo").addEventListener("click", () => {
  if (!undoStack.length) return;
  const imgData = undoStack.pop();
  uvCtx.putImageData(imgData, 0, 0);
  canvasTexture.needsUpdate = true;
});

function canvasPoint(ev) {
  const rect = uvCanvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * 1024,
    y: ((ev.clientY - rect.top) / rect.height) * 1024,
  };
}

let drawing = false;
let lastPt = null;
let lineStartSnapshot = null;

function applyBrushStroke(p1, p2) {
  const size = Number(rngBrushSize.value) || 24;
  const alpha = (Number(rngBrushAlpha.value) || 100) / 100;

  uvCtx.save();
  uvCtx.globalAlpha = alpha;

  if (activeTool === "eraser") {
    uvCtx.beginPath();
    uvCtx.arc(p2.x, p2.y, size / 2, 0, Math.PI * 2);
    uvCtx.clip();
    uvCtx.drawImage(baseSnapshotCanvas, 0, 0);
  } else if (activeTool === "airbrush") {
    const grad = uvCtx.createRadialGradient(p2.x, p2.y, 0, p2.x, p2.y, size);
    grad.addColorStop(0, paintColorA.value);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    uvCtx.fillStyle = grad;
    uvCtx.beginPath();
    uvCtx.arc(p2.x, p2.y, size, 0, Math.PI * 2);
    uvCtx.fill();
  } else {
    uvCtx.strokeStyle = paintColorA.value;
    uvCtx.lineWidth = size;
    uvCtx.lineCap = "round";
    uvCtx.lineJoin = "round";
    uvCtx.beginPath();
    uvCtx.moveTo(p1.x, p1.y);
    uvCtx.lineTo(p2.x, p2.y);
    uvCtx.stroke();
  }
  uvCtx.restore();
  canvasTexture.needsUpdate = true;
}

uvCanvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  pushUndo();
  const pt = canvasPoint(e);
  if (activeTool === "fill") {
    uvCtx.save();
    uvCtx.globalAlpha = (Number(rngBrushAlpha.value) || 100) / 100;
    uvCtx.globalCompositeOperation = "color";
    uvCtx.fillStyle = paintColorA.value;
    uvCtx.fillRect(0, 0, 1024, 1024);
    uvCtx.restore();
    canvasTexture.needsUpdate = true;
    return;
  }
  drawing = true;
  lastPt = pt;
  if (activeTool === "line") {
    lineStartSnapshot = uvCtx.getImageData(0, 0, 1024, 1024);
  } else {
    applyBrushStroke(pt, pt);
  }
});

window.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  const pt = canvasPoint(e);
  if (activeTool === "line" && lineStartSnapshot) {
    uvCtx.putImageData(lineStartSnapshot, 0, 0);
    uvCtx.save();
    uvCtx.globalAlpha = (Number(rngBrushAlpha.value) || 100) / 100;
    uvCtx.strokeStyle = paintColorA.value;
    uvCtx.lineWidth = Number(rngBrushSize.value) || 20;
    uvCtx.lineCap = "round";
    uvCtx.beginPath();
    uvCtx.moveTo(lastPt.x, lastPt.y);
    uvCtx.lineTo(pt.x, pt.y);
    uvCtx.stroke();
    uvCtx.restore();
    canvasTexture.needsUpdate = true;
  } else {
    applyBrushStroke(lastPt, pt);
    lastPt = pt;
  }
});

window.addEventListener("mouseup", () => {
  drawing = false;
  lineStartSnapshot = null;
});

// --- Procedural Generators ---
function runGenerator(kind) {
  pushUndo();
  const colA = paintColorA.value;
  const colB = paintColorB.value;

  if (kind === "fade") {
    const grad = uvCtx.createLinearGradient(0, 0, 1024, 1024);
    grad.addColorStop(0, colA);
    grad.addColorStop(1, colB);
    uvCtx.fillStyle = grad;
    uvCtx.fillRect(0, 0, 1024, 1024);
  } else if (kind === "carbon") {
    uvCtx.fillStyle = colB;
    uvCtx.fillRect(0, 0, 1024, 1024);
    uvCtx.fillStyle = colA;
    for (let y = 0; y < 1024; y += 16) {
      for (let x = 0; x < 1024; x += 16) {
        if (((x + y) / 16) % 2 === 0) {
          uvCtx.globalAlpha = 0.28;
          uvCtx.fillRect(x, y, 14, 7);
        } else {
          uvCtx.globalAlpha = 0.14;
          uvCtx.fillRect(x, y + 8, 14, 7);
        }
      }
    }
    uvCtx.globalAlpha = 1;
  } else if (kind === "topo") {
    uvCtx.fillStyle = colB;
    uvCtx.fillRect(0, 0, 1024, 1024);
    uvCtx.strokeStyle = colA;
    uvCtx.lineWidth = 3;
    uvCtx.globalAlpha = 0.45;
    for (let i = 0; i < 42; i++) {
      const cx = (Math.sin(i * 1.9) * 0.4 + 0.5) * 1024;
      const cy = (Math.cos(i * 1.3) * 0.4 + 0.5) * 1024;
      for (let r = 30; r <= 240; r += 35) {
        uvCtx.beginPath();
        uvCtx.ellipse(cx, cy, r * 1.3, r * 0.85, i * 0.3, 0, Math.PI * 2);
        uvCtx.stroke();
      }
    }
    uvCtx.globalAlpha = 1;
  } else if (kind === "shard") {
    uvCtx.fillStyle = colB;
    uvCtx.fillRect(0, 0, 1024, 1024);
    const step = 128;
    for (let y = 0; y < 1024; y += step) {
      for (let x = 0; x < 1024; x += step) {
        uvCtx.fillStyle = Math.random() > 0.5 ? colA : colB;
        uvCtx.globalAlpha = 0.25 + Math.random() * 0.55;
        uvCtx.beginPath();
        uvCtx.moveTo(x, y);
        uvCtx.lineTo(x + step, y);
        uvCtx.lineTo(x + step * Math.random(), y + step);
        uvCtx.closePath();
        uvCtx.fill();
      }
    }
    uvCtx.globalAlpha = 1;
  } else if (kind === "tiger") {
    uvCtx.fillStyle = colB;
    uvCtx.fillRect(0, 0, 1024, 1024);
    uvCtx.fillStyle = colA;
    for (let s = 0; s < 36; s++) {
      uvCtx.beginPath();
      const y = s * 32;
      uvCtx.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 128) {
        uvCtx.lineTo(x, y + Math.sin(x * 0.015 + s) * 28);
      }
      for (let x = 1024; x >= 0; x -= 128) {
        uvCtx.lineTo(x, y + 16 + Math.cos(x * 0.015 + s) * 24);
      }
      uvCtx.closePath();
      uvCtx.fill();
    }
  } else if (kind === "wear") {
    uvCtx.save();
    uvCtx.strokeStyle = "#cbd2dc";
    for (let i = 0; i < 160; i++) {
      uvCtx.globalAlpha = 0.1 + Math.random() * 0.25;
      uvCtx.lineWidth = 1 + Math.random() * 2.5;
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      uvCtx.beginPath();
      uvCtx.moveTo(x, y);
      uvCtx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
      uvCtx.stroke();
    }
    uvCtx.restore();
  }
  canvasTexture.needsUpdate = true;
}

document.querySelectorAll("[data-gen]").forEach((btn) => {
  btn.addEventListener("click", () => runGenerator(btn.dataset.gen));
});

// --- Color Grading ---
const rngHue = document.getElementById("rngHue");
const rngSat = document.getElementById("rngSat");
const rngCon = document.getElementById("rngCon");
rngHue.addEventListener("input", () => (document.getElementById("lblHue").textContent = `${rngHue.value}°`));
rngSat.addEventListener("input", () => (document.getElementById("lblSat").textContent = `${rngSat.value}%`));
rngCon.addEventListener("input", () => (document.getElementById("lblCon").textContent = `${rngCon.value}%`));

document.getElementById("btnApplyGrade").addEventListener("click", () => {
  pushUndo();
  const tmp = document.createElement("canvas");
  tmp.width = 1024;
  tmp.height = 1024;
  const tctx = tmp.getContext("2d");
  tctx.filter = `hue-rotate(${rngHue.value}deg) saturate(${rngSat.value}%) contrast(${rngCon.value}%)`;
  tctx.drawImage(uvCanvas, 0, 0);
  uvCtx.clearRect(0, 0, 1024, 1024);
  uvCtx.drawImage(tmp, 0, 0);
  canvasTexture.needsUpdate = true;
  showToast("Color grading baked onto skin UV");
});

document.getElementById("btnStampCenter").addEventListener("click", () => {
  const txt = document.getElementById("txtStamp").value.trim();
  if (!txt) return;
  pushUndo();
  uvCtx.save();
  uvCtx.font = "800 72px Segoe UI, sans-serif";
  uvCtx.fillStyle = paintColorA.value;
  uvCtx.strokeStyle = paintColorB.value;
  uvCtx.lineWidth = 6;
  uvCtx.textAlign = "center";
  uvCtx.textBaseline = "middle";
  uvCtx.strokeText(txt, 512, 512);
  uvCtx.fillText(txt, 512, 512);
  uvCtx.restore();
  canvasTexture.needsUpdate = true;
});

document.getElementById("btnLoadBase").addEventListener("click", () => {
  loadWeaponBaseTexture(weaponSelect.value, baseSkinSelect.value);
});

weaponSelect.addEventListener("change", () => {
  load3dModel(weaponSelect.value);
  loadWeaponBaseTexture(weaponSelect.value, baseSkinSelect.value);
});

// --- Save, Equip & Custom Vault ---
async function refreshVault() {
  customSkins = await api.listCustomSkins();
  const vaultEl = document.getElementById("vaultList");
  vaultEl.innerHTML = "";
  if (!customSkins.length) {
    vaultEl.innerHTML = `<div class="muted" style="font-size:11px;">No custom skins yet. Paint on the left or click Save .WEBP!</div>`;
    return;
  }
  for (const sk of customSkins) {
    const item = document.createElement("div");
    item.className = "vault-item";
    item.innerHTML = `
      <div class="vault-top">
        <img class="vault-thumb" src="${sk.customUrl}" />
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sk.name}</div>
          <div class="mono muted" style="font-size:10px;">${sk.weaponId.toUpperCase()} • ${Math.round(sk.sizeBytes / 1024)}KB</div>
        </div>
      </div>
      <div class="row-gap">
        <button class="btn flex-1 act-load">Edit</button>
        <button class="btn primary flex-1 act-equip">Equip</button>
        <button class="btn act-del">Del</button>
      </div>
    `;
    item.querySelector(".act-load").addEventListener("click", async () => {
      pushUndo();
      await drawImageUrlToCanvas(sk.customUrl, uvCtx);
      canvasTexture.needsUpdate = true;
      showToast(`Loaded "${sk.name}" into UV canvas`);
    });
    item.querySelector(".act-equip").addEventListener("click", async () => {
      await api.equipWeaponSkin({
        weaponId: sk.weaponId,
        mode: "custom",
        customFile: sk.fileName,
      });
      showToast(`Equipped "${sk.name}" on ${sk.weaponId.toUpperCase()}`);
    });
    item.querySelector(".act-del").addEventListener("click", async () => {
      await api.deleteCustomSkin(sk.fileName);
      refreshVault();
    });
    vaultEl.appendChild(item);
  }
}

async function saveCurrentSkin(applyImmediately = false) {
  const name = document.getElementById("skinNameInput").value.trim() || "Custom-Skin";
  const dataUrl = uvCanvas.toDataURL("image/webp", 0.92);
  const saved = await api.saveCustomSkin({
    name,
    weaponId: weaponSelect.value,
    dataUrl,
    applyImmediately,
    recipe: {
      baseSkin: baseSkinSelect.value,
      primaryColor: paintColorA.value,
      secondaryColor: paintColorB.value,
    },
  });
  await refreshVault();
  showToast(
    applyImmediately
      ? `Saved & Equipped "${saved.name}" on ${saved.weaponId.toUpperCase()}!`
      : `Saved "${saved.name}" (${saved.fileName})`
  );
}

document.getElementById("btnSaveSkin").addEventListener("click", () => saveCurrentSkin(false));
document.getElementById("btnSaveEquip").addEventListener("click", () => saveCurrentSkin(true));
document.getElementById("btnImportFile").addEventListener("click", async () => {
  const res = await api.importSkinFile();
  if (res?.ok) {
    await refreshVault();
    showToast(`Imported ${res.saved.name}`);
  }
});

// Boot Tab 1
load3dModel("ar");
loadWeaponBaseTexture("ar", "default");
refreshVault();

// =========================================================================
// TAB 2: CORSAIR RGB & VIRTUAL KEYBOARD LAB
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
        const css = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
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
// TAB 3: REVERSE-ENGINEERED DEADSHOT.IO PROJECT EXPLORER
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
      <div class="group-label">Application Overview & Developer Credits</div>
      <div class="exp-list">
        <div class="exp-item"><span>Client Name & Build</span><span class="mono muted">Dih Client v2.0 (${api?.isNativeHost ? "Native Rust + Win32 + WebView2" : "Electron"})</span></div>
        <div class="exp-item"><span>Developer GitHub</span><span class="mono" style="cursor:pointer;text-decoration:underline;" id="expGhLink">github.com/ewwhardik</span></div>
        <div class="exp-item"><span>Developer Discord</span><span class="mono" style="cursor:pointer;" id="expDcLink">ewwhardik (Click to Copy)</span></div>
        <div class="exp-item"><span>Core Subsystems</span><span class="mono muted">Uncapped FPS Telemetry • Custom UV/3D Skin Studio • Corsair/OpenRGB HID • 146 Modules</span></div>
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
