/**
 * WebGL1 Fragment Shader Baker & Custom 7-Gun Skin Pack Generator for Dih Client.
 * Dual-loaded by both Command Center overlay (IIFE) and 3D Studio (global + ESM compatible).
 */
(function (root) {
  const ROYAL_FLUSH_FRAG = `
precision highp float;
uniform sampler2D original;
uniform sampler2D borders;
uniform sampler2D ovMaterialAtlas;
uniform float ovAtlasIsAwp;
uniform float time;
uniform float opacity;
uniform vec2 npAxis;

varying vec2 vUv;
varying vec3 vertPos;
varying vec3 normalVar;

const vec3 RF_BLACK = vec3(0.018, 0.023, 0.022);
const vec3 RF_CRIMSON = vec3(0.52, 0.025, 0.065);
const vec3 RF_IVORY = vec3(0.93, 0.85, 0.68);
const vec3 RF_GOLD = vec3(0.82, 0.63, 0.32);

const float RF_GLOSS_STRENGTH = 0.20;
const float RF_GOLD_REFLECTION = 0.42;
const float RF_GOLD_BEVEL = 0.36;
const float RF_SHIMMER_STRENGTH = 0.075;
const float RF_SHIMMER_SPEED = 0.65;
const float RF_MECHANICAL_TRIM = 0.28;
const float RF_DETAIL_SHADING = 0.26;
const float RF_PATTERN_DENSITY = 18.0;
const float RF_SUIT_SCALE = 0.72;

float rfHeart(vec2 q) {
  q.y += 0.14;
  q.x = abs(q.x);
  float top = length(q - vec2(0.27, 0.17)) - 0.32;
  float bottom = max(abs(q.x) + abs(q.y + 0.05) * 0.82 - 0.48, -q.y - 0.52);
  return min(top, bottom);
}

float rfSpade(vec2 q) {
  float top = rfHeart(vec2(q.x, -q.y));
  float stem = max(abs(q.x) - (0.09 + 0.16 * max(-q.y, 0.0)), abs(q.y + 0.45) - 0.18);
  return min(top, stem);
}

vec3 rfCompanion(vec2 p) {
  vec2 cell = p * RF_PATTERN_DENSITY;
  vec2 id = floor(cell);
  vec2 q = (fract(cell) - 0.5) / RF_SUIT_SCALE;
  float type = mod(id.x + id.y, 4.0);
  float d;
  if (type < 0.5) d = rfSpade(q);
  else if (type < 1.5) d = rfHeart(q);
  else if (type < 2.5) d = abs(q.x) * 0.85 + abs(q.y) * 0.62 - 0.30;
  else {
    d = min(length(q - vec2(0.0, 0.23)) - 0.23,
      min(length(q - vec2(-0.21, -0.02)) - 0.23, length(q - vec2(0.21, -0.02)) - 0.23));
    d = min(d, max(abs(q.x) - 0.08, abs(q.y + 0.32) - 0.18));
  }
  float suit = 1.0 - smoothstep(-0.012, 0.018, d);
  float stripe = step(0.62, fract(p.x * 3.0 + p.y * 1.8));
  return vec3(suit * 0.68, stripe * (1.0 - suit), 0.0);
}

void main() {
  vec2 uvFixed = vec2(vUv.x, vUv.y);
  float axial = (uvFixed.x - npAxis.x) * npAxis.y;
  vec4 maskSample = texture2D(borders, uvFixed);
  vec4 atlasSample = texture2D(ovMaterialAtlas, uvFixed);
  vec3 regions = rfCompanion(uvFixed);
  if (atlasSample.r > 0.05 || atlasSample.g > 0.05 || atlasSample.b > 0.05) {
    regions = mix(regions, atlasSample.rgb, clamp(ovAtlasIsAwp * 0.55 + 0.2, 0.0, 1.0));
  }
  regions = clamp(regions, 0.0, 1.0);
  regions /= max(1.0, regions.r + regions.g + regions.b);
  float enamel = 1.0 - clamp(regions.r + regions.g + regions.b, 0.0, 1.0);

  vec3 n = normalize(normalVar + vec3(0.0, 0.0, 0.001));
  float diffuse = 0.79 + 0.21 * max(dot(n, normalize(vec3(-0.3, 0.7, 0.8))), 0.0);
  float detail = texture2D(original, uvFixed).r;
  float shade = diffuse * mix(1.0 - RF_DETAIL_SHADING, 1.0, detail);

  float reflection = pow(max(dot(n, normalize(vec3(-0.35, 0.52, 1.0))), 0.0), 30.0);
  float broadReflection = pow(max(dot(n, normalize(vec3(0.28, 0.75, 1.0))), 0.0), 7.0);

  vec3 color = (RF_BLACK * enamel + RF_CRIMSON * regions.g) * shade;
  color += RF_IVORY * regions.b * (0.92 + 0.08 * detail) * (0.96 + 0.04 * diffuse);

  float metalBand = 0.5 + 0.5 * cos(uvFixed.y * 12.0 + n.y * 2.0);
  vec3 gold = RF_GOLD * (0.77 + 0.18 * detail + 0.17 * metalBand + RF_GOLD_BEVEL * 0.22);
  gold += vec3(0.98, 0.89, 0.64) * (reflection + 0.18 * broadReflection) * RF_GOLD_REFLECTION;
  float shimmer = pow(0.5 + 0.5 * sin(axial * 10.0 - time * RF_SHIMMER_SPEED), 12.0);
  gold += RF_IVORY * shimmer * RF_SHIMMER_STRENGTH;
  color += gold * regions.r;
  color += vec3(0.52, 0.58, 0.56) * broadReflection * RF_GLOSS_STRENGTH * (enamel + regions.g * 0.24);

  float mechanical = smoothstep(0.04, 0.55, maskSample.r * 0.7 + maskSample.b * 0.6);
  color = mix(color, gold, mechanical * RF_MECHANICAL_TRIM * (1.0 - regions.r));
  if (maskSample.b > 0.65 && maskSample.r < 0.2) {
    color = mix(color, texture2D(original, uvFixed).rgb * 0.78 + RF_GOLD * 0.12, 0.65);
  }
  gl_FragColor = vec4(color, opacity);
}
`;

  const BUILT_IN_SHADER_PACKS = {
    royalflush: {
      id: "royalflush",
      name: "Royal Flush",
      frag: ROYAL_FLUSH_FRAG,
      palette: {
        primary: "#060808",
        secondary: "#850611",
        trim: "#d1a152",
        accent: "#ede0ad",
        pattern: "suits",
      },
    },
    dih_obsidian: {
      id: "dih_obsidian",
      name: "Dih Obsidian Carbon",
      palette: {
        primary: "#12151b",
        secondary: "#1e232c",
        trim: "#d4d8df",
        accent: "#7a8494",
        pattern: "carbon",
      },
    },
    sovereign_custom: {
      id: "sovereign_custom",
      name: "Sovereign Emerald Gold",
      palette: {
        primary: "#0a1c17",
        secondary: "#0e2f26",
        trim: "#d9b45b",
        accent: "#7ee8b7",
        pattern: "topo",
      },
    },
  };

  function sanitizeFragmentSource(rawFrag) {
    let src = String(rawFrag || "").trim();
    if (!src) throw new Error("Empty fragment shader source");
    src = src.replace(/precision\s+(lowp|mediump|highp)\s+float\s*;/gi, "");
    const headerPreamble = "precision highp float;\n#define v_Normal normalVar\n";
    if (!/uniform\s+sampler2D\s+original/i.test(src)) {
      return `${headerPreamble}
uniform sampler2D original;
uniform sampler2D borders;
uniform sampler2D ovMaterialAtlas;
uniform float ovAtlasIsAwp;
uniform float time;
uniform float opacity;
uniform vec2 npAxis;
varying vec2 vUv;
varying vec3 vertPos;
varying vec3 normalVar;
${src}`;
    }
    return `${headerPreamble}\n${src}`;
  }

  function bakeFragmentShaderToCanvas(
    fragSource,
    { weaponId = "ar", baseCanvas = null, maskCanvas = null, width = 1024, height = 1024 } = {}
  ) {
    const outCanvas = document.createElement("canvas");
    outCanvas.width = width;
    outCanvas.height = height;

    const gl = outCanvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL context unavailable for shader bake");

    const vertSrc = `
attribute vec2 aPos;
varying vec2 vUv;
varying vec3 vertPos;
varying vec3 normalVar;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vertPos = vec3(aPos.x * 0.25, aPos.x * 0.5, aPos.y * 0.16);
  normalVar = normalize(vec3(-0.2, 0.55, 0.85));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

    const fragSrc = sanitizeFragmentSource(fragSource);
    const compile = (type, source) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || "Shader compile error";
        gl.deleteShader(sh);
        throw new Error(log);
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || "Shader link failed");
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const createTex = (unit, sourceCanvas) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (sourceCanvas) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([160, 160, 160, 255]));
      }
      return tex;
    };

    const atlasCanvas = document.createElement("canvas");
    atlasCanvas.width = 256;
    atlasCanvas.height = 256;
    const actx = atlasCanvas.getContext("2d");
    if (maskCanvas) actx.drawImage(maskCanvas, 0, 0, 256, 256);
    else {
      actx.fillStyle = "#180800";
      actx.fillRect(0, 0, 256, 256);
    }

    const t0 = createTex(0, baseCanvas);
    const t1 = createTex(1, maskCanvas);
    const t2 = createTex(2, atlasCanvas);

    const setU1i = (n, v) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform1i(l, v); };
    const setU1f = (n, v) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform1f(l, v); };
    const setU2f = (n, a, b) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform2f(l, a, b); };

    setU1i("original", 0);
    setU1i("borders", 1);
    setU1i("ovMaterialAtlas", 2);
    setU1f("ovAtlasIsAwp", weaponId === "awp" ? 0.25 : 0.0);
    setU1f("time", 1.25);
    setU1f("opacity", 1.0);
    setU2f("npAxis", -0.25, 1.35);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.finish();

    gl.deleteTexture(t0);
    gl.deleteTexture(t1);
    gl.deleteTexture(t2);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return outCanvas;
  }

  function paintCustomPackToContext(
    ctx,
    { weaponId = "ar", palette, baseCanvas = null, maskCanvas = null, width = 1024, height = 1024 } = {}
  ) {
    const p = palette || BUILT_IN_SHADER_PACKS.dih_obsidian.palette;
    if (p.pattern === "suits") {
      try {
        const baked = bakeFragmentShaderToCanvas(ROYAL_FLUSH_FRAG, { weaponId, baseCanvas, maskCanvas, width, height });
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(baked, 0, 0, width, height);
        return;
      } catch {}
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = p.primary || "#12151b";
    ctx.fillRect(0, 0, width, height);

    if (p.pattern === "carbon") {
      for (let y = 0; y < height; y += 20) {
        for (let x = 0; x < width; x += 20) {
          ctx.fillStyle = ((x + y) / 20) % 2 === 0 ? (p.secondary || "#1e232c") : (p.primary || "#12151b");
          ctx.fillRect(x, y, 18, 18);
        }
      }
      ctx.strokeStyle = p.trim || "#d4d8df";
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 2;
      for (let i = -height; i < width + height; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + height * 0.5, height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (p.pattern === "topo") {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, p.primary || "#0a1c17");
      grad.addColorStop(1, p.secondary || "#0e2f26");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = p.trim || "#d9b45b";
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 2.5;
      for (let r = 40; r < width * 0.9; r += 36) {
        ctx.beginPath();
        ctx.ellipse(width * 0.45, height * 0.5, r, r * 0.62, 0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (p.pattern === "tiger") {
      ctx.fillStyle = p.secondary || "#20242c";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = p.trim || "#d4d8df";
      ctx.globalAlpha = 0.72;
      for (let s = 0; s < 32; s++) {
        ctx.beginPath();
        const y = s * 34;
        ctx.moveTo(0, y);
        for (let x = 0; x <= width; x += 128) ctx.lineTo(x, y + Math.sin(x * 0.015 + s) * 24);
        for (let x = width; x >= 0; x -= 128) ctx.lineTo(x, y + 14 + Math.cos(x * 0.015 + s) * 22);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, p.primary || "#12151b");
      grad.addColorStop(1, p.secondary || "#252a35");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    if (baseCanvas) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.42;
      ctx.drawImage(baseCanvas, 0, 0, width, height);
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = p.accent || p.trim || "#d4d8df";
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.35);
    ctx.lineTo(width, height * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  root.DihSkinPackBaker = {
    ROYAL_FLUSH_FRAG,
    BUILT_IN_SHADER_PACKS,
    bakeFragmentShaderToCanvas,
    paintCustomPackToContext,
  };
})(typeof window !== "undefined" ? window : globalThis);
