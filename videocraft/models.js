import * as THREE from 'three';
export function buildModel(parts = []) {
  const group = new THREE.Group();
  const geometry = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
    cone: () => new THREE.ConeGeometry(0.5, 1, 24),
    torus: () => new THREE.TorusGeometry(0.4, 0.1, 12, 32),
  };
  parts.forEach(p => {
    if (!geometry[p.type]) return;
    const material = new THREE.MeshStandardMaterial({ color: p.color, roughness: p.roughness ?? 0.65, metalness: p.metalness ?? 0.05 });
    const mesh = new THREE.Mesh(geometry[p.type](), material);
    mesh.position.fromArray(p.pos); mesh.rotation.set(...p.rot.map(v => THREE.MathUtils.degToRad(v))); mesh.scale.fromArray(p.scale);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.partId = p.id;
    group.add(mesh);
  });
  return group;
}
export function disposeModel(group) {
  group?.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
}
