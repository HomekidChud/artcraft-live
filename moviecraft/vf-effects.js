// MovieCraft look engine — the cinematic rendering pipeline.
// Two render styles, evaluated per frame from project data only:
//   film  — PBR + ACES, bloom, anamorphic lens flares, DoF, grade, grain
//   anime — cel toon shading (stepped ramp), depth edge-detection outlines,
//           bright saturated grade. Outlines come from a dedicated depth
//           pre-pass, so they track skinned avatars and imported GLBs too.
// Renders through the same WebGL canvas the exporter captures, so every
// effect is baked into exported movies in both export modes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function defaultLook() {
  return {
    on: true, style: 'film', grade: 'cinematic',
    bloom: 0.35, vignette: 0.32, grain: 0.1, chroma: 0.06,
    flare: 0.3,                          // anamorphic streaks (film)
    outline: 1.0, toonSteps: 3,          // cel shading (anime)
    dof: false, focus: 9, aperture: 0.035,
    env: true,
  };
}

// shadow tint / highlight tint / contrast / saturation / warmth
export const GRADES = {
  neutral:    { lift: [0.0, 0.0, 0.0], gain: [0.0, 0.0, 0.0], contrast: 1.0,  sat: 1.0,  warm: 0.0 },
  cinematic:  { lift: [0.0, 0.02, 0.05], gain: [0.04, 0.02, 0.0], contrast: 1.06, sat: 1.08, warm: 0.03 },
  blockbuster:{ lift: [0.0, 0.03, 0.07], gain: [0.06, 0.03, 0.0], contrast: 1.12, sat: 1.15, warm: 0.06 },
  golden:     { lift: [0.03, 0.01, -0.02], gain: [0.07, 0.04, 0.0], contrast: 1.05, sat: 1.1, warm: 0.1 },
  noir:       { lift: [-0.02, -0.02, -0.01], gain: [0.0, 0.0, 0.02], contrast: 1.25, sat: 0.35, warm: -0.04 },
  neon:       { lift: [0.0, 0.0, 0.06], gain: [0.05, 0.0, 0.02], contrast: 1.1, sat: 1.3, warm: -0.05 },
  // anime grades: bright, saturated, warm highlights over cool shadows
  anime:      { lift: [0.0, 0.01, 0.05], gain: [0.07, 0.05, 0.02], contrast: 1.04, sat: 1.32, warm: 0.05 },
  'anime-dusk':{ lift: [0.02, 0.0, 0.07], gain: [0.08, 0.04, 0.0], contrast: 1.1, sat: 1.22, warm: 0.08 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1 }, uSat: { value: 1 }, uWarm: { value: 0 },
    uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3() },
    uVignette: { value: 0.3 }, uGrain: { value: 0.1 }, uChroma: { value: 0.05 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSat, uWarm, uVignette, uGrain, uChroma, uTime;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration grows toward the frame edge (subtle, lens-like)
      float ca = uChroma * (0.05 + r2 * 0.3);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      // colour grade: shadow lift, highlight gain, warmth, contrast, saturation
      col = col + uLift * (1.0 - col) * 0.5 + uGain * col * 0.5;
      col += uWarm * vec3(1.0, 0.4, -0.6) * 0.08;
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSat);
      // vignette
      col *= 1.0 - uVignette * smoothstep(0.15, 0.62, r2);
      // film grain (animated so it does not look like a static overlay)
      float g = hash(uv * vec2(1920.0, 1080.0) + uTime) - 0.5;
      col += g * uGrain * 0.12;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// Anamorphic lens flare — horizontal blue streaks blooming off bright pixels,
