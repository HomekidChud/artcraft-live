// app.js — VideoCraft editor core
import { renderScene, makeScene, makeObject, attachControls, editorCamera, pickObject, sampleCamera, newId, CHAR_MOTIONS, FX_KINDS, LIGHT_PRESETS, controls } from './scene3d.js?v=1.3.0';
import { LOOK_GRADES } from './look.js?v=1.3.0';

// ---------------------------------------------------------------- state

const ASPECTS = {
  '16:9': { w: 960, h: 540, label: 'Widescreen 1080p', ex: [1920, 1080] },
  '9:16': { w: 540, h: 960, label: 'YouTube Shorts 1080×1920', ex: [1080, 1920] },
  '1:1': { w: 720, h: 720, label: 'Square 1080×1080', ex: [1080, 1080] },
  '4:5': { w: 648, h: 810, label: 'Portrait 1080×1350', ex: [1080, 1350] },
  '2.39:1': { w: 960, h: 402, label: 'Cinema 1920×804', ex: [1920, 804] },
};

const state = {
  name: 'Untitled video',
  aspect: '16:9',
  fps: 30,
  pxPerSec: 80,
  playhead: 0,
  playing: false,
  media: [],   // {id,type,name,url,duration,el?,buf?,thumb?,embedded?}
  clips: [],   // {id,track:'v'|'a',kind:'media'|'scene',mediaId?,sceneId?,start,dur,in,volume,fit}
  scenes: [],
  captions: [], // {id,start,dur,text,pos,size,color,bg}
  sel: null,   // {type, id}
  tab: 'media',
};

const $ = (s) => document.querySelector(s);
const preview = $('#preview');
const ctx = preview.getContext('2d');
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
const fmt1 = (t) => { const m = Math.floor(t / 60), s = Math.round(t % 60); return `${m}:${s < 10 ? '0' : ''}${s}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clipEnd = (c) => c.start + c.dur;
const totalDur = () => Math.max(0, ...state.clips.map(clipEnd), ...state.captions.map(clipEnd), 0.001);
const sceneById = (id) => state.scenes.find((s) => s.id === id);
const clipById = (id) => state.clips.find((c) => c.id === id);
const mediaById = (id) => state.media.find((m) => m.id === id);


// ---------------------------------------------------------------- audio

let audioCtx = null, masterGain = null, streamDest = null;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    streamDest = audioCtx.createMediaStreamDestination();
    masterGain.connect(audioCtx.destination);
    masterGain.connect(streamDest);
    // when the context resumes mid-playback, rebase the clock so the playhead doesn't jump
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
const elSrcNodes = new Map(); // mediaId -> {src, gain}
function mediaGainNode(m) {
  if (!m.el) return null;
  if (!elSrcNodes.has(m.id)) {
    try {
      const src = audioCtx.createMediaElementSource(m.el);
      const gain = audioCtx.createGain();
      src.connect(gain); gain.connect(masterGain);
      elSrcNodes.set(m.id, { src, gain });
    } catch (e) { return null; }
  }
  return elSrcNodes.get(m.id);
}

// ---------------------------------------------------------------- media import

async function importFiles(files) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const id = newId('m');
    const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : file.type.startsWith('image') ? 'image' : null;
    if (!kind) continue;
    const m = { id, type: kind, name: file.name, url, duration: 0, size: file.size, file };
    if (kind === 'video') {
      const el = document.createElement('video');
      el.src = url; el.playsInline = true; el.preload = 'auto'; el.muted = false;
      m.el = el;
      await new Promise((res) => {
        el.onloadedmetadata = () => { m.duration = el.duration || 5; res(); };
        el.onerror = () => res();
        setTimeout(res, 4000);
      });
      m.thumb = grabVideoThumb(el);
    } else if (kind === 'image') {
      const el = new Image();
      el.src = url;
      m.el = el;
      await new Promise((res) => { el.onload = res; el.onerror = res; });
      m.duration = 0; // stills have no natural duration
      m.thumb = url;
    } else {
      ensureAudio();
      try { m.buf = await audioCtx.decodeAudioData(await file.arrayBuffer()); m.duration = m.buf.duration; } catch (e) { continue; }
    }
    const stale = state.media.find((x) => x.missing && x.name === m.name);
    if (stale) {
      m.id = stale.id; // keep original id so existing clips re-link
      state.media = state.media.filter((x) => x !== stale);
    }
    state.media.push(m);
  }
  renderInspector(); renderTimeline(); renderMediaBadge();
}

function grabVideoThumb(el) {
  try {
    const c = document.createElement('canvas'); c.width = 80; c.height = 45;
    const cc = c.getContext('2d');
    cc.drawImage(el, 0, 0, 80, 45);
    return c.toDataURL();
  } catch (e) { return ''; }
}

function addMediaToTimeline(m) {
  const track = m.type === 'audio' ? 'a' : 'v';
  const trackClips = state.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
  let start = 0;
  if (trackClips.length) start = trackClips[trackClips.length - 1].start + trackClips[trackClips.length - 1].dur;
  const dur = m.type === 'image' ? 4 : (m.duration || 4);
  const clip = { id: newId('c'), track, kind: 'media', mediaId: m.id, start, dur, in: 0, volume: 1, fit: 'contain' };
  state.clips.push(clip);
  state.sel = { type: 'clip', id: clip.id };
  renderTimeline(); renderInspector(); drawFrame(state.playhead);
}

function addSceneClip(preset) {
  const scene = makeScene(preset);
  state.scenes.push(scene);
  const trackClips = state.clips.filter((c) => c.track === 'v').sort((a, b) => a.start - b.start);
  let start = 0;
  if (trackClips.length) start = trackClips[trackClips.length - 1].start + trackClips[trackClips.length - 1].dur;
  const clip = { id: newId('c'), track: 'v', kind: 'scene', sceneId: scene.id, start, dur: scene.duration, in: 0, volume: 1 };
  state.clips.push(clip);
  state.sel = { type: 'clip', id: clip.id };
  state.tab = 'scene';
  syncEditorCamToShot();
  renderRail(); renderTimeline(); renderInspector(); drawFrame(state.playhead);
}

// ---------------------------------------------------------------- playback

let rafId = 0;
let playCtxTime = 0, playStartHead = 0;
const activeAudio = new Set();
const startedAudioClips = new Set();

function playClock() {
  // single monotonic source — the wall clock; audio is started to match, videos self-sync
  return performance.now() / 1000;
}
function play() {
  ensureAudio();
  if (state.playing) return;
  if (state.playhead >= totalDur() - 0.02) state.playhead = 0;
  state.playing = true;
  playCtxTime = playClock();
  playStartHead = state.playhead;
  startedAudioClips.clear();
  startClipMedia();
  for (const c of state.clips) {
    if (c.track === 'a' && state.playhead >= c.start - 1e-4 && state.playhead < clipEnd(c) - 1e-4) startedAudioClips.add(c.id);
  }
  updatePlayBtn();
}
function pause() {
  if (!state.playing) return;
  state.playing = false;
  stopClipMedia();
  updatePlayBtn();
}
function togglePlay() { state.playing ? pause() : play(); }
function updatePlayBtn() {
  $('#btn-play').innerHTML = state.playing
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'
    : '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
}

function clipAtPlayhead(track) {
  return state.clips.find((c) => c.track === track && state.playhead >= c.start - 1e-4 && state.playhead < clipEnd(c) - 1e-4);
}

function startClipMedia() {
  const t = state.playhead;
  for (const c of state.clips) {
    const covers = t >= c.start - 1e-4 && t < clipEnd(c) - 1e-4;
    if (c.track === 'v' && c.kind === 'media') {
      const m = mediaById(c.mediaId);
      if (!m || m.type !== 'video' || !m.el) continue;
      if (covers) {
        m.el.currentTime = Math.min(m.duration - 0.05, c.in + (t - c.start));
        m.el.play().catch(() => { m.el.muted = true; m.el.play().catch(() => {}); });
        const g = mediaGainNode(m); if (g) g.gain.gain.value = c.volume;
        activeAudio.add(m.id);
      }
    } else if (c.track === 'a') {
      const m = mediaById(c.mediaId);
      if (!m || !m.buf || !covers) continue;
      const src = audioCtx.createBufferSource();
      src.buffer = m.buf;
      const gain = audioCtx.createGain(); gain.gain.value = c.volume;
      src.connect(gain); gain.connect(masterGain);
      const offset = c.in + (t - c.start);
      src.start(0, Math.max(0, offset), Math.max(0.01, c.dur - (t - c.start)));
      src.userData = { clipId: c.id };
      activeAudio.add(src);
    }
  }
}
function stopClipMedia() {
  for (const m of state.media) if (m.el && m.el.tagName === 'VIDEO') m.el.pause();
  for (const src of activeAudio) { if (src instanceof AudioBufferSourceNode) try { src.stop(); } catch (e) {} }
  activeAudio.clear();
  startedAudioClips.clear();
}

function maybeStartAudioClip(c) {
  if (c.track !== 'a' || startedAudioClips.has(c.id)) return;
  if (state.playhead < c.start - 1e-4 || state.playhead >= clipEnd(c) - 1e-4) return;
  const m = mediaById(c.mediaId);
  if (!m || !m.buf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = m.buf;
  const gain = audioCtx.createGain(); gain.gain.value = c.volume;
  src.connect(gain); gain.connect(masterGain);
  const offset = c.in + (state.playhead - c.start);
  src.start(0, Math.max(0, offset), Math.max(0.01, c.dur - (state.playhead - c.start)));
  activeAudio.add(src);
  startedAudioClips.add(c.id);
}

function tick() {
  rafId = requestAnimationFrame(tick);
  if (state.playing) {
    const t = playStartHead + (playClock() - playCtxTime);
    const total = totalDur();
    if (t >= total) {
      state.playhead = total;
      pause();
      if (exporting) finishExport();
    } else {
      state.playhead = t;
      updatePlayheadPos();
      for (const c of state.clips) if (c.track === 'a') maybeStartAudioClip(c);
      if (exporting) {
        const total = totalDur();
        const bar = document.querySelector('#export-bar');
        if (bar) bar.style.width = `${Math.min(100, (t / total) * 100)}%`;
        const et = document.querySelector('#export-time');
        if (et) et.textContent = fmt(t);
      }
      // start/stop videos as we cross clip boundaries
      const vc = clipAtPlayhead('v');
      for (const c of state.clips) {
        if (c.track === 'v' && c.kind === 'media') {
          const m = mediaById(c.mediaId);
          if (!m || m.type !== 'video' || !m.el) continue;
          const isCur = vc === c;
          if (isCur && m.el.paused) {
            const want = c.in + (state.playhead - c.start);
            if (Math.abs(m.el.currentTime - want) > 0.25) m.el.currentTime = Math.max(0, want);
            m.el.play().catch(() => { m.el.muted = true; m.el.play().catch(() => {}); });
            const g = mediaGainNode(m); if (g) g.gain.gain.value = c.volume;
          }
          if (!isCur && !m.el.paused) m.el.pause();
        }
      }
    }
    updateTimeUI();
  }
  drawFrame(state.playhead);
}

// ---------------------------------------------------------------- draw

function setPreviewSize() {
  const a = ASPECTS[state.aspect];
  preview.width = a.w; preview.height = a.h;
  $('#safe-margins').style.display = $('#safe-toggle').checked ? 'block' : 'none';
}

function drawFrame(t, forceShotCam = false) {
  const W = preview.width, H = preview.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const c = state.clips.filter((x) => x.track === 'v').find((x) => t >= x.start - 1e-4 && t < clipEnd(x) - 1e-4);
  let sceneDef = null;
  if (c) {
    if (c.kind === 'media') {
      const m = mediaById(c.mediaId);
      if (m && m.el) {
        const local = t - c.start;
        if (m.type === 'video') {
          if (!state.playing) {
            const want = c.in + local;
            if (Math.abs(m.el.currentTime - want) > 0.25) m.el.currentTime = want;
          }
          drawFitted(m.el, c.fit, W, H);
        } else if (m.type === 'image') {
          drawFitted(m.el, c.fit, W, H);
        }
      } else {
        drawMissing(c, W, H);
      }
    } else if (c.kind === 'scene') {
      sceneDef = sceneById(c.sceneId);
      if (sceneDef) {
        const useEditor = !state.playing && !forceShotCam && state.sel?.type === 'clip' && state.sel.id === c.id;
        const glc = renderScene(sceneDef, t - c.start + (c.in || 0), W, H, { editorCamera: useEditor });
        ctx.drawImage(glc, 0, 0, W, H);
        drawSceneEvents(sceneDef, t - c.start, W, H);
      }
    }
  }
  drawCaptions(t, W, H);
}

function drawFitted(el, fit, W, H) {
  const vw = el.videoWidth || el.naturalWidth, vh = el.videoHeight || el.naturalHeight;
  if (!vw || !vh) return;
  const ar = vw / vh, car = W / H;
  let dx = 0, dy = 0, dw = W, dh = H;
  if (fit === 'stretch') { /* full */ }
  else if (fit === 'cover') {
    if (ar > car) { dh = H; dw = H * ar; dx = (W - dw) / 2; } else { dw = W; dh = W / ar; dy = (H - dh) / 2; }
  } else { // contain
    if (ar > car) { dw = W; dh = W / ar; dy = (H - dh) / 2; } else { dh = H; dw = H * ar; dx = (W - dw) / 2; }
  }
  try { ctx.drawImage(el, dx, dy, dw, dh); } catch (e) {}
}

function drawMissing(c, W, H) {
  const m = state.media.find((x) => x.id === c.mediaId);
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#555'; ctx.font = `${Math.round(H * 0.035)}px Satoshi, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`Re-link media: ${m ? m.name : 'missing'}`, W / 2, H / 2);
  ctx.textAlign = 'left';
}

