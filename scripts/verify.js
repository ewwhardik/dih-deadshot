/**
 * Automated Verification Suite for Dih Client.
 * Validates JS syntax, 120+ feature bindings, SettingsStore, real SystemMetrics,
 * Corsair OpenRGB binary protocol + lighting engine, SkinManager WebRequest/custom:// resolver,
 * and live Electron Chromium CDP end-to-end execution of Game + Studio windows.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const http = require("http");
const vm = require("vm");
const { execFileSync, spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_VERSION = require("../package.json").version;

const { DEFAULT_SETTINGS, THEME_PRESETS } = require("../src/data/defaultSettings");
const {
  WEAPONS,
  OFFICIAL_SKINS,
  SHADER_SKINS,
  DIH_SKIN_PACKS,
  WEAPON_BALLISTICS,
  MAPS,
  DSIO_SETTINGS_KEYS,
  buildOfficialSkinUrl,
} = require("../src/data/deadshotCatalog");
const { FEATURE_CATEGORIES, FEATURE_REGISTRY } = require("../src/data/featureRegistry");
const { SettingsStore } = require("../src/services/settingsStore");
const { SystemMetricsService } = require("../src/services/systemMetrics");
const { CorsairBridgeService, encodeOpenRgbPacket } = require("../src/services/corsairBridge");
const { SkinManagerService } = require("../src/services/skinManager");

function getByDotPath(obj, dotPath) {
  return String(dotPath).split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
}

async function testSyntax() {
  const jsFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "vendor") continue;
        walk(full);
      } else if (entry.name.endsWith(".js") && entry.name !== "studio.js") {
        jsFiles.push(full);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  jsFiles.push(path.join(ROOT, "docs", "app.js"), path.join(ROOT, "docs", "features-data.js"));
  for (const file of jsFiles) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
  // Verify lightweight Studio keeps Corsair + RE Explorer active while 3D Studio & Aim Trainer stay Coming Soon
  const studioJs = fs.readFileSync(path.join(ROOT, "src", "studio", "studio.js"), "utf8");
  assert(studioJs.includes("renderCorsairStatus") && studioJs.includes("renderExplorer") && !studioJs.includes("from \"three\"") && !studioJs.includes("initAimTrainer"));
  console.log(`[PASS] Syntax check across ${jsFiles.length} CommonJS/renderer/docs JS files`);
}

function testFeatureRegistryAndCatalog() {
  assert(FEATURE_CATEGORIES.length >= 9, `Expected >=9 feature categories, got ${FEATURE_CATEGORIES.length}`);
  assert(FEATURE_REGISTRY.length >= 190, `Expected >=190 features, got ${FEATURE_REGISTRY.length}`);

  const docsDataSrc = fs.readFileSync(path.join(ROOT, "docs", "features-data.js"), "utf8");
  const docsMatch = docsDataSrc.match(/window\.DIH_DOCS_DATA\s*=\s*(\{[\s\S]*\});/);
  assert(docsMatch, "docs/features-data.js must define window.DIH_DOCS_DATA");
  const docsData = JSON.parse(docsMatch[1]);
  assert.strictEqual(fs.readFileSync(path.join(ROOT, "version.txt"), "utf8").trim(), EXPECTED_VERSION, "version.txt out of sync with package.json");
  assert.strictEqual(docsData.version, EXPECTED_VERSION, `Expected docs version ${EXPECTED_VERSION}, got ${docsData.version}`);
  assert.strictEqual(docsData.featureCount, FEATURE_REGISTRY.length, "docs/features-data.js out of sync (run npm run sync-docs)");
  assert.strictEqual(docsData.features?.length, FEATURE_REGISTRY.length, "docs/features-data.js features array length mismatch");
  const licenseSrc = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
  assert(licenseSrc.includes("ewwhardik") && licenseSrc.includes("All Rights Reserved"), "Proprietary LICENSE missing ewwhardik All Rights Reserved notice");
  assert(Array.isArray(DIH_SKIN_PACKS) && DIH_SKIN_PACKS.some((p) => p.id === "royalflush"), "Missing Royal Flush shader skin pack");
  assert(Object.keys(WEAPON_BALLISTICS || {}).length === 7, "Expected 7 weapons in WEAPON_BALLISTICS");

  const seenIds = new Set();
  for (const feat of FEATURE_REGISTRY) {
    assert(feat.id && !seenIds.has(feat.id), `Duplicate or empty feature id: ${feat.id}`);
    seenIds.add(feat.id);
    if (feat.settingPath) {
      const resolved = getByDotPath(DEFAULT_SETTINGS, feat.settingPath);
      assert(resolved !== undefined, `Feature ${feat.id} references missing DEFAULT_SETTINGS path: ${feat.settingPath}`);
    } else {
      assert(feat.actionId, `Feature ${feat.id} has neither settingPath nor actionId`);
    }
  }

  assert.strictEqual(Object.keys(WEAPONS).length, 7);
  assert.strictEqual(OFFICIAL_SKINS.length, 26);
  assert.strictEqual(SHADER_SKINS.length, 10);
  assert(MAPS.length >= 6);
  assert.strictEqual(DSIO_SETTINGS_KEYS.length, 36);
  assert.strictEqual(buildOfficialSkinUrl("bacon", "ar", 0), "https://deadshot.io/skins/compressed/baconar0.webp");
  assert.strictEqual(buildOfficialSkinUrl("ice", "awp", 3), "https://deadshot.io/skins/compressed/iceawp.webp");
  assert.strictEqual(Object.keys(THEME_PRESETS).length, 4);
  console.log(`[PASS] Catalog & ${FEATURE_REGISTRY.length} unique features verified against DEFAULT_SETTINGS`);
}

function testSettingsStore(tmpDir) {
  const store = new SettingsStore(path.join(tmpDir, "settings-test"));
  assert.strictEqual(store.get("clientName"), "Dih");
  assert.strictEqual(store.get("performance.presetMode"), "max_compute");
  assert.strictEqual(store.get("performance.disableFrameRateLimit"), true);
  assert.strictEqual(store.get("performance.hostRamTargetMb"), 12);

  store.set("crosshair.size", 19);
  assert.strictEqual(store.get("crosshair.size"), 19);

  store.applyThemePreset("titaniumMist");
  assert.strictEqual(store.get("theme.preset"), "titaniumMist");
  assert.strictEqual(store.get("theme.accent"), "#e6e8ec");

  store.applyPerfPreset("low_end");
  assert.strictEqual(store.get("performance.presetMode"), "low_end");
  assert.strictEqual(store.get("performance.webviewMemoryMode"), "low");
  assert.strictEqual(store.get("performance.hostRamTargetMb"), 10);
  assert.strictEqual(store.get("performance.disableGpuVsync"), false);
  assert.strictEqual(store.get("performance.softwareFpsCap"), 60);

  store.applyPerfPreset("balanced");
  assert.strictEqual(store.get("performance.presetMode"), "balanced");
  assert.strictEqual(store.get("performance.processPriority"), "above_normal");

  store.applyPerfPreset("max_compute");
  assert.strictEqual(store.get("performance.presetMode"), "max_compute");
  assert.strictEqual(store.get("performance.disableFrameRateLimit"), true);
  assert.strictEqual(store.get("performance.disableGpuVsync"), true);
  assert.strictEqual(store.get("performance.processPriority"), "high");

  store.setHudPosition("telemetry", { x: 40, y: 64 });
  const bundle = store.exportBundle();
  assert.strictEqual(bundle.schema, "dih-profile-v1");

  store.resetAll();
  assert.strictEqual(store.get("crosshair.size"), 14);
  store.importBundle(bundle);
  assert.strictEqual(store.get("crosshair.size"), 19);
  assert.deepStrictEqual(store.getHudPositions().telemetry, { x: 40, y: 64 });
  console.log("[PASS] SettingsStore persistence, presets, export/import verified");
}

async function testSystemMetrics() {
  const metrics = new SystemMetricsService();
  await metrics.init();
  const hw = await metrics.getStaticHardwareSummary();
  assert(hw.cpu.model && hw.cpu.physicalCores >= 1);
  assert(hw.memory.totalGb > 0);
  await new Promise((r) => setTimeout(r, 80));
  const live = metrics.getLiveMetrics();
  assert(live.ram.totalGb > 0 && live.ram.usedGb > 0);
  assert(typeof live.cpuPercent === "number" && live.cpuPercent >= 0);
  const analysis = await metrics.analyzeHardwarePower();
  assert(analysis.powerScore >= 10 && analysis.powerScore <= 100, `Unexpected powerScore: ${analysis.powerScore}`);
  assert(["extreme_workstation", "esports_desktop", "balanced_laptop", "low_end_pc"].includes(analysis.tier), `Invalid tier: ${analysis.tier}`);
  assert(["max_compute", "balanced", "low_end"].includes(analysis.recommendedPreset), `Invalid preset: ${analysis.recommendedPreset}`);
  assert(analysis.recommendations && typeof analysis.recommendations === "object" && analysis.recommendations.presetMode === analysis.recommendedPreset);
  console.log(
    `[PASS] SystemMetrics real hardware detected: ${hw.cpu.model} | ${hw.gpu.primaryName} | ${hw.displays?.primary?.displayFrequency || "?"}Hz | PowerScore=${analysis.powerScore}/100 (${analysis.tier})`
  );
}

async function testCorsairBridge() {
  const bridge = new CorsairBridgeService();
  const pkt = encodeOpenRgbPacket(0, 50, Buffer.from("Dih Client\0"));
  assert.strictEqual(pkt.subarray(0, 4).toString("ascii"), "ORGB");
  assert.strictEqual(pkt.readUInt32LE(8), 50);

  const modes = [
    "reactive_tactical",
    "fps_thermal",
    "ping_health",
    "breathing",
    "spectrum",
    "ads_focus",
    "reload_sweep",
    "keymap_zones",
    "audio_pulse",
    "static_slate",
  ];
  for (const mode of modes) {
    bridge.setConfig({ enabled: true, mode, brightness: 85, highlightWasd: true, flashOnShoot: true });
    const frame = bridge.computeFrame(Date.now());
    assert.strictEqual(frame.keyGrid.length, 6);
    assert.strictEqual(frame.keyGrid[0].length, 22);
    assert.strictEqual(frame.strip.length, 16);
    const px = frame.keyGrid[2][2];
    assert(px.r >= 0 && px.r <= 255 && px.g >= 0 && px.g <= 255 && px.b >= 0 && px.b <= 255);
  }

  // Test real localhost TCP OpenRGB handshake packet receipt
  let receivedPkts = 0;
  const server = net.createServer((sock) => {
    sock.on("data", (buf) => {
      if (buf.subarray(0, 4).toString("ascii") === "ORGB") receivedPkts++;
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await bridge.connectOpenRgb("127.0.0.1", port);
  await new Promise((r) => setTimeout(r, 80));
  assert(receivedPkts >= 1, "Expected OpenRGB client name/controller packets on TCP socket");
  bridge.disconnectOpenRgb();
  await new Promise((r) => server.close(r));
  console.log("[PASS] CorsairBridge 10 RGB modes & OpenRGB binary TCP framing verified");
}

function testSkinManager(tmpDir) {
  const mgr = new SkinManagerService({ userDataPath: path.join(tmpDir, "skins-test"), appRoot: ROOT });
  // 1x1 transparent WebP base64
  const tinyWebp = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
  const saved = mgr.saveCustomSkin({ name: "Obsidian Test", weaponId: "ar", dataUrl: tinyWebp });
  assert(fs.existsSync(path.join(mgr.customSkinsDir, saved.fileName)));

  const settingsCustom = {
    skins: {
      swapperEnabled: true,
      syncSmallIcons: true,
      syncMobileVariants: true,
      weapons: {
        ar: { mode: "custom", officialId: "default", wear: 0, customFile: saved.fileName },
        awp: { mode: "official", officialId: "vapor", wear: 2, customFile: "" },
      },
      extraSwaps: { scope: "dih_minimal", logo: "dih_grey", skybox: "default" },
    },
  };

  const rCustom = mgr.resolveRequest("https://deadshot.io/weapons/ar2/arcomp.webp?v=123", settingsCustom);
  assert(rCustom && rCustom.redirectURL.startsWith("custom://dih/custom-skins/"));

  const rSmall = mgr.resolveRequest("https://deadshot.io/weapons/ar2/arcompsmall.webp", settingsCustom);
  assert(rSmall && rSmall.redirectURL === rCustom.redirectURL);

  const rOfficial = mgr.resolveRequest("https://deadshot.io/weapons/awp/newawpcomp.webp", settingsCustom);
  assert.strictEqual(rOfficial.redirectURL, "https://deadshot.io/skins/compressed/vaporawp2.webp");

  const rScope = mgr.resolveRequest("https://deadshot.io/textures/sniperscope.webp", settingsCustom);
  assert(rScope && rScope.redirectURL.includes("scope-minimal.svg"));

  // Security check: block path traversal inside custom:// handler
  assert.strictEqual(mgr.resolveCustomProtocolPath("custom://dih/custom-skins/../../package.json"), null);
  console.log("[PASS] SkinManager custom .webp vault, URL interception & path traversal guard verified");
}

async function testElectronLiveIntegration(tmpDir) {
  // Start local mock fixture HTTP server simulating deadshot.io shell + dsio:settings:2
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><head><title>Mock Deadshot</title></head><body>
      <canvas id="game" width="640" height="360"></canvas>
      <input id="uname" value="DihTester" />
      <script>
        localStorage.setItem("dsio:settings:2", JSON.stringify([0,[null,null,null,null,null,null,null,[0,[0,0.45]],[0,[0,0.6]],[0,[0,true]],null,[0,[0,true]],[0,[0,1]],null,[0,[0,false]],null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,[0,[0,false]],[0,[0,95]]]]));
      </script>
    </body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpPort = server.address().port;

  const electronExe = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  const debugPort = 9347;
  const userDataDir = path.join(tmpDir, "electron-profile");

  const child = spawn(
    electronExe,
    [".", `--remote-debugging-port=${debugPort}`],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DIH_USER_DATA: userDataDir,
        DIH_ALLOW_MULTI_INSTANCE: "1",
        DIH_SKIP_ADBLOCK_NETWORK: "1",
        DIH_TEST_URL: `http://127.0.0.1:${httpPort}/`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stderrBuf = "";
  child.stderr.on("data", (d) => (stderrBuf += d.toString()));

  const cdpEval = async (wsUrl, expr) => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const res = await new Promise((resolve, reject) => {
      const id = 1;
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          if (msg.result?.exceptionDetails) {
            reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
          } else {
            resolve(msg.result?.result?.value);
          }
        }
      });
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression: expr, awaitPromise: true, returnByValue: true },
        })
      );
    });
    ws.close();
    return res;
  };

  try {
    // Poll CDP targets
    let mainTarget = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const targets = await r.json();
        mainTarget = targets.find((t) => t.type === "page" && t.url.includes(`127.0.0.1:${httpPort}`));
        if (mainTarget) {
          // Wait until shadow host mounts
          const ready = await cdpEval(
            mainTarget.webSocketDebuggerUrl,
            "Boolean(document.getElementById('dih-shadow-host')?.shadowRoot?.querySelector('.dih-telemetry'))"
          );
          if (ready) break;
        }
      } catch {}
    }

    assert(mainTarget, "Main Electron window failed to load or attach CDP");

    const gameCheck = await cdpEval(
      mainTarget.webSocketDebuggerUrl,
      `(async () => {
        const host = document.getElementById('dih-shadow-host');
        const sr = host.shadowRoot;
        const hasNodeLeak = typeof window.require !== 'undefined' || typeof window.module !== 'undefined' || typeof window.global !== 'undefined';
        const pill = sr.querySelector('.dih-pill-launcher');
        pill.click();
        await new Promise(r => setTimeout(r, 150));
        const ccBackdrop = sr.querySelector('.dih-cc-backdrop');
        const ccVisible = Boolean(ccBackdrop && !ccBackdrop.classList.contains('dih-hidden'));
        const hasHeroCard = Boolean(sr.querySelector('.dih-hero-hw'));
        const hasFavStrip = Boolean(sr.querySelector('.dih-fav-strip'));
        const navBtns = Array.from(sr.querySelectorAll('.dih-nav-item'));
        let hasSubTabs = false;
        let maxOverflowPx = 0;
        for (const b of navBtns) {
          b.click();
          if (sr.querySelector('.dih-subtabs')) hasSubTabs = true;
          const body = sr.querySelector('.dih-cc .dih-stage-body');
          if (body) maxOverflowPx = Math.max(maxOverflowPx, body.scrollWidth - body.clientWidth);
        }
        await new Promise(r => setTimeout(r, 80));
        // Pane cache: revisiting a tab must reuse its laid-out pane, not rebuild it
        navBtns[1].click();
        const perfPane = sr.querySelector('.dih-pane:not(.off)');
        navBtns[0].click();
        navBtns[1].click();
        const paneCached = perfPane === sr.querySelector('.dih-pane:not(.off)') && perfPane.isConnected;
        // Closed panel stays mounted (visibility) so it reopens without re-layout
        [...sr.querySelectorAll('.dih-cc .dih-stage-header .dih-btn')].find(b => b.textContent === 'ESC').click();
        const closedMounted = ccBackdrop.classList.contains('dih-closed') && getComputedStyle(ccBackdrop).visibility === 'hidden' && sr.querySelectorAll('.dih-pane').length > 0;
        pill.click();
        const navCount = navBtns.length;
        const catalog = await window.dih.getCatalog();
        const hw = await window.dih.getStaticHardware();
        const hwAnalysis = await window.dih.runHardwareAnalysis(false);
        await window.dih.openStudio('corsair');
        return {
          paneCached,
          closedMounted,
          hasNodeLeak,
          ccVisible,
          hasHeroCard,
          hasFavStrip,
          hasSubTabs,
          maxOverflowPx,
          powerScore: hwAnalysis?.analysis?.powerScore || 0,
          navCount,
          featureCount: catalog.FEATURE_REGISTRY.length,
          hz: hw.displays.primary.displayFrequency,
          cpu: hw.cpu.model,
        };
      })()`
    );

    assert.strictEqual(gameCheck.paneCached, true, "Command Center tab pane was rebuilt instead of reused from cache");
    assert.strictEqual(gameCheck.closedMounted, true, "Closed Command Center should stay mounted (visibility hidden) for instant reopen");
    assert.strictEqual(gameCheck.hasNodeLeak, false, "Node globals must never leak into Deadshot window");
    assert.strictEqual(gameCheck.ccVisible, true, "Command Center modal failed to open on pill click");
    assert.strictEqual(gameCheck.hasHeroCard, true, "Overview Hero PC Power card missing");
    assert.strictEqual(gameCheck.hasFavStrip, true, "Overview Pinned Favorites strip missing");
    assert.strictEqual(gameCheck.hasSubTabs, true, "Sub-tabs navigation missing inside dense tabs");
    assert(gameCheck.maxOverflowPx <= 2, `Command Center horizontal overflow detected: ${gameCheck.maxOverflowPx}px`);
    assert(gameCheck.powerScore >= 10 && gameCheck.powerScore <= 100, "IPC runHardwareAnalysis failed");
    assert.strictEqual(gameCheck.navCount, 7, "Expected 7 navigation tabs in Command Center");
    assert(gameCheck.featureCount >= 190, `Feature count check failed in IPC: ${gameCheck.featureCount}`);
    assert(gameCheck.hz > 0, "Monitor Hz detection failed");

    // Wait for Studio window target and verify Corsair + Explorer + Coming Soon views mounted cleanly
    let studioTarget = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((r) => setTimeout(r, 300));
      const r = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const targets = await r.json();
      studioTarget = targets.find((t) => t.type === "page" && t.url.includes("studio.html"));
      if (studioTarget) {
        const studioReady = await cdpEval(
          studioTarget.webSocketDebuggerUrl,
          "Boolean(document.querySelector('#virtualKbd .kbd-key') && document.querySelector('#explorerContent .exp-card'))"
        );
        if (studioReady) break;
      }
    }
    assert(studioTarget, "Dih Studio window failed to launch");

    const studioCheck = await cdpEval(
      studioTarget.webSocketDebuggerUrl,
      `(async () => {
        const kbdKeys = document.querySelectorAll('#virtualKbd .kbd-key').length;
        const expCards = document.querySelectorAll('#explorerContent .exp-card').length;
        const explorerText = document.getElementById('explorerContent').textContent || '';
        const corsairActive = Boolean(document.getElementById('view-corsair')?.classList.contains('active'));
        const painterSoon = Boolean(document.querySelector('#view-painter .coming-soon-card'));
        const aimSoon = Boolean(document.querySelector('#view-aimtrainer .coming-soon-card'));
        return { kbdKeys, expCards, corsairActive, painterSoon, aimSoon, hasObjLeak: explorerText.includes('[object Object]') };
      })()`
    );

    assert.strictEqual(studioCheck.kbdKeys, 132, "Expected 6x22 Corsair K70 virtual key matrix");
    assert(studioCheck.expCards >= 5, "Deadshot RE Explorer missing asset cards");
    assert.strictEqual(studioCheck.hasObjLeak, false, "Found [object Object] rendering bug in RE Explorer");
    assert.strictEqual(studioCheck.corsairActive, true, "Studio should open cleanly onto Corsair RGB tab");
    assert.strictEqual(studioCheck.painterSoon, true, "3D Studio Coming Soon card missing");
    assert.strictEqual(studioCheck.aimSoon, true, "Aim Trainer Coming Soon card missing");

    console.log(
      `[PASS] Live Electron integration passed (0 leaks, 0 overflow, CommandCenter=${gameCheck.ccVisible}, CorsairKeys=${studioCheck.kbdKeys}, ComingSoon=true)`
    );
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {}
    await new Promise((r) => server.close(r));
  }
}

function testNativeDistribution(tmpDir) {
  const exePath = path.join(ROOT, "dist", "Dih", "Dih.exe");
  if (!fs.existsSync(exePath)) {
    console.log("[SKIP] Native dist/Dih/Dih.exe not built yet");
    return;
  }
  const reportFile = path.join(tmpDir, "native-smoke.json");
  execFileSync(
    exePath,
    ["--smoke-test", `--smoke-test-out=${reportFile}`],
    {
      env: { ...process.env, DIH_USER_DATA: path.join(tmpDir, "native-profile") },
      stdio: "pipe",
    }
  );
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.version, EXPECTED_VERSION, `Native version mismatch: ${report.version}`);
  assert(report.featureCount >= 190, `Native catalog missing features: ${report.featureCount}`);
  const exeBytes = fs.statSync(exePath).size;
  assert(exeBytes < 1_000_000, `Expected native Dih.exe < 1 MB (1,000,000 bytes), got ${exeBytes}`);
  const distEntries = fs.readdirSync(path.join(ROOT, "dist", "Dih"));
  const looseFiles = distEntries.filter((f) => /\.(js|html|css|json)$/i.test(f) || f === "studio" || f === "assets");
  assert.strictEqual(looseFiles.length, 0, `Expected zero loose source files in dist/Dih, found: ${looseFiles.join(", ")}`);
  assert.strictEqual(report.studioExists, true, "Studio HTML missing from embedded binary");
  assert.strictEqual(report.threeJsRemoved, true, "Three.js should be omitted while Coming Soon");
  assert.strictEqual(report.aimTrainerRemoved, true, "7-gun Aim Trainer should be omitted while Coming Soon");
  assert.strictEqual(report.adblockBlockedTest, true, "Native adblocker failed test URL");
  assert.strictEqual(report.adblockVenatusTest, true, "Native adblocker failed Venatus URL");
  assert.strictEqual(report.adblockAtmtdTest, true, "Native adblocker failed Atmtd URL");
  assert.strictEqual(report.adblockAllowedGame, true, "Native adblocker blocked game asset");
  assert.strictEqual(report.logoSwapMime, "image/svg+xml", "Centered Dih logo swap failed");
  assert(report.staticHardware?.gpu?.primaryName, "DXGI GPU name missing");
  assert(report.staticHardware?.displays?.primary?.displayFrequency > 0, "Win32 monitor Hz missing");
  assert(typeof report.liveMetrics?.hostMemoryMb === "number", "Native hostMemoryMb missing");
  console.log(
    `[PASS] Native Rust/C dist/Dih/Dih.exe (${(exeBytes / 1024).toFixed(1)} KB < 1 MB) smoke verified (${report.featureCount} features, HostRAM=${report.liveMetrics.hostMemoryMb}MB, GPU=${report.staticHardware.gpu.primaryName}, Hz=${report.staticHardware.displays.primary.displayFrequency}Hz)`
  );
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dih-verify-"));
  try {
    await testSyntax();
    testFeatureRegistryAndCatalog();
    testSettingsStore(tmpDir);
    await testSystemMetrics();
    await testCorsairBridge();
    testSkinManager(tmpDir);
    await testElectronLiveIntegration(tmpDir);
    testNativeDistribution(tmpDir);
    console.log("\nALL DIH CLIENT VERIFICATION CHECKS PASSED.");
  } catch (err) {
    console.error("\nVERIFICATION FAILED:", err);
    process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
})();