// the signature look of big-budget action cinematography.
const FlareShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlare: { value: 0.3 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uFlare;
    varying vec2 vUv;
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (uFlare <= 0.001) { gl_FragColor = vec4(col, 1.0); return; }
      // wide horizontal gather with linear falloff — cheap anamorphic streak
      vec3 streak = vec3(0.0);
      float wsum = 0.0;
      for (int i = 1; i <= 14; i++) {
        float off = float(i) / 14.0;
        float w = 1.0 - off;
        vec2 d = vec2(off * 0.05, 0.0);
        streak += texture2D(tDiffuse, vUv + d).rgb * w;
        streak += texture2D(tDiffuse, vUv - d).rgb * w;
        wsum += 2.0 * w;
      }
      streak /= wsum;
      // only bright highlights streak; tint cool like an anamorphic lens
      float luma = dot(streak, vec3(0.2126, 0.7152, 0.0722));
      streak *= smoothstep(0.55, 1.0, luma);
      col += streak * uFlare * vec3(0.65, 0.85, 1.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Anime outline — edge detection on a dedicated depth pre-pass. Because the
// depth buffer is rendered for this frame only, outlines follow skinned
// characters, keyframed motion and imported GLB models exactly.
const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uNear: { value: 0.1 }, uFar: { value: 200 },
    uStrength: { value: 1.0 }, uWidth: { value: 1.6 },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uColor: { value: new THREE.Color('#141019') },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth;
    uniform float uNear, uFar, uStrength, uWidth;
    uniform vec2 uRes;
    uniform vec3 uColor;
    varying vec2 vUv;
    float distAt(vec2 uv){
      float d = texture2D(tDepth, uv).x;
      if (d >= 1.0) return 1e6; // clear / background
      return (uNear * uFar) / (uFar - d * (uFar - uNear)); // view distance
    }
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float d0 = distAt(vUv);
      if (d0 > 9e5) { gl_FragColor = vec4(col, 1.0); return; }
      vec2 px = uWidth / uRes;
      float e = 0.0;
      // 8-tap ring: relative depth discontinuity => ink line
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853981634;
        vec2 o = vec2(cos(a), sin(a)) * px;
        float d = distAt(vUv + o);
        e = max(e, abs(d - d0) / (d0 * 0.045 + 0.06));
      }
      float line = smoothstep(0.9, 2.2, e) * clamp(uStrength, 0.0, 2.0);
      col = mix(col, uColor, clamp(line, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// stepped gradient ramp for MeshToonMaterial (nearest filtering = hard steps)
function rampTexture(steps) {
  const ramps = {
    2: [95, 255], 3: [60, 150, 255], 4: [42, 108, 186, 255], 5: [30, 80, 140, 205, 255],
  };
  const values = ramps[steps] || ramps[3];
  const tex = new THREE.DataTexture(new Uint8Array(values), values.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createLookEngine(renderer, scene, camera) {
  let composer = null, gradePass = null, bloomPass = null, bokehPass = null, flarePass = null, outlinePass = null;
  let envTexture = null, envOn = false;
  const clock = new THREE.Clock();
  let depthRT = null, depthMat = null;
  let style = 'film', toonSteps = 3; // current applied style (survives syncSceneObjects)

  function build() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bokehPass = new BokehPass(scene, camera, { focus: 9, aperture: 0.035, maxblur: 0.008 });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.35, 0.6, 0.82);
    composer.addPass(bloomPass);
    outlinePass = new ShaderPass(OutlineShader);
    outlinePass.enabled = false;
    composer.addPass(outlinePass);
    flarePass = new ShaderPass(FlareShader);
    composer.addPass(flarePass);
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
    composer.addPass(new OutputPass());
    depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
    syncDepthRT();
  }

  function syncDepthRT() {
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(size.x * renderer.getPixelRatio()));
    const h = Math.max(2, Math.round(size.y * renderer.getPixelRatio()));
    if (depthRT && depthRT.width === w && depthRT.height === h) return;
    depthRT?.dispose();
    depthRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    depthRT.depthTexture = new THREE.DepthTexture(w, h);
  }

  // render the scene depth only, into a private target (particles/lines hidden)
  function renderDepth() {
    syncDepthRT();
    const hidden = [];
    scene.traverse(o => {
      if ((o.isPoints || o.isLine || o.isSprite) && o.visible) { hidden.push(o); o.visible = false; }
    });
    const prevBg = scene.background;
    scene.background = null;
    scene.overrideMaterial = depthMat;
    const prevTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(depthRT);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = null;
      scene.background = prevBg;
      renderer.setRenderTarget(prevTarget);
      hidden.forEach(o => { o.visible = true; });
    }
  }

  function setEnv(on) {
    if (on === envOn) return;
    envOn = on;
    if (on) {
      if (!envTexture) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      }
      scene.environment = envTexture;
      scene.traverse(m => {
        if (m.material) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
          if (mm.isMeshStandardMaterial || mm.isMeshPhysicalMaterial) mm.envMapIntensity = 0.35;
        }
      });
    } else {
      scene.environment = null;
    }
  }

  /* ---- cel shading: swap PBR materials for stepped toon materials ---- */
  function toonFrom(src) {
    const t = new THREE.MeshToonMaterial();
    if (src.color) t.color.copy(src.color);
    if (src.map) t.map = src.map;
    t.gradientMap = rampTexture(toonSteps);
    t.transparent = src.transparent;
    t.opacity = src.opacity ?? 1;
    if (src.emissive) t.emissive.copy(src.emissive);
    t.alphaTest = src.alphaTest || 0;
    t.side = src.side;
    return t;
  }
  function setToon(on) {
    scene.traverse(m => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (on) {
        const convertible = mats.some(mm => mm && (mm.isMeshStandardMaterial));
        if (m.userData.vfToon) {
          // already toon — refresh ramp if steps changed
          if (m.userData.vfSteps !== toonSteps) {
            m.userData.vfToon.forEach(t => { t.gradientMap = rampTexture(toonSteps); t.needsUpdate = true; });
            m.userData.vfSteps = toonSteps;
          }
          return;
        }
        if (!convertible) return;
        m.userData.vfFilm = mats;
        m.userData.vfMatArray = Array.isArray(m.material);
        m.userData.vfSteps = toonSteps;
        m.userData.vfToon = mats.map(toonFrom);
        m.material = m.userData.vfMatArray ? m.userData.vfToon : m.userData.vfToon[0];
      } else if (m.userData.vfFilm) {
        m.material = m.userData.vfMatArray ? m.userData.vfFilm : m.userData.vfFilm[0];
        m.userData.vfToon?.forEach(t => t.dispose());
        m.userData.vfToon = null;
        m.userData.vfFilm = null;
      }
    });
  }
  // called by the app after scene objects are (re)built — re-applies the style
  function refreshStyle() { setToon(style === 'anime'); }

  return {
    get composer() { return composer; },
    apply(look) {
      if (!composer) build();
      const g = GRADES[look.grade] || GRADES.neutral;
      gradePass.uniforms.uContrast.value = g.contrast;
      gradePass.uniforms.uSat.value = g.sat;
      gradePass.uniforms.uWarm.value = g.warm;
      gradePass.uniforms.uLift.value.fromArray(g.lift);
      gradePass.uniforms.uGain.value.fromArray(g.gain);
      gradePass.uniforms.uVignette.value = look.vignette;
      gradePass.uniforms.uGrain.value = look.grain;
      gradePass.uniforms.uChroma.value = look.chroma;
      bloomPass.strength = look.bloom;
      bloomPass.enabled = look.bloom > 0.01;
      bokehPass.enabled = !!look.dof;
      bokehPass.uniforms.focus.value = look.focus;
      bokehPass.uniforms.aperture.value = look.aperture;
      setEnv(!!look.env && look.style !== 'anime');
      // render style: film (PBR + flares) vs anime (toon + ink outlines)
      style = look.style === 'anime' ? 'anime' : 'film';
      if (look.style === 'anime') toonSteps = Math.round(look.toonSteps ?? 3);
      setToon(style === 'anime');
      flarePass.enabled = style === 'film' && (look.flare ?? 0) > 0.01;
      flarePass.uniforms.uFlare.value = look.flare ?? 0;
      outlinePass.enabled = style === 'anime' && (look.outline ?? 1) > 0.01;
      outlinePass.uniforms.uStrength.value = look.outline ?? 1;
      outlinePass.uniforms.uNear.value = camera.near;
      outlinePass.uniforms.uFar.value = camera.far;
      composer.enabled = !!look.on;
    },
    // new objects get env intensity when reflections are on
    refreshEnv() { if (envOn) setEnv(false), setEnv(true); },
    refreshStyle,
    resize(w, h) {
      if (!composer) build();
      syncDepthRT();
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      outlinePass.uniforms.uRes.value.set(w * pr, h * pr);
    },
    render() {
      if (!composer) build();
      gradePass.uniforms.uTime.value = clock.getElapsedTime() % 1000;
      if (outlinePass.enabled) {
        renderDepth();
        outlinePass.uniforms.tDepth.value = depthRT.depthTexture;
      }
      if (composer.enabled) composer.render();
      else renderer.render(scene, camera);
    },
    // testing/debug hook — exposes the engine's applied style
    debug: {
      get style() { return style; },
      get outlineOn() { return !!outlinePass && outlinePass.enabled; },
      get toonCount() { let n = 0; scene.traverse(m => { if (m.isMesh && m.userData.vfToon) n++; }); return n; },
    },
  };
}
