# VideoCraft

A browser video studio for YouTube Shorts and long-form video. Runs entirely client-side — no account, no upload.

## What it does

- **Import anything** — video, images and audio files, arranged on a multi-track timeline (video, audio, captions)
- **Edit for real** — trim, split, drag and reorder clips, scrub, set per-clip volume and fit (contain/cover/stretch)
- **Captions** — timed text overlays with position, size, color and backdrop, burned into the exported video
- **3D scenes** — optional creation mode: build shots with objects, animated characters (14 motion clips incl. jump, dance, punch, bow, sit), particle FX (fire, rain, snow, embers, magic, smoke, lightning, portal, hearts, stars), camera keyframes with per-key easing (smooth, linear, ease in/out, overshoot, bounce, step), 11 lighting presets (three-point, sunset, night, dramatic, daylight, neon, candlelight, horror, sunrise, storm, forest)
- **Character creator & free-form motion** — every character is buildable live: height, head, arm, leg and torso proportions plus colors; and any motion can be authored with pose keys — set arm/leg/head/torso rotations at different times, capture, and the character interpolates between them (overrides presets entirely)
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

## Project file format (`.vfproject.json`) — complete schema

Everything an agent needs to author a project from scratch — no source-code reading required. The same schema is embedded in the page itself (the `ai-guide` JSON, exposed as `window.AI_GUIDE`).

### Top level

```jsonc
{
  "app": "videocraft",            // required — anything else is rejected on open
  "version": 1,
  "name": "My video",
  "aspect": "16:9",               // 16:9 | 9:16 | 1:1 | 4:5 | 2.39:1
  "fps": 30,                      // 24 | 25 | 30 | 50 | 60
  "clips":  [ /* see Clips */ ],
  "scenes": [ /* see Scenes */ ],
  "captions": [ /* see Captions */ ],
  "media":  [ /* see Media */ ]
}
```

### Clips

Timeline entries. Video-track clips must not overlap in time; a scene clip's `dur` should equal its scene's `duration`.

```jsonc
{ "id": "c1",
  "track": "v",                  // "v" video track | "a" audio track
  "kind": "scene",               // "scene" | "media"
  "mediaId"?: "m1",              // required when kind = "media"
  "sceneId"?: "sc1",             // required when kind = "scene"
  "start": 0,                    // timeline position, seconds
  "dur": 6,                      // duration, seconds
  "in": 0,                       // media offset into the source, seconds
  "volume": 1,                   // 0-1
  "fit": "contain" }             // contain | cover | stretch (v-track media only)
```

### Scenes

One scene per scene clip. `duration` is in seconds (1-120); camera and object times are **scene-local seconds**.

```jsonc
{ "id": "sc1", "name": "3D Scene", "duration": 6,
  "sky": "#0d1522",              // background / fog color
  "fog": 0,                      // 0-1 (NOT 0-100). FogExp2 density = fog * 0.045.
                                 // 0.15 subtle, 0.5 heavy; above ~0.3 distant objects vanish
  "lighting": "three-point",     // three-point | sunset | night | dramatic | daylight |
                                 // neon | candlelight | horror | sunrise | storm | forest
  "camera": { "pos": [7, 4, 11], "target": [0, 1.4, 0] },   // static camera (no keys)
  "camKeys": [                   // optional camera moves, time-sorted
    { "t": 3, "pos": [4, 2, 6], "target": [0, 1.4, 0],
      "ease": "smooth" }          // smooth | linear | easein | easeout | back | bounce | step
  ],
  "look": {                       // post-processing; all fields optional (defaults shown)
    "style": "film",             // film | anime | clean
    "grade": "cine",             // see grades below
    "bloom": 0.55,               // 0-2
    "vignette": 0.4,             // 0-1
    "grain": 0.05,               // 0-0.3
    "chroma": 0.5,               // 0-2 (chromatic aberration)
    "streak": 0.25,              // 0-1.5 (flare streaks)
    "exposure": 1.0,             // 0.3-2 — dim presets (night/storm/candlelight/horror)
                                 //   need ~1.5-2.3 or the scene renders nearly black
    "outline": 0,                // 0-2 (anime ink outline)
    "toonSteps": 4 },            // 2-8 (anime toon shading)
  "objects": [ /* see Objects */ ],
  "events": [                    // scene-local overlay events
    { "type": "fadein",  "t": 0,   "dur": 0.6 },   // black overlay ramps
    { "type": "fadeout", "t": 5.4, "dur": 0.6 },
    { "type": "letterbox", "t": 0, "dur": 0 } ] }  // cinema bars from t on
```

**Grades:** natural, cine, noir, vibrant, scifi, sunset, comic, pastel, night, teal-orange, bleach, sepia, dream, moonlight, cyberpunk, forest, crimson, arctic.

### Objects

Every object: `{ "id", "type", "name", "pos": [x,y,z], "rot": [rx,ry,rz] (radians), "scale": [sx,sy,sz], "color": "#rrggbb", "opacity": 1, "keys": [...] }`. Keys animate the transform — `{ "t" (scene-local s), "pos"?, "rot"?, "scale"?, "ease"? }`, time-sorted and eased between keys; before the first key the first key's value holds, after the last key the last value holds.

| `type` | Extra fields | Notes |
|---|---|---|
| `ground` | — | scale `[width, 1, depth]`, locked to the floor (y fixed) |
| `box` | — | 1×1×1 base, scaled by `scale` |
| `sphere` | — | radius 0.5, emissive (glows) |
| `cylinder` | — | radius 0.5, height 1 — `scale[1]` is the height |
| `text` | `text`, `size` | billboard title plane; `color` is the fill |
| `character` | see below | rigged figure with motion/poses |
| `fx` | `fx`, `size` | particle emitter; kinds: fire, explosion, confetti, sparks, fountain, rain, snow, embers, magic, smoke, lightning, portal, hearts, stars |

