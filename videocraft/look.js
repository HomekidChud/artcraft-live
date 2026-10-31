// look.js — render engine: film & anime looks for 3D scenes
// Self-contained post-processing chain over a THREE scene.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const GRADES = {
  natural: { shadow: [0.98, 0.98, 1.0], high: [1.02, 1.01, 0.98], sat: 1.0, con: 1.0 },
  cine: { shadow: [0.88, 0.99, 1.05], high: [1.05, 1.02, 0.94], sat: 0.92, con: 1.12 },
  noir: { shadow: [0.96, 0.97, 1.0], high: [1.0, 1.0, 1.0], sat: 0.0, con: 1.35 },
  vibrant: { shadow: [0.95, 0.95, 1.02], high: [1.03, 1.03, 0.97], sat: 1.3, con: 1.1 },
  scifi: { shadow: [0.82, 0.95, 1.12], high: [1.02, 1.0, 0.95], sat: 1.05, con: 1.15 },
  sunset: { shadow: [0.95, 0.88, 0.82], high: [1.1, 1.02, 0.9], sat: 1.1, con: 1.05 },
  comic: { shadow: [0.92, 0.95, 1.0], high: [1.05, 1.03, 1.0], sat: 1.25, con: 1.18 },
  pastel: { shadow: [1.0, 0.99, 1.02], high: [1.02, 1.0, 1.0], sat: 0.85, con: 0.92 },
  night: { shadow: [0.85, 0.92, 1.15], high: [0.95, 1.0, 1.08], sat: 0.9, con: 1.2 },
  'teal-orange': { shadow: [0.72, 0.95, 1.08], high: [1.1, 1.0, 0.84], sat: 1.15, con: 1.16 },
  bleach: { shadow: [1.02, 1.0, 0.98], high: [1.06, 1.03, 0.97], sat: 0.45, con: 1.3 },
  sepia: { shadow: [0.94, 0.89, 0.78], high: [1.08, 1.0, 0.8], sat: 0.55, con: 1.05 },
  dream: { shadow: [1.02, 1.0, 1.05], high: [1.05, 1.02, 1.0], sat: 0.95, con: 0.85 },
  moonlight: { shadow: [0.78, 0.88, 1.12], high: [0.9, 0.98, 1.15], sat: 0.8, con: 1.18 },
  cyberpunk: { shadow: [0.8, 0.9, 1.15], high: [1.12, 0.95, 1.05], sat: 1.35, con: 1.2 },
  forest: { shadow: [0.9, 1.05, 0.92], high: [1.02, 1.08, 1.0], sat: 1.05, con: 1.1 },
  crimson: { shadow: [1.1, 0.82, 0.85], high: [1.05, 0.92, 0.95], sat: 1.2, con: 1.25 },
  arctic: { shadow: [0.9, 0.98, 1.1], high: [1.0, 1.05, 1.1], sat: 0.8, con: 1.15 },
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null }, tStreak: { value: null },
    uShadow: { value: [0.98, 0.98, 1.0] }, uHigh: { value: [1.02, 1.01, 0.98] },
    uSat: { value: 1.0 }, uCon: { value: 1.0 }, uExposure: { value: 1.0 },
    uVignette: { value: 0.4 }, uGrain: { value: 0.05 }, uTime: { value: 0.0 },
    uChroma: { value: 0.5 }, uStreakMix: { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tBloom, tStreak;
    uniform vec3 uShadow, uHigh; uniform float uSat, uCon, uExposure, uVignette, uGrain, uTime, uChroma, uStreakMix;
    varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      vec3 col;
      // chromatic aberration toward edges — skipped entirely when off
      // (uniform branch is coherent, and saves 2 full-res fetches in software GL)
      if (uChroma > 0.001) {
        float ca = uChroma * 0.0025 * dot(d, d) * 4.0;
        col.r = texture2D(tDiffuse, uv + d * ca).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - d * ca).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      col += texture2D(tBloom, uv).rgb * 1.0;
      col += texture2D(tStreak, uv).rgb * uStreakMix;
      // exposure
      col *= uExposure;
      // film contrast around 0.18 pivot
      col = clamp((col - 0.18) * uCon + 0.18, 0.0, 4.0);
      // split tone
      vec3 lum3 = vec3(dot(col, vec3(0.2126, 0.7152, 0.0722)));
      vec3 shadow = mix(vec3(1.0), uShadow, 1.0 - smoothstep(0.0, 0.45, lum3.r));
      vec3 high = mix(vec3(1.0), uHigh, smoothstep(0.55, 1.0, lum3.r));
      col *= shadow * high;
      // saturation
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // vignette
      float vig = smoothstep(0.95, 0.35, length(d) * 1.15);
      col *= mix(1.0, vig, uVignette);
      // grain — skipped when off (sin-based rand is not free in software GL)
      if (uGrain > 0.001) {
        float g = rand(uv * 512.0 + fract(uTime) * 91.7) - 0.5;
        col += g * uGrain;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Streak (anamorphic horizontal glow). 12 narrow taps on GPU; software GL gets
// 4 wide taps over the same span — ~3x fewer fetches, visually near-identical
// for this soft glow effect.
function streakShaderSource(taps, spacing) {
  return `
    uniform sampler2D tDiffuse; uniform float uStrength; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 acc = vec3(0.0); float total = 0.0;
      for (int i = 1; i <= ${taps}; i++) {
        float w = 1.0 / float(i);
        acc += texture2D(tDiffuse, vUv + vec2(float(i) * ${spacing.toFixed(4)}, 0.0)).rgb * w;
        acc += texture2D(tDiffuse, vUv - vec2(float(i) * ${spacing.toFixed(4)}, 0.0)).rgb * w;
        total += w * 2.0;
      }
      vec3 streak = acc / total;
      float bright = dot(streak, vec3(0.33));
      streak = streak * smoothstep(0.55, 0.9, bright) * uTint * 2.2;
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      gl_FragColor = vec4(base + streak, 1.0);
    }`;
}

const StreakShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 1.0 }, uTint: { value: new THREE.Color('#7fb4ff') } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: streakShaderSource(12, 0.008),
};