function drawCaptions(t, W, H) {
  for (const cap of state.captions) {
    if (t < cap.start || t > clipEnd(cap)) continue;
    const fs = Math.round(H * 0.042 * (cap.size || 1));
    const lines = (cap.text || '').split('\n');
    ctx.font = `700 ${fs}px Satoshi, Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lh = fs * 1.25;
    let maxW = 0; for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    const blockH = lh * lines.length;
    let cy = H * 0.86 - blockH / 2;
    if (cap.pos === 'middle') cy = H / 2 - blockH / 2;
    if (cap.pos === 'top') cy = H * 0.12;
    if (cap.bg) {
      const pad = fs * 0.5;
      ctx.fillStyle = 'rgba(8,8,10,0.78)';
      const bx = W / 2 - maxW / 2 - pad, bw = maxW + pad * 2, by = cy - lh / 2 - pad * 0.4, bh = blockH + pad * 0.8;
      const r = fs * 0.35;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, r); ctx.fill();
    }
    ctx.fillStyle = cap.color || '#fff';
    lines.forEach((l, i) => {
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = cap.bg ? 0 : fs * 0.15;
      ctx.fillText(l, W / 2, cy + lh * i + lh / 2);
      ctx.shadowBlur = 0;
    });
    ctx.textAlign = 'left';
  }
}

function drawSceneEvents(scene, localT, W, H) {
  for (const ev of scene.events || []) {
    if (ev.type === 'fadein' || ev.type === 'fadeout') {
      const p = (localT - ev.t) / ev.dur;
      if (p < 0 || p > 1) continue;
      const a = ev.type === 'fadein' ? 1 - p : p;
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H);
    } else if (ev.type === 'letterbox') {
      if (localT < ev.t) continue;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H * 0.12); ctx.fillRect(0, H * 0.88, W, H * 0.12);
    }
  }
}

// ---------------------------------------------------------------- timeline UI

const trackV = $('#track-v'), trackA = $('#track-a'), trackCap = $('#track-cap');
const tlInner = $('#tl-inner'), tlScroll = $('#tl-scroll');
const rulerCanvas = $('#ruler-canvas');

function renderTimeline() {
  // width
  const total = Math.max(totalDur() + 6, tlScroll.clientWidth / state.pxPerSec);
  tlInner.style.width = `${Math.max(tlScroll.clientWidth, total * state.pxPerSec)}px`;
  drawRuler();
  for (const el of [trackV, trackA, trackCap]) el.innerHTML = '';
  const tracks = { v: [trackV, 'video'], a: [trackA, 'audio'] };
  for (const c of [...state.clips].sort((a, b) => a.start - b.start)) {
    const [parent] = tracks[c.track];
    const div = document.createElement('div');
    let cls = `clip ${c.kind === 'scene' ? 'scene' : 'video'}`;
    if (c.track === 'a') cls = 'clip audio';
    if (c.kind === 'media' && mediaById(c.mediaId)?.type === 'image') cls = 'clip image';
    div.className = cls;
    div.dataset.id = c.id;
    div.style.left = `${c.start * state.pxPerSec}px`;
    div.style.width = `${Math.max(14, c.dur * state.pxPerSec)}px`;
    div.innerHTML = `
      <div class="grip l" data-edge="l"></div>
      <span class="lbl">${esc(clipLabel(c))}</span>
      <div class="grip r" data-edge="r"></div>`;
    if (state.sel?.type === 'clip' && state.sel.id === c.id) div.classList.add('selected');
    parent.appendChild(div);
  }
  for (const cap of state.captions) {
    const pill = document.createElement('div');
    pill.className = 'cap-pill';
    pill.dataset.id = cap.id;
    pill.style.left = `${cap.start * state.pxPerSec}px`;
    pill.style.width = `${Math.max(30, cap.dur * state.pxPerSec)}px`;
    pill.innerHTML = `<div class="grip l" data-edge="l"></div><span style="pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((cap.text || '').split('\n')[0].slice(0, 24))}</span><div class="grip r" data-edge="r"></div>`;
    if (state.sel?.type === 'caption' && state.sel.id === cap.id) pill.classList.add('selected');
    trackCap.appendChild(pill);
  }
  updatePlayheadPos();
  updateTimeUI();
  renderDurBadge();
}

function clipLabel(c) {
  if (c.kind === 'scene') return sceneById(c.sceneId)?.name || 'Scene';
  const m = mediaById(c.mediaId);
  return m ? m.name.replace(/\.[^.]+$/, '').slice(0, 22) : 'Missing';
}

function drawRuler() {
  const w = tlInner.clientWidth, h = 30;
  rulerCanvas.width = w; rulerCanvas.height = h;
  const c2 = rulerCanvas.getContext('2d');
  c2.fillStyle = '#1a1917'; c2.fillRect(0, 0, w, h);
  const pps = state.pxPerSec;
  const step = pps < 30 ? 10 : pps < 60 ? 5 : pps < 150 ? 1 : pps < 300 ? 0.5 : 0.25;
  c2.font = '10px JetBrains Mono, monospace'; c2.fillStyle = '#6b675f';
  for (let s = 0; s * pps < w; s += step) {
    const x = s * pps;
    const isMajor = Number.isInteger(s) && (step <= 1 || s % step < 1e-6);
    c2.strokeStyle = '#3a3835';
    c2.beginPath(); c2.moveTo(x + 0.5, isMajor ? 8 : 20); c2.lineTo(x + 0.5, 30); c2.stroke();
    if (isMajor) c2.fillText(fmt1(s), x + 3, 12);
  }
}

