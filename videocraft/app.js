// VideoCraft — draw / build / animate in the browser. ArtCraft family tool.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   Shared project model
   ============================================================ */
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

function defaultProject() {
  return {
    name: 'Untitled project',
    duration: 5,
    fps: 30,
    drawings: [],          // { id, name, dataURL }  raster assets
    characters: [],        // character rigs (see below)
    sceneObjects: [],      // see below
    keyframes: {},         // [sceneObjectId][channel] -> [{t, v, ease}]
  };
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
const SAVE_KEY = 'videocraft_project_v1';
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
        storage.setItem(SAVE_KEY, JSON.stringify(project));
        dirty = false;
        if (el) el.textContent = 'Saved automatically';
      } catch { /* quota exceeded — user must save a file */ }
    }, 600);
  }
}
function loadSaved() {
  if (!storage) return;
  try { const raw = storage.getItem(SAVE_KEY); if (raw) project = JSON.parse(raw); } catch { /* fresh start */ }
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
      project.sceneObjects = project.sceneObjects.filter(o => o.assetId !== a.id);
      deleteKeyframesByAsset(a.id);
      markDirty(); renderAssetList(); renderSceneList(); renderAnimObjectSelect();
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
  project.sceneObjects = project.sceneObjects.filter(o => o.assetId !== rig.id);
  deleteKeyframesByAsset(rig.id);
  currentCharId = project.characters[0]?.id || null;
  markDirty(); renderCharList(); drawCharPreview(); renderCharProps(); renderSceneList(); renderAnimObjectSelect();
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
    if (!project.sceneObjects.find(o => o.id === id)) { three.remove(g); objectGroups.delete(id); }
  }
  // add new / refresh
  project.sceneObjects.forEach(o => {
    let g = objectGroups.get(o.id);
    const needsRebuild = !g || g.userData.builtFrom !== JSON.stringify([o.type, o.assetId, o.enginePart, o.color, o.opacity]);
    if (needsRebuild) {
      if (g) three.remove(g);
      g = build3DObject(o);
      g.userData.builtFrom = JSON.stringify([o.type, o.assetId, o.enginePart, o.color, o.opacity]);
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
const rigRevisions = {};
function rigRevision(id) { return rigRevisions[id] || 0; }
function bumpRigRevision(id) { rigRevisions[id] = (rigRevisions[id] || 0) + 1; }
function deleteKeyframesByAsset(assetId) {
  const ids = project.sceneObjects.filter(o => o.assetId === assetId).map(o => o.id);
  project.sceneObjects = project.sceneObjects.filter(o => o.assetId !== assetId);
  ids.forEach(id => delete project.keyframes[id]);
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
function selObj() { return project.sceneObjects.find(o => o.id === selectedId) || null; }

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
document.getElementById('btn-clear-scene').addEventListener('click', () => {
  if (!confirm('Remove all objects from the scene?')) return;
  project.sceneObjects = [];
  project.keyframes = {};
  selectedId = null;
  markDirty(); renderSceneList(); renderSceneProps(); renderAnimObjectSelect();
});

/* ---------- scene props panel ---------- */
function renderSceneProps() {
  const panel = document.getElementById('scene-props');
  panel.innerHTML = '';
  const o = selObj();
  if (!o) { panel.innerHTML = '<div class="empty-state"><b>Nothing selected</b>Click an object in the 3D view or the list.</div>'; return; }
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
    project.sceneObjects = project.sceneObjects.filter(x => x.id !== o.id);
    delete project.keyframes[o.id];
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
let selectedTrack = null; // sceneObject id + channel {id, ch}
let selectedKey = null; // {id, ch, index}

const CHANNELS = [
  { ch: 'pos.x', label: 'Pos X' }, { ch: 'pos.y', label: 'Pos Y' }, { ch: 'pos.z', label: 'Pos Z' },
  { ch: 'rot.y', label: 'Rotate Y' },
  { ch: 'scale', label: 'Scale' },
  { ch: 'opacity', label: 'Opacity' },
  { ch: 'pose', label: 'Character pose' },
];
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
  project.sceneObjects.forEach(o => {
    const op = document.createElement('option');
    op.value = o.id; op.textContent = o.name + (Object.keys(project.keyframes[o.id] || {}).some(ch => (project.keyframes[o.id][ch] || []).length) ? ' •' : '');
    sel.appendChild(op);
  });
  if (!project.sceneObjects.length) { const op = document.createElement('option'); op.textContent = 'No objects yet'; sel.appendChild(op); }
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
    CHANNELS.forEach(c => {
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
  // canvas sizing — canvas spans the full (possibly scrolled) wrap width
  const wrapW = Math.round(project.duration * pxPerSec) + 30;
  const wrapH = tlKeys.parentElement.clientHeight || 160;
  tlCanvas.width = wrapW * devicePixelRatio;
  tlCanvas.height = wrapH * devicePixelRatio;
  tlCanvas.style.width = wrapW + 'px';
  tlCanvas.style.height = wrapH + 'px';
  document.getElementById('tl-canvas-wrap').style.width = wrapW + 'px';
  drawTimelineCanvas();
  renderKeys();
  updatePlayhead();
}
function drawTimelineCanvas() {
  const dpr = devicePixelRatio;
  const W = tlCanvas.width / dpr, H = tlCanvas.height / dpr;
  tlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tlCtx.clearRect(0, 0, W, H);
  // seconds grid
  const step = pxPerSec > 70 ? 0.5 : 1;
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
  CHANNELS.forEach((c, i) => {
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
  CHANNELS.forEach((c, ci) => {
    const kfs = (project.keyframes[o.id] || {})[c.ch] || [];
    kfs.forEach((k, i) => {
      const el = document.createElement('div');
      el.className = 'tl-key' + (selectedKey?.ch === c.ch && selectedKey?.index === i && selectedKey?.id === o.id ? ' selected' : '');
      el.style.left = (k.t * pxPerSec) + 'px';
      el.style.top = (26 + ci * 26 + 13) + 'px';
      el.setAttribute('aria-label', 'Keyframe at ' + k.t.toFixed(2) + 's');
      el.addEventListener('pointerdown', e => {
        e.target.setPointerCapture?.(e.pointerId);
        selectedKey = { id: o.id, ch: c.ch, index: i };
        selectedTrack = { id: o.id, ch: c.ch };
        const startX = e.clientX, startT = k.t;
        const move = ev => {
          const dx = ev.clientX - startX;
          let nt = clamp(startT + dx / pxPerSec, 0, project.duration);
          k.t = round2(nt);
          sortKeys(o.id, c.ch);
          selectedKey.index = kfs.indexOf(k);
          renderTimeline();
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          markDirty(); renderTimeline();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
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
  document.getElementById('time-label').textContent = animTime.toFixed(2) + 's / ' + project.duration.toFixed(1) + 's';
}

// scrub
tlScroll.addEventListener('pointerdown', e => {
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
  playing = p;
  document.getElementById('icon-play').style.display = p ? 'none' : '';
  document.getElementById('icon-pause').style.display = p ? '' : 'none';
}
btnPlay.addEventListener('click', () => setPlaying(!playing));
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && activeWs === 'anim' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
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
  pxPerSec = Math.max(40, (tlScroll.clientWidth - 60) / project.duration);
  renderTimeline();
});
document.getElementById('anim-duration').addEventListener('input', e => {
  project.duration = +e.target.value;
  animTime = clamp(animTime, 0, project.duration);
  markDirty(); renderTimeline(); updatePlaybar();
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
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastFrameTs) / 1000, 0.1);
  lastFrameTs = now;
  if (playing) {
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
   Video export (MediaRecorder)
   ============================================================ */
const recStatus = document.getElementById('rec-status');
let mediaRecorder = null, recordedChunks = [];
let recordedFrames = []; // frame blobs for the project

document.getElementById('btn-record').addEventListener('click', async () => {
  if (!project.sceneObjects.length) { toast('Scene is empty — nothing to record'); return; }
  if (!window.MediaRecorder) { toast('This browser cannot record video'); return; }
  const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = mimes.find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { toast('No supported video format'); return; }
  // stop playback, go to 0
  setPlaying(false);
  animTime = 0;
  evaluateAt(0);
  renderTimeline();
  recordedChunks = [];
  const stream = renderer.domElement.captureStream(project.fps);
  mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  mediaRecorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mime });
    const ext = mime.includes('webm') ? 'webm' : 'mp4';
    downloadBlob(blob, (project.name || 'videocraft').replace(/[^a-z0-9-_]+/gi, '_') + '.' + ext);
    recStatus.textContent = '';
    toast('Video saved (' + ext.toUpperCase() + ') — check your downloads');
    document.getElementById('btn-record').disabled = false;
  };
  mediaRecorder.start(100);
  recMode = true;
  recStatus.textContent = 'Recording… plays once in real time (' + project.duration + 's)';
  document.getElementById('btn-record').disabled = true;
  // play from 0 to duration in real time
  const startTs = performance.now();
  const step = () => {
    const elapsed = (performance.now() - startTs) / 1000;
    animTime = clamp(elapsed, 0, project.duration);
    evaluateAt(animTime);
    updatePlayhead();
    if (elapsed >= project.duration + 0.15) {
      mediaRecorder.stop();
      recMode = false;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
document.getElementById('btn-download-video').addEventListener('click', () => {
  if (activeWs !== 'anim') setWorkspace('anim');
  document.getElementById('btn-record').click();
});

/* ============================================================
   Project save / open / new
   ============================================================ */
document.getElementById('btn-save').addEventListener('click', () => {
  const data = JSON.stringify(project, null, 1);
  downloadBlob(new Blob([data], { type: 'application/json' }), (project.name || 'videocraft').replace(/[^a-z0-9-_]+/gi, '_') + '.videocraft.json');
  dirty = false;
  document.getElementById('save-state').textContent = '';
  toast('Project file saved to downloads');
});
document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-open').click());
document.getElementById('file-open').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.sceneObjects || !data.characters) throw new Error('bad file');
      project = data;
      project.name = project.name || 'Untitled project';
      selectedId = null; currentCharId = project.characters[0]?.id || null;
      document.getElementById('project-tag').textContent = project.name;
      markDirty();
      syncSceneObjects(); renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
      renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
      document.getElementById('anim-duration').value = project.duration;
      toast('Project loaded: ' + project.name);
    } catch { toast('That file is not a VideoCraft project'); }
    e.target.value = '';
  };
  reader.readAsText(f);
});
document.getElementById('btn-starter').addEventListener('click', loadStarterScene);
document.getElementById('btn-new').addEventListener('click', () => {
  if (project.sceneObjects.length && !confirm('Start a new project? Unsaved work will be lost.')) return;
  project = defaultProject();
  currentCharId = null; selectedId = null;
  document.getElementById('project-tag').textContent = project.name;
  markDirty();
  clearDraw();
  syncSceneObjects(); renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
  toast('New project');
});

/* ============================================================
   Starter demo — draws an asset, builds an engine + hero, keys it
   ============================================================ */
function loadStarterScene() {
  if ((project.sceneObjects.length || project.drawings.length) && !confirm('Replace the current project with the starter scene?')) return;
  project = defaultProject();
  project.name = 'Starter — spinning engine';
  selectedId = null; currentCharId = null;

  // 1) draw an asset programmatically (a sunny poster)
  const c = document.createElement('canvas'); c.width = c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = '#f6d8a8'; x.fillRect(0, 0, 400, 400);
  x.fillStyle = '#e8836b'; x.beginPath(); x.arc(200, 250, 90, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#5b4632'; x.font = '700 44px Outfit, sans-serif'; x.textAlign = 'center';
  x.fillText('VideoCraft', 200, 70);
  x.font = '400 22px Outfit, sans-serif'; x.fillStyle = '#7a5b3a';
  x.fillText('draw → build → animate', 200, 110);
  project.drawings.push({ id: uid('draw'), name: 'Sun poster', dataURL: c.toDataURL('image/png') });

  // 2) a hero character
  const hero = defaultRig('Hero');
  project.characters.push(hero);
  currentCharId = hero.id;

  // 3) scene objects: engine assembly + poster + hero
  const mk = (o) => { project.sceneObjects.push(o); return o; };
  const block = mk({ id: uid('obj'), name: 'Engine block', type: 'engineKit', enginePart: 'block', color: '#8a8f96', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const fly = mk({ id: uid('obj'), name: 'Flywheel', type: 'engineKit', enginePart: 'flywheel', color: '#8a8f96', pos: [2.4, 1.15, 0], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const crank = mk({ id: uid('obj'), name: 'Crankshaft', type: 'engineKit', enginePart: 'crankshaft', color: '#8a8f96', pos: [0, 0.35, 1.7], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });
  const poster = mk({ id: uid('obj'), name: 'Sun poster', type: 'drawing', assetId: project.drawings[0].id, color: '#fff', pos: [-4.5, 1.7, -2], rot: [0, 24, 0], scale: [1, 1, 1], opacity: 1 });
  const heroObj = mk({ id: uid('obj'), name: 'Hero', type: 'character', assetId: hero.id, color: '#fff', pos: [-5, 1.3, 2.5], rot: [0, 0, 0], scale: [1, 1, 1], opacity: 1 });

  // 4) keyframes: flywheel + crank spin, hero walks past, wave at the end
  project.duration = 6;
  const kf = project.keyframes;
  kf[fly.id] = { 'rot.y': [{ t: 0, v: 0, ease: 'linear' }, { t: 6, v: 720, ease: 'linear' }] };
  kf[crank.id] = { 'rot.y': [{ t: 0, v: 0, ease: 'linear' }, { t: 6, v: 720, ease: 'linear' }] };
  kf[heroObj.id] = {
    'pos.x': [{ t: 0, v: -5, ease: 'ease' }, { t: 4, v: 3.5, ease: 'ease' }],
    'pos.z': [{ t: 0, v: 2.5, ease: 'ease' }, { t: 4, v: 2.5, ease: 'ease' }],
    'pose': [{ t: 0, v: 0, ease: 'linear' }, { t: 3.5, v: 7, ease: 'linear' }, { t: 4, v: 0, ease: 'linear' }],
  };
  hero._base = { ...hero.pivots };

  // load the poster onto the draw canvas too, so Draw workspace shows something real
  const img = new Image();
  img.onload = () => { drawCtx.clearRect(0, 0, DRAW_W, DRAW_H); drawCtx.drawImage(img, 0, 0, DRAW_W, DRAW_H); hasDrawnFlag = true; document.getElementById('draw-hint').classList.add('hidden'); };
  img.src = project.drawings[0].dataURL;

  document.getElementById('project-tag').textContent = project.name;
  document.getElementById('anim-duration').value = project.duration;
  selectedId = fly.id;
  markDirty();
  syncSceneObjects(); renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
  renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
  setWorkspace('anim');
  toast('Starter scene loaded — press Space to play');
}

/* ============================================================
   Boot
   ============================================================ */
loadSaved();
document.getElementById('project-tag').textContent = project.name;
if (!project.characters.length && !project.sceneObjects.length && !project.drawings.length) {
  // first visit: starter character so the app never feels empty
  const rig = defaultRig('Hero');
  project.characters.push(rig);
  currentCharId = rig.id;
}
document.getElementById('char-name').value = currentRig()?.name || '';
renderAssetList(); renderCharList(); drawCharPreview(); renderCharProps();
syncSceneObjects();
renderSceneList(); renderSceneProps(); renderAnimObjectSelect(); renderTimeline();
setWorkspace('draw');
syncDrawSize();
requestAnimationFrame(tick);
window.addEventListener('resize', () => { syncDrawSize(); resize3D(); renderTimeline(); });
markDirty();
