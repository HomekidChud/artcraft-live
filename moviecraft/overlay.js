// Cutscene overlay — a screen-space scene rendered on top of the cinematic
// frame. Because it draws onto the same WebGL canvas after the look pass,
// both export paths (real-time capture and frame-accurate VideoFrame) bake
// titles, subtitles, fades and letterbox into the movie.
// Text is generated on offscreen 2D canvases and used as textures; you cannot
// mix a 2D context onto the WebGL canvas itself.
import * as THREE from 'three';

function makeTextTexture(lines, opts) {
  // opts: { W, H, font, color, speaker, speakerColor, shadow }
  const c = document.createElement('canvas');
  c.width = opts.W; c.height = opts.H;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round';
  const cx = opts.W / 2;
  // lay the whole block out centred: speaker line + text lines, all inside H.
  // the font shrinks automatically so 3 wrapped lines (+ speaker) still fit.
  const hasSpeaker = !!opts.speaker;
  const speakerFont = Math.round(opts.H * 0.14);
  const speakerH = hasSpeaker ? speakerFont * 1.4 : 0;
  const font = Math.min(opts.font, Math.floor((opts.H - speakerH - 8) / (Math.max(1, lines.length) * 1.18)));
  const lineH = font * 1.18;
  const blockH = speakerH + lines.length * lineH;
  let y = (opts.H - blockH) / 2;
  if (hasSpeaker) {
    x.font = '600 ' + speakerFont + 'px Outfit, sans-serif';
    x.fillStyle = opts.speakerColor || '#efb855';
    x.shadowColor = 'rgba(0,0,0,0.7)'; x.shadowBlur = 8;
    x.fillText(opts.speaker.toUpperCase(), cx, y + speakerH / 2);
    y += speakerH;
  }
  x.font = '700 ' + font + 'px Outfit, sans-serif';
  x.fillStyle = opts.color || '#ece7dd';
  x.shadowColor = 'rgba(0,0,0,0.75)'; x.shadowBlur = 12;
  for (const line of lines) {
    x.fillText(line, cx, y + lineH / 2);
    y += lineH;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  lines.push(line);
  return lines.slice(0, 3); // max 3 lines
}

export function createCutsceneOverlay() {
  const scene = new THREE.Scene();
  // NDC-space orthographic camera: x/y in [-1, 1] regardless of canvas size
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const bg = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bg);
  fade.position.z = -1; fade.renderOrder = 30; scene.add(fade);
  const barMat = new THREE.MeshBasicMaterial({ color: '#000000', depthTest: false, depthWrite: false });
  const barGeo = new THREE.PlaneGeometry(2, 0.24); // 12% of height each
  const topBar = new THREE.Mesh(barGeo, barMat);
  topBar.position.set(0, 0.88, -0.5); topBar.renderOrder = 20; scene.add(topBar);
  const bottomBar = new THREE.Mesh(barGeo, barMat);
  bottomBar.position.set(0, -0.88, -0.5); bottomBar.renderOrder = 20; scene.add(bottomBar);

  const titleMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const title = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425), titleMat);
  title.position.set(0, 0.32, -0.4); title.renderOrder = 25; scene.add(title);
  const subMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const subtitle = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), subMat);
  subtitle.position.set(0, -0.74, -0.4); subtitle.renderOrder = 25; scene.add(subtitle);

  const titleCache = { key: '' }, subCache = { key: '' };
  function setText(mesh, mat, cache, key, make) {
    if (cache.key === key) return; // cached
    if (mat.map) mat.map.dispose();
    mat.map = make();
    mat.needsUpdate = true;
    cache.key = key;
  }
  return {
    render(renderer, state) {
      const has = state && (state.fade > 0.001 || state.letterbox || state.title || state.subtitle);
      fade.visible = !!has && state.fade > 0.001;
      if (fade.visible) { bg.opacity = Math.min(1, state.fade); bg.color.set(state.fadeColor || '#000000'); }
      topBar.visible = bottomBar.visible = !!state?.letterbox;
      // Letterbox bars cover NDC y in [0.76, 1] and [-1, -0.76]. The subtitle
      // plane (height 0.3 at y=-0.74) would sit half behind the bottom bar,
      // clipping descenders — lift it just above the bar while letterboxed.
      subtitle.position.y = state?.letterbox ? -0.60 : -0.74;
      const t = state?.title;
      title.visible = !!t && t.alpha > 0.01;
      if (title.visible) {
        setText(title, titleMat, titleCache, 't:' + t.text + '|' + t.speaker + '|' + t.color, () => makeTextTexture(wrapText(t.text, 26), {
          W: 1024, H: 256, font: 72, color: t.color || '#ece7dd', speaker: t.speaker, speakerColor: '#efb855',
        }));
        titleMat.opacity = t.alpha;
      }
      const s = state?.subtitle;
      subtitle.visible = !!s && s.alpha > 0.01;
      if (subtitle.visible) {
        setText(subtitle, subMat, subCache, 's:' + s.text + '|' + s.speaker + '|' + s.color, () => makeTextTexture(wrapText(s.text, 44), {
          W: 1200, H: 200, font: 44, color: s.color || '#f4f0e8', speaker: s.speaker, speakerColor: '#efb855',
        }));
        subMat.opacity = s.alpha;
      }
      if (!has) return;
      const prev = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = prev;
    },
    dispose() {
      scene.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); } });
    },
  };
}
