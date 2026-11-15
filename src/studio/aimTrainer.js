/**
 * Per-Gun Calibrated Aim Trainer for Dih Client:
 * Uses actual Deadshot.io weapon fire rates (RPM / msPerShot), recoil curves,
 * bloom recovery, 8-pellet shotgun dispersion, AWP bolt-action quickscope,
 * DMR tap-cadence discipline & LMG spray transfer drills.
 */

export function initAimTrainer({ container, catalog, getSettings, api, onToast }) {
  const BALLISTICS = catalog?.WEAPON_BALLISTICS || {};
  const WEAPONS = catalog?.WEAPONS || {};
  const weaponIds = Object.keys(WEAPONS);

  const DRILL_LABELS = {
    recommended: "Recommended (Auto)",
    spray_transfer: "Spray Transfer",
    strafe_track: "Strafe Tracking",
    precision_flick: "Precision Flick",
    micro_flick: "Micro-Flick Cluster",
    tap_cadence: "Tap Cadence",
    burst_strafe: "Burst + Strafe",
    close_react: "Close-Quarters Snap",
    moving_snap: "Moving Target Snap",
  };

  let state = {
    weaponId: getSettings()?.aimTrainer?.selectedWeapon || "ar",
    drillId: getSettings()?.aimTrainer?.selectedDrill || "recommended",
    difficulty: getSettings()?.aimTrainer?.difficulty || "ranked",
    durationSec: Number(getSettings()?.aimTrainer?.durationSec) || 45,
    sensMult: 1.0,
    useClientXhair: getSettings()?.aimTrainer?.useClientCrosshair !== false,
    showRecoilGuide: getSettings()?.aimTrainer?.showRecoilGuide !== false,
    running: false,
    paused: true,
    timeLeft: 45,
    yaw: 0,
    pitch: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    bloomDeg: 0,
    shotIdx: 0,
    mag: 30,
    reloadingUntil: 0,
    lastShotAt: 0,
    mouseDown: false,
    adsDown: false,
    score: 0,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    streak: 0,
    bestStreak: 0,
    spawnTimeSumMs: 0,
    targets: [],
    tracers: [],
    floaters: [],
    impactDots: [],
    cadenceScore: 100,
    lastRafTs: 0,
  };

  let audioCtx = null;
  function playWeaponAudio(kind, weaponId) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      if (kind === "shoot") {
        const freqMap = { awp: 115, shotgun: 95, dmr: 180, lmg: 145, ar: 175, smg: 260, pistol: 230 };
        osc.type = weaponId === "awp" || weaponId === "shotgun" ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(freqMap[weaponId] || 180, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + (weaponId === "awp" ? 0.14 : 0.065));
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (weaponId === "awp" ? 0.15 : 0.07));
      } else if (kind === "head") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(1280, now);
        osc.frequency.exponentialRampToValueAtTime(1780, now + 0.06);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      } else if (kind === "hit") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(840, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      } else {
        osc.type = "square";
        osc.frequency.setValueAtTime(320, now);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      }
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {}
  }

  container.innerHTML = `
    <div class="trainer-shell">
      <aside class="trainer-side">
        <div class="group-label">1. Select Deadshot Weapon</div>
        <div class="trainer-weapon-list" id="trWeaponList"></div>

        <div class="group-label" style="margin-top:8px;">Weapon Ballistics Profile</div>
        <div class="trainer-spec-box mono" id="trSpecBox">--</div>

        <div class="group-label" style="margin-top:8px;">Recoil Spray Signature</div>
        <canvas id="trRecoilCanvas" width="228" height="100" class="trainer-recoil-plot"></canvas>

        <div class="group-label" style="margin-top:8px;">Drill &amp; Calibration</div>
        <select class="select" id="trDrillSelect"></select>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
          <select class="select" id="trDiffSelect">
            <option value="casual">Casual Size</option>
            <option value="ranked" selected>Ranked Size</option>
            <option value="pro">Esports Micro</option>
          </select>
          <select class="select" id="trDurSelect">
            <option value="30">30s</option>
            <option value="45" selected>45s</option>
            <option value="60">60s</option>
          </select>
        </div>
        <label class="slider-label" style="margin-top:8px;">
          <span>Trainer Sens <b class="mono" id="trLblSens">1.00x</b></span>
          <input type="range" id="trRngSens" min="25" max="250" value="100" />
        </label>
        <label class="check-inline" style="margin-top:6px;"><input type="checkbox" id="trChkXhair" checked /> Sync Client Crosshair</label>
        <label class="check-inline"><input type="checkbox" id="trChkGuide" checked /> Recoil / Cadence Aid</label>
        <button class="btn primary" id="trBtnStart" style="margin-top:8px;width:100%;">Lock Mouse &amp; Start Drill</button>
      </aside>

      <section class="trainer-stage-wrap">
        <div class="trainer-hud-bar mono">
          <span>WEAPON <b id="trHudGun">AR-15</b></span>
          <span>SCORE <b id="trHudScore">0</b></span>
          <span>ACC <b id="trHudAcc">0%</b></span>
          <span>HS <b id="trHudHs">0%</b></span>
          <span>AVG TTK <b id="trHudTtk">-- ms</b></span>
          <span>STREAK <b id="trHudStreak">0</b></span>
          <span>MAG <b id="trHudMag">30 / 30</b></span>
          <span>TIME <b id="trHudTime">45.0s</b></span>
        </div>
        <div class="trainer-canvas-box" id="trCanvasBox">
          <canvas id="trArenaCanvas" width="1280" height="760"></canvas>
          <div class="trainer-overlay-prompt" id="trPrompt">
            <div class="trainer-prompt-card">
              <div class="panel-title" id="trPromptTitle">Click Arena to Lock Pointer &amp; Train</div>
              <div class="panel-sub" id="trPromptSub">Calibrated to Deadshot fire rate, recoil curve &amp; pellet pattern. Hold Right-Click for ADS Zoom • Press R to Reload • ESC to pause.</div>
              <div class="mono trainer-best-line" id="trBestLine">Best Score: --</div>
              <button class="btn primary" id="trPromptBtn" style="margin-top:10px;">Start Session</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  const elWeaponList = container.querySelector("#trWeaponList");
  const elSpecBox = container.querySelector("#trSpecBox");
  const elDrillSelect = container.querySelector("#trDrillSelect");
  const elDiffSelect = container.querySelector("#trDiffSelect");
  const elDurSelect = container.querySelector("#trDurSelect");
  const elRngSens = container.querySelector("#trRngSens");
  const elLblSens = container.querySelector("#trLblSens");
  const elChkXhair = container.querySelector("#trChkXhair");
  const elChkGuide = container.querySelector("#trChkGuide");
  const elBtnStart = container.querySelector("#trBtnStart");
  const elPrompt = container.querySelector("#trPrompt");
  const elPromptBtn = container.querySelector("#trPromptBtn");
  const elPromptTitle = container.querySelector("#trPromptTitle");
  const elPromptSub = container.querySelector("#trPromptSub");
  const elBestLine = container.querySelector("#trBestLine");
  const recoilCanvas = container.querySelector("#trRecoilCanvas");
  const recoilCtx = recoilCanvas.getContext("2d");
  const canvas = container.querySelector("#trArenaCanvas");
  const ctx = canvas.getContext("2d");

  const hudGun = container.querySelector("#trHudGun");
  const hudScore = container.querySelector("#trHudScore");
  const hudAcc = container.querySelector("#trHudAcc");
  const hudHs = container.querySelector("#trHudHs");
  const hudTtk = container.querySelector("#trHudTtk");
  const hudStreak = container.querySelector("#trHudStreak");
  const hudMag = container.querySelector("#trHudMag");
  const hudTime = container.querySelector("#trHudTime");

  function getGun() {
    return BALLISTICS[state.weaponId] || BALLISTICS.ar || {
      id: "ar",
      name: "AR-15",
      rpm: 650,
      msPerShot: 92,
      magSize: 30,
      reloadMs: 1850,
      pellets: 1,
      baseSpreadDeg: 0.45,
      bloomPerShot: 0.34,
      bloomMaxDeg: 4.2,
      bloomResetMs: 260,
      recoilY: 1.55,
      recoilXPattern: [0, 0.12, -0.18, 0.25, -0.32],
      adsFovMult: 0.82,
      damageBody: 25,
      damageHead: 38,
      idealRange: "15m - 45m",
      usecase: "Controlled bursts & spray transfer",
      recommendedDrills: ["spray_transfer"],
      fireMode: "auto",
    };
  }

  function activeDrillMode() {
    const gun = getGun();
    if (state.drillId === "recommended") {
      return (gun.recommendedDrills && gun.recommendedDrills[0]) || "spray_transfer";
    }
    return state.drillId;
  }

  function renderWeaponChips() {
    elWeaponList.innerHTML = "";
    weaponIds.forEach((id) => {
      const w = WEAPONS[id];
      const b = BALLISTICS[id] || {};
      const btn = document.createElement("button");
      btn.className = "trainer-gun-btn" + (id === state.weaponId ? " active" : "");
      btn.innerHTML = `<span>${w?.shortName || id.toUpperCase()}</span><small class="mono">${b.rpm || 600} RPM</small>`;
      btn.onclick = () => selectWeapon(id);
      elWeaponList.appendChild(btn);
    });
  }

  function drawRecoilPreview() {
    const gun = getGun();
    const W = recoilCanvas.width;
    const H = recoilCanvas.height;
    recoilCtx.clearRect(0, 0, W, H);
    recoilCtx.fillStyle = "#0b0c10";
    recoilCtx.fillRect(0, 0, W, H);
    recoilCtx.strokeStyle = "rgba(255,255,255,0.06)";
    recoilCtx.beginPath();
    recoilCtx.moveTo(W / 2, 0);
    recoilCtx.lineTo(W / 2, H);
    recoilCtx.stroke();

    const pat = gun.recoilXPattern || [0];
    const dots = Math.min(18, gun.magSize || 12);
    let x = W / 2;
    let y = H - 14;
    for (let i = 0; i < dots; i++) {
      const dx = (pat[i % pat.length] || 0) * 18;
      const dy = (gun.recoilY || 1.2) * (gun.fireMode === "bolt" ? 12 : 4.2);
      if (i > 0) {
        x += dx;
        y -= dy;
      }
      recoilCtx.fillStyle = i === 0 ? "#58c98a" : `rgba(212,216,223,${Math.max(0.3, 1 - i / dots)})`;
      recoilCtx.beginPath();
      recoilCtx.arc(Math.max(10, Math.min(W - 10, x)), Math.max(8, y), i === 0 ? 3.5 : 2.3, 0, Math.PI * 2);
      recoilCtx.fill();
    }
    recoilCtx.fillStyle = "#8f96a3";
    recoilCtx.font = "10px Consolas, monospace";
    recoilCtx.fillText(`${gun.fireMode.toUpperCase()} • ${gun.rpm} RPM`, 8, 14);
  }

  function syncUiForWeapon() {
    const gun = getGun();
    renderWeaponChips();
    drawRecoilPreview();
    elSpecBox.innerHTML =
      `<div><b>Rate:</b> ${gun.rpm} RPM (${gun.msPerShot}ms)</div>` +
      `<div><b>Mag:</b> ${gun.magSize} • <b>Reload:</b> ${(gun.reloadMs / 1000).toFixed(2)}s</div>` +
      `<div><b>Spread:</b> ${gun.baseSpreadDeg}°${gun.pellets > 1 ? ` • ${gun.pellets} pellets` : ""}</div>` +
      `<div><b>Range:</b> ${gun.idealRange}</div>` +
      `<div style="color:#b7bfcc;margin-top:3px;">${gun.usecase}</div>`;

    elDrillSelect.innerHTML = "";
    const rec = gun.recommendedDrills?.[0] || "spray_transfer";
    Object.entries(DRILL_LABELS).forEach(([k, label]) => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k === "recommended" ? `Recommended (${DRILL_LABELS[rec] || rec})` : label;
      if (k === state.drillId) opt.selected = true;
      elDrillSelect.appendChild(opt);
    });

    const best = getSettings()?.aimTrainer?.bestScores?.[state.weaponId];
    elBestLine.textContent = best
      ? `Personal Best (${gun.name}): ${best.score} pts • ${best.acc}% Acc • ${best.hs}% HS`
      : `Personal Best (${gun.name}): No runs logged yet`;
    hudGun.textContent = gun.name;
    hudMag.textContent = `${state.mag} / ${gun.magSize}`;
  }

  function selectWeapon(id) {
    if (!WEAPONS[id]) return;
    state.weaponId = id;
    const gun = getGun();
    state.mag = gun.magSize;
    state.reloadingUntil = 0;
    state.bloomDeg = 0;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
    state.shotIdx = 0;
    if (state.running) spawnInitialTargets();
    syncUiForWeapon();
    api?.setSetting?.("aimTrainer.selectedWeapon", id).catch?.(() => {});
  }

  function spawnTarget(clusterCenter = null) {
    const mode = activeDrillMode();
    const diffScale = state.difficulty === "casual" ? 1.32 : state.difficulty === "pro" ? 0.72 : 1.0;
    const baseRadius = (mode === "micro_flick" ? 0.62 : mode === "close_react" ? 1.1 : 0.86) * diffScale;

    let yawSpread = 0.55;
    let pitchSpread = 0.24;
    let dist = 16;
    if (mode === "close_react" || state.weaponId === "shotgun") {
      dist = 9 + Math.random() * 5;
      yawSpread = 0.68;
    } else if (mode === "precision_flick" || state.weaponId === "awp") {
      dist = 20 + Math.random() * 14;
      yawSpread = 0.62;
    } else if (mode === "micro_flick") {
      yawSpread = 0.22;
      pitchSpread = 0.14;
      dist = 18;
    }

    let tyaw = clusterCenter ? clusterCenter.yaw + (Math.random() - 0.5) * 0.18 : (Math.random() - 0.5) * 2 * yawSpread;
    let tpitch = clusterCenter ? clusterCenter.pitch + (Math.random() - 0.5) * 0.1 : (Math.random() - 0.35) * 1.4 * pitchSpread;
    tpitch = Math.max(-0.32, Math.min(0.32, tpitch));

    const gun = getGun();
    const hp =
      mode === "spray_transfer" && (state.weaponId === "ar" || state.weaponId === "smg" || state.weaponId === "lmg")
        ? 75
        : mode === "strafe_track"
          ? 120
          : state.weaponId === "awp" || state.weaponId === "shotgun"
            ? 80
            : 50;

    const moving = mode === "strafe_track" || mode === "moving_snap" || state.weaponId === "smg";
    return {
      yaw: tyaw,
      pitch: tpitch,
      dist,
      radius: baseRadius,
      hp,
      maxHp: hp,
      vx: moving ? (Math.random() > 0.5 ? 1 : -1) * (mode === "strafe_track" ? 0.28 : 0.16) : 0,
      vy: 0,
      spawnedAt: performance.now(),
      flashUntil: 0,
    };
  }

  function spawnInitialTargets() {
    state.targets = [];
    const mode = activeDrillMode();
    const count = mode === "strafe_track" ? 2 : mode === "spray_transfer" ? 4 : 3;
    const center = mode === "spray_transfer" ? { yaw: (Math.random() - 0.5) * 0.3, pitch: 0 } : null;
    for (let i = 0; i < count; i++) {
      state.targets.push(spawnTarget(center));
    }
  }

  function resetRun() {
    const gun = getGun();
    state.durationSec = Number(elDurSelect.value) || 45;
    state.timeLeft = state.durationSec;
    state.difficulty = elDiffSelect.value || "ranked";
    state.drillId = elDrillSelect.value || "recommended";
    state.yaw = 0;
    state.pitch = 0;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
    state.bloomDeg = 0;
    state.shotIdx = 0;
    state.mag = gun.magSize;
    state.reloadingUntil = 0;
    state.score = 0;
    state.kills = 0;
    state.shotsFired = 0;
    state.shotsHit = 0;
    state.headshots = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.spawnTimeSumMs = 0;
    state.tracers = [];
    state.floaters = [];
    state.impactDots = [];
    state.cadenceScore = 100;
    state.running = true;
    state.paused = false;
    spawnInitialTargets();
    syncUiForWeapon();
  }

  function startReload() {
    const gun = getGun();
    const now = performance.now();
    if (state.reloadingUntil > now || state.mag >= gun.magSize) return;
    state.reloadingUntil = now + gun.reloadMs;
    playWeaponAudio("reload", state.weaponId);
  }

  function currentFovDeg() {
    const gun = getGun();
    const base = 74;
    return state.adsDown ? base * (gun.adsFovMult || 0.82) : base;
  }

  function projectToScreen(tyaw, tpitch, dist) {
    const W = canvas.width;
    const H = canvas.height;
    const fovRad = (currentFovDeg() * Math.PI) / 180;
    const focal = (H / 2) / Math.tan(fovRad / 2);
    const viewYaw = state.yaw + state.recoilYaw;
    const viewPitch = state.pitch + state.recoilPitch;
    const dy = tyaw - viewYaw;
    const dp = tpitch - viewPitch;
    const sx = W / 2 + Math.tan(dy) * focal;
    const sy = H / 2 - Math.tan(dp) * focal;
    const pxRadius = (focal / Math.max(4, dist)) * 1.05;
    return { sx, sy, pxRadius };
  }

  function fireShot(now) {
    const gun = getGun();
    if (!state.running || state.paused) return;
    if (state.reloadingUntil > now) return;
    if (state.mag <= 0) {
      startReload();
      return;
    }
    if (now - state.lastShotAt < gun.msPerShot) return;

    // Evaluate DMR / Pistol tap cadence discipline
    if (gun.fireMode === "semi") {
      const gap = now - state.lastShotAt;
      if (gap < gun.bloomResetMs && state.shotsFired > 0) {
        state.cadenceScore = Math.max(30, state.cadenceScore - 8);
      } else {
        state.cadenceScore = Math.min(100, state.cadenceScore + 4);
      }
    }

    state.lastShotAt = now;
    state.mag -= 1;
    state.shotsFired += 1;
    playWeaponAudio("shoot", state.weaponId);

    const W = canvas.width;
    const H = canvas.height;
    const fovRad = (currentFovDeg() * Math.PI) / 180;
    const focal = (H / 2) / Math.tan(fovRad / 2);

    const pellets = Math.max(1, gun.pellets || 1);
    const totalSpreadDeg = gun.baseSpreadDeg + state.bloomDeg;
    const coneDeg = pellets > 1 ? gun.pelletConeDeg || 3.2 : totalSpreadDeg;

    let anyHit = false;
    let anyHead = false;
    let totalDmg = 0;

    for (let p = 0; p < pellets; p++) {
      const ang = Math.random() * Math.PI * 2;
      const mag = (pellets > 1 ? Math.sqrt(Math.random()) : Math.random()) * ((coneDeg * Math.PI) / 180);
      const rayYaw = state.yaw + state.recoilYaw + Math.cos(ang) * mag;
      const rayPitch = state.pitch + state.recoilPitch + Math.sin(ang) * mag;

      const impX = W / 2 + Math.tan(rayYaw - (state.yaw + state.recoilYaw)) * focal;
      const impY = H / 2 - Math.tan(rayPitch - (state.pitch + state.recoilPitch)) * focal;

      let bestHitIdx = -1;
      let bestDist = Infinity;
      let isHead = false;

      state.targets.forEach((t, idx) => {
        const proj = projectToScreen(t.yaw, t.pitch, t.dist);
        const bodyR = proj.pxRadius * t.radius;
        const headX = proj.sx;
        const headY = proj.sy - bodyR * 0.72;
        const headR = bodyR * 0.36;

        const dHead = Math.hypot(impX - headX, impY - headY);
        const dBody = Math.hypot(impX - proj.sx, impY - proj.sy);
        if (dHead <= headR && t.dist < bestDist) {
          bestHitIdx = idx;
          bestDist = t.dist;
          isHead = true;
        } else if (dBody <= bodyR && t.dist < bestDist) {
          bestHitIdx = idx;
          bestDist = t.dist;
          isHead = false;
        }
      });

      state.tracers.push({ x1: W * 0.56, y1: H * 0.86, x2: impX, y2: impY, until: now + 90, hit: bestHitIdx >= 0 });

      if (bestHitIdx >= 0) {
        anyHit = true;
        if (isHead) anyHead = true;
        const tgt = state.targets[bestHitIdx];
        const dmg = isHead ? gun.damageHead : gun.damageBody;
        totalDmg += dmg;
        tgt.hp -= dmg;
        tgt.flashUntil = now + 90;
        if (tgt.hp <= 0) {
          const ttk = Math.max(40, Math.round(now - tgt.spawnedAt));
          state.kills += 1;
          state.streak += 1;
          state.bestStreak = Math.max(state.bestStreak, state.streak);
          state.spawnTimeSumMs += ttk;
          state.score += Math.round((isHead ? 150 : 100) + Math.max(0, 600 - ttk) * 0.12 + state.streak * 6);
          state.targets.splice(bestHitIdx, 1);
          const cluster = activeDrillMode() === "spray_transfer" && state.targets[0]
            ? { yaw: state.targets[0].yaw, pitch: state.targets[0].pitch }
            : null;
          state.targets.push(spawnTarget(cluster));
        }
      } else {
        state.impactDots.push({ x: impX, y: impY, until: now + 450 });
      }
    }

    if (anyHit) {
      state.shotsHit += 1;
      if (anyHead) state.headshots += 1;
      playWeaponAudio(anyHead ? "head" : "hit", state.weaponId);
      state.floaters.push({
        x: W / 2 + (Math.random() - 0.5) * 34,
        y: H / 2 - 28,
        text: anyHead ? `${totalDmg} CRIT` : `${totalDmg}`,
        crit: anyHead,
        until: now + 460,
      });
    } else if (gun.fireMode === "bolt") {
      state.streak = 0;
    }

    // Apply authentic Deadshot weapon recoil kick + bloom
    const pat = gun.recoilXPattern || [0];
    const patX = pat[state.shotIdx % pat.length] || 0;
    const kickScale = state.adsDown ? 0.0085 : 0.011;
    state.recoilPitch = Math.min(0.24, state.recoilPitch + gun.recoilY * kickScale);
    state.recoilYaw += patX * kickScale * 0.9;
    state.bloomDeg = Math.min(gun.bloomMaxDeg, state.bloomDeg + gun.bloomPerShot);
    state.shotIdx += 1;

    if (state.mag <= 0) {
      startReload();
    }
  }

  function finishSession() {
    state.running = false;
    state.paused = true;
    state.mouseDown = false;
    if (document.pointerLockElement === canvas) {
      try { document.exitPointerLock(); } catch {}
    }
    const acc = state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
    const hs = state.shotsHit ? Math.round((state.headshots / state.shotsHit) * 100) : 0;
    const avgTtk = state.kills ? Math.round(state.spawnTimeSumMs / state.kills) : 0;

    const existing = getSettings()?.aimTrainer?.bestScores?.[state.weaponId];
    if (!existing || state.score > existing.score) {
      const record = { score: state.score, acc, hs, kills: state.kills, avgTtk, at: new Date().toISOString() };
      api?.setSetting?.(`aimTrainer.bestScores.${state.weaponId}`, record).catch?.(() => {});
      onToast?.(`New ${getGun().name} PB: ${state.score} pts (${acc}% Acc)`);
    }

    elPromptTitle.textContent = `${getGun().name} Run Complete — ${state.score} pts`;
    elPromptSub.textContent = `Kills: ${state.kills} • Accuracy: ${acc}% • Headshots: ${hs}% • Avg Kill: ${avgTtk || "--"}ms • Max Streak: ${state.bestStreak}`;
    elPromptBtn.textContent = "Run Again";
    elPrompt.style.display = "flex";
    syncUiForWeapon();
  }

  function drawTrainerCrosshair(W, H) {
    const cx = W / 2;
    const cy = H / 2;
    const gun = getGun();
    const xCfg = getSettings()?.crosshair || {};
    const bloomPx = state.bloomDeg * 9;

    if (state.weaponId === "awp" && state.adsDown) {
      ctx.strokeStyle = "rgba(0,0,0,0.88)";
      ctx.lineWidth = Math.max(W, H) * 0.25;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(W, H) * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
      ctx.stroke();
    }

    const col = state.useClientXhair ? xCfg.color || "#f2f4f7" : "#6ee7b7";
    const gap = (state.useClientXhair ? Number(xCfg.gap) || 4 : 5) + bloomPx;
    const len = state.useClientXhair ? Number(xCfg.size) || 9 : 8;
    const thick = state.useClientXhair ? Number(xCfg.thickness) || 2 : 2;

    if (state.useClientXhair && xCfg.type === "Dot") {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, Number(xCfg.dotSize) || 3), 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.lineWidth = thick;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
    ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
    ctx.stroke();

    if (!state.useClientXhair || xCfg.type === "CrossDot" || xCfg.type === "CircleDot") {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    if (gun.pellets > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 24 + bloomPx * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function stepAndRender(now) {
    const dt = state.lastRafTs ? Math.min(0.05, (now - state.lastRafTs) / 1000) : 0.016;
    state.lastRafTs = now;
    const gun = getGun();

    if (state.running && !state.paused) {
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      if (state.timeLeft <= 0) {
        finishSession();
      } else {
        if (state.mouseDown && (gun.fireMode === "auto" || gun.fireMode === "pump")) {
          fireShot(now);
        }
        if (state.reloadingUntil > 0 && now >= state.reloadingUntil) {
          state.reloadingUntil = 0;
          state.mag = gun.magSize;
        }
        // Recoil & bloom recovery proportional to weapon reset time
        const decay = Math.exp(-dt * (1200 / Math.max(180, gun.bloomResetMs || 260)));
        if (!state.mouseDown || now - state.lastShotAt > gun.msPerShot * 1.25) {
          state.recoilPitch *= decay;
          state.recoilYaw *= decay;
          state.bloomDeg *= decay;
        }
        // Move targets cleanly inside arena cone
        state.targets.forEach((t) => {
          if (t.vx !== 0) {
            t.yaw += t.vx * dt;
            if (Math.abs(t.yaw) > 0.62) t.vx *= -1;
          }
        });
      }
    }

    const W = canvas.width;
    const H = canvas.height;
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#101319");
    bgGrad.addColorStop(0.55, "#151922");
    bgGrad.addColorStop(1, "#0d0f13");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle spatial horizon & grid cues reacting to yaw/pitch
    const horizonProj = projectToScreen(0, 0, 50);
    const horY = Math.max(80, Math.min(H - 80, horizonProj.sy));
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horY); ctx.lineTo(W, horY);
    ctx.stroke();
    for (let deg = -0.8; deg <= 0.8; deg += 0.2) {
      const gx = projectToScreen(deg, 0, 30).sx;
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.beginPath();
      ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
      ctx.stroke();
    }

    // Draw targets back-to-front
    const ordered = [...state.targets].sort((a, b) => b.dist - a.dist);
    ordered.forEach((t) => {
      const p = projectToScreen(t.yaw, t.pitch, t.dist);
      const r = p.pxRadius * t.radius;
      const flashing = t.flashUntil > now;

      // Body sphere
      const grad = ctx.createRadialGradient(p.sx - r * 0.25, p.sy - r * 0.25, r * 0.1, p.sx, p.sy, r);
      grad.addColorStop(0, flashing ? "#ffffff" : "#89b4ff");
      grad.addColorStop(1, flashing ? "#cbd5e1" : "#2e5494");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fill();

      // Head hitbox sphere
      const headY = p.sy - r * 0.72;
      const headR = r * 0.36;
      ctx.fillStyle = flashing ? "#fde047" : "#f59e0b";
      ctx.beginPath();
      ctx.arc(p.sx, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (t.hp < t.maxHp) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(p.sx - 20, headY - headR - 12, 40, 4);
        ctx.fillStyle = "#58c98a";
        ctx.fillRect(p.sx - 20, headY - headR - 12, 40 * Math.max(0, t.hp / t.maxHp), 4);
      }
    });

    // Draw tracers & wall impacts
    state.tracers = state.tracers.filter((tr) => tr.until > now);
    state.tracers.forEach((tr) => {
      ctx.strokeStyle = tr.hit ? "rgba(253,224,71,0.75)" : "rgba(203,213,225,0.28)";
      ctx.lineWidth = tr.hit ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();
    });
    state.impactDots = state.impactDots.filter((d) => d.until > now);
    state.impactDots.forEach((d) => {
      ctx.fillStyle = "rgba(148,163,184,0.6)";
      ctx.beginPath();
      ctx.arc(d.x, d.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    state.floaters = state.floaters.filter((f) => f.until > now);
    state.floaters.forEach((f) => {
      const age = 1 - (f.until - now) / 460;
      ctx.fillStyle = f.crit ? "#fde047" : "#f2f4f7";
      ctx.font = "700 13px Consolas, monospace";
      ctx.fillText(f.text, f.x - 14, f.y - age * 24);
    });

    // Gun cadence / bolt / reload helper indicator
    if (state.showRecoilGuide && state.running) {
      if (state.reloadingUntil > now) {
        const pct = 1 - (state.reloadingUntil - now) / gun.reloadMs;
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(W / 2 - 60, H / 2 + 46, 120, 5);
        ctx.fillStyle = "#e2b866";
        ctx.fillRect(W / 2 - 60, H / 2 + 46, 120 * Math.min(1, Math.max(0, pct)), 5);
      } else if (gun.fireMode === "bolt" && now - state.lastShotAt < gun.msPerShot) {
        const pct = (now - state.lastShotAt) / gun.msPerShot;
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(W / 2 - 44, H / 2 + 42, 88, 3);
        ctx.fillStyle = "#7ea8ff";
        ctx.fillRect(W / 2 - 44, H / 2 + 42, 88 * pct, 3);
      }
    }

    drawTrainerCrosshair(W, H);

    // Update top HUD values cleanly
    const acc = state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
    const hs = state.shotsHit ? Math.round((state.headshots / state.shotsHit) * 100) : 0;
    const avgTtk = state.kills ? Math.round(state.spawnTimeSumMs / state.kills) : null;
    hudScore.textContent = String(state.score);
    hudAcc.textContent = `${acc}%`;
    hudHs.textContent = `${hs}%`;
    hudTtk.textContent = avgTtk ? `${avgTtk} ms` : "-- ms";
    hudStreak.textContent = String(state.streak);
    hudMag.textContent = state.reloadingUntil > now ? "RELOADING" : `${state.mag} / ${gun.magSize}`;
    hudTime.textContent = `${state.timeLeft.toFixed(1)}s`;

    requestAnimationFrame(stepAndRender);
  }

  function engageLockAndPlay() {
    if (!state.running || state.timeLeft <= 0) {
      resetRun();
    } else {
      state.paused = false;
    }
    elPrompt.style.display = "none";
    try {
      canvas.requestPointerLock();
    } catch {}
  }

  elBtnStart.onclick = engageLockAndPlay;
  elPromptBtn.onclick = engageLockAndPlay;
  canvas.addEventListener("click", () => {
    if (document.pointerLockElement !== canvas) engageLockAndPlay();
  });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && state.running) {
      state.paused = true;
      state.mouseDown = false;
      state.adsDown = false;
      elPromptTitle.textContent = "Session Paused";
      elPromptSub.textContent = `Current Score: ${state.score} • Click Resume to lock mouse back into arena.`;
      elPromptBtn.textContent = "Resume Drill";
      elPrompt.style.display = "flex";
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas || !state.running || state.paused) return;
    const adsDamp = state.adsDown ? (getGun().adsFovMult || 0.82) : 1.0;
    const radPerPx = 0.0018 * state.sensMult * adsDamp;
    state.yaw = Math.max(-1.05, Math.min(1.05, state.yaw + e.movementX * radPerPx));
    state.pitch = Math.max(-0.55, Math.min(0.55, state.pitch - e.movementY * radPerPx));
  });

  canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) {
      state.mouseDown = true;
      fireShot(performance.now());
    } else if (e.button === 2) {
      state.adsDown = true;
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) state.mouseDown = false;
    if (e.button === 2) state.adsDown = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyR" && document.pointerLockElement === canvas) {
      startReload();
    }
  });

  elDrillSelect.onchange = () => {
    state.drillId = elDrillSelect.value;
    if (state.running) spawnInitialTargets();
    api?.setSetting?.("aimTrainer.selectedDrill", state.drillId).catch?.(() => {});
  };
  elDiffSelect.onchange = () => {
    state.difficulty = elDiffSelect.value;
    api?.setSetting?.("aimTrainer.difficulty", state.difficulty).catch?.(() => {});
  };
  elDurSelect.onchange = () => {
    state.durationSec = Number(elDurSelect.value) || 45;
    state.timeLeft = state.durationSec;
  };
  elRngSens.oninput = () => {
    state.sensMult = Number(elRngSens.value) / 100;
    elLblSens.textContent = `${state.sensMult.toFixed(2)}x`;
  };
  elChkXhair.onchange = () => {
    state.useClientXhair = elChkXhair.checked;
  };
  elChkGuide.onchange = () => {
    state.showRecoilGuide = elChkGuide.checked;
  };

  syncUiForWeapon();
  requestAnimationFrame(stepAndRender);

  return {
    selectWeapon,
    syncSettings() {
      syncUiForWeapon();
    },
  };
}
