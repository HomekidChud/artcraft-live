// VideoCraft — draw / build / animate / make movies in the browser. ArtCraft family tool.
// v0.2 — movie studio: shots, per-shot camera, audio, fixed-res export.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildAvatar } from './avatar3d.js?v=0.7.1';
import { JOINTS, MOTIONS, cameraTracks, exportSize } from './motion.js?v=0.7.1';
import { defaultStudio, normalizeStudio, hasProductionWork, PRODUCTION_TABS, modelInstance } from './production.js?v=0.7.1';
import { buildModel } from './models.js?v=0.7.1';
import { installWorkspaceShell, createStudioWorkspaces } from './workspaces.js?v=0.7.1';
import { sampleKeys, movieIndex, locateTime, renderRange, shotFilm, fadeAmount, inspectGLB } from './film.js?v=0.7.1';
import { importedInstance, loadImported } from './imported.js?v=0.7.1';
import { renderWorld } from './film-ui.js?v=0.7.1';
import { LIGHT_RIGS, performanceSettings, samplePerformance, audioEnvelope, composeCamera } from './cinema.js?v=0.7.1';
import { renderCinemaLook, renderPerformance } from './cinema-ui.js?v=0.7.1';
import { createCinemaRenderer } from './cinema-renderer.js?v=0.7.1';
import { decodeSources, mixStereo } from './sound-render.js?v=0.7.1';
import { buildCinemaDemo, loadDemoVoice } from './cinema-demo.js?v=0.7.1';
import { askConfirm, askName } from './dialogs.js?v=0.7.1';

installWorkspaceShell();
let studioWorkspaces = null;

/* ============================================================
   Shared project model — a movie is a sequence of shots
   ============================================================ */
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

function newShot(name = 'Shot 1', duration = 5) {
  return {
    id: uid('shot'), name, duration,
    sceneObjects: [],   // per-shot 3D objects (see below)
    keyframes: {},      // [sceneObjectId][channel] -> [{t, v, ease}]
    camera: null,
    lighting: 'studio',
  };
}
function defaultProject() {
  const shot = newShot('Shot 1', 5);
  return {
    version: 2,
    name: 'Untitled movie',
    fps: 30,
    exportAspect: '16:9',
    studio: defaultStudio(),
    drawings: [],        // { id, name, dataURL } raster assets (movie-wide)
    characters: [],      // character rigs (movie-wide)
    shots: [shot],
    activeShotId: shot.id,
    audioAssets: [],     // { id, name, dataURL, duration } imported audio (movie-wide)
    audioClips: [],      // { id, assetId, start, volume } placed on the global movie timeline
    // live mirror of the ACTIVE shot (kept in sync by applyShot / setShotDuration):
    sceneObjects: shot.sceneObjects,
    keyframes: shot.keyframes,
    duration: shot.duration,
  };
}
function activeShot() { return project.shots.find(s => s.id === project.activeShotId) || project.shots[0]; }
function totalDuration() { return project.shots.reduce((a, s) => a + Math.max(0.5, s.duration), 0); }
function shotStart(idx) { let t = 0; for (let i = 0; i < idx; i++) t += Math.max(0.5, project.shots[i].duration); return t; }
function globalTime() {
  const i = Math.max(0, project.shots.indexOf(activeShot()));
  return shotStart(i) + animTime;
}
// migrate any older project shape (v1 single-animation) into the shot-based model
function migrateProject(data) {
  if (!data || typeof data !== 'object') return defaultProject();
  if (!Array.isArray(data.shots) || !data.shots.length) {
    const shot = {
      id: uid('shot'), name: 'Shot 1',
      duration: data.duration || 5,
      sceneObjects: Array.isArray(data.sceneObjects) ? data.sceneObjects : [],
      keyframes: data.keyframes || {}, camera: null,
    };
    data.shots = [shot];
  }
  data.shots.forEach(s => {
    if (!Array.isArray(s.sceneObjects)) s.sceneObjects = [];
    if (!s.keyframes || typeof s.keyframes !== 'object') s.keyframes = {};
    if (!s.duration || s.duration < 0.5) s.duration = 5;
    if (!s.name) s.name = 'Shot';
    if (s.film) s.film = shotFilm(s.film);
    s.sceneObjects.forEach(o=>{if(o.performance)o.performance=performanceSettings(o.performance);});
    // pin legacy/null camera bases so every shot has deterministic framing
    if (!s.camera) s.camera = cameraBaseSnapshot();
  });
  data.version = 2;
  data.name = data.name || 'Untitled movie';
  data.fps = data.fps || 30;
  data.exportAspect = ['16:9', '2.39:1', '9:16', '1:1'].includes(data.exportAspect) ? data.exportAspect : '16:9';
  data.drawings = Array.isArray(data.drawings) ? data.drawings : [];
  data.characters = Array.isArray(data.characters) ? data.characters : [];
  data.audioAssets = Array.isArray(data.audioAssets) ? data.audioAssets : [];
  data.audioClips = Array.isArray(data.audioClips) ? data.audioClips : [];
  data.studio = normalizeStudio(data.studio);
  if (!data.shots.some(s => s.id === data.activeShotId)) data.activeShotId = data.shots[0].id;
  return data;
}
// canonical serialization — shots own their scene/keyframe data; no mirror duplication
function serializeProject() {
  return {
    version: 2, name: project.name, fps: project.fps, exportAspect: project.exportAspect,
    drawings: project.drawings, characters: project.characters,
    shots: project.shots, activeShotId: project.activeShotId,
    audioAssets: project.audioAssets, audioClips: project.audioClips,
    studio: project.studio,
  };
}
function loadProjectData(data) {
  project = migrateProject(data);
  const s = activeShot();
  project.sceneObjects = s.sceneObjects;
  project.keyframes = s.keyframes;
  project.duration = s.duration;
}
// sceneObject:
// { id, name, type: 'box'|'sphere'|'cylinder'|'cone'|'torus'|'plane'|'engineKit'|'drawing'|'character',
//   color, pos:[x,y,z], rot:[x,y,z] (deg), scale:[x,y,z], opacity, assetId?, enginePart? }

// character rig (all in rig units, canvas 500x500):
// {
//   id, name,
//   headY, headR, headColor, hairStyle ('flat'|'side'|'spiky'|'bald'), hairColor,
//   eyes: 'round'|'happy'|'wink'|'dizzy', eyeColor, pupilColor, browStyle: 'none'|'flat'|'raised'|'angry',
//   nose: bool, mouth: 'smile'|'grin'|'open'|'flat'|'sad',
//   torsoW, torsoH, torsoColor, legsW, legsH, legsColor, feetColor,
//   armW, armLen, armColor, handColor,
//   pivots: { head, leftArm, rightArm, leftLeg, rightLeg } // rotation in degrees
// }
function defaultRig(name = 'Character 1') {
  return {
    id: uid('char'), name,
    headR: 52, headColor: '#f0b98c', hairStyle: 'flat', hairColor: '#3a2a1c',
    eyes: 'round', eyeColor: '#ffffff', pupilColor: '#221a12',
    browStyle: 'flat', nose: true, mouth: 'smile',
    torsoW: 92, torsoH: 120, torsoColor: '#e05d5d',
    legsW: 30, legsH: 96, legsColor: '#42506e', feetColor: '#2b2417',
    armW: 26, armLen: 96, armColor: '#f0b98c', handColor: '#f0b98c',
    pivots: { head: 0, leftArm: -12, rightArm: 12, leftLeg: -10, rightLeg: 10 },
  };
}

// ---------- persistence: try localStorage, degrade silently ----------
const storage = (() => {
  try {
    const t = '__vc_test__';
    localStorage.setItem(t, '1'); localStorage.removeItem(t);
    return localStorage;
  } catch { return null; }
})();
const SAVE_KEY = 'videocraft_project_v2';
let project = defaultProject();
let dirty = false;
let autosaveTimer = null;
function markDirty(msg) {
  dirty = true;
  const el = document.getElementById('save-state');
  if (el) el.textContent = 'Unsaved changes';
  project.characters.forEach(c => bumpRigRevision(c.id)); // 3D textures refresh on next sync
  if (storage) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        storage.setItem(SAVE_KEY, JSON.stringify(serializeProject()));
        try { storage.removeItem('videocraft_project_v1'); } catch {} // upgraded: v1 key no longer needed
        dirty = false;
        if (el) el.textContent = 'Saved automatically';
      } catch {
        // quota exceeded (usually large audio) — autosave without audio data
        try {
          const slim = serializeProject();
          slim.audioAssets = slim.audioAssets.map(a => ({ ...a, dataURL: '' }));
          storage.setItem(SAVE_KEY, JSON.stringify(slim));
          if (el) el.textContent = 'Autosaved (audio too large — use Save project)';
          project.audioAssets.forEach(a => { if (!a.dataURL) a.stripped = true; });
          renderAudioList(); // show those assets as missing
        } catch { if (el) el.textContent = 'Autosave full · use Save project to keep large 3D/audio assets'; }
      }
    }, 600);
  }
}
function loadSaved() {
  if (!storage) return;
  try {
    let raw = storage.getItem(SAVE_KEY);
    if (!raw) { // upgrade path from v1 autosaves (v1 key removed once a v2 save succeeds)
      raw = storage.getItem('videocraft_project_v1');
      if (raw) { loadProjectData(JSON.parse(raw)); markDirty(); }
      return;
    }
    if (raw) loadProjectData(JSON.parse(raw));
  } catch { /* fresh start */ }
}

function toast(msg) {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 300ms'; setTimeout(() => t.remove(), 320); }, 2600);
}

/* ============================================================
   Workspace switching
   ============================================================ */
const railBtns = [...document.querySelectorAll('.rail-btn')];
const workspaces = ['draw', 'char', 'scene', 'anim', ...PRODUCTION_TABS];
let activeWs = 'draw';

function setWorkspace(ws) {
  if (!workspaces.includes(ws)) return;
  if (recMode || exportPreparing || exportFinalizing) return;
  if (ws !== activeWs && moviePlaying) stopMovie();
  if (ws !== activeWs) setPlaying(false);
  activeWs = ws;
  railBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.ws === ws);
    if (b.dataset.ws === ws) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  workspaces.forEach(w => document.getElementById('ws-' + w).classList.toggle('active', w === ws));
  studioWorkspaces?.render(ws);
  if (ws === 'scene' || ws === 'anim') {
    resize3D();
    syncSceneObjects();
    if (!selectedId && project.sceneObjects.length) selectedId = project.sceneObjects[0].id;
    renderSceneList(); renderSceneProps(); renderAnimObjectSelect();
    renderFilmWorld();
    if (ws === 'anim') { document.getElementById('anim-object').value = selectedId || ''; renderTimeline(); }
  }
  if (ws === 'draw') syncDrawSize();
  if (ws === 'char') { renderCharList(); drawCharPreview(); }
  updatePlaybar();
  syncFilmSettings();
}
railBtns.forEach(b => b.addEventListener('click', () => setWorkspace(b.dataset.ws)));

document.getElementById('project-tag').textContent = project.name;

/* ============================================================
   Shots — a movie is an ordered list of shots; the active shot's
   data is mirrored into project.sceneObjects / keyframes / duration
   ============================================================ */
function applyShot(id) {
  if (moviePlaying) stopMovie();
  if (recMode) return;
  if (id !== project.activeShotId) captureCameraBase();
  project.activeShotId = id;
  const s = activeShot();
  project.sceneObjects = s.sceneObjects;
  project.keyframes = s.keyframes;
  project.duration = s.duration;
  selectedId = null; selectedTrack = null; selectedKey = null;
  animTime = clamp(animTime, 0, s.duration);
  if (!s.camera) s.camera = cameraBaseSnapshot(); // pin new shots to the current view
  applyCameraBase(s);
  syncSceneObjects();
  evaluateAt(animTime);
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
  renderShotsUI(); syncShotControls(); updatePlayhead();
  renderFilmWorld();
}
// snapshot the current editor camera as a shot's base framing
function cameraBaseSnapshot() {
  return {
    pos: [camera.position.x, camera.position.y, camera.position.z],
    tgt: [controls.target.x, controls.target.y, controls.target.z],
    fov: camera.fov,
  };
}
// remember the current editor camera as the active shot's base framing
function captureCameraBase() {
  const s = activeShot(); if (!s) return;
  if (Object.keys(s.keyframes?.__camera__ || {}).length) return;
  s.camera = cameraBaseSnapshot();
}
// restore a shot's base framing (used when switching, playing back and exporting)
function applyCameraBase(s) {
  applyLighting(s?.lighting || 'studio');
  if (!s || !s.camera) return false;
  camera.position.fromArray(s.camera.pos);
  controls.target.fromArray(s.camera.tgt);
  camera.fov = s.camera.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  return true;
}
// lightweight variant used mid-playback / mid-export (no UI churn)
function applyShotPlayback(id) {
  project.activeShotId = id;
  const s = activeShot();
  project.sceneObjects = s.sceneObjects;
  project.keyframes = s.keyframes;
  project.duration = s.duration;
  selectedId = null;
  if (!s.camera) s.camera = cameraBaseSnapshot(); // deterministic framing for every shot
  applyCameraBase(s);
  syncSceneObjects();
  // keep the sidebar + strip highlight on the shot that is playing
  document.querySelectorAll('#shot-list .shot-row').forEach((row, i) => {
    row.classList.toggle('active', project.shots[i] && project.shots[i].id === project.activeShotId);
  });
  document.querySelectorAll('#shot-strip .shot-chip').forEach((chip, i) => {
    chip.classList.toggle('active', project.shots[i] && project.shots[i].id === project.activeShotId);
  });
}
function syncShotControls() {
  document.getElementById('shot-lighting').value = activeShot().lighting || 'studio';
  document.getElementById('export-aspect').value = project.exportAspect || '16:9';
  const inp = document.getElementById('shot-duration');
  if (inp) inp.value = project.duration;
  const out = document.getElementById('shot-duration-out');
  if (out) out.textContent = project.duration + 's';
  const fpsOut = document.getElementById('anim-fps-out');
  if (fpsOut) fpsOut.textContent = project.fps;
  const fpsIn = document.getElementById('anim-fps');
  if (fpsIn) fpsIn.value = project.fps;
  syncFilmSettings();
}
function fmtDur(d) {
  d = Math.max(0, d);
  if (d < 60) return (Math.round(d * 10) / 10) + 's';
  const m = Math.floor(d / 60), s = Math.round(d % 60);
  return m + 'm' + (s ? ' ' + s + 's' : '');
}
function renderShotsUI() {
  const list = document.getElementById('shot-list');
  if (list) {
    list.innerHTML = '';
    project.shots.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'shot-row' + (s.id === project.activeShotId ? ' active' : '');
      const b = document.createElement('button');
      b.className = 'main';
      b.title = 'Open this shot';
      const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = i + 1;
      const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = s.name;
      const du = document.createElement('span'); du.className = 'dur'; du.textContent = fmtDur(s.duration);
      b.append(idx, nm, du);
      b.addEventListener('click', () => { if (s.id !== project.activeShotId) applyShot(s.id); });
      row.appendChild(b);
      const ren = document.createElement('button'); ren.className = 'mini'; ren.textContent = '✎'; ren.title = 'Rename shot';
      ren.addEventListener('click', async () => {
        const n = await askName('Shot name:', s.name);
        if (n !== null && n.trim()) { s.name = n.trim(); markDirty(); renderShotsUI(); }
      });
      row.appendChild(ren);
      list.appendChild(row);
    });
  }
  renderShotStrip();
}
function renderShotStrip() {
  const strip = document.getElementById('shot-strip');
  if (!strip) return;
  strip.querySelectorAll('.shot-chip').forEach(c => c.remove());
  project.shots.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'shot-chip' + (s.id === project.activeShotId ? ' active' : '');
    chip.style.flex = Math.max(0.5, s.duration);
    const nm = document.createElement('span'); nm.textContent = s.name;
    const du = document.createElement('span'); du.className = 't'; du.textContent = fmtDur(s.duration);
    chip.append(nm, du);
    chip.title = s.name + ' — ' + fmtDur(s.duration) + ' (click to open)';
    chip.addEventListener('click', () => { if (s.id !== project.activeShotId) applyShot(s.id); });
    strip.appendChild(chip);
  });
  updatePlayhead();
}
function addShot() {
  const s = newShot('Shot ' + (project.shots.length + 1), 5);
  project.shots.push(s);
  applyShot(s.id);
  markDirty();
  toast('Shot added — build its scene, then set its duration');
}
function duplicateShot() {
  const src = activeShot();
  const copy = newShot(src.name + ' copy', src.duration);
  if (src.camera) copy.camera = JSON.parse(JSON.stringify(src.camera));
  copy.lighting = src.lighting || 'studio';
  if (src.film) copy.film = structuredClone(src.film);
  copy.referenceDrawingId = src.referenceDrawingId || '';
  if (project.studio.shotNotes[src.id]) project.studio.shotNotes[copy.id] = project.studio.shotNotes[src.id];
  // regenerate object ids so the copy is fully independent
  const idMap = {};
  copy.sceneObjects = src.sceneObjects.map(o => {
    const c = JSON.parse(JSON.stringify(o));
    idMap[o.id] = c.id = uid('obj');
    return c;
  });
  copy.keyframes = {};
  Object.entries(src.keyframes).forEach(([objId, chans]) => {
    const nid = objId === CAMERA_ID ? objId : idMap[objId];
    if (!nid) return;
    copy.keyframes[nid] = JSON.parse(JSON.stringify(chans));
  });
  const idx = project.shots.indexOf(src);
  project.shots.splice(idx + 1, 0, copy);
  applyShot(copy.id);
  markDirty();
  toast('Shot duplicated');
}
function moveShot(dir) {
  const i = project.shots.indexOf(activeShot());
  const j = i + dir;
  if (j < 0 || j >= project.shots.length) return;
  [project.shots[i], project.shots[j]] = [project.shots[j], project.shots[i]];
  markDirty(); renderShotsUI();
}
async function deleteShot() {
  if (project.shots.length < 2) { toast('A movie needs at least one shot'); return; }
  const s = activeShot();
  if (!await askConfirm('Delete "' + s.name + '"?')) return;
  const idx = project.shots.indexOf(s);
  project.shots.splice(idx, 1);
  delete project.studio.shotNotes[s.id];
  applyShot(project.shots[Math.min(idx, project.shots.length - 1)].id);
  markDirty();
  toast('Shot deleted');
}
document.getElementById('btn-shot-add')?.addEventListener('click', addShot);
document.getElementById('btn-shot-dup')?.addEventListener('click', duplicateShot);
document.getElementById('btn-shot-up')?.addEventListener('click', () => moveShot(-1));
document.getElementById('btn-shot-down')?.addEventListener('click', () => moveShot(1));
document.getElementById('btn-shot-del')?.addEventListener('click', deleteShot);
document.getElementById('shot-duration')?.addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!isFinite(v) || v < 0.5) return;
  const s = activeShot();
  s.duration = v; project.duration = v;
  animTime = clamp(animTime, 0, v);
  markDirty(); renderTimeline(); updatePlayhead(); renderShotsUI();
});

/* ============================================================
   DRAW workspace
   ============================================================ */
const drawCanvas = document.getElementById('draw-canvas');
const drawCtx = drawCanvas.getContext('2d');
const DRAW_W = 1000, DRAW_H = 1000;
drawCanvas.width = DRAW_W;
drawCanvas.height = DRAW_H;
let drawTool = 'brush', brushSize = 6, brushSoft = 0, brushColor = '#2b2417';
let shapeFill = true, drawStart = null, drawSnapshot = null;
const undoStack = [];

function syncDrawSize() {
  const stage = document.getElementById('draw-stage');
  const pad = 48;
  const s = Math.min((stage.clientWidth - pad) / DRAW_W, (stage.clientHeight - pad) / DRAW_H, 1);
  drawCanvas.style.width = Math.floor(DRAW_W * s) + 'px';
  drawCanvas.style.height = Math.floor(DRAW_H * s) + 'px';
  setTimeout(() => document.getElementById('draw-hint').classList.toggle('hidden', drawCanvas.width > 0 && hasDrawn()), 100);
}
let hasDrawnFlag = false;
function hasDrawn() { return hasDrawnFlag; }

function clearDraw() {
  drawCtx.clearRect(0, 0, DRAW_W, DRAW_H);
  hasDrawnFlag = false;
  document.getElementById('draw-hint').classList.remove('hidden');
}
undoStack.push = function (img) { Array.prototype.push.call(undoStack, img); if (undoStack.length > 20) undoStack.shift(); };
function pushUndo() { undoStack.push(drawCtx.getImageData(0, 0, DRAW_W, DRAW_H)); }

