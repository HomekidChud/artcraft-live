import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { buildModel, disposeModel } from './models.js';
import { PRODUCTION_TABS, PART_TYPES, newPart, validateModel, modelTemplate, modelInstance, makeId } from './production.js';
import { FORGE_PART_TYPES, newBone, newPart as newForgePart, humanoidTemplate, blankCharacter, validateCharacter } from './charcraft.js';
import { buildCharacterGroup } from './charbuild.js';

const names = { plan: 'Planning', design: 'Design', assets: 'Assets', board: 'Storyboard', sound: 'Sound', delivery: 'Delivery', forge: 'Forge' };
const icons = {
  plan: '<path d="M8 4H5v17h14V4h-3M9 2h6v5H9zM8 12h8M8 16h5"/>',
  design: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>',
  assets: '<path d="M3 6h7l2-3h9v17H3zM7 11h10M7 15h6"/>',
  board: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16M2 12h20"/>',
  sound: '<path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  delivery: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  forge: '<circle cx="12" cy="5" r="2.4"/><path d="M12 8v5M7 21c0-4 2.2-6.5 5-6.5s5 2.5 5 6.5M8.5 11.5 6 13M15.5 11.5 18 13"/>',
};
export function installWorkspaceShell() {
  const rail = document.getElementById('rail');
  for (const key of PRODUCTION_TABS) {
    const button = document.createElement('button');
    button.className = 'rail-btn'; button.dataset.ws = key; button.title = names[key];
    button.setAttribute('aria-label', names[key] + ' workspace');
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[key]}</svg>`;
    rail.append(button);
    const section = document.createElement('section'); section.id = 'ws-' + key;
    section.className = 'ws production-ws'; section.setAttribute('aria-label', names[key]);
    document.getElementById('content').append(section);
  }
  const labels = { ...names, draw: 'Draw', char: 'Cast', scene: 'Scene', anim: 'Animate', music: 'Music' };
  for (const key of ['plan', 'design', 'draw', 'char', 'forge', 'assets', 'scene', 'board', 'anim', 'music', 'sound', 'delivery']) {
    const button = rail.querySelector(`[data-ws="${key}"]`);
    const label = document.createElement('span'); label.className = 'rail-label'; label.textContent = labels[key];
    button.append(label); rail.append(button);
  }
}

const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (label, action, primary = false) => {
  const el = node('button', 'btn' + (primary ? ' primary' : ''), label); el.addEventListener('click', action); return el;
};
function field(parent, label, value, update, options = {}) {
  const wrap = node('label', 'studio-field'), caption = node('span', 'studio-label', label);
  const el = node(options.multiline ? 'textarea' : 'input', 'studio-input');
  el.setAttribute('aria-label', label);
  if (options.multiline || !options.type) el.maxLength = 1000000;
  if (!options.multiline) el.type = options.type || 'text';
  if (options.min !== undefined) el.min = options.min;
  if (options.max !== undefined) el.max = options.max;
  if (options.step !== undefined) el.step = options.step;
  if (options.multiline) el.rows = options.rows || 4;
  el.value = value ?? ''; el.addEventListener(options.type === 'number' ? 'change' : 'input', () => update(el.value));
  wrap.append(caption, el); parent.append(wrap); return el;
}
function select(parent, label, value, values, update) {
  const wrap = node('label', 'studio-field'), el = node('select', 'studio-input');
  el.setAttribute('aria-label', label);
  values.forEach(v => { const option = node('option', '', Array.isArray(v) ? v[1] : v); option.value = Array.isArray(v) ? v[0] : v; el.append(option); });
  el.value = value; el.addEventListener('change', () => update(el.value));
  wrap.append(node('span', 'studio-label', label), el); parent.append(wrap); return el;
}
function heading(parent, kicker, title, description) {
  const head = node('header', 'studio-heading');
  head.append(node('div', 'studio-kicker', kicker), node('h2', '', title), node('p', '', description)); parent.append(head);
}
function panel(parent, title) {
  const el = node('section', 'studio-panel'); if (title) el.append(node('h3', '', title)); parent.append(el); return el;
}
function downloadJSON(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = node('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function createStudioWorkspaces(api) {
  let current = '', selectedPart = null, designRenderer, designScene, designCamera, designControls, designGroup, designOutline;
  let designHost, designFrame = 0, designDirty = true, designResizeObserver, selectDesignPart = () => {};
  const p = () => api.project();
  const s = () => p().studio;
  const change = () => { api.dirty(); };
  const open = tab => api.workspace(tab);
  const root = tab => { const el = document.getElementById('ws-' + tab); el.replaceChildren(); return el; };
  const addModel = asset => { api.placeObject(modelInstance(asset)); api.toast('Model placed in the current shot'); };

  function planning() {
    const el = root('plan');
    heading(el, 'PRE-PRODUCTION', 'Every movie starts with a plan.', 'Develop the idea, write your script and track the work. Everything here travels with your project file.');
    const grid = node('div', 'studio-grid'); el.append(grid);
    const brief = panel(grid, 'Creative brief');
    field(brief, 'Movie title', p().name, value => { p().name = value || 'Untitled movie'; document.getElementById('project-tag').textContent = p().name; change(); });
    select(brief, 'Production stage', s().plan.stage, ['Development', 'Pre-production', 'Production', 'Post-production', 'Ready to release'], v => { s().plan.stage = v; change(); });
    field(brief, 'Genre', s().plan.genre, v => { s().plan.genre = v; change(); });
    field(brief, 'Intended audience', s().plan.audience, v => { s().plan.audience = v; change(); });
    field(brief, 'Logline', s().plan.logline, v => { s().plan.logline = v; change(); }, { multiline: true, rows: 3 });
    field(brief, 'Synopsis / creative direction', s().plan.synopsis, v => { s().plan.synopsis = v; change(); }, { multiline: true, rows: 6 });
    const writing = panel(grid, 'Script & production notes');
    field(writing, 'Script', s().plan.script, v => { s().plan.script = v; change(); }, { multiline: true, rows: 17 });
    writing.append(button('Open storyboard', () => open('board')));
    const tasks = panel(el, 'Production checklist'), taskRow = node('div', 'studio-toolbar');
    const input = node('input', 'studio-input'); input.placeholder = 'A prop to build, a shot to finish…'; input.setAttribute('aria-label', 'New production task');
    const list = node('div', 'studio-task-list');
    const renderTasks = () => {
      list.replaceChildren();
      if (!s().plan.tasks.length) list.append(node('p', 'studio-muted', 'No tasks yet. Add one to start your production checklist.'));
      s().plan.tasks.forEach(task => {
        const row = node('div', 'studio-task'), label = node('label');
        const check = node('input'); check.type = 'checkbox'; check.checked = task.done; check.setAttribute('aria-label', 'Complete ' + task.text);
        check.addEventListener('change', () => { task.done = check.checked; change(); renderTasks(); });
        label.classList.toggle('complete', task.done); label.append(check, node('span', '', task.text));
        row.append(label, button('Remove', () => { s().plan.tasks = s().plan.tasks.filter(t => t.id !== task.id); change(); renderTasks(); })); list.append(row);
      });
    };
    const addTask = () => { if (!input.value.trim()) return; s().plan.tasks.push({ id: makeId('task'), text: input.value.trim(), done: false }); input.value = ''; change(); renderTasks(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
    taskRow.append(input, button('Add task', addTask, true)); tasks.append(taskRow, list); renderTasks();
  }

  function resizeDesign() {
    if (!designRenderer || !designHost) return;
    const r = designHost.getBoundingClientRect(); if (!r.width || !r.height) return;
    designRenderer.setSize(r.width, r.height); designCamera.aspect = r.width / r.height; designCamera.updateProjectionMatrix(); designDirty = true;
  }
  function refreshDesign() {
    if (!designScene) return;
    if (designOutline) { designScene.remove(designOutline); designOutline.dispose(); designOutline = null; }
    if (designGroup) { designScene.remove(designGroup); disposeModel(designGroup); }
    designGroup = buildModel(s().draft.parts); designScene.add(designGroup);
    const chosen = designGroup.children.find(c => c.userData.partId === selectedPart);
    if (chosen) { designOutline = new THREE.BoxHelper(chosen, '#efb855'); designScene.add(designOutline); }
    designDirty = true;
  }
  function designLoop() {
    designFrame = 0;
    if (current !== 'design') return;
    designControls.update();
    if (designDirty) { designRenderer.render(designScene, designCamera); designDirty = false; }
    designFrame = requestAnimationFrame(designLoop);
  }
  function bootDesign(host) {
    designHost = host;
    if (!designRenderer) {
      designRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      designRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      designRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      designRenderer.toneMappingExposure = 1.2;
      designScene = new THREE.Scene(); designScene.background = new THREE.Color('#25262b');
      designCamera = new THREE.PerspectiveCamera(43, 1, 0.05, 300); designCamera.position.set(5, 3.5, 6);
      designControls = new OrbitControls(designCamera, designRenderer.domElement); designControls.target.set(0, 1, 0);
      designControls.enableDamping = true; designControls.addEventListener('change', () => { designDirty = true; });
      designScene.add(new THREE.HemisphereLight('#fff4dc', '#536079', 2.4));
      const key = new THREE.DirectionalLight('#ffe5c2', 3); key.position.set(4, 7, 5); designScene.add(key);
      const rim = new THREE.DirectionalLight('#86aeff', 2); rim.position.set(-5, 3, -4); designScene.add(rim);
      designScene.add(new THREE.GridHelper(16, 16, '#666b76', '#363b45'));
      designRenderer.domElement.setAttribute('aria-label', '3D model design preview');
      let pointerStart = null;
      designRenderer.domElement.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
      designRenderer.domElement.addEventListener('pointerup', event => {
        if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 6 || !designGroup) return;
        const rect = designRenderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), designCamera);
        const hit = ray.intersectObjects(designGroup.children, false)[0];
        if (hit) selectDesignPart(hit.object.userData.partId);
      });
    }
    designResizeObserver ||= new ResizeObserver(resizeDesign);
    designResizeObserver.disconnect(); designResizeObserver.observe(host);
    host.append(designRenderer.domElement); resizeDesign(); refreshDesign();
    if (!designFrame) designLoop();
  }
  function design() {
    const el = root('design');
    heading(el, 'ASSET WORKSHOP', 'Build it once. Use it in any shot.', 'Combine editable 3D parts into props, scenery and sets. Drag the preview to orbit; save a model to your project library.');
    const layout = node('div', 'design-layout'); el.append(layout);
    const left = panel(layout, 'Model & parts'), center = node('div', 'design-preview'), right = panel(layout, 'Part inspector');
    layout.append(center); layout.append(right);
    const draft = s().draft;
    field(left, 'Model name', draft.name, v => { draft.name = v; change(); });
    select(left, 'Start from a template', '', [['', 'Choose a template…'], ['trophy', 'Champion trophy'], ['podium', 'Winners podium'], ['tree', 'Studio tree'], ['blank', 'Empty model']], kind => {
      if (!kind) return;
      if (draft.parts.length && !confirm('Replace the current design draft? Save it to your library first to keep it.')) return;
      s().draft = modelTemplate(kind); selectedPart = null; change(); design();
    });
    const addRow = node('div', 'studio-toolbar');
    const type = select(left, 'Primitive type', 'box', PART_TYPES, () => {});
    addRow.append(button('Add part', () => {
      if (draft.parts.length >= 100) { api.toast('A model supports up to 100 parts'); return; }
      const part = newPart(type.value); draft.parts.push(part); selectedPart = part.id; change(); renderParts(); renderInspector(); refreshDesign();
    }, true)); left.append(addRow);
    const partList = node('div', 'model-parts'); left.append(partList);
    const save = () => {
      try {
        const model = validateModel(draft); model.id = draft.assetId || model.id;
        const index = s().models.findIndex(m => m.id === model.id);
        if (index >= 0) s().models[index] = model; else s().models.push(model);
        draft.assetId = model.id; change(); api.toast('Model saved to Assets: ' + model.name);
      } catch (e) { api.toast(e.message); }
    };
    left.append(button('Frame model', () => {
      if (!designGroup) return;
      const box = new THREE.Box3().setFromObject(designGroup);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z, 1) * 2.2;
      designControls.target.copy(center); designCamera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.65, distance));
      designControls.update(); designDirty = true;
    }), button('Save model to Assets', save, true), button('Place draft in current shot', () => {
      try { addModel(validateModel(draft)); } catch (e) { api.toast(e.message); }
    }), button('Save a separate copy', () => { draft.assetId = ''; save(); }), button('Browse asset library', () => open('assets')));
    function renderParts() {
      partList.replaceChildren();
      if (!draft.parts.length) partList.append(node('p', 'studio-muted', 'Choose a template or add your first 3D part.'));
      draft.parts.forEach(part => {
        const b = button(part.name, () => { selectedPart = part.id; renderParts(); renderInspector(); refreshDesign(); });
        b.classList.toggle('selected-part', part.id === selectedPart); partList.append(b);
      });
    }
    function renderInspector() {
      right.replaceChildren(node('h3', '', 'Part inspector'));
      const part = draft.parts.find(x => x.id === selectedPart);
      if (!part) { right.append(node('p', 'studio-muted', 'Select a part to edit its transform, colour and material.')); return; }
      const changed = () => { change(); refreshDesign(); };
      field(right, 'Part name', part.name, v => { part.name = v; change(); renderParts(); });
      field(right, 'Part colour', part.color, v => { part.color = v; changed(); }, { type: 'color' });
      for (const [key, label, min, max] of [['pos', 'Position', -100, 100], ['rot', 'Rotation', -360, 360], ['scale', 'Size', 0.05, 100]]) {
        const row = node('div', 'design-axes'); right.append(row);
        ['X', 'Y', 'Z'].forEach((axis, i) => field(row, label + ' ' + axis, part[key][i], v => {
          const n = Number(v); if (!Number.isFinite(n)) return;
          part[key][i] = Math.max(min, Math.min(max, n)); changed();
        }, { type: 'number', min, max, step: key === 'rot' ? 1 : 0.1 }));
      }
      for (const key of ['roughness', 'metalness']) field(right, key === 'roughness' ? 'Roughness' : 'Metalness', part[key], v => {
        part[key] = Math.max(0, Math.min(1, Number(v) || 0)); changed();
      }, { type: 'number', min: 0, max: 1, step: 0.05 });
      right.append(button('Duplicate part', () => {
        if (draft.parts.length >= 100) return;
        const copy = structuredClone(part); copy.id = makeId('part'); copy.name += ' copy'; copy.pos[0] += 0.4;
        draft.parts.push(copy); selectedPart = copy.id; changed(); renderParts(); renderInspector();
      }), button('Remove part', () => {
        draft.parts = draft.parts.filter(x => x.id !== part.id); selectedPart = draft.parts[0]?.id; changed(); renderParts(); renderInspector();
      }));
    }
    if (!draft.parts.some(x => x.id === selectedPart)) selectedPart = draft.parts[0]?.id || null;
    selectDesignPart = id => { selectedPart = id; renderParts(); renderInspector(); refreshDesign(); };
    renderParts(); renderInspector(); bootDesign(center);
  }

  function assets() {
    const el = root('assets');
    heading(el, 'PROJECT LIBRARY', 'Your entire production, in one place.', 'Browse reusable 3D models, cast, drawings and audio. Model instances placed in shots are independent copies.');
    const toolbar = node('div', 'studio-toolbar'); el.append(toolbar);
    const search = node('input', 'studio-input'); search.placeholder = 'Search assets'; search.setAttribute('aria-label', 'Search assets'); toolbar.append(search);
    const filter = select(toolbar, 'Asset type', 'all', [['all', 'All assets'], ['model', '3D models'], ['character', 'Characters'], ['drawing', 'Drawings'], ['audio', 'Audio']], () => renderCards());
    const upload = node('input'); upload.type = 'file'; upload.accept = '.json'; upload.hidden = true; upload.setAttribute('aria-label', 'Import model JSON');
    upload.addEventListener('change', async () => {
      const file = upload.files[0]; if (!file) return;
      try {
        if (file.size > 5000000) throw new Error('Model JSON must be smaller than 5 MB');
        const data = JSON.parse(await file.text()); const model = validateModel(data.model || data);
        s().models.push(model); change(); renderCards(); api.toast('Model imported');
      } catch (e) { api.toast('Import failed: ' + e.message); }
      upload.value = '';
    });
    toolbar.append(button('Import model JSON', () => upload.click()), button('Design a model', () => open('design'), true), upload);
    const cards = node('div', 'asset-cards'); el.append(cards);
    function renderCards() {
      cards.replaceChildren();
      const all = [...s().models.map(asset => ({ kind: 'model', asset })),
        ...p().characters.map(asset => ({ kind: 'character', asset })),
        ...p().drawings.map(asset => ({ kind: 'drawing', asset })),
        ...p().audioAssets.map(asset => ({ kind: 'audio', asset }))];
      const shown = all.filter(({ kind, asset }) => (filter.value === 'all' || kind === filter.value) && asset.name.toLowerCase().includes(search.value.toLowerCase()));
      if (!shown.length) cards.append(node('p', 'studio-muted', all.length ? 'No assets match that search.' : 'Your library is empty. Start in Design, Draw or Cast, or import audio in Sound.'));
      shown.forEach(({ kind, asset }) => {
        const card = panel(cards), badge = node('div', 'asset-kind', { model: '3D MODEL', character: 'RIGGED CAST', drawing: 'DRAWING', audio: 'AUDIO' }[kind]);
        card.append(badge, node('h3', '', asset.name));
        if (kind === 'drawing') { const image = node('img', 'asset-preview'); image.src = asset.dataURL; image.alt = asset.name; card.append(image); }
        if (kind === 'model') {
          card.append(node('p', 'studio-muted', asset.parts.length + ' editable parts'),
            button('Add to current shot', () => addModel(asset), true),
            button('Edit model design', () => {
              const draft = s().draft, source = s().models.find(model => model.id === draft.assetId);
              const value = model => JSON.stringify({ name: model.name, parts: model.parts.map(({ id, ...part }) => part) });
              if (draft.parts.length && (!source || value(draft) !== value(source)) && !confirm('Replace the unsaved design draft? Save it to Assets first to keep it.')) return;
              s().draft = { name: asset.name, assetId: asset.id, parts: structuredClone(asset.parts) };
              selectedPart = null; change(); open('design');
            }),
            button('Export model JSON', () => downloadJSON({ format: 'videocraft.model.v1', model: asset }, asset.name.replace(/[^a-z0-9-_]/gi, '_') + '.model.json')),
            button('Remove library model', () => {
              if (!confirm('Remove this library model? Existing shot instances will be kept.')) return;
              s().models = s().models.filter(m => m.id !== asset.id); if (s().draft.assetId === asset.id) s().draft.assetId = ''; change(); renderCards();
            }));
        } else if (kind === 'character') {
          card.append(button('Add actor to current shot', () => { api.placeCharacter(asset); open('scene'); }, true));
          if (asset.kind === 'forge') card.append(button('Edit in Forge', () => {
            open('forge');
            window.__loadForgeCharacter?.(asset);
          }));
          card.append(button('Open Cast', () => open('char')));
        }
        else if (kind === 'drawing') card.append(button('Add drawing to current shot', () => { api.placeDrawing(asset); open('scene'); }, true));
        else card.append(button('Add audio clip', () => { p().audioClips.push({ id: makeId('clip'), assetId: asset.id, start: 0, volume: 1 }); change(); open('sound'); }, true));
      });
    }
    search.addEventListener('input', renderCards); renderCards();
  }

  function storyboard() {
    const el = root('board'), total = p().shots.reduce((sum, shot) => sum + shot.duration, 0);
    heading(el, 'SHOT DEVELOPMENT', 'Shape the story, one shot at a time.', `${p().shots.length} shots · ${total.toFixed(1)} seconds. Write the action and camera intention, then take each shot into Animate.`);
    const toolbar = node('div', 'studio-toolbar'); toolbar.append(button('Add storyboard shot', () => { api.addShot(); storyboard(); }, true), button('Play movie in Animate', () => { open('anim'); api.playMovie(); })); el.append(toolbar);
    const grid = node('div', 'storyboard-grid'); el.append(grid);
    p().shots.forEach((shot, index) => {
      const card = panel(grid);
      card.append(node('div', 'studio-kicker', 'SHOT ' + String(index + 1).padStart(2, '0')));
      const image = node('div', 'story-frame');
      const reference = p().drawings.find(d => d.id === shot.referenceDrawingId);
      if (reference) { const img = node('img'); img.src = reference.dataURL; img.alt = 'Storyboard reference for ' + shot.name; image.append(img); }
      else image.append(node('span', '', String(index + 1).padStart(2, '0')), node('p', '', shot.sceneObjects.length + ' scene objects'));
      card.append(image);
      field(card, 'Shot name ' + (index + 1), shot.name, v => { shot.name = v; change(); api.syncShots(); });
      const durationInput = field(card, 'Shot duration ' + (index + 1), shot.duration, v => {
        const duration = Math.max(0.5, Math.min(3600, Number(v) || 5)); api.duration(shot.id, duration);
        durationInput.value = duration;
        el.querySelector('.studio-heading p').textContent = `${p().shots.length} shots · ${p().shots.reduce((sum, shot) => sum + shot.duration, 0).toFixed(1)} seconds. Write the action and camera intention, then take each shot into Animate.`;
      }, { type: 'number', min: 0.5, max: 3600, step: 0.5 });
      field(card, 'Shot notes ' + (index + 1), s().shotNotes[shot.id], v => { s().shotNotes[shot.id] = v; change(); }, { multiline: true, rows: 4 });
      if (p().drawings.length) select(card, 'Shot reference ' + (index + 1), shot.referenceDrawingId || '',
        [['', 'No reference'], ...p().drawings.map(d => [d.id, d.name])], v => { shot.referenceDrawingId = v; change(); storyboard(); });
      card.append(button('Open shot in Animate', () => { api.openShot(shot.id); open('anim'); }, true));
      const actions = node('div', 'studio-toolbar');
      const up = button('Earlier', () => { api.moveShot(shot.id, -1); storyboard(); }); up.disabled = index === 0;
      const down = button('Later', () => { api.moveShot(shot.id, 1); storyboard(); }); down.disabled = index === p().shots.length - 1;
      actions.append(up, down, button('Duplicate shot', () => {
        const id = api.duplicateShot(shot.id); s().shotNotes[id] = s().shotNotes[shot.id] || ''; change(); storyboard();
      }), button('Delete shot', () => { api.deleteShot(shot.id); storyboard(); }));
      card.append(actions);
    });
  }
  function sound() {
    const el = root('sound');
    heading(el, 'SOUND DEPARTMENT', 'Give your movie a voice.', 'Import dialogue, music and sound effects. Clip start times are global movie seconds; use real-time export to include sound.');
    const grid = node('div', 'studio-grid'); el.append(grid);
    const audio = panel(grid, 'Audio clips'), host = node('div', 'studio-stack'); host.id = 'sound-controls'; audio.append(host);
    const notes = panel(grid, 'Sound direction');
    field(notes, 'Sound notes / dialogue cues', s().soundNotes, v => { s().soundNotes = v; change(); }, { multiline: true, rows: 12 });
    notes.append(button('Preview movie in Animate', () => { open('anim'); api.playMovie(); }));
    api.renderAudio();
  }
  function delivery() {
    const el = root('delivery');
    heading(el, 'POST-PRODUCTION', 'From the edit to the final frame.', 'Review the project and choose your output. Export uses the same tested movie renderer, not a separate mock preview.');
    const grid = node('div', 'studio-grid'); el.append(grid);
    const check = panel(grid, 'Delivery checklist');
    const items = [
      [p().shots.some(shot => shot.sceneObjects.length), 'Scene content', 'At least one shot contains objects.'],
      [p().shots.every(shot => shot.camera), 'Camera framing', 'Every shot has a saved camera base.'],
      [p().shots.every(shot => !!s().shotNotes[shot.id]), 'Storyboard notes', 'Optional: describe the action and intent of each shot.'],
      [s().plan.tasks.every(task => task.done), 'Production tasks', 'All checklist tasks are complete, or none are defined.'],
    ];
    items.forEach(([ready, title, detail]) => {
      const row = node('div', 'delivery-check'); row.append(node('span', ready ? 'status-ready' : 'status-review', ready ? 'READY' : 'REVIEW'), node('h3', '', title), node('p', 'studio-muted', detail)); check.append(row);
    });
    check.append(node('p', 'studio-muted', `${p().shots.length} shots · ${p().shots.reduce((sum, shot) => sum + shot.duration, 0).toFixed(1)}s · ${p().fps} fps · ${p().audioClips.length} audio clips`));
    check.append(button('Review storyboard', () => open('board')), button('Save project backup', api.saveProject));
    const output = panel(grid, 'Export settings'), host = node('div', 'studio-stack'); host.id = 'delivery-controls'; output.append(host);
    output.append(node('p', 'studio-muted', '4K availability is encoder-dependent. Frame-accurate export is currently silent and keeps compressed output in memory; long productions should be rendered in shorter sections.'));
  }
  /* ---------------- Character Forge ---------------- */
  let forgeRenderer, forgeScene, forgeCamera, forgeControls, forgeGroup = null;
  let forgeHost, forgeFrame = 0, forgeResizeObserver, forgeTcontrols = null;
  let forgeSel = { kind: '', id: '' }; // 'part' | 'bone'
  let forgePose = {}; // bone id -> [x,y,z] degrees — preview only, never saved
  const boneNodes = () => (forgeGroup?.userData.bones || new Map());

  function forgeEnsureDraft() {
    if (!s().forgeDraft) s().forgeDraft = humanoidTemplate();
    return s().forgeDraft;
  }
  function forgeResize() {
    if (!forgeRenderer || !forgeHost) return;
    const r = forgeHost.getBoundingClientRect(); if (!r.width || !r.height) return;
    forgeRenderer.setSize(r.width, r.height);
    forgeCamera.aspect = r.width / r.height; forgeCamera.updateProjectionMatrix();
  }
  function forgeDescendantIds(boneId, draft) {
    const out = new Set([boneId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of draft.bones) if (b.parent != null && out.has(b.parent) && !out.has(b.id)) { out.add(b.id); grew = true; }
    }
    return out;
  }
  function forgeRefresh() {
    if (!forgeScene) return;
    if (forgeGroup) {
      forgeScene.remove(forgeGroup);
      forgeGroup.userData.dispose?.();
    }
    const draft = forgeEnsureDraft();
    forgeGroup = buildCharacterGroup(draft);
    forgeScene.add(forgeGroup);
    // bone pickers + axes
    const nodes = boneNodes();
    for (const [id, node] of nodes) {
      const axis = new THREE.AxesHelper(0.13);
      axis.material.depthTest = false; axis.renderOrder = 10;
      node.add(axis);
      const picker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
      picker.userData.boneId = id;
      node.add(picker);
    }
    // preview pose
    for (const [id, node] of nodes) {
      const p = forgePose[id] || [0, 0, 0];
      node.rotation.set(p[0] * Math.PI / 180, p[1] * Math.PI / 180, p[2] * Math.PI / 180);
    }
    forgeSelect(forgeSel.kind, forgeSel.id); // re-attach gizmo if still valid
  }
  function forgeSelect(kind, id) {
    const draft = forgeEnsureDraft();
    if (kind === 'part' && !draft.parts.some(p => p.id === id)) { kind = ''; id = ''; }
    if (kind === 'bone' && !draft.bones.some(b => b.id === id)) { kind = ''; id = ''; }
    forgeSel = { kind, id };
    if (!forgeTcontrols) return;
    forgeTcontrols.detach();
    if (kind === 'part') {
      let mesh = null;
      forgeGroup.traverse(m => { if (m.name === 'fpart:' + id) mesh = m; });
      if (mesh) { forgeTcontrols.attach(mesh); forgeTcontrols.setMode('translate'); forgeTcontrols.enabled = true; return; }
    } else if (kind === 'bone') {
      const node = boneNodes().get(id);
      if (node) { forgeTcontrols.attach(node); forgeTcontrols.setMode('rotate'); forgeTcontrols.enabled = true; return; }
    }
    forgeTcontrols.enabled = false;
  }
  function forgeLoop() {
    forgeFrame = 0;
    if (current !== 'forge') return;
    forgeControls.update();
    forgeRenderer.render(forgeScene, forgeCamera); // small scene; render every frame for live gizmos
    forgeFrame = requestAnimationFrame(forgeLoop);
  }
  function bootForge(host) {
    forgeHost = host;
    if (!forgeRenderer) {
      forgeRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      forgeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      forgeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      forgeRenderer.toneMappingExposure = 1.15;
      forgeScene = new THREE.Scene(); forgeScene.background = new THREE.Color('#25262b');
      forgeCamera = new THREE.PerspectiveCamera(43, 1, 0.05, 300); forgeCamera.position.set(2.6, 2, 3.2);
      forgeControls = new OrbitControls(forgeCamera, forgeRenderer.domElement);
      forgeControls.target.set(0, 1, 0); forgeControls.enableDamping = true;
      forgeScene.add(new THREE.HemisphereLight('#fff4dc', '#536079', 2.2));
      const key = new THREE.DirectionalLight('#ffe5c2', 2.6); key.position.set(4, 7, 5); forgeScene.add(key);
      const rim = new THREE.DirectionalLight('#86aeff', 1.6); rim.position.set(-5, 3, -4); forgeScene.add(rim);
      forgeScene.add(new THREE.GridHelper(10, 10, '#666b76', '#363b45'));
      forgeRenderer.domElement.setAttribute('aria-label', 'Character Forge 3D preview');
      forgeTcontrols = new TransformControls(forgeCamera, forgeRenderer.domElement);
      forgeTcontrols.enabled = false;
      forgeTcontrols.addEventListener('dragging-changed', e => { forgeControls.enabled = !e.value; if (!e.value) forgeSyncGizmo(); });
      forgeTcontrols.addEventListener('objectChange', () => forgeSyncGizmo(true));
      forgeScene.add(forgeTcontrols);
      let pointerStart = null;
      forgeRenderer.domElement.addEventListener('pointerdown', e => { pointerStart = [e.clientX, e.clientY]; });
      forgeRenderer.domElement.addEventListener('pointerup', e => {
        if (!pointerStart || Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 6 || !forgeGroup) return;
        if (forgeTcontrols.axis) return; // grabbed a gizmo handle, not the scene
        const rect = forgeRenderer.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), forgeCamera);
        const hits = ray.intersectObjects(forgeGroup.children, true);
        const hit = hits.find(h => h.object.userData.boneId || h.object.name?.startsWith('fpart:'));
        if (!hit) return;
        if (hit.object.userData.boneId) { forgeSelect('bone', hit.object.userData.boneId); renderForgeInspector(); renderForgeLists(); }
        else { forgeSelect('part', hit.object.name.slice(6)); renderForgeInspector(); renderForgeLists(); }
      });
    }
    forgeResizeObserver ||= new ResizeObserver(forgeResize);
    forgeResizeObserver.disconnect(); forgeResizeObserver.observe(host);
    host.append(forgeRenderer.domElement); forgeResize(); forgeRefresh();
    if (!forgeFrame) forgeLoop();
  }
  // write gizmo drags back into the draft (parts: definition; bones: preview pose)
  function forgeSyncGizmo(live = false) {
    if (forgeSel.kind === 'part') {
      const part = forgeEnsureDraft().parts.find(p => p.id === forgeSel.id);
      let mesh = null;
      forgeGroup?.traverse(m => { if (m.name === 'fpart:' + forgeSel.id) mesh = m; });
      if (part && mesh) {
        part.pos = mesh.position.toArray().map(v => Math.round(v * 1000) / 1000);
        if (!live) change();
      }
    } else if (forgeSel.kind === 'bone') {
      const node = boneNodes().get(forgeSel.id);
      if (node) {
        const d = r => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10;
        forgePose[forgeSel.id] = [d(node.rotation.x), d(node.rotation.y), d(node.rotation.z)];
        if (!live) { change(); renderForgeInspector(); } // keep sliders in sync after a drag
      }
    }
  }
  function forge() {
    const el = root('forge');
    heading(el, 'CHARACTER FORGE', 'Build custom characters, bone by bone.', 'Add bones and attach parts to them, pose the rig, then save the character to your Cast and place it in any shot. The humanoid template works with the motion presets.');
    const layout = node('div', 'design-layout'); el.append(layout);
    const left = panel(layout, 'Character & rig'), center = node('div', 'design-preview'), right = panel(layout, 'Inspector');
    layout.append(center); layout.append(right);
    const draft = forgeEnsureDraft();
    field(left, 'Character name', draft.name, v => { draft.name = v; change(); });
    select(left, 'Start from', '', [['', 'Choose…'], ['humanoid', 'Humanoid template (preset-ready)'], ['blank', 'Blank character']], kind => {
      if (!kind) return;
      if ((draft.bones.length > 1 || draft.parts.length > 1) && !confirm('Replace the current forge draft? Save it to your Cast first to keep it.')) return;
      const fresh = kind === 'humanoid' ? humanoidTemplate() : blankCharacter();
      s().forgeDraft = { ...fresh, name: draft.name, assetId: '' };
      forgePose = {}; forgeSel = { kind: '', id: '' };
      change(); forge();
    });
    const addRow = node('div', 'studio-toolbar');
    const typeSel = select(left, 'Part type', 'box', FORGE_PART_TYPES.map(t => [t, t[0].toUpperCase() + t.slice(1)]), () => {});
    addRow.append(button('Add part', () => {
      const d = forgeEnsureDraft();
      if (d.parts.length >= 200) { api.toast('A character supports up to 200 parts'); return; }
      const part = newForgePart(typeSel.value, forgeSel.kind === 'bone' ? forgeSel.id : (d.bones[0]?.id ?? null));
      part.name = part.type[0].toUpperCase() + part.type.slice(1) + ' ' + (d.parts.length + 1);
      d.parts.push(part);
      change(); forgeRefresh(); renderForgeLists(); forgeSelect('part', part.id); renderForgeInspector();
    }, true));
    left.append(addRow);
    left.append(button('Add bone (child of selection)', () => {
      const d = forgeEnsureDraft();
      if (d.bones.length >= 64) { api.toast('A character supports up to 64 bones'); return; }
      const bone = newBone('Bone ' + (d.bones.length + 1), forgeSel.kind === 'bone' ? forgeSel.id : (d.bones[0]?.id ?? null));
      d.bones.push(bone);
      change(); forgeRefresh(); renderForgeLists(); forgeSelect('bone', bone.id); renderForgeInspector();
    }));
    const boneList = node('div', 'model-parts'); left.append(boneList);
    const partList = node('div', 'model-parts'); left.append(partList);
    left.append(button('Frame character', () => {
      if (!forgeGroup) return;
      const box = new THREE.Box3().setFromObject(forgeGroup);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const dist = Math.max(size.x, size.y, size.z, 1) * 2.2;
      forgeControls.target.copy(c);
      forgeCamera.position.copy(c).add(new THREE.Vector3(dist, dist * 0.6, dist));
      forgeControls.update();
    }));
    const saveForge = (copy = false) => {
      try {
        const clean = validateCharacter(draft);
        const id = copy ? '' : (draft.assetId || '');
        const char = { ...clean, id: id || makeId('char') };
        const existing = p().characters.findIndex(c => c.id === char.id);
        if (existing >= 0) p().characters[existing] = char; else p().characters.push(char);
        if (copy) { draft.assetId = ''; api.toast('Copy saved to Cast'); }
        else { draft.assetId = char.id; api.toast('Character saved to Cast — place it from Scene or Assets'); }
        change();
      } catch (e) { api.toast(e.message); }
    };
    left.append(button('Save to Cast', () => saveForge(false), true));
    left.append(button('Save a separate copy', () => saveForge(true)));
    left.append(button('Place in current shot', () => {
      try {
        const clean = validateCharacter(draft);
        const id = draft.assetId || '';
        let char = p().characters.find(c => c.id === id && c.kind === 'forge');
        if (!char) { char = { ...clean, id: id || makeId('char') }; p().characters.push(char); draft.assetId = char.id; }
        else Object.assign(char, clean);
        change(); api.placeCharacter(char); api.toast('Character placed in the current shot');
      } catch (e) { api.toast(e.message); }
    }));
    const exportBtn = button('Export character JSON', () => {
      try { downloadJSON({ format: 'videocraft.character.v1', character: validateCharacter(draft) }, draft.name.replace(/[^a-z0-9-_]/gi, '_') + '.character.json'); }
      catch (e) { api.toast(e.message); }
    });
    const importInput = node('input'); importInput.type = 'file'; importInput.accept = '.json'; importInput.hidden = true;
    importInput.setAttribute('aria-label', 'Import character JSON');
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0]; if (!file) return;
      try {
        if (file.size > 2000000) throw new Error('Character JSON must be smaller than 2 MB');
        const data = JSON.parse(await file.text());
        const clean = validateCharacter(data.character || data);
        if ((draft.bones.length > 1 || draft.parts.length > 1) && !confirm('Replace the current forge draft?')) return;
        s().forgeDraft = { ...clean, assetId: '' };
        forgePose = {}; forgeSel = { kind: '', id: '' };
        change(); forge();
      } catch (e) { api.toast('Import failed: ' + e.message); }
      importInput.value = '';
    });
    left.append(button('Import character JSON', () => importInput.click()), exportBtn, importInput);
    left.append(button('Browse asset library', () => open('assets')));

    function renderForgeLists() {
      const d = forgeEnsureDraft();
      boneList.replaceChildren(node('div', 'studio-kicker', 'BONES'));
      d.bones.forEach(bone => {
        const b = button(bone.name + (forgePose[bone.id]?.some(v => Math.abs(v) > 0.5) ? ' ·posed' : ''), () => {
          forgeSelect('bone', bone.id); renderForgeLists(); renderForgeInspector();
        });
        b.classList.toggle('selected-part', forgeSel.kind === 'bone' && forgeSel.id === bone.id);
        boneList.append(b);
      });
      partList.replaceChildren(node('div', 'studio-kicker', 'PARTS'));
      d.parts.forEach(part => {
        const b = button(part.name, () => { forgeSelect('part', part.id); renderForgeLists(); renderForgeInspector(); });
        b.classList.toggle('selected-part', forgeSel.kind === 'part' && forgeSel.id === part.id);
        partList.append(b);
      });
    }
    function renderForgeInspector() {
      const d = forgeEnsureDraft();
      right.replaceChildren(node('h3', '', 'Inspector'));
      if (forgeSel.kind === 'part') {
        const part = d.parts.find(p => p.id === forgeSel.id);
        if (!part) { right.append(node('p', 'studio-muted', 'Select a part or bone in the preview or lists.')); return; }
        const changed = () => { change(); forgeRefresh(); };
        field(right, 'Part name', part.name, v => { part.name = v; change(); renderForgeLists(); });
        select(right, 'Attached bone', part.bone ?? '', [['', 'None (root)'], ...d.bones.map(b => [b.id, b.name])], v => { part.bone = v || null; changed(); });
        for (const [key, label, min, max] of [['pos', 'Offset', -50, 50], ['rot', 'Rotation', -360, 360], ['scale', 'Size', 0.02, 50]]) {
          const row = node('div', 'design-axes'); right.append(row);
          ['X', 'Y', 'Z'].forEach((axis, i) => field(row, label + ' ' + axis, part[key][i], v => {
            const n = Number(v); if (!Number.isFinite(n)) return;
            part[key][i] = Math.max(min, Math.min(max, n)); changed();
          }, { type: 'number', min, max, step: key === 'rot' ? 1 : 0.05 }));
        }
        field(right, 'Colour', part.color, v => { part.color = v; changed(); }, { type: 'color' });
        for (const key of ['roughness', 'metalness']) field(right, key === 'roughness' ? 'Roughness' : 'Metalness', part[key], v => {
          part[key] = Math.max(0, Math.min(1, Number(v) || 0)); changed();
        }, { type: 'number', min: 0, max: 1, step: 0.05 });
        right.append(node('p', 'studio-muted', 'Drag the arrows in the preview to move this part.'));
        right.append(button('Duplicate part', () => {
          if (d.parts.length >= 200) return;
          const copy = structuredClone(part); copy.id = makeId('fpart'); copy.name += ' copy'; copy.pos[0] += 0.25;
          d.parts.push(copy); change(); forgeRefresh(); renderForgeLists(); forgeSelect('part', copy.id); renderForgeInspector();
        }), button('Remove part', () => {
          d.parts = d.parts.filter(p => p.id !== part.id);
          forgeSel = { kind: '', id: '' };
          change(); forgeRefresh(); renderForgeLists(); renderForgeInspector();
        }));
      } else if (forgeSel.kind === 'bone') {
        const bone = d.bones.find(b => b.id === forgeSel.id);
        if (!bone) { right.append(node('p', 'studio-muted', 'Select a part or bone.')); return; }
        const changed = () => { change(); forgeRefresh(); };
        field(right, 'Bone name', bone.name, v => { bone.name = v; change(); renderForgeLists(); });
        const banned = forgeDescendantIds(bone.id, d); // reparenting into your own subtree would create a cycle
        select(right, 'Parent bone', bone.parent ?? '', [['', 'None (root)'], ...d.bones.filter(b => !banned.has(b.id)).map(b => [b.id, b.name])], v => {
          if (v === bone.id) return;
          bone.parent = v || null; changed();
        });
        const row = node('div', 'design-axes'); right.append(row);
        ['X', 'Y', 'Z'].forEach((axis, i) => field(row, 'Rest offset ' + axis, bone.pos[i], v => {
          const n = Number(v); if (!Number.isFinite(n)) return;
          bone.pos[i] = Math.max(-50, Math.min(50, n)); changed();
        }, { type: 'number', min: -50, max: 50, step: 0.05 }));
        right.append(node('div', 'studio-kicker', 'PREVIEW POSE (not saved)'));
        const pose = forgePose[bone.id] ||= [0, 0, 0];
        ['X', 'Y', 'Z'].forEach((axis, i) => field(right, 'Rotate ' + axis, pose[i], v => {
          const n = Number(v); if (!Number.isFinite(n)) return;
          pose[i] = Math.max(-180, Math.min(180, n));
          const node = boneNodes().get(bone.id);
          if (node) node.rotation.set(pose[0] * Math.PI / 180, pose[1] * Math.PI / 180, pose[2] * Math.PI / 180);
        }, { type: 'number', min: -180, max: 180, step: 1 }));
        right.append(node('p', 'studio-muted', 'Drag the rings in the preview to pose this bone. Poses are preview only — keyframe bones in Animate.'));
        right.append(button('Reset bone pose', () => {
          delete forgePose[bone.id];
          const node = boneNodes().get(bone.id);
          if (node) node.rotation.set(0, 0, 0);
          renderForgeInspector(); renderForgeLists();
        }), button('Remove bone', () => {
          if (d.bones.length <= 1) { api.toast('A character needs at least one bone'); return; }
          const orphanParent = bone.parent;
          d.bones = d.bones.filter(b => b.id !== bone.id);
          d.parts.forEach(part => { if (part.bone === bone.id) part.bone = orphanParent ?? d.bones[0].id; });
          // children of the removed bone move to its parent
          d.bones.forEach(b => { if (b.parent === bone.id) b.parent = orphanParent ?? null; });
          forgeSel = { kind: '', id: '' };
          change(); forgeRefresh(); renderForgeLists(); renderForgeInspector();
        }));
      } else {
        right.append(node('p', 'studio-muted', 'Select a part or bone in the 3D preview or in the lists. Parts: drag arrows to move. Bones: drag rings to pose.'));
        right.append(button('Reset all pose', () => {
          forgePose = {};
          for (const [, node] of boneNodes()) node.rotation.set(0, 0, 0);
          renderForgeLists();
        }));
      }
    }
    // lets other workspaces (Cast, Assets) push a saved character into the forge draft
    window.__loadForgeCharacter = char => {
      s().forgeDraft = { name: char.name, assetId: char.id, bones: structuredClone(char.bones), parts: structuredClone(char.parts) };
      forgePose = {}; forgeSel = { kind: '', id: '' };
      change(); forge(); // full re-render so every handler captures the new draft
    };
    renderForgeLists(); renderForgeInspector(); bootForge(center);
  }

  const renderers = { plan: planning, design, assets, board: storyboard, sound, delivery, forge };
  return {
    render(ws) {
      current = ws;
      if (ws !== 'design' && designFrame) { cancelAnimationFrame(designFrame); designFrame = 0; }
      if (ws !== 'forge' && forgeFrame) { cancelAnimationFrame(forgeFrame); forgeFrame = 0; forgeTcontrols?.detach(); }
      const audio = document.getElementById('movie-audio-tools'), output = document.getElementById('movie-export-tools');
      // Move the SAME controls, preserving event handlers and user selections.
      document.getElementById('anim-audio-home').append(audio);
      document.getElementById('anim-export-home').append(output);
      renderers[ws]?.();
      if (ws === 'sound') document.getElementById('sound-controls').append(audio);
      if (ws === 'delivery') document.getElementById('delivery-controls').append(output);
    },
    open: tab => api.workspace(tab),
  };
}
