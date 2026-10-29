# VideoCraft

A browser video studio for YouTube Shorts and long-form video. Runs entirely client-side — no account, no upload.

## What it does

- **Import anything** — video, images and audio files, arranged on a multi-track timeline (video, audio, captions)
- **Edit for real** — trim, split, drag and reorder clips, scrub, set per-clip volume and fit (contain/cover/stretch)
- **Captions** — timed text overlays with position, size, color and backdrop, burned into the exported video
- **3D scenes** — optional creation mode: build shots with objects, animated characters (idle/walk/run/wave/celebrate), particle FX, camera keyframes, lighting presets
- **Film & anime looks** — cinematic post-processing (bloom, flare streaks, grades, grain, vignette) or toon shading with ink outlines
- **Any format** — 16:9 widescreen, 9:16 Shorts, 1:1, 4:5 and 2.39:1, with Shorts 3:00 duration checking
- **Export** — real-time WebM recording (VP9 + Opus) with audio mixed in and captions burned in
- **Save/Open** — projects as a single JSON file; small images/audio embedded, videos re-link by name on open

## Honest limits

- Export records the movie in real time as it plays once — keep the tab visible until it finishes
- Output is WebM (not MP4) — YouTube accepts it; convert elsewhere if you need MP4
- 3D scenes are stylised real-time rendering — great for shorts and intros, not film-grade CGI

## Tech

Vanilla JS + Three.js (r160). No build step, no server, no dependencies to install — open `index.html` or serve the folder statically.
