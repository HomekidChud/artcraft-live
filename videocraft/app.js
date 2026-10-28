// VideoCraft — draw / build / animate / make movies in the browser. ArtCraft family tool.
// v0.2 — movie studio: shots, per-shot camera, audio, fixed-res export.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   Shared project model — a movie is a sequence of shots
   ============================================================ */
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

function newShot(name = 'Shot 1', duration = 5) {
  return {
    id: uid('shot'), name, duration,
    sceneObjects: [],   // per-shot 3D objects (see below)
    keyframes: {},      // [sceneObjectId][channel] -> [{t, v, ease}]
    camera: null,        // reserved: per-shot camera base (currently keys live in keyframes.__camera__)
  };
}
function defaultProject() {
  const shot = newShot('Shot 1', 5);
  return {
    version: 2,
    name: 'Untitled movie',
    fps: 30,
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
  });
  data.version = 2;
  data.name = data.name || 'Untitled movie';
  data.fps = data.fps || 30;
  data.drawings = Array.isArray(data.drawings) ? data.drawings : [];
  data.characters = Array.isArray(data.characters) ? data.characters : [];
  data.audioAssets = Array.isArray(data.audioAssets) ? data.audioAssets : [];
  data.audioClips = Array.isArray(data.audioClips) ? data.audioClips : [];
  if (!data.shots.some(s => s.id === data.activeShotId)) data.activeShotId = data.shots[0].id;
  return data;
}
// canonical serialization — shots own their scene/keyframe data; no mirror duplication
function serializeProject() {
  return {
    version: 2, name: project.name, fps: project.fps,
    drawings: project.drawings, characters: project.characters,
    shots: project.shots, activeShotId: project.activeShotId,
    audioAssets: project.audioAssets, audioClips: project.audioClips,
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
        } catch { /* user must save a file */ }
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
const workspaces = ['draw', 'char', 'scene', 'anim'];
let activeWs = 'draw';

function setWorkspace(ws) {
  activeWs = ws;
  railBtns.forEach(b => b.classList.toggle('active', b.dataset.ws === ws));
  workspaces.forEach(w => document.getElementById('ws-' + w).classList.toggle('active', w === ws));
  if (ws === 'scene' || ws === 'anim') {
    resize3D();
    syncSceneObjects();
    if (!selectedId && project.sceneObjects.length) selectedId = project.sceneObjects[0].id;
    renderSceneList(); renderSceneProps(); renderAnimObjectSelect();
    if (ws === 'anim') { document.getElementById('anim-object').value = selectedId || ''; renderTimeline(); }
  }
  if (ws === 'draw') syncDrawSize();
  if (ws === 'char') { renderCharList(); drawCharPreview(); }
  updatePlaybar();
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
  captureCameraBase(); // remember the outgoing shot's framing
  project.activeShotId = id;
  const s = activeShot();
  project.sceneObjects = s.sceneObjects;
  project.keyframes = s.keyframes;
  project.duration = s.duration;
  selectedId = null; selectedTrack = null; selectedKey = null;
  animTime = clamp(animTime, 0, s.duration);
  applyCameraBase(s);
  syncSceneObjects();
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
  renderShotsUI(); syncShotControls(); updatePlayhead();
}
// remember the current editor camera as the active shot's base framing
function captureCameraBase() {
  const s = activeShot(); if (!s) return;
  s.camera = {
    pos: [camera.position.x, camera.position.y, camera.position.z],
    tgt: [controls.target.x, controls.target.y, controls.target.z],
    fov: camera.fov,
  };
}
// restore a shot's base framing (used when switching, playing back and exporting)
function applyCameraBase(s) {
  if (!s || !s.camera) return false;
  camera.position.fromArray(s.camera.pos);
  controls.target.fromArray(s.camera.tgt);
  camera.fov = s.camera.fov;
  camera.updateProjectionMatrix();
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
  const inp = document.getElementById('shot-duration');
  if (inp) inp.value = project.duration;
  const out = document.getElementById('shot-duration-out');
  if (out) out.textContent = project.duration + 's';
  const fpsOut = document.getElementById('anim-fps-out');
  if (fpsOut) fpsOut.textContent = project.fps;
  const fpsIn = document.getElementById('anim-fps');
  if (fpsIn) fpsIn.value = project.fps;
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
      ren.addEventListener('click', () => {
        const n = prompt('Shot name:', s.name);
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
function deleteShot() {
  if (project.shots.length < 2) { toast('A movie needs at least one shot'); return; }
  const s = activeShot();
  if (!confirm('Delete "' + s.name + '"?')) return;
  const idx = project.shots.indexOf(s);
  project.shots.splice(idx, 1);
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

function saveDrawingAsset() {
  if (!hasDrawnFlag) { toast('Nothing painted yet'); return; }
  const name = prompt('Asset name:', 'Drawing ' + (project.drawings.length + 1));
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
    charDrag = { key, rig, startAngle: Math.atan2(my - py, mx - px), startRot: rig.pivots[best] };
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
charCanvas.addEventListener('pointerup', () => { if (charDrag) { charDrag = null; markDirty(); renderSceneObjects3D(); } });
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
document.getElementById('btn-char-delete').addEventListener('click', () => {
  const rig = currentRig(); if (!rig) return;
  if (!confirm('Delete ' + rig.name + '?')) return;
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
sceneViewport.appendChild(renderer.domElement);

const three = new THREE.Scene();
three.background = new THREE.Color('#211d18');
three.fog = new THREE.Fog('#211d18', 26, 60);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
camera.position.set(8.5, 7, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 1.2, 0);

// lights
three.add(new THREE.HemisphereLight('#fff4e0', '#3a3226', 1.15));
const sun = new THREE.DirectionalLight('#ffe3b0', 1.9);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -16;
sun.shadow.camera.right = sun.shadow.camera.top = 16;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
three.add(sun);

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
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  camera.aspect = host.clientWidth / host.clientHeight;
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
  if (o.type === 'box' || o.type === 'sphere' || o.type === 'cylinder' || o.type === 'cone' || o.type === 'torus' || o.type === 'plane') {
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
    if (rig) {
      const plane = makeMesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: rigTexture(rig), transparent: true, side: THREE.DoubleSide, roughness: 0.85, alphaTest: 0.02 }));
      group.add(plane);
      group.userData.rigId = rig.id;
      group.userData.redraw = () => {
        const cur = project.characters.find(c => c.id === o.assetId);
        if (cur) { plane.material.map = rigTexture(cur); plane.material.needsUpdate = true; }
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
    const needsRebuild = !g || g.userData.builtFrom !== JSON.stringify([o.type, o.assetId, o.enginePart, o.color, o.opacity, o.text]);
    if (needsRebuild) {
      if (g) { three.remove(g); disposeGroup(g); }
      g = build3DObject(o);
      g.userData.builtFrom = JSON.stringify([o.type, o.assetId, o.enginePart, o.color, o.opacity, o.text]);
      objectGroups.set(o.id, g);
      three.add(g);
    }
    // apply transform
    g.position.fromArray(o.pos);
    g.rotation.set(...o.rot.map(r => r * Math.PI / 180));
    g.scale.fromArray(o.scale);
    // propagate opacity to materials (for primitives)
    if (o.opacity !== undefined && o.opacity < 1) {
      g.traverse(m => { if (m.material) { m.material.transparent = true; m.material.opacity = o.opacity; } });
    }
    if (o.type === 'character' && g.userData.redraw && g.userData.lastRigRev !== rigRevision(o.assetId)) {
      g.userData.lastRigRev = rigRevision(o.assetId);
      g.userData.redraw();
    }
  });
  updateSelectionVisuals();
}
// free GPU memory held by a removed group (geometries, materials, textures)
function disposeGroup(g) {
  g.traverse(m => {
    m.geometry?.dispose?.();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(mm => {
        mm.map?.dispose?.();
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
  if (!g) { gizmo.visible = false; selRing.visible = false; return; }
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
  if (hit === selectedId) {
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
    if (g) return g.userData.objId;
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
    color: '#ffffff', pos: (() => { const [x, z] = freeSpot(); return [x, 1.3, z]; })(), rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1,
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
document.getElementById('btn-clear-scene').addEventListener('click', () => {
  if (!confirm('Remove all objects from this shot?')) return;
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
  const t = document.createElement('div'); t.className = 'side-title'; t.textContent = 'Name';
  panel.appendChild(t);
  const nameIn = document.createElement('input'); nameIn.className = 'btn'; nameIn.style.width = '100%'; nameIn.style.textAlign = 'left';
  nameIn.value = o.name;
  nameIn.addEventListener('input', () => { o.name = nameIn.value; renderSceneList(); renderAnimObjectSelect(); markDirty(); });
  panel.appendChild(nameIn);

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
    project.sceneObjects.push(copy); selectObject(copy.id); markDirty();
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
  { ch: 'rot.y', label: 'Rotate Y' },
  { ch: 'scale', label: 'Scale' },
  { ch: 'opacity', label: 'Opacity' },
  { ch: 'pose', label: 'Character pose' },
];
const CAMERA_ID = '__camera__';
const CAM_CHANNELS = [
  { ch: 'cam.px', label: 'Cam pos X' }, { ch: 'cam.py', label: 'Cam pos Y' }, { ch: 'cam.pz', label: 'Cam pos Z' },
  { ch: 'cam.tx', label: 'Target X' }, { ch: 'cam.ty', label: 'Target Y' }, { ch: 'cam.tz', label: 'Target Z' },
  { ch: 'cam.fov', label: 'FOV' },
];
function channelsFor(o) { return o && o.type === 'camera' ? CAM_CHANNELS : CHANNELS; }
function objChannelValue(o, ch, t) {
  const kfs = (project.keyframes[o.id] || {})[ch] || [];
  if (!kfs.length) return null;
  return sampleTrack(kfs, t);
}
function sampleTrack(kfs, t) {
  if (!kfs.length) return null;
  if (t <= kfs[0].t) return kfs[0].v;
  if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].v;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t >= kfs[i].t && t <= kfs[i + 1].t) {
      const a = kfs[i], b = kfs[i + 1];
      const u = (t - a.t) / (b.t - a.t || 1);
      const eu = a.ease === 'step' ? 0 : a.ease === 'linear' ? u : smoothstep(u);
      return a.v + (b.v - a.v) * eu;
    }
  }
  return kfs[kfs.length - 1].v;
}
function smoothstep(u) { return u * u * (3 - 2 * u); }

// evaluateAt: the single source of truth for scrub, playback, and recording
function evaluateAt(t) {
  const T = clamp(t, 0, project.duration);
  project.sceneObjects.forEach(o => {
    const kf = project.keyframes[o.id] || {};
    const g = objectGroups.get(o.id);
    if (!g) return;
    // position
    const px = kf['pos.x'] ? sampleTrack(kf['pos.x'], T) : o.pos[0];
    const py = kf['pos.y'] ? sampleTrack(kf['pos.y'], T) : o.pos[1];
    const pz = kf['pos.z'] ? sampleTrack(kf['pos.z'], T) : o.pos[2];
    g.position.set(px, py, pz);
    // rotation (base + animated rot.y)
    const ry = kf['rot.y'] ? sampleTrack(kf['rot.y'], T) : o.rot[1];
    g.rotation.set(o.rot[0] * Math.PI / 180, ry * Math.PI / 180, o.rot[2] * Math.PI / 180);
    // scale
    if (kf['scale']) { const s = sampleTrack(kf['scale'], T); g.scale.set(o.scale[0] * s, o.scale[1] * s, o.scale[2] * s); }
    else g.scale.fromArray(o.scale);
    // opacity
    if (kf['opacity']) {
      const v = sampleTrack(kf['opacity'], T);
      g.traverse(m => { if (m.material) { m.material.transparent = true; m.material.opacity = v; } });
    }
    // pose (character)
    if (kf['pose'] && g.userData.redraw) {
      const rig = project.characters.find(c => c.id === o.assetId);
      if (rig) {
        const u = sampleTrack(kf['pose'], T);
        applyPose(rig, u);
        g.userData.redraw();
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
  // canvas sizing — the wrap spans the FULL duration (fully scrollable);
  // only the canvas backing store is capped, by lowering its resolution when huge.
  const wrapW = Math.round(project.duration * pxPerSec) + 30;
  const wrapH = tlKeys.parentElement.clientHeight || 160;
  const canvasRatio = Math.min(devicePixelRatio, 16000 / wrapW);
  tlCanvas.width = Math.max(1, Math.round(wrapW * canvasRatio));
  tlCanvas.height = Math.max(1, Math.round(wrapH * canvasRatio));
  tlCanvas.style.width = wrapW + 'px';
  tlCanvas.style.height = wrapH + 'px';
  document.getElementById('tl-canvas-wrap').style.width = wrapW + 'px';
  drawTimelineCanvas();
  renderKeys();
  updatePlayhead();
}
function drawTimelineCanvas() {
  const dpr = tlCanvas.width / (parseFloat(tlCanvas.style.width) || 1); // actual backing-store ratio (may be < devicePixelRatio)
  const W = tlCanvas.width / dpr, H = tlCanvas.height / dpr;
  tlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tlCtx.clearRect(0, 0, W, H);
  // seconds grid — step widens automatically so labels never collide
  const step = pxPerSec >= 200 ? 0.25 : pxPerSec >= 70 ? 0.5 : pxPerSec >= 35 ? 1 : pxPerSec >= 15 ? 2 : pxPerSec >= 7 ? 5 : 10;
  tlCtx.strokeStyle = '#332e27'; tlCtx.fillStyle = '#6e675c';
  tlCtx.font = '10px Outfit, sans-serif';
  for (let s = 0; s <= project.duration + 0.01; s += step) {
    const x = s * pxPerSec;
    tlCtx.beginPath(); tlCtx.moveTo(x, 0); tlCtx.lineTo(x, H); tlCtx.stroke();
    if (Math.abs(s % 1) < 0.01) tlCtx.fillText(s + 's', x + 3, 12);
  }
  // channel rows
  const o = selObj();
  if (!o) return;
  channelsFor(o).forEach((c, i) => {
    const y = 26 + i * 26;
    const kfs = (project.keyframes[o.id] || {})[c.ch] || [];
    // row bg
    tlCtx.fillStyle = selectedTrack?.ch === c.ch ? 'rgba(242,178,92,0.07)' : 'transparent';
    tlCtx.fillRect(0, y, W, 26);
    // value line
    if (kfs.length) {
      tlCtx.strokeStyle = 'rgba(242,178,92,0.5)'; tlCtx.lineWidth = 1.5;
      tlCtx.beginPath();
      for (let px = 0; px <= project.duration * pxPerSec; px += 3) {
        const t = px / pxPerSec;
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
          k.t = round2(nt);
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
      tlKeys.appendChild(el);
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
}

// scrub
tlScroll.addEventListener('pointerdown', e => {
  if (recMode) return; // no scrubbing while exporting
  if (e.target.closest('.tl-key')) return;
  const rect = tlScroll.getBoundingClientRect();
  const setFromEvent = ev => {
    const x = ev.clientX - rect.left + tlScroll.scrollLeft;
    animTime = clamp(x / pxPerSec, 0, project.duration);
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
  else kf[ch].push({ t: round2(animTime), v, ease });
  sortKeys(o.id, ch);
  markDirty(); renderTimeline(); renderAnimObjectSelect();
  toast('Keyframe added at ' + animTime.toFixed(2) + 's');
});
function currentChannelValue(o, ch) {
  switch (ch) {
    case 'pos.x': return o.pos[0];
    case 'pos.y': return o.pos[1];
    case 'pos.z': return o.pos[2];
    case 'rot.y': return o.rot[1];
    case 'scale': return 1;
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
  controls.update();
  drawAxisBadge();
  renderer.render(three, camera);
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
const audioNodes = new Map(); // assetId -> { el, gain }
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
function audioNodeFor(assetId) {
  let n = audioNodes.get(assetId);
  if (!n) {
    const asset = project.audioAssets.find(a => a.id === assetId);
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
      gain.connect(masterGain);
      n = { el, gain };
      audioNodes.set(assetId, n);
    } catch { return null; }
  }
  return n;
}
function syncAudio(t) {
  getAudioCtx();
  project.audioClips.forEach(clip => {
    const n = audioNodeFor(clip.assetId); if (!n) return;
    n.gain.gain.value = clip.volume ?? 1;
    const dur = isFinite(n.el.duration) ? n.el.duration : 0;
    const local = t - clip.start;
    const should = local >= -0.05 && (dur === 0 || local < dur);
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
      project.audioClips = project.audioClips.filter(c => c !== clip);
      markDirty(); renderAudioList();
    });
    row.append(r1, r2, del);
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
}
document.getElementById('btn-movie')?.addEventListener('click', () => { moviePlaying ? stopMovie() : playMovie(); });

// don't lose a recording to an accidental tab close
window.addEventListener('beforeunload', e => {
  if (recMode) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================================================
   Movie export (MediaRecorder, fixed resolution, with audio)
   ============================================================ */
const recStatus = document.getElementById('rec-status');
let mediaRecorder = null, recordedChunks = [];
let recStart = 0, recHiddenTotal = 0, recHiddenSince = 0;

async function exportMovie() {
  if (exportFinalizing) { toast('Still saving the previous export…'); return; }
  if (recMode) { // acts as Stop while exporting — saves what was recorded
    recStatus.textContent = 'Stopping — saving partial movie…';
    finishExport(exportRestore.shotId, exportRestore.cam);
    return;
  }
  if (!project.shots.length) { toast('Add a shot first'); return; }
  if (!window.MediaRecorder) { toast('This browser cannot record video'); return; }
  const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = mimes.find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { toast('No supported video format'); return; }
  if (moviePlaying) stopMovie();
  setPlaying(false);
  const resSel = document.getElementById('export-res');
  const qualSel = document.getElementById('export-quality');
  const W = parseInt(resSel ? resSel.value : '1280', 10) || 1280;
  const H = Math.round(W * 9 / 16);
  const kbps = { high: 8000, medium: 4000, low: 2500 }[qualSel ? qualSel.value : 'high'] || 8000;

  const ext = mime.includes('webm') ? 'webm' : 'mp4';
  const fileName = (project.name || 'videocraft').replace(/[^a-z0-9-_]+/gi, '_') + '.' + ext;

  // ask for the save file FIRST (inside the click gesture) so no movie time is lost to the dialog;
  // if the browser can't / the user cancels, we fall back to an in-memory recording + download.
  let fileHandle = null;
  if (window.showSaveFilePicker) {
    try {
      fileHandle = await showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Video', accept: { 'video/webm': ['.webm'] } }],
      });
    } catch { /* cancelled or not allowed — in-memory fallback */ }
  }

  // fixed export frame — restored afterwards
  exportRestore = {
    shotId: project.activeShotId,
    cam: { pos: camera.position.clone(), tgt: controls.target.clone(), fov: camera.fov },
    pixelRatio: renderer.getPixelRatio(),
  };
  renderer.setPixelRatio(1); // square pixels: no DPR double-sampling in the video
  renderer.setSize(W, H, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  controls.enabled = false;

  // one video track + one mixed audio track
  const tracks = [renderer.domElement.captureStream(project.fps).getVideoTracks()[0]];
  getAudioCtx();
  if (exportDest) tracks.push(exportDest.stream.getAudioTracks()[0]);
  const stream = new MediaStream(tracks);

  recordedChunks = [];
  let fsWritable = null, diskError = null, writeIdx = 0, drainPromise = null;
  if (fileHandle) {
    try { fsWritable = await fileHandle.createWritable(); } catch { fsWritable = null; } // in-memory fallback
  }
  // serialize disk writes; the running loop keeps picking up newly queued chunks
  const drain = () => {
    if (!drainPromise) drainPromise = (async () => {
      try {
        while (fsWritable && writeIdx < recordedChunks.length) {
          await fsWritable.write(recordedChunks[writeIdx]);
          writeIdx++;
        }
      } catch (err) { diskError = err; fsWritable = null; }
    })().finally(() => { drainPromise = null; });
    return drainPromise;
  };
  const saveRecording = async () => {
    try {
      if (fsWritable) {
        await drain(); // every queued chunk is submitted before closing
        if (diskError) throw diskError;
        await fsWritable.close();
        toast('Movie saved to the file you chose (' + W + '×' + H + ')');
      } else {
        const blob = new Blob(recordedChunks, { type: mime });
        downloadBlob(blob, fileName);
        toast('Movie exported (' + ext.toUpperCase() + ', ' + W + '×' + H + ') — check your downloads');
      }
    } catch (err) {
      console.error('save failed', err);
      toast('Could not save the recording — the write failed. Try again or use a shorter movie.');
    }
    exportFinalizing = false;
    recStatus.textContent = '';
    const rBtn = document.getElementById('btn-record');
    rBtn.disabled = false; rBtn.textContent = 'Export movie';
    document.getElementById('btn-download-video').disabled = false;
  };
  mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: kbps * 1000, audioBitsPerSecond: 128000 });
  mediaRecorder.ondataavailable = e => { if (e.data.size) { recordedChunks.push(e.data); drain(); } };
  mediaRecorder.onerror = e => { console.error('MediaRecorder error', e.error); toast('Recorder error: ' + (e.error?.message || 'unknown')); finishExport(exportRestore.shotId, exportRestore.cam); };
  mediaRecorder.onstop = saveRecording;

  const total = totalDuration();

  // pre-roll: show shot 1 at t=0 so the recording starts on a real frame
  applyShotPlayback(project.shots[0].id);
  evaluateAt(0);
  renderer.render(three, camera);

  mediaRecorder.start(1000);
  recMode = true;
  recStart = performance.now(); recHiddenTotal = 0; recHiddenSince = 0;
  recStatus.textContent = 'Recording ' + W + '×' + H + ' — the movie plays once in real time (' + fmtDur(total) + '). Keep this tab visible.';
  const rBtn = document.getElementById('btn-record');
  rBtn.disabled = false; rBtn.textContent = 'Stop export';
  document.getElementById('btn-download-video').disabled = true;

  const step = () => {
    if (!recMode) return;
    const elapsed = (performance.now() - recStart - recHiddenTotal) / 1000;
    let acc = 0, idx = project.shots.length - 1;
    for (let i = 0; i < project.shots.length; i++) {
      if (elapsed < acc + Math.max(0.5, project.shots[i].duration)) { idx = i; break; }
      acc += Math.max(0.5, project.shots[i].duration);
    }
    const s = project.shots[idx];
    if (s.id !== project.activeShotId) applyShotPlayback(s.id);
    animTime = clamp(elapsed - shotStart(idx), 0, s.duration);
    evaluateAt(animTime);
    syncAudio(Math.min(elapsed, total));
    updatePlayhead();
    if (elapsed >= total + 0.2) { finishExport(exportRestore.shotId, exportRestore.cam); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let exportRestore = null;
let exportFinalizing = false; // true from recorder stop until the file is saved
function finishExport(prevShotId, prevCam) {
  recMode = false;
  exportFinalizing = true; // blocks a new export until saving finishes
  stopAudio();
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
  // restore editor state WITHOUT capturing a camera base (a capture here would
  // overwrite the last exported shot's framing with the restored editor camera)
  applyShotPlayback(prevShotId);
  camera.position.copy(prevCam.pos);
  controls.target.copy(prevCam.tgt);
  camera.fov = prevCam.fov;
  camera.updateProjectionMatrix();
  controls.enabled = true;
  if (exportRestore) renderer.setPixelRatio(exportRestore.pixelRatio);
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
document.getElementById('btn-download-video').addEventListener('click', exportMovie);

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
      loadProjectData(data);
      selectedId = null; currentCharId = project.characters[0]?.id || null;
      document.getElementById('project-tag').textContent = project.name;
      applyShot(project.activeShotId);
      markDirty();
      renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
      renderAudioList();
      toast('Project loaded: ' + project.name + ' (' + project.shots.length + ' shot' + (project.shots.length > 1 ? 's' : '') + ')');
    } catch { toast('That file is not a VideoCraft project'); }
    e.target.value = '';
  };
  reader.readAsText(f);
});
document.getElementById('btn-starter').addEventListener('click', loadStarterScene);
document.getElementById('btn-new').addEventListener('click', () => {
  const hasWork = project.shots.some(s => s.sceneObjects.length) || project.drawings.length;
  if (hasWork && !confirm('Start a new movie? Unsaved work will be lost.')) return;
  project = defaultProject();
  currentCharId = null; selectedId = null;
  document.getElementById('project-tag').textContent = project.name;
  markDirty();
  clearDraw();
  applyShot(project.shots[0].id);
  renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
  renderAudioList();
  toast('New movie');
});

/* ============================================================
   Starter demo — a two-shot mini movie: engine room + hero close-up
   ============================================================ */
function loadStarterScene() {
  const hasWork = project.shots.some(s => s.sceneObjects.length) || project.drawings.length;
  if (hasWork && !confirm('Replace the current movie with the starter scene?')) return;
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
   Boot
   ============================================================ */
loadSaved();
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
setWorkspace('draw');
syncDrawSize();
requestAnimationFrame(tick);
window.addEventListener('resize', () => { syncDrawSize(); resize3D(); renderTimeline(); });
markDirty();

// test/QA hook (harmless in production)
window.__vc = {
  get project() { return project; },
  get camera() { return camera; },
  evaluateAt,
  get recorder() { return mediaRecorder; },
  get chunkCount() { return recordedChunks.length; },
  playingAudioCount: () => [...audioNodes.values()].filter(n => !n.el.paused).length,
  clipInfo: () => project.audioClips.map(c => ({ start: c.start, vol: c.volume, asset: (project.audioAssets.find(a => a.id === c.assetId) || {}).name })),
  audioDebug: () => ({
    ctxState: audioCtx ? audioCtx.state : 'none',
    nodes: [...audioNodes.entries()].map(([id, n]) => ({ id, paused: n.el.paused, ct: Math.round(n.el.currentTime * 100) / 100, ready: n.el.readyState })),
    masterConnected: !!(masterGain && exportDest),
  }),
};