function updatePlayheadPos() {
  $('#playhead').style.left = `${state.playhead * state.pxPerSec}px`;
}
function updateTimeUI() {
  $('#time-label').innerHTML = `<b>${fmt(state.playhead)}</b> / ${fmt(totalDur())}`;
}
function renderDurBadge() {
  const total = totalDur();
  const b = $('#dur-badge');
  b.textContent = fmt1(total);
  if (state.aspect === '9:16') {
    b.className = 'badge ' + (total <= 180 ? 'ok' : 'warn');
    b.title = total <= 180 ? 'Within Shorts 3:00 limit' : 'Over the 3:00 Shorts limit';
  } else { b.className = 'badge ok'; b.title = ''; }
}

// ---------------------------------------------------------------- timeline interactions

let drag = null; // {type:'clip'|'cap', id, mode:'move'|'l'|'r', startX, orig}
tlInner.addEventListener('pointerdown', (e) => {
  const clipEl = e.target.closest('.clip');
  const capEl = e.target.closest('.cap-pill');
  const target = clipEl || capEl;
  if (!target) return;
  const type = clipEl ? 'clip' : 'caption';
  const id = target.dataset.id;
  state.sel = { type, id };
  if (type === 'clip') {
    const c = clipById(id);
    if (c.kind === 'scene') state.tab = 'scene';
    else state.tab = 'media';
  } else state.tab = 'captions';
  const edge = e.target.dataset?.edge;
  drag = { type, id, mode: edge || 'move', startX: e.clientX, orig: type === 'clip' ? { ...clipById(id) } : { ...state.captions.find((x) => x.id === id) } };
  tlInner.classList.add('dragging');
  tlInner.setPointerCapture(e.pointerId);
  renderInspector(); renderTimeline();
  e.preventDefault();
});
tlInner.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dt = (e.clientX - drag.startX) / state.pxPerSec;
  if (drag.type === 'clip') {
    const c = clipById(drag.id);
    if (!c) return;
    const siblings = state.clips.filter((x) => x.track === c.track && x.id !== c.id).sort((a, b) => a.start - b.start);
    const prev = siblings.filter((x) => clipEnd(x) <= drag.orig.start + 1e-4).pop();
    const next = siblings.find((x) => x.start >= clipEnd(drag.orig) - 1e-4);
    if (drag.mode === 'move') {
      let ns = snapT(drag.orig.start + dt);
      const lo = prev ? clipEnd(prev) : 0;
      const hi = next ? next.start : Infinity;
      ns = Math.min(Math.max(ns, lo), hi - c.dur);
      c.start = Math.max(0, ns);
    } else if (drag.mode === 'l') {
      let ns = snapT(drag.orig.start + dt);
      const lo = prev ? clipEnd(prev) : 0;
      ns = Math.min(Math.max(ns, lo), drag.orig.start + drag.orig.dur - 0.2);
      const m = c.kind === 'media' ? mediaById(c.mediaId) : null;
      if (m && (m.type === 'video' || m.type === 'audio')) {
        const newIn = drag.orig.in + (ns - drag.orig.start);
        if (newIn < 0) ns = drag.orig.start - drag.orig.in;
      }
      c.in = drag.orig.in + (ns - drag.orig.start);
      c.dur = drag.orig.start + drag.orig.dur - ns;
      c.start = ns;
    } else if (drag.mode === 'r') {
      let nd = snapT(drag.orig.dur + dt);
      const hi = next ? next.start : Infinity;
      const m = c.kind === 'media' ? mediaById(c.mediaId) : null;
      let maxDur = hi - c.start;
      if (m && (m.type === 'video' || m.type === 'audio')) maxDur = Math.min(maxDur, m.duration - c.in);
      if (c.kind === 'scene') maxDur = Math.min(maxDur, 3600);
      c.dur = Math.min(Math.max(nd, 0.2), maxDur);
      if (c.kind === 'scene') { const sc = sceneById(c.sceneId); if (sc) sc.duration = c.dur; }
    }
  } else {
    const cap = state.captions.find((x) => x.id === drag.id);
    if (!cap) return;
    if (drag.mode === 'move') {
      const others = state.captions.filter((x) => x.id !== cap.id);
      let ns = snapT(drag.orig.start + dt);
      const lo = others.reduce((acc, x) => (clipEnd(x) <= drag.orig.start + 1e-4) ? Math.max(acc, clipEnd(x)) : acc, 0);
      const hi = others.reduce((acc, x) => (x.start >= clipEnd(drag.orig) - 1e-4) ? Math.min(acc, x.start) : acc, Infinity);
      cap.start = Math.max(0, Math.min(Math.max(ns, lo), hi - cap.dur));
    } else if (drag.mode === 'l') {
      let ns = snapT(drag.orig.start + dt);
      ns = Math.min(Math.max(ns, 0), drag.orig.start + drag.orig.dur - 0.3);
      cap.dur = drag.orig.start + drag.orig.dur - ns;
      cap.start = ns;
    } else {
      cap.dur = Math.max(0.3, snapT(drag.orig.dur + dt));
    }
  }
  renderTimeline();
  if (!state.playing) drawFrame(state.playhead);
});
window.addEventListener('pointerup', () => {
  if (drag) {
    if (drag.type === 'clip' && drag.mode === 'move') {
      const c = clipById(drag.id);
      if (c) {
        const hit = state.clips.find((x) => x.track === c.track && x.id !== c.id && c.start < clipEnd(x) - 1e-4 && clipEnd(c) > x.start + 1e-4);
        if (hit) {
          if (c.start >= drag.orig.start) c.start = clipEnd(hit); // dropped right: place after
          else c.start = Math.max(0, hit.start - c.dur);          // dropped left: place before
        }
      }
    }
    drag = null; tlInner.classList.remove('dragging'); renderInspector(); renderTimeline();
  }
});

function snapT(t) { return Math.round(t * 10) / 10; }

// ruler scrub
$('#ruler').addEventListener('pointerdown', (e) => {
  const scrub = (ev) => {
    const rect = tlScroll.getBoundingClientRect();
    state.playhead = Math.max(0, (ev.clientX - rect.left + tlScroll.scrollLeft) / state.pxPerSec);
    if (state.playing) { playStartHead = state.playhead; playCtxTime = playClock(); startClipMedia(); }
    updatePlayheadPos(); updateTimeUI();
    if (!state.playing) drawFrame(state.playhead);
  };
  scrub(e);
  const mv = (ev) => scrub(ev);
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
});

$('#tl-zoom').addEventListener('input', (e) => {
  state.pxPerSec = +e.target.value;
  renderTimeline();
});

// ---------------------------------------------------------------- transport & keys

$('#btn-play').addEventListener('click', togglePlay);
$('#btn-back').addEventListener('click', () => {
  state.playhead = 0;
  if (state.playing) { playStartHead = 0; playCtxTime = playClock(); startClipMedia(); }
  updatePlayheadPos(); updateTimeUI(); drawFrame(0);
});
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea,select')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveProject(); }
});

function deleteSelected() {
  if (!state.sel) return;
  if (state.sel.type === 'clip') {
    const c = clipById(state.sel.id);
    state.clips = state.clips.filter((x) => x.id !== state.sel.id);
    if (c?.kind === 'scene') {
      const stillUsed = state.clips.some((x) => x.sceneId === c.sceneId);
      if (!stillUsed) state.scenes = state.scenes.filter((s) => s.id !== c.sceneId);
    }
  } else if (state.sel.type === 'caption') {
    state.captions = state.captions.filter((x) => x.id !== state.sel.id);
  } else if (state.sel.type === 'sceneObj') {
    const sc = activeScene();
    if (sc) { sc.objects = sc.objects.filter((o) => o.id !== state.sel.id); sc._rev++; }
  } else if (state.sel.type === 'media') {
    const m = mediaById(state.sel.id);
    if (m) {
      state.clips = state.clips.filter((c) => c.mediaId !== m.id);
      state.media = state.media.filter((x) => x.id !== m.id);
    }
  }
  state.sel = null;
  renderTimeline(); renderInspector(); drawFrame(state.playhead);
}

$('#btn-split').addEventListener('click', () => {
  const t = state.playhead;
  let target = state.sel?.type === 'clip' ? clipById(state.sel.id) : null;
  if (!target || t <= target.start + 0.1 || t >= clipEnd(target) - 0.1) {
    target = state.clips.find((c) => (c.track === 'v' || c.track === 'a') && t > c.start + 0.1 && t < clipEnd(c) - 0.1);
  }
  if (!target) return;
  const second = { ...target, id: newId('c'), start: t, dur: clipEnd(target) - t, in: target.in + (t - target.start) };
  target.dur = t - target.start;
  state.clips.push(second);
  renderTimeline(); renderInspector();
});
$('#btn-del').addEventListener('click', deleteSelected);

// ---------------------------------------------------------------- inspector

const inspBody = $('#insp-body'), inspHead = $('#insp-head');
const TAB_TITLES = { media: 'Media', scene: '3D Scene', captions: 'Captions', look: 'Look & Render', export: 'Export' };

function renderRail() {
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
}
document.querySelectorAll('.rail-btn').forEach((b) => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  renderRail(); renderInspector();
}));

