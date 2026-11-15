/**
 * Real-time GPU Color Grading Filters, Scope Vignette, Night Shield & Non-Intrusive Deadshot Menu Polish.
 */

DIH_NS.createFilterEngine = function createFilterEngine(shadowRoot, getSettings) {
  const { el } = DIH_NS.utils;

  const scopeOverlay = el("div", { className: "dih-scope-enhancer dih-hidden" });
  const nightOverlay = el("div", { className: "dih-night-shield dih-hidden" });
  const svgDefs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgDefs.setAttribute("width", "0");
  svgDefs.setAttribute("height", "0");
  svgDefs.style.cssText = "position:absolute;width:0;height:0;pointer-events:none;opacity:0;";
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filterNode = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filterNode.setAttribute("id", "dih-sharpen-filter");
  const convolveNode = document.createElementNS("http://www.w3.org/2000/svg", "feConvolveMatrix");
  convolveNode.setAttribute("order", "3");
  convolveNode.setAttribute("preserveAlpha", "true");
  convolveNode.setAttribute("kernelMatrix", "0 0 0 0 1 0 0 0 0");
  filterNode.appendChild(convolveNode);

  const blackEqFilter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  blackEqFilter.setAttribute("id", "dih-blackeq-filter");
  const transferNode = document.createElementNS("http://www.w3.org/2000/svg", "feComponentTransfer");
  const eqR = document.createElementNS("http://www.w3.org/2000/svg", "feFuncR");
  const eqG = document.createElementNS("http://www.w3.org/2000/svg", "feFuncG");
  const eqB = document.createElementNS("http://www.w3.org/2000/svg", "feFuncB");
  for (const ch of [eqR, eqG, eqB]) {
    ch.setAttribute("type", "gamma");
    ch.setAttribute("amplitude", "1");
    ch.setAttribute("exponent", "1");
    ch.setAttribute("offset", "0");
    transferNode.appendChild(ch);
  }
  blackEqFilter.appendChild(transferNode);

  defs.append(filterNode, blackEqFilter);
  svgDefs.appendChild(defs);
  (document.body || document.documentElement).appendChild(svgDefs);
  shadowRoot.append(scopeOverlay, nightOverlay);

  const HOST_STYLE_ID = "dih-host-polish-style";
  let styleEl = document.getElementById(HOST_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = HOST_STYLE_ID;
    document.head?.appendChild(styleEl);
  }

  function apply() {
    const s = getSettings();
    const vis = s.visuals || {};
    const theme = s.theme || {};
    const hud = s.hud || {};

    scopeOverlay.classList.toggle("dih-hidden", !vis.scopeVignetteEnhancer);
    if (vis.scopeVignetteEnhancer) {
      const dark = Math.max(0.1, Math.min(0.92, (Number(vis.vignetteDarkness ?? 45) || 45) / 100));
      scopeOverlay.style.background = `radial-gradient(circle at center, transparent 40%, rgba(4, 5, 8, ${dark.toFixed(2)}) 98%)`;
    }
    nightOverlay.classList.toggle("dih-hidden", !vis.blueLightShield);

    let filterCss = "";
    const sharp = Math.max(0, Math.min(100, Number(vis.sharpnessBoost || 0)));
    const blackEq = Math.max(0, Math.min(50, Number(vis.blackEqualizer || 0)));
    const vibBoost = Math.max(0, Math.min(100, Number(vis.digitalVibranceBoost || 0)));
    if (vis.filterEnabled || sharp > 0 || blackEq > 0 || vibBoost > 0) {
      const b = vis.filterEnabled ? Number(vis.brightness ?? 100) : 100;
      const c = vis.filterEnabled ? Number(vis.contrast ?? 105) : 100;
      const baseSat = vis.filterEnabled ? Number(vis.saturation ?? 112) : 100;
      const sat = Math.round(baseSat + vibBoost * 0.9);
      const hue = vis.filterEnabled ? Number(vis.hueRotate ?? 0) : 0;
      const sep = vis.filterEnabled ? Number(vis.sepia ?? 0) : 0;
      const gray = vis.filterEnabled ? Number(vis.grayscale ?? 0) : 0;
      const parts = [];
      if (vis.filterEnabled || vibBoost > 0) {
        parts.push(`brightness(${b}%) contrast(${c}%) saturate(${sat}%) hue-rotate(${hue}deg) sepia(${sep}%) grayscale(${gray}%)`);
      }
      if (blackEq > 0) {
        const exp = Math.max(0.42, 1 - (blackEq / 50) * 0.52).toFixed(3);
        const offset = ((blackEq / 50) * 0.045).toFixed(3);
        for (const ch of [eqR, eqG, eqB]) {
          ch.setAttribute("exponent", exp);
          ch.setAttribute("offset", offset);
        }
        parts.push("url(#dih-blackeq-filter)");
      }
      if (sharp > 0) {
        const amt = (sharp / 100) * 1.15;
        const center = (1 + 4 * amt).toFixed(3);
        const edge = (-amt).toFixed(3);
        convolveNode.setAttribute("kernelMatrix", `0 ${edge} 0 ${edge} ${center} ${edge} 0 ${edge} 0`);
        parts.push("url(#dih-sharpen-filter)");
      }
      filterCss = parts.join(" ");
    }

    const cssRules = [];
    if (filterCss) {
      cssRules.push(`canvas { filter: ${filterCss} !important; }`);
    }
    if (hud.streamerPrivacyBlur) {
      cssRules.push(`#uname, .usernameInput, input[placeholder*="name" i] { filter: blur(6px) !important; transition: filter 120ms; }`);
    }
    if (vis.cleanHideGamePromo !== false) {
      cssRules.push(`[id*="banner" i], [id*="promo" i], [class*="ad-container" i], [class*="adBanner" i] { display: none !important; opacity: 0 !important; pointer-events: none !important; }`);
    }
    if (vis.highContrastCursor) {
      cssRules.push(`body, button, select { cursor: crosshair !important; }`);
    }
    if (theme.customCssEnabled !== false && theme.minimalistGameUi !== false) {
      cssRules.push(`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0e0f12; }
        ::-webkit-scrollbar-thumb { background: rgba(212, 216, 223, 0.22); border-radius: 99px; }
        #logo, img[src*="logo"] {
          object-fit: contain !important;
          object-position: center center !important;
          filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.52)) !important;
        }
        #settingsDiv, #crosshairSettingsDiv {
          border-color: rgba(212, 216, 223, 0.16) !important;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55) !important;
        }
      `);
    }

    styleEl.textContent = cssRules.join("\n");
  }

  apply();

  return {
    refresh: apply,
    destroy: () => {
      if (styleEl && styleEl.parentNode) styleEl.remove();
      if (svgDefs && svgDefs.parentNode) svgDefs.remove();
    },
  };
};
