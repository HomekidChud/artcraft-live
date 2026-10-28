import { newPart, makeId } from './production.js';
export const SETS = [['forest', 'Forest clearing'], ['street', 'City street'], ['interior', 'Studio apartment']];
export function createSet(kind) {
  const parts = [];
  const add = (type, name, pos, scale, color, rot = [0, 0, 0]) => parts.push({ ...newPart(type), name, pos, scale, color, rot });
  let camera, film, lighting;
  if (kind === 'forest') {
    lighting = 'sunset'; film = { ground: '#496445', background: '#a7b9a0', fog: 0.025, exposure: 1.15 };
    camera = { pos: [11, 5, 12], tgt: [0, 1.5, 0], fov: 45 };
    add('box', 'Clearing', [0, -0.08, 0], [32, 0.15, 32], '#526c48');
    add('box', 'Path', [0, 0.015, 2], [3, 0.04, 28], '#b8a17a', [0, -18, 0]);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996, r = 7 + (i % 3) * 2.5, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 3 + i % 4;
      if (x > 0 && z > 2) continue; // Keep the foreground camera approach open.
      add('cylinder', 'Tree trunk ' + i, [x, h / 2, z], [0.45, h, 0.45], '#69503a');
      add('cone', 'Tree crown ' + i, [x, h + 0.4, z], [2.8, 4, 2.8], ['#3a684b', '#477b54', '#66814b'][i % 3]);
      add('sphere', 'Rock ' + i, [x * 0.65, 0.25, z * 0.65], [0.9, 0.6, 0.7], '#7c8275');
    }
  } else if (kind === 'street') {
    lighting = 'night'; film = { ground: '#33383e', background: '#14243a', fog: 0.018, exposure: 1.25 };
    camera = { pos: [3.5, 4.5, 17], tgt: [0, 2, -3], fov: 48 };
    add('box', 'Road', [0, -0.03, 0], [10, 0.08, 36], '#343b45');
    for (const x of [-6.5, 6.5]) {
      add('box', 'Sidewalk', [x, 0.08, 0], [3, 0.16, 36], '#7e8790');
      for (let i = 0; i < 4; i++) {
        const z = -12 + i * 8, h = 5 + (i % 3) * 2;
        add('box', 'Building', [x * 1.5, h / 2, z], [4, h, 6], ['#526172', '#796e69', '#657970'][i % 3]);
        for (let floor = 0; floor < 3; floor++) for (const dz of [-1.5, 1.5])
          add('box', 'Window', [x * 1.5 - Math.sign(x) * 2.02, 1.3 + floor * 1.6, z + dz], [0.05, 0.85, 1.1], '#e5c28a');
        add('cylinder', 'Lamp post', [x, 2.5, z + 3], [0.12, 5, 0.12], '#424c57');
        add('sphere', 'Street lamp', [x, 5, z + 3], [0.5, 0.5, 0.5], '#fff0be');
      }
    }
    for (let z = -15; z <= 15; z += 5) add('box', 'Road marking', [0, 0.025, z], [0.12, 0.02, 2.5], '#d9d6bb');
  } else if (kind === 'interior') {
    lighting = 'studio'; film = { ground: '#b59372', background: '#494743', fog: 0, exposure: 1.15 };
    camera = { pos: [9, 6.5, 11], tgt: [0, 1.2, -1], fov: 43 };
    add('box', 'Wood floor', [0, -0.08, 0], [14, 0.16, 12], '#aa8563');
    add('box', 'Back wall', [0, 2.5, -6], [14, 5, 0.2], '#c6ba9f');
    add('box', 'Side wall', [-7, 2.5, 0], [0.2, 5, 12], '#9ca79d');
    add('box', 'Window frame', [-6.85, 2.8, -2], [0.15, 2.4, 3.6], '#e8d7ae');
    add('box', 'Window glass', [-6.74, 2.8, -2], [0.05, 2.1, 3.3], '#a8c7d0');
    add('box', 'Sofa base', [0, 0.55, -3], [4.6, 0.8, 1.8], '#557d78');
    add('box', 'Sofa back', [0, 1.2, -3.7], [4.6, 0.8, 0.35], '#4c706c');
    for (const x of [-2.2, 2.2]) add('box', 'Sofa arm', [x, 1, -3], [0.35, 0.9, 1.8], '#4c706c');
    add('box', 'Rug', [0, 0.02, 0], [6, 0.035, 4], '#b7684b');
    add('box', 'Coffee table', [0, 0.75, 0], [2.6, 0.15, 1.4], '#5c4837');
    for (const x of [-1, 1]) for (const z of [-0.45, 0.45]) add('cylinder', 'Table leg', [x, 0.35, z], [0.09, 0.7, 0.09], '#363c40');
    add('cylinder', 'Plant pot', [5, 0.4, -4], [0.8, 0.8, 0.8], '#c07f5d');
    add('sphere', 'House plant', [5, 1.5, -4], [1.3, 2.1, 1.3], '#4a7757');
    add('box', 'Wall artwork frame', [2, 3, -5.84], [2.5, 1.8, 0.1], '#4f5a58');
    add('box', 'Wall artwork', [2, 3, -5.76], [2.25, 1.55, 0.05], '#c99963');
  } else throw new Error('Choose a set.');
  return {
    object: { id: makeId('obj'), name: SETS.find(s => s[0] === kind)[1], type: 'model', modelParts: parts,
      color: '#ffffff', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1, locked: true },
    camera, film, lighting,
  };
}
