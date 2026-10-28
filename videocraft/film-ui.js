import { createSet, SETS } from './sets.js';
import { makeId } from './production.js';
import { parseSRT, movieSRT, movieIndex, shotFilm } from './film.js';

const el = (tag, text, cls) => {
  const n = document.createElement(tag); if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls; return n;
};
export function filmField(parent, label, value, change, type = 'number', options = {}) {
  const wrap = el('label', undefined, 'studio-field'), input = el(type === 'textarea' ? 'textarea' : 'input', undefined, 'studio-input');
  if (type !== 'textarea') input.type = type;
  input.value = value; input.setAttribute('aria-label', label);
  Object.assign(input, options);
  input.addEventListener(type === 'number' ? 'change' : 'input', () => change(type === 'number' ? Number(input.value) : input.value));
  wrap.append(el('span', label, 'studio-label'), input); parent.append(wrap); return input;
}
function select(parent, label, value, options, change) {
  const wrap = el('label', undefined, 'studio-field'), input = el('select', undefined, 'studio-input');
  input.setAttribute('aria-label', label);
  options.forEach(([v, name]) => { const o = el('option', name); o.value = v; input.append(o); });
  input.value = value; input.addEventListener('change', () => change(input.value));
  wrap.append(el('span', label, 'studio-label'), input); parent.append(wrap); return input;
}
function button(parent, name, action) {
  const b = el('button', name, 'btn'); b.addEventListener('click', action); parent.append(b); return b;
}
function details(parent, title) {
  const d = el('details', undefined, 'studio-details film-details'), body = el('div', undefined, 'studio-stack');
  d.append(el('summary', title), body); parent.append(d); return body;
}
export function renderWorld(parent, shot, api) {
  parent.replaceChildren();
  const sets = details(parent, 'Sets & atmosphere'), film = shot.film ||= shotFilm();
  const choice = select(sets, 'Ready-made set', 'forest', SETS, () => {});
  button(sets, 'Add set to shot', () => {
    const set = createSet(choice.value); shot.sceneObjects.push(set.object);
    Object.assign(film, set.film); shot.camera = set.camera; shot.lighting = set.lighting;
    // Authored moves would override the new framing; remove only with explicit approval.
    if (Object.keys(shot.keyframes.__camera__ || {}).length && confirm('Use the set camera instead of the current camera animation?')) delete shot.keyframes.__camera__;
    api.refresh(); api.dirty(); api.toast('Set added. Existing objects were kept. Unlock the set to move it.');
  });
  sets.append(el('p', 'Sets are compound objects. Select one and copy its parts to Design to make an edited version. Existing actors and props are kept.', 'empty-note'));
  const change = () => { api.look(); api.dirty(); };
  filmField(sets, 'Shot background', film.background || '#211d18', v => { film.background = v; change(); }, 'color');
  filmField(sets, 'Ground colour', film.ground, v => { film.ground = v; change(); }, 'color');
  filmField(sets, 'Exposure', film.exposure ?? 1.1, v => { film.exposure = Math.max(0.2, Math.min(3, v || 1.1)); change(); }, 'number', { min: 0.2, max: 3, step: 0.05 });
  filmField(sets, 'Fog density', film.fog ?? 0, v => { film.fog = Math.max(0, Math.min(0.12, v || 0)); change(); }, 'number', { min: 0, max: 0.12, step: 0.005 });
  button(sets, 'Reset atmosphere to lighting preset', () => { delete shot.film; shot.film = { ...shotFilm(), captions: film.captions, fadeIn: film.fadeIn, fadeOut: film.fadeOut }; api.refresh(); api.dirty(); });
}
export function renderShotFinishing(parent, shot, prefix, api) {
  const film = shot.film ||= shotFilm(), body = details(parent, 'Titles, captions & fades');
  const update = () => api.dirty();
  filmField(body, prefix + ' fade in (s)', film.fadeIn, v => { film.fadeIn = Math.max(0, Math.min(10, v || 0)); update(); }, 'number', { min: 0, max: 10, step: 0.1 });
  filmField(body, prefix + ' fade out (s)', film.fadeOut, v => { film.fadeOut = Math.max(0, Math.min(10, v || 0)); update(); }, 'number', { min: 0, max: 10, step: 0.1 });
  body.append(el('p', 'Fades go through black without changing shot timing. Captions use seconds inside this shot; center placement makes a title card.', 'studio-muted'));
  const list = el('div', undefined, 'studio-stack'); body.append(list);
  const render = () => {
    list.replaceChildren();
    film.captions.forEach((cue, i) => {
      const row = el('div', undefined, 'caption-cue');
      filmField(row, prefix + ' caption ' + (i + 1), cue.text, v => { cue.text = v.slice(0, 2000); update(); }, 'textarea', { rows: 2, maxLength: 2000 });
      const timing = el('div', undefined, 'design-axes');
      filmField(timing, 'Caption ' + (i + 1) + ' start', cue.start, v => { cue.start = Math.max(0, v || 0); update(); }, 'number', { min: 0, max: shot.duration, step: 0.1 });
      filmField(timing, 'Caption ' + (i + 1) + ' end', cue.end, v => { cue.end = Math.max(0, v || 0); update(); }, 'number', { min: 0, max: shot.duration, step: 0.1 });
      filmField(timing, 'Caption ' + (i + 1) + ' size', cue.size, v => { cue.size = Math.max(2, Math.min(10, v || 4)); update(); }, 'number', { min: 2, max: 10, step: 0.5 });
      row.append(timing);
      select(row, 'Caption ' + (i + 1) + ' placement', cue.position, [['bottom', 'Subtitle / lower third'], ['center', 'Centered title']], v => { cue.position = v; update(); });
      filmField(row, 'Caption ' + (i + 1) + ' colour', cue.color, v => { cue.color = v; update(); }, 'color');
      button(row, 'Remove caption ' + (i + 1), () => { film.captions = film.captions.filter(c => c !== cue); update(); render(); });
      list.append(row);
    });
  };
  button(body, 'Add timed caption', () => {
    if (film.captions.length >= 2000) return api.toast('This shot already has 2,000 captions.');
    film.captions.push({ id: makeId('cue'), start: 0, end: Math.min(3, shot.duration), text: 'Your dialogue or title', position: 'bottom', size: 4, color: '#ffffff' }); update(); render();
  });
  render();
}
export function subtitleTools(parent, api) {
  const file = el('input'); file.type = 'file'; file.accept = '.srt'; file.hidden = true; file.setAttribute('aria-label', 'Import subtitles SRT');
  file.addEventListener('change', async () => {
    const upload = file.files[0]; if (!upload) return;
    try {
      if (upload.size > 2000000) throw new Error('SRT must be under 2 MB.');
      const cues = parseSRT(await upload.text()), index = movieIndex(api.project().shots);
      const additions = index.map(({ shot, start, end }) => ({ shot, cues: cues.filter(c => c.start < end && c.end > start)
        .map(c => ({ ...c, id: makeId('cue'), start: Math.max(0, c.start - start), end: Math.min(shot.duration, c.end - start), position: 'bottom', size: 4, color: '#ffffff' })) }));
      if (!additions.some(a => a.cues.length)) throw new Error('No subtitle overlaps this movie.');
      if (additions.some(a => a.cues.length + (a.shot.film?.captions.length || 0) > 2000)) throw new Error('Too many captions for one shot.');
      additions.forEach(({ shot, cues }) => { const film = shot.film ||= shotFilm(); film.captions.push(...cues); });
      api.dirty(); api.refresh(); api.toast('Subtitles imported across the movie. Existing captions were kept.');
    } catch (e) { api.toast('Subtitle import failed: ' + e.message); }
    file.value = '';
  });
  button(parent, 'Import subtitles SRT', () => file.click());
  button(parent, 'Export subtitles SRT', () => api.download(new Blob([movieSRT(api.project().shots)], { type: 'text/plain' }), 'movie-subtitles.srt'));
  parent.append(file);
}
