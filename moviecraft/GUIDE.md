# MovieCraft — Agent Guide

Machine-readable guide for AI agents driving [MovieCraft](./index.html), a browser-native 3D movie studio (single-page app, no backend, no auth). The docs page for humans is [docs.html](./docs.html). Verify selectors against the current `index.html`/`app.js` before relying on them.

This guide is also embedded in the app page itself (`<script type="application/json" id="ai-guide">` in `index.html`, exposed at runtime as `window.AI_GUIDE`) so an agent never needs the repo. Update both together.

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

1. **Build**: switch to Scene (`data-ws="scene"`), add objects, set `pos/rot/scale/color/opacity` in `#scene-props`. FX objects: kind in `fire | smoke | sparks | explosion | fountain | rain | snow | embers | magic | dust | fireworks | lightning | portal | hearts | stars`, params `intensity`, `fxSize`, `fxSpeed`, `fxStart` (all keyframable).
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
  "scores": [
    {
      "id": "sc1", "name": "Chase theme", "bpm": 128, "bars": 16,
      "root": 57, "scale": "Natural minor",
      "tracks": [
        {
          "id": "trk1", "name": "Bass", "kind": "bass", "osc": "saw",
          "cutoff": 900, "attack": 0.01, "release": 0.2, "volume": 0.8,
          "pan": 0, "mute": false, "solo": false,
          "reverb": 0.1, "delay": 0, "delayBeats": 0.75, "drive": 0,
          "notes": [{ "t": 0, "d": 1, "m": 45, "v": 0.8 }]
        },
        {
          "id": "trk2", "name": "Drums", "kind": "drum",
          "notes": [{ "t": 0, "d": 0.25, "m": 0, "v": 0.9 }]
        }
      ]
    }
  ],
  "studio": {}, "look": {}
}
```

- `type`: `box | sphere | cylinder | cone | torus | plane | engineKit | drawing | character | glb | fx`.
- `drawing`/`character`/`glb` objects reference `assetId`.
- GLB URLs are fetched at load and before export (`ensureGlbAssetsReady`); a broken URL aborts export with a toast.
- Recommended authoring path: build a small project in the UI, save, diff the file — or load your JSON through the real Open flow so migration runs.

## Music & Sound Studio (Music tab)

A full in-browser music and sound creator — no samples, no network, every
instrument is synthesized with WebAudio (`soundstudio.js`).

- Scores are multi-track: synth, bass, pad and pluck melodic voices (saw,
  square, sine or triangle oscillators with cutoff/attack/release controls),
  an 8-voice synthesized drum kit (kick, snare, closed/open hat, clap, tom,
  crash, ride) and vocal tracks recorded from the mic (`getUserMedia`).
- Editing is a piano-roll: drag to draw notes, drag to move, drag the right
  edge to resize, right-click or Delete to remove. Drum tracks use a step
  grid. All times are quarter-note beats, quantized to 0.25.
- Per-track effects: reverb, tempo-synced delay, drive, pan, mute/solo.
- Key and scale aware: pick a root note and scale (natural minor, major,
  dorian, phrygian, lydian, mixolydian, locrian, harmonic minor, blues,
  chromatic); the generators (groove, arpeggio, melody) and the note editor
  snap into the chosen scale.
- Playback loops live with a moving playhead. "Add to movie" renders the
  score offline to a WAV and places it as an audio clip at 0:00 on the movie
  timeline; "Download WAV" exports the file. Scores save with the project
  (`project.scores`).

## Determinism & FX

- FX particles are seeded deterministically (`fx-core.js`): same timeline position → same particles in preview and export. No Math.random in render paths.
- `explosion` is one-shot (burns out after `fxStart`); others loop. Unit tests: `npm run test:videocraft` (fx determinism, gating, seed stability).

## Phone UI (<=759px)

- Side panels + timeline become fixed slide-in sheets; floating dock `#mobile-dock` (buttons: Tools/Cast/Props/Shots/Animate/Timeline per workspace). Backdrop `#sheet-backdrop`, close on tap or Esc. Desktop/tablet layouts unchanged.

## Field notes from a full-length agent render (v0.6.7)

Lessons from an agent-built 10-shot, 242 s, 720p/24fps film ("The Spark") — all verified against the running app:

