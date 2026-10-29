# VideoCraft — FLOWS

Working notes for anyone (human or AI) editing the VideoCraft app in `videocraft/`. Not deployed with the app. Docs for users: `videocraft/docs.html`; machine-readable agent guide: `videocraft/GUIDE.md`.

## Main user flows

1. **Workspace navigation** — `.rail-btn[data-ws]` buttons switch `activeWs`; `.ws` sections get `.active` (grid display). Production tabs are extra `.ws` sections styled by `studio.css`.
2. **Draw & save asset** — Draw ws (`#draw-canvas`), tools in `#draw-side`; Save puts a drawing into `project.drawings` (dataURL) → appears as "+ drawing: name" button in `#scene-list`.
3. **Build character** — Cast ws (`#char-side` builder, `#char-props` sliders) → `project.characters` → "+ name" button in `#scene-list`.
4. **Build scene** — Scene ws: `#scene-list` add buttons (primitives, engine parts, FX kinds, text cards, GLB import, drawings, characters); selection → `#scene-props` editor; gizmo via G/R/S/Q.
5. **GLB import** — "+ import GLB model" creates `#glb-file-input` (file → dataURL → `project.glbAssets`); placed via "+ model: name". `ensureGlbAssetsReady()` re-fetches before exports; broken URL aborts export with toast.
6. **Animate** — Anim ws: `#anim-side` (playbar, shot list, shot duration, fps), `#anim-viewport` (Three.js), `#timeline` (keyframe canvas). Keyframes: `project.keyframes[objId][channel]` = `[{t, v, ease}]` per shot. Shots: sequential, `totalDuration() = Σ durations`; `shotAtGlobal(time)` maps movie time → shot + local time.
7. **Play movie** — `#btn-movie` plays all shots back to back; `#btn-play` toggles the shot; Space toggles in anim ws.
8. **Export** — `#btn-record` (frame-accurate WebCodecs VP8 → webm-muxer) or `#btn-download-video` (MediaRecorder real-time, has audio). Section range via `#export-start`/`#export-end` (seconds, blank = full movie); sections are zero-based, keyframe-first, ffmpeg-concat-stitchable. >300s movies prompt `confirm()`.
9. **Save/Open project** — `#btn-save` downloads `serializeProject()` JSON; `#btn-open` + `#file-open` → `loadProjectData` → `migrateProject`.
10. **Starter content** — `#btn-starter` (starter scene), `#btn-race` (3D race movie).

## Phone UI (<=759px)

- Inline script at end of `index.html` (no module): floating `#mobile-dock` (per-workspace panel buttons + Timeline), `#sheet-backdrop`, `.sheet-open` class toggling. Panels + timeline become `position: fixed` sheets via the `@media (max-width: 759px)` block in the inline CSS. Desktop/tablet untouched. No app handlers involved.

## Conventions / gotchas

- **Version-bust every changed module URL** in `index.html` (`app.js?v=X`) — the preview CDN caches stale modules.
- **Preview deploy**: `deploy_website` blocks storage APIs — after re-syncing `preview/` from `repo/videocraft`, re-apply the localStorage→in-memory-Map patch (regex `// -+ persistence:.*?\}\)\(\);` with re.S).
- FX must stay deterministic: seeds via `fxSeedAt`, no `Math.random` in render paths — `fx.test.js` (47 tests) guards this.
- `app.js` is one large module (~3200 lines); `fx.js` (GPU) and `fx-core.js` (pure, tested) split out. Keep pure logic in fx-core.
- Tests: `npm run test:videocraft` from repo root. All 47 must pass.