const TOOLS = [
  ['brush', 'Brush', 'M16.5 3.5l4 4L7 21l-4 1 1-4z'],
  ['eraser', 'Eraser', 'M20 20H8L3 15a2 2 0 010-2.8l9-9a2 2 0 012.8 0l6 6a2 2 0 010 2.8z'],
  ['line', 'Line', 'M5 19L19 5'],
  ['rect', 'Rect', 'M4 5h16v14H4z'],
  ['ellipse', 'Ellipse', 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z'],
];
const toolsGrid = document.getElementById('draw-tools');
TOOLS.forEach(([id, label, d]) => {
  const b = document.createElement('button');
  b.className = 'tool' + (id === 'brush' ? ' active' : '');
  b.title = label; b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  b.addEventListener('click', () => {
    drawTool = id;
    toolsGrid.querySelectorAll('.tool').forEach(t => t.classList.toggle('active', t === b));
    syncDrawCursor();
  });
  toolsGrid.appendChild(b);
});
const shapesGrid = document.getElementById('draw-shapes');
['line', 'rect', 'ellipse'].forEach(id => {
  const b = document.createElement('button');
  b.className = 'tool';
  b.title = id; b.setAttribute('aria-label', 'Draw ' + id);
  const d = TOOLS.find(t => t[0] === id)[2];
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  b.addEventListener('click', () => {
    drawTool = id;
    toolsGrid.querySelectorAll('.tool').forEach(t => t.classList.toggle('active', t.dataset.tool === id));
    syncDrawCursor();
  });
  b.dataset.tool = id;
  shapesGrid.appendChild(b);
});
function syncDrawCursor() { /* cursor stays crosshair for all tools */ }

document.getElementById('brush-size').addEventListener('input', e => { brushSize = +e.target.value; document.getElementById('brush-size-out').textContent = brushSize; });
document.getElementById('brush-soft').addEventListener('input', e => { brushSoft = +e.target.value; document.getElementById('brush-soft-out').textContent = brushSoft; });
document.getElementById('brush-color').addEventListener('input', e => brushColor = e.target.value);
document.getElementById('draw-fill').addEventListener('change', e => shapeFill = e.target.checked);
document.getElementById('btn-clear').addEventListener('click', () => { pushUndo(); clearDraw(); });
document.getElementById('btn-undo').addEventListener('click', () => {
  const img = undoStack.pop();
  if (img) { drawCtx.putImageData(img, 0, 0); hasDrawnFlag = true; }
});

function drawPos(e) {
  const r = drawCanvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (DRAW_W / r.width), y: (e.clientY - r.top) * (DRAW_H / r.height) };
}
function strokeTo(p) {
  const target = drawTool === 'eraser' ? drawCtx.globalCompositeOperation === 'destination-out' : drawTool === 'brush';
  drawCtx.globalCompositeOperation = drawTool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.strokeStyle = drawTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor;
  drawCtx.fillStyle = drawCtx.strokeStyle;
  drawCtx.lineWidth = brushSize * (drawTool === 'eraser' ? 2 : 1);
  drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
  drawCtx.beginPath();
  drawCtx.arc(p.x, p.y, Math.max(brushSize / 2, 0.4), 0, Math.PI * 2);
  drawCtx.fill();
}
function lineTo(p) {
  drawCtx.strokeStyle = drawTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor;
  drawCtx.globalCompositeOperation = drawTool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.lineWidth = brushSize; drawCtx.lineCap = 'round';
}
drawCanvas.addEventListener('pointerdown', e => {
  e.target.setPointerCapture(e.pointerId);
  pushUndo();
  const p = drawPos(e);
  drawStart = p; drawSnapshot = drawCtx.getImageData(0, 0, DRAW_W, DRAW_H);
  hasDrawnFlag = true;
  document.getElementById('draw-hint').classList.add('hidden');
  if (drawTool === 'brush' || drawTool === 'eraser') {
    strokeStyleSetup();
    strokeTo(p);
  }
});
function strokeStyleSetup() {
  drawCtx.globalCompositeOperation = drawTool === 'eraser' ? 'destination-out' : 'source-over';
}
drawCanvas.addEventListener('pointermove', e => {
  if (!drawStart) return;
  const p = drawPos(e);
  if (drawTool === 'brush' || drawTool === 'eraser') {
    drawCtx.globalCompositeOperation = drawTool === 'eraser' ? 'destination-out' : 'source-over';
    drawCtx.strokeStyle = drawTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor;
    drawCtx.lineWidth = brushSize; drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
    drawCtx.beginPath();
    drawCtx.moveTo(drawStart.x, drawStart.y);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
    drawStart = p;
  } else if (drawTool === 'line' || drawTool === 'rect' || drawTool === 'ellipse') {
    drawCtx.putImageData(drawSnapshot, 0, 0);
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = brushColor; drawCtx.fillStyle = brushColor;
    drawCtx.lineWidth = Math.max(brushSize / 3, 1); drawCtx.lineCap = 'round';
    drawCtx.beginPath();
    if (drawTool === 'line') { drawCtx.moveTo(drawStart.x, drawStart.y); drawCtx.lineTo(p.x, p.y); drawCtx.stroke(); }
    if (drawTool === 'rect') { drawCtx.rect(drawStart.x, drawStart.y, p.x - drawStart.x, p.y - drawStart.y); shapeFill ? drawCtx.fill() : drawCtx.stroke(); }
    if (drawTool === 'ellipse') {
      drawCtx.ellipse((drawStart.x + p.x) / 2, (drawStart.y + p.y) / 2, Math.abs(p.x - drawStart.x) / 2, Math.abs(p.y - drawStart.y) / 2, 0, 0, Math.PI * 2);
      shapeFill ? drawCtx.fill() : drawCtx.stroke();
    }
  }
});
drawCanvas.addEventListener('pointerup', () => { drawStart = null; });

async function saveDrawingAsset() {
  if (!hasDrawnFlag) { toast('Nothing painted yet'); return; }
  const name = await askName('Asset name:', 'Drawing ' + (project.drawings.length + 1));
  if (name === null) return;
  project.drawings.push({ id: uid('draw'), name: name || 'Drawing', dataURL: drawCanvas.toDataURL('image/png') });
  markDirty(); renderAssetList();
  toast('Saved to assets — use it in the Scene workspace');
}
document.getElementById('btn-save-asset').addEventListener('click', saveDrawingAsset);

function renderAssetList() {
  const list = document.getElementById('asset-list');
  list.innerHTML = '';
  if (!project.drawings.length) { list.innerHTML = '<div class="empty-note">No drawings yet. Paint something and save it.</div>'; return; }
  project.drawings.forEach(a => {
    const div = document.createElement('div');
    div.className = 'asset-item';
    const img = new Image(); img.src = a.dataURL; img.alt = '';
    div.appendChild(img);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<div class="name">${esc(a.name)}</div><div class="kind">drawing</div>`;
    div.appendChild(meta);
    const del = document.createElement('button'); del.textContent = 'Delete'; del.setAttribute('aria-label', 'Delete ' + a.name);
    del.addEventListener('click', () => {
      project.drawings = project.drawings.filter(d => d.id !== a.id);
      removeSceneObjectsWhere(o => o.assetId === a.id);
      markDirty(); renderAssetList(); renderSceneList(); renderSceneProps(); renderAnimObjectSelect();
    });
    div.appendChild(del);
    list.appendChild(div);
  });
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ============================================================
   CHARACTER workspace — the rig renderer
   ============================================================ */
const CHAR_W = 500, CHAR_H = 500;

// Draw a rig onto a 2d context. cx is canvas x center; rig uses its own coordinate space.
function renderRig(ctx, rig, cx, cy, s = 1, forTexture = false) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const P = rig.pivots;

  // ---- legs (behind torso) ----
  const legTopY = 220; // rig units from top of 500 space? we treat cy as top
  // We define the rig in a local space where 0,0 is top-center of the figure.
  const hipY = 218, legLen = rig.legsH;
  drawLeg(ctx, rig, -1, P.leftLeg, hipY, legLen);
  drawLeg(ctx, rig, +1, P.rightLeg, hipY, legLen);

  // ---- arms (behind torso) ----
  const shoulderY = 108;
  drawArm(ctx, rig, -1, P.leftArm, shoulderY);
  drawArm(ctx, rig, +1, P.rightArm, shoulderY);

  // ---- torso ----
  const tw = rig.torsoW, th = rig.torsoH;
  ctx.fillStyle = rig.torsoColor;
  rr(ctx, -tw / 2, 96, tw, th, Math.min(tw, th) * 0.18);
  ctx.fill();

  // ---- head ----
  // head center sits just above the torso top (y=96)
  const headCY = 106 - rig.headR;
  ctx.save();
  ctx.translate(0, headCY);
  ctx.rotate(P.head * Math.PI / 180);
  ctx.fillStyle = rig.headColor;
  ctx.beginPath(); ctx.arc(0, 0, rig.headR, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = rig.hairColor;
  if (rig.hairStyle !== 'bald') {
    ctx.beginPath();
    ctx.arc(0, 0, rig.headR, Math.PI, 0); // top half
    if (rig.hairStyle === 'flat') ctx.fill();
    else if (rig.hairStyle === 'side') { ctx.fill(); rr(ctx, rig.headR * 0.55, -rig.headR * 0.55, rig.headR * 0.5, rig.headR * 0.75, 4); ctx.fill(); }
    else if (rig.hairStyle === 'spiky') {
      ctx.fill();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * rig.headR * 0.38 - 6, -rig.headR * 0.92);
        ctx.lineTo(i * rig.headR * 0.38, -rig.headR * 1.45);
        ctx.lineTo(i * rig.headR * 0.38 + 6, -rig.headR * 0.92);
        ctx.closePath(); ctx.fill();
      }
    }
  }
  // face — eyes at y -rig.headR*0.1, spread rig.headR*0.38
  const eyeY = -rig.headR * 0.08, eyeX = rig.headR * 0.38, eyeR = rig.headR * 0.16;
  if (rig.eyes !== 'dizzy') {
    ctx.fillStyle = rig.eyeColor;
    ctx.beginPath(); ctx.arc(-eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    if (rig.eyes === 'wink') { ctx.strokeStyle = rig.pupilColor; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-eyeX - eyeR, eyeY); ctx.lineTo(-eyeX + eyeR, eyeY); ctx.stroke(); }
    else { ctx.fillStyle = rig.pupilColor; ctx.beginPath(); ctx.arc(-eyeX, eyeY, eyeR * 0.45, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = rig.eyeColor;
    ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rig.pupilColor;
    ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR * 0.45, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = rig.pupilColor; ctx.lineWidth = 2.5;
    [[-eyeX, 0], [eyeX, 0]].forEach(([x]) => {
      ctx.beginPath(); ctx.moveTo(x - eyeR, eyeY - eyeR); ctx.lineTo(x + eyeR, eyeY + eyeR);
      ctx.moveTo(x + eyeR, eyeY - eyeR); ctx.lineTo(x - eyeR, eyeY + eyeR); ctx.stroke();
    });
  }
  // brows
  if (rig.browStyle !== 'none') {
    ctx.strokeStyle = rig.hairColor; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    const by = eyeY - rig.headR * 0.28;
    ctx.beginPath();
    if (rig.browStyle === 'raised') { ctx.moveTo(-eyeX - eyeR, by - 5); ctx.lineTo(-eyeX + eyeR, by - 5); ctx.moveTo(eyeX - eyeR, by - 5); ctx.lineTo(eyeX + eyeR, by - 5); }
    else if (rig.browStyle === 'angry') { ctx.moveTo(-eyeX - eyeR, by - 4); ctx.lineTo(-eyeX + eyeR, by + 2); ctx.moveTo(eyeX - eyeR, by + 2); ctx.lineTo(eyeX + eyeR, by - 4); }
    else { ctx.moveTo(-eyeX - eyeR, by); ctx.lineTo(-eyeX + eyeR, by); ctx.moveTo(eyeX - eyeR, by); ctx.lineTo(eyeX + eyeR, by); }
    ctx.stroke();
  }
  // nose
  if (rig.nose) {
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, eyeY + 2); ctx.lineTo(0, eyeY + rig.headR * 0.22); ctx.stroke();
  }
  // mouth
  const my = rig.headR * 0.42;
  ctx.strokeStyle = '#8a4a3a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.beginPath();
  if (rig.mouth === 'smile') ctx.arc(0, my - 6, rig.headR * 0.28, 0.25 * Math.PI, 0.75 * Math.PI);
  else if (rig.mouth === 'grin') { ctx.arc(0, my - 8, rig.headR * 0.3, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); ctx.fillStyle = '#7a3b2d'; ctx.beginPath(); ctx.arc(0, my - 4, rig.headR * 0.22, 0.15 * Math.PI, 0.85 * Math.PI); ctx.fill(); }
  else if (rig.mouth === 'open') { ctx.fillStyle = '#7a3b2d'; ctx.beginPath(); ctx.ellipse(0, my, rig.headR * 0.16, rig.headR * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (rig.mouth === 'sad') ctx.arc(0, my + 10, rig.headR * 0.26, 1.2 * Math.PI, 1.8 * Math.PI);
  else { ctx.moveTo(-rig.headR * 0.22, my); ctx.lineTo(rig.headR * 0.22, my); }
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawLeg(ctx, rig, side, rotDeg, hipY, legLen) {
  ctx.save();
  ctx.translate(side * rig.torsoW * 0.26, hipY);
  ctx.rotate(rotDeg * Math.PI / 180);
  ctx.fillStyle = rig.legsColor;
  rr(ctx, -rig.legsW / 2, 0, rig.legsW, legLen, rig.legsW * 0.35);
  ctx.fill();
  // foot
  ctx.fillStyle = rig.feetColor;
  rr(ctx, -rig.legsW * 0.75 + (side < 0 ? 0 : 0), legLen - 8, rig.legsW * 1.6, 16, 7);
  ctx.fill();
  ctx.restore();
}
function drawArm(ctx, rig, side, rotDeg, shoulderY) {
  ctx.save();
  ctx.translate(side * (rig.torsoW / 2 + rig.armW * 0.18), shoulderY);
  ctx.rotate(rotDeg * Math.PI / 180);
  ctx.fillStyle = rig.armColor;
  rr(ctx, -rig.armW / 2, 0, rig.armW, rig.armLen, rig.armW * 0.45);
  ctx.fill();
  ctx.fillStyle = rig.handColor;
  ctx.beginPath(); ctx.arc(0, rig.armLen + 6, rig.armW * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ---- character workspace state ---- */
let currentCharId = null;
function currentRig() { return project.characters.find(c => c.id === currentCharId) || null; }

const charCanvas = document.getElementById('char-canvas');
const charCtx = charCanvas.getContext('2d');
function drawCharPreview() {
  const rig = currentRig();
  charCanvas.width = CHAR_W; charCanvas.height = CHAR_H;
  charCtx.clearRect(0, 0, CHAR_W, CHAR_H);
  if (!rig) {
    charCtx.fillStyle = '#6e675c';
    charCtx.font = '16px Outfit, sans-serif'; charCtx.textAlign = 'center';
    charCtx.fillText('Create a character to start', CHAR_W / 2, CHAR_H / 2);
    return;
  }
  // figure top at y=60; total height ~ head(0..~52*2)+torso 120+legs 96+feet ≈ 380
  renderRig(charCtx, rig, CHAR_W / 2, 60, 1);
  drawPivotHandles(rig);
}
const PIVOTS = [
  ['head', 'Head', 0, r => [CHAR_W / 2, 60 + 106 - r.headR]],
  ['leftArm', 'Left arm', -1, r => [CHAR_W / 2 - (r.torsoW / 2 + r.armW * 0.18), 60 + 108]],
  ['rightArm', 'Right arm', 1, r => [CHAR_W / 2 + (r.torsoW / 2 + r.armW * 0.18), 60 + 108]],
  ['leftLeg', 'Left leg', -1, r => [CHAR_W / 2 - r.torsoW * 0.26, 60 + 218]],
  ['rightLeg', 'Right leg', 1, r => [CHAR_W / 2 + r.torsoW * 0.26, 60 + 218]],
];
function drawPivotHandles(rig) {
  charCtx.strokeStyle = 'rgba(242,178,92,0.9)'; charCtx.fillStyle = 'rgba(242,178,92,0.9)';
  PIVOTS.forEach(([key]) => {
    const [x, y] = pivotPos(rig, key);
    charCtx.lineWidth = 2;
    charCtx.beginPath(); charCtx.arc(x, y, 8, 0, Math.PI * 2); charCtx.stroke();
    charCtx.beginPath(); charCtx.arc(x, y, 2, 0, Math.PI * 2); charCtx.fill();
  });
}
function pivotPos(rig, key) {
  const p = PIVOTS.find(p => p[0] === key);
  return p[3](rig);
}
// drag near a pivot rotates that part
let charDrag = null;
charCanvas.addEventListener('pointerdown', e => {
  const rig = currentRig(); if (!rig) return;
  const r = charCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CHAR_W / r.width), my = (e.clientY - r.top) * (CHAR_H / r.height);
  let best = null, bd = 46;
  PIVOTS.forEach(([key]) => {
    const [x, y] = pivotPos(rig, key);
    const d = Math.hypot(mx - x, my - y);
    if (d < bd) { bd = d; best = key; }
  });
  if (best) {
    e.target.setPointerCapture(e.pointerId);
    const [px, py] = pivotPos(rig, best);
    charDrag = { key: best, rig, startAngle: Math.atan2(my - py, mx - px), startRot: rig.pivots[best] };
    toast('Rotating ' + PIVOTS.find(p => p[0] === best)[1].toLowerCase());
  }
});
charCanvas.addEventListener('pointermove', e => {
  if (!charDrag) return;
  const r = charCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CHAR_W / r.width), my = (e.clientY - r.top) * (CHAR_H / r.height);
  const [px, py] = pivotPos(charDrag.rig, charDrag.key);
  const a = Math.atan2(my - py, mx - px);
  let d = (a - charDrag.startAngle) * 180 / Math.PI;
  charDrag.rig.pivots[charDrag.key] = clamp(charDrag.startRot + d, -160, 160);
  drawCharPreview();
});
charCanvas.addEventListener('pointerup', () => { if (charDrag) { charDrag = null; markDirty(); syncSceneObjects(); } });
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function renderCharList() {
  const list = document.getElementById('char-list');
  list.innerHTML = '';
  project.characters.forEach(c => {
    const b = document.createElement('button');
    b.className = 'char-card' + (c.id === currentCharId ? ' active' : '');
    const img = document.createElement('canvas'); img.width = 44; img.height = 44;
    const ic = img.getContext('2d');
    ic.save(); ic.translate(22, 4); ic.scale(0.09, 0.09);
    renderRig(ic, c, 0, 0, 1); ic.restore();
    b.appendChild(img);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<div class="name">${esc(c.name)}</div><div class="sub">${Object.values(c.pivots).some(v => Math.abs(v) > 15) ? 'posed' : 'idle rig'}</div>`;
    b.appendChild(meta);
    b.addEventListener('click', () => { currentCharId = c.id; renderCharList(); drawCharPreview(); renderCharProps(); });
    list.appendChild(b);
  });
}

/* ---- character property editor ---- */
const charPropsPanel = document.getElementById('char-tabs-panel');
let charTab = 'body';
document.querySelectorAll('#char-tabs button').forEach(b => b.addEventListener('click', () => {
  charTab = b.dataset.tab;
  document.querySelectorAll('#char-tabs button').forEach(x => x.classList.toggle('active', x === b));
  renderCharProps();
}));
const SKIN = ['#f0b98c', '#e3a173', '#c98a5b', '#a5673f', '#7c4a2b', '#5b3620'];
const HAIR = ['#3a2a1c', '#191511', '#6b4a2b', '#a8763e', '#d9b36a', '#8a8a8a', '#c77b9e', '#4fb3a4'];
const SHIRT = ['#e05d5d', '#f2b25c', '#4fb3a4', '#5b8dd9', '#c77b9e', '#8a8a8a', '#2b2417', '#e8e3d7'];
const PANTS = ['#42506e', '#2b2417', '#6b6b5a', '#8a4a3a', '#54545e', '#3a5a48'];

function renderCharProps() {
  const rig = currentRig();
  charPropsPanel.innerHTML = '';
  if (!rig) { charPropsPanel.innerHTML = '<div class="empty-note">No character selected.</div>'; return; }
  if (charTab === 'body') {
    addSlider('Head size', 30, 70, rig.headR, v => { rig.headR = v; });
    addSlider('Torso width', 60, 130, rig.torsoW, v => { rig.torsoW = v; });
    addSlider('Torso height', 90, 150, rig.torsoH, v => { rig.torsoH = v; });
    addSlider('Arm length', 60, 130, rig.armLen, v => { rig.armLen = v; });
    addSlider('Leg length', 70, 130, rig.legsH, v => { rig.legsH = v; });
    addSwatches('Skin', SKIN, () => rig.headColor, v => { rig.headColor = v; rig.armColor = v; rig.handColor = v; });
    addSwatches('Hair', HAIR, () => rig.hairColor, v => rig.hairColor = v);
    addSwatches('Shirt', SHIRT, () => rig.torsoColor, v => rig.torsoColor = v);
    addSwatches('Pants', PANTS, () => rig.legsColor, v => rig.legsColor = v);
    addSwatches('Shoes', SHIRT, () => rig.feetColor, v => rig.feetColor = v);
    const hairSel = addSelect('Hair style', ['flat', 'side', 'spiky', 'bald'], rig.hairStyle, v => rig.hairStyle = v);
  } else {
    const eyeSel = addSelect('Eyes', ['round', 'happy', 'wink', 'dizzy'], rig.eyes, v => rig.eyes = v);
    const browSel = addSelect('Brows', ['none', 'flat', 'raised', 'angry'], rig.browStyle, v => rig.browStyle = v);
    const mouthSel = addSelect('Mouth', ['smile', 'grin', 'open', 'flat', 'sad'], rig.mouth, v => rig.mouth = v);
    addToggle('Nose', rig.nose, v => rig.nose = v);
  }
}
function addSlider(label, min, max, val, onChange) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'field-row';
  const l = document.createElement('label'); l.textContent = label;
  const out = document.createElement('output'); out.textContent = Math.round(val);
  row.append(l, out);
  const range = document.createElement('input'); range.type = 'range'; range.min = min; range.max = max; range.value = val;
  range.addEventListener('input', () => { onChange(+range.value); out.textContent = range.value; drawCharPreview(); });
  wrap.append(row, range);
  charPropsPanel.appendChild(wrap);
}
function addSwatches(label, colors, get, set) {
  const t = document.createElement('div'); t.className = 'side-title'; t.textContent = label;
  const grid = document.createElement('div'); grid.className = 'swatches';
  colors.forEach(c => {
    const s = document.createElement('button'); s.className = 'swatch' + (get() === c ? ' active' : '');
    s.style.background = c; s.setAttribute('aria-label', label + ' ' + c);
    s.addEventListener('click', () => { set(c); drawCharPreview(); renderCharProps(); });
    grid.appendChild(s);
  });
  charPropsPanel.append(t, grid);
}
function addSelect(label, opts, val, onChange) {
  const t = document.createElement('div'); t.className = 'side-title'; t.textContent = label;
  const sel = document.createElement('select'); sel.className = 'btn'; sel.style.width = '100%';
  opts.forEach(o => { const op = document.createElement('option'); op.value = op.textContent = o; if (o === val) op.selected = true; sel.appendChild(op); });
  sel.addEventListener('change', () => { onChange(sel.value); drawCharPreview(); });
  charPropsPanel.append(t, sel);
  return sel;
}
function addToggle(label, val, onChange) {
  const l = document.createElement('label'); l.className = 'chk';
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = val;
  c.addEventListener('change', () => { onChange(c.checked); drawCharPreview(); });
  l.append(c, document.createTextNode(label));
  charPropsPanel.appendChild(l);
}