function activeScene() {
  // scene of selected clip, else scene clip under playhead
  let c = state.sel?.type === 'clip' ? clipById(state.sel.id) : null;
  if (!c || c.kind !== 'scene') c = clipAtPlayhead('v');
  if (!c || c.kind !== 'scene') c = state.clips.find((x) => x.kind === 'scene');
  return c ? sceneById(c.sceneId) : null;
}
function activeSceneClip() {
  let c = state.sel?.type === 'clip' ? clipById(state.sel.id) : null;
  if (!c || c.kind !== 'scene') c = clipAtPlayhead('v');
  if (!c || c.kind !== 'scene') c = state.clips.find((x) => x.kind === 'scene');
  return c && c.kind === 'scene' ? c : null;
}

function renderInspector() {
  inspHead.textContent = TAB_TITLES[state.tab];
  const sel = state.sel;
  switch (state.tab) {
    case 'media': renderMediaTab(sel); break;
    case 'scene': renderSceneTab(sel); break;
    case 'captions': renderCaptionsTab(sel); break;
    case 'look': renderLookTab(); break;
    case 'export': renderExportTab(); break;
  }
}

// ---- media tab
function renderMediaTab(sel) {
  let html = `
    <div class="insp-section">
      <div class="grid-2">
        <button class="btn primary" id="btn-import">Import files</button>
        <button class="btn" id="btn-add-scene">Add 3D scene</button>
      </div>
      <p class="note">Import video, images and audio — then click a file to add it to the timeline. 3D scenes are built right in the app.</p>
    </div>`;
  if (!state.media.length) html += `<div class="empty">No media yet.<br>Import some files or add a 3D scene to start.</div>`;
  // selected clip properties
  if (sel?.type === 'clip') {
    const c = clipById(sel.id);
    if (c) {
      const m = c.kind === 'media' ? mediaById(c.mediaId) : null;
      const isVisual = c.track === 'v';
      html += `<div class="insp-section"><div class="insp-title">Selected clip</div>
        <div class="row"><label>Start</label><input type="number" id="cl-start" step="0.1" value="${c.start.toFixed(1)}" style="width:70px"><span class="val">s</span></div>
        <div class="row"><label>Duration</label><input type="number" id="cl-dur" step="0.1" value="${c.dur.toFixed(1)}" style="width:70px"><span class="val">s</span></div>
        ${c.track === 'v' ? `<div class="row"><label>Fit</label><select id="cl-fit" style="flex:1"><option value="contain" ${c.fit === 'contain' ? 'selected' : ''}>Contain</option><option value="cover" ${c.fit === 'cover' ? 'selected' : ''}>Cover</option><option value="stretch" ${c.fit === 'stretch' ? 'selected' : ''}>Stretch</option></select></div>` : ''}
        ${c.kind === 'scene' ? `<div class="row"><label>Edit scene</label><button class="btn tiny" id="cl-editscene">Open editor</button></div>` : ''}
        <div class="row"><label>Volume</label><input type="range" id="cl-vol" min="0" max="1" step="0.05" value="${c.volume}"><span class="val">${Math.round(c.volume * 100)}%</span></div>
        <div class="grid-2">
          <button class="btn tiny" id="cl-split">Split at playhead</button>
          <button class="btn tiny danger" id="cl-del">Delete clip</button>
        </div>
      </div>`;
    }
  }
  for (const m of state.media) {
    const isSel = sel?.type === 'media' && sel.id === m.id;
    html += `<div class="list-item ${isSel ? 'selected' : ''}" data-mid="${m.id}">
      <span class="dot" style="background:${m.type === 'video' ? '#e8a13d' : m.type === 'image' ? '#c77b9e' : '#6db56b'}"></span>
      ${m.thumb ? `<img src="${m.thumb}" style="width:44px;height:26px;object-fit:cover;border-radius:3px">` : ''}
      <span class="nm">${esc(m.name)}</span>
      <span class="meta">${m.type === 'image' ? 'still' : fmt1(m.duration)}</span>
    </div>`;
  }
  inspBody.innerHTML = html;
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#btn-add-scene').addEventListener('click', () => addSceneClip('hero'));
  // clip properties wiring
  const selClip = sel?.type === 'clip' ? clipById(sel.id) : null;
  if (selClip) {
    const c = selClip;
    const upd = () => { renderTimeline(); if (!state.playing) drawFrame(state.playhead); };
    $('#cl-start')?.addEventListener('change', (e) => {
      const siblings = state.clips.filter((x) => x.track === c.track && x.id !== c.id).sort((a, b) => a.start - b.start);
      const prev = siblings.filter((x) => clipEnd(x) <= c.start + 1e-4).pop();
      const next = siblings.find((x) => x.start >= clipEnd(c) - 1e-4);
      let ns = Math.max(0, +e.target.value);
      ns = Math.min(Math.max(ns, prev ? clipEnd(prev) : 0), (next ? next.start : Infinity) - c.dur);
      c.start = Math.max(0, ns); upd();
    });
    $('#cl-dur')?.addEventListener('change', (e) => {
      const m = c.kind === 'media' ? mediaById(c.mediaId) : null;
      const siblings = state.clips.filter((x) => x.track === c.track && x.id !== c.id).sort((a, b) => a.start - b.start);
      const next = siblings.find((x) => x.start >= clipEnd(c) - 1e-4);
      let d = Math.max(0.2, +e.target.value);
      if (m && (m.type === 'video' || m.type === 'audio')) d = Math.min(d, m.duration - c.in);
      if (next) d = Math.min(d, next.start - c.start);
      c.dur = Math.max(0.2, d);
      if (c.kind === 'scene') { const sc = sceneById(c.sceneId); if (sc) sc.duration = c.dur; }
      upd();
    });
    $('#cl-fit')?.addEventListener('change', (e) => { c.fit = e.target.value; upd(); });
    $('#cl-vol')?.addEventListener('input', (e) => {
      c.volume = +e.target.value;
      e.target.nextElementSibling.textContent = `${Math.round(c.volume * 100)}%`;
      const m = c.kind === 'media' ? mediaById(c.mediaId) : null;
      if (m && m.el?.tagName === 'VIDEO') { const g = mediaGainNode(m); if (g) g.gain.gain.value = c.volume; }
      if (c.track === 'a' && state.playing) { pause(); play(); }
    });
    $('#cl-split')?.addEventListener('click', () => $('#btn-split').click());
    $('#cl-del')?.addEventListener('click', deleteSelected);
    $('#cl-editscene')?.addEventListener('click', () => {
      state.tab = 'scene'; syncEditorCamToShot(); renderRail(); renderInspector(); drawFrame(state.playhead);
    });
  }
  inspBody.querySelectorAll('.list-item').forEach((el) => {
    el.addEventListener('click', () => {
      const m = mediaById(el.dataset.mid);
      state.sel = { type: 'media', id: m.id };
      addMediaToTimeline(m);
    });
  });
}
$('#file-import').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });

function renderMediaBadge() { /* duration badge refresh handled in renderTimeline */ }

