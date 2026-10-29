// Renderer-independent, additive production workspace data.
import { validateCharacter } from './vf-charcraft.js';
export const PART_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'torus'];
export const PRODUCTION_TABS = ['plan', 'design', 'assets', 'board', 'sound', 'delivery', 'forge'];
const text = (v, fallback = '') => typeof v === 'string' ? v.slice(0, 1000000) : fallback;
const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
const vector = (value, fallback, min, max) => fallback.map((v, i) => number(value?.[i], v, min, max));
export const makeId = p => p + '_' + Math.random().toString(36).slice(2, 10);
export function newPart(type = 'box') {
  return { id: makeId('part'), name: type[0].toUpperCase() + type.slice(1),
    type: PART_TYPES.includes(type) ? type : 'box', color: '#efb855',
    pos: [0, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], roughness: 0.65, metalness: 0.05 };
}
export function validateModel(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.parts) || !input.parts.length || input.parts.length > 100) {
    throw new Error('A model needs 1–100 primitive parts.');
  }
  const parts = input.parts.map((p, i) => {
    if (!p || !PART_TYPES.includes(p.type)) throw new Error('Unsupported model part at position ' + (i + 1));
    return { id: makeId('part'), name: text(p.name, 'Part ' + (i + 1)), type: p.type,
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#efb855',
      pos: vector(p.pos, [0, 0.5, 0], -100, 100), rot: vector(p.rot, [0, 0, 0], -360, 360),
      scale: vector(p.scale, [1, 1, 1], 0.05, 100), roughness: number(p.roughness, 0.65, 0, 1), metalness: number(p.metalness, 0.05, 0, 1) };
  });
  return { id: makeId('model'), name: text(input.name, 'Untitled model').slice(0, 120), parts };
}
export function defaultStudio() {
  return {
    plan: { logline: '', synopsis: '', genre: 'Adventure', audience: '', stage: 'Development', script: '', tasks: [] },
    models: [], draft: { name: 'Untitled model', parts: [] }, shotNotes: {}, soundNotes: '',
    forgeDraft: null, // Character Forge draft: { name, assetId, bones, parts }
  };
}
export function normalizeStudio(input) {
  const s = defaultStudio();
  if (!input || typeof input !== 'object') return s;
  for (const key of ['logline', 'synopsis', 'genre', 'audience', 'stage', 'script']) s.plan[key] = text(input.plan?.[key], s.plan[key]);
  s.plan.tasks = Array.isArray(input.plan?.tasks) ? input.plan.tasks.slice(0, 500).filter(t => t && typeof t.text === 'string').map(t => ({
    id: text(t.id, makeId('task')), text: text(t.text), done: !!t.done,
  })) : [];
  s.models = Array.isArray(input.models) ? input.models.slice(0, 300).flatMap(m => {
    try { const clean = validateModel(m); clean.id = text(m.id, clean.id); return [clean]; } catch { return []; }
  }) : [];
  // A draft may be empty; do not force a starter primitive into old projects.
  if (input.draft && Array.isArray(input.draft.parts)) {
    try {
      const clean = input.draft.parts.length ? validateModel(input.draft) : { name: text(input.draft.name, 'Untitled model'), parts: [] };
      s.draft = { name: clean.name, parts: clean.parts, assetId: text(input.draft.assetId) };
    } catch {}
  }
  if (input.shotNotes && typeof input.shotNotes === 'object' && !Array.isArray(input.shotNotes)) {
    s.shotNotes = Object.fromEntries(Object.entries(input.shotNotes).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, note]) => [key, text(note)]));
  }
  s.soundNotes = text(input.soundNotes);
  // forge draft (Character Forge): validated on load; invalid drafts are dropped
  if (input.forgeDraft && typeof input.forgeDraft === 'object' && Array.isArray(input.forgeDraft.bones)) {
    try {
      const clean = validateCharacter(input.forgeDraft);
      s.forgeDraft = { name: clean.name, assetId: text(input.forgeDraft.assetId), bones: clean.bones, parts: clean.parts };
    } catch { s.forgeDraft = null; }
  }
  return s;
}
export function hasProductionWork(studio) {
  if (!studio) return false;
  return !!(studio.models?.length || studio.draft?.parts?.length || studio.forgeDraft?.parts?.length || studio.soundNotes ||
    studio.plan?.tasks?.length || ['logline', 'synopsis', 'audience', 'script'].some(k => studio.plan?.[k]) ||
    (studio.plan?.genre && studio.plan.genre !== 'Adventure') || (studio.plan?.stage && studio.plan.stage !== 'Development') ||
    Object.values(studio.shotNotes || {}).some(Boolean));
}
export function modelInstance(asset) {
  return { id: makeId('obj'), name: asset.name, type: 'model', assetId: asset.id,
    modelParts: structuredClone(asset.parts), color: '#ffffff',
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 };
}
export function modelTemplate(kind) {
  const add = (type, name, pos, scale, color, metalness = 0.05) => ({ ...newPart(type), name, pos, scale, color, metalness });
  const templates = {
    trophy: { name: 'Champion trophy', parts: [
      add('box', 'Marble plinth', [0, 0.15, 0], [1.3, 0.3, 1], '#394457'),
      add('cylinder', 'Gold stem', [0, 0.75, 0], [0.22, 0.9, 0.22], '#efb855', 0.8),
      add('sphere', 'Gold cup', [0, 1.5, 0], [0.95, 0.65, 0.95], '#efb855', 0.8),
      { ...add('torus', 'Left handle', [-0.65, 1.5, 0], [0.55, 0.65, 0.2], '#efb855', 0.8), rot: [0, 0, 0] },
      add('torus', 'Right handle', [0.65, 1.5, 0], [0.55, 0.65, 0.2], '#efb855', 0.8),
    ] },
    podium: { name: 'Winners podium', parts: [
      add('box', 'First place', [0, 0.7, 0], [1.5, 1.4, 1.5], '#efb855'),
      add('box', 'Second place', [-1.65, 0.45, 0], [1.5, 0.9, 1.5], '#7d9cae'),
      add('box', 'Third place', [1.65, 0.3, 0], [1.5, 0.6, 1.5], '#c5835b'),
    ] },
    tree: { name: 'Studio tree', parts: [
      add('cylinder', 'Trunk', [0, 0.75, 0], [0.35, 1.5, 0.35], '#805137'),
      add('sphere', 'Canopy', [0, 2, 0], [1.8, 1.7, 1.8], '#4e8b63'),
      add('sphere', 'Side foliage', [0.7, 1.7, 0.1], [1, 1, 1], '#70985d'),
    ] },
    blank: { name: 'Untitled model', parts: [] },
  };
  return structuredClone(templates[kind] || templates.blank);
}