### Characters

```jsonc
{ "id": "o1", "type": "character", "name": "Hero",
  "pos": [0, 0, 0], "rot": [0, 0, 0], "scale": [1, 1, 1],
  "motion": "walk",              // none | idle | walk | run | wave | celebrate | jump |
                                 // dance | point | nod | shakehead | punch | bow | sit
  "skin": "#e8b88a", "hair": "#2a2018",
  "shirt": "#c9553d", "pants": "#31465e",
  "build": { "height": 1, "head": 1, "arms": 1, "legs": 1, "torso": 1 },  // proportion factors
  "poseKeys": [                  // OPTIONAL — non-empty poseKeys override motion entirely
    { "t": 2.5, "pose": { "shLz": 65, "shRz": -65 } } ] }
```

**Pose parameters** (degrees; interpolated with smoothstep between keys in scene-local seconds):

| Group | Params | Defaults |
|---|---|---|
| Left arm | `shLx`, `shLz`, `elL` | 8, 0, -15 |
| Right arm | `shRx`, `shRz`, `elR` | 8, 0, -15 |
| Legs | `hipL`, `kneeL`, `hipR`, `kneeR` | 0, 4, 0, 4 |
| Head / torso | `headX`, `headY`, `torsoX`, `torsoY` | 0 |

`shLz` / `shRz` raise the arms sideways — try ~65 / -65 for a raised-arms pose.

### Captions

Burned into the export: `{ "id", "start", "dur", "text" (multiline with \n), "pos": "bottom|middle|top", "size" (1 = 4.2% of frame height), "color": "#rrggbb", "bg": true|false }`

### Media

`{ "id", "type": "video|image|audio", "name", "duration", "data"?: "<data URL>" }` — entries with `data` are restored on load (audio must be decodable: mp3/wav/ogg); entries without `data` re-link by file name when re-imported. Images and audio under 8 MB are embedded when saving.

### Headless automation API

Open the page with `?headless=1` to expose `window.vc`:

- `await window.vc.loadProject(projectJson)` — replaces clips/scenes/captions/media; returns `{ name, aspect, duration, clips, scenes, captions }`. Scenes missing `objects`/`camKeys`/`events`/`look` are auto-normalized.
- `await window.vc.render({ postUrl, quality, start, end })` — encodes and POSTs the result blob to `postUrl`; **resolves only when the export has fully finished** (both MP4 and WebM paths). Progress in `window.__vcProgress` (`{ stage, frame, frames }`), result in `window.__vcResult` (`{ name, size, type }`). `quality`: `high | standard | draft`. Optional `start`/`end` (timeline seconds) render only that range — see **Parallel rendering** below.
- The POST receiver must answer CORS preflight (`OPTIONS` → `204` + `Access-Control-Allow-Origin: *`); a POST-only receiver silently swallows the export.
- Headless Chrome flags: `--no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --autoplay-policy=no-user-gesture-required`. Headless WebCodecs has no H.264, so exports fall back to real-time WebM (audio included); transcode to MP4 with `ffmpeg -i out.webm -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart out.mp4`.

Gotchas learned the hard way: keep `fog` ≤ 0.3 for scenes with the camera far away (FogExp2 swallows distant objects); the `dramatic`/`night`/`storm`/`candlelight`/`horror` presets are dim — raise `look.exposure` to ~1.5-2.3 and use bright ground colors; cap `bloom` around 0.5 and keep `streak` low or titles smear.

### Parallel rendering (fast renders)

`vc.render({ start, end })` renders only that timeline range, with **chunk-local timestamps and correctly sliced audio** — so several headless pages can render chunks of the same project simultaneously, and the chunk files stitched in order are frame-accurate:

1. Split the duration into N chunks (e.g. 10s each).
2. Open N pages with `?headless=1` (one browser, N tabs — or N browsers), `loadProject(project)` in each.
3. Call `render({ postUrl, quality, start, end })` per chunk — give each chunk its own receiver path (`?name=chunk_i.webm`) or port.
4. Stitch: `ffmpeg -f concat -i list.txt -c copy merged.webm`, then transcode to MP4 as usual (or concat the MP4 chunks directly — each starts with a keyframe).

Or just use the bundled driver, which does all of the above (parallel pages, per-chunk exact trim, stitch, transcode) in one command:

```bash
python3 -m http.server 8000          # from the repo root, serves videocraft/
node tools/render-parallel.mjs path/to/project.json 10 3 myfilm
```

Speed depends on the path and the machine:

- **WebM (real-time) path**: each chunk records for its own duration, so N chunks in parallel finish in ~1/N the wall time — a 60s film renders in ~10s with 6 chunks. Works even without a GPU.
- **MP4 (WebCodecs) path**: each chunk encodes only its frames — near-linear speedup with cores/GPUs; on GPU machines this is the fastest and highest-quality option.
- Rule of thumb: chunks of 5-15s, one concurrent page per CPU core (software GL) or per GPU (hardware). More pages than that just starve each chunk's draw loop.

## Honest limits

- MP4 export needs WebCodecs (Chrome/Edge 94+); other browsers get the real-time WebM recording
- 3D scenes are stylised real-time rendering — great for shorts and intros, not film-grade CGI
- CLI rendering without a GPU uses SwiftShader — correct but slow (roughly real-time or worse); with a GPU it's much faster

## Tech

Vanilla JS + Three.js (r160). No build step, no server, no dependencies to install — open `index.html` or serve the folder statically. The only vendored library is [mp4-muxer](vendor/mp4-muxer.mjs) (MIT) for MP4 muxing.
