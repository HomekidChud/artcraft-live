# Cinematic upgrade verification

Tested in Chromium on 28 October 2026. This record supersedes the baseline's
video-only offline-export limitation in `QA-FILM-PRODUCTION.md`.

## Automated and browser checks

- **Automated:** 57 VideoCraft tests and 77 assistant tests pass. New checks
  cover grade/performance migration, deterministic blinking and speech,
  amplitude envelopes, camera framing, trim/fade/pan/peak limiting, repeated
  sources, section PCM equivalence, missing/corrupt/oversized sources,
  decode deduplication and the independent four-shot demo.
- **Acting controls:** Real UI interactions exercised expression, blink, gaze
  and manual mouth controls in Scene/Animate, timed speech, imported-dialogue
  selection, audio analysis and actor close-up composition.
  Seeking from local 1 second to 2 seconds and back produced byte-identical
  canvas screenshots, including face, camera and deterministic grain.
- **Imported morph restoration:** An original GLB fixture with an authored
  morph clip evaluated at 0.60000002, overlaid to 0.9, restored to 0.60000002
  when disabled, then scrubbed to 0.40000001. These lower-level renderer
  checks verify that overrides do not become stuck on authored morphs.
- **Original workspaces:** Planning title/script, designed trophy, drawing,
  rigged actor, storyboard notes, caption, angry expression, timed speech and
  a 371-sample audio envelope were saved and reopened. Design placement,
  Draw/Undo/save, Cast saving, Assets placement, Scene, Storyboard, Animate,
  Sound import and Delivery were exercised with real controls.
- **Layout:** Desktop, 375×812 mobile and 1440×600 short-window screenshots
  were inspected. Mobile document width equals viewport width, navigation
  remains available, editor controls scroll, and the same page returns to
  desktop layout. Secondary status text was made more readable.
- **Cache safety:** Relative application module imports carry the release
  version so returning users do not mix old and new module graphs.

## Actual exported movie and sound

- **Movie:** The Last Signal exported through the app's frame-accurate path:
  312 VP8 frames, 1280×536, 24 fps, 48 kHz stereo Opus, container duration
  12.999999 seconds. Extracted frames were inspected for faces, mouth opening,
  titles, framing and the corrected interior floor.
- **MP4 proof:** A separate FFmpeg H.264/AAC conversion is 13.000000 seconds
  with 312 decoded video frames. Native MP4 export has not been added.
- **Waveform:** Source-to-decoded-movie correlation 0.99956, best tested
  alignment 0 samples at 48 kHz around the 3-second dialogue start. Decoded
  peak 0.438 and RMS 0.040 confirm non-silent audio.
- **Section export:** A real 3–5 second interval export has duration
  1.999999 seconds and source waveform correlation 0.99955, demonstrating
  interval rebasing.
- **Opus caveat:** This FFmpeg build prints an Opus packet-header warning
  when demuxing both the app export and an independent control WebM encoded
  by FFmpeg itself. Verbose decoding of the app export reports 650 audio
  frames decoded and zero decoding errors. Decoded PCM is 6.5 ms shorter
  than the container because of Opus pre-skip/padding, so sample-exact audio
  length is not claimed. The MP4 proof uses AAC instead.

## Failure paths

- **Missing encoder:** Removing AudioEncoder gives a visible fallback
  message instead of silently dropping audio.
- **Missing source:** A missing audio source fails visibly and leaves
  export controls usable.
- **Disk failure:** A simulated disk-full failure aborted the writable and
  closed both audio and video encoders exactly once.
- **Cancellation:** Stop export produced a decodable partial movie with
  76 video frames, stereo audio and restored editor controls.

## Exclusions

Still excluded: photorealistic actors, production facial rigs and fingers,
phoneme-accurate lip sync, mocap/IK, path tracing, physical depth of field and
motion blur, professional sound mastering, native MP4/ProRes, server rendering,
and a verified uninterrupted one-hour render. This is a stylised editor
upgrade and a short proof movie, not Netflix/Hollywood production quality.