// ---- scene tab
function renderSceneTab(sel) {
  const scene = activeScene();
  const clip = activeSceneClip();
  if (!scene) {
    inspBody.innerHTML = `<div class="empty">No 3D scene in this project.<br><button class="btn primary" id="btn-add-scene2" style="margin-top:8px">Add a 3D scene</button></div>`;
    $('#btn-add-scene2')?.addEventListener('click', () => addSceneClip('hero'));
    return;
  }
  const selObj = sel?.type === 'sceneObj' ? scene.objects.find((o) => o.id === sel.id) : null;
  const localT = Math.max(0, Math.min(scene.duration, state.playhead - (clip ? clip.start : 0)));
  let html = `
    <div class="insp-section">
      <div class="row"><label>Scene name</label><input type="text" id="sc-name" value="${esc(scene.name)}" style="flex:1.4"></div>
      <div class="row"><label>Duration</label><input type="range" id="sc-dur" min="1" max="120" step="0.5" value="${scene.duration}"><span class="val">${scene.duration.toFixed(1)}s</span></div>
    </div>
    <div class="insp-section">
      <div class="insp-title">Objects</div>
      <div class="grid-3" style="margin-bottom:8px">
        ${['box', 'sphere', 'cylinder'].map((t) => `<button class="btn tiny" data-addobj="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <div class="grid-3" style="margin-bottom:8px">
        <button class="btn tiny" data-addobj="text">Text</button>
        <button class="btn tiny" data-addobj="character">Char</button>
        <button class="btn tiny" data-addobj="fx">FX</button>
      </div>`;
  if (!scene.objects.length) html += `<div class="empty">Empty scene — add objects above.</div>`;
  for (const o of scene.objects) {
    html += `<div class="list-item ${selObj?.id === o.id ? 'selected' : ''}" data-oid="${o.id}">
      <span class="dot" style="background:${o.color || '#888'}"></span><span class="nm">${esc(o.name)}</span></div>`;
  }
  html += `</div>`;
  // selected object editor
  if (selObj) {
    html += `<div class="insp-section"><div class="insp-title">Edit: ${esc(selObj.name)}</div>
      <div class="row"><label>Name</label><input type="text" id="obj-name" value="${esc(selObj.name)}" style="flex:1.4"></div>`;
    if (selObj.type !== 'character' && selObj.type !== 'ground') {
      html += `<div class="row"><label>Color</label><input type="color" id="obj-color" value="${selObj.color}" style="width:34px;height:24px"></div>`;
    }
    if (selObj.type === 'text') {
      html += `<div class="row"><label>Text</label><input type="text" id="obj-text" value="${esc(selObj.text)}" style="flex:1.4"></div>
        <div class="row"><label>Size</label><input type="range" id="obj-size" min="0.3" max="6" step="0.1" value="${selObj.size}"><span class="val">${selObj.size}</span></div>`;
    }
    if (selObj.type === 'character') {
      html += `<div class="row"><label>Motion</label><select id="obj-motion" style="flex:1.4">${CHAR_MOTIONS.map((mm) => `<option ${selObj.motion === mm ? 'selected' : ''}>${mm}</option>`).join('')}</select></div>
        <div class="grid-2">
          <div class="row"><label style="flex:1">Skin</label><input type="color" id="obj-skin" value="${selObj.skin}"></div>
          <div class="row"><label style="flex:1">Hair</label><input type="color" id="obj-hair" value="${selObj.hair}"></div>
          <div class="row"><label style="flex:1">Shirt</label><input type="color" id="obj-shirt" value="${selObj.shirt}"></div>
          <div class="row"><label style="flex:1">Pants</label><input type="color" id="obj-pants" value="${selObj.pants}"></div>
        </div>`;
    }
    if (selObj.type === 'fx') {
      html += `<div class="row"><label>Effect</label><select id="obj-fx" style="flex:1.4">${FX_KINDS.map((f) => `<option ${selObj.fx === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>`;
    }
    if (selObj.type === 'text' || selObj.type === 'character' || selObj.type === 'fx') { /* no generic */ } else {
      html += `<div class="row"><label>Opacity</label><input type="range" id="obj-opacity" min="0.1" max="1" step="0.05" value="${selObj.opacity}"><span class="val">${selObj.opacity}</span></div>`;
    }
    html += `
      <div class="insp-title" style="margin-top:10px">Transform</div>
      <div class="grid-3">
        ${['x', 'y', 'z'].map((ax, i) => `<input type="number" step="0.1" data-pos="${i}" value="${selObj.pos[i]}" style="width:100%">`).join('')}
      </div>
      <div class="grid-3" style="margin-top:4px">
        ${['x', 'y', 'z'].map((ax, i) => `<input type="number" step="0.1" data-rot="${i}" value="${(selObj.rot[i] * 57.2958).toFixed(0)}" style="width:100%">`).join('')}
      </div>
      <div class="grid-3" style="margin-top:4px">
        ${['x', 'y', 'z'].map((ax, i) => `<input type="number" step="0.1" data-scl="${i}" value="${selObj.scale[i]}" style="width:100%">`).join('')}
      </div>
      <div class="grid-3" style="margin-top:4px">
        <input type="number" step="0.1" data-scl-unif placeholder="uniform" style="width:100%">
      </div>
      <div class="row" style="margin-top:10px">
        <select class="btn tiny" id="obj-ease" style="flex:1">
          <option value="smooth">Smooth</option><option value="linear">Linear</option><option value="easein">Ease in</option><option value="easeout">Ease out</option><option value="back">Overshoot</option><option value="bounce">Bounce</option><option value="step">Step</option>
        </select>
        <button class="btn tiny primary" id="obj-key">Key transform here</button>
        <button class="btn tiny danger" id="obj-del">Delete</button>
      </div>`;
    if (selObj.keys?.length) {
      html += `<div class="insp-title" style="margin-top:8px">Keys</div>`;
      selObj.keys.forEach((k, i) => {
        html += `<div class="list-item" data-keydel="${i}"><span class="nm">@ ${k.t.toFixed(1)}s</span><span class="meta">${k.ease || 'smooth'} · remove</span></div>`;
      });
    }
    html += `</div>`;
  }
  // camera
  html += `<div class="insp-section"><div class="insp-title">Camera</div>
    <p class="note">Drag in the preview to orbit while paused with this scene selected.</p>
    <div class="grid-2">
      <button class="btn tiny" id="cam-setbase">Save current view</button>
      <button class="btn tiny primary" id="cam-addkey">Add key @ ${(clip ? state.playhead - clip.start : 0).toFixed(1)}s</button>
    </div>
    <div class="row" style="margin-top:4px">
      <select class="btn tiny" id="cam-ease" style="flex:1">
        <option value="smooth">Ease: smooth</option><option value="linear">Ease: linear</option><option value="easein">Ease in</option><option value="easeout">Ease out</option><option value="back">Overshoot</option><option value="bounce">Bounce</option><option value="step">Step</option>
      </select>
    </div>`;
  if (scene.camKeys?.length) {
    scene.camKeys.forEach((k, i) => {
      html += `<div class="list-item" data-camkeydel="${i}"><span class="nm">@ ${k.t.toFixed(1)}s</span><span class="meta">${k.ease || 'smooth'} · remove</span></div>`;
    });
  }
  html += `</div>`;
  // lighting & events
  html += `<div class="insp-section"><div class="insp-title">Lighting</div>
    <div class="row"><select id="sc-light" style="flex:1.4">${LIGHT_PRESETS.map((p) => `<option ${scene.lighting === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="row"><label>Sky color</label><input type="color" id="sc-sky" value="${scene.sky}"></div>
    <div class="row"><label>Fog</label><input type="range" id="sc-fog" min="0" max="100" value="${scene.fog}"><span class="val">${scene.fog}</span></div>
  </div>
  <div class="insp-section"><div class="insp-title">Events</div>
    <div class="grid-3">
      <button class="btn tiny" data-addev="fadein">Fade in</button>
      <button class="btn tiny" data-addev="fadeout">Fade out</button>
      <button class="btn tiny" data-addev="letterbox">Letterbox</button>
    </div>`;
  for (const ev of scene.events || []) {
    html += `<div class="list-item"><span class="nm">${ev.type} @ ${ev.t.toFixed(1)}s (${ev.dur.toFixed(1)}s)</span><span class="meta" data-evdel="${scene.events.indexOf(ev)}">remove</span></div>`;
  }
  html += `</div>`;

  inspBody.innerHTML = html;
  wireSceneTab(scene, clip);
}

function wireSceneTab(scene, clip) {
  const bump = () => { scene._rev++; drawFrame(state.playhead); renderTimeline(); };
  const localT = () => Math.max(0, Math.min(scene.duration, state.playhead - (clip ? clip.start : 0)));
  $('#sc-name').addEventListener('change', (e) => { scene.name = e.target.value; bump(); });
  $('#sc-dur').addEventListener('input', (e) => {
    scene.duration = +e.target.value;
    if (clip) { clip.dur = scene.duration; }
    e.target.nextElementSibling.textContent = `${scene.duration.toFixed(1)}s`;
    bump();
  });
  inspBody.querySelectorAll('[data-addobj]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.addobj;
    const o = makeObject(t);
    if (t === 'text') { o.pos = [0, 2.2, 0]; }
    scene.objects.push(o);
    state.sel = { type: 'sceneObj', id: o.id };
    bump(); renderInspector();
  }));
  inspBody.querySelectorAll('[data-oid]').forEach((el) => el.addEventListener('click', () => {
    state.sel = { type: 'sceneObj', id: el.dataset.oid };
    renderInspector();
  }));
  const selObj = state.sel?.type === 'sceneObj' ? scene.objects.find((o) => o.id === state.sel.id) : null;
  if (selObj) {
    $('#obj-name').addEventListener('change', (e) => { selObj.name = e.target.value; bump(); });
    $('#obj-color')?.addEventListener('input', (e) => { selObj.color = e.target.value; bump(); });
    $('#obj-text')?.addEventListener('change', (e) => { selObj.text = e.target.value; bump(); });
    $('#obj-size')?.addEventListener('input', (e) => { selObj.size = +e.target.value; bump(); });
    $('#obj-opacity')?.addEventListener('input', (e) => { selObj.opacity = +e.target.value; bump(); });
    $('#obj-motion')?.addEventListener('change', (e) => { selObj.motion = e.target.value; bump(); });
    $('#obj-fx')?.addEventListener('change', (e) => { selObj.fx = e.target.value; bump(); });
    for (const k of ['skin', 'hair', 'shirt', 'pants']) $(`#obj-${k}`)?.addEventListener('input', (e) => { selObj[k] = e.target.value; bump(); });
    inspBody.querySelectorAll('[data-pos]').forEach((inp) => inp.addEventListener('input', (e) => { selObj.pos[+e.target.dataset.pos] = +e.target.value || 0; bump(); }));
    inspBody.querySelectorAll('[data-rot]').forEach((inp) => inp.addEventListener('input', (e) => { selObj.rot[+e.target.dataset.rot] = (+e.target.value || 0) / 57.2958; bump(); }));
    inspBody.querySelectorAll('[data-scl]').forEach((inp) => inp.addEventListener('input', (e) => { selObj.scale[+e.target.dataset.scl] = +e.target.value || 1; bump(); }));
    inspBody.querySelectorAll('[data-scl-unif]').forEach((inp) => inp.addEventListener('change', (e) => {
      const v = +e.target.value || 1; selObj.scale = [v, v, v]; bump(); renderInspector();
    }));
    $('#obj-key')?.addEventListener('click', () => {
      selObj.keys = selObj.keys || [];
      selObj.keys = selObj.keys.filter((k) => Math.abs(k.t - localT()) > 0.05);
      selObj.keys.push({ t: localT(), pos: [...selObj.pos], rot: [...selObj.rot], scale: [...selObj.scale], ease: $('#obj-ease')?.value || 'smooth' });
      bump(); renderInspector();
    });
    $('#obj-del')?.addEventListener('click', () => { scene.objects = scene.objects.filter((o) => o !== selObj); state.sel = null; bump(); renderInspector(); });
    inspBody.querySelectorAll('[data-keydel]').forEach((el) => el.addEventListener('click', () => {
      selObj.keys.splice(+el.dataset.keydel, 1); bump(); renderInspector();
    }));
  }
  $('#cam-setbase')?.addEventListener('click', () => {
    scene.camera = { pos: [...editorCamera.position.toArray()], target: [...controls.target.toArray()] };
    bump();
  });
  $('#cam-addkey')?.addEventListener('click', () => {
    scene.camKeys = scene.camKeys || [];
    scene.camKeys = scene.camKeys.filter((k) => Math.abs(k.t - localT()) > 0.05);
    scene.camKeys.push({ t: localT(), pos: [...editorCamera.position.toArray()], target: [...controls.target.toArray()], ease: $('#cam-ease')?.value || 'smooth' });
    bump(); renderInspector();
  });
  inspBody.querySelectorAll('[data-camkeydel]').forEach((el) => el.addEventListener('click', () => {
    scene.camKeys.splice(+el.dataset.camkeydel, 1); bump(); renderInspector();
  }));
  $('#sc-light')?.addEventListener('change', (e) => { scene.lighting = e.target.value; bump(); });
  $('#sc-sky')?.addEventListener('input', (e) => { scene.sky = e.target.value; bump(); });
  $('#sc-fog')?.addEventListener('input', (e) => { scene.fog = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; bump(); });
  inspBody.querySelectorAll('[data-addev]').forEach((b) => b.addEventListener('click', () => {
    const type = b.dataset.addev;
    scene.events = scene.events || [];
    const t = localT();
    if (type === 'letterbox') scene.events.push({ type, t: 0, dur: 0 });
    else if (type === 'fadein') scene.events.push({ type, t: 0, dur: 0.6 });
    else scene.events.push({ type, t: Math.max(0, scene.duration - 0.6), dur: 0.6 });
    bump(); renderInspector();
  }));
  inspBody.querySelectorAll('[data-evdel]').forEach((el) => el.addEventListener('click', () => {
    scene.events.splice(+el.dataset.evdel, 1); bump(); renderInspector();
  }));
}