document.getElementById('btn-new-char').addEventListener('click', () => {
  const rig = defaultRig('Character ' + (project.characters.length + 1));
  project.characters.push(rig);
  currentCharId = rig.id;
  markDirty(); renderCharList(); drawCharPreview(); renderCharProps();
});
document.getElementById('btn-save-char').addEventListener('click', () => { markDirty(); toast('Character saved — add it to your scene from the Scene workspace'); });
document.getElementById('btn-char-copy').addEventListener('click', () => {
  const rig = currentRig(); if (!rig) return;
  const copy = JSON.parse(JSON.stringify(rig)); copy.id = uid('char'); copy.name = rig.name + ' copy';
  project.characters.push(copy); currentCharId = copy.id;
  markDirty(); renderCharList(); drawCharPreview(); renderCharProps();
});
document.getElementById('btn-char-delete').addEventListener('click', async () => {
  const rig = currentRig(); if (!rig) return;
  if (!await askConfirm('Delete ' + rig.name + '?')) return;
  project.characters = project.characters.filter(c => c.id !== rig.id);
  removeSceneObjectsWhere(o => o.assetId === rig.id);
  currentCharId = project.characters[0]?.id || null;
  markDirty(); renderCharList(); drawCharPreview(); renderCharProps(); renderSceneList(); renderSceneProps(); renderAnimObjectSelect();
});
document.getElementById('char-name').addEventListener('input', e => {
  const rig = currentRig(); if (!rig) return;
  rig.name = e.target.value; renderCharList(); markDirty();
});
const POSE_PRESETS = {
  'btn-preset-wave': { head: -6, leftArm: -150, rightArm: 15, leftLeg: -8, rightLeg: 8 },
  'btn-preset-walk': { head: 0, leftArm: -35, rightArm: 35, leftLeg: -28, rightLeg: 28 },
  'btn-preset-idle': { head: 0, leftArm: -12, rightArm: 12, leftLeg: -10, rightLeg: 10 },
};
Object.entries(POSE_PRESETS).forEach(([id, pose]) => {
  document.getElementById(id).addEventListener('click', () => {
    const rig = currentRig(); if (!rig) return;
    Object.assign(rig.pivots, pose); drawCharPreview(); markDirty();
  });
});

/* ============================================================
   3D — shared by Scene & Animate
   ============================================================ */
const sceneViewport = document.getElementById('scene-viewport');
const animViewport = document.getElementById('anim-viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
sceneViewport.appendChild(renderer.domElement);

const three = new THREE.Scene();
three.background = new THREE.Color('#211d18');
three.fog = new THREE.Fog('#211d18', 26, 60);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
camera.position.set(8.5, 7, 11);
const controls = new OrbitControls(camera, renderer.domElement);
const cinemaRenderer = createCinemaRenderer(renderer,three,camera);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 1.2, 0);
controls.addEventListener('end', () => {
  if (!recMode && !moviePlaying && !playing && !dragState) { captureCameraBase(); markDirty(); }
});

// lights
const ambientLight = new THREE.HemisphereLight('#fff4e0', '#3a3226', 1.15);
three.add(ambientLight);
const sun = new THREE.DirectionalLight('#ffe3b0', 1.9);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -16;
sun.shadow.camera.right = sun.shadow.camera.top = 16;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
three.add(sun);
const rimLight = new THREE.DirectionalLight('#a6c9ff', 1.5);
rimLight.position.set(-6, 5, -8);
three.add(rimLight);
function applyLighting(preset) {
  const looks = {
    studio: ['#211d18', '#ffe3b0', 1.9, '#a6c9ff', 1.1, 1.1],
    daylight: ['#9ab9ce', '#fff2d9', 2.8, '#c7e4ff', 1.2, 1.15],
    sunset: ['#493b47', '#ffb56b', 3.4, '#759eff', 2.3, 1.0],
    night: ['#101b2b', '#d3e8ff', 2.1, '#70a8ff', 3.0, 0.95],
  };
  const [bg, key, intensity, rim, rimIntensity, exposure] = looks[preset] || looks.studio;
  three.background.set(bg);
  sun.color.set(key); sun.intensity = intensity;
  rimLight.color.set(rim); rimLight.intensity = rimIntensity;
  renderer.toneMappingExposure = exposure;
  const film = activeShot().film;
  const rig=LIGHT_RIGS[film?.lightRig];
  ambientLight.intensity=rig?.ambient ?? 1.15;
  sun.position.fromArray(rig?.position || [6,10,4]);rimLight.position.fromArray(rig?.rimPosition || [-6,5,-8]);
  if(rig){sun.color.set(rig.key);sun.intensity=rig.intensity;rimLight.color.set(rig.rim);rimLight.intensity=rig.rimIntensity;}
  if (film?.background) three.background.set(film.background);
  three.fog = film?.fog > 0 ? new THREE.FogExp2(three.background, film.fog) : new THREE.Fog(three.background, 26, 60);
  if (film?.fog === 0) three.fog = null;
  if (film?.exposure != null) renderer.toneMappingExposure = film.exposure;
  if (typeof groundMat !== 'undefined') groundMat.color.set(film?.ground || '#2b2620');
}

// ground
const groundMat = new THREE.MeshStandardMaterial({ color: '#2b2620', roughness: 1 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true;
three.add(ground);
const grid = new THREE.GridHelper(40, 40, '#4a4238', '#332e27');
grid.position.y = 0.01;
three.add(grid);

// gizmo
const gizmo = new THREE.Box3Helper(new THREE.Box3(), '#f2b25c');
gizmo.visible = false;
three.add(gizmo);

// selection ring on the ground
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f2b25c', transparent: true, opacity: 0.9 }));
selRing.visible = false;
three.add(selRing);

function resize3D() {
  if (recMode) return; // never clobber the fixed export frame
  const host = activeWs === 'anim' ? animViewport : sceneViewport;
  if (!host.clientWidth) return;
  if (renderer.domElement.parentElement !== host) host.appendChild(renderer.domElement);
  const [a, b] = (project.exportAspect || '16:9').split(':').map(Number);
  const aspect = activeWs === 'anim' ? a / b : host.clientWidth / Math.max(1, host.clientHeight);
  const width = Math.min(host.clientWidth, host.clientHeight * aspect), height = width / aspect;
  const left = (host.clientWidth - width) / 2, top = (host.clientHeight - height) / 2;
  renderer.setSize(width, height, false);
  Object.assign(renderer.domElement.style, { position: 'absolute', width: width + 'px', height: height + 'px', left: left + 'px', top: top + 'px' });
  // The preview is letterboxed to the delivery aspect, not stretched to the editor pane.
  if (typeof filmOverlay !== 'undefined') Object.assign(filmOverlay.style, { inset: 'auto', width: width + 'px', height: height + 'px', left: left + 'px', top: top + 'px' });
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => resize3D()).observe(sceneViewport);
new ResizeObserver(() => resize3D()).observe(animViewport);

/* ---------- object factories ---------- */
function stdMat(color, opacity = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, transparent: opacity < 1, opacity });
}
function makeMesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const GEOMETRIES = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.55, 32, 20),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  cone: () => new THREE.ConeGeometry(0.55, 1, 32),
  torus: () => new THREE.TorusGeometry(0.45, 0.16, 20, 40),
  plane: () => new THREE.PlaneGeometry(1.4, 1),
};

// character texture renderer (canvas → texture)
const rigTexCanvas = document.createElement('canvas');
rigTexCanvas.width = rigTexCanvas.height = 256;
const rigTexCtx = rigTexCanvas.getContext('2d');
function rigTexture(rigRef) {
  rigTexCtx.clearRect(0, 0, 256, 256);
  rigTexCtx.save();
  rigTexCtx.translate(128, 28);
  rigTexCtx.scale(0.5, 0.5);
  renderRig(rigTexCtx, rigRef, 0, 0, 1);
  rigTexCtx.restore();
  const tex = new THREE.CanvasTexture(rigTexCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let drawingImageCache = {};
function drawingTexture(d) {
  let img = drawingImageCache[d.id];
  if (!img) { img = new Image(); img.src = d.dataURL; drawingImageCache[d.id] = img; }
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (img.complete && img.naturalWidth) tex.needsUpdate = true;
  img.addEventListener('load', () => { tex.needsUpdate = true; });
  return tex;
}

function build3DObject(o) {
  let group = new THREE.Group();
  if (o.type === 'imported') {
    const asset = project.studio.imports.find(a => a.id === o.assetId);
    group.userData.ready = importedInstance(asset).then(model => {
      // A shot switch may have disposed the placeholder before parsing finishes.
      if (group.userData.disposed) { disposeGroup(model); return; }
      group.add(model); group.userData.loading = false;
      delete group.userData.appliedOpacity;
      setGroupOpacity(group, o.opacity ?? 1);
      model.userData.animate?.(o.importMotion, animTime);
      updateSelectionVisuals();
    }).catch(error => { group.userData.loadError = error; group.userData.loading = false; toast(o.name + ': ' + error.message); });
    group.userData.loading = true;
  } else if (o.type === 'model') {
    group.add(buildModel(o.modelParts || []));
  } else if (o.type === 'box' || o.type === 'sphere' || o.type === 'cylinder' || o.type === 'cone' || o.type === 'torus' || o.type === 'plane') {
    group.add(makeMesh(GEOMETRIES[o.type](), stdMat(o.color, o.opacity)));
  } else if (o.type === 'engineKit') {
    buildEngineKit(group, o);
  } else if (o.type === 'drawing') {
    const d = project.drawings.find(x => x.id === o.assetId);
    if (d) {
      const tex = drawingTexture(d);
      const plane = makeMesh(new THREE.PlaneGeometry(3.2, 3.2 * (imgAspect(d) || 1)), new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.9 }));
      plane.castShadow = true;
      group.add(plane);
      group.userData.redraw = () => { plane.material.map = drawingTexture(d); plane.material.needsUpdate = true; };
    }
  } else if (o.type === 'text') {
    const plane = makeMesh(new THREE.PlaneGeometry(3.8, 0.95), new THREE.MeshStandardMaterial({ map: textTexture(o.text, o.color), transparent: true, side: THREE.DoubleSide, roughness: 0.9 }));
    group.add(plane);
    group.userData.redraw = () => { plane.material.map = textTexture(o.text, o.color); plane.material.needsUpdate = true; };
  } else if (o.type === 'character') {
    const rig = project.characters.find(c => c.id === o.assetId);
    if (rig && o.rigMode === '3d') {
      group.add(buildAvatar(rig));
    } else if (rig) {
      const plane = makeMesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: rigTexture(rig), transparent: true, side: THREE.DoubleSide, roughness: 0.85, alphaTest: 0.02 }));
      group.add(plane);
      group.userData.rigId = rig.id;
      group.userData.redraw = (poseOverride = null) => {
        const cur = project.characters.find(c => c.id === o.assetId);
        if (cur) { plane.material.map?.dispose(); plane.material.map = rigTexture(poseOverride || cur); plane.material.needsUpdate = true; }
      };
    }
  }
  group.position.fromArray(o.pos);
  group.rotation.set(...o.rot.map(r => r * Math.PI / 180));
  group.scale.fromArray(o.scale);
  group.userData.objId = o.id;
  return group;
}
function imgAspect(d) {
  const img = drawingImageCache[d.id];
  return img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
}

// text card → canvas texture (drawn into the 3D scene, so it exports with the video)
function textTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  const str = String(text || ' '); // never empty (fillText with '' throws on some paths)
  let size = 110;
  x.font = '700 ' + size + 'px Outfit, sans-serif';
  const w = x.measureText(str).width;
  if (w > 950) { size = Math.max(26, Math.floor(size * 950 / w)); x.font = '700 ' + size + 'px Outfit, sans-serif'; }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = Math.max(8, size * 0.13); x.strokeStyle = 'rgba(15,13,11,0.65)'; x.lineJoin = 'round';
  x.strokeText(str, 512, 132);
  x.fillStyle = color || '#ece7dd';
  x.fillText(str, 512, 132);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- engine kit ---------- */
function buildEngineKit(group, o) {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.75, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1 });
  const part = (geo, x, y, z, c) => { const m = makeMesh(geo, mat(c)); m.position.set(x, y, z); group.add(m); return m; };
  if (o.enginePart === 'block') {
    part(new THREE.BoxGeometry(3.4, 1.5, 2), 0, 0.75, 0, '#5a564e');
    for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
      part(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 24), i * 0.85, 1.9, j * 0.5, '#6e6a60');
      part(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 24), i * 0.85, 2.5, j * 0.5, '#3d3a34');
    }
    part(new THREE.BoxGeometry(2.2, 0.8, 1.4), 0, 0.02, 1.6, '#4a463f'); // crankcase
  } else if (o.enginePart === 'piston') {
    part(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 24), 0, 0.25, 0, '#9aa0a8');
    part(new THREE.BoxGeometry(0.16, 1.5, 0.16), 0, -0.6, 0, '#8a8f96'); // rod
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 20), 0, -1.3, 0, '#5a564e'); // pin
  } else if (o.enginePart === 'crankshaft') {
    const shaft = part(new THREE.CylinderGeometry(0.16, 0.16, 3.4, 20), 0, 0, 0, '#6e6a60');
    shaft.rotation.z = Math.PI / 2;
    for (let i = -1; i <= 1; i++) {
      part(new THREE.BoxGeometry(0.7, 0.5, 0.22), i * 1.05, -0.18, 0, '#5a564e'); // counterweight
      part(new THREE.CylinderGeometry(0.17, 0.17, 0.7, 18), i * 1.05, 0.25, 0, '#8a8f96').rotation.z = Math.PI / 2; // crank pin
    }
  } else if (o.enginePart === 'flywheel') {
    const wheel = part(new THREE.CylinderGeometry(1.15, 1.15, 0.22, 48), 0, 0, 0, '#6e6a60');
    wheel.rotation.z = Math.PI / 2;
    part(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 20), 0, 0, 0, '#8a8f96').rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const spoke = part(new THREE.BoxGeometry(0.08, 0.14, 0.9), Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6, '#5a564e');
      spoke.lookAt(0, 0, 0);
    }
  } else if (o.enginePart === 'propeller') {
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 20), 0, 0, 0, '#5a564e').rotation.z = Math.PI / 2;
    const b1 = part(new THREE.BoxGeometry(0.16, 2.6, 0.05), 0, 0, 0, '#8a7a5c');
    const b2 = part(new THREE.BoxGeometry(2.6, 0.16, 0.05), 0, 0, 0, '#8a7a5c');
  }
}

/* ---------- scene object management ---------- */
const objectGroups = new Map(); // id -> THREE.Group
function syncSceneObjects() {
  // remove stale
  for (const [id, g] of objectGroups) {
    if (!project.sceneObjects.find(o => o.id === id)) { three.remove(g); disposeGroup(g); objectGroups.delete(id); }
  }
  // add new / refresh
  project.sceneObjects.forEach(o => {
    let g = objectGroups.get(o.id);
    const signature = JSON.stringify([o.type, o.assetId, o.enginePart, o.color, o.opacity, o.text, o.rigMode, o.modelParts,
      o.rigMode === '3d' ? project.characters.find(c => c.id === o.assetId) : null]);
    const needsRebuild = !g || g.userData.builtFrom !== signature;
    if (needsRebuild) {
      if (g) { three.remove(g); disposeGroup(g); }
      g = build3DObject(o);
      g.userData.builtFrom = signature;
      objectGroups.set(o.id, g);
      three.add(g);
    }
    // apply transform
    g.position.fromArray(o.pos);
    g.rotation.set(...o.rot.map(r => r * Math.PI / 180));
    g.scale.fromArray(o.scale);
    g.visible = o.visible !== false;
    g.traverse(m => { if (m.isMesh && o.castShadow === false) m.castShadow = false; });
    setGroupOpacity(g, o.opacity ?? 1);
    if (o.type === 'character' && g.userData.redraw && g.userData.lastRigRev !== rigRevision(o.assetId)) {
      g.userData.lastRigRev = rigRevision(o.assetId);
      g.userData.redraw();
    }
  });
  updateSelectionVisuals();
}
// free GPU memory held by a removed group (geometries, materials, textures)
function setGroupOpacity(group, value) {
  if (group.userData.appliedOpacity === value) return;
  group.userData.appliedOpacity = value;
  group.traverse(m => {
    if (!m.material) return;
    for (const material of Array.isArray(m.material) ? m.material : [m.material]) {
      material.userData.originalOpacity ??= 1;
      material.userData.originalTransparent ??= material.transparent;
      const transparent = value * material.userData.originalOpacity < 1 || material.userData.originalTransparent;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = material.userData.originalOpacity * value;
    }
  });
}
function disposeGroup(g) {
  g.userData.disposed = true;
  g.traverse(m => {
    m.userData.disposeAnimation?.();
    m.skeleton?.dispose?.();
    m.userData.skeleton?.dispose();
    m.geometry?.dispose?.();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(mm => {
        for (const value of Object.values(mm)) if (value?.isTexture) value.dispose();
        mm.dispose?.();
      });
    }
  });
}
const rigRevisions = {};
function rigRevision(id) { return rigRevisions[id] || 0; }
function bumpRigRevision(id) { rigRevisions[id] = (rigRevisions[id] || 0) + 1; }
// removes matching scene objects (and their keyframes) from every shot;
// the active shot's arrays are the live mirror, so they mutate in place.
function removeSceneObjectsWhere(pred) {
  project.shots.forEach(s => {
    for (let i = s.sceneObjects.length - 1; i >= 0; i--) {
      if (pred(s.sceneObjects[i])) {
        delete s.keyframes[s.sceneObjects[i].id];
        s.sceneObjects.splice(i, 1);
      }
    }
  });
}

/* ---------- selection & gizmo ---------- */
let selectedId = null;
let gizmoMode = 'translate';
const raycaster = new THREE.Raycaster();
function setGizmoMode(m) {
  gizmoMode = m;
  document.querySelectorAll('#gizmo-hint button').forEach(b => b.classList.toggle('active', b.dataset.gizmo === m));
  sceneViewport.classList.toggle('select-cursor', m === 'none');
}
document.querySelectorAll('#gizmo-hint button').forEach(b => b.addEventListener('click', () => setGizmoMode(b.dataset.gizmo)));
function updateSelectionVisuals() {
  const o = selObj();
  if (!o) { gizmo.visible = false; selRing.visible = false; return; }
  const g = objectGroups.get(o.id);
  if (!g || !g.visible) { gizmo.visible = false; selRing.visible = false; return; }
  const box = new THREE.Box3().setFromObject(g);
  if (box.isEmpty()) { gizmo.visible = false; selRing.visible = false; return; }
  gizmo.box.copy(box);
  gizmo.visible = true;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z) * 0.62 + 0.25;
  selRing.scale.setScalar(r);
  selRing.position.set(c.x, 0.02, c.z);
  selRing.visible = true;
}
function selObj() {
  if (selectedId === CAMERA_ID) return { id: CAMERA_ID, name: 'Shot camera', type: 'camera', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 };
  return project.sceneObjects.find(o => o.id === selectedId) || null;
}

renderer.domElement.addEventListener('pointerdown', e => {
  if (gizmoMode === 'none') {
    // click select
    const hit = pickObject(e);
    if (hit) selectObject(hit);
    return;
  }
  // dragging on empty space = orbit (default). dragging on selected object = move it.
  const hit = pickObject(e);
  if (hit === selectedId && !selObj()?.locked && selObj()?.visible !== false) {
    controls.enabled = false;
    dragState = { obj: selObj(), start: pickGround(e), mode: gizmoMode, startVals: null };
    e.target.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
  } else if (hit) {
    selectObject(hit);
  }
});
let dragState = null;
renderer.domElement.addEventListener('pointermove', e => {
  if (!dragState) return;
  const p = pickGround(e);
  if (!p) return;
  const o = dragState.obj;
  if (dragState.mode === 'translate') {
    if (!dragState.startVals) dragState.startVals = { pos: [...o.pos] };
    o.pos = [round2(dragState.startVals.pos[0] + (p.x - dragState.start.x)), dragState.startVals.pos[1], round2(dragState.startVals.pos[2] + (p.z - dragState.start.z))];
  } else if (dragState.mode === 'rotate') {
    if (!dragState.startVals) {
      dragState.startVals = { angle: Math.atan2(p.z - dragState.start.z, p.x - dragState.start.x), rot: [...o.rot] };
    }
    const a = Math.atan2(p.z - dragState.start.z, p.x - dragState.start.x);
    const d = (a - dragState.startVals.angle) * 180 / Math.PI;
    o.rot = [dragState.startVals.rot[0], round2(dragState.startVals.rot[1] + d), dragState.startVals.rot[2]];
  } else if (dragState.mode === 'scale') {
    if (!dragState.startVals) dragState.startVals = { d: 0, s: [...o.scale] };
    const d = Math.hypot(p.x - dragState.start.x, p.z - dragState.start.z);
    const f = clamp(1 + d / 6, 0.2, 5);
    o.scale = [round2(dragState.startVals.s[0] * f), round2(dragState.startVals.s[1] * f), round2(dragState.startVals.s[2] * f)];
  }
  syncSceneObjects(); renderSceneProps(); markDirty();
});
renderer.domElement.addEventListener('pointerup', () => {
  if (dragState) { dragState = null; controls.enabled = true; renderer.domElement.style.cursor = ''; markDirty(); }
});
renderer.domElement.addEventListener('pointercancel', () => {
  if (dragState) { dragState = null; controls.enabled = true; renderer.domElement.style.cursor = ''; }
});
function pickObject(e) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...objectGroups.values()], true);
  for (const h of hits) {
    let g = h.object;
    while (g && !g.userData.objId) g = g.parent;
    if (g && g.visible) return g.userData.objId;
  }
  return null;
}
function pickGround(e) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const t = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), t);
  return hit ? t : null;
}
function selectObject(id) {
  selectedId = id;
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect();
  updateSelectionVisuals();
}
function round2(v) { return Math.round(v * 100) / 100; }

