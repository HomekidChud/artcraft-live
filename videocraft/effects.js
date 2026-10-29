// Cinematic look engine: post-processing pipeline (grade, bloom, DoF, grain,
// vignette, chromatic aberration) + environment reflections.
// Renders through the same WebGL canvas the exporter captures, so every
// effect is baked into exported movies in both render modes.
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
    on: true, grade: 'cinematic',
    bloom: 0.35, vignette: 0.32, grain: 0.1, chroma: 0.06,
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

export function createLookEngine(renderer, scene, camera) {
  let composer = null, gradePass = null, bloomPass = null, bokehPass = null;
  let envTexture = null, envOn = false;
  const clock = new THREE.Clock();

  function build() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bokehPass = new BokehPass(scene, camera, { focus: 9, aperture: 0.035, maxblur: 0.008 });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.35, 0.6, 0.82);
    composer.addPass(bloomPass);
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
    composer.addPass(new OutputPass());
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
      setEnv(!!look.env);
      composer.enabled = !!look.on;
    },
    // new objects get env intensity when reflections are on
    refreshEnv() { if (envOn) setEnv(false), setEnv(true); },
    resize(w, h) {
      if (!composer) build();
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    render() {
      if (!composer) build();
      gradePass.uniforms.uTime.value = clock.getElapsedTime() % 1000;
      if (composer.enabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
