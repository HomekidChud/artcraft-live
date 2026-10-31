# VideoCraft

A browser video studio for YouTube Shorts and long-form video. Runs entirely client-side — no account, no upload.

## What it does

- **Import anything** — video, images and audio files, arranged on a multi-track timeline (video, audio, captions)
- **Edit for real** — trim, split, drag and reorder clips, scrub, set per-clip volume and fit (contain/cover/stretch)
- **Captions** — timed text overlays with position, size, color and backdrop, burned into the exported video
- **3D scenes** — optional creation mode: build shots with objects, animated characters (14 motion clips incl. jump, dance, punch, bow, sit), particle FX (fire, rain, snow, embers, magic, smoke, lightning, portal, hearts, stars), camera keyframes with per-key easing (smooth, linear, ease in/out, overshoot, bounce, step), 11 lighting presets (three-point, sunset, night, dramatic, daylight, neon, candlelight, horror, sunrise, storm, forest)
- **Frame rate control** — export at 24/25/30/50/60 fps from the Output tab (24 for cinematic feel, 60 for smooth motion)
- **Film & anime looks** — cinematic post-processing (bloom, flare streaks, 18 colour grades incl. teal-orange, bleach bypass, sepia, moonlight, cyberpunk, forest, crimson and arctic, grain, vignette) or toon shading with ink outlines
- **Any format** — 16:9 widescreen, 9:16 Shorts, 1:1, 4:5 and 2.39:1, with Shorts 3:00 duration checking
- **Export MP4** — frame-by-frame H.264 encode via WebCodecs: faster than real time, works in a background tab, audio mixed in, captions burned in (real-time WebM recording remains as a fallback for browsers without WebCodecs)
- **CLI** — render any project to MP4 from the terminal with `tools/vc.mjs`, no browser tab needed
- **Save/Open** — projects as a single JSON file; small images/audio embedded, videos re-link by name on open

## Export

The default **Export MP4** path encodes frame by frame with WebCodecs (H.264 video; AAC audio where the platform can encode it, otherwise Opus) and muxes a real `.mp4` in the browser ([mp4-muxer](vendor/mp4-muxer.mjs), MIT). Quality presets map to bits-per-pixel: High ≈ 12.4 Mbps at 1080p30, Standard ≈ 7.5 Mbps, Draft ≈ 4.3 Mbps. Keyframes land every 2 seconds, audio is 192 kbps stereo.

Notes:

- Browsers that cannot encode H.264 fall back to the old real-time WebM recording automatically.
- Linux Chrome ships no AAC encoder, so audio is encoded as Opus there (plays in Chrome, Firefox, VLC and current players; QuickTime may not). Windows/macOS Chrome produce AAC.
- Everything is held in memory during muxing (`fastStart: in-memory`) — for hour-long exports prefer shorter segments.
- The real-time WebM path is still available via **Record WebM in real time** in the Export tab.

## CLI (`tools/vc.mjs`)

Zero-dependency Node (18+) script that renders a project with a real headless Chrome — same engine, same output as the browser. WebGL runs through SwiftShader, so no GPU is required (it's just slower — a GPU machine renders much faster).

```bash
# scaffold a starter project
node tools/vc.mjs new --name "My video" --aspect 9:16 > my.vfproject.json

# print a timeline summary
node tools/vc.mjs info my.vfproject.json

# render to MP4 (writes my.mp4 next to the project file)
node tools/vc.mjs render my.vfproject.json

# options
node tools/vc.mjs render my.vfproject.json \
  --out final.mp4 \            # output path
  --quality high \             # high | standard | draft
  --chrome /usr/bin/chromium   # or $VC_CHROME / $CHROME_PATH
```

How it works: the CLI serves `videocraft/` locally, launches Chrome `--headless=new`, opens it with `?headless=1` (which exposes a small `window.vc` automation API: `loadProject()`, `render()`), loads the project, runs the same WebCodecs export, and the finished MP4 is streamed back over a local HTTP POST. Progress is printed per stage.

## Project file format (`.vfproject.json`)

```jsonc
{
  "app": "videocraft", "version": 1,
  "name": "My video", "aspect": "16:9", "fps": 30,
  "clips": [ /* timeline entries, see below */ ],
  "scenes": [ /* 3D scenes, see below */ ],
  "captions": [ /* burned-in text */ ],
  "media": [ /* imported files; images/audio < 8 MB embedded as data URLs */ ]
}
```

**Clips** (video and audio tracks; the v-track clips must not overlap in time):

```jsonc
{ "id": "c1", "track": "v" | "a", "kind": "scene" | "media",
  "mediaId"?: "m1", "sceneId"?: "sc1",   // one of these, matching the kind
  "start": 0, "dur": 6, "in": 0, "volume": 1, "fit": "contain" } // fit: v-track media only
```

**Scenes** (one scene per scene-clip; `duration` must match the clip's `dur`):

```jsonc
{ "id": "sc1", "name": "3D Scene", "duration": 6,
  "sky": "#0d1522", "fog": 0, "lighting": "three-point",  // lighting: three-point | studio | daylight | sunset | night | dramatic
  "camera": { "pos": [7, 4, 11], "target": [0, 1.4, 0] },
  "camKeys": [ { "t": 3, "pos": [...], "target": [...] } ],  // optional camera moves
  "look": { "style": "film", "grade": "cine", "bloom": 0.55, "vignette": 0.4,
            "grain": 0.05, "chroma": 0.5, "streak": 0.25, "exposure": 1.0 },
  "objects": [ /* boxes, spheres, cylinders, text, characters, fx — see app */ ],
  "events": [ { "type": "fadein" | "fadeout", "t": 0, "dur": 0.6 },
              { "type": "letterbox", "t": 0, "dur": 0 } ] }
```

**Captions:** `{ "id", "start", "dur", "text", "pos": "bottom|middle|top", "size", "color", "bg" }`

**Media:** `{ "id", "type": "video|image|audio", "name", "duration", "data"?: "<data URL>" }` — entries without `data` re-link by file name when re-imported.

Gotchas learned the hard way: keep `fog` at 0 for scenes with the camera far away (FogExp2 fully swallows distant scenes); the `dramatic`/`night` presets are dim — prefer `three-point` and raise `look.exposure`; cap `bloom` around 0.5 and keep `streak` low or titles smear.

## Honest limits

- MP4 export needs WebCodecs (Chrome/Edge 94+); other browsers get the real-time WebM recording
- 3D scenes are stylised real-time rendering — great for shorts and intros, not film-grade CGI
- CLI rendering without a GPU uses SwiftShader — correct but slow (roughly real-time or worse); with a GPU it's much faster

## Tech

Vanilla JS + Three.js (r160). No build step, no server, no dependencies to install — open `index.html` or serve the folder statically. The only vendored library is [mp4-muxer](vendor/mp4-muxer.mjs) (MIT) for MP4 muxing.