// keyboard gizmo shortcuts (when scene/anim ws active)
window.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (activeWs !== 'scene' && activeWs !== 'anim') return;
  if (e.key === 'g' || e.key === 'G') setGizmoMode('translate');
  if (e.key === 'r' || e.key === 'R') setGizmoMode('rotate');
  if (e.key === 's' || e.key === 'S') setGizmoMode('scale');
  if (e.key === 'q' || e.key === 'Q') setGizmoMode('none');
});

/* ---------- scene side list ---------- */
function renderSceneList() {
  const list = document.getElementById('scene-list');
  list.innerHTML = '';
  if (!project.sceneObjects.length) {
    list.innerHTML = '<div class="empty-note">Scene is empty. Add a primitive, engine part, drawing or character below.</div>';
  }
  project.sceneObjects.forEach(o => {
    const div = document.createElement('div');
    div.className = 'scene-item' + (o.id === selectedId ? ' active' : '');
    const b = document.createElement('button');
    b.className = 'main';
    const chip = document.createElement('span'); chip.className = 'chip';
    if (o.type === 'character') {
      const rig = project.characters.find(c => c.id === o.assetId);
      if (rig) { const c = document.createElement('canvas'); c.width = c.height = 22; const ic = c.getContext('2d'); ic.save(); ic.translate(11, 0); ic.scale(0.045, 0.045); renderRig(ic, rig, 0, 0, 1); ic.restore(); chip.appendChild(c); }
    } else if (o.type === 'drawing') {
      const d = project.drawings.find(x => x.id === o.assetId);
      if (d) { const i = new Image(); i.src = d.dataURL; i.style.objectFit = 'contain'; chip.appendChild(i); }
    } else {
      chip.style.background = o.color || '#8a8f96';
    }
    b.appendChild(chip);
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = o.name;
    b.appendChild(nm);
    b.addEventListener('click', () => selectObject(o.id));
    div.appendChild(b);
    list.appendChild(div);
  });
  // add buttons
  const addRow = (label, fn) => {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', fn); list.appendChild(b);
  };
  ['box', 'sphere', 'cylinder', 'cone', 'torus'].forEach(t => {
    addRow('+ ' + t, () => addPrimitive(t));
  });
  ['block', 'piston', 'crankshaft', 'flywheel', 'propeller'].forEach(p => {
    addRow('+ ' + p, () => addEnginePart(p));
  });
  addRow('+ text card', addTextCard);
  project.drawings.forEach(d => {
    addRow('+ drawing: ' + d.name, () => addDrawingPlane(d));
  });
  project.characters.forEach(c => {
    addRow('+ ' + c.name, () => addCharacterObject(c));
  });
  project.studio.models.forEach(model => {
    addRow('+ model: ' + model.name, () => {
      const object = modelInstance(model), [x, z] = freeSpot();
      object.pos = [x, 0, z]; project.sceneObjects.push(object); syncSceneObjects(); selectObject(object.id); markDirty();
    });
  });
  project.studio.imports.forEach(asset => addRow('+ imported: ' + asset.name, () => placeImported(asset)));
}
function freeSpot() {
  const cands = [[3.2, 2.4], [-3.2, 2.4], [3.2, -2.4], [-3.2, -2.4], [0, 3.6], [0, -3.6], [5, 0], [-5, 0]];
  const taken = project.sceneObjects.map(o => [o.pos[0], o.pos[2]]);
  for (const [x, z] of cands) {
    if (!taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.8)) return [round2(x), round2(z)];
  }
  return [round2((Math.random() - 0.5) * 8), round2((Math.random() - 0.5) * 8)];
}
function addPrimitive(type) {
  const colors = ['#e05d5d', '#f2b25c', '#4fb3a4', '#5b8dd9', '#c77b9e', '#e8e3d7'];
  const o = {
    id: uid('obj'), name: type[0].toUpperCase() + type.slice(1), type,
    color: colors[project.sceneObjects.length % colors.length],
    pos: (() => { const [x, z] = freeSpot(); return [x, type === 'sphere' || type === 'torus' ? 0.6 : 0.5, z]; })(),
    rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1,
  };
  project.sceneObjects.push(o);
  syncSceneObjects();
  selectObject(o.id); markDirty();
}
function addEnginePart(part) {
  const o = {
    id: uid('obj'), name: part[0].toUpperCase() + part.slice(1), type: 'engineKit', enginePart: part,
    color: '#8a8f96', pos: (() => { const [x, z] = freeSpot(); return [x, 0, z]; })(),
    rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1,
  };
  project.sceneObjects.push(o);
  syncSceneObjects();
  selectObject(o.id); markDirty();
}
function addDrawingPlane(d) {
  const o = {
    id: uid('obj'), name: d.name, type: 'drawing', assetId: d.id,
    color: '#ffffff', pos: (() => { const [x, z] = freeSpot(); return [x, 1.7, z]; })(), rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1,
  };
  project.sceneObjects.push(o);
  syncSceneObjects();
  selectObject(o.id); markDirty();
}
function addCharacterObject(c) {
  const o = {
    id: uid('obj'), name: c.name, type: 'character', assetId: c.id,
    color: '#ffffff', rigMode: '3d', motion: { clip: 'idle', speed: 1 },
    pos: (() => { const [x, z] = freeSpot(); return [x, 0, z]; })(), rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1,
  };
  project.sceneObjects.push(o);
  syncSceneObjects();
  selectObject(o.id); markDirty();
}
function addTextCard() {
  const o = {
    id: uid('obj'), name: 'Title card', type: 'text', text: 'Your title', color: '#ece7dd',
    pos: [0, 2.5, -4], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1,
  };
  project.sceneObjects.push(o);
  syncSceneObjects();
  selectObject(o.id); markDirty();
}
document.getElementById('btn-clear-scene').addEventListener('click', async () => {
  if (!await askConfirm('Remove all objects from this shot?')) return;
  // mutate in place — this array belongs to the active shot
  project.sceneObjects.length = 0;
  for (const k in project.keyframes) delete project.keyframes[k];
  selectedId = null;
  markDirty(); renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); updateSelectionVisuals();
});

/* ---------- scene props panel ---------- */
function renderSceneProps() {
  const panel = document.getElementById('scene-props');
  panel.innerHTML = '';
  const o = selObj();
  if (!o) { panel.innerHTML = '<div class="empty-state"><b>Nothing selected</b>Click an object in the 3D view or the list.</div>'; return; }
  if (o.type === 'camera') {
    panel.innerHTML = '<div class="empty-state"><b>Shot camera</b>Orbit the 3D view to frame the shot. Then in the Animate workspace pick "Shot camera" and keyframe position, target and FOV to move it.</div>';
    return;
  }
  if (o.type === 'text') {
    const tt = document.createElement('div'); tt.className = 'side-title'; tt.textContent = 'Text';
    panel.appendChild(tt);
    const ti = document.createElement('input'); ti.className = 'btn'; ti.style.width = '100%'; ti.style.textAlign = 'left';
    ti.value = o.text; ti.setAttribute('aria-label', 'Card text');
    ti.addEventListener('input', () => { o.text = ti.value; syncSceneObjects(); markDirty(); });
    panel.appendChild(ti);
    const ct = document.createElement('div'); ct.className = 'side-title'; ct.textContent = 'Text color';
    panel.appendChild(ct);
    const ci = document.createElement('input'); ci.type = 'color'; ci.value = o.color;
    ci.addEventListener('input', () => { o.color = ci.value; syncSceneObjects(); markDirty(); });
    panel.appendChild(ci);
  }
  if (o.type === 'character') renderActorControls(panel, o);
  if (o.type === 'imported') renderImportedControls(panel, o);
  if(['character','imported'].includes(o.type))renderPerformanceTools(panel,o);
  const frame = document.createElement('button'); frame.className = 'btn'; frame.textContent = 'Frame selected object';
  frame.addEventListener('click', () => {
    const group = objectGroups.get(o.id); if (!group) return;
    const box = new THREE.Box3().setFromObject(group); if (box.isEmpty()) return toast('The model is still loading.');
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const half = Math.max(size.y, size.x / camera.aspect, size.z) / 2;
    const distance = Math.max(1, half / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.4);
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center).addScaledVector(direction, distance); controls.target.copy(center); controls.update();
    captureCameraBase(); markDirty();
    if (Object.keys(project.keyframes[CAMERA_ID] || {}).length) toast('Object framed for editing. Existing camera animation is unchanged.');
  }); panel.append(frame);
  if (o.type === 'model') {
    const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'Copy parts to Design';
    edit.addEventListener('click', async () => {
      if (project.studio.draft.parts.length && !await askConfirm('Replace the current design draft? Save it to Assets first to keep it.')) return;
      project.studio.draft = { name: o.name, parts: structuredClone(o.modelParts || []) };
      markDirty(); setWorkspace('design');
      toast('Parts copied. Save a reusable model to Assets; the original shot instance is unchanged.');
    }); panel.append(edit);
  }
  const t = document.createElement('div'); t.className = 'side-title'; t.textContent = 'Name';
  panel.appendChild(t);
  const nameIn = document.createElement('input'); nameIn.className = 'btn'; nameIn.style.width = '100%'; nameIn.style.textAlign = 'left';
  nameIn.value = o.name;
  nameIn.setAttribute('aria-label', 'Object name');
  nameIn.addEventListener('input', () => { o.name = nameIn.value; renderSceneList(); renderAnimObjectSelect(); markDirty(); });
  panel.appendChild(nameIn);
  for (const [key, label, fallback] of [['visible', 'Visible in movie', true], ['locked', 'Lock viewport transforms', false]]) {
    const wrap = document.createElement('label'); wrap.className = 'film-check';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = o[key] ?? fallback;
    check.setAttribute('aria-label', label);
    check.addEventListener('change', () => { o[key] = check.checked; syncSceneObjects(); evaluateAt(animTime); markDirty(); });
    wrap.append(check, document.createTextNode(label)); panel.append(wrap);
  }

  ['x', 'y', 'z'].forEach((axis, i) => {
    panel.appendChild(mkNum('Position ' + axis, o.pos, i, v => { o.pos[i] = v; syncSceneObjects(); markDirty(); }, -20, 20, 0.1));
    panel.appendChild(mkNum('Rotation ' + axis + ' (°)', o.rot, i, v => { o.rot[i] = v; syncSceneObjects(); markDirty(); }, -180, 180, 1));
    panel.appendChild(mkNum('Scale ' + axis, o.scale, i, v => { o.scale[i] = v; syncSceneObjects(); markDirty(); }, 0.1, 8, 0.05));
  });
  if (o.type !== 'drawing' && o.type !== 'character') {
    panel.appendChild(mkNum('Opacity', o, 'opacity', v => { o.opacity = v; syncSceneObjects(); markDirty(); }, 0.05, 1, 0.05));
  }
  // channels hint
  const hint = document.createElement('div'); hint.className = 'empty-note';
  hint.textContent = 'Transforms set here are the object\'s base pose. Keyframes in the Animate workspace override them while playing.';
  panel.appendChild(hint);

  const dup = document.createElement('button'); dup.className = 'btn'; dup.textContent = 'Duplicate';
  dup.addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(o)); copy.id = uid('obj');
    copy.pos = [copy.pos[0] + 1, copy.pos[1], copy.pos[2] + 1];
    if (project.keyframes[o.id]) project.keyframes[copy.id] = structuredClone(project.keyframes[o.id]);
    project.sceneObjects.push(copy); syncSceneObjects(); selectObject(copy.id); markDirty();
  });
  panel.appendChild(dup);
  const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'Delete';
  del.addEventListener('click', () => {
    removeSceneObjectsWhere(x => x.id === o.id);
    selectedId = null;
    markDirty(); renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); updateSelectionVisuals();
  });
  panel.appendChild(del);
}
function mkNum(label, arr, key, onChange, min, max, step) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'field-row';
  const l = document.createElement('label'); l.textContent = label;
  const out = document.createElement('output'); out.textContent = typeof key === 'number' ? arr[key] : arr[key];
  row.append(l, out);
  const range = document.createElement('input'); range.type = 'range'; range.min = min; range.max = max; range.step = step;
  range.value = typeof key === 'number' ? arr[key] : arr[key];
  range.setAttribute('aria-label', label);
  range.addEventListener('input', () => { onChange(+range.value); out.textContent = range.value; });
  wrap.append(row, range);
  return wrap;
}

/* ============================================================
   ANIMATE — timeline & keyframes
   ============================================================ */
const tlScroll = document.getElementById('tl-scroll');
const tlCanvas = document.getElementById('tl-canvas');
const tlCtx = tlCanvas.getContext('2d');
const tlKeys = document.getElementById('tl-keys');
const tlPlayhead = document.getElementById('tl-playhead');
const tlTrackList = document.getElementById('tl-track-list');
let pxPerSec = 110;
let animTime = 0, playing = false, recMode = false;
let moviePlaying = false, movieTime = 0;
let selectedTrack = null; // sceneObject id + channel {id, ch}
let selectedKey = null; // {id, ch, index}

const CHANNELS = [
  { ch: 'pos.x', label: 'Pos X' }, { ch: 'pos.y', label: 'Pos Y' }, { ch: 'pos.z', label: 'Pos Z' },
  { ch: 'rot.x', label: 'Rotate X' }, { ch: 'rot.y', label: 'Rotate Y' }, { ch: 'rot.z', label: 'Rotate Z' },
  { ch: 'scale', label: 'Scale' },
  { ch: 'scale.x', label: 'Scale X' }, { ch: 'scale.y', label: 'Scale Y' }, { ch: 'scale.z', label: 'Scale Z' },
  { ch: 'opacity', label: 'Opacity' },
  { ch: 'pose', label: 'Character pose' },
];
const CAMERA_ID = '__camera__';
const CAM_CHANNELS = [
  { ch: 'cam.px', label: 'Cam pos X' }, { ch: 'cam.py', label: 'Cam pos Y' }, { ch: 'cam.pz', label: 'Cam pos Z' },
  { ch: 'cam.tx', label: 'Target X' }, { ch: 'cam.ty', label: 'Target Y' }, { ch: 'cam.tz', label: 'Target Z' },
  { ch: 'cam.fov', label: 'FOV' },
];
function channelsFor(o) {
  if (o?.type === 'camera') return CAM_CHANNELS;
  if (o?.rigMode === '3d') return [...CHANNELS, ...JOINTS.flatMap(j => ['x', 'y', 'z'].map(a => ({ ch: 'joint.' + j + '.' + a, label: j + ' ' + a.toUpperCase() })))];
  return CHANNELS;
}
function objChannelValue(o, ch, t) {
  const kfs = (project.keyframes[o.id] || {})[ch] || [];
  if (!kfs.length) return null;
  return sampleTrack(kfs, t);
}
const sampleTrack = sampleKeys;

// evaluateAt: the single source of truth for scrub, playback, and recording
function evaluateAt(t) {
  const T = clamp(t, 0, project.duration);
  project.sceneObjects.forEach(o => {
    const kf = project.keyframes[o.id] || {};
    const g = objectGroups.get(o.id);
    if (!g) return;
    // position
    const px = kf['pos.x']?.length ? sampleTrack(kf['pos.x'], T) : o.pos[0];
    const py = kf['pos.y']?.length ? sampleTrack(kf['pos.y'], T) : o.pos[1];
    const pz = kf['pos.z']?.length ? sampleTrack(kf['pos.z'], T) : o.pos[2];
    g.position.set(px, py, pz);
    g.rotation.set(...['x', 'y', 'z'].map((a, i) => THREE.MathUtils.degToRad(kf['rot.' + a]?.length ? sampleTrack(kf['rot.' + a], T) : o.rot[i])));
    const uniform = kf.scale?.length ? sampleTrack(kf.scale, T) : 1;
    g.scale.set(...['x', 'y', 'z'].map((a, i) => (kf['scale.' + a]?.length ? sampleTrack(kf['scale.' + a], T) : o.scale[i]) * uniform));
    g.visible = o.visible !== false;
    // opacity
    setGroupOpacity(g, kf.opacity?.length ? sampleTrack(kf.opacity, T) : o.opacity ?? 1);
    if (o.type === 'imported') g.children[0]?.userData.animate?.(o.importMotion, T);
    if (o.rigMode === '3d') {
      const joints = { ...(o.joints || {}) };
      Object.keys(kf).filter(ch => ch.startsWith('joint.') && kf[ch]?.length).forEach(ch => { joints[ch.slice(6)] = sampleTrack(kf[ch], T); });
      g.children[0]?.userData.animate?.(o.motion, T, project.duration, joints, kf.pose ? sampleTrack(kf.pose, T) : null);
    }
    if(o.rigMode==='3d' || o.type==='imported'){
      const seed=[...o.id].reduce((n,c)=>n+c.charCodeAt(0),0);
      g.children[0]?.userData.face?.(samplePerformance(o.performance,T,globalTime(),project.audioClips,seed),o.performance?.enabled);
    }
    // Legacy billboard pose: clone the asset, never mutate a shared rig.
    if (kf['pose']?.length && g.userData.redraw) {
      const rig = project.characters.find(c => c.id === o.assetId);
      if (rig) {
        const u = sampleTrack(kf['pose'], T);
        const posed = { ...rig, pivots: { ...rig.pivots } };
        applyPose(posed, u);
        g.userData.redraw(posed);
      }
    }
  });
  // ---- shot camera ----
  const ckf = project.keyframes[CAMERA_ID] || {};
  if (Object.keys(ckf).some(ch => ckf[ch] && ckf[ch].length)) {
    // unkeyed components fall back to this shot's base framing (deterministic per shot)
    const base = activeShot().camera;
    const px = ckf['cam.px'] ? sampleTrack(ckf['cam.px'], T) : (base ? base.pos[0] : camera.position.x);
    const py = ckf['cam.py'] ? sampleTrack(ckf['cam.py'], T) : (base ? base.pos[1] : camera.position.y);
    const pz = ckf['cam.pz'] ? sampleTrack(ckf['cam.pz'], T) : (base ? base.pos[2] : camera.position.z);
    camera.position.set(px, py, pz);
    const tx = ckf['cam.tx'] ? sampleTrack(ckf['cam.tx'], T) : (base ? base.tgt[0] : controls.target.x);
    const ty = ckf['cam.ty'] ? sampleTrack(ckf['cam.ty'], T) : (base ? base.tgt[1] : controls.target.y);
    const tz = ckf['cam.tz'] ? sampleTrack(ckf['cam.tz'], T) : (base ? base.tgt[2] : controls.target.z);
    controls.target.set(tx, ty, tz);
    if (ckf['cam.fov']) { camera.fov = sampleTrack(ckf['cam.fov'], T); camera.updateProjectionMatrix(); }
  }
}

// pose u in [0,1]: 0 = base, blends to swing extremes (a walk cycle)
function applyPose(rig, u) {
  const s = Math.sin(u * Math.PI * 2);
  rig.pivots.leftArm = clamp(rig._base?.leftArm ?? -12, -160, 160) - s * 30;
  rig.pivots.rightArm = clamp(rig._base?.rightArm ?? 12, -160, 160) + s * 30;
  rig.pivots.leftLeg = clamp(rig._base?.leftLeg ?? -10, -160, 160) + s * 26;
  rig.pivots.rightLeg = clamp(rig._base?.rightLeg ?? 10, -160, 160) - s * 26;
}

function renderAnimObjectSelect() {
  const actorPanel = document.getElementById('actor-tools');
  actorPanel.innerHTML = '';
  const actor = project.sceneObjects.find(o => o.id === selectedId && ['character', 'imported'].includes(o.type));
  if (actor?.type === 'imported') renderImportedControls(actorPanel, actor);
  else if (actor) renderActorControls(actorPanel, actor);
  else actorPanel.innerHTML = '<div class="empty-note">Select a character to direct its performance.</div>';
  if(actor)renderPerformanceTools(actorPanel,actor);
  const sel = document.getElementById('anim-object');
  sel.innerHTML = '';
  const camOp = document.createElement('option');
  camOp.value = CAMERA_ID;
  const camKeys = project.keyframes[CAMERA_ID] || {};
  camOp.textContent = 'Shot camera' + (Object.keys(camKeys).some(ch => (camKeys[ch] || []).length) ? ' •' : '');
  sel.appendChild(camOp);
  project.sceneObjects.forEach(o => {
    const op = document.createElement('option');
    op.value = o.id; op.textContent = o.name + (Object.keys(project.keyframes[o.id] || {}).some(ch => (project.keyframes[o.id][ch] || []).length) ? ' •' : '');
    sel.appendChild(op);
  });
  if (!project.sceneObjects.length) { /* camera option always present */ }
  // keep the dropdown in sync with the current selection after rebuild
  if (selectedId && (selectedId === CAMERA_ID || project.sceneObjects.some(o => o.id === selectedId))) sel.value = selectedId;
}
document.getElementById('anim-object').addEventListener('change', e => {
  selectObject(e.target.value);
  selectedTrack = { id: e.target.value, ch: null };
  renderTimeline();
});