function syncEditorCamToShot() {
  const scene = activeScene();
  const clip = activeSceneClip();
  if (!scene || !controls) return;
  const localT = Math.max(0, Math.min(scene.duration, state.playhead - (clip ? clip.start : 0)));
  const v = sampleCamera(scene, localT);
  editorCamera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}

// ---- captions tab
function renderCaptionsTab(sel) {
  const cap = sel?.type === 'caption' ? state.captions.find((c) => c.id === sel.id) : null;
  let html = `<div class="insp-section">
    <button class="btn primary" id="cap-add">Add caption at playhead</button>
    <p class="note">Captions render into the exported video — burned in, styled text over any clip.</p>
  </div>`;
  for (const c of state.captions) {
    html += `<div class="list-item ${cap?.id === c.id ? 'selected' : ''}" data-cid="${c.id}">
      <span class="dot" style="background:#e8a13d"></span><span class="nm">${esc((c.text || '').split('\n')[0].slice(0, 20))}</span>
      <span class="meta">${fmt1(c.start)}</span></div>`;
  }
  if (cap) {
    html += `<div class="insp-section"><div class="insp-title">Edit caption</div>
      <textarea id="cap-text" rows="3" style="width:100%;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:6px;padding:6px 8px">${esc(cap.text)}</textarea>
      <div class="row" style="margin-top:6px"><label>Start</label><input type="number" id="cap-start" step="0.1" value="${cap.start.toFixed(1)}" style="width:70px"><span class="val">s</span></div>
      <div class="row"><label>Duration</label><input type="range" id="cap-dur" min="0.3" max="60" step="0.1" value="${cap.dur}"><span class="val">${cap.dur.toFixed(1)}s</span></div>
      <div class="row"><label>Size</label><input type="range" id="cap-size" min="0.5" max="3" step="0.1" value="${cap.size}"><span class="val">${cap.size}</span></div>
      <div class="row"><label>Position</label><select id="cap-pos" style="flex:1"><option value="bottom" ${cap.pos === 'bottom' ? 'selected' : ''}>Bottom</option><option value="middle" ${cap.pos === 'middle' ? 'selected' : ''}>Middle</option><option value="top" ${cap.pos === 'top' ? 'selected' : ''}>Top</option></select></div>
      <div class="grid-2">
        <div class="row"><label style="flex:1">Color</label><input type="color" id="cap-color" value="${cap.color}"></div>
        <div class="row"><label style="flex:1">Backdrop</label><input type="checkbox" id="cap-bg" ${cap.bg ? 'checked' : ''}></div>
      </div>
      <div class="row"><button class="btn tiny danger" id="cap-del">Delete caption</button></div>
    </div>`;
  }
  inspBody.innerHTML = html;
  $('#cap-add')?.addEventListener('click', () => {
    const cap = { id: newId('cap'), start: state.playhead, dur: 2.5, text: 'Your caption', pos: 'bottom', size: 1, color: '#ffffff', bg: true };
    state.captions.push(cap);
    state.sel = { type: 'caption', id: cap.id };
    renderTimeline(); renderInspector(); drawFrame(state.playhead);
  });
  inspBody.querySelectorAll('[data-cid]').forEach((el) => el.addEventListener('click', () => {
    state.sel = { type: 'caption', id: el.dataset.cid };
    renderInspector();
  }));
  if (cap) {
    const upd = () => { renderTimeline(); drawFrame(state.playhead); };
    $('#cap-text').addEventListener('change', (e) => { cap.text = e.target.value; upd(); renderInspector(); });
    $('#cap-start').addEventListener('change', (e) => { cap.start = Math.max(0, +e.target.value); upd(); });
    $('#cap-dur').addEventListener('input', (e) => { cap.dur = +e.target.value; e.target.nextElementSibling.textContent = `${cap.dur.toFixed(1)}s`; upd(); });
    $('#cap-size').addEventListener('input', (e) => { cap.size = +e.target.value; e.target.nextElementSibling.textContent = cap.size; upd(); });
    $('#cap-pos').addEventListener('change', (e) => { cap.pos = e.target.value; upd(); });
    $('#cap-color').addEventListener('input', (e) => { cap.color = e.target.value; upd(); });
    $('#cap-bg').addEventListener('change', (e) => { cap.bg = e.target.checked; upd(); });
    $('#cap-del').addEventListener('click', () => { state.captions = state.captions.filter((c) => c !== cap); state.sel = null; upd(); renderInspector(); });
  }
}

