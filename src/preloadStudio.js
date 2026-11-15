/**
 * Context-isolated Preload Bridge for Dih 3D Gun Skin Studio, Corsair RGB Lab & Asset Explorer.
 */

const { contextBridge, ipcRenderer } = require("electron");

const studioApi = {
  getInitBundle: () => ipcRenderer.invoke("dih:studio-init-bundle"),
  setSetting: (dotPath, value) => ipcRenderer.invoke("dih:set-setting", dotPath, value),
  ensureDeadshotAsset: (relPath) => ipcRenderer.invoke("dih:ensure-asset", relPath),

  // Custom skins vault
  listCustomSkins: () => ipcRenderer.invoke("dih:list-custom-skins"),
  saveCustomSkin: (payload) => ipcRenderer.invoke("dih:save-custom-skin", payload),
  deleteCustomSkin: (fileName) => ipcRenderer.invoke("dih:delete-custom-skin", fileName),
  importSkinFile: () => ipcRenderer.invoke("dih:import-skin-file"),
  equipWeaponSkin: (payload) => ipcRenderer.invoke("dih:equip-weapon-skin", payload),

  // Corsair & OpenRGB
  getCorsairStatus: () => ipcRenderer.invoke("dih:corsair-status"),
  rescanCorsair: () => ipcRenderer.invoke("dih:corsair-rescan"),
  connectOpenRgb: (host, port) => ipcRenderer.invoke("dih:corsair-connect-openrgb", host, port),
  corsairTestPulse: (kind) => ipcRenderer.invoke("dih:corsair-test-pulse", kind),
  registerWebHidDevice: (info) => ipcRenderer.invoke("dih:corsair-webhid-register", info),

  // Utilities
  openFolders: () => ipcRenderer.invoke("dih:open-folders"),
  reloadGameWindow: () => ipcRenderer.invoke("dih:reload-game"),
  openExternal: (url) => ipcRenderer.invoke("dih:open-external", url),

  // Event listeners
  onCorsairFrame: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, frame) => callback(frame);
    ipcRenderer.on("dih:corsair-frame", listener);
    return () => ipcRenderer.removeListener("dih:corsair-frame", listener);
  },
  onSettingsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("dih:settings-updated", listener);
    return () => ipcRenderer.removeListener("dih:settings-updated", listener);
  },
  onSwitchTab: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, tab) => callback(tab);
    ipcRenderer.on("dih:studio-tab", listener);
    return () => ipcRenderer.removeListener("dih:studio-tab", listener);
  },
};

contextBridge.exposeInMainWorld("dihStudio", studioApi);