function renderTimeline() {
  const trackScrollTop = tlTrackList.scrollTop;
  const editKey = selectedKey && project.keyframes[selectedKey.id]?.[selectedKey.ch]?.[selectedKey.index];
  document.getElementById('key-editor').hidden = !editKey;
  if (editKey) {
    document.getElementById('key-time').value = editKey.t;
    document.getElementById('key-value').value = editKey.v;
    document.getElementById('key-ease').value = editKey.ease || 'ease';
  }
  // track list on the left
  tlTrackList.innerHTML = '';
  const o = selObj();
  if (!o) { tlTrackList.innerHTML = '<div class="empty-note" style="padding:8px">Select an object to see its channels.</div>'; }
  else {
    channelsFor(o).forEach(c => {
      const kfs = (project.keyframes[o.id] || {})[c.ch] || [];
      const row = document.createElement('div');
      row.className = 'tl-track-label' + (kfs.length ? ' has-keys' : '') + (selectedTrack?.ch === c.ch && selectedTrack?.id === o.id ? ' active' : '');
      const dot = document.createElement('span'); dot.className = 'dotmark';
      const nm = document.createElement('span'); nm.textContent = c.label;
      row.append(dot, nm);
      row.addEventListener('click', () => {
        selectedTrack = { id: o.id, ch: c.ch };
        selectedKey = null;
        renderTimeline();
      });
      tlTrackList.appendChild(row);
    });
  }
  // the wrap spans the FULL duration (fully scrollable); the canvas only covers
  // the visible viewport and is redrawn windowed — full resolution at any zoom.
  const wrapW = Math.round(project.duration * pxPerSec) + 30;
  const wrapH = tlKeys.parentElement.clientHeight || 160;
  document.getElementById('tl-canvas-wrap').style.width = wrapW + 'px';
  document.getElementById('tl-canvas-wrap').style.height = Math.max(tlScroll.clientHeight, 26 + (o ? channelsFor(o).length : 1) * 26) + 'px';
  sizeTlCanvas();
  drawTimelineCanvas();
  renderKeys();
  updatePlayhead();
  tlTrackList.scrollTop = trackScrollTop;
}
// canvas covers only the visible viewport (moved + redrawn on scroll)
function sizeTlCanvas() {
  const viewW = Math.max(1, tlScroll.clientWidth);
  const wrapH = tlScroll.clientHeight || 160;
  tlCanvas.width = Math.round(viewW * devicePixelRatio);
  tlCanvas.height = Math.round(wrapH * devicePixelRatio);
  tlCanvas.style.width = viewW + 'px';
  tlCanvas.style.height = wrapH + 'px';
  tlCanvas.style.left = tlScroll.scrollLeft + 'px';
  tlCanvas.style.top = tlScroll.scrollTop + 'px';
}
function drawTimelineCanvas() {
  const dpr = devicePixelRatio;
  const W = tlCanvas.width / dpr, H = tlCanvas.height / dpr;
  const x0 = tlScroll.scrollLeft; // canvas left edge in wrap coordinates
  const y0 = tlScroll.scrollTop;
  tlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tlCtx.clearRect(0, 0, W, H);
  // seconds grid — only the visible window, step widens automatically so labels never collide
  const step = pxPerSec >= 200 ? 0.25 : pxPerSec >= 70 ? 0.5 : pxPerSec >= 35 ? 1 : pxPerSec >= 15 ? 2 : pxPerSec >= 7 ? 5 : 10;
  tlCtx.strokeStyle = '#332e27'; tlCtx.fillStyle = '#6e675c';
  tlCtx.font = '10px Outfit, sans-serif';
  const t0 = x0 / pxPerSec, t1 = (x0 + W) / pxPerSec;
  for (let s = Math.max(0, Math.floor(t0 / step) * step); s <= Math.min(t1, project.duration) + 0.01; s += step) {
    const x = s * pxPerSec - x0;
    tlCtx.beginPath(); tlCtx.moveTo(x, 0); tlCtx.lineTo(x, H); tlCtx.stroke();
    if (Math.abs(s % 1) < 0.01) tlCtx.fillText(s + 's', x + 3, 12);
  }
  // channel rows
  const o = selObj();
  if (!o) return;
  channelsFor(o).forEach((c, i) => {
    const y = 26 + i * 26 - y0;
    const kfs = (project.keyframes[o.id] || {})[c.ch] || [];
    // row bg
    tlCtx.fillStyle = selectedTrack?.ch === c.ch ? 'rgba(242,178,92,0.07)' : 'transparent';
    tlCtx.fillRect(0, y, W, 26);
    // value line — only across the visible window
    if (kfs.length) {
      tlCtx.strokeStyle = 'rgba(242,178,92,0.5)'; tlCtx.lineWidth = 1.5;
      tlCtx.beginPath();
      for (let px = 0; px <= W; px += 3) {
        const t = (x0 + px) / pxPerSec;
        const v = sampleTrack(kfs, t);
        const norm = channelNorm(c.ch, v, kfs);
        const yy = y + 26 - norm * 22 - 2;
        px === 0 ? tlCtx.moveTo(px, yy) : tlCtx.lineTo(px, yy);
      }
      tlCtx.stroke();
    }
  });
}
function channelNorm(ch, v, kfs) {
  const vs = kfs.map(k => k.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  if (max - min < 1e-6) return 0.5;
  return (v - min) / (max - min);
}
function renderKeys() {
  tlKeys.innerHTML = '';
  const o = selObj();
  if (!o) return;
  channelsFor(o).forEach((c, ci) => {
    const kfs = (project.keyframes[o.id] || {})[c.ch] || [];
    kfs.forEach((k, i) => {
      const el = document.createElement('div');
      el.className = 'tl-key' + (selectedKey?.ch === c.ch && selectedKey?.index === i && selectedKey?.id === o.id ? ' selected' : '');
      el.style.left = (k.t * pxPerSec) + 'px';
      el.style.top = (26 + ci * 26 + 13) + 'px';
      el.setAttribute('aria-label', 'Keyframe at ' + k.t.toFixed(2) + 's');
      el.innerHTML = '<div class="diamond"></div>';
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        selectedKey = { id: o.id, ch: c.ch, index: i };
        selectedTrack = { id: o.id, ch: c.ch };
        const startX = e.clientX, startT = k.t;
        // listeners live on window so the gesture survives renderTimeline() rebuilding the keys
        const move = ev => {
          const dx = ev.clientX - startX;
          let nt = clamp(startT + dx / pxPerSec, 0, project.duration);
          k.t = snapTime(nt);
          sortKeys(o.id, c.ch);
          selectedKey.index = kfs.indexOf(k);
          renderTimeline();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          markDirty(); renderTimeline();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        renderTimeline();
      });
      if (k.t * pxPerSec >= tlScroll.scrollLeft - 24 && k.t * pxPerSec <= tlScroll.scrollLeft + tlScroll.clientWidth + 24) tlKeys.appendChild(el);
    });
  });
}
function sortKeys(id, ch) {
  project.keyframes[id][ch].sort((a, b) => a.t - b.t);
}

function updatePlayhead() {
  const x = animTime * pxPerSec;
  tlPlayhead.style.left = x + 'px';
  const shotIdx = Math.max(0, project.shots.indexOf(activeShot()));
  document.getElementById('time-label').textContent =
    'S' + (shotIdx + 1) + ' ' + animTime.toFixed(2) + 's/' + project.duration.toFixed(1) + 's · movie ' +
    globalTime().toFixed(1) + 's/' + totalDuration().toFixed(1) + 's';
  const strip = document.getElementById('shot-strip');
  if (strip) {
    const ph = document.getElementById('shot-strip-playhead');
    if (ph) ph.style.left = (clamp(globalTime() / Math.max(0.1, totalDuration()), 0, 1) * 100) + '%';
  }
  const seek = document.getElementById('film-local-time'), globalSeek = document.getElementById('film-global-time');
  if (seek && document.activeElement !== seek) seek.value = animTime.toFixed(3);
  if (globalSeek && document.activeElement !== globalSeek) globalSeek.value = globalTime().toFixed(3);
}

// move + redraw the windowed timeline canvas as the user scrolls
let tlScrollRaf = 0;
tlScroll.addEventListener('scroll', () => {
  tlCanvas.style.left = tlScroll.scrollLeft + 'px';
  tlCanvas.style.top = tlScroll.scrollTop + 'px';
  if (Math.abs(tlTrackList.scrollTop - tlScroll.scrollTop) > 1) tlTrackList.scrollTop = tlScroll.scrollTop;
  if (!tlScrollRaf) tlScrollRaf = requestAnimationFrame(() => { tlScrollRaf = 0; drawTimelineCanvas(); renderKeys(); });
}, { passive: true });
tlTrackList.addEventListener('scroll', () => {
  if (Math.abs(tlScroll.scrollTop - tlTrackList.scrollTop) > 1) tlScroll.scrollTop = tlTrackList.scrollTop;
}, { passive: true });
window.addEventListener('resize', () => {
  if (activeWs !== 'anim' || recMode) return;
  sizeTlCanvas();
  drawTimelineCanvas();
});

// scrub
tlScroll.addEventListener('pointerdown', e => {
  if (recMode) return; // no scrubbing while exporting
  if (e.target.closest('.tl-key')) return;
  const rect = tlScroll.getBoundingClientRect();
  const setFromEvent = ev => {
    const x = ev.clientX - rect.left + tlScroll.scrollLeft;
    animTime = snapTime(clamp(x / pxPerSec, 0, project.duration));
    evaluateAt(animTime);
    updatePlayhead();
    renderKeys(); // to refresh played state
  };
  setFromEvent(e);
  tlScroll.setPointerCapture?.(e.pointerId);
  const move = ev => setFromEvent(ev);
  const up = () => {
    tlScroll.removeEventListener('pointermove', move);
    tlScroll.removeEventListener('pointerup', up);
  };
  tlScroll.addEventListener('pointermove', move);
  tlScroll.addEventListener('pointerup', up);
});
document.getElementById('tl-scroll').addEventListener('wheel', e => {
  if (e.ctrlKey) {
    e.preventDefault();
    pxPerSec = clamp(pxPerSec * (e.deltaY > 0 ? 0.9 : 1.1), 30, 400);
    renderTimeline();
  }
}, { passive: false });

/* play / pause */
const btnPlay = document.getElementById('btn-play');
function setPlaying(p) {
  if (recMode && p) return; // no manual playback while exporting
  playing = p;
  document.getElementById('icon-play').style.display = p ? 'none' : '';
  document.getElementById('icon-pause').style.display = p ? '' : 'none';
}
btnPlay.addEventListener('click', () => setPlaying(!playing));
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && activeWs === 'anim' && !recMode && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault(); setPlaying(!playing);
  }
});

/* add/delete keys */
document.getElementById('btn-key-add').addEventListener('click', () => {
  const o = selObj(); const ch = selectedTrack?.ch;
  if (!o || !ch) { toast('Select an object and a track first'); return; }
  const kf = project.keyframes[o.id] = project.keyframes[o.id] || {};
  kf[ch] = kf[ch] || [];
  const v = currentChannelValue(o, ch);
  if (ch === 'pose') {
    const rig = project.characters.find(c => c.id === o.assetId);
    if (rig && !rig._base) rig._base = { ...rig.pivots }; // capture base pose once
  }
  // upsert key at playhead
  const existing = kf[ch].find(k => Math.abs(k.t - animTime) < 0.02);
  const ease = document.getElementById('key-ease').value;
  if (existing) { existing.v = v; existing.ease = ease; }
  else kf[ch].push({ t: snapTime(animTime), v, ease });
  sortKeys(o.id, ch);
  markDirty(); renderTimeline(); renderAnimObjectSelect();
  toast('Keyframe added at ' + animTime.toFixed(2) + 's');
});
function currentChannelValue(o, ch) {
  if (ch.startsWith('joint.')) return o.joints?.[ch.slice(6)] ?? 0;
  switch (ch) {
    case 'pos.x': return o.pos[0];
    case 'pos.y': return o.pos[1];
    case 'pos.z': return o.pos[2];
    case 'rot.y': return o.rot[1];
    case 'rot.x': return o.rot[0];
    case 'rot.z': return o.rot[2];
    case 'scale': return 1;
    case 'scale.x': return o.scale[0];
    case 'scale.y': return o.scale[1];
    case 'scale.z': return o.scale[2];
    case 'opacity': return o.opacity ?? 1;
    case 'pose': return 0;
    case 'cam.px': return camera.position.x;
    case 'cam.py': return camera.position.y;
    case 'cam.pz': return camera.position.z;
    case 'cam.tx': return controls.target.x;
    case 'cam.ty': return controls.target.y;
    case 'cam.tz': return controls.target.z;
    case 'cam.fov': return camera.fov;
  }
}
function editSelectedKey() {
  const track = selectedKey && project.keyframes[selectedKey.id]?.[selectedKey.ch], key = track?.[selectedKey.index];
  if (!key) return;
  const time = +document.getElementById('key-time').value, value = +document.getElementById('key-value').value;
  if (!Number.isFinite(time) || !Number.isFinite(value)) return;
  key.t = clamp(time, 0, project.duration); key.v = value; key.ease = document.getElementById('key-ease').value;
  track.sort((a, b) => a.t - b.t); selectedKey.index = track.indexOf(key);
  evaluateAt(animTime); markDirty(); renderTimeline();
}
document.getElementById('key-time').addEventListener('change', editSelectedKey);
document.getElementById('key-value').addEventListener('change', editSelectedKey);
document.getElementById('key-ease').addEventListener('change', editSelectedKey);
document.getElementById('btn-key-del').addEventListener('click', () => {
  if (!selectedKey) { toast('Select a keyframe diamond first'); return; }
  const kf = project.keyframes[selectedKey.id]?.[selectedKey.ch];
  if (!kf) return;
  kf.splice(selectedKey.index, 1);
  selectedKey = null;
  markDirty(); renderTimeline(); renderAnimObjectSelect();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedKey && activeWs === 'anim' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      const kf = project.keyframes[selectedKey.id]?.[selectedKey.ch];
      if (kf) { kf.splice(selectedKey.index, 1); selectedKey = null; markDirty(); renderTimeline(); }
    }
  }
});
document.getElementById('btn-zoom-fit').addEventListener('click', () => {
  pxPerSec = clamp((tlScroll.clientWidth - 60) / project.duration, 0.5, 400);
  renderTimeline();
});
document.getElementById('anim-fps').addEventListener('input', e => {
  project.fps = +e.target.value;
  document.getElementById('anim-fps-out').textContent = e.target.value;
  markDirty();
});
function updatePlaybar() { updatePlayhead(); }

/* ============================================================
   Render loop
   ============================================================ */
let lastFrameTs = performance.now();
let moviePlayStart = 0, moviePlayOffset = 0; // wall-clock anchor: no drift vs audio
function tick(now) {
  requestAnimationFrame(tick);
  if (offlineRendering || exportPreparing || recMode) return; // export owns its scene and frame clock
  if (!['scene', 'anim'].includes(activeWs) && !recMode && !moviePlaying && !playing) return;
  const dt = Math.min((now - lastFrameTs) / 1000, 0.1);
  lastFrameTs = now;
  if (moviePlaying) {
    movieTime = moviePlayOffset + (performance.now() - moviePlayStart) / 1000;
    const total = totalDuration();
    if (movieTime >= total) {
      movieTime = total;
      stopMovie();
    } else {
      // find the shot that covers movieTime
      let acc = 0, idx = project.shots.length - 1;
      for (let i = 0; i < project.shots.length; i++) {
        if (movieTime < acc + Math.max(0.5, project.shots[i].duration)) { idx = i; break; }
        acc += Math.max(0.5, project.shots[i].duration);
      }
      const s = project.shots[idx];
      if (s.id !== project.activeShotId) applyShotPlayback(s.id);
      animTime = clamp(movieTime - shotStart(idx), 0, s.duration);
      evaluateAt(animTime);
      syncAudio(movieTime);
      updatePlayhead();
    }
  } else if (playing) {
    animTime += dt;
    if (animTime > project.duration) animTime = 0;
    evaluateAt(animTime);
    updatePlayhead();
    renderKeys();
  }
  if (activeWs === 'scene' && !playing && !moviePlaying && !recMode) evaluateAt(animTime);
  const cameraIsAnimated = (playing || moviePlaying || recMode) && Object.keys(project.keyframes[CAMERA_ID] || {}).length;
  controls.enabled = !recMode && !moviePlaying && !cameraIsAnimated && !dragState;
  // A damping update can overwrite an authored camera move, so don't orbit during playback.
  if (!moviePlaying && !recMode && !cameraIsAnimated) controls.update();
  else camera.lookAt(controls.target);
  grid.visible = !moviePlaying && !recMode;
  if (moviePlaying || recMode) { gizmo.visible = false; selRing.visible = false; }
  drawAxisBadge();
  renderFilmFrame();
}
const axisCanvas = document.getElementById('axis-badge');
const axisCtx = axisCanvas.getContext('2d');
function drawAxisBadge() {
  axisCtx.clearRect(0, 0, 176, 176);
  // project camera basis axes
  const axes = [
    ['X', new THREE.Vector3(1, 0, 0), '#e05d5d'],
    ['Y', new THREE.Vector3(0, 1, 0), '#7fc95e'],
    ['Z', new THREE.Vector3(0, 0, 1), '#5b8dd9'],
  ];
  const c = new THREE.Vector3(88, 88, 60);
  const p = new THREE.Vector3();
  axes.forEach(([label, dir, color]) => {
    p.copy(dir).applyQuaternion(camera.quaternion);
    const x = 88 + p.x * 52, y = 88 - p.y * 52;
    axisCtx.strokeStyle = color; axisCtx.lineWidth = 2.5;
    axisCtx.beginPath(); axisCtx.moveTo(88, 88); axisCtx.lineTo(x, y); axisCtx.stroke();
    axisCtx.fillStyle = color;
    axisCtx.beginPath(); axisCtx.arc(x, y, 9, 0, Math.PI * 2); axisCtx.fill();
    axisCtx.fillStyle = '#191714';
    axisCtx.font = '600 10px Outfit, sans-serif'; axisCtx.textAlign = 'center'; axisCtx.textBaseline = 'middle';
    axisCtx.fillText(label, x, y);
  });
}

/* ============================================================
   Audio — clips placed on the global movie timeline
   ============================================================ */
let audioCtx = null, masterGain = null, exportDest = null;
const audioNodes = new Map(); // clipId -> independent media element/gain/panner
function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.connect(audioCtx.destination);
      exportDest = audioCtx.createMediaStreamDestination(); // feeds the export stream
      masterGain.connect(exportDest);
    } catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
function audioNodeFor(assetId, clipId) {
  const asset = project.audioAssets.find(a => a.id === assetId);
  let n = audioNodes.get(clipId);
  if (n && n.source !== asset?.dataURL) { n.el.pause(); n.gain.disconnect(); n.pan?.disconnect(); audioNodes.delete(clipId); n = null; }
  if (!n) {
    if (!asset || !asset.dataURL) return null;
    const ctx = getAudioCtx();
    if (!ctx) return null;
    const el = new Audio();
    el.preload = 'auto';
    el.src = asset.dataURL;
    try {
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      src.connect(gain);
      const pan = ctx.createStereoPanner?.();
      if (pan) { gain.connect(pan); pan.connect(masterGain); } else gain.connect(masterGain);
      n = { el, gain, pan, source: asset.dataURL };
      audioNodes.set(clipId, n);
    } catch { return null; }
  }
  return n;
}
function syncAudio(t) {
  getAudioCtx();
  for (const [id, n] of audioNodes) if (!project.audioClips.some(c => c.id === id)) { n.el.pause(); n.gain.disconnect(); n.pan?.disconnect(); audioNodes.delete(id); }
  project.audioClips.forEach(clip => {
    const n = audioNodeFor(clip.assetId, clip.id); if (!n) return;
    const dur = isFinite(n.el.duration) ? n.el.duration : 0;
    const trim = Math.max(0, Number(clip.trimIn) || 0), elapsed = t - clip.start;
    const length = Math.max(0, Math.min(clip.trimDuration > 0 ? clip.trimDuration : Infinity, dur > 0 ? dur - trim : Infinity));
    const fade = (seconds, position) => seconds > 0 ? clamp(position / seconds, 0, 1) : 1;
    n.gain.gain.value = (clip.volume ?? 1) * Math.min(fade(clip.fadeIn, elapsed), fade(clip.fadeOut, length - elapsed));
    if (n.pan) n.pan.pan.value = clamp(Number(clip.pan) || 0, -1, 1);
    const local = trim + Math.max(0, elapsed);
    const should = elapsed >= 0 && elapsed < length;
    if (should) {
      if (n.el.paused) {
        try { n.el.currentTime = Math.max(0, local); } catch {}
        n.el.play().catch(() => {});
      } else if (Math.abs(n.el.currentTime - local) > 0.35) {
        try { n.el.currentTime = Math.max(0, local); } catch {}
      }
    } else if (!n.el.paused) n.el.pause();
  });
}
function stopAudio() { audioNodes.forEach(n => { try { n.el.pause(); } catch {} }); }

