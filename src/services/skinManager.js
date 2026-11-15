/**
 * In-Client Skin Changer, Custom Skin Vault, Deadshot Official Asset Cacher & WebRequest Resolver.
 */

const fs = require("fs");
const path = require("path");
const {
  WEAPONS,
  OFFICIAL_SKINS,
  buildOfficialSkinUrl,
} = require("../data/deadshotCatalog");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const EQUIPPED_SKIN_RE = /^skins\/compressed\/([a-z0-9]+?)(ar|smg|awp|shotgun|dmr|pistol|lmg)([0-4]?)\.webp$/i;

function sanitizeSkinName(rawName) {
  return String(rawName || "custom-skin")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "custom-skin";
}

function isWithinDir(baseDir, candidatePath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(candidatePath);
  return target === base || target.startsWith(base + path.sep);
}

class SkinManagerService {
  constructor({ userDataPath, appRoot }) {
    this.userDataPath = userDataPath;
    this.appRoot = appRoot;
    this.customSkinsDir = path.join(userDataPath, "custom-skins");
    this.userSwapDir = path.join(userDataPath, "swap");
    this.appSwapDir = path.join(appRoot, "swap");
    this.assetCacheDir = path.join(userDataPath, "asset-cache");
    this.appAssetsDir = path.join(appRoot, "assets");
    this.swapIndex = new Map();
    this.ensureDirectories();
    this.rescanSwapIndex();
  }

