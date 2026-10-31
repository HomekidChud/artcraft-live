# VideoCraft — Agent Guide

Machine-readable guide for AI agents driving [VideoCraft](./index.html), a browser-native video editor (single-page app, no backend, no auth). Human docs: [README.md](./README.md). Working notes for contributors: `FLOWS.md` in the repo root. Verify selectors against the current `index.html`/`app.js` before relying on them.

This guide is also embedded in the app page itself (`<script type="application/json" id="ai-guide">` in `index.html`, exposed at runtime as `window.AI_GUIDE`) so an agent never needs the repo. Update both together.

## Environment

- Pure client-side app: `index.html` + ES modules. Three.js from CDN via import map.
- No API, no login. Automate through a browser driver (Playwright/Puppeteer/CDP).
- Headless Chrome recipe that works: `chrome-headless-shell` with `--no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --autoplay-policy=no-user-gesture-required`. WebCodecs in headless Chrome encodes **VP8/VP9 + Opus only** (no H.264/AAC), so the MP4 export path falls back to real-time WebM recording there.
- Native `alert()` on empty-timeline exports — dismiss dialogs (Playwright: `page.on('dialog', d => d.dismiss())`).

## Preferred path: the headless API (`?headless=1`)

Open the app with `?headless=1` to expose `window.vc`:

```js
await window.vc.loadProject(projectJson)   // replaces clips/scenes/captions/media; returns {name, aspect, duration, clips, scenes, captions}
await window.vc.render({ postUrl, quality, start, end })  // 'high' | 'standard' | 'draft'; optional start/end render only that range (parallel chunk renders)
```

- `loadProject` **replaces** `state.clips` (the default hero scene clip disappears) — this is the clean path for agents. Scenes missing `objects`/`camKeys`/`events`/`look` are auto-normalized on load.
- `render` runs the WebCodecs MP4 export and **POSTs the result blob to `postUrl`**; progress lands in `window.__vcProgress` (`{stage, frame, frames}`), result in `window.__vcResult` (`{name, size, type}`). It **resolves only when the export has fully finished** — including the real-time WebM fallback (which previously resolved as soon as playback started and never set `__vcResult`; fixed in v1.1.2). The MP4 path also runs an encoder pre-flight and a stall watchdog — if the browser reports H.264 support but the encoder stalls (common in headless/software-GL builds), the export falls back to WebM instead of hanging forever (fixed in v1.1.3). v1.1.4 adds `render({ start, end })` range renders — chunk the timeline across parallel pages and stitch with ffmpeg concat for ~1/N render time (see README "Parallel rendering").
- Your receiver must answer CORS preflights (`OPTIONS` → 204 with `Access-Control-Allow-Origin: *`); the blob POST sends `Content-Type: video/webm`/`video/mp4`, which triggers preflight.

## Fallback path: driving the UI

| Action | How |
|---|---|
| Import files | `page.setInputFiles('#file-import', [...])` (video/image/audio, multiple) |
| Media list | items are `#insp-body .list-item` — **`#insp-body` is an id, the aside is `#inspector` (id, not class)**; `.inspector .list-item` matches nothing |
| Add to timeline | click each list item in the Media tab (`.rail-btn[data-tab="media"]`) |
| Timeline check | `#track-v .clip` / `#track-a .clip`; `style.left` in px at 80 px/s (`pxPerSec`) |
| Export tab | `.rail-btn[data-tab="export"]` |
| Export MP4 (WebCodecs, faster) | `#btn-export` |
| Export WebM (real-time, has audio) | `#btn-export-webm` |
| Quality | `#ex-quality` (`0.2` high / `0.12` standard / `0.07` draft) |
| Agent POST target | `window.__vcPostUrl = <url>` (both export paths POST the blob there since v1.1.1; WebM previously only downloaded) |
| Progress | `window.__vcProgress`, overlay `#export-overlay` (timer text `#export-time`) |

### Gotchas (all learned the hard way)

