import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildModel, disposeModel } from './models.js?v=0.7.1';
import { PRODUCTION_TABS, PART_TYPES, newPart, validateModel, modelTemplate, modelInstance, makeId } from './production.js?v=0.7.1';
import { renderShotFinishing, subtitleTools } from './film-ui.js?v=0.7.1';
import { askConfirm } from './dialogs.js?v=0.7.1';

const names = { plan: 'Planning', design: 'Design', assets: 'Assets', board: 'Storyboard', sound: 'Sound', delivery: 'Delivery' };
const icons = {
  plan: '<path d="M8 4H5v17h14V4h-3M9 2h6v5H9zM8 12h8M8 16h5"/>',
  design: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>',
  assets: '<path d="M3 6h7l2-3h9v17H3zM7 11h10M7 15h6"/>',
  board: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16M2 12h20"/>',
  sound: '<path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  delivery: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
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
  const labels = { ...names, draw: 'Draw', char: 'Cast', scene: 'Scene', anim: 'Animate' };
  for (const key of ['plan', 'design', 'draw', 'char', 'assets', 'scene', 'board', 'anim', 'sound', 'delivery']) {
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
  let storyboardPage = 0, storyboardSearch = '';
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
    const next = node('div', 'studio-toolbar planning-actions');
    next.append(button('Build a scene', () => open('scene'), true), button('Import 3D assets', () => open('assets')), button('Open movie timeline', () => open('anim')));
    el.append(next);
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
    select(left, 'Start from a template', '', [['', 'Choose a template…'], ['trophy', 'Champion trophy'], ['podium', 'Winners podium'], ['tree', 'Studio tree'], ['blank', 'Empty model']], async kind => {
      if (!kind) return;
      if (draft.parts.length && !await askConfirm('Replace the current design draft? Save it to your library first to keep it.')) return;
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
    const filter = select(toolbar, 'Asset type', 'all', [['all', 'All assets'], ['model', 'Designed models'], ['imported', 'Imported 3D / GLB'], ['character', 'Characters'], ['drawing', 'Drawings'], ['audio', 'Audio']], () => renderCards());
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
    const glb = node('input'); glb.type = 'file'; glb.accept = '.glb'; glb.hidden = true; glb.setAttribute('aria-label', 'Import 3D GLB file');
    const importStatus = node('p', 'studio-muted'); importStatus.setAttribute('role', 'status');
    const importButton = button('Import 3D GLB', () => glb.click());
    glb.addEventListener('change', async () => {
      const file = glb.files[0]; if (!file) return;
      importButton.disabled = true; importStatus.textContent = 'Reading model, materials and animation…';
      try { const asset = await api.importGLB(file); importStatus.textContent = asset.name + ' imported with ' + asset.animations.length + ' animation clips.'; renderCards(); }
      catch (e) { importStatus.textContent = 'Import failed: ' + e.message; }
      finally { importButton.disabled = false; glb.value = ''; }
    });
    toolbar.append(importButton, glb);
    el.append(node('p', 'studio-muted', 'Import self-contained, uncompressed GLB files up to 25 MB, including embedded textures, skins and animation clips. Imported models are normalized to 2m high; scale them in Scene. Save a project backup to keep large assets.'), importStatus);
    const cards = node('div', 'asset-cards'); el.append(cards);
    function renderCards() {
      cards.replaceChildren();
      const all = [...s().models.map(asset => ({ kind: 'model', asset })), ...s().imports.map(asset => ({ kind: 'imported', asset })),
        ...p().characters.map(asset => ({ kind: 'character', asset })),
        ...p().drawings.map(asset => ({ kind: 'drawing', asset })),
        ...p().audioAssets.map(asset => ({ kind: 'audio', asset }))];
      const shown = all.filter(({ kind, asset }) => (filter.value === 'all' || kind === filter.value) && asset.name.toLowerCase().includes(search.value.toLowerCase()));
      if (!shown.length) cards.append(node('p', 'studio-muted', all.length ? 'No assets match that search.' : 'Your library is empty. Start in Design, Draw or Cast, or import audio in Sound.'));
      shown.forEach(({ kind, asset }) => {
        const card = panel(cards), badge = node('div', 'asset-kind', { model: '3D MODEL', imported: 'IMPORTED 3D / GLB', character: 'RIGGED CAST', drawing: 'DRAWING', audio: 'AUDIO' }[kind]);
        card.append(badge, node('h3', '', asset.name));
        if (kind === 'drawing') { const image = node('img', 'asset-preview'); image.src = asset.dataURL; image.alt = asset.name; card.append(image); }
        if (kind === 'model') {
          card.append(node('p', 'studio-muted', asset.parts.length + ' editable parts'),
            button('Add to current shot', () => addModel(asset), true),
            button('Edit model design', async () => {
              const draft = s().draft, source = s().models.find(model => model.id === draft.assetId);
              const value = model => JSON.stringify({ name: model.name, parts: model.parts.map(({ id, ...part }) => part) });
              if (draft.parts.length && (!source || value(draft) !== value(source)) && !await askConfirm('Replace the unsaved design draft? Save it to Assets first to keep it.')) return;
              s().draft = { name: asset.name, assetId: asset.id, parts: structuredClone(asset.parts) };
              selectedPart = null; change(); open('design');
            }),
            button('Export model JSON', () => downloadJSON({ format: 'videocraft.model.v1', model: asset }, asset.name.replace(/[^a-z0-9-_]/gi, '_') + '.model.json')),
            button('Remove library model', async () => {
              if (!await askConfirm('Remove this library model? Existing shot instances will be kept.')) return;
              s().models = s().models.filter(m => m.id !== asset.id); if (s().draft.assetId === asset.id) s().draft.assetId = ''; change(); renderCards();
            }));
        } else if (kind === 'imported') {
          card.append(node('p', 'studio-muted', asset.animations.length + ' animation clips · embedded source'),
            button('Place imported model', () => api.placeImported(asset), true),
            button('Remove imported asset', async () => {
              if (p().shots.some(shot => shot.sceneObjects.some(o => o.type === 'imported' && o.assetId === asset.id))) return api.toast('Remove this model’s instances from every shot before deleting its source.');
              if (!await askConfirm('Remove this imported model from the project?')) return;
              s().imports = s().imports.filter(a => a !== asset); change(); renderCards();
            }));
        } else if (kind === 'character') card.append(button('Add actor to current shot', () => { api.placeCharacter(asset); open('scene'); }, true), button('Open Cast', () => open('char')));
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
    subtitleTools(toolbar, { ...api, refresh: storyboard });
    const navigation = node('div', 'studio-toolbar'); el.append(navigation);
    field(navigation, 'Search shots', storyboardSearch, value => { storyboardSearch = value; }, { });
    navigation.append(button('Search', () => { storyboardPage = 0; storyboard(); }));
    const matching = p().shots.map((shot, index) => ({ shot, index })).filter(({ shot }) => (shot.name + ' ' + (s().shotNotes[shot.id] || '')).toLowerCase().includes(storyboardSearch.toLowerCase()));
    const pages = Math.max(1, Math.ceil(matching.length / 12)); storyboardPage = Math.min(storyboardPage, pages - 1);
    const previous = button('Previous shots', () => { storyboardPage--; storyboard(); }); previous.disabled = storyboardPage === 0;
    const next = button('Next shots', () => { storyboardPage++; storyboard(); }); next.disabled = storyboardPage === pages - 1;
    navigation.append(previous, node('span', 'studio-muted', `Page ${storyboardPage + 1} of ${pages} · ${matching.length} matching shots`), next);
    const grid = node('div', 'storyboard-grid'); el.append(grid);
    matching.slice(storyboardPage * 12, (storyboardPage + 1) * 12).forEach(({ shot, index }) => {
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
      renderShotFinishing(card, shot, 'Shot ' + (index + 1), api);
      if (p().drawings.length) select(card, 'Shot reference ' + (index + 1), shot.referenceDrawingId || '',
        [['', 'No reference'], ...p().drawings.map(d => [d.id, d.name])], v => { shot.referenceDrawingId = v; change(); storyboard(); });
      card.append(button('Open shot in Animate', () => { api.openShot(shot.id); open('anim'); }, true));
      const actions = node('div', 'studio-toolbar');
      const up = button('Earlier', () => { api.moveShot(shot.id, -1); storyboard(); }); up.disabled = index === 0;
      const down = button('Later', () => { api.moveShot(shot.id, 1); storyboard(); }); down.disabled = index === p().shots.length - 1;
      actions.append(up, down, button('Duplicate shot', () => {
        const id = api.duplicateShot(shot.id); s().shotNotes[id] = s().shotNotes[shot.id] || ''; change(); storyboard();
      }), button('Delete shot', async () => { await api.deleteShot(shot.id); storyboard(); }));
      card.append(actions);
    });
  }
  function sound() {
    const el = root('sound');
    heading(el, 'SOUND DEPARTMENT', 'Give your movie a voice.', 'Layer dialogue, music and effects with independent clips, source trims, fades and stereo pan. Start times are global movie seconds; both export modes include sound.');
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
    output.append(node('p', 'studio-muted', 'Render a film, shot or interval with frame-accurate video and mixed stereo audio. Direct-to-disk bounds compressed output memory; decoded audio has a 256 MB cap. Memory exports are limited to five-minute sections. A feature-length timeline is not a guarantee of a finished feature.'));
  }
  const renderers = { plan: planning, design, assets, board: storyboard, sound, delivery };
  return {
    render(ws) {
      current = ws;
      if (ws !== 'design' && designFrame) { cancelAnimationFrame(designFrame); designFrame = 0; }
      const audio = document.getElementById('movie-audio-tools'), output = document.getElementById('movie-export-tools');
      // Move the SAME controls, preserving event handlers and user selections.
      document.getElementById('anim-audio-home').append(audio);
      document.getElementById('anim-export-home').append(output);
      renderers[ws]?.();
      if (ws === 'sound') document.getElementById('sound-controls').append(audio);
      if (ws === 'delivery') document.getElementById('delivery-controls').append(output);
    },
  };
}
