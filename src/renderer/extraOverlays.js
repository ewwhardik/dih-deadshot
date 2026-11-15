/**
 * Secondary HUD Widgets:
 * Watermark, Session K/D/A + KPM + Streak Tracker, Stopwatch,
 * Warmup Countdown Timer, Millisecond Reaction Trainer, Companion GIF/PNG Badge & Hotkey Strip.
 */

DIH_NS.createExtraOverlays = function createExtraOverlays(shadowRoot, getSettings, savedPositions) {
  const { el, makeDraggable, playTone } = DIH_NS.utils;

  // 1. Top-Right Watermark
  const watermark = el("div", { className: "dih-watermark" }, "DIH CLIENT");
  shadowRoot.appendChild(watermark);

  // 2. Session K / D / A + KPM + Streak Tracker
  const kdRoot = el("div", { className: "dih-card dih-mini-widget" });
  kdRoot.style.right = "16px";
  kdRoot.style.top = "38px";
  const kdRatioBadge = el("span", { className: "dih-mono" }, "0.00 KD");
  const kdTitle = el("div", { className: "dih-widget-label" }, [
    el("span", {}, "SESSION K/D"),
    kdRatioBadge,
  ]);
  const killsNum = el("span", { className: "dih-kd-num dih-mono" }, "0");
  const deathsNum = el("span", { className: "dih-kd-num dih-mono" }, "0");
  const assistsNum = el("span", { className: "dih-kd-num dih-mono" }, "0");
  const kdGrid = el("div", { className: "dih-kd-grid" }, [
    el("div", { className: "dih-kd-cell" }, [el("span", { className: "dih-tel-k" }, "K"), killsNum]),
    el("div", { className: "dih-kd-cell" }, [el("span", { className: "dih-tel-k" }, "D"), deathsNum]),
    el("div", { className: "dih-kd-cell" }, [el("span", { className: "dih-tel-k" }, "A"), assistsNum]),
  ]);
  const kdSubLine = el("div", { className: "dih-mono", style: { fontSize: "10px", color: "var(--dih-muted)", marginTop: "4px" } }, "KPM 0.0 • STREAK 0 (MAX 0)");

  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let curStreak = 0;
  let bestStreak = 0;
  const sessionStartMs = Date.now();

  function updateKd() {
    killsNum.textContent = String(kills);
    deathsNum.textContent = String(deaths);
    assistsNum.textContent = String(assists);
    const ratio = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    kdRatioBadge.textContent = `${ratio} KD`;
    const mins = Math.max(0.25, (Date.now() - sessionStartMs) / 60000);
    const kpm = (kills / mins).toFixed(1);
    kdSubLine.textContent = `KPM ${kpm} • STK ${curStreak} (MAX ${bestStreak})`;
  }

  const kdBtns = el("div", { className: "dih-mini-btns" }, [
    el("button", {
      className: "dih-mini-btn",
      onClick: () => {
        kills++;
        curStreak++;
        if (curStreak > bestStreak) bestStreak = curStreak;
        updateKd();
        const s = getSettings();
        if (s.audio?.playClientKillTone) playTone("kill", s.audio.clientFeedbackVolume);
      },
    }, "+K"),
    el("button", {
      className: "dih-mini-btn",
      onClick: () => {
        deaths++;
        curStreak = 0;
        updateKd();
      },
    }, "+D"),
    el("button", { className: "dih-mini-btn", onClick: () => { assists++; updateKd(); } }, "+A"),
    el("button", {
      className: "dih-mini-btn",
      onClick: () => {
        kills = 0;
        deaths = 0;
        assists = 0;
        curStreak = 0;
        bestStreak = 0;
        updateKd();
      },
    }, "RST"),
  ]);
  kdRoot.append(kdTitle, kdGrid, kdSubLine, kdBtns);
  shadowRoot.appendChild(kdRoot);
  makeDraggable(kdRoot, "kdTracker", getSettings, savedPositions);

  // 3. Precision Stopwatch
  const swRoot = el("div", { className: "dih-card dih-mini-widget" });
  swRoot.style.right = "16px";
  swRoot.style.top = "162px";
  const swTimeEl = el("div", { className: "dih-mono", style: { fontSize: "19px", fontWeight: "700" } }, "00:00.00");
  let swRunning = false;
  let swAccumMs = 0;
  let swLastStart = 0;
  const swToggleBtn = el("button", { className: "dih-mini-btn", onClick: toggleStopwatch }, "START");
  const swResetBtn = el("button", { className: "dih-mini-btn", onClick: resetStopwatch }, "RESET");
  swRoot.append(
    el("div", { className: "dih-widget-label" }, [el("span", {}, "STOPWATCH"), el("span", {}, "[B]")]),
    swTimeEl,
    el("div", { className: "dih-mini-btns" }, [swToggleBtn, swResetBtn])
  );
  shadowRoot.appendChild(swRoot);
  makeDraggable(swRoot, "stopwatch", getSettings, savedPositions);

  function toggleStopwatch() {
    if (swRunning) {
      swAccumMs += performance.now() - swLastStart;
      swRunning = false;
      swToggleBtn.textContent = "START";
    } else {
      swLastStart = performance.now();
      swRunning = true;
      swToggleBtn.textContent = "PAUSE";
    }
  }

  function resetStopwatch() {
    swRunning = false;
    swAccumMs = 0;
    swTimeEl.textContent = "00:00.00";
    swToggleBtn.textContent = "START";
  }

  // 4. Warmup Goal Countdown Timer
  const wuRoot = el("div", { className: "dih-card dih-mini-widget" });
  wuRoot.style.right = "16px";
  wuRoot.style.top = "260px";
  const wuDisplay = el("div", { className: "dih-mono", style: { fontSize: "19px", fontWeight: "700" } }, "03:00");
  let wuRemainingSec = 180;
  let wuRunning = false;

  const formatSec = (sec) => {
    const s = Math.max(0, Math.round(sec));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const wuStartBtn = el("button", {
    className: "dih-mini-btn",
    onClick: () => {
      wuRunning = !wuRunning;
      wuStartBtn.textContent = wuRunning ? "PAUSE" : "GO";
    },
  }, "GO");
  const wuResetBtn = el("button", {
    className: "dih-mini-btn",
    onClick: () => {
      wuRunning = false;
      wuRemainingSec = Number(getSettings().hud?.warmupDurationSec) || 180;
      wuDisplay.textContent = formatSec(wuRemainingSec);
      wuStartBtn.textContent = "GO";
    },
  }, "RST");
  wuRoot.append(
    el("div", { className: "dih-widget-label" }, [el("span", {}, "WARMUP GOAL"), el("span", {}, "TIMER")]),
    wuDisplay,
    el("div", { className: "dih-mini-btns" }, [wuStartBtn, wuResetBtn])
  );
  shadowRoot.appendChild(wuRoot);
  makeDraggable(wuRoot, "warmupTimer", getSettings, savedPositions);

  // 5. Millisecond Reaction Trainer
  const rxRoot = el("div", { className: "dih-card dih-mini-widget" });
  rxRoot.style.right = "16px";
  rxRoot.style.top = "356px";
  rxRoot.style.minWidth = "172px";
  const rxAvgEl = el("span", { className: "dih-mono" }, "AVG --ms");
  const rxPad = el("div", { className: "dih-reaction-pad dih-mono" }, "CLICK TO TEST");
  rxRoot.append(el("div", { className: "dih-widget-label" }, [el("span", {}, "REACTION"), rxAvgEl]), rxPad);
  shadowRoot.appendChild(rxRoot);
  makeDraggable(rxRoot, "reaction", getSettings, savedPositions);

  let rxState = "idle";
  let rxTimer = null;
  let rxReadyAt = 0;
  const rxHistory = [];

  rxPad.addEventListener("click", () => {
    if (rxState === "idle") {
      rxState = "waiting";
      rxPad.className = "dih-reaction-pad dih-mono waiting";
      rxPad.textContent = "WAIT...";
      rxTimer = setTimeout(() => {
        rxState = "ready";
        rxReadyAt = performance.now();
        rxPad.className = "dih-reaction-pad dih-mono ready";
        rxPad.textContent = "CLICK NOW";
      }, 1100 + Math.random() * 2200);
    } else if (rxState === "waiting") {
      clearTimeout(rxTimer);
      rxState = "idle";
      rxPad.className = "dih-reaction-pad dih-mono";
      rxPad.textContent = "TOO EARLY";
    } else if (rxState === "ready") {
      const ms = Math.round(performance.now() - rxReadyAt);
      rxState = "idle";
      rxPad.className = "dih-reaction-pad dih-mono";
      rxPad.textContent = `${ms} ms`;
      rxHistory.push(ms);
      if (rxHistory.length > 5) rxHistory.shift();
      const mean = Math.round(rxHistory.reduce((a, b) => a + b, 0) / rxHistory.length);
      rxAvgEl.textContent = `AVG ${mean}ms`;
    }
  });

  // 6. Companion GIF / PNG Badge
  const gifRoot = el("div", { className: "dih-card", style: { padding: "6px", right: "18px", bottom: "48px" } });
  const gifImg = el("img", { style: { display: "block", borderRadius: "6px", maxWidth: "160px", maxHeight: "160px", objectFit: "contain" } });
  gifRoot.appendChild(gifImg);
  shadowRoot.appendChild(gifRoot);
  makeDraggable(gifRoot, "companionGif", getSettings, savedPositions);

  // 7. Compact Bottom Keybind Guide Hint
  const keyHintBar = el("div", { className: "dih-card dih-keyhint-bar dih-mono" }, "RShift Menu • F1-F4 Toggle HUD • F6 Min/Full • F7 Studio • Ins Aim • F9 Hide All");
  shadowRoot.appendChild(keyHintBar);

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      const s = getSettings();
      const swKey = s.hotkeys?.stopwatchToggle || "KeyB";
      const swMatch = e.code === swKey || e.key.toLowerCase() === swKey.replace(/^Key/i, "").toLowerCase();
      if (swMatch && s.hud?.stopwatchEnabled) {
        toggleStopwatch();
      } else if (e.key === "]" && s.hud?.kdTrackerEnabled) {
        kills++;
        curStreak++;
        if (curStreak > bestStreak) bestStreak = curStreak;
        updateKd();
        if (s.audio?.playClientKillTone) playTone("kill", s.audio.clientFeedbackVolume);
      } else if (e.key === "[" && s.hud?.kdTrackerEnabled) {
        deaths++;
        curStreak = 0;
        updateKd();
      } else if (e.key === "\\" && s.hud?.kdTrackerEnabled) {
        assists++;
        updateKd();
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0 || !document.pointerLockElement) return;
      const s = getSettings();
      if (!s.audio?.masterMuted) {
        if (s.audio?.hitmarkerSoundEnabled) {
          playTone("hitmarker", s.audio.clientFeedbackVolume);
        } else if (s.audio?.playClientHeadshotTone) {
          playTone("shot", s.audio.clientFeedbackVolume);
        }
      }
    },
    { passive: true }
  );

  const swLoop = setInterval(() => {
    if (!swRunning) return;
    const total = swAccumMs + (performance.now() - swLastStart);
    const mins = Math.floor(total / 60000);
    const secs = Math.floor((total % 60000) / 1000);
    const cs = Math.floor((total % 1000) / 10);
    swTimeEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }, 50);

  const wuLoop = setInterval(() => {
    if (!wuRunning) return;
    wuRemainingSec = Math.max(0, wuRemainingSec - 1);
    wuDisplay.textContent = formatSec(wuRemainingSec);
    if (wuRemainingSec === 0) {
      wuRunning = false;
      wuStartBtn.textContent = "DONE";
      const s = getSettings();
      if (!s.audio?.masterMuted) playTone("alarm", s.audio?.clientFeedbackVolume || 0.45);
    }
  }, 1000);

  function refresh() {
    const s = getSettings();
    const hud = s.hud || {};
    const ep = s.esportsHud || {};
    const master = hud.enabled !== false;
    const hScale = Math.max(0.75, Math.min(1.35, Number(ep.hudScale) || 1));
    const hOpac = Math.max(0.35, Math.min(1, Number(ep.hudOpacity) ?? 0.92));
    for (const w of [kdRoot, swRoot, wuRoot, rxRoot, keyHintBar]) {
      w.style.zoom = String(hScale);
      w.style.opacity = String(hOpac);
    }

    watermark.classList.toggle("dih-hidden", !(master && hud.watermarkEnabled));
    watermark.textContent = hud.watermarkText || "DIH CLIENT";
    watermark.style.opacity = String(hud.watermarkOpacity ?? 0.42);

    kdRoot.classList.toggle("dih-hidden", !(master && hud.kdTrackerEnabled));
    kdSubLine.classList.toggle("dih-hidden", hud.sessionKpmEnabled === false);
    swRoot.classList.toggle("dih-hidden", !(master && hud.stopwatchEnabled));
    wuRoot.classList.toggle("dih-hidden", !(master && hud.warmupTimerEnabled));
    rxRoot.classList.toggle("dih-hidden", !(master && hud.reactionWidgetEnabled));
    keyHintBar.classList.toggle("dih-hidden", !(master && hud.compactKeybindsHint));

    if (!wuRunning) {
      wuRemainingSec = Number(hud.warmupDurationSec) || 180;
      wuDisplay.textContent = formatSec(wuRemainingSec);
    }

    const gifActive = Boolean(master && hud.companionGifEnabled && hud.companionGifPath);
    gifRoot.classList.toggle("dih-hidden", !gifActive);
    if (gifActive) {
      if (gifImg.src !== hud.companionGifPath) gifImg.src = hud.companionGifPath;
      gifRoot.style.opacity = String(hud.companionGifOpacity ?? 0.92);
      const scale = Number(hud.companionGifScale ?? 0.65) || 0.65;
      gifImg.style.maxWidth = `${Math.round(200 * scale)}px`;
      gifImg.style.maxHeight = `${Math.round(200 * scale)}px`;
    }
  }

  refresh();

  return {
    refresh,
    destroy: () => {
      clearInterval(swLoop);
      clearInterval(wuLoop);
      clearTimeout(rxTimer);
    },
  };
};
