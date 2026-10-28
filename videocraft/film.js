// Pure film-production utilities: shared by the editor, renderer and tests.
import { gradeSettings, LIGHT_RIGS } from './cinema.js?v=0.7.0';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
export function easing(u, kind = 'ease') {
  u = clamp(u, 0, 1);
  if (kind === 'step') return u === 1 ? 1 : 0;
  if (kind === 'linear') return u;
  if (kind === 'in') return u * u * u;
  if (kind === 'out') return 1 - (1 - u) ** 3;
  if (kind === 'inout') return u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
  return u * u * (3 - 2 * u);
}
export function sampleKeys(keys, time) {
  if (!keys?.length) return null;
  if (time <= keys[0].t) return keys[0].v;
  // Binary lookup keeps dense animation tracks cheap during feature-length scrubbing.
  let lo = 0, hi = keys.length - 1;
  if (time >= keys[hi].t) return keys[hi].v;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].t <= time) lo = mid; else hi = mid; }
  const a = keys[lo], b = keys[hi];
  return a.v + (b.v - a.v) * easing((time - a.t) / (b.t - a.t || 1), a.ease);
}
export function movieIndex(shots) {
  let end = 0;
  return shots.map(shot => {
    const start = end; end += Math.max(0.5, number(shot.duration, 5));
    return { shot, start, end };
  });
}
export function locateTime(index, time) {
  if (!index.length) throw new Error('The movie has no shots.');
  time = clamp(number(time, 0), 0, index.at(-1).end);
  let lo = 0, hi = index.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (time < index[mid].end) hi = mid; else lo = mid + 1; }
  const row = index[lo];
  return { shot: row.shot, local: time - row.start, start: row.start };
}
export function renderRange(shots, activeId, settings = {}) {
  const index = movieIndex(shots), total = index.at(-1)?.end || 0;
  let start = 0, end = total;
  if (settings.mode === 'shot') {
    const row = index.find(i => i.shot.id === activeId);
    if (!row) throw new Error('Select a shot to export.');
    ({ start, end } = row);
  } else if (settings.mode === 'range') {
    start = number(settings.start, 0); end = number(settings.end, total);
    if (start < 0 || end > total || end <= start) throw new Error('Render range must be inside the movie, with end after start.');
  }
  if (end <= start) throw new Error('The movie has no duration.');
  return { start, end, duration: end - start };
}
export function shotFilm(input = {}) {
  const colour = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  return {
    grade:gradeSettings(input.grade), lightRig:Object.hasOwn(LIGHT_RIGS,input.lightRig) ? input.lightRig : 'legacy',
    background: colour(input.background, ''), ground: colour(input.ground, '#2b2620'),
    exposure: input.exposure == null ? null : clamp(number(input.exposure, 1.1), 0.2, 3),
    fog: input.fog == null ? null : clamp(number(input.fog, 0), 0, 0.12),
    fadeIn: clamp(number(input.fadeIn, 0), 0, 10), fadeOut: clamp(number(input.fadeOut, 0), 0, 10),
    captions: Array.isArray(input.captions) ? input.captions.slice(0, 2000).filter(c => c && typeof c.text === 'string').map(c => ({
      id: typeof c.id === 'string' ? c.id : 'cue_' + Math.random().toString(36).slice(2),
      start: Math.max(0, number(c.start, 0)), end: Math.max(0, number(c.end, 3)),
      text: c.text.slice(0, 2000), position: c.position === 'center' ? 'center' : 'bottom',
      size: clamp(number(c.size, 4), 2, 10), color: colour(c.color, '#ffffff'),
    })).filter(c => c.end > c.start) : [],
  };
}
export function fadeAmount(film, time, duration) {
  // Cap each fade at half the shot to avoid crossing envelopes.
  const fi = Math.min(film?.fadeIn || 0, duration / 2), fo = Math.min(film?.fadeOut || 0, duration / 2);
  return clamp(Math.max(fi ? 1 - time / fi : 0, fo ? 1 - (duration - time) / fo : 0), 0, 1);
}
function srtSeconds(value) {
  const m = value.trim().match(/^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})$/);
  if (!m) throw new Error('Subtitle timestamps must use HH:MM:SS,mmm.');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}
export function parseSRT(text) {
  if (text.length > 2000000) throw new Error('Subtitle file must be under 2 MB.');
  return text.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/).filter(Boolean).map((block, i) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const times = lines.shift()?.split('-->');
    if (times?.length !== 2) throw new Error('Invalid subtitle block ' + (i + 1));
    const start = srtSeconds(times[0]), end = srtSeconds(times[1]);
    if (end <= start || !lines.join('').trim()) throw new Error('Invalid subtitle duration or empty text in block ' + (i + 1));
    return { start, end, text: lines.join('\n').replace(/<[^>]*>/g, '') };
  });
}
const stamp = t => {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export function movieSRT(shots) {
  const cues = movieIndex(shots).flatMap(({ shot, start }) => (shot.film?.captions || [])
    .filter(c => c.position !== 'center' && c.start < shot.duration && c.end > 0 && c.end > c.start)
    .map(c => ({ ...c, start: start + Math.max(0, c.start), end: start + Math.min(shot.duration, c.end) })));
  return cues.sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n') + '\n';
}
export function inspectGLB(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > 25000000) throw new Error('Choose a GLB file smaller than 25 MB.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Not a valid glTF 2.0 binary (.glb).');
  const size = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || size > buffer.byteLength - 20) throw new Error('GLB JSON chunk is missing or truncated.');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, size)).trim());
  if ([...(json.buffers || []), ...(json.images || [])].some(r => r.uri && !r.uri.startsWith('data:'))) throw new Error('Use a self-contained GLB with embedded textures and buffers. External URLs are not loaded.');
  if ((json.extensionsRequired || []).some(e => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(e))) throw new Error('Compressed Draco, Meshopt and KTX2 assets are not supported yet. Export an uncompressed GLB.');
  if (!json.meshes?.length || (json.nodes?.length || 0) > 10000) throw new Error('GLB must contain meshes and fewer than 10,001 nodes.');
  return { meshes: json.meshes.length, animations: (json.animations || []).map((a, i) => a.name || 'Clip ' + (i + 1)) };
}