- **A fresh page is NOT an empty project**: init adds a 6 s hero **scene clip** on the video track (`addSceneClip('hero')`) plus a demo caption. In the UI flow, delete it first (click `#track-v .clip.scene`, press `Delete`) — otherwise imported video **appends at t=6 s** and desyncs from audio placed at t=0.
- **Media clips append to the end of their track** (`addMediaToTimeline`): video → `'v'` track, audio → `'a'` track. Both tracks start empty, so a clean import puts video at 0 and audio at 0.
- Import is async (metadata probing + audio decode, up to ~10 s for large files): **poll for the list items**, don't assume they exist after a fixed sleep.
- The media list re-renders on selection: click items by re-querying (`page.evaluate` with `querySelectorAll`), not by holding stale element handles.
- Timeline length in the export tab is `totalDur()` — with the hero clip present it reads 6 s on an "empty" timeline. That's the tell you forgot step one.
- Real-time WebM recording records the preview canvas at the export resolution (16:9 → 1920×1080) at the frame rate chosen in the Output tab (24/25/30/50/60 fps; default 30). Expect ~1× wall-clock duration.
- Exports POST a blob with a non-simple content type → **CORS preflight**; a receiver that only answers `POST` will silently swallow the export (the fetch failure is caught and ignored).

## Project JSON

- `app: "videocraft"` required by `applyProjectData`.
- **The complete schema (clips, scenes, objects, characters + pose params, look fields, grades, FX kinds, captions, media, headless API) is documented in the [Project file format section of README.md](./README.md#project-file-format-vfprojectjson--complete-schema) and embedded in the page itself as `window.AI_GUIDE.projectSchema` — author projects from those, no source-code reading required.**
- Quick orientation: aspect `16:9|9:16|1:1|4:5|2.39:1`, fps `24|25|30|50|60`; scene `fog` is **0-1** (not 0-100; density = fog×0.045); dim lighting presets (`night`, `storm`, `candlelight`, `horror`, `dramatic`) need `look.exposure` ≈ 1.5-2.3 and bright ground colors or scenes render nearly black.
- **Characters are fully authorable**: scene objects of `type: 'character'` accept `build: { height, head, arms, legs, torso }` (proportion factors, default 1) plus `skin/hair/shirt/pants` colors — and `poseKeys: [{ t, pose }]` for free-form motion. Pose params (degrees): `shLx/shLz/elL`, `shRx/shRz/elR` (arms), `hipL/kneeL/hipR/kneeR` (legs), `headX/headY`, `torsoX/torsoY`. When `poseKeys` is non-empty it **replaces** the preset `motion` entirely; the rig interpolates between captured poses (scene-local seconds, smoothstep). Capture interactively with the inspector pose sliders + "Capture pose" button.
- `media` entries can embed files as `data` (data URL) — restored via `importFiles`, ids re-mapped so existing clips re-link.
- Persistence: **no autosave key of its own** — projects are files (`#btn-save` downloads JSON; `#btn-open` loads). MovieCraft's autosave key is `videocraft_project_v2` (shared key family); don't confuse the two apps' storage.

## End-to-end recipe that produced a clean 242 s film

1. Render the 3D movie in MovieCraft (sectioned VP8 WebM, ffmpeg concat).
2. Serve the repo locally; open `videocraft/?headless=1`.
3. Import the movie WebM + the audio mix via `#file-import`; delete the hero clip; click both media items (video at 0, audio at 0).
4. Set `window.__vcPostUrl` to a local receiver; start `#btn-export-webm`; poll `#export-time` until it stops advancing, then wait for the POSTed blob.
5. Verify sync by frame-matching 1 fps thumbnails of master vs source, and cross-correlating audio (a >0.2 s offset means the hero clip was still there).
6. Transcode: `ffmpeg -i master.webm -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart out.mp4`.

## Honest limits (do not oversell to users)

- Export resolution is fixed per aspect (16:9 → 1080p); frame rate is selectable in the Output tab (24/25/30/50/60 fps) and is saved with the project.
- Real-time WebM capture is 1× wall-clock and can drop frames on slow machines; the WebCodecs MP4 path is faster but needs H.264/AAC encode support.
- No keyframe audio mixing: audio clips play through WebAudio; a suspended AudioContext (autoplay policy) yields silent exports — pass `--autoplay-policy=no-user-gesture-required` headless.