// streak-only variant for the half-res software path (output has no base)
function streakOnlyShaderSource(taps, spacing) {
  return `
    uniform sampler2D tDiffuse; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 acc = vec3(0.0); float total = 0.0;
      for (int i = 1; i <= ${taps}; i++) {
        float w = 1.0 / float(i);
        acc += texture2D(tDiffuse, vUv + vec2(float(i) * ${spacing.toFixed(4)}, 0.0)).rgb * w;
        acc += texture2D(tDiffuse, vUv - vec2(float(i) * ${spacing.toFixed(4)}, 0.0)).rgb * w;
        total += w * 2.0;
      }
      vec3 streak = acc / total;
      float bright = dot(streak, vec3(0.33));
      streak = streak * smoothstep(0.55, 0.9, bright) * uTint * 2.2;
      gl_FragColor = vec4(streak, 1.0);
    }`;
}

// Half-res streak for software GL: downsample, 4-tap streak at 1/2 res, hand
// to FinalShader's tStreak. Full-res streak costs ~290ms/frame at 1080p in
// SwiftShader; this is ~1/6 the fetches.
class CheapStreakPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.enabled = true;
    this.quad = new FullScreenQuad(null);
    this.rtDown = null; this.rtStreak = null;
    this.streakTexture = null;
    this.matDown = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: QUAD_VERT,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`,
    });
    this.matStreak = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTint: { value: new THREE.Color('#7fb4ff') } },
      vertexShader: QUAD_VERT,
      fragmentShader: streakOnlyShaderSource(4, 0.024),
    });
  }
  setSize(w, h) {
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    if (this.rtDown?.width === hw && this.rtStreak?.height === hh) return;
    this.rtDown?.dispose(); this.rtStreak?.dispose();
    this.rtDown = new THREE.WebGLRenderTarget(hw, hh);
    this.rtStreak = new THREE.WebGLRenderTarget(hw, hh);
    this.streakTexture = this.rtStreak.texture;
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.rtDown) this.setSize(renderer.domElement.width, renderer.domElement.height);
    this.matDown.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.rtDown);
    this.quad.material = this.matDown; this.quad.render(renderer);
    this.matStreak.uniforms.tDiffuse.value = this.rtDown.texture;
    renderer.setRenderTarget(this.rtStreak);
    this.quad.material = this.matStreak; this.quad.render(renderer);
    renderer.setRenderTarget(null);
  }
  dispose() { this.rtDown?.dispose(); this.rtStreak?.dispose(); this.quad.dispose(); }
}

// Cheap bloom for software GL: threshold + downsample to 1/4 res, separable
// 9-tap gaussian, handed to FinalShader via its tBloom uniform. UnrealBloom's
// full-res high-pass + 5-mip chain costs ~360ms/frame at 1080p in SwiftShader;
// this does the same job at 1/16th the pixels for a soft glow.
const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
class CheapBloomPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.enabled = true;
    this.strength = 0.6;
    this.threshold = 0.85;
    this.quad = new FullScreenQuad(null);
    this.rtA = null; this.rtB = null;
    this.bloomTexture = null;
    this.matThreshold = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.6 }, uThreshold: { value: 0.85 } },
      vertexShader: QUAD_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uStrength, uThreshold; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float f = smoothstep(uThreshold, uThreshold + 0.15, lum);
          gl_FragColor = vec4(c * f * uStrength, 1.0);
        }`,
    });
    this.matBlur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv;
        void main(){
          vec3 acc = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
          acc += ( texture2D(tDiffuse, vUv + uStep * 1.0).rgb + texture2D(tDiffuse, vUv - uStep * 1.0).rgb ) * 0.1945945946;
          acc += ( texture2D(tDiffuse, vUv + uStep * 2.0).rgb + texture2D(tDiffuse, vUv - uStep * 2.0).rgb ) * 0.1216216216;
          acc += ( texture2D(tDiffuse, vUv + uStep * 3.0).rgb + texture2D(tDiffuse, vUv - uStep * 3.0).rgb ) * 0.0540540541;
          acc += ( texture2D(tDiffuse, vUv + uStep * 4.0).rgb + texture2D(tDiffuse, vUv - uStep * 4.0).rgb ) * 0.0162162162;
          gl_FragColor = vec4(acc, 1.0);
        }`,
    });
  }
  setSize(w, h) {
    const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    if (this.rtA?.width === qw && this.rtB?.height === qh) return;
    this.rtA?.dispose(); this.rtB?.dispose();
    this.rtA = new THREE.WebGLRenderTarget(qw, qh);
    this.rtB = new THREE.WebGLRenderTarget(qw, qh);
    this.bloomTexture = this.rtA.texture;
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.rtA) this.setSize(renderer.domElement.width, renderer.domElement.height);
    // threshold + downsample
    this.matThreshold.uniforms.tDiffuse.value = readBuffer.texture;
    this.matThreshold.uniforms.uStrength.value = this.strength;
    this.matThreshold.uniforms.uThreshold.value = this.threshold;
    renderer.setRenderTarget(this.rtA);
    this.quad.material = this.matThreshold; this.quad.render(renderer);
    // horizontal blur
    this.matBlur.uniforms.tDiffuse.value = this.rtA.texture;
    this.matBlur.uniforms.uStep.value.set(1 / this.rtA.width, 0);
    renderer.setRenderTarget(this.rtB);
    this.quad.material = this.matBlur; this.quad.render(renderer);
    // vertical blur
    this.matBlur.uniforms.tDiffuse.value = this.rtB.texture;
    this.matBlur.uniforms.uStep.value.set(0, 1 / this.rtB.height);
    renderer.setRenderTarget(this.rtA);
    this.quad.material = this.matBlur; this.quad.render(renderer);
    renderer.setRenderTarget(null);
  }
  dispose() { this.rtA?.dispose(); this.rtB?.dispose(); this.quad.dispose(); }
}

const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uResolution: { value: new THREE.Vector2() },
    uStrength: { value: 1.0 }, uColor: { value: new THREE.Color('#141414') },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth; uniform vec2 uResolution; uniform float uStrength; uniform vec3 uColor; varying vec2 vUv;
    float readDepth(vec2 uv){ return texture2D(tDepth, uv).r; }
    void main(){
      vec2 px = 1.0 / uResolution;
      float c = readDepth(vUv);
      float d1 = readDepth(vUv + vec2(px.x, 0.0)); float d2 = readDepth(vUv - vec2(px.x, 0.0));
      float d3 = readDepth(vUv + vec2(0.0, px.y)); float d4 = readDepth(vUv - vec2(0.0, px.y));
      float diff = max(max(abs(c - d1), abs(c - d2)), max(abs(c - d3), abs(c - d4)));
      float near = step(c, 0.9999); // sky has no depth (1.0)
      float edge = clamp(diff * 140.0, 0.0, 1.0) * near * uStrength;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col = mix(col, uColor, edge);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const toonCache = new Map();
function toonStepTexture(steps) {
  if (toonCache.has(steps)) return toonCache.get(steps);
  const c = document.createElement('canvas'); c.width = steps; c.height = 1;
  const ctx = c.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i + 1) / steps * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(i, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
  toonCache.set(steps, tex);
  return tex;
}

// Software GL (SwiftShader/llvmpipe) pays ~4x fragment cost for MSAA — detect it
// and skip antialiasing there. Real GPUs keep AA. Override with opts.forceAA.
function isSoftwareGL() {
  try {
    // probe on a detached canvas so we never disturb the render canvas's context
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '';
    return /swiftshader|llvmpipe|softpipe|software/i.test(r);
  } catch (e) { return false; }
}

export function createLookEngine(canvas, opts = {}) {
  const softGL = isSoftwareGL(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.forceAA ?? !softGL, alpha: false });
  if (softGL) console.info('[look] software GL detected — antialiasing off for speed');
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass();
  composer.addPass(renderPass);

  const outlinePass = new ShaderPass(OutlineShader);
  composer.addPass(outlinePass);

  // software GL: quarter-res bloom instead of UnrealBloom's full-res mip chain
  const cheapBloom = softGL ? new CheapBloomPass() : null;
  const bloomPass = softGL ? cheapBloom : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.4, 0.85);
  composer.addPass(bloomPass);

  // software GL: half-res streak pass feeding FinalShader's tStreak
  const cheapStreak = softGL ? new CheapStreakPass() : null;
  const streakPass = softGL ? cheapStreak : new ShaderPass({
    uniforms: StreakShader.uniforms,
    vertexShader: StreakShader.vertexShader,
    fragmentShader: streakShaderSource(12, 0.008),
  });
  composer.addPass(streakPass);

  const finalPass = new ShaderPass(FinalShader);
  finalPass.renderToScreen = true;
  composer.addPass(finalPass);

  // depth render target for outlines (rendered with REAL materials)
  let depthRT = null;

  const look = {
    style: 'film', // 'film' | 'anime' | 'clean'
    grade: 'cine', bloom: 0.6, vignette: 0.4, grain: 0.05, chroma: 0.5,
    outline: 1.0, toonSteps: 4, exposure: 1.0, streak: 0.0,
    dof: 0, focus: 8,
  };

  const engine = {
    renderer, look,
    setSize(w, h) { renderer.setSize(w, h, false); composer.setSize(w, h); },
    render(scene, camera, t = 0) {
      const L = look;
      renderPass.scene = scene; renderPass.camera = camera;
      const w = renderer.domElement.width, h = renderer.domElement.height;
      outlinePass.uniforms.uResolution.value.set(w, h);

      // anime: swap meshes to cached toon materials
      const swapped = [];
      if (L.style === 'anime') {
        const steps = Math.max(2, L.toonSteps | 0);
        scene.traverse((o) => {
          if (o.isMesh && o.material && !o.userData.noToon) {
            if (!o.userData._origMat) o.userData._origMat = o.material;
            if (!o.userData._toonMat || o.userData._toonSteps !== steps) {
              const src = o.userData._origMat;
              o.userData._toonMat?.dispose();
              const toon = new THREE.MeshToonMaterial({
                color: (src.color || new THREE.Color(0xffffff)).clone(),
                gradientMap: toonStepTexture(steps),
                map: src.map || null,
                transparent: src.transparent,
                opacity: src.opacity,
              });
              toon.userData.toon = true;
              o.userData._toonMat = toon;
              o.userData._toonSteps = steps;
            }
            swapped.push(o);
            o.material = o.userData._toonMat;
          }
        });
      }
      const restore = () => swapped.forEach((o) => { o.material = o.userData._origMat; });

      // depth pass (real materials -> correct depth for all objects)
      if (L.outline > 0 && L.style === 'anime') {
        if (!depthRT || depthRT.width !== w || depthRT.height !== h) {
          depthRT?.dispose();
          depthRT = new THREE.WebGLRenderTarget(w, h);
          depthRT.depthTexture = new THREE.DepthTexture(w, h);
        }
        renderer.setRenderTarget(depthRT);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        outlinePass.uniforms.tDepth.value = depthRT.depthTexture;
        outlinePass.uniforms.uStrength.value = L.outline;
        outlinePass.enabled = true;
      } else {
        outlinePass.enabled = false;
      }

      // bloom + streak
      bloomPass.enabled = L.bloom > 0.001 && L.style !== 'clean';
      bloomPass.strength = L.bloom;
      bloomPass.threshold = L.style === 'anime' ? 0.7 : 0.85;
      if (cheapBloom) finalPass.uniforms.tBloom.value = cheapBloom.bloomTexture;
      if (cheapStreak) finalPass.uniforms.tStreak.value = cheapStreak.streakTexture;
      streakPass.enabled = L.streak > 0.001 && L.style === 'film';
      if (!cheapStreak) streakPass.uniforms.uStrength.value = L.streak;

      // final grade
      const g = GRADES[L.grade] || GRADES.cine;
      const u = finalPass.uniforms;
      u.uShadow.value = g.shadow; u.uHigh.value = g.high;
      u.uSat.value = L.style === 'anime' ? g.sat : g.sat;
      u.uCon.value = g.con;
      u.uVignette.value = L.vignette; u.uGrain.value = L.grain; u.uChroma.value = L.chroma;
      u.uExposure.value = L.exposure; u.uStreakMix.value = L.streak; u.uTime.value = t;

      composer.render();
      restore();
      return renderer.domElement;
    },
    dispose() { renderer.dispose(); depthRT?.dispose(); cheapBloom?.dispose(); cheapStreak?.dispose(); },
  };
  return engine;
}

export const LOOK_GRADES = Object.keys(GRADES);
