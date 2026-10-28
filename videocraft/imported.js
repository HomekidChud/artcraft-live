import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { inspectGLB } from './film.js?v=0.7.1';

const cache = new WeakMap();
export async function loadImported(asset) {
  if (!asset?.dataURL) throw new Error('Imported model source is missing. Reimport the GLB.');
  if (!cache.has(asset)) cache.set(asset, (async () => {
    const buffer = await (await fetch(asset.dataURL)).arrayBuffer();
    inspectGLB(buffer);
    return new GLTFLoader().parseAsync(buffer, '');
  })());
  return cache.get(asset);
}
export async function importedInstance(asset) {
  const gltf = await loadImported(asset);
  const root = clone(gltf.scene);
  // Every instance owns disposable geometry/materials/textures and its cloned skeleton.
  root.traverse(o => {
    if (o.geometry) o.geometry = o.geometry.clone();
    if (o.material) {
      const copy = m => {
        const material = m.clone();
        material.userData.originalOpacity = m.opacity;
        material.userData.originalTransparent = m.transparent;
        for (const key of Object.keys(material)) if (material[key]?.isTexture) material[key] = material[key].clone();
        return material;
      };
      o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
    }
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const wrapper = new THREE.Group(), normalized = new THREE.Group();
  wrapper.add(normalized); normalized.add(root);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0.0001 ? 2 / size.y : 1;
  // Keep normalization outside animated glTF nodes, so clips targeting the
  // imported root's transforms cannot overwrite the unit conversion.
  normalized.scale.setScalar(scale);
  normalized.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
  const mixer = new THREE.AnimationMixer(root);
  const clips = gltf.animations, actions = clips.map(c => mixer.clipAction(c));
  let current = -1;
  const morphs=[],authored=new Map();let faceEnabled=false;
  root.traverse(o=>{if(o.morphTargetDictionary && o.morphTargetInfluences){morphs.push(o);authored.set(o,o.morphTargetInfluences.slice());}});
  const restoreMorphs=()=>{for(const mesh of morphs)mesh.morphTargetInfluences.splice(0,mesh.morphTargetInfluences.length,...authored.get(mesh));};
  wrapper.userData.face = (state, enabled) => {
    if(!enabled){
      if(faceEnabled)restoreMorphs();
      faceEnabled=false;return;
    }
    faceEnabled=true;
    for(const mesh of morphs)for(const [name,index] of Object.entries(mesh.morphTargetDictionary)){
      const key=name.toLowerCase().replace(/[^a-z]/g,'');
      if(['jawopen','mouthopen','visemeaa'].includes(key))mesh.morphTargetInfluences[index]=state.mouth;
      else if(['blink','eyeblinkleft','eyeblinkright'].includes(key))mesh.morphTargetInfluences[index]=state.blink;
      else if(['happy','sad','angry','surprised'].includes(key))mesh.morphTargetInfluences[index]=state.emotion===key ? 1 : 0;
    }
    wrapper.userData.facialState={...state};
  };
  wrapper.userData.animate = (motion = {}, time) => {
    // Undo our last face overlay before the mixer evaluates. Its property cache
    // may skip unchanged authored values, so a second update(0) is insufficient.
    if(faceEnabled)restoreMorphs();
    const index = Number.isInteger(Number(motion.clipIndex)) ? Number(motion.clipIndex) : -1;
    if (index !== current) { mixer.stopAllAction(); current = index; actions[index]?.reset().play(); }
    const action = actions[index], clip = clips[index];
    if (!action || !clip) return;
    action.setLoop(motion.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = true; action.enabled = true; action.paused = false;
    const local = Math.max(0, (time - (Number(motion.start) || 0)) * Math.max(0.01, Number(motion.speed) || 1) + (Number(motion.offset) || 0));
    action.time = motion.loop === false ? Math.min(local, clip.duration) : local % Math.max(0.0001, clip.duration);
    // update(0) applies an explicit absolute action time, including backwards seeks.
    mixer.update(0);
    for(const mesh of morphs)authored.set(mesh,mesh.morphTargetInfluences.slice());
  };
  wrapper.userData.disposeAnimation = () => { mixer.stopAllAction(); mixer.uncacheRoot(root); };
  return wrapper;
}
