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
  defs.appendChild(filterNode);
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
    nightOverlay.classList.toggle("dih-hidden", !vis.blueLightShield);

    let filterCss = "";
    const sharp = Math.max(0, Math.min(100, Number(vis.sharpnessBoost || 0)));
    if (vis.filterEnabled || sharp > 0) {
      const b = Number(vis.brightness ?? 100);
      const c = Number(vis.contrast ?? 105);
      const sat = Number(vis.saturation ?? 112);
      const hue = Number(vis.hueRotate ?? 0);
      const sep = Number(vis.sepia ?? 0);
      const gray = Number(vis.grayscale ?? 0);
      const parts = [];
      if (vis.filterEnabled) {
        parts.push(`brightness(${b}%) contrast(${c}%) saturate(${sat}%) hue-rotate(${hue}deg) sepia(${sep}%) grayscale(${gray}%)`);
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
