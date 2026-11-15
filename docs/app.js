/* Dih Client Interactive GitHub Pages Showcase */
(function () {
  const DATA = window.DIH_DOCS_DATA || {
    version: "0.3.0",
    featureCount: 196,
    categories: [],
    features: [],
    weapons: [],
    officialSkins: [],
  };

  document.getElementById("nav-version").textContent = `v${DATA.version} • ${DATA.featureCount} FEATURES`;
  document.getElementById("hero-feat-count").textContent = String(DATA.featureCount);
  document.getElementById("hero-stat-feats").textContent = `${DATA.featureCount}+`;
  document.getElementById("catalog-count").textContent = String(DATA.featureCount);

  // Subtle live hero mock readout
  setInterval(() => {
    const fps = 1980 + Math.floor(Math.random() * 290);
    const low = Math.round(fps * 0.72);
    const ping = 12 + Math.floor(Math.random() * 5);
    const fpsEl = document.getElementById("mock-fps");
    const lowEl = document.getElementById("mock-low");
    const pingEl = document.getElementById("mock-ping");
    if (fpsEl) fpsEl.textContent = String(fps);
    if (lowEl) lowEl.textContent = String(low);
    if (pingEl) pingEl.textContent = `${ping} ms`;
  }, 650);

  // --- 1. Animated Boot Hardware Power Analyzer Simulator ---
  const RIGS = {
    extreme: {
      cpu: "Core i9-14900K (24C/32T)",
      gpu: "RTX 4080 (16 GB VRAM)",
      ram: "32 GB DDR5",
      hz: "240 Hz",
      scores: [35, 35, 15, 15],
      tier: "Extreme Esports Workstation",
      summary: "Auto-Applied -> Profile: MAX_COMPUTE • Host RAM Target: 14 MB • Priority: HIGH + P-Core Mask • DPR Scale: 1.0x • WebGL Desync: ON",
    },
    esports: {
      cpu: "Core i5-12400F (6C/12T)",
      gpu: "GTX 1650 (4 GB VRAM)",
      ram: "16 GB DDR4",
      hz: "144 Hz",
      scores: [27, 28, 12, 12],
      tier: "High-FPS Esports Rig",
      summary: "Auto-Applied -> Profile: MAX_COMPUTE • Host RAM Target: 12 MB • EcoQoS: OFF • Priority: HIGH • DPR Scale: 1.0x • WebGL Desync: ON",
    },
    laptop: {
      cpu: "Ryzen 5 5500U (6C/12T)",
      gpu: "Radeon Integrated Graphics",
      ram: "12 GB LPDDR4",
      hz: "60 Hz",
      scores: [22, 12, 9, 6],
      tier: "Balanced Competitive",
      summary: "Auto-Applied -> Profile: BALANCED • Host RAM Target: 12 MB • Priority: ABOVE_NORMAL • DPR Scale: 0.95x • Thermal Pacing: ON",
    },
    low: {
      cpu: "Celeron N4020 (2C/2T)",
      gpu: "Intel UHD 600 (Shared)",
      ram: "4 GB RAM",
      hz: "60 Hz",
      scores: [7, 9, 3, 6],
      tier: "Battery / Low-End Device",
      summary: "Auto-Applied -> Profile: LOW_END • Host RAM Target: 10 MB • WebView2 Low Memory • DPR Scale: 0.80x • Reduce Motion: ON",
    },
  };

  let simTimer = null;
  function runAnalyzerSim(rig) {
    if (simTimer) clearTimeout(simTimer);
    const total = Math.max(10, Math.min(100, rig.scores.reduce((a, b) => a + b, 0)));
    const phaseEl = document.getElementById("sim-phase");
    const progEl = document.getElementById("sim-prog");
    const tierEl = document.getElementById("sim-tier");
    const scoreEl = document.getElementById("sim-score");

    phaseEl.textContent = "[PHASE 1/3] INITIALIZING ENGINE HOST";
    progEl.style.width = "28%";
    tierEl.textContent = "Probing Hardware Interfaces...";
    scoreEl.textContent = "--";

    simTimer = setTimeout(() => {
      phaseEl.textContent = "[PHASE 2/3] ANALYZING CPU / GPU / RAM / HZ";
      progEl.style.width = "68%";
      document.getElementById("sim-cpu").textContent = rig.cpu;
      document.getElementById("sim-gpu").textContent = rig.gpu;
      document.getElementById("sim-ram").textContent = rig.ram;
      document.getElementById("sim-hz").textContent = rig.hz;
      document.getElementById("sim-cpu-bar").style.width = `${Math.round((rig.scores[0] / 35) * 100)}%`;
      document.getElementById("sim-gpu-bar").style.width = `${Math.round((rig.scores[1] / 35) * 100)}%`;
      document.getElementById("sim-ram-bar").style.width = `${Math.round((rig.scores[2] / 15) * 100)}%`;
      document.getElementById("sim-hz-bar").style.width = `${Math.round((rig.scores[3] / 15) * 100)}%`;

      simTimer = setTimeout(() => {
        phaseEl.textContent = "[PHASE 3/3] OPTIMAL SETTINGS APPLIED";
        progEl.style.width = "100%";
        tierEl.textContent = rig.tier;
        scoreEl.textContent = String(total);
        document.getElementById("sim-applied").textContent = rig.summary;
      }, 420);
    }, 320);
  }

  document.querySelectorAll(".sim-hw-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sim-hw-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      runAnalyzerSim(RIGS[btn.dataset.rig] || RIGS.esports);
    });
  });

  document.getElementById("detect-browser-hw")?.addEventListener("click", () => {
    const threads = navigator.hardwareConcurrency || 4;
    const ram = navigator.deviceMemory || 8;
    let renderer = "Hardware WebGL2 GPU";
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl");
      const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
      if (dbg) renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || renderer;
    } catch {}
    const cpuScore = threads >= 16 ? 32 : threads >= 12 ? 27 : threads >= 8 ? 20 : 11;
    const gpuScore = /rtx\s*(40|50|30[789])/i.test(renderer) ? 34 : /nvidia|geforce|radeon rx/i.test(renderer) ? 26 : 12;
    const ramScore = ram >= 16 ? 12 : ram >= 8 ? 8 : 4;
    const hzScore = 6;
    const total = cpuScore + gpuScore + ramScore + hzScore;
    const preset = total >= 54 ? "MAX_COMPUTE" : total < 36 ? "LOW_END" : "BALANCED";
    runAnalyzerSim({
      cpu: `Detected Browser Threads: ${threads}T`,
      gpu: renderer.slice(0, 40),
      ram: `Approx. ${ram} GB Device Memory`,
      hz: `${window.screen?.width || 1920}x${window.screen?.height || 1080} Display`,
      scores: [cpuScore, gpuScore, ramScore, hzScore],
      tier: total >= 76 ? "Extreme Esports Workstation" : total >= 54 ? "High-FPS Esports Rig" : total < 36 ? "Battery / Low-End Device" : "Balanced Competitive",
      summary: `Live Browser Probe Complete -> Recommended Profile: ${preset} (${total}/100)`,
    });
  });

  // --- 2. Interactive Crosshair, Black-EQ & Net-Graph Sandbox ---
  const xState = {
    t: "CrossDot",
    s: 8,
    th: 2,
    g: 3,
    d: 2,
    c: "#d4d8df",
    dc: "#ffffff",
    oa: 0.85,
    beq: 15,
    vib: 20,
  };

  const XHAIR_PRESETS = {
    dih_minimal: { t: "CrossDot", s: 7, th: 1.5, g: 3, d: 1.5, c: "#d4d8df", dc: "#ffffff", oa: 0.85 },
    tenz: { t: "Cross", s: 8, th: 2, g: 4, d: 0, c: "#57f2f2", dc: "#57f2f2", oa: 0.9 },
    scream: { t: "Dot", s: 4, th: 2, g: 0, d: 2.5, c: "#ffffff", dc: "#ffffff", oa: 1.0 },
    circle_tac: { t: "CircleDot", s: 8, th: 1.5, g: 4, d: 1.5, c: "#f2f4f7", dc: "#ffffff", oa: 0.85 },
  };

  function encodeXhairCode(st) {
    const payload = {
      v: 1,
      t: st.t,
      c: st.c,
      o: 1,
      oc: "#0a0b0d",
      ow: 1.5,
      s: st.s,
      th: st.th,
      g: st.g,
      d: st.d,
      a: 0.95,
      r: 0,
      tk: false,
    };
    const json = JSON.stringify(payload);
    return `DIH-XHAIR:${btoa(json)}`;
  }

  function renderXhairSandbox() {
    const host = document.getElementById("pg-xhair-host");
    if (!host) return;
    const cx = 48, cy = 48;
    const parts = [];
    const oa = xState.oa;
    const strokeLine = (x1, y1, x2, y2) => {
      if (oa > 0) {
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0a0b0d" stroke-opacity="${oa}" stroke-width="${xState.th + 2.4}" stroke-linecap="round"/>`);
      }
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${xState.c}" stroke-width="${xState.th}" stroke-linecap="round"/>`);
    };

    const g = xState.g, s = xState.s;
    if (xState.t === "Cross" || xState.t === "CrossDot" || xState.t === "TCross") {
      if (xState.t !== "TCross") strokeLine(cx, cy - g - s, cx, cy - g);
      strokeLine(cx, cy + g, cx, cy + g + s);
      strokeLine(cx - g - s, cy, cx - g, cy);
      strokeLine(cx + g, cy, cx + g + s, cy);
    } else if (xState.t === "CircleDot") {
      if (oa > 0) parts.push(`<circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="#0a0b0d" stroke-opacity="${oa}" stroke-width="${xState.th + 2}"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="${xState.c}" stroke-width="${xState.th}"/>`);
    } else if (xState.t === "XShaped") {
      const k = 0.707;
      strokeLine(cx - (g + s) * k, cy - (g + s) * k, cx - g * k, cy - g * k);
      strokeLine(cx + g * k, cy - g * k, cx + (g + s) * k, cy - (g + s) * k);
      strokeLine(cx - (g + s) * k, cy + (g + s) * k, cx - g * k, cy + g * k);
      strokeLine(cx + g * k, cy + g * k, cx + (g + s) * k, cy + (g + s) * k);
    } else if (xState.t === "Chevron") {
      strokeLine(cx, cy, cx - s, cy + s);
      strokeLine(cx, cy, cx + s, cy + s);
    } else if (xState.t === "Brackets") {
      strokeLine(cx - g - 4, cy - s, cx - g - 4, cy + s);
      strokeLine(cx + g + 4, cy - s, cx + g + 4, cy + s);
    }

    if (xState.d > 0 && (xState.t === "Dot" || xState.t === "CrossDot" || xState.t === "CircleDot" || xState.t === "XShaped")) {
      if (oa > 0) parts.push(`<circle cx="${cx}" cy="${cy}" r="${xState.d + 1.2}" fill="#0a0b0d" fill-opacity="${oa}"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${xState.d}" fill="${xState.dc}"/>`);
    }

    host.innerHTML = `<svg width="96" height="96" viewBox="0 0 96 96">${parts.join("")}</svg>`;

    const scene = document.getElementById("pg-scene");
    if (scene) {
      const bright = 100 + xState.beq * 0.9;
      const sat = 100 + xState.vib * 0.9;
      const contrast = 100 + Math.round(xState.beq * 0.2);
      scene.style.filter = `brightness(${bright}%) contrast(${contrast}%) saturate(${sat}%)`;
    }

    document.getElementById("pg-code").value = encodeXhairCode(xState);
    document.getElementById("lbl-size").textContent = `${xState.s}px`;
    document.getElementById("lbl-thick").textContent = `${xState.th}px`;
    document.getElementById("lbl-gap").textContent = `${xState.g}px`;
    document.getElementById("lbl-dot").textContent = `${xState.d}px`;
    document.getElementById("lbl-outa").textContent = String(xState.oa);
    document.getElementById("lbl-beq").textContent = String(xState.beq);
    document.getElementById("lbl-vib").textContent = `${xState.vib}%`;
  }

  function syncPlaygroundInputs() {
    document.getElementById("pg-type").value = xState.t;
    document.getElementById("pg-size").value = String(xState.s);
    document.getElementById("pg-thick").value = String(xState.th);
    document.getElementById("pg-gap").value = String(xState.g);
    document.getElementById("pg-dot").value = String(xState.d);
    document.getElementById("pg-outa").value = String(xState.oa);
    document.getElementById("pg-color").value = xState.c;
    document.getElementById("pg-dotcol").value = xState.dc;
  }

  document.querySelectorAll(".pg-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pg-preset").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      Object.assign(xState, XHAIR_PRESETS[btn.dataset.preset] || XHAIR_PRESETS.dih_minimal);
      syncPlaygroundInputs();
      renderXhairSandbox();
    });
  });

  [
    ["pg-type", "t", (v) => v],
    ["pg-size", "s", Number],
    ["pg-thick", "th", Number],
    ["pg-gap", "g", Number],
    ["pg-dot", "d", Number],
    ["pg-outa", "oa", Number],
    ["pg-color", "c", (v) => v],
    ["pg-dotcol", "dc", (v) => v],
    ["pg-beq", "beq", Number],
    ["pg-vib", "vib", Number],
  ].forEach(([id, key, parse]) => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      xState[key] = parse(e.target.value);
      renderXhairSandbox();
    });
  });

  document.getElementById("pg-viewport")?.addEventListener("click", () => {
    const hm = document.getElementById("pg-hitmarker");
    const xh = document.getElementById("pg-xhair-host");
    if (hm) {
      hm.style.opacity = "0.95";
      setTimeout(() => { hm.style.opacity = "0"; }, 110);
    }
    if (xh) {
      xh.style.transform = "translate(-50%, -50%) scale(1.22)";
      setTimeout(() => { xh.style.transform = "translate(-50%, -50%) scale(1)"; }, 110);
    }
  });

  document.getElementById("pg-copy-code")?.addEventListener("click", async () => {
    const inp = document.getElementById("pg-code");
    const btn = document.getElementById("pg-copy-code");
    try {
      await navigator.clipboard.writeText(inp.value);
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Code"; }, 1400);
    } catch {}
  });
  renderXhairSandbox();

  // Animated Playground Net-Graph Canvas
  const ngCanvas = document.getElementById("pg-ng-canvas");
  if (ngCanvas) {
    const ctx = ngCanvas.getContext("2d");
    const pts = Array.from({ length: 64 }, () => 1850 + Math.random() * 240);
    setInterval(() => {
      const nextFps = 1820 + Math.floor(Math.random() * 340);
      pts.shift();
      pts.push(nextFps);
      const readout = document.getElementById("pg-ng-readout");
      if (readout) readout.textContent = `${nextFps} FPS • ${(1000 / nextFps).toFixed(2)}ms • ${13 + Math.floor(Math.random() * 4)}ms`;
      const w = ngCanvas.width, h = ngCanvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#d4d8df";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = (i / (pts.length - 1)) * w;
        const y = h - 6 - ((pts[i] - 1500) / 900) * (h - 14);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }, 180);
  }

  // --- 3. Interactive Corsair 6x22 RGB Matrix ---
  const k70Grid = document.getElementById("k70-grid");
  const keyEls = [];
  if (k70Grid) {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 22; c++) {
        const div = document.createElement("div");
        div.className = "k70-key";
        k70Grid.appendChild(div);
        keyEls.push({ r, c, el: div });
      }
    }
  }
  let rgbMode = "reactive_tactical";
  let flashUntil = 0;
  let adsOn = false;
  let reloadUntil = 0;
  let tick = 0;
  document.getElementById("rgb-mode")?.addEventListener("change", (e) => { rgbMode = e.target.value; });
  document.getElementById("rgb-fire")?.addEventListener("click", () => { flashUntil = performance.now() + 220; });
  document.getElementById("rgb-ads")?.addEventListener("click", () => { adsOn = !adsOn; });
  document.getElementById("rgb-reload")?.addEventListener("click", () => { reloadUntil = performance.now() + 900; });

  if (keyEls.length) {
    setInterval(() => {
      tick += 0.14;
      const now = performance.now();
      const firing = now < flashUntil;
      const reloading = now < reloadUntil;
      for (const k of keyEls) {
        let col = "#252933";
        const isWasd = (k.r === 2 && k.c === 2) || (k.r === 3 && k.c >= 1 && k.c <= 3);
        if (firing && k.c > 1 && k.c < 18) {
          col = "#ffffff";
        } else if (reloading && k.r === 2 && k.c === 4) {
          col = "#e2b866";
        } else if (rgbMode === "reactive_tactical") {
          col = isWasd ? (adsOn ? "#7ea8ff" : "#d4d8df") : `rgb(${26 + Math.round(Math.sin(tick + k.c * 0.25) * 10)}, ${29 + Math.round(Math.sin(tick) * 8)}, ${36})`;
        } else if (rgbMode === "fps_meter") {
          const lit = k.c < 17;
          col = lit ? (k.c < 10 ? "#58c98a" : k.c < 16 ? "#d4d8df" : "#e2b866") : "#1b1d24";
        } else if (rgbMode === "ping_radar") {
          const pulse = Math.abs(Math.sin(tick * 1.4 - k.c * 0.22));
          col = `rgb(${Math.round(35 + pulse * 60)}, ${Math.round(90 + pulse * 110)}, ${Math.round(70 + pulse * 65)})`;
        } else if (rgbMode === "cyber_wave") {
          const b = Math.round(50 + ((Math.sin(tick + k.c * 0.35 + k.r * 0.4) + 1) * 0.5) * 140);
          col = `rgb(${b}, ${b + 4}, ${b + 10})`;
        } else {
          const b = Math.round(35 + ((Math.sin(tick * 0.8) + 1) * 0.5) * 95);
          col = `rgb(${b}, ${b + 2}, ${b + 6})`;
        }
        k.el.style.backgroundColor = col;
      }
    }, 60);
  }

  // --- 4. Interactive 7-Gun Skin Swapper ---
  const weaponTabs = document.getElementById("weapon-tabs");
  const skinSelect = document.getElementById("skin-select");
  const skinWear = document.getElementById("skin-wear");
  const skinWearLbl = document.getElementById("skin-wear-lbl");
  const skinRouteBox = document.getElementById("skin-route-box");
  const WEAR_NAMES = ["0 (Factory New)", "1 (Minimal Wear)", "2 (Field-Tested)", "3 (Well-Worn)", "4 (Scarred)"];
  let activeWeapon = DATA.weapons[0] || { id: "ar", shortName: "AR", texture: "weapons/ar2/arcomp.webp", model: "weapons/ar2/ar2.glb" };

  function updateSkinRoute() {
    if (!skinRouteBox) return;
    const skId = skinSelect?.value || "cherry";
    const wear = Number(skinWear?.value || 0);
    if (skinWearLbl) skinWearLbl.textContent = WEAR_NAMES[wear] || String(wear);
    const dir = activeWeapon.texture.split("/")[1];
    skinRouteBox.innerHTML =
      `<div><strong>Intercept Match:</strong> https://deadshot.io/weapons/${dir}/${activeWeapon.texture.split("/")[2]}</div>` +
      `<div style="margin-top:4px; color:#58c98a"><strong>Dih Redirects To:</strong> deadshot.io/weapons/${dir}/skins/${skId}_${wear}.webp (Cached in RAM • 0ms stutter)</div>` +
      `<div style="margin-top:4px; color:#939aa8"><strong>3D Model Ready:</strong> ${activeWeapon.model} + Offline UV Paint Studio</div>`;
  }

  if (weaponTabs && DATA.weapons.length) {
    DATA.weapons.forEach((w, idx) => {
      const b = document.createElement("button");
      b.className = `btn small${idx === 0 ? " primary" : ""}`;
      b.textContent = w.shortName;
      b.addEventListener("click", () => {
        weaponTabs.querySelectorAll("button").forEach((x) => x.classList.remove("primary"));
        b.classList.add("primary");
        activeWeapon = w;
        updateSkinRoute();
      });
      weaponTabs.appendChild(b);
    });
  }
  if (skinSelect && DATA.officialSkins.length) {
    DATA.officialSkins.filter((s) => s.id !== "default").forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      skinSelect.appendChild(opt);
    });
    skinSelect.addEventListener("change", updateSkinRoute);
  }
  skinWear?.addEventListener("input", updateSkinRoute);
  updateSkinRoute();

  // --- 5. Interactive Features Explorer (All 196+) ---
  const catChipsEl = document.getElementById("cat-chips");
  const featGridEl = document.getElementById("features-grid");
  const featSearch = document.getElementById("feat-search");
  const featRestartOnly = document.getElementById("feat-restart-only");
  let activeFeatCat = "all";

  function renderFeatureCatalog() {
    if (!featGridEl) return;
    const q = (featSearch?.value || "").trim().toLowerCase();
    const restartOnly = Boolean(featRestartOnly?.checked);
    const list = DATA.features.filter((f) => {
      if (activeFeatCat !== "all" && f.category !== activeFeatCat) return false;
      if (restartOnly && !f.requiresRestart) return false;
      if (!q) return true;
      return f.title.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
    });
    featGridEl.innerHTML = "";
    for (const f of list) {
      const card = document.createElement("div");
      card.className = "feat-item";
      card.innerHTML =
        `<div><div class="feat-title">${f.title}</div><div class="feat-desc">${f.description}</div></div>` +
        `<div class="feat-meta mono"><span>${f.category.toUpperCase()}</span><span>${f.requiresRestart ? "BOOT FLAG" : "LIVE"}</span></div>`;
      featGridEl.appendChild(card);
    }
  }

  if (catChipsEl) {
    const allChip = document.createElement("button");
    allChip.className = "cat-chip active";
    allChip.textContent = `ALL (${DATA.featureCount})`;
    allChip.addEventListener("click", () => {
      activeFeatCat = "all";
      catChipsEl.querySelectorAll(".cat-chip").forEach((c) => c.classList.remove("active"));
      allChip.classList.add("active");
      renderFeatureCatalog();
    });
    catChipsEl.appendChild(allChip);

    DATA.categories.forEach((c) => {
      const count = DATA.features.filter((f) => f.category === c.id).length;
      const chip = document.createElement("button");
      chip.className = "cat-chip";
      chip.textContent = `${c.label.toUpperCase()} (${count})`;
      chip.addEventListener("click", () => {
        activeFeatCat = c.id;
        catChipsEl.querySelectorAll(".cat-chip").forEach((x) => x.classList.remove("active"));
        chip.classList.add("active");
        renderFeatureCatalog();
      });
      catChipsEl.appendChild(chip);
    });
  }
  featSearch?.addEventListener("input", renderFeatureCatalog);
  featRestartOnly?.addEventListener("change", renderFeatureCatalog);
  renderFeatureCatalog();

  // Copy Discord credit
  document.getElementById("copy-discord")?.addEventListener("click", async () => {
    const btn = document.getElementById("copy-discord");
    try {
      await navigator.clipboard.writeText("ewwhardik");
      btn.textContent = "Copied: ewwhardik";
      setTimeout(() => { btn.textContent = "Discord: ewwhardik (Copy)"; }, 1500);
    } catch {}
  });
})();