- **Persistence key is `videocraft_project_v2`** (yes, VideoCraft's name — shared key family from before the apps split). It holds the raw JSON of `serializeProject()` output. Inject a project headlessly by writing this key **before** the page loads (an `addInitScript` that runs before app.js), or via the real `#btn-open` flow.
- **Camera animation is not on scene objects.** Camera keyframes live in `shot.keyframes.__camera__` with channels `cam.px / cam.py / cam.pz / cam.tx / cam.ty / cam.tz / cam.fov`, each an array of `{ t, v, ease }` where `ease` is `ease | linear | step | easein | easeout | back | bounce`. `t` is **shot-local** seconds. `shot.camera` also accepts a static `base` + a `cam` map of channel → keyframe list.
- **Character keyframes target bone ids, not the character id.** A character object's `id` is what `assetId` references; to animate limbs, keyframe the joint names (`hips`, `chest`, `head`, `armL`, `armR`, `legL`, `legR`…) as keyframe subjects with channel `rot` (degrees). Built-in motion clips (`idle`, `walk`, `run`, `wave`, `celebrate`, `jump`, `dance`, `point`, `nod`, `shakehead`, `punch`, `bow`, `sit`) are set via the object's `clip` + `speed` props and are much cheaper than hand-keying.
- **Custom motion clips (v0.11.0) — any motion, authored, not preset.** `project.customClips[name] = { duration, loop, keys: [{ t, ease, pose: {jointId: [x,y,z] deg} }] }`; apply with `motion.clip = 'custom:<name>'` (saved with the project). Authoring flow: scrub the timeline, pose the character with the joint editor, click **Capture pose at playhead** — every capture becomes a pose key and the clip interpolates between poses (all easings supported, scrub-safe and export-safe like everything else). Works on avatars and forge characters alike (joints must match). Also settable directly in JSON.
- **`scale` must be `[x,y,z]`** — a single number or `[s]` is silently ignored (object renders at default size).
- **`color` doubles as the emissive glow color**: set `emissive` (number, 0–~2) for glow strength. High-emissive colors bloom nicely against `night`/`sunset` lighting.
- **`shot.lighting`**: `studio | daylight | sunset | night | neon | candlelight | moonlight | horror | golden | sunrise | storm | forest`.
- **Events** (`shot.events`): `title` (`text`, `start`, `dur`, optional `color`), `subtitle` (same + optional `speaker`), `lowerthird` (bottom-left name bar, same fields as subtitle), `fadein`/`fadeout` (`start`, `dur`), `letterbox`, `shake`. `start`/`dur` are shot-local seconds.
- **Letterbox + subtitles (fixed in v0.6.7)**: the letterbox bars used to overlap the subtitle plane and clip descenders; subtitles are now lifted above the bottom bar whenever letterbox is active. Projects that avoided letterbox for this reason can re-enable it.
- **Long films**: render in ≤60 s sections (`#export-start`/`#export-end`), stitch with `ffmpeg -f concat -safe 0 -c copy`. On a 2-core headless Chrome (SwiftShader WebGL2), expect roughly 0.65–0.7× real time per section (a 52 s section ≈ 11–12 min, ~50 MB). WebCodecs in headless Chrome supports **VP8 + Opus only** — no H.264/AAC encode; plan the VideoCraft/MovieCraft export path accordingly.
- **Headless Chrome recipe that works**: `chrome-headless-shell` with `--no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --autoplay-policy=no-user-gesture-required`. Verify WebGL2 via `canvas.getContext('webgl2')` before trusting the render.
- **Validate every shot with a 3-second snippet render** before committing to the full render: catches schema typos (bad `type`, wrong `fxKind`, missing `id`) at 1/10th the cost.

## Honest limits (do not oversell to users)

- Frame-accurate export is **video-only** (no audio). Real-time mode has audio.
- Memory ceiling: whole-movie export beyond ~5 min (720p) risks tab crash; **use section export + ffmpeg concat for anything long**. A 25-minute movie ≈ 45,000 frames ≈ 1.5 GB buffered — one-shot export is not a supported path; sections are.
- Static GLBs only (no rigged/skinned playback). No mocap, GI, or crowd systems.
- >300s movies trigger a `confirm()` warning (not a hard block).