/* ---------- audio UI ---------- */
function renderAudioList() {
  const list = document.getElementById('audio-list');
  if (!list) return;
  list.innerHTML = '';
  if (!project.audioClips.length) {
    list.innerHTML = '<div class="empty-note">Add music or dialogue files — each clip sits on the global movie timeline (start = seconds from the beginning of the movie).</div>';
    return;
  }
  project.audioClips.forEach(clip => {
    const asset = project.audioAssets.find(a => a.id === clip.assetId);
    const row = document.createElement('div'); row.className = 'audio-row';
    const nm = document.createElement('div'); nm.className = 'an';
    nm.textContent = (asset ? asset.name : 'missing audio') + (asset && asset.duration ? ' · ' + fmtDur(asset.duration) : '');
    if (asset && !asset.dataURL) nm.textContent += ' · file missing (re-add this audio)';
    row.appendChild(nm);
    const r1 = document.createElement('div'); r1.className = 'ar';
    const l1 = document.createElement('label'); l1.textContent = 'Start (s)';
    const sIn = document.createElement('input'); sIn.type = 'number'; sIn.step = '0.1'; sIn.min = '0'; sIn.value = clip.start;
    sIn.setAttribute('aria-label', 'Clip start on movie timeline');
    sIn.addEventListener('change', () => { clip.start = Math.max(0, parseFloat(sIn.value) || 0); markDirty(); });
    r1.append(l1, sIn);
    const r2 = document.createElement('div'); r2.className = 'ar';
    const l2 = document.createElement('label'); l2.textContent = 'Volume';
    const vIn = document.createElement('input'); vIn.type = 'range'; vIn.min = '0'; vIn.max = '100'; vIn.value = Math.round((clip.volume ?? 1) * 100);
    vIn.setAttribute('aria-label', 'Clip volume');
    vIn.addEventListener('input', () => { clip.volume = vIn.value / 100; markDirty(); });
    r2.append(l2, vIn);
    const del = document.createElement('button'); del.className = 'mini'; del.textContent = '×'; del.title = 'Remove clip';
    del.addEventListener('click', () => {
      audioNodes.get(clip.id)?.el.pause();
      project.audioClips = project.audioClips.filter(c => c !== clip);
      markDirty(); renderAudioList();
    });
    row.append(r1, r2, del);
    for (const [key, label, max] of [['trimIn', 'Source in-point (s)', 86400], ['trimDuration', 'Trim duration (0 = to end)', 86400], ['fadeIn', 'Audio fade in (s)', 30], ['fadeOut', 'Audio fade out (s)', 30], ['pan', 'Stereo pan (-1 left, 1 right)', 1]]) {
      const wrap = document.createElement('label'); wrap.className = 'field-row'; wrap.textContent = label;
      const input = document.createElement('input'); input.type = 'number'; input.step = '0.1'; input.min = key === 'pan' ? -1 : 0; input.max = max;
      input.value = clip[key] || 0; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { clip[key] = clamp(Number(input.value) || 0, Number(input.min), max); markDirty(); });
      wrap.append(input); row.append(wrap);
    }
    list.appendChild(row);
  });
}
document.getElementById('btn-audio-add')?.addEventListener('click', () => document.getElementById('file-audio')?.click());
document.getElementById('file-audio')?.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataURL = reader.result;
    const probe = new Audio(); probe.preload = 'metadata'; probe.src = dataURL;
    const asset = { id: uid('aud'), name: f.name, dataURL, duration: 0 };
    probe.addEventListener('loadedmetadata', () => { asset.duration = probe.duration || 0; renderAudioList(); }, { once: true });
    project.audioAssets.push(asset);
    project.audioClips.push({ id: uid('clip'), assetId: asset.id, start: Math.round(globalTime() * 10) / 10, volume: 1 });
    markDirty(); renderAudioList();
    toast('Audio added at ' + fmtDur(globalTime()) + ' on the movie timeline');
  };
  reader.readAsDataURL(f);
  e.target.value = '';
});

/* ============================================================
   Play movie — preview the whole film, shot by shot, with sound
   ============================================================ */
function playMovie() {
  if (recMode) return;
  if (activeWs !== 'anim') setWorkspace('anim');
  setPlaying(false);
  moviePlaying = true;
  moviePlayOffset = globalTime();
  moviePlayStart = performance.now();
  movieTime = moviePlayOffset;
  if (movieTime >= totalDuration() - 0.05) {
    applyShotPlayback(project.shots[0].id); animTime = 0;
    moviePlayOffset = 0; movieTime = 0;
  }
  applyShotPlayback(activeShot().id); // apply this shot's base framing right away
  getAudioCtx(); // unlock audio with the user gesture
  const btn = document.getElementById('btn-movie');
  if (btn) { btn.textContent = 'Stop movie'; btn.classList.add('primary'); }
  syncAudio(movieTime);
}
function stopMovie() {
  moviePlaying = false;
  stopAudio();
  const btn = document.getElementById('btn-movie');
  if (btn) { btn.textContent = 'Play movie'; btn.classList.remove('primary'); }
  renderShotsUI(); syncShotControls(); updatePlayhead();
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline(); updateSelectionVisuals();
}
document.getElementById('btn-movie')?.addEventListener('click', () => { moviePlaying ? stopMovie() : playMovie(); });

// don't lose a recording to an accidental tab close
window.addEventListener('beforeunload', e => {
  if (recMode || dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================================================
   Movie export (MediaRecorder, fixed resolution, with audio)
   ============================================================ */
const recStatus = document.getElementById('rec-status');
const exportDisabled = new Map();
function lockExportControls(lock) {
  if (lock) {
    document.querySelectorAll('button, input, select').forEach(el => {
      if (el.id === 'btn-record') return;
      if (!exportDisabled.has(el)) exportDisabled.set(el, el.disabled);
      el.disabled = true;
    });
    document.getElementById('timeline').inert = true;
  } else {
    exportDisabled.forEach((disabled, el) => { el.disabled = disabled; }); exportDisabled.clear();
    document.getElementById('timeline').inert = false;
  }
}
let mediaRecorder = null, recordedChunks = [];
let recStart = 0, recHiddenTotal = 0, recHiddenSince = 0;

async function exportMovie() {
  if (offlineRendering) { offlineCancel = true; return; }
  if (recMode) { // acts as Stop while exporting — saves what was recorded
    recStatus.textContent = 'Stopping — saving partial movie…';
    finishExport(exportRestore.shotId, exportRestore.cam);
    return;
  }
  if (exportPreparing) { toast('Preparing the export…'); return; }
  if (exportFinalizing) { toast('Still saving the previous export…'); return; }
  if (!project.shots.length) { toast('Add a shot first'); return; }
  let range;
  try { range = chosenRenderRange(); } catch (e) { toast(e.message); return; }
  if (document.getElementById('export-mode').value === 'offline') return exportOfflineMovie();
  if (!window.MediaRecorder) { toast('This browser cannot record video'); return; }
  const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = mimes.find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { toast('No supported video format'); return; }
  if (activeWs !== 'anim') setWorkspace('anim');
  if (moviePlaying) stopMovie();
  setPlaying(false);
  // unlock/resume audio INSIDE the click gesture, before any await
  getAudioCtx();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

  const resSel = document.getElementById('export-res');
  const qualSel = document.getElementById('export-quality');
  const W = parseInt(resSel ? resSel.value : '1280', 10) || 1280;
  const [, H] = exportSize(W, project.exportAspect);
  const kbps = { high: 8000, medium: 4000, low: 2500 }[qualSel ? qualSel.value : 'high'] || 8000;

  const ext = mime.includes('webm') ? 'webm' : 'mp4';
  const sectionName = project.studio.delivery.mode === 'all' ? '' : `_${range.start.toFixed(2)}-${range.end.toFixed(2)}s`;
  const fileName = (project.name || 'videocraft').replace(/[^a-z0-9-_]+/gi, '_') + sectionName + '.' + ext;

  // fixed export frame — restored afterwards
  exportRestore = {
    shotId: project.activeShotId,
    animTime,
    cam: { pos: camera.position.clone(), tgt: controls.target.clone(), fov: camera.fov },
    pixelRatio: renderer.getPixelRatio(),
    gridVisible: grid.visible,
  };

  exportPreparing = true; // no second export while the picker/writable is being set up
  lockExportControls(true);
  let setupStream = null, setupWritable = null;
  try {
    // ask for the save file FIRST (inside the click gesture) so no movie time is lost to the dialog;
    // unavailable pickers can use bounded memory; explicit cancellation cancels.
    let fileHandle = null;
    if (window.showSaveFilePicker) {
      try {
        fileHandle = await showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Video', accept: { 'video/webm': ['.webm'] } }],
        });
      } catch (err) { if (err?.name === 'AbortError') throw err; }
    }
    if (!fileHandle && range.duration > 300) throw new Error('Memory exports are limited to five-minute sections. Choose a shorter range or a browser with direct-to-disk support.');

    renderer.setPixelRatio(1); // square pixels: no DPR double-sampling in the video
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    controls.enabled = false;
    grid.visible = false; gizmo.visible = false; selRing.visible = false;
    await document.fonts.ready;
    await Promise.all(project.studio.imports.map(loadImported));
    const first = shotAtGlobal(range.start);
    applyShotPlayback(first.shot.id); animTime = first.local;
    await ensureShotResources(); evaluateAt(animTime); renderFilmFrame();

    // one video track + one mixed audio track
    const tracks = [filmOutput.captureStream(project.fps).getVideoTracks()[0]];
    recordingVideoTrack = tracks[0];
    const hasAudio = project.audioClips.some(clip => project.audioAssets.some(asset => asset.id === clip.assetId));
    if (exportDest && hasAudio) tracks.push(exportDest.stream.getAudioTracks()[0]);
    const stream = new MediaStream(tracks);
    setupStream = stream;

    recordedChunks = [];
    let fsWritable = null, diskError = null, drainPromise = null;
    if (fileHandle) {
      try { fsWritable = await fileHandle.createWritable(); setupWritable = fsWritable; }
      catch (err) { if (range.duration > 300) throw err; }
    }
    const diskMode = !!fsWritable; // disk mode releases each chunk after its write succeeds
    // serialize disk writes; the running loop keeps picking up newly queued chunks
    const drain = () => {
      if (!drainPromise) drainPromise = (async () => {
        try {
          while (fsWritable && recordedChunks.length) {
            const chunk = recordedChunks[0];
            await fsWritable.write(chunk);
            recordedChunks.shift(); // memory released only after the write succeeds
          }
        } catch (err) {
          diskError = err;
          // release the file handle — the partial file is not a valid movie.
          // a committed-stream failure cannot be recovered (earlier chunks are gone),
          // so stop recording and report instead of accumulating the tail in memory.
          try { await fsWritable.abort(); } catch {}
          fsWritable = null;
          if (recMode) {
            toast('Saving to the file failed — stopping the export. Nothing was saved.');
            finishExport(exportRestore.shotId, exportRestore.cam);
          }
        }
      })().finally(() => { drainPromise = null; });
      return drainPromise;
    };
    const saveRecording = async () => {
      // a save is now pending/running regardless of who stopped the recorder:
      // if the recorder went inactive on its own (error path), finishExport armed
      // neither flag — arm here so a new export cannot replace the shared buffer mid-save
      savePending = true;
      exportFinalizing = true;
      try {
        if (diskMode) {
          await drain(); // every queued chunk is submitted before closing
          if (diskError) throw diskError; // reported below — a committed-stream failure is not recoverable
          await fsWritable.close();
          toast('Movie saved to the file you chose (' + W + '×' + H + ')');
        } else {
          const blob = new Blob(recordedChunks, { type: mime });
          downloadBlob(blob, fileName);
          toast('Movie exported (' + ext.toUpperCase() + ', ' + W + '×' + H + ') — check your downloads');
        }
      } catch (err) {
        console.error('save failed', err);
        if (diskError) toast('Could not save the recording — the write failed. Nothing was saved.');
        else toast('Could not save the recording — try again or use a shorter movie.');
      }
      savePending = false;
      exportFinalizing = false;
      lockExportControls(false);
      stream.getVideoTracks().forEach(track => track.stop());
      recordingVideoTrack = null;
      recStatus.textContent = '';
      const rBtn = document.getElementById('btn-record');
      rBtn.disabled = false; rBtn.textContent = 'Export movie';
      document.getElementById('btn-download-video').disabled = false;
    };
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: kbps * 1000, audioBitsPerSecond: 128000 });
    mediaRecorder.ondataavailable = e => { if (e.data.size) { recordedChunks.push(e.data); drain(); } };
    mediaRecorder.onerror = e => { console.error('MediaRecorder error', e.error); toast('Recorder error: ' + (e.error?.message || 'unknown')); finishExport(exportRestore.shotId, exportRestore.cam); };
    mediaRecorder.onstop = saveRecording;

    const total = range.end;

    // pre-roll: show shot 1 at t=0 so the recording starts on a real frame
    evaluateAt(first.local);
    renderFilmFrame();

    mediaRecorder.start(1000);
    recordingVideoTrack?.requestFrame?.();
    recMode = true;
    exportPreparing = false;
    recStart = performance.now(); recHiddenTotal = 0; recHiddenSince = 0;
    recStatus.textContent = 'Recording ' + W + '×' + H + ' — section plays in real time (' + fmtDur(range.duration) + '). Keep this tab visible.';
    const rBtn = document.getElementById('btn-record');
    rBtn.disabled = false; rBtn.textContent = 'Stop export';
    document.getElementById('btn-download-video').disabled = true;

    const step = async () => {
      if (!recMode) return;
      const elapsed = range.start + (performance.now() - recStart - recHiddenTotal) / 1000;
      if (elapsed >= total) { finishExport(exportRestore.shotId, exportRestore.cam); return; }
      const hit = shotAtGlobal(elapsed), s = hit.shot;
      if (s.id !== project.activeShotId) {
        applyShotPlayback(s.id);
        try { await ensureShotResources(); }
        catch (err) {
          toast('Could not load the next shot: ' + (err?.message || err));
          finishExport(exportRestore.shotId, exportRestore.cam); return;
        }
        if (!recMode) return;
      }
      animTime = hit.local;
      evaluateAt(animTime);
      camera.lookAt(controls.target); renderFilmFrame();
      syncAudio(Math.min(elapsed, total));
      updatePlayhead();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  } catch (err) {
    // setup failed — restore the editor and let the user try again
    if (err?.name !== 'AbortError') console.error('export setup failed', err);
    setupStream?.getVideoTracks().forEach(track => track.stop());
    recordingVideoTrack = null;
    if (setupWritable) { try { await setupWritable.abort(); } catch {} }
    exportPreparing = false;
    toast(err?.name === 'AbortError' ? 'Export cancelled.' : 'Could not start the export: ' + (err?.message || err));
    if (recMode) {
      finishExport(exportRestore.shotId, exportRestore.cam); // recording had started — normal teardown
    } else {
      lockExportControls(false);
      // never started: restore manually without arming the save-finalizing flag
      applyShotPlayback(exportRestore.shotId);
      renderer.setPixelRatio(exportRestore.pixelRatio);
      camera.position.copy(exportRestore.cam.pos);
      controls.target.copy(exportRestore.cam.tgt);
      camera.fov = exportRestore.cam.fov;
      camera.updateProjectionMatrix();
      controls.enabled = true; grid.visible = exportRestore.gridVisible;
      renderTimeline();
      resize3D();
    }
  }
}
let exportRestore = null;
let exportPreparing = false; // true while the picker / writable is being set up
let exportFinalizing = false; // true from recorder stop until the file is saved
let savePending = false; // a recorder stop has been issued and its save is still running
function finishExport(prevShotId, prevCam) {
  recMode = false;
  stopAudio();
  let stopped = false;
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.stop(); stopped = true; savePending = true; } } catch {}
  // finalizing stays armed while THIS recording's save is still pending (idempotent teardown:
  // a late second call with an inactive recorder must not clear the flag under a running save)
  exportFinalizing = stopped || savePending;
  // restore editor state WITHOUT capturing a camera base (a capture here would
  // overwrite the last exported shot's framing with the restored editor camera)
  applyShotPlayback(prevShotId);
  if (exportRestore) {
    grid.visible = exportRestore.gridVisible;
    renderer.setPixelRatio(exportRestore.pixelRatio);
    animTime = clamp(exportRestore.animTime, 0, activeShot().duration);
  }
  evaluateAt(animTime);
  camera.position.copy(prevCam.pos);
  controls.target.copy(prevCam.tgt);
  camera.fov = prevCam.fov;
  camera.updateProjectionMatrix();
  controls.enabled = true;
  const rBtn = document.getElementById('btn-record');
  if (rBtn.textContent === 'Stop export') rBtn.textContent = 'Export movie';
  document.getElementById('btn-download-video').disabled = false;
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline(); renderShotsUI();
  resize3D(); // recomputes aspect + canvas size from the host element
}
// pause while the tab is hidden (rAF stops; recording would desync)
document.addEventListener('visibilitychange', () => {
  if (!recMode || !mediaRecorder) return;
  if (document.hidden) {
    recHiddenSince = performance.now();
    try { mediaRecorder.pause(); } catch {}
    stopAudio();
    recStatus.textContent = 'Paused — this tab was hidden. Switch back to continue recording.';
  } else if (recHiddenSince) {
    recHiddenTotal += performance.now() - recHiddenSince;
    recHiddenSince = 0;
    try { mediaRecorder.resume(); } catch {}
    recStatus.textContent = 'Recording…';
  }
});
document.getElementById('btn-record').addEventListener('click', exportMovie);

let offlineRendering = false, offlineCancel = false;
function shotAtGlobal(time) {
  return locateTime(movieIndex(project.shots), time);
}
async function exportOfflineMovie() {
  if (!window.VideoEncoder || !window.VideoFrame) { toast('Frame-accurate export needs WebCodecs. Choose real-time recording in this browser.'); return; }
  const hasSound = project.audioClips.length > 0;
  if(hasSound && (!window.AudioEncoder || !window.AudioData)){toast('Frame-accurate audio needs WebCodecs AudioEncoder. Choose real-time in this browser.');return;}
  let range;
  try { range = chosenRenderRange(); } catch (e) { toast(e.message); return; }
  const disk = project.studio.delivery.disk;
  if (disk && !window.showSaveFilePicker) { toast('Direct-to-disk needs a browser with a save-file picker. Uncheck it and render a section of five minutes or less.'); return; }
  if (!disk && range.duration > 300) { toast('Memory exports are limited to five-minute sections. Choose a shorter range or enable direct-to-disk.'); return; }
  if (moviePlaying) stopMovie(); setPlaying(false); setWorkspace('anim');
  const width = +document.getElementById('export-res').value;
  const [, height] = exportSize(width, project.exportAspect);
  const fps = Math.max(1, Math.min(60, Number(project.fps) || 30));
  const frameCount = Math.ceil(range.duration * fps);
  const bitrate = { high: 8000000, medium: 4000000, low: 2500000 }[document.getElementById('export-quality').value] || 8000000;
  const config = { codec: 'vp8', width, height, bitrate, framerate: fps, latencyMode: 'quality' };
  const restore = { shotId: project.activeShotId, time: animTime, pixelRatio: renderer.getPixelRatio(),
    pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  const sectionName = project.studio.delivery.mode === 'all' ? '' : `_${range.start.toFixed(2)}-${range.end.toFixed(2)}s`;
  const filename = (project.name || 'videocraft').replace(/[^a-z0-9-_]+/gi, '_') + sectionName;
  let encoder, audioEncoder, encoderError, framesWritten = 0, audioPosition = 0, audioBuffers,
    writable = null, writes = Promise.resolve(), writeError = null;
  const started = performance.now();
  exportPreparing = true; lockExportControls(true);
  try {
    // A cancelled file picker cancels the export; never silently buffer a long movie.
    if (disk) {
      const handle = await window.showSaveFilePicker({ suggestedName: filename + '.webm', types: [{ description: 'WebM movie', accept: { 'video/webm': ['.webm'] } }] });
      writable = await handle.createWritable();
    }
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) throw new Error('This frame size is not supported by the video encoder. Try a smaller frame or real-time mode.');
    const audioConfig={codec:'opus',sampleRate:48000,numberOfChannels:2,bitrate:128000};
    if(hasSound){
      if(!(await AudioEncoder.isConfigSupported(audioConfig)).supported)throw new Error('Opus audio encoding is unavailable. Choose real-time export.');
      recStatus.textContent='Decoding audio sources…';
      audioBuffers=await decodeSources(project.audioAssets,project.audioClips,range);
    }
    const { Muxer, ArrayBufferTarget, StreamTarget } = await import('./vendor/webm-muxer.mjs');
    const target = writable ? new StreamTarget({
      chunked: true, chunkSize: 1024 * 1024,
      onData(data, position) {
        // Copy ownership before the muxer reuses a chunk, serialize writes, and
        // await this queue during rendering to bound pending compressed bytes.
        const chunk = data.slice();
        writes = writes.then(() => writable.write({ type: 'write', data: chunk, position })).catch(e => { writeError = e; });
      },
    }) : new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'V_VP8', width, height, frameRate: fps },
      ...(hasSound ? {audio:{codec:'A_OPUS',sampleRate:48000,numberOfChannels:2}} : {}), firstTimestampBehavior: 'strict' });
    if(hasSound){
      audioEncoder=new AudioEncoder({
        output:(chunk,metadata)=>{
          // Drop Opus flush padding packets starting beyond the supplied PCM.
          if(chunk.timestamp>=Math.round(audioPosition/48000*1e6))return;
          try{muxer.addAudioChunk(chunk,metadata);}catch(e){encoderError=e;}
        },error:e=>{encoderError=e;},
      });audioEncoder.configure(audioConfig);
    }
    encoder = new VideoEncoder({
      output: (chunk, metadata) => { try { muxer.addVideoChunk(chunk, metadata); } catch (e) { encoderError = e; } },
      error: e => { encoderError = e; },
    });
    encoder.configure(config);
    offlineCancel = false; offlineRendering = true; recMode = true; exportPreparing = false;
    document.getElementById('btn-record').textContent = 'Stop export';
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix(); controls.enabled = false;
    grid.visible = false; gizmo.visible = false; selRing.visible = false;
    await document.fonts.ready;
    for (let frame = 0; frame < frameCount && !offlineCancel; frame++) {
      if (encoderError || writeError) throw encoderError || writeError;
      const time = range.start + frame / fps;
      const hit = shotAtGlobal(time);
      if (project.activeShotId !== hit.shot.id) applyShotPlayback(hit.shot.id);
      await ensureShotResources();
      animTime = hit.local; movieTime = time; evaluateAt(animTime);
      camera.lookAt(controls.target); renderFilmFrame();
      const videoFrame = new VideoFrame(filmOutput, { timestamp: Math.round(frame * 1e6 / fps), duration: Math.round(1e6 / fps) });
      try { encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 }); } finally { videoFrame.close(); }
      framesWritten++;
      if(audioEncoder){
        const end=Math.round(framesWritten/fps*48000), count=end-audioPosition;
        const [left,right]=mixStereo(project.audioClips,audioBuffers,range.start+audioPosition/48000,count);
        const data=new Float32Array(count*2);data.set(left);data.set(right,count);
        const frame=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:count,numberOfChannels:2,timestamp:Math.round(audioPosition/48000*1e6),data});
        audioPosition=end;
        try{audioEncoder.encode(frame);}finally{frame.close();}
        if(audioEncoder.encodeQueueSize>8)await new Promise(resolve=>audioEncoder.addEventListener('dequeue',resolve,{once:true}));
      }
      const rate = framesWritten / Math.max(0.01, (performance.now() - started) / 1000), remaining = (frameCount - framesWritten) / rate;
      recStatus.textContent = `Rendering ${Math.round(framesWritten / frameCount * 100)}% · ${framesWritten}/${frameCount} frames · ${rate.toFixed(1)} fps · about ${fmtDur(remaining)} left${writable ? ' · streaming to disk' : ''}`;
      if (encoder.encodeQueueSize > 4) await encoder.flush();
      await writes; // Disk backpressure: do not accumulate the whole film in memory.
      await new Promise(resolve => setTimeout(resolve, 0)); // allow stop/progress, without advancing the movie clock
    }
    await encoder.flush();
    if(audioEncoder)await audioEncoder.flush();
    if (encoderError) throw encoderError;
    if (framesWritten) {
      muxer.finalize();
      await writes; if (writeError) throw writeError;
      let size = 'saved to disk';
      if (writable) { await writable.close(); writable = null; }
      else {
        const blob = new Blob([target.buffer], { type: 'video/webm' }); size = (blob.size / 1e6).toFixed(1) + ' MB';
        downloadBlob(blob, filename + (offlineCancel ? '_partial' : '') + '.webm');
      }
      recStatus.textContent = `${offlineCancel ? 'Partial movie' : 'Movie'} rendered · ${framesWritten} frames at ${fps} fps${hasSound ? ' · stereo audio' : ''} · ${size}`;
      toast('Frame-accurate movie saved');
    } else recStatus.textContent = 'Export cancelled.';
  } catch (e) {
    recStatus.textContent = e.name === 'AbortError' ? 'Export cancelled.' : 'Export failed: ' + e.message;
    if (e.name !== 'AbortError') toast('Frame-accurate export failed: ' + e.message);
  } finally {
    if (writable) { await writes; try { await writable.abort(); } catch {} }
    try { encoder?.close(); } catch {}
    try { audioEncoder?.close(); } catch {}
    audioBuffers?.clear();
    offlineRendering = false; recMode = false; exportPreparing = false;
    applyShotPlayback(restore.shotId); animTime = restore.time; evaluateAt(animTime);
    camera.position.copy(restore.pos); controls.target.copy(restore.target); camera.fov = restore.fov;
    camera.lookAt(controls.target); renderer.setPixelRatio(restore.pixelRatio); controls.enabled = true; grid.visible = true;
    resize3D(); lockExportControls(false);
    document.getElementById('btn-record').textContent = 'Export movie (webm)';
    document.getElementById('btn-download-video').disabled = false;
    renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline(); renderShotsUI(); syncShotControls();
  }
}
document.getElementById('btn-download-video').addEventListener('click', exportMovie);

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================================================
   Film production: imported assets, precision editing, composition
   ============================================================ */
