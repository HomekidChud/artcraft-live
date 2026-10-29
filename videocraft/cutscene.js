// Cutscene events & shot transitions — pure, deterministic evaluation.
// Event visibility is derived from shot-local time only: scrubbing backwards,
// switching shots and exporting individual frames all produce the same state.
import { makeId } from './production.js';

export const EVENT_TYPES = ['title', 'subtitle', 'fadein', 'fadeout', 'letterbox', 'shake'];
export const EVENT_LABELS = {
  title: 'Title card', subtitle: 'Subtitle / dialogue', fadein: 'Fade in',
  fadeout: 'Fade out', letterbox: 'Cinema bars', shake: 'Camera shake',
};
export const TRANSITIONS = [['cut', 'Hard cut'], ['fade', 'Fade from black']];

const evNum = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp01 = v => Math.max(0, Math.min(1, v));

export function newEvent(type, start = 0, duration = 2) {
  return {
    id: makeId('ev'), type: EVENT_TYPES.includes(type) ? type : 'title',
    start: Math.max(0, evNum(start, 0)), duration: Math.max(0.1, evNum(duration, 2)),
    text: '', speaker: '', color: '#000000', strength: 0.5,
  };
}

// Normalize an event record coming from JSON (project files / import).
export function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || !EVENT_TYPES.includes(input.type)) return null;
  const e = newEvent(input.type, evNum(input.start, 0), evNum(input.duration, 2));
  e.id = typeof input.id === 'string' && input.id ? input.id : e.id;
  e.text = typeof input.text === 'string' ? input.text.slice(0, 300) : '';
  e.speaker = typeof input.speaker === 'string' ? input.speaker.slice(0, 60) : '';
  e.color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#000000';
  e.strength = clamp01(evNum(input.strength, 0.5));
  return e;
}

export function shotEvents(shot) {
  const raw = Array.isArray(shot?.events) ? shot.events : [];
  return raw.map(normalizeEvent).filter(Boolean);
}

// Evaluate all overlay state for a shot at shot-local time t.
export function evalShotOverlay(shot, t) {
  const state = { fade: 0, fadeColor: '#000000', letterbox: false, title: null, subtitle: null, shake: 0 };
  for (const e of shotEvents(shot)) {
    const d = Math.max(0.1, e.duration);
    if (t < e.start || t > e.start + d) continue;
    const local = clamp01((t - e.start) / d); // 0..1 through the event
    switch (e.type) {
      case 'fadein': {
        const a = 1 - local;
        if (a > state.fade) { state.fade = a; state.fadeColor = e.color; }
        break;
      }
      case 'fadeout': {
        if (local > state.fade) { state.fade = local; state.fadeColor = e.color; }
        break;
      }
      case 'letterbox': state.letterbox = true; break;
      case 'title': {
        const alpha = Math.min(1, local / 0.12, (1 - local) / 0.12);
        if (!state.title || alpha >= state.title.alpha) state.title = { text: e.text, speaker: e.speaker, alpha };
        break;
      }
      case 'subtitle': {
        const alpha = Math.min(1, local / 0.1, (1 - local) / 0.1);
        if (!state.subtitle || alpha >= state.subtitle.alpha) state.subtitle = { text: e.text, speaker: e.speaker, alpha };
        break;
      }
      case 'shake': {
        const envelope = Math.sin(Math.PI * local); // ease in and out
        state.shake = Math.max(state.shake, e.strength * envelope);
        break;
      }
    }
  }
  // shot transition: fade from black at the very start of the shot
  if (shot?.transition === 'fade') {
    const td = Math.max(0.05, evNum(shot.transitionDur, 0.5));
    if (t < td) {
      const a = 1 - t / td;
      if (a > state.fade) { state.fade = a; state.fadeColor = '#000000'; }
    }
  }
  return state;
}

// Deterministic camera shake offset — pure function of strength and time.
export function shakeOffset(strength, t) {
  const s = Math.max(0, Math.min(1, strength)) * 0.14;
  if (s <= 0) return [0, 0, 0];
  return [
    (Math.sin(t * 61.7) + Math.sin(t * 23.9) * 0.6) * s,
    (Math.sin(t * 47.3 + 1.7) + Math.sin(t * 29.1) * 0.5) * s,
    (Math.sin(t * 53.9 + 4.2) + Math.sin(t * 31.7) * 0.4) * s,
  ];
}
