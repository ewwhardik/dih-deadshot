/**
 * Zero-Lag Precision Crosshair Engine:
 * 10 geometries + stadia tactical ticks + adaptive mix-blend contrast,
 * GPU transform recoil bloom (never rebuilds SVG DOM during fire), ADS hide/shrink & slot profiles.
 */

DIH_NS.createCrosshairEngine = function createCrosshairEngine(shadowRoot, getSettings) {
  const { el } = DIH_NS.utils;

  const wrap = el("div", { className: "dih-crosshair-wrap" });
  shadowRoot.appendChild(wrap);

  let isAds = false;
  let bloomScale = 1.0;
  let bloomAnimActive = false;
  let hitFlashUntil = 0;
  let activeSlot = null;
  let lastRenderSig = "";

  function renderSvgToContainer(container, cfg) {
    container.innerHTML = "";
    if (!cfg) return;

    let styleType = cfg.type || "CrossDot";
    if (cfg.perWeaponProfiles && activeSlot && cfg.weaponProfiles?.[activeSlot]) {
      styleType = cfg.weaponProfiles[activeSlot];
    }

    if (styleType === "Custom" && cfg.customSvgOrUrl) {
      const trimmed = cfg.customSvgOrUrl.trim();
      if (trimmed.startsWith("<svg")) {
        const sanitized = trimmed.replace(/<script[\s\S]*?<\/script>/gi, "");
        const holder = document.createElement("div");
        holder.innerHTML = sanitized;
        const svgEl = holder.querySelector("svg");
        if (svgEl) {
          svgEl.style.width = `${Math.max(8, (Number(cfg.size) || 14) * 2)}px`;
          svgEl.style.height = `${Math.max(8, (Number(cfg.size) || 14) * 2)}px`;
          container.appendChild(svgEl);
          return;
        }
      } else if (/^(https?:|custom:|data:image\/)/i.test(trimmed)) {
        const img = document.createElement("img");
        img.src = trimmed;
        img.style.width = `${Math.max(8, (Number(cfg.size) || 14) * 2)}px`;
        img.style.height = `${Math.max(8, (Number(cfg.size) || 14) * 2)}px`;
        img.style.objectFit = "contain";
        container.appendChild(img);
        return;
      }
    }

    const ns = "http://www.w3.org/2000/svg";
    const size = Math.max(2, Number(cfg.size) || 14);
    const thick = Math.max(1, Number(cfg.thickness) || 2);
    const gap = Math.max(0, Number(cfg.gap) || 4);
    const dotSize = Math.max(0.5, Number(cfg.dotSize) || 2.5);
    const outlineW = cfg.outlineEnabled ? Math.max(0.5, Number(cfg.outlineWidth) || 1.5) : 0;
    const fillCol = cfg.color || "#f2f4f7";
    const outCol = cfg.outlineColor || "#0a0b0d";
    const rot = Number(cfg.rotation) || 0;

    const span = Math.ceil((size + gap + outlineW + 18) * 2);
    const cx = span / 2;
    const cy = span / 2;

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(span));
    svg.setAttribute("height", String(span));
    svg.setAttribute("viewBox", `0 0 ${span} ${span}`);
    svg.style.display = "block";
    if (rot !== 0) svg.style.transform = `rotate(${rot}deg)`;

    const addRect = (x, y, w, h) => {
      if (outlineW > 0) {
        const bg = document.createElementNS(ns, "rect");
        bg.setAttribute("x", String(x - outlineW));
        bg.setAttribute("y", String(y - outlineW));
        bg.setAttribute("width", String(w + outlineW * 2));
        bg.setAttribute("height", String(h + outlineW * 2));
        bg.setAttribute("fill", outCol);
        svg.appendChild(bg);
      }
      const fg = document.createElementNS(ns, "rect");
      fg.setAttribute("x", String(x));
      fg.setAttribute("y", String(y));
      fg.setAttribute("width", String(w));
      fg.setAttribute("height", String(h));
      fg.setAttribute("fill", fillCol);
      svg.appendChild(fg);
    };

    const addLine = (x1, y1, x2, y2) => {
      if (outlineW > 0) {
        const bg = document.createElementNS(ns, "line");
        bg.setAttribute("x1", String(x1));
        bg.setAttribute("y1", String(y1));
        bg.setAttribute("x2", String(x2));
        bg.setAttribute("y2", String(y2));
        bg.setAttribute("stroke", outCol);
        bg.setAttribute("stroke-width", String(thick + outlineW * 2));
        bg.setAttribute("stroke-linecap", "round");
        bg.setAttribute("stroke-opacity", String(cfg._outlineOpacity ?? 0.85));
        svg.appendChild(bg);
      }
      const fg = document.createElementNS(ns, "line");
      fg.setAttribute("x1", String(x1));
      fg.setAttribute("y1", String(y1));
      fg.setAttribute("x2", String(x2));
      fg.setAttribute("y2", String(y2));
      fg.setAttribute("stroke", fillCol);
      fg.setAttribute("stroke-width", String(thick));
      fg.setAttribute("stroke-linecap", "round");
      svg.appendChild(fg);
    };

    const addDot = () => {
      if (outlineW > 0) {
        const bg = document.createElementNS(ns, "circle");
        bg.setAttribute("cx", String(cx));
        bg.setAttribute("cy", String(cy));
        bg.setAttribute("r", String(dotSize + outlineW));
        bg.setAttribute("fill", outCol);
        bg.setAttribute("fill-opacity", String(cfg._outlineOpacity ?? 0.85));
        svg.appendChild(bg);
      }
      const fg = document.createElementNS(ns, "circle");
      fg.setAttribute("cx", String(cx));
      fg.setAttribute("cy", String(cy));
      fg.setAttribute("r", String(dotSize));
      fg.setAttribute("fill", cfg._centerDotColor || fillCol);
      svg.appendChild(fg);
    };

    const addCircle = (radius) => {
      if (outlineW > 0) {
        const bg = document.createElementNS(ns, "circle");
        bg.setAttribute("cx", String(cx));
        bg.setAttribute("cy", String(cy));
        bg.setAttribute("r", String(radius));
        bg.setAttribute("fill", "none");
        bg.setAttribute("stroke", outCol);
        bg.setAttribute("stroke-opacity", String(cfg._outlineOpacity ?? 0.85));
        bg.setAttribute("stroke-width", String(thick + outlineW * 2));
        svg.appendChild(bg);
      }
      const fg = document.createElementNS(ns, "circle");
      fg.setAttribute("cx", String(cx));
      fg.setAttribute("cy", String(cy));
      fg.setAttribute("r", String(radius));
      fg.setAttribute("fill", "none");
      fg.setAttribute("stroke", fillCol);
      fg.setAttribute("stroke-width", String(thick));
      svg.appendChild(fg);
    };

    const halfT = thick / 2;
    switch (styleType) {
      case "Dot":
        addDot();
        break;
      case "Cross":
        addRect(cx - size - gap, cy - halfT, size, thick);
        addRect(cx + gap, cy - halfT, size, thick);
        addRect(cx - halfT, cy - size - gap, thick, size);
        addRect(cx - halfT, cy + gap, thick, size);
        break;
      case "CrossDot":
        addRect(cx - size - gap, cy - halfT, size, thick);
        addRect(cx + gap, cy - halfT, size, thick);
        addRect(cx - halfT, cy - size - gap, thick, size);
        addRect(cx - halfT, cy + gap, thick, size);
        addDot();
        break;
      case "TCross":
        addRect(cx - size - gap, cy - halfT, size, thick);
        addRect(cx + gap, cy - halfT, size, thick);
        addRect(cx - halfT, cy + gap, thick, size);
        addDot();
        break;
      case "Circle":
        addCircle(Math.max(4, size + gap * 0.4));
        break;
      case "CircleDot":
        addCircle(Math.max(4, size + gap * 0.4));
        addDot();
        break;
      case "XShaped": {
        const d1 = gap * 0.7;
        const d2 = (gap + size) * 0.7;
        addLine(cx - d2, cy - d2, cx - d1, cy - d1);
        addLine(cx + d1, cy - d1, cx + d2, cy - d2);
        addLine(cx - d2, cy + d2, cx - d1, cy + d1);
        addLine(cx + d1, cy + d1, cx + d2, cy + d2);
        addDot();
        break;
      }
      case "Chevron":
        addLine(cx - size * 0.7, cy + size * 0.55 + gap * 0.3, cx, cy + gap * 0.25);
        addLine(cx, cy + gap * 0.25, cx + size * 0.7, cy + size * 0.55 + gap * 0.3);
        addDot();
        break;
      case "Brackets": {
        const b = Math.max(4, size * 0.65);
        const offset = gap + size * 0.45;
        addLine(cx - offset, cy - b, cx - offset - b * 0.4, cy);
        addLine(cx - offset - b * 0.4, cy, cx - offset, cy + b);
        addLine(cx + offset, cy - b, cx + offset + b * 0.4, cy);
        addLine(cx + offset + b * 0.4, cy, cx + offset, cy + b);
        addDot();
        break;
      }
      default:
        addDot();
        break;
    }

    if (cfg.tacticalTicks) {
      addRect(cx - 5, cy + gap + size + 5, 10, 1.5);
      addRect(cx - 3.5, cy + gap + size + 10, 7, 1.5);
      addRect(cx - 2, cy + gap + size + 15, 4, 1.5);
    }

    container.appendChild(svg);
  }

  function applyTransformOnly(cfg) {
    const adsScale = isAds && cfg.shrinkOnAds ? 0.68 : 1;
    const totalScale = adsScale * bloomScale;
    wrap.style.transform = `translate(-50%, -50%) scale(${totalScale.toFixed(3)})`;
    const flash = performance.now() < hitFlashUntil;
    wrap.style.filter = flash ? `drop-shadow(0 0 4px ${cfg.hitFlashColor || "#ffffff"}) brightness(1.4)` : "";
  }

  function tickBloom() {
    const s = getSettings();
    const cfg = s.crosshair || {};
    const needFlash = hitFlashUntil > 0 && performance.now() < hitFlashUntil;
    if (hitFlashUntil > 0 && !needFlash) hitFlashUntil = 0;

    if (bloomScale > 1.005) {
      bloomScale = 1 + (bloomScale - 1) * 0.78;
    } else {
      bloomScale = 1;
    }

    applyTransformOnly(cfg);

    if (bloomScale > 1 || hitFlashUntil > 0) {
      requestAnimationFrame(tickBloom);
    } else {
      bloomAnimActive = false;
    }
  }

  const hitmarkerEl = document.createElement("div");
  hitmarkerEl.style.cssText =
    "position:fixed;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%) scale(0.95);pointer-events:none;z-index:88;opacity:0;transition:opacity 75ms ease;";
  hitmarkerEl.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
    '<line x1="4" y1="4" x2="9" y2="9" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>' +
    '<line x1="20" y1="4" x2="15" y2="9" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>' +
    '<line x1="4" y1="20" x2="9" y2="15" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>' +
    '<line x1="20" y1="20" x2="15" y2="15" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>' +
    "</svg>";
  shadowRoot.appendChild(hitmarkerEl);

  const movingKeys = new Set();
  let hitmarkerTimer = 0;

  function render() {
    const s = getSettings();
    const hudEnabled = s.hud?.enabled !== false;
    const baseCfg = s.crosshair || {};
    const pro = s.crosshairPro || {};
    const visible = Boolean(hudEnabled && baseCfg.enabled);

    if (!visible || (isAds && baseCfg.hideOnAds)) {
      wrap.classList.add("dih-hidden");
      return;
    }

    const movingExtra = pro.velocitySpread && movingKeys.size > 0 ? 4 : 0;
    const effectiveType =
      pro.sniperDotOnlyMode && isAds
        ? "Dot"
        : baseCfg.perWeaponProfiles && activeSlot
        ? baseCfg.weaponProfiles?.[activeSlot] || baseCfg.type
        : baseCfg.type;

    const cfg = {
      ...baseCfg,
      type: effectiveType,
      gap: (Number(baseCfg.gap) || 0) + movingExtra,
      _centerDotColor: pro.centerDotColor || baseCfg.color,
      _outlineOpacity: pro.outlineOpacity ?? 0.85,
    };

    wrap.classList.remove("dih-hidden");
    wrap.classList.toggle("invert", Boolean(cfg.mixBlendInvert));
    wrap.style.opacity = String(cfg.opacity ?? 0.95);

    const sig = JSON.stringify({
      t: cfg.type,
      c: cfg.color,
      cdc: cfg._centerDotColor,
      oc: cfg.outlineColor,
      oo: cfg._outlineOpacity,
      oe: cfg.outlineEnabled,
      ow: cfg.outlineWidth,
      s: cfg.size,
      th: cfg.thickness,
      g: cfg.gap,
      d: cfg.dotSize,
      r: cfg.rotation,
      tk: cfg.tacticalTicks,
      cu: cfg.customSvgOrUrl,
    });

    if (sig !== lastRenderSig) {
      lastRenderSig = sig;
      renderSvgToContainer(wrap, cfg);
    }
    applyTransformOnly(cfg);
  }

  window.addEventListener(
    "mousedown",
    (e) => {
      const s = getSettings();
      const cfg = s.crosshair || {};
      const pro = s.crosshairPro || {};
      if (!cfg.enabled) return;
      if (e.button === 2) {
        isAds = true;
        render();
      } else if (e.button === 0 && document.pointerLockElement) {
        if (cfg.recoilBloom) {
          bloomScale = Math.min(1.65, bloomScale + 0.24);
        }
        if (cfg.hitFlashOnShot) {
          hitFlashUntil = performance.now() + 85;
        }
        if (pro.hitmarkerFlash && s.hud?.enabled !== false) {
          clearTimeout(hitmarkerTimer);
          hitmarkerEl.style.opacity = "0.92";
          hitmarkerTimer = setTimeout(() => {
            hitmarkerEl.style.opacity = "0";
          }, 95);
        }
        if (!bloomAnimActive && (bloomScale > 1 || hitFlashUntil > 0)) {
          bloomAnimActive = true;
          requestAnimationFrame(tickBloom);
        }
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "mouseup",
    (e) => {
      if (e.button === 2 && isAds) {
        isAds = false;
        render();
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "1") { activeSlot = "slot1"; render(); }
      else if (e.key === "2") { activeSlot = "slot2"; render(); }
      else if (e.key === "3") { activeSlot = "slot3"; render(); }
      else if (e.code === "KeyW" || e.code === "KeyA" || e.code === "KeyS" || e.code === "KeyD") {
        const had = movingKeys.size > 0;
        movingKeys.add(e.code);
        if (!had && getSettings()?.crosshairPro?.velocitySpread) render();
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (movingKeys.delete(e.code) && movingKeys.size === 0 && getSettings()?.crosshairPro?.velocitySpread) {
        render();
      }
    },
    { passive: true }
  );

  render();

  return {
    renderSvgToContainer,
    refresh: render,
    destroy: () => {
      clearTimeout(hitmarkerTimer);
    },
  };
};