async function importGLB(file) {
  if (project.studio.imports.length >= 100) throw new Error('This project already has 100 imported models.');
  const buffer = await file.arrayBuffer(), metadata = inspectGLB(buffer);
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject;
    reader.readAsDataURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  });
  const asset = { id: uid('glb'), name: file.name.replace(/\.glb$/i, ''), dataURL, animations: metadata.animations };
  await loadImported(asset); // Fail at import, not later during movie rendering.
  project.studio.imports.push(asset); markDirty(); return asset;
}
function placeImported(asset) {
  const object = { id: uid('obj'), name: asset.name, type: 'imported', assetId: asset.id,
    importMotion: { clipIndex: asset.animations.length ? 0 : -1, speed: 1, start: 0, offset: 0, loop: true },
    color: '#ffffff', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 };
  project.sceneObjects.push(object); selectedId = object.id; markDirty(); setWorkspace('scene'); selectObject(object.id);
}
function renderImportedControls(panel, object) {
  const asset = project.studio.imports.find(a => a.id === object.assetId);
  const badge = document.createElement('div'); badge.className = 'rig-badge';
  badge.textContent = 'Imported 3D · embedded materials & rig · normalized to 2m'; panel.append(badge);
  const motion = object.importMotion ||= { clipIndex: -1, speed: 1, start: 0, offset: 0, loop: true };
  labeledSelect(panel, 'Imported animation', [['-1', 'Static / bind pose'], ...(asset?.animations || []).map((name, i) => [String(i), name])], String(motion.clipIndex), v => {
    motion.clipIndex = Number(v); evaluateAt(animTime); markDirty();
  });
  labeledSelect(panel, 'Clip playback', [['loop', 'Loop'], ['hold', 'Play once & hold']], motion.loop === false ? 'hold' : 'loop', v => {
    motion.loop = v === 'loop'; evaluateAt(animTime); markDirty();
  });
  for (const [key, label, base, min, max] of [['speed', 'Imported clip speed', 1, 0.05, 4], ['start', 'Imported clip starts at (s)', 0, 0, project.duration], ['offset', 'Imported source offset (s)', 0, 0, 120]]) {
    panel.append(mkNum(label, { value: motion[key] ?? base }, 'value', v => { motion[key] = v; evaluateAt(animTime); markDirty(); }, min, max, 0.05));
  }
}
async function ensureShotResources() {
  await Promise.all([...objectGroups.values()].map(g => g.userData.ready));
  const failed = [...objectGroups.values()].find(g => g.userData.loadError);
  if (failed) throw failed.userData.loadError;
}
function renderFilmWorld() {
  const host = document.getElementById('film-world-tools');
  if (!host || !project?.studio) return;
  renderWorld(host, activeShot(), {
    dirty: markDirty, toast,
    look: () => applyLighting(activeShot().lighting),
    refresh: () => {
      applyCameraBase(activeShot()); syncSceneObjects(); evaluateAt(animTime);
      renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline(); renderFilmWorld();
    },
  });
  renderCinemaLook(host,activeShot(),{dirty:markDirty,look:()=>applyLighting(activeShot().lighting)});
}
function renderPerformanceTools(panel,object){
  renderPerformance(panel,object,{
    project:()=>project,time:()=>animTime,duration:()=>project.duration,dirty:markDirty,evaluate:()=>evaluateAt(animTime),
    analyze:async(object,clipId)=>{
      const clip=project.audioClips.find(c=>c.id===clipId);if(!clip)throw new Error('Import dialogue in Sound and choose its clip first.');
      const buffers=await decodeSources(project.audioAssets,[clip],{start:-Infinity,end:Infinity});
      object.performance.voice={clipId,...audioEnvelope(buffers.get(clip.assetId))};buffers.clear();
    },
    compose:async(object,kind)=>{
      const group=objectGroups.get(object.id);if(!group)return;
      const keys=project.keyframes[CAMERA_ID] || {};
      if(Object.keys(keys).length && !await askConfirm('Replace this shot’s camera animation with the actor composition?'))return;
      delete project.keyframes[CAMERA_ID];
      group.updateMatrixWorld(true);group.traverse(o=>{if(o.isSkinnedMesh)o.computeBoundingBox();});
      const bounds=new THREE.Box3().setFromObject(group),height=Math.max(0.3,bounds.max.y-bounds.min.y);
      activeShot().camera=composeCamera(group.position.toArray(),height,THREE.MathUtils.radToDeg(group.rotation.y),kind);
      applyCameraBase(activeShot());markDirty();renderTimeline();
    },
  });
}
function snapTime(time) {
  const t = document.getElementById('film-snap').checked ? Math.round(time * project.fps) / project.fps : time;
  return clamp(t, 0, project.duration);
}
function seekLocal(time) {
  if (recMode) return;
  if (moviePlaying) stopMovie(); setPlaying(false);
  animTime = snapTime(Number(time) || 0); evaluateAt(animTime); updatePlayhead();
}
document.getElementById('film-local-time').addEventListener('change', e => seekLocal(e.target.value));
document.getElementById('film-global-time').addEventListener('change', e => {
  if (recMode) return;
  if (moviePlaying) stopMovie(); setPlaying(false);
  const hit = locateTime(movieIndex(project.shots), Number(e.target.value) || 0);
  if (hit.shot.id !== project.activeShotId) applyShot(hit.shot.id);
  seekLocal(hit.local);
});
document.getElementById('film-prev-frame').addEventListener('click', () => seekLocal(animTime - 1 / project.fps));
document.getElementById('film-next-frame').addEventListener('click', () => seekLocal(animTime + 1 / project.fps));
document.getElementById('film-key-transform').addEventListener('click', () => {
  const object = selObj(); if (!object) return toast('Select an object first.');
  const channels = object.type === 'camera' ? CAM_CHANNELS.map(c => c.ch) : ['pos.x', 'pos.y', 'pos.z', 'rot.x', 'rot.y', 'rot.z', 'scale.x', 'scale.y', 'scale.z', 'opacity'];
  const tracks = project.keyframes[object.id] ||= {};
  const time = snapTime(animTime);
  for (const ch of channels) {
    const track = tracks[ch] ||= [], existing = track.find(k => Math.abs(k.t - time) < 0.0001);
    const key = { t: time, v: currentChannelValue(object, ch), ease: document.getElementById('key-ease').value };
    if (existing) Object.assign(existing, key); else track.push(key);
    track.sort((a, b) => a.t - b.t);
  }
  markDirty(); renderTimeline(); renderAnimObjectSelect(); toast('Base transform keyed at ' + time.toFixed(3) + 's.');
});
let motionClipboard = null;
document.getElementById('film-copy-motion').addEventListener('click', () => {
  const object = selObj(); if (!object) return toast('Select an object first.');
  motionClipboard = { camera: object.type === 'camera', tracks: structuredClone(project.keyframes[object.id] || {}) };
  toast('Motion copied.');
});
document.getElementById('film-paste-motion').addEventListener('click', async () => {
  const object = selObj();
  if (!object || !motionClipboard) return toast('Copy motion and select a destination first.');
  if ((object.type === 'camera') !== motionClipboard.camera) return toast('Camera motion can only be pasted onto a camera.');
  if (Object.keys(project.keyframes[object.id] || {}).length && !await askConfirm('Replace this object’s existing keyframes?')) return;
  project.keyframes[object.id] = Object.fromEntries(Object.entries(structuredClone(motionClipboard.tracks)).map(([ch, keys]) => [ch, keys.filter(k => k.t <= project.duration)]).filter(([, keys]) => keys.length));
  selectedKey = null; markDirty(); evaluateAt(animTime); renderTimeline(); renderAnimObjectSelect(); toast('Motion pasted. Keys outside this shot were skipped.');
});
document.getElementById('film-clear-motion').addEventListener('click', async () => {
  const object = selObj(); if (!object || !await askConfirm('Clear the selected object’s keyframes? Its base transform and motion preset will be kept.')) return;
  delete project.keyframes[object.id]; selectedKey = null; markDirty();
  if (object.type === 'camera') applyCameraBase(activeShot());
  evaluateAt(animTime); renderTimeline(); renderAnimObjectSelect();
});