  ensureDirectories() {
    for (const dir of [this.customSkinsDir, this.userSwapDir, this.assetCacheDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getPaths() {
    return {
      customSkinsDir: this.customSkinsDir,
      userSwapDir: this.userSwapDir,
      appSwapDir: this.appSwapDir,
      assetCacheDir: this.assetCacheDir,
    };
  }

  listCustomSkins() {
    this.ensureDirectories();
    const files = fs.readdirSync(this.customSkinsDir);
    const items = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (![".webp", ".png", ".jpg", ".jpeg"].includes(ext)) continue;
      const fullPath = path.join(this.customSkinsDir, file);
      const stat = fs.statSync(fullPath);
      const stem = path.basename(file, ext);
      const metaPath = path.join(this.customSkinsDir, `${stem}.dihskin.json`);
      let meta = {};
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch {}
      }
      items.push({
        fileName: file,
        name: meta.name || stem,
        weaponId: meta.weaponId || "ar",
        author: meta.author || "You",
        createdAt: meta.createdAt || stat.mtime.toISOString(),
        sizeBytes: stat.size,
        customUrl: `custom://dih/custom-skins/${encodeURIComponent(file)}`,
        recipe: meta.recipe || null,
      });
    }

    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return items;
  }

  saveCustomSkin({ name, weaponId = "ar", dataUrl, recipe = null }) {
    this.ensureDirectories();
    if (!dataUrl || typeof dataUrl !== "string") {
      throw new Error("Missing image dataUrl");
    }

    const match = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
    if (!match) {
      throw new Error("Unsupported skin image format (expected webp, png, or jpeg base64 dataUrl)");
    }

    const imgType = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
      throw new Error("Skin image buffer empty or exceeds 25 MB limit");
    }

    const safeWeapon = WEAPONS[weaponId] ? weaponId : "ar";
    const safeSlug = sanitizeSkinName(name);
    const fileName = `${safeWeapon}-${safeSlug}.${imgType}`;
    const targetPath = path.join(this.customSkinsDir, fileName);

    fs.writeFileSync(targetPath, buffer);

    const meta = {
      name: String(name || safeSlug).trim(),
      weaponId: safeWeapon,
      author: "Dih Studio",
      createdAt: new Date().toISOString(),
      fileName,
      recipe,
    };
    const metaPath = path.join(this.customSkinsDir, `${safeWeapon}-${safeSlug}.dihskin.json`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

    return {
      ...meta,
      sizeBytes: buffer.length,
      customUrl: `custom://dih/custom-skins/${encodeURIComponent(fileName)}`,
    };
  }

  deleteCustomSkin(fileName) {
    const cleanName = path.basename(String(fileName || ""));
    if (!cleanName) return { ok: false };
    const fullPath = path.join(this.customSkinsDir, cleanName);
    if (!isWithinDir(this.customSkinsDir, fullPath) || !fs.existsSync(fullPath)) {
      return { ok: false };
    }
    fs.unlinkSync(fullPath);
    const stem = path.basename(cleanName, path.extname(cleanName));
    const metaPath = path.join(this.customSkinsDir, `${stem}.dihskin.json`);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    return { ok: true };
  }

  rescanSwapIndex() {
    this.swapIndex = new Map();
    const indexDir = (rootDir, rootKey) => {
      if (!fs.existsSync(rootDir)) return;
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else {
            const rel = path.relative(rootDir, full).replace(/\\/g, "/");
            const url = `custom://dih/${rootKey}/${rel.split("/").map(encodeURIComponent).join("/")}`;
            const relLower = rel.toLowerCase();
            const baseLower = entry.name.toLowerCase();
            const rec = { relativePath: rel, source: rootKey === "user-swap" ? "user" : "builtin", url };
            this.swapIndex.set(relLower, rec);
            this.swapIndex.set(baseLower, rec);
          }
        }
      };
      walk(rootDir);
    };
    indexDir(this.appSwapDir, "app-swap");
    indexDir(this.userSwapDir, "user-swap");
    return this.listSwapFiles();
  }

  listSwapFiles() {
    const found = [];
    const walk = (rootDir, source) => {
      if (!fs.existsSync(rootDir)) return;
      const entries = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          walk(full, source);
        } else {
          const rel = path.relative(rootDir, full).replace(/\\/g, "/");
          found.push({ relativePath: rel, source });
        }
      }
    };
    walk(this.appSwapDir, "builtin");
    walk(this.userSwapDir, "user");
    return found;
  }

  _findSwapFile(relPath) {
    const cleanRel = String(relPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
    if (!cleanRel) return null;

    const cleanLower = cleanRel.toLowerCase();
    const directHit = this.swapIndex.get(cleanLower);
    if (directHit) return directHit.url;

    const baseHit = this.swapIndex.get(path.posix.basename(cleanLower));
    if (baseHit) return baseHit.url;

    const userCandidate = path.join(this.userSwapDir, cleanRel);
    if (isWithinDir(this.userSwapDir, userCandidate) && fs.existsSync(userCandidate)) {
      return `custom://dih/user-swap/${cleanRel.split("/").map(encodeURIComponent).join("/")}`;
    }

    const appCandidate = path.join(this.appSwapDir, cleanRel);
    if (isWithinDir(this.appSwapDir, appCandidate) && fs.existsSync(appCandidate)) {
      return `custom://dih/app-swap/${cleanRel.split("/").map(encodeURIComponent).join("/")}`;
    }

    return null;
  }

  resolveCustomProtocolPath(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "custom:") return null;
      const segments = decodeURIComponent(u.pathname).replace(/^\/+/, "").split("/").filter(Boolean);
      if (segments.length < 2) return null;

      const rootKey = segments[0];
      const rel = segments.slice(1).join(path.sep);
      const rootMap = {
        "custom-skins": this.customSkinsDir,
        "user-swap": this.userSwapDir,
        "app-swap": this.appSwapDir,
        "cache": this.assetCacheDir,
        "assets": this.appAssetsDir,
      };
      const baseDir = rootMap[rootKey];
      if (!baseDir) return null;
      const resolved = path.resolve(baseDir, rel);
      if (!isWithinDir(baseDir, resolved) || !fs.existsSync(resolved)) return null;
      return resolved;
    } catch {
      return null;
    }
  }

  resolveRequest(rawUrl, settings) {
    if (!settings?.skins?.swapperEnabled) return null;

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return null;
    }

    if (parsed.hostname !== "deadshot.io" && parsed.hostname !== "www.deadshot.io") {
      return null;
    }

    const reqPath = parsed.pathname.replace(/^\/+/, "");
    const skinCfg = settings.skins || {};
    const weaponsCfg = skinCfg.weapons || {};

    // 1. Check active per-weapon skin config
    for (const [weaponId, weapon] of Object.entries(WEAPONS)) {
      const cfg = weaponsCfg[weaponId];
      if (!cfg || cfg.mode === "default") continue;

      const targets = [weapon.texture];
      if (weapon.legacyTexture) targets.push(weapon.legacyTexture);
      if (skinCfg.syncMobileVariants !== false && weapon.mobileTexture) targets.push(weapon.mobileTexture);
      if (skinCfg.syncSmallIcons !== false && weapon.smallTexture) targets.push(weapon.smallTexture);

      if (targets.includes(reqPath)) {
        if (cfg.mode === "custom" && cfg.customFile) {
          const safeFile = path.basename(cfg.customFile);
          const diskPath = path.join(this.customSkinsDir, safeFile);
          if (isWithinDir(this.customSkinsDir, diskPath) && fs.existsSync(diskPath)) {
            return {
              redirectURL: `custom://dih/custom-skins/${encodeURIComponent(safeFile)}`,
              matchedType: "weapon_custom",
              weaponId,
            };
          }
        } else if (cfg.mode === "official" && cfg.officialId && cfg.officialId !== "default") {
          const validOfficial = OFFICIAL_SKINS.some((s) => s.id === cfg.officialId);
          if (validOfficial) {
            return {
              redirectURL: buildOfficialSkinUrl(cfg.officialId, weaponId, Number(cfg.wear) || 0),
              matchedType: "weapon_official",
              weaponId,
            };
          }
        }
      }
    }

    // 1b. Override equipped in-game skins (skins/compressed/<skinId><weaponId><0-4>.webp)
    if (skinCfg.overrideEquippedGameSkin !== false) {
      const m = EQUIPPED_SKIN_RE.exec(reqPath);
      if (m) {
        const matchedWeapon = m[2].toLowerCase();
        const cfg = weaponsCfg[matchedWeapon];
        if (cfg && cfg.mode === "custom" && cfg.customFile) {
          const safeFile = path.basename(cfg.customFile);
          const diskPath = path.join(this.customSkinsDir, safeFile);
          if (isWithinDir(this.customSkinsDir, diskPath) && fs.existsSync(diskPath)) {
            return {
              redirectURL: `custom://dih/custom-skins/${encodeURIComponent(safeFile)}`,
              matchedType: "weapon_custom_override",
              weaponId: matchedWeapon,
            };
          }
        } else if (cfg && cfg.mode === "official" && cfg.officialId && cfg.officialId !== "default") {
          const validOfficial = OFFICIAL_SKINS.some((s) => s.id === cfg.officialId);
          if (validOfficial) {
            const targetUrl = buildOfficialSkinUrl(cfg.officialId, matchedWeapon, Number(cfg.wear) || 0);
            const targetPath = new URL(targetUrl).pathname.replace(/^\/+/, "");
            if (reqPath !== targetPath) {
              return {
                redirectURL: targetUrl,
                matchedType: "weapon_official_override",
                weaponId: matchedWeapon,
              };
            }
          }
        }
      }
    }

    // 2. Extra built-in Dih swaps (minimalist scope reticle, Dih logo, dark slate skybox)
    const extra = skinCfg.extraSwaps || {};
    if (
      (reqPath === "textures/sniperscope.webp" || reqPath === "textures/blurredsniperscope.webp") &&
      extra.scope &&
      extra.scope !== "default"
    ) {
      const map = {
        dih_minimal: "presets/scope-minimal.svg",
        dih_dot: "presets/scope-dot.svg",
        dih_rangefinder: "presets/scope-rangefinder.svg",
      };
      const target = map[extra.scope] || "presets/scope-minimal.svg";
      const swapUrl = this._findSwapFile(target);
      if (swapUrl) return { redirectURL: swapUrl, matchedType: "scope" };
    }

    if ((reqPath === "promo/logo.webp" || reqPath === "images/logo.webp") && extra.logo && extra.logo !== "default") {
      const swapUrl = this._findSwapFile("promo/dih-logo.svg");
      if (swapUrl) return { redirectURL: swapUrl, matchedType: "logo" };
    }

    if (
      ["textures/skybox.webp", "textures/sunsetskybox.webp", "textures/nightskybox.webp"].includes(reqPath) &&
      extra.skybox &&
      extra.skybox !== "default"
    ) {
      const file = reqPath.split("/").pop();
      const customSky = this._findSwapFile(`skybox/${extra.skybox}/${file}`);
      if (customSky) return { redirectURL: customSky, matchedType: "skybox" };
    }

    // 3. Generic local swap directory override matching exact relative path
    const genericSwap = this._findSwapFile(reqPath);
    if (genericSwap) {
      return { redirectURL: genericSwap, matchedType: "swap_override" };
    }

    return null;
  }

  async ensureCachedDeadshotAsset(relPath) {
    this.ensureDirectories();
    const cleanRel = String(relPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
    if (!cleanRel || !/^[a-zA-Z0-9_.\-/]+$/.test(cleanRel)) {
      throw new Error("Invalid Deadshot asset path");
    }

    const cachePath = path.resolve(this.assetCacheDir, cleanRel);
    if (!isWithinDir(this.assetCacheDir, cachePath)) {
      throw new Error("Path traversal blocked");
    }

    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
      return {
        cached: true,
        localPath: cachePath,
        customUrl: `custom://dih/cache/${cleanRel.split("/").map(encodeURIComponent).join("/")}`,
        sizeBytes: fs.statSync(cachePath).size,
      };
    }

    const url = `https://deadshot.io/${cleanRel}`;
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) {
      throw new Error(`Asset fetch failed (${res.status}) for ${url}`);
    }
    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, buf);

    return {
      cached: false,
      localPath: cachePath,
      customUrl: `custom://dih/cache/${cleanRel.split("/").map(encodeURIComponent).join("/")}`,
      sizeBytes: buf.length,
    };
  }
}

module.exports = {
  SkinManagerService,
  sanitizeSkinName,
};
