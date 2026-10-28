# Film-production upgrade verification

Historical v0.6 baseline. See `QA-CINEMATIC.md` for the v0.7 cinematic pass,
which adds offline audio and supersedes the video-only limitation below.

Local verification: 28 October 2026, headless Chromium at 1440 × 1000 and
375 × 812. This is a tested browser-editor upgrade, not a claim of
Hollywood-quality output or a certified feature-length rendering pipeline.

## Automated checks

- VideoCraft: 41 passing tests, including 20 new film-production tests.
- Assistant regression suite: 77 passing tests.
- Syntax checks: every top-level VideoCraft JavaScript module.
- ESLint `no-undef`: passing with browser globals and `structuredClone` declared.
- Whitespace: `git diff --check`.
- A broader, optional AirplaneCraft waypoint-wire run found one unrelated
  failure: `wire count tracks wing, surface, support and engine tuning`.
  Its test and tested AirplaneCraft files are unchanged by this upgrade.

The GitHub workflow runs syntax, VideoCraft tests and the assistant suite.
Browser checks below were performed manually through Playwright user controls;
they are not represented as automated CI coverage.

## Functional checks

| Area | Observed result |
| --- | --- |
| Imported GLB | An original self-contained two-bone, two-clip fixture imported through Assets. Two scene instances played different clips independently. |
| Deterministic seeking | At 1 second the animated joint positions were `[0,1,0]` and `[0.75,0,0]`. Reverse seeking to 0.5 seconds reproduced the earlier poses. Rechecked independent playback after normalization was moved outside animated nodes. |
| Transform animation | Rotation-X and scale-X keys interpolated to the expected values; motion copy/paste produced independent tracks. Next-frame and previous-frame controls returned from `0.500` to `0.533` and back at 30 fps. |
| Project roundtrip | Save/Open restored the embedded imported source, instance motion, transform tracks and a timed, centered caption. |
| Sets | Forest, city street and studio apartment added without deleting existing objects. City starting camera was corrected to face down an unobstructed street. |
| Object editing | Visibility off/on changed the rendered group. Viewport lock toggled both ways. Framing worked. Copy-to-Design produced 19 independent apartment parts without changing the scene instance. |
| Finishing | Timed caption and fade persisted. A 30-frame, 1-second offline export showed a black opening frame, then the scene and title after the fade. |
| Subtitles | A 3.5–6.0 second SRT cue crossed a 5-second shot cut. Import split it into shot-local cues; export produced adjacent, correctly timed 3.5–5.0 and 5.0–6.0 cues. |
| Long timeline | A 240-shot, 3,600-second fixture mounted 12 storyboard cards per page. Pagination, filtering and seeking to the last shot worked. |
| Final-second export | Movie interval 3,599–3,600 seconds produced 10 VP8 frames at 10 fps and 1280 × 720. FFprobe confirmed a 1.000000-second container duration after the muxer fix. |
| Disk streaming | A real OPFS file handle exercised the browser writable-stream API and positional writes. FFprobe confirmed the resulting file. This did not test the operating system's native picker UI. |
| Disk failures | Injected write failure aborted the writable, surfaced an error and restored export controls. Picker cancellation cancelled rather than silently switching to memory. |
| Memory guard | Both export modes rejected a one-hour in-memory export and restored controls. The limit is five-minute sections. |
| Stop export | Stopping an offline section produced a decodable partial WebM: 10 frames, 1.000000 second, with controls restored. |
| Audio clips | Two clips shared one source asset but had independent playback elements, start times, trims and stereo pan. Both played concurrently. Fade controls persisted. |
| Real-time output | Short VP9/Opus output contained multiple video frames and non-silent stereo audio. Explicit frame submission fixed detached-canvas capture. |
| Imported shot cut | A real-time export crossed between two imported-model shots. All three scene groups had ready children at the cut. Export returned to the previously selected second shot. |
| Invalid import | A malformed GLB was rejected through the file input without adding an asset. |
| Responsive layout | Design and Delivery had a 375-pixel document width at a 375-pixel viewport. Desktop → mobile → desktop retained functional navigation and controls. |

Browser page-error collection remained empty during these functional checks.
Expected injected disk failures and memory-limit errors were tested separately
from unexpected page errors.

## Visual evidence reviewed

- Desktop forest, city street and studio apartment.
- Imported-animation scene, centered title and movie-aspect letterboxing.
- Extracted offline frames before and after a fade.
- Populated Design and Delivery at 375 × 812.

The local evidence captures are development artifacts, not bundled movie assets.
The built-in race template remains available as a user-facing starting point.

## Limits and outstanding validation

- No full one-hour movie was rendered. The hour-long fixture verifies timeline
  handling and a short export interval only.
- Frame-accurate export is video-only. Real-time recording includes sound but
  can drop frames on a slow device or heavy scene.
- Headless Chromium's native real-time WebM output emitted an FFmpeg Opus packet
  header warning; subsequent audio decoded and was non-silent. Playback and
  seeking across target browsers and native players still need validation.
- Native real-time WebM output does not necessarily include a container
  duration. Offline output has regression-tested duration metadata.
- Direct-to-disk native picker UX, very large output files, multi-hour runs,
  sustained memory profiling and GPU-device compatibility are not certified.
- Imports are self-contained, uncompressed glTF 2.0 GLBs up to 25 MB each.
  External resources, Draco, Meshopt and KTX2 are unsupported.
- Imported animation playback is not retargeting. There is no IK solver,
  face/lip animation system, photorealistic renderer or offline audio mixer.
- Fades are to/from black, not overlapping-shot cross-dissolves.
- The hosted review preview is session-only. Save a project file to retain work.
  GitHub Pages keeps its guarded local autosave, which can hit browser quotas.