let recordingVideoTrack = null;
const filmOverlay = document.createElement('canvas'), filmOutput = document.createElement('canvas');
filmOverlay.className = 'film-overlay'; filmOverlay.setAttribute('aria-label', 'Movie titles and subtitles');
document.getElementById('anim-viewport').append(filmOverlay);
const overlayCtx = filmOverlay.getContext('2d'), filmOutputCtx = filmOutput.getContext('2d');
function drawFilmOverlay(ctx, width, height) {
  const shot = activeShot(), film = shot.film;
  ctx.save();
  const cues = (film?.captions || []).filter(c => animTime >= c.start && animTime < c.end);
  let bottom = height * 0.91;
  for (const cue of cues) {
    const font = Math.max(1, height * cue.size / 100);
    ctx.font = `600 ${font}px Outfit, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = [];
    for (const paragraph of cue.text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? line + ' ' + word : word;
        if (line && ctx.measureText(next).width > width * 0.84) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    const lineHeight = font * 1.3, y = cue.position === 'center' ? height / 2 - (lines.length - 1) * lineHeight / 2 : bottom - (lines.length - 1) * lineHeight;
    if (cue.position !== 'center') bottom -= lines.length * lineHeight + font * 0.35;
    lines.forEach((line, i) => {
      const w = Math.min(width * 0.94, ctx.measureText(line).width + font);
      ctx.fillStyle = 'rgba(12,15,19,.78)'; ctx.fillRect(width / 2 - w / 2, y + i * lineHeight - lineHeight / 2, w, lineHeight);
      ctx.fillStyle = cue.color; ctx.fillText(line, width / 2, y + i * lineHeight, width * 0.88);
    });
  }
  const fade = fadeAmount(film, animTime, shot.duration);
  if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, width, height); }
  ctx.restore();
}
function renderFilmFrame() {
  cinemaRenderer.render(activeShot().film?.grade,globalTime(),project.fps);
  const width = renderer.domElement.width, height = renderer.domElement.height;
  if (filmOverlay.width !== width || filmOverlay.height !== height) { filmOverlay.width = width; filmOverlay.height = height; }
  overlayCtx.clearRect(0, 0, width, height);
  if (activeWs === 'anim') {
    drawFilmOverlay(overlayCtx, width, height);
    if (!recMode && document.getElementById('film-guides').checked) {
      overlayCtx.strokeStyle = 'rgba(255,255,255,.4)'; overlayCtx.lineWidth = 1;
      for (const n of [1, 2]) {
        overlayCtx.beginPath(); overlayCtx.moveTo(width * n / 3, 0); overlayCtx.lineTo(width * n / 3, height);
        overlayCtx.moveTo(0, height * n / 3); overlayCtx.lineTo(width, height * n / 3); overlayCtx.stroke();
      }
    }
  }
  if (recMode || exportPreparing) {
    if (filmOutput.width !== width || filmOutput.height !== height) { filmOutput.width = width; filmOutput.height = height; }
    filmOutputCtx.drawImage(renderer.domElement, 0, 0); drawFilmOverlay(filmOutputCtx, width, height);
    // Explicitly submit the composed frame: detached 2D canvases are not
    // consistently auto-captured by all MediaRecorder implementations.
    recordingVideoTrack?.requestFrame?.();
  }
}
function chosenRenderRange() {
  return renderRange(project.shots, project.activeShotId, project.studio.delivery);
}
function syncFilmSettings() {
  const settings = project.studio.delivery;
  document.getElementById('export-scope').value = settings.mode;
  document.getElementById('export-start').value = settings.start;
  document.getElementById('export-end').value = settings.end;
  document.getElementById('export-disk').checked = settings.disk;
  document.getElementById('export-range-fields').hidden = settings.mode !== 'range';
  const summary = document.getElementById('export-range-summary');
  try {
    const range = chosenRenderRange();
    summary.textContent = `${fmtDur(range.duration)} · ${Math.ceil(range.duration * project.fps).toLocaleString()} frames · movie ${range.start.toFixed(2)}–${range.end.toFixed(2)}s`;
  } catch (e) { summary.textContent = e.message; }
}
for (const id of ['export-scope', 'export-start', 'export-end', 'export-disk']) {
  document.getElementById(id).addEventListener('change', () => {
    project.studio.delivery = { mode: document.getElementById('export-scope').value, start: Number(document.getElementById('export-start').value), end: Number(document.getElementById('export-end').value), disk: document.getElementById('export-disk').checked };
    markDirty(); syncFilmSettings();
  });
}

/* ============================================================
   Project save / open / new
   ============================================================ */
document.getElementById('btn-save').addEventListener('click', () => {
  const data = JSON.stringify(serializeProject(), null, 1);
  downloadBlob(new Blob([data], { type: 'application/json' }), (project.name || 'videocraft').replace(/[^a-z0-9-_]+/gi, '_') + '.videocraft.json');
  dirty = false;
  document.getElementById('save-state').textContent = '';
  toast('Project file saved to downloads — includes all shots and audio');
});
document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-open').click());
document.getElementById('file-open').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.shots && !data.sceneObjects) throw new Error('bad file');
      if (recMode || exportPreparing || exportFinalizing) { toast('Finish exporting before opening a project'); return; }
      if (moviePlaying) stopMovie();
      setPlaying(false);
      loadProjectData(data);
      objectGroups.forEach(g => { three.remove(g); disposeGroup(g); }); objectGroups.clear();
      selectedId = null; currentCharId = project.characters[0]?.id || null;
      document.getElementById('project-tag').textContent = project.name;
      applyShot(project.activeShotId);
      markDirty();
      renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
      renderAudioList();
      setWorkspace(activeWs);
      toast('Project loaded: ' + project.name + ' (' + project.shots.length + ' shot' + (project.shots.length > 1 ? 's' : '') + ')');
    } catch { toast('That file is not a VideoCraft project'); }
    e.target.value = '';
  };
  reader.readAsText(f);
});
document.getElementById('btn-starter').addEventListener('click', loadStarterScene);
document.getElementById('btn-new').addEventListener('click', async () => {
  const hasWork = project.shots.some(s => s.sceneObjects.length) || project.drawings.length || project.audioAssets.length || project.name !== 'Untitled movie' || hasProductionWork(project.studio);
  if (hasWork && !await askConfirm('Start a new movie? Unsaved work will be lost.')) return;
  if (moviePlaying) stopMovie(); setPlaying(false);
  project = defaultProject();
  currentCharId = null; selectedId = null;
  document.getElementById('project-tag').textContent = project.name;
  markDirty();
  clearDraw();
  applyShot(project.shots[0].id);
  renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
  renderAudioList();
  setWorkspace(activeWs);
  toast('New movie');
});

/* ============================================================
   Starter demo — a two-shot mini movie: engine room + hero close-up
   ============================================================ */
async function loadStarterScene() {
  const hasWork = project.shots.some(s => s.sceneObjects.length) || project.drawings.length || project.audioAssets.length || project.name !== 'Untitled movie' || hasProductionWork(project.studio);
  if (hasWork && !await askConfirm('Replace the current movie with the starter scene?')) return;
  if (moviePlaying) stopMovie(); setPlaying(false);
  project = defaultProject();
  project.name = 'Starter — mini movie';
  selectedId = null; currentCharId = null;

  // 1) draw an asset programmatically (a sunny poster)
  const c = document.createElement('canvas'); c.width = c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = '#f6d8a8'; x.fillRect(0, 0, 400, 400);
  x.fillStyle = '#e8836b'; x.beginPath(); x.arc(200, 250, 90, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#5b4632'; x.font = '700 44px Outfit, sans-serif'; x.textAlign = 'center';
  x.fillText('VideoCraft', 200, 70);
  x.font = '400 22px Outfit, sans-serif'; x.fillStyle = '#7a5b3a';
  x.fillText('draw, build, animate', 200, 110);
  project.drawings.push({ id: uid('draw'), name: 'Sun poster', dataURL: c.toDataURL('image/png') });

  // 2) a hero character
  const hero = defaultRig('Hero');
  project.characters.push(hero);
  currentCharId = hero.id;

  // ---------- SHOT 1: the engine room ----------
  const s1 = project.shots[0];
  s1.name = 'Engine room';
  s1.duration = 6;
  const mk = (o) => { s1.sceneObjects.push(o); return o; };
  mk({ id: uid('obj'), name: 'Engine block', type: 'engineKit', enginePart: 'block', color: '#8a8f96', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const fly = mk({ id: uid('obj'), name: 'Flywheel', type: 'engineKit', enginePart: 'flywheel', color: '#8a8f96', pos: [2.4, 1.15, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const crank = mk({ id: uid('obj'), name: 'Crankshaft', type: 'engineKit', enginePart: 'crankshaft', color: '#8a8f96', pos: [0, 0.35, 1.7], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  mk({ id: uid('obj'), name: 'Sun poster', type: 'drawing', assetId: project.drawings[0].id, color: '#fff', pos: [-4.5, 1.7, -2], rot: [0, 24, 0], scale: [1, 1, 1], opacity: 1 });
  mk({ id: uid('obj'), name: 'Title', type: 'text', text: 'THE ENGINE ROOM', color: '#f2b25c', pos: [0, 3.1, -3.5], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const heroObj1 = mk({ id: uid('obj'), name: 'Hero', type: 'character', assetId: hero.id, color: '#fff', pos: [-5, 1.3, 2.5], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const kf1 = s1.keyframes;
  kf1[fly.id] = { 'rot.y': [{ t: 0, v: 0, ease: 'linear' }, { t: 6, v: 720, ease: 'linear' }] };
  kf1[crank.id] = { 'rot.y': [{ t: 0, v: 0, ease: 'linear' }, { t: 6, v: 720, ease: 'linear' }] };
  kf1[heroObj1.id] = {
    'pos.x': [{ t: 0, v: -5, ease: 'ease' }, { t: 4, v: 3.5, ease: 'ease' }],
    'pos.z': [{ t: 0, v: 2.5, ease: 'ease' }, { t: 4, v: 2.5, ease: 'ease' }],
    'pose': [{ t: 0, v: 0, ease: 'linear' }, { t: 3.5, v: 7, ease: 'linear' }, { t: 4, v: 0, ease: 'linear' }],
  };

  // ---------- SHOT 2: hero close-up, with a camera move ----------
  const s2 = newShot('Hero close-up', 4);
  project.shots.push(s2);
  const mk2 = (o) => { s2.sceneObjects.push(o); return o; };
  const heroObj2 = mk2({ id: uid('obj'), name: 'Hero', type: 'character', assetId: hero.id, color: '#fff', pos: [0, 1.3, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  mk2({ id: uid('obj'), name: 'The end', type: 'text', text: 'THE END', color: '#ece7dd', pos: [0, 2.8, -2], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const kf2 = s2.keyframes;
  kf2[heroObj2.id] = {
    'pose': [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: 6, ease: 'linear' }, { t: 4, v: 0, ease: 'linear' }],
  };
  kf2[CAMERA_ID] = {
    'cam.px': [{ t: 0, v: 7, ease: 'ease' }, { t: 4, v: 2.4, ease: 'ease' }],
    'cam.py': [{ t: 0, v: 5.5, ease: 'ease' }, { t: 4, v: 1.9, ease: 'ease' }],
    'cam.pz': [{ t: 0, v: 9, ease: 'ease' }, { t: 4, v: 3.4, ease: 'ease' }],
    'cam.tx': [{ t: 0, v: 0, ease: 'ease' }, { t: 4, v: 0, ease: 'ease' }],
    'cam.ty': [{ t: 0, v: 1.4, ease: 'ease' }, { t: 4, v: 1.4, ease: 'ease' }],
    'cam.tz': [{ t: 0, v: 0, ease: 'ease' }, { t: 4, v: 0, ease: 'ease' }],
  };
  hero._base = { ...hero.pivots };

  // load the poster onto the draw canvas too, so Draw workspace shows something real
  const img = new Image();
  img.onload = () => { drawCtx.clearRect(0, 0, DRAW_W, DRAW_H); drawCtx.drawImage(img, 0, 0, DRAW_W, DRAW_H); hasDrawnFlag = true; document.getElementById('draw-hint').classList.add('hidden'); };
  img.src = project.drawings[0].dataURL;

  document.getElementById('project-tag').textContent = project.name;
  applyShot(s1.id);
  // set deterministic base framings AFTER applyShot (which captures the old editor camera)
  s1.camera = { pos: [8.5, 7, 11], tgt: [0, 1.2, 0], fov: 46 };
  s2.camera = { pos: [7, 5.5, 9], tgt: [0, 1.4, 0], fov: 46 };
  applyCameraBase(s1);
  markDirty();
  renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
  renderAudioList();
  setWorkspace('anim');
  toast('Starter movie loaded — 2 shots, 10s. Try Play movie.');
}

/* ============================================================
   Cinematic tools — additive v2 fields preserve old project files
   ============================================================ */
function labeledSelect(panel, label, options, value, onChange) {
  const wrap = document.createElement('label'); wrap.className = 'joint-editor';
  const title = document.createElement('span'); title.className = 'side-title'; title.textContent = label;
  const select = document.createElement('select'); select.className = 'btn studio-select';
  select.setAttribute('aria-label', label);
  options.forEach(([v, text]) => { const op = document.createElement('option'); op.value = v; op.textContent = text; select.appendChild(op); });
  select.value = value; select.addEventListener('change', () => onChange(select.value));
  wrap.append(title, select); panel.appendChild(wrap); return select;
}
function renderActorControls(panel, o) {
  const badge = document.createElement('div'); badge.className = 'rig-badge';
  badge.textContent = o.rigMode === '3d' ? '3D avatar · 19 bones · weighted skin' : 'Legacy 2D character';
  panel.appendChild(badge);
  if (o.rigMode !== '3d') {
    const upgrade = document.createElement('button'); upgrade.className = 'btn'; upgrade.textContent = 'Upgrade this actor to 3D';
    upgrade.addEventListener('click', () => {
      o.rigMode = '3d'; o.pos[1] = Math.max(0, o.pos[1] - 1.3);
      o.motion = { clip: 'idle', speed: 1 }; syncSceneObjects(); evaluateAt(animTime);
      markDirty(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
    });
    panel.appendChild(upgrade); return;
  }
  const motion = o.motion ||= { clip: 'none', speed: 1 };
  labeledSelect(panel, 'Motion preset', MOTIONS.map(m => [m, m[0].toUpperCase() + m.slice(1)]), motion.clip, v => {
    motion.clip = v; motion.speed = v === 'run' ? 2.3 : v === 'walk' ? 1.3 : 1;
    markDirty(); evaluateAt(animTime); renderSceneProps(); renderAnimObjectSelect();
  });
  const motionNumber = (label, key, fallback, min, max, step) => {
    const holder = { [key]: motion[key] ?? fallback };
    panel.appendChild(mkNum(label, holder, key, v => { motion[key] = v; markDirty(); evaluateAt(animTime); }, min, max, step));
  };
  motionNumber('Motion speed', 'speed', 1, 0.1, 4, 0.05);
  motionNumber('Motion strength', 'strength', 1, 0, 2, 0.05);
  motionNumber('Motion phase', 'phase', 0, 0, 1, 0.05);
  motionNumber('Motion start (s)', 'start', 0, 0, project.duration, 0.1);
  motionNumber('Motion end (s)', 'end', project.duration, 0, project.duration, 0.1);
  const details = document.createElement('details'); details.className = 'studio-details';
  const summary = document.createElement('summary'); summary.textContent = 'Joint posing & keyframes';
  const body = document.createElement('div'); body.className = 'joint-editor';
  details.append(summary, body); panel.appendChild(details);
  let joint = JOINTS[0];
  const controlsPanel = document.createElement('div'); controlsPanel.className = 'joint-editor';
  const drawJoint = () => {
    controlsPanel.innerHTML = '';
    for (const axis of ['x', 'y', 'z']) {
      const key = joint + '.' + axis, values = o.joints ||= {};
      controlsPanel.appendChild(mkNum('Joint ' + axis.toUpperCase(), { value: values[key] ?? 0 }, 'value', v => {
        values[key] = v; markDirty(); evaluateAt(animTime);
      }, -180, 180, 1));
    }
  };
  labeledSelect(body, 'Joint', JOINTS.map(j => [j, j.replace(/([A-Z])/g, ' $1')]), joint, v => { joint = v; drawJoint(); });
  body.appendChild(controlsPanel); drawJoint();
  const keyBtn = document.createElement('button'); keyBtn.className = 'btn'; keyBtn.textContent = 'Key this joint at playhead';
  keyBtn.addEventListener('click', () => {
    const kf = project.keyframes[o.id] ||= {}, bone = objectGroups.get(o.id)?.children[0]?.userData.bones?.[joint];
    for (const axis of ['x', 'y', 'z']) {
      const ch = 'joint.' + joint + '.' + axis, key = joint + '.' + axis;
      const value = o.joints?.[key] ?? (bone ? THREE.MathUtils.radToDeg(bone.rotation[axis]) : 0);
      const track = kf[ch] ||= [];
      const existing = track.find(k => Math.abs(k.t - animTime) < 0.02);
      if (existing) existing.v = value;
      else track.push({ t: snapTime(animTime), v: value, ease: 'ease' });
      sortKeys(o.id, ch);
    }
    markDirty(); renderTimeline(); toast('Joint keyed at ' + animTime.toFixed(2) + 's');
  });
  body.appendChild(keyBtn);
  const reset = document.createElement('button'); reset.className = 'btn'; reset.textContent = 'Clear static joint overrides';
  reset.addEventListener('click', () => { o.joints = {}; markDirty(); evaluateAt(animTime); drawJoint(); });
  body.appendChild(reset);
}

document.getElementById('shot-lighting').addEventListener('change', e => {
  activeShot().lighting = e.target.value; applyLighting(e.target.value); markDirty();
});
document.getElementById('export-aspect').addEventListener('change', e => {
  project.exportAspect = e.target.value; markDirty(); resize3D();
});
document.getElementById('btn-camera-lens').addEventListener('click', () => {
  const mm = +document.getElementById('camera-lens').value;
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(24 / (2 * mm)));
  camera.fov = fov; camera.updateProjectionMatrix();
  const s = activeShot(); s.camera ||= cameraBaseSnapshot(); s.camera.fov = fov;
  const kf = s.keyframes[CAMERA_ID];
  if (kf?.['cam.fov']) kf['cam.fov'].forEach(k => { k.v = fov; });
  markDirty(); renderTimeline(); toast(mm + 'mm lens set');
});
document.getElementById('btn-camera-preset').addEventListener('click', async () => {
  if (moviePlaying || recMode) { toast('Stop playback or export before changing the camera'); return; }
  const mode = document.getElementById('camera-preset').value, s = activeShot();
  if (Object.keys(s.keyframes[CAMERA_ID] || {}).length && !await askConfirm('Replace this shot’s camera keyframes?')) return;
  const from = [...camera.position.toArray(), ...controls.target.toArray(), camera.fov];
  let to = [...from];
  const delta = camera.position.clone().sub(controls.target);
  if (mode === 'dolly' || mode === 'pullback') {
    const p = controls.target.clone().addScaledVector(delta, mode === 'dolly' ? 0.5 : 1.6);
    to.splice(0, 3, ...p.toArray());
  } else if (mode === 'crane') { to[1] += 6; to[2] += 2; }
  else if (mode === 'tracking') {
    const o = selObj();
    if (!o || o.type === 'camera') { toast('Select an actor or object to track first'); return; }
    const tracks = s.keyframes[o.id] || {};
    const begin = ['x', 'y', 'z'].map((a, i) => tracks['pos.' + a]?.length ? sampleTrack(tracks['pos.' + a], 0) : o.pos[i]);
    const end = ['x', 'y', 'z'].map((a, i) => tracks['pos.' + a]?.length ? sampleTrack(tracks['pos.' + a], s.duration) : o.pos[i]);
    begin.forEach((v, i) => { from[i + 3] = v + (i === 1 ? 1.2 : 0); to[i + 3] = end[i] + (i === 1 ? 1.2 : 0); to[i] = from[i] + end[i] - v; });
  }
  s.camera = { pos: from.slice(0, 3), tgt: from.slice(3, 6), fov: from[6] };
  s.keyframes[CAMERA_ID] = cameraTracks(from, to, s.duration);
  if (mode === 'orbit') {
    const frames = 12;
    for (const ch of ['cam.px', 'cam.pz']) s.keyframes[CAMERA_ID][ch] = [];
    for (let i = 0; i <= frames; i++) {
      const angle = i / frames * Math.PI * 1.5, c = Math.cos(angle), sn = Math.sin(angle);
      s.keyframes[CAMERA_ID]['cam.px'].push({ t: s.duration * i / frames, v: from[3] + delta.x * c + delta.z * sn, ease: 'linear' });
      s.keyframes[CAMERA_ID]['cam.pz'].push({ t: s.duration * i / frames, v: from[5] + delta.z * c - delta.x * sn, ease: 'linear' });
    }
  }
  animTime = 0; evaluateAt(0); markDirty(); renderTimeline(); renderAnimObjectSelect();
  toast('Camera move added — select Shot camera to edit its keys');
});

async function loadRaceMovie() {
  if (recMode || exportPreparing || exportFinalizing) { toast('Finish exporting first'); return; }
  const hasWork = project.shots.some(s => s.sceneObjects.length) || project.drawings.length || project.audioAssets.length || project.name !== 'Untitled movie' || hasProductionWork(project.studio);
  if (hasWork && !await askConfirm('Replace the current movie with the 3D race movie? Save your project first to keep it.')) return;
  if (moviePlaying) stopMovie(); setPlaying(false);
  project = defaultProject(); project.name = 'The Final Straight'; project.exportAspect = '2.39:1';
  project.studio.plan = { ...project.studio.plan, genre: 'Sports drama',
    logline: 'Four runners enter the final straight. Nova finds one last burst of speed.',
    synopsis: 'Establish the contenders, follow the race, build tension at the line, and finish with Nova’s celebration.',
    script: 'EXT. STADIUM - LATE AFTERNOON\n\nFour runners wait at the start.\n\nThe race begins. Blaze leads; Nova stays close.\n\nOn the final straight, Nova surges. The finish is decided by a stride.\n\nNova raises both arms. The others catch their breath.',
  };
  const colors = ['#e05d5d', '#efb855', '#4fb3a4', '#648fe1'];
  project.characters = ['Blaze', 'Dash', 'Nova', 'Jet'].map((name, i) => {
    const rig = defaultRig(name); rig.torsoColor = colors[i]; rig.feetColor = colors[i];
    rig.headColor = SKIN[(i * 2) % SKIN.length]; rig.armColor = rig.headColor; rig.handColor = rig.headColor;
    rig.hairStyle = ['spiky', 'side', 'flat', 'bald'][i]; return rig;
  });
  const defs = [
    ['The contenders', 4, -9, -9, 'idle', [0, 12, 17, -2, 0.8, 0, 46], [-4, 6, 13, -8, 1, 0, 42]],
    ['Off the line', 5, -9, -3, 'run', [-6, 2.8, 10, -9, 1.1, 0, 42], [0, 2.6, 10, -3, 1.1, 0, 42]],
    ['The chase', 7, -3, 5, 'run', [-2, 2.8, 10, -3, 1.2, 0, 38], [6, 2.6, 10, 5, 1.2, 0, 38]],
    ['Photo finish', 5, 5, 10, 'run', [12, 2.8, 9, 7, 1.2, 0, 46], [14, 2.3, 8, 10, 1.2, 0, 46]],
    ['Nova takes the win', 5, 10, 10, 'celebrate', [13, 3.6, 9, 9, 1.3, 0, 42], [11.5, 2.8, 6, 9, 1.4, 0, 38]],
  ];
  const primitive = (s, name, type, color, pos, scale, rot = [0, 0, 0]) => {
    const castShadow = !/Track surface|Lane marking|Start line|Finish line|Stadium seat|Floodlight panel/.test(name);
    const o = { id: uid('obj'), name, type, color, pos, scale, rot, opacity: 1, castShadow }; s.sceneObjects.push(o); return o;
  };
  let phaseTime = 0;
  project.shots = defs.map(([name, duration, start, end, clip, from, to], shotIndex) => {
    const s = newShot(name, duration); s.lighting = shotIndex === 4 ? 'sunset' : 'daylight';
    s.film = shotFilm({
      fadeIn: shotIndex === 0 ? 0.6 : 0, fadeOut: shotIndex === 4 ? 0.8 : 0,
      captions: shotIndex === 0 || shotIndex === 4 ? [{
        id: uid('cue'), start: 0.7, end: Math.min(3.5, duration - 0.4), position: 'center',
        text: shotIndex === 0 ? 'THE FINAL STRAIGHT' : 'NOVA TAKES THE WIN', size: 6, color: '#fff3d4',
      }] : [],
    });
    project.studio.shotNotes[s.id] = [
      'Wide establishing move. Introduce the field and the film title.',
      'Low lateral track. Keep the runners’ feet and lane lines visible.',
      'Follow the pack; hold the camera speed steady while Nova closes the gap.',
      'Three-quarter finish angle. Leave room ahead of the runners.',
      'Push into the winner’s celebration. End with a fade through black.',
    ][shotIndex];
    s.camera = { pos: from.slice(0, 3), tgt: from.slice(3, 6), fov: from[6] };
    s.keyframes[CAMERA_ID] = cameraTracks(from, to, duration, 'linear');
    primitive(s, 'Track surface', 'box', '#ac5f46', [0, -0.08, 0], [28, 0.2, 8]);
    for (let i = 0; i < 5; i++) primitive(s, 'Lane marking ' + (i + 1), 'box', '#f5e9d1', [0, 0.035, -3.2 + i * 1.6], [28, 0.015, 0.04]);
    for (const x of [-9, 8]) primitive(s, x < 0 ? 'Start line' : 'Finish line', 'box', '#fff7e5', [x, 0.04, 0], [0.14, 0.02, 6.4]);
    for (const z of [-7, 7]) {
      for (let row = 0; row < 3; row++) {
        primitive(s, 'Stadium terrace', 'box', '#546577', [0, 0.2 + row * 0.45, z + Math.sign(z) * row * 0.8], [28, 0.4 + row * 0.4, 0.7]);
        for (let seat = 0; seat < 9; seat++) primitive(s, 'Stadium seat', 'box', colors[(seat + row) % 4], [-12 + seat * 3, 0.5 + row * 0.65, z + Math.sign(z) * row * 0.8], [0.7, 0.25, 0.45]);
      }
    }
    for (const x of [-12, 12]) for (const z of [-5, 5]) {
      primitive(s, 'Floodlight mast', 'cylinder', '#a6b0b8', [x, 3.5, z], [0.14, 7, 0.14]);
      primitive(s, 'Floodlight panel', 'box', '#fff1c2', [x, 7, z], [1.4, 0.5, 0.3]);
    }
    project.characters.forEach((rig, i) => {
      const gap = [0.55, 0.9, 0, 1.3][i];
      const prevGap = shotIndex < 2 ? 0 : shotIndex === 2 ? gap * 0.4 : gap;
      const nextGap = shotIndex === 0 ? 0 : shotIndex === 1 ? gap * 0.4 : gap;
      const isWinShot = shotIndex === 4;
      const o = primitive(s, rig.name, 'character', '#fff', [start - prevGap, 0, -2.4 + i * 1.6], [1, 1, 1], [0, isWinShot ? 0 : 90, 0]);
      o.assetId = rig.id; o.rigMode = '3d';
      o.motion = { clip: isWinShot && i !== 2 ? 'idle' : clip, speed: clip === 'run' ? 2.25 + i * 0.035 : 1, phase: phaseTime * (clip === 'run' ? 2.25 + i * 0.035 : 1) + i * 0.2 };
      if (!isWinShot) s.keyframes[o.id] = { 'pos.x': [{ t: 0, v: start - prevGap, ease: 'linear' }, { t: duration, v: end - nextGap, ease: 'linear' }] };
      else o.pos[0] = 9 - gap;
    });
    phaseTime += duration; return s;
  });
  project.activeShotId = project.shots[0].id;
  project.sceneObjects = project.shots[0].sceneObjects; project.keyframes = project.shots[0].keyframes; project.duration = project.shots[0].duration;
  animTime = 0; selectedId = null; currentCharId = project.characters[0].id;
  document.getElementById('project-tag').textContent = project.name;
  applyShot(project.activeShotId); setWorkspace('anim'); evaluateAt(0);
  markDirty(); renderCharList(); drawCharPreview(); renderCharProps(); renderAssetList(); renderAudioList();
  toast('3D race movie ready: 4 rigged actors, 5 shots, 26 seconds. Press Play movie.');
}
document.getElementById('btn-race').addEventListener('click', loadRaceMovie);
document.getElementById('btn-cinema').addEventListener('click', async e => {
  if(recMode || exportPreparing || exportFinalizing)return;
  const button=e.currentTarget;button.disabled=true;
  try {
    const voice=await loadDemoVoice();
    if(recMode || exportPreparing || exportFinalizing)return;
    const hasWork=project.shots.some(s=>s.sceneObjects.length) || project.drawings.length || project.audioAssets.length ||
      project.name!=='Untitled movie' || hasProductionWork(project.studio);
    if(hasWork && !await askConfirm('Replace the current movie with The Last Signal? Save your project first to keep it.'))return;
    if(moviePlaying)stopMovie();setPlaying(false);
    project=buildCinemaDemo({newProject:defaultProject,newShot,newRig:defaultRig,uid},voice);
    animTime=0;selectedId=null;currentCharId=project.characters[0].id;
    document.getElementById('project-tag').textContent=project.name;
    applyShot(project.activeShotId);setWorkspace('anim');evaluateAt(0);
    markDirty();renderCharList();drawCharPreview();renderCharProps();renderAssetList();renderAudioList();
    toast('The Last Signal: 4 shots, 13 seconds, generated voice and editable facial performances. Press Play movie.');
  } catch(error){toast('Could not load cinematic demo: '+error.message);}
  finally{button.disabled=false;}
});

/* ============================================================
   Boot
   ============================================================ */
loadSaved();
studioWorkspaces = createStudioWorkspaces({
  project: () => project, dirty: markDirty, toast, workspace: setWorkspace,
  importGLB, placeImported, download: downloadBlob,
  placeObject: o => { project.sceneObjects.push(o); selectedId = o.id; markDirty(); setWorkspace('scene'); selectObject(o.id); },
  placeCharacter: addCharacterObject, placeDrawing: addDrawingPlane,
  renderAudio: renderAudioList, saveProject: () => document.getElementById('btn-save').click(),
  openShot: applyShot, playMovie, syncShots: renderShotsUI,
  addShot,
  duration: (id, duration) => {
    const shot = project.shots.find(s => s.id === id); if (!shot) return;
    shot.duration = duration;
    if (shot.id === project.activeShotId) { project.duration = duration; animTime = Math.min(animTime, duration); }
    markDirty(); syncShotControls(); renderShotsUI(); renderTimeline();
  },
  duplicateShot: id => { applyShot(id); duplicateShot(); return project.activeShotId; },
  deleteShot: async id => { applyShot(id); const old = project.shots.length; await deleteShot(); if (project.shots.length < old) delete project.studio.shotNotes[id]; },
  moveShot: (id, dir) => {
    const index = project.shots.findIndex(s => s.id === id), next = index + dir;
    if (index < 0 || next < 0 || next >= project.shots.length) return;
    [project.shots[index], project.shots[next]] = [project.shots[next], project.shots[index]];
    markDirty(); renderShotsUI();
  },
});
document.getElementById('project-tag').textContent = project.name;
if (!project.characters.length && !project.shots.some(s => s.sceneObjects.length) && !project.drawings.length) {
  // first visit: starter character so the app never feels empty
  const rig = defaultRig('Hero');
  project.characters.push(rig);
  currentCharId = rig.id;
}
document.getElementById('char-name').value = currentRig()?.name || '';
renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
renderAudioList();
applyShot(project.activeShotId);
renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
setWorkspace('plan');
syncDrawSize();
requestAnimationFrame(tick);
window.addEventListener('resize', () => { syncDrawSize(); resize3D(); renderTimeline(); });
markDirty();

// test/QA hook (harmless in production)
window.__vc = {
  get objectGroups() { return objectGroups; },
  get project() { return project; },
  get camera() { return camera; },
  evaluateAt,
  get recorder() { return mediaRecorder; },
  get chunkCount() { return recordedChunks.length; },
  get savePending() { return savePending; },
  get exportPreparing() { return exportPreparing; },
  get exportFinalizing() { return exportFinalizing; },
  get recActive() { return recMode; },
  playingAudioCount: () => [...audioNodes.values()].filter(n => !n.el.paused).length,
  clipInfo: () => project.audioClips.map(c => ({ start: c.start, vol: c.volume, asset: (project.audioAssets.find(a => a.id === c.assetId) || {}).name })),
  audioDebug: () => ({
    ctxState: audioCtx ? audioCtx.state : 'none',
    nodes: [...audioNodes.entries()].map(([id, n]) => ({ id, paused: n.el.paused, ct: Math.round(n.el.currentTime * 100) / 100, ready: n.el.readyState })),
    masterConnected: !!(masterGain && exportDest),
  }),
};