// ---- look tab
function renderLookTab() {
  const scene = activeScene();
  if (!scene) {
    inspBody.innerHTML = `<div class="empty">Add a 3D scene to control its look.<br>Video and image clips use their own pixels.</div>`;
    return;
  }
  const L = scene.look;
  const slider = (id, label, min, max, step, val, fmtv) =>
    `<div class="row"><label>${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val">${fmtv(val)}</span></div>`;
  inspBody.innerHTML = `
    <div class="insp-section">
      <div class="insp-title">Style</div>
      <div class="row"><select id="lk-style" style="flex:1.4">
        <option value="film" ${L.style === 'film' ? 'selected' : ''}>Film — cinematic</option>
        <option value="anime" ${L.style === 'anime' ? 'selected' : ''}>Anime — toon + ink</option>
        <option value="clean" ${L.style === 'clean' ? 'selected' : ''}>Clean — raw</option>
      </select></div>
      <div class="row"><label>Grade</label><select id="lk-grade" style="flex:1.4">${LOOK_GRADES.map((g) => `<option ${L.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    </div>
    <div class="insp-section"><div class="insp-title">Finishing</div>
      ${slider('lk-bloom', 'Bloom', 0, 2, 0.05, L.bloom, (v) => (+v).toFixed(2))}
      ${slider('lk-vig', 'Vignette', 0, 1, 0.05, L.vignette, (v) => (+v).toFixed(2))}
      ${slider('lk-grain', 'Grain', 0, 0.3, 0.01, L.grain, (v) => (+v).toFixed(2))}
      ${slider('lk-chroma', 'Chroma', 0, 2, 0.1, L.chroma, (v) => (+v).toFixed(1))}
      ${slider('lk-streak', 'Flare streak', 0, 1.5, 0.05, L.streak, (v) => (+v).toFixed(2))}
      ${slider('lk-exp', 'Exposure', 0.3, 2, 0.05, L.exposure, (v) => (+v).toFixed(2))}
    </div>
    <div class="insp-section"><div class="insp-title">Anime</div>
      ${slider('lk-outline', 'Ink outline', 0, 2, 0.1, L.outline, (v) => (+v).toFixed(1))}
      ${slider('lk-toon', 'Toon steps', 2, 8, 1, L.toonSteps, (v) => v)}
      <p class="note">Outlines are depth-based and drawn on every mesh.</p>
    </div>`;
  const upd = () => { scene._rev++; drawFrame(state.playhead); };
  $('#lk-style').addEventListener('change', (e) => { L.style = e.target.value; upd(); });
  $('#lk-grade').addEventListener('change', (e) => { L.grade = e.target.value; upd(); });
  for (const [id, key, fmtv] of [
    ['lk-bloom', 'bloom', (v) => (+v).toFixed(2)], ['lk-vig', 'vignette', (v) => (+v).toFixed(2)],
    ['lk-grain', 'grain', (v) => (+v).toFixed(2)], ['lk-chroma', 'chroma', (v) => (+v).toFixed(1)],
    ['lk-streak', 'streak', (v) => (+v).toFixed(2)], ['lk-exp', 'exposure', (v) => (+v).toFixed(2)],
    ['lk-outline', 'outline', (v) => (+v).toFixed(1)], ['lk-toon', 'toonSteps', (v) => v],
  ]) {
    $('#' + id).addEventListener('input', (e) => {
      L[key] = +e.target.value;
      e.target.nextElementSibling.textContent = fmtv(e.target.value);
      upd();
    });
  }
}

// ---- export tab
function renderExportTab() {
  const a = ASPECTS[state.aspect];
  const mp4ok = webCodecsOk();
  inspBody.innerHTML = `
    <div class="insp-section">
      <div class="insp-title">Output</div>
      <div class="row"><label>Format</label><span style="font-size:var(--text-sm)">${a.label}</span></div>
      <div class="row"><label>Export size</label><span class="val" style="min-width:90px">${a.ex[0]} × ${a.ex[1]}</span></div>
      <div class="row"><label>Frame rate</label><select id="ex-fps" style="flex:1.4">${[24, 25, 30, 50, 60].map((f) => `<option value="${f}" ${state.fps === f ? 'selected' : ''}>${f} fps${f === 24 ? ' (cinema)' : f === 30 ? ' (standard)' : f === 60 ? ' (smooth)' : ''}</option>`).join('')}</select></div>
      <div class="row"><label>Length</label><span class="val">${fmt1(totalDur())}</span></div>
      <div class="row"><label>Container</label><span class="val">${mp4ok ? 'MP4 (H.264 + AAC)' : 'WebM (VP9/VP8)'}</span></div>
      <div class="row"><label>Quality</label>
        <select id="ex-quality" style="flex:1.4">
          <option value="0.2">High</option>
          <option value="0.12" selected>Standard</option>
          <option value="0.07">Draft</option>
        </select></div>
    </div>
    <div class="insp-section">
      <button class="btn primary" id="btn-export" style="width:100%;justify-content:center">${mp4ok ? 'Export MP4 video' : 'Record & export video'}</button>
      ${mp4ok ? `<button class="btn" id="btn-export-webm" style="width:100%;justify-content:center;margin-top:6px">Record WebM in real time</button>` : ''}
      <p class="note">${mp4ok
        ? 'Frame-by-frame H.264/AAC encode via WebCodecs — usually faster than real time, works while the tab is in the background, audio and burned-in captions included. If the browser can\u2019t encode H.264 it falls back to real-time WebM recording.'
        : 'This browser has no WebCodecs, so the movie is recorded in real time as it plays once — audio included, captions burned in. Keep this tab in the foreground until it finishes, then the .webm downloads automatically.'}</p>
    </div>`;
  $('#btn-export').addEventListener('click', () => (mp4ok ? exportMp4() : startExport()));
  $('#btn-export-webm')?.addEventListener('click', startExport);
  $('#ex-fps')?.addEventListener('change', (e) => { state.fps = +e.target.value; bump(); });
}
$('#btn-export-top').addEventListener('click', () => {
  state.tab = 'export'; renderRail(); renderInspector();
  webCodecsOk() ? exportMp4() : startExport();
});

// ---------------------------------------------------------------- export

let exporting = false, recorder = null, exportChunks = [], exportStartWall = 0, exportStream = null;

function pickMime() {
  for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function startExport() {
  if (!state.clips.length) { alert('Add some clips first — the timeline is empty.'); return; }
  if (exporting) return;
  ensureAudio();
  pause();
  const a = ASPECTS[state.aspect];
  const prevW = preview.width, prevH = preview.height;
  // resize canvases to export resolution
  preview.width = a.ex[0]; preview.height = a.ex[1];
  const stream = preview.captureStream(state.fps);
  exportStream = stream;
  // only record audio when the context is actually running — a suspended context's
  // audio track can make MediaRecorder produce an empty file
  if (audioCtx.state !== 'running') {
    await new Promise((res) => {
      const t0 = setTimeout(res, 300);
      audioCtx.resume().then(() => { clearTimeout(t0); res(); }).catch(res);
    });
  }
  if (audioCtx.state === 'running') {
    const audioTracks = streamDest.stream.getAudioTracks();
    for (const t of audioTracks) stream.addTrack(t);
  }
  const mime = pickMime();
  recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
  exportChunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) exportChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(exportChunks, { type: mime.split(';')[0] || 'video/webm' });
    const name = (state.name || 'video').replace(/[^\w\- ]+/g, '').trim() || 'video';
    if (window.__vcPostUrl) {
      // agent channel: POST the exported blob instead of downloading
      fetch(window.__vcPostUrl, { method: 'POST', body: blob }).catch(() => {});
    } else {
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = `${name} (${state.aspect.replace(':', 'x')}).webm`;
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 30_000);
    }
  };
  exporting = true;
  $('#export-overlay').style.display = 'grid';
  state.playhead = 0;
  drawFrame(0);
  recorder.start(400);
  exportStartWall = performance.now();
  play();
}

function finishExport() {
  if (!exporting) return;
  setTimeout(() => {
    try { recorder.stop(); } catch (e) {}
    // release the canvas capture stream (keep the shared audio track alive)
    try { exportStream?.getVideoTracks().forEach((t) => t.stop()); } catch (e) {}
    exportStream = null;
    preview.width = ASPECTS[state.aspect].w; preview.height = ASPECTS[state.aspect].h;
    $('#export-overlay').style.display = 'none';
    exporting = false;
    state.playhead = 0;
    drawFrame(0);
  }, 350);
}

// ---------------------------------------------------------------- export: WebCodecs MP4
// Frame-by-frame H.264 + AAC encode into a real .mp4 — faster than real time,
// no tab-visibility requirement, higher quality than MediaRecorder capture.

const webCodecsOk = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
const vcLog = (stage, note) => { window.__vcProgress = { ...window.__vcProgress, stage, note }; (window.__vcLog = window.__vcLog || []).push({ stage, note, at: Date.now() }); };

function seekVideoEl(el, t) {
  return new Promise((res) => {
    if (!isFinite(t) || t < 0) t = 0;
    if (Math.abs(el.currentTime - t) < 1e-4) return res();
    let done = false;
    const finish = () => { if (done) return; done = true; el.removeEventListener('seeked', finish); clearTimeout(to); res(); };
    const to = setTimeout(finish, 800);
    el.addEventListener('seeked', finish);
    try { el.currentTime = t; } catch (e) { finish(); }
  });
}

async function renderAudioOffline(total) {
  // Rebuild the project's audio mix in an OfflineAudioContext at 48 kHz stereo.
  // Returns an AudioBuffer, or null when the project has no (decodable) audio.
  const SR = 48000;
  const candidates = state.clips.filter((c) => {
    if (c.kind !== 'media') return false;
    const m = mediaById(c.mediaId);
    if (!m || !m.file) return false;
    return c.track === 'a' || (c.track === 'v' && m.type === 'video');
  });
  if (!candidates.length) return null;
  const oc = new OfflineAudioContext(2, Math.max(SR / 10, Math.ceil(total * SR)), SR);
  const master = oc.createGain(); master.gain.value = 0.9; master.connect(oc.destination);
  let any = false;
  for (const c of candidates) {
    const m = mediaById(c.mediaId);
    let buf = m.buf || null;
    if (!buf && m.file) {
      try { buf = await oc.decodeAudioData(await m.file.arrayBuffer()); m.buf = buf; } catch (e) { continue; }
    }
    if (!buf) continue;
    const src = oc.createBufferSource(); src.buffer = buf;
    const gain = oc.createGain(); gain.gain.value = c.volume ?? 1;
    src.connect(gain); gain.connect(master);
    const when = Math.max(0, c.start);
    const offset = Math.max(0, c.in || 0);
    const dur = Math.min(c.dur, buf.duration - offset);
    if (dur > 0.005) { src.start(when, offset, dur); any = true; }
  }
  if (!any) return null;
  return await oc.startRendering();
}

async function exportMp4() {
  if (!state.clips.length) { alert('Add some clips first — the timeline is empty.'); return; }
  if (exporting) return;
  pause();
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');
  const a = ASPECTS[state.aspect];
  const [W, H] = a.ex;
  const fps = state.fps;
  const total = totalDur();
  const frames = Math.max(1, Math.ceil(total * fps));
  const quality = +(window.__vcQuality ?? document.querySelector('#ex-quality')?.value ?? 0.12);
  const bitrate = Math.round(Math.min(40e6, Math.max(1.5e6, W * H * fps * quality)));

  // pick the first H.264 config this browser actually supports
  let vconf = null;
  for (const codec of ['avc1.640034', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01e']) {
    const conf = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
    const s = await VideoEncoder.isConfigSupported(conf).catch(() => null);
    if (s?.supported) { vconf = conf; break; }
  }
  if (!vconf) { alert('This browser can\u2019t encode H.264 — falling back to real-time WebM recording.'); return startExport(); }

  const prevW = preview.width, prevH = preview.height;
  preview.width = W; preview.height = H;
  exporting = true;
  const overlay = $('#export-overlay'), note = $('#export-note'), bar = $('#export-bar'), et = $('#export-time');
  overlay.querySelector('h3').textContent = 'Exporting MP4';
  overlay.style.display = 'grid';
  const t0 = performance.now();
  vcLog('video'); window.__vcProgress = { stage: 'video', frame: 0, frames };

  const restore = () => {
    preview.width = prevW; preview.height = prevH;
    overlay.style.display = 'none';
    overlay.querySelector('h3').textContent = 'Recording export';
    exporting = false;
    state.playhead = 0;
    drawFrame(0);
  };

  try {
    // ---- video: draw each frame, encode it, keep the encoded chunks
    const videoChunks = [];
    const venc = new VideoEncoder({
      output: (chunk, meta) => videoChunks.push({ chunk, meta }),
      error: (e) => console.error('VideoEncoder', e),
    });
    venc.configure(vconf);
    const vTrack = state.clips.filter((c) => c.track === 'v');
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      const cur = vTrack.find((c) => t >= c.start - 1e-4 && t < clipEnd(c) - 1e-4);
      if (cur && cur.kind === 'media') {
        const m = mediaById(cur.mediaId);
        if (m && m.type === 'video' && m.el) await seekVideoEl(m.el, cur.in + (t - cur.start));
      }
      drawFrame(t, true);
      const frame = new VideoFrame(preview, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      if ((i & 15) === 0 || i === frames - 1) {
        const done = (i + 1) / frames;
        const speed = done > 0.01 ? ((i + 1) / ((performance.now() - t0) / 1000)).toFixed(1) : '…';
        bar.style.width = `${Math.round(done * 100)}%`;
        note.textContent = `Encoding frame ${i + 1} / ${frames} (${speed}\u00d7 real time)`;
        et.textContent = fmt(done * total);
        window.__vcProgress = { stage: 'video', frame: i + 1, frames };
      }
    }
    await venc.flush();
    venc.close();

    // ---- audio: offline mix, then encode (AAC when the browser can encode it, Opus otherwise)
    note.textContent = 'Encoding audio…';
    const audioChunks = [];
    let audioCodec = null;
    const mix = await renderAudioOffline(total);
    vcLog('audio-mix', mix ? `${mix.length} samples` : 'no decodable audio');
    if (mix) {
      let aconf = null;
      for (const c of ['mp4a.40.2', 'opus']) {
        const conf = { codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
        const s = await AudioEncoder.isConfigSupported(conf).catch(() => null);
        if (s?.supported) { aconf = conf; audioCodec = c === 'mp4a.40.2' ? 'aac' : 'opus'; break; }
      }
      if (aconf) {
        const aenc = new AudioEncoder({
          output: (chunk, meta) => audioChunks.push({ chunk, meta }),
          error: (e) => console.error('AudioEncoder', e),
        });
        aenc.configure(aconf);
        const CH = 2, CHUNK = 4800; // 100 ms at 48 kHz
        const L = mix.getChannelData(0);
        const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
        for (let off = 0; off < mix.length; off += CHUNK) {
          const n = Math.min(CHUNK, mix.length - off);
          const data = new Float32Array(n * CH);
          data.set(L.subarray(off, off + n), 0);
          data.set(R.subarray(off, off + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: CH, timestamp: Math.round((off / 48000) * 1e6), data });
          aenc.encode(ad);
          ad.close();
          while (aenc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 0));
        }
        await aenc.flush();
        aenc.close();
        vcLog('audio-encode', `${audioChunks.length} chunks (${aconf.codec})`);
      } else {
        vcLog('audio-encode', 'no audio encoder available — exporting video only');
      }
    }

    // ---- mux
    note.textContent = 'Writing MP4…';
    vcLog('mux', `${videoChunks.length} video + ${audioChunks.length} audio chunks`);
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H },
      ...(audioChunks.length ? { audio: { codec: audioCodec, numberOfChannels: 2, sampleRate: 48000 } } : {}),
      fastStart: 'in-memory',
    });
    for (const { chunk, meta } of videoChunks) muxer.addVideoChunk(chunk, meta);
    for (const { chunk, meta } of audioChunks) muxer.addAudioChunk(chunk, meta);
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });

    const name = (state.name || 'video').replace(/[^\w\- ]+/g, '').trim() || 'video';
    const fname = `${name} (${state.aspect.replace(':', 'x')}).mp4`;
    window.__vcResult = { name: fname, size: blob.size, type: 'video/mp4' };
    if (window.__vcPostUrl) {
      note.textContent = 'Sending to the CLI…';
      await fetch(window.__vcPostUrl, { method: 'POST', body: blob }).catch(() => {});
    } else {
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = fname;
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 30_000);
    }
    restore();
    vcLog('done', 'wrote ' + blob.size + ' bytes');
  } catch (err) {
    console.error(err);
    restore();
    alert('MP4 export failed (' + (err?.message || err) + ').\nFalling back to real-time WebM recording.');
    return startExport();
  }
}

// ---------------------------------------------------------------- save / open

async function saveProject() {
  const data = {
    app: 'videocraft', version: 1,
    name: state.name, aspect: state.aspect, fps: state.fps,
    clips: state.clips, scenes: state.scenes, captions: state.captions,
    media: [],
  };
  // embed small images/audio as data URLs
  for (const m of state.media) {
    const entry = { id: m.id, type: m.type, name: m.name, duration: m.duration };
    if (m.file && m.file.size < 8_000_000 && (m.type === 'image' || m.type === 'audio')) {
      entry.data = await fileToDataURL(m.file);
    }
    data.media.push(entry);
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.name || 'project').replace(/[^\w\- ]+/g, '')}.vfproject.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function fileToDataURL(file) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
}

async function applyProjectData(data) {
  if (data.app !== 'videocraft') throw new Error('Not a VideoCraft project');
  state.name = data.name || 'Untitled video';
  state.aspect = data.aspect || '16:9';
  state.clips = data.clips || [];
  state.scenes = data.scenes || [];
  state.captions = data.captions || [];
  state.media = [];
  for (const entry of data.media || []) {
    if (entry.data) {
      // restore embedded media
      const blob = await (await fetch(entry.data)).blob();
      const f = new File([blob], entry.name, { type: blob.type });
      await importFiles([f]);
      const m = state.media[state.media.length - 1];
      if (m) m.id = entry.id;
    } else {
      state.media.push({ id: entry.id, type: entry.type, name: entry.name, duration: entry.duration, missing: true, url: null });
    }
  }
  // re-map ids for embedded (importFiles assigned new ids) — clips reference entry ids
  $('#project-name').value = state.name;
  $('#aspect').value = state.aspect;
  setPreviewSize();
  renderTimeline(); renderInspector(); drawFrame(0);
}

$('#file-open').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    await applyProjectData(JSON.parse(await file.text()));
  } catch (err) {
    alert('Could not open project: ' + err.message);
  }
});
$('#btn-open').addEventListener('click', () => $('#file-open').click());
$('#btn-save').addEventListener('click', saveProject);

// ---------------------------------------------------------------- misc ui

$('#project-name').addEventListener('change', (e) => { state.name = e.target.value; });
$('#aspect').addEventListener('change', (e) => {
  state.aspect = e.target.value;
  setPreviewSize();
  if (!exporting) drawFrame(state.playhead);
  renderExportTabIfActive();
  renderDurBadge();
});
function renderExportTabIfActive() { if (state.tab === 'export') renderExportTab(); }
$('#safe-toggle').addEventListener('change', setPreviewSize);
$('#btn-new').addEventListener('click', () => {
  if (!confirm('Start a new project? Unsaved work is lost.')) return;
  newProject();
});

function newProject() {
  pause();
  state.media = []; state.clips = []; state.captions = []; state.scenes = [];
  state.sel = null; state.playhead = 1.5; state.tab = 'media';
  addSceneClip('hero');
  const cap = { id: newId('cap'), start: 0.8, dur: 3, text: 'My video', pos: 'bottom', size: 1.2, color: '#ffffff', bg: true };
  state.captions.push(cap);
  state.name = 'Untitled video';
  $('#project-name').value = state.name;
  renderRail(); renderTimeline(); renderInspector(); drawFrame(0);
}

// viewport: click select objects in scene, orbit otherwise
let vDown = null;
preview.addEventListener('pointerdown', (e) => { vDown = { x: e.clientX, y: e.clientY }; });
preview.addEventListener('pointerup', (e) => {
  if (!vDown) return;
  const moved = Math.hypot(e.clientX - vDown.x, e.clientY - vDown.y);
  vDown = null;
  if (moved > 6 || state.playing || exporting) return;
  const c = clipAtPlayhead('v');
  if (!c || c.kind !== 'scene') return;
  const scene = sceneById(c.sceneId);
  if (!scene) return;
  const r = preview.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hit = pickObject(scene, nx, ny);
  if (hit) {
    state.sel = { type: 'sceneObj', id: hit };
    state.tab = 'scene';
    renderRail(); renderInspector();
  }
});

// ---------------------------------------------------------------- init

attachControls(preview);
setPreviewSize();
state.playhead = 1.5;
addSceneClip('hero');
const cap0 = { id: newId('cap'), start: 0.8, dur: 3, text: 'My video', pos: 'bottom', size: 1.2, color: '#ffffff', bg: true };
state.captions.push(cap0);
state.sel = null;
renderRail(); renderTimeline(); renderInspector();
syncEditorCamToShot();
drawFrame(0);
requestAnimationFrame(tick);

// ---------------------------------------------------------------- headless automation
// Open the app with ?headless=1 to expose a small automation API on window.vc.
// Used by tools/vc.mjs (the VideoCraft CLI) — see videocraft/README.md.

if (new URLSearchParams(location.search).has('headless')) {
  window.__vcProgress = { stage: 'boot' };
  window.vc = {
    state,
    async loadProject(json) {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      await applyProjectData(data);
      return { name: state.name, aspect: state.aspect, duration: totalDur(), clips: state.clips.length, scenes: state.scenes.length, captions: state.captions.length };
    },
    async render(opts = {}) {
      if (opts.postUrl) window.__vcPostUrl = opts.postUrl;
      window.__vcQuality = { high: 0.2, standard: 0.12, draft: 0.07 }[opts.quality] ?? 0.12;
      await exportMp4();
      return window.__vcResult;
    },
  };
  window.__vcProgress = { stage: 'ready' };
}
