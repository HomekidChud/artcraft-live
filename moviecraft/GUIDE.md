# MovieCraft — Agent Guide

Machine-readable guide for AI agents driving [MovieCraft](./index.html), a browser-native 3D movie studio (single-page app, no backend, no auth). The docs page for humans is [docs.html](./docs.html). Verify selectors against the current `index.html`/`app.js` before relying on them.

## Environment

- Pure client-side app: `index.html` + ES modules (`app.js`, `fx.js`, `fx-core.js`), Three.js from CDN via import map.
- No API, no login, no server state. Automate through a browser driver (Playwright/Puppeteer/CDP) or by authoring project JSON (below).
- Storage is `localStorage` (autosave). File save/open uses real downloads/uploads — use DataTransfer to inject `File` objects into `#file-open` (projects, `.videocraft`/`.json`) or `#glb-file-input` (GLB models).
- Native `confirm()` dialogs appear on destructive actions and >300s exports — stub `window.confirm = () => true` for headless runs.

## Stable selectors

| Action | Selector |
|---|---|
| Workspace switch | `.rail-btn[data-ws="draw\|char\|scene\|anim"]` (also production tabs) |
| Top bar | `#btn-starter`, `#btn-race`, `#btn-new`, `#btn-open`, `#btn-save`, `#btn-download-video`, `#btn-help` |
| Project open | `#btn-open` then `#file-open` |
| Scene: add objects/FX/GLB | buttons in `#scene-list`, matched by text: `+ box`, `+ fire FX`, `+ import GLB model`, `+ drawing: name`, `+ character name` |
| Scene: GLB file input | click `+ import GLB model` (creates `#glb-file-input`), then set via DataTransfer |
| Scene: props of selection | `#scene-props` (rebuilt by app) |
| Animate: playback | `#btn-play`, `#btn-movie` |
| Animate: shots | `#btn-shot-add`, `#btn-shot-dup`, `#btn-shot-up`, `#btn-shot-down`, `#btn-shot-del`, `#shot-duration`, `#shot-list` |
| Animate: fps | `#anim-fps` (range 10–60) |
| Export | `#btn-record` (frame-accurate), `#btn-download-video` (real-time) |
| Export options | `#export-mode`, `#export-res`, `#export-quality`, `#export-start`, `#export-end` |
| Export status | `#rec-status` (textContent: "Rendering N%…", "Movie rendered · N frames…", "Export failed: …") |
| Timeline | `#timeline`, `#tl-canvas`, playhead `#tl-playhead` |

## Key flows

1. **Build**: switch to Scene (`data-ws="scene"`), add objects, set `pos/rot/scale/color/opacity` in `#scene-props`. FX objects: kind in `fire | smoke | sparks | explosion | fountain`, params `intensity`, `fxSize`, `fxSpeed`, `fxStart` (all keyframable).
2. **Animate**: Animate workspace. Select object, move gizmo, `#btn-key-add` (keyframe). Channels: `pos`, `rot`, `scale` (+ FX params). Shots are sequential; `totalDuration = Σ shot.duration`.
3. **Export frame-accurate**: set `#export-start`/`#export-end` (seconds; blank = full movie), click `#btn-record`. Output WebM (VP8, 720p/1080p, 8/4/2.5 Mbps). Sections start at timestamp 0 with a keyframe — stitch with ffmpeg concat (`-c copy`), do not byte-concatenate.
4. **Export real-time**: `#btn-download-video` (MediaRecorder; has audio; keep tab visible).
5. **Project I/O**: `#btn-save` downloads JSON; `#btn-open` + `#file-open` loads it (runs migration/validation).

## Project JSON schema (version 2)

```jsonc
{
  "version": 2,
  "name": "string",
  "fps": 30,                    // 10–60
  "exportAspect": "16:9",
  "drawings":   [{ "id": "…", "name": "…", "dataURL": "…" }],
  "glbAssets":  [{ "id": "…", "name": "…", "url": "https://…" }],
  "characters": [ /* parametric rigs: head/hair/eyes/torso/arms/legs + pivots */ ],
  "shots": [{
    "id": "shot-1", "name": "Shot 1", "duration": 5,
    "sceneObjects": [{
      "id": "obj-1", "name": "Fire", "type": "fx",
      "color": "#ffffff", "opacity": 1,
      "pos": [0,0,0], "rot": [0,0,0], "scale": [1,1,1],   // rot = degrees
      "fxKind": "fire", "intensity": 1, "fxSize": 1, "fxSpeed": 1, "fxStart": 0
    }],
    "keyframes": { "obj-1": { "pos": [{ "t": 0, "v": [0,0,0], "ease": "linear" }] } }
  }],
  "activeShotId": "shot-1",
  "audioAssets": [], "audioClips": [],
  "studio": {}, "look": {}
}
```

- `type`: `box | sphere | cylinder | cone | torus | plane | engineKit | drawing | character | glb | fx`.
- `drawing`/`character`/`glb` objects reference `assetId`.
- GLB URLs are fetched at load and before export (`ensureGlbAssetsReady`); a broken URL aborts export with a toast.
- Recommended authoring path: build a small project in the UI, save, diff the file — or load your JSON through the real Open flow so migration runs.

## Determinism & FX

- FX particles are seeded deterministically (`fx-core.js`): same timeline position → same particles in preview and export. No Math.random in render paths.
- `explosion` is one-shot (burns out after `fxStart`); others loop. Unit tests: `npm run test:videocraft` (fx determinism, gating, seed stability).

## Phone UI (<=759px)

- Side panels + timeline become fixed slide-in sheets; floating dock `#mobile-dock` (buttons: Tools/Cast/Props/Shots/Animate/Timeline per workspace). Backdrop `#sheet-backdrop`, close on tap or Esc. Desktop/tablet layouts unchanged.

## Honest limits (do not oversell to users)

- Frame-accurate export is **video-only** (no audio). Real-time mode has audio.
- Memory ceiling: whole-movie export beyond ~5 min (720p) risks tab crash; **use section export + ffmpeg concat for anything long**. A 25-minute movie ≈ 45,000 frames ≈ 1.5 GB buffered — one-shot export is not a supported path; sections are.
- Static GLBs only (no rigged/skinned playback). No mocap, GI, or crowd systems.
- >300s movies trigger a `confirm()` warning (not a hard block).
