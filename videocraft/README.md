# VideoCraft 3D movie studio

VideoCraft is a static, browser-based scene and movie editor. This upgrade is a
practical foundation for stylised 3D filmmaking, not a claim of feature parity
with a Hollywood production pipeline.

## Start with a complete movie

Click **3D race movie**, then **Play movie**. The editable example, **The Final
Straight**, has four 3D runners, five camera shots, a stadium, a close finish and
a winner's celebration over 26 seconds. Replacing an existing movie requires
confirmation. Save your current project first if you want to retain it.

For a dialogue example, click **Cinematic demo**. **The Last Signal** is a
13-second, four-shot apartment scene with two rigged actors, a bundled
AI-generated voice, audio-amplitude mouth movement, timed subtitles, lighting
and grading. Its camera moves, performances and sound clip remain editable.
This is an original stylised technical demo, not a production-quality film.

Replacement, deletion and naming use keyboard-accessible in-app dialogs,
including in the sandboxed review preview. Cancel or Escape keeps the existing
work; naming dialogs accept Enter. No blocked native browser prompt is needed.

## Production workspaces

The studio now has ten labelled tabs. The navigation rail scrolls on shorter
screens, and the production pages stack for phones.

- **Planning**: movie title, production stage, genre, audience, logline,
  synopsis, script and a checklist with completion tracking.
- **Design**: an orbitable 3D workshop for combining boxes, spheres, cylinders,
  cones and toruses into models. Add/select/duplicate/remove parts; change
  transforms, colours, roughness and metalness; click a visible part in the
  preview or select it in the list. Frame the model with the dedicated button.
  Trophy, podium and tree templates remain fully editable.
- **Draw**: the existing drawing studio and drawing asset workflow.
- **Cast**: the existing Character workspace for designing the cast.
- **Assets**: search/filter models, characters, drawings and audio. Add an asset
  to the current shot, edit saved model designs, and import/export model JSON.
- **Scene**: the existing 3D scene and transform tools, now also supporting
  compound model instances. Saved library models appear in its add menu.
- **Storyboard**: shot names, durations, action/camera notes and optional
  drawing references. Create, duplicate, reorder or delete shots and open
  individual shots in Animate. The reference image is chosen explicitly;
  blank cards are labelled shot cards, not fake scene renders.
- **Animate**: the existing movie timeline, actor rigs and camera animation.
- **Sound**: dedicated access to the actual audio clip importer, global start
  and volume controls, plus sound-direction/dialogue-cue notes.
- **Delivery**: a non-blocking production checklist, project backup and the
  actual movie export controls. Starting export opens Animate. Sound and
  export controls are moved, not cloned, so their settings and handlers remain
  consistent with Animate.

Planning, models, the design draft, shot notes and sound notes are stored in an
additive `studio` field in the project JSON. Existing version-1 and version-2
files receive empty defaults. A designed model placed in a shot stores an
independent snapshot of its parts, so editing/removing a library model does not
silently change existing scenes. Models support up to 100 primitive parts.

Model JSON imports validate primitive types, colours, dimensions and material
limits and reject empty/oversized models. Design builds compound primitive
props rather than arbitrary mesh sculpting. Assets now also imports real GLB
meshes, skins, materials and animation clips, as described below. FBX and
multi-file `.gltf` packages are not supported.

## Imported 3D models and animation

In **Assets**, choose **Import 3D GLB**, then **Place imported model**.
Use a self-contained, uncompressed glTF 2.0 `.glb` up to 25 MB. Textures and
buffers must be embedded; external resource URLs are rejected. Required
Draco/Meshopt/KTX2 compression is not supported. Projects allow up to 100
imported assets; high polygon/texture counts remain limited by your device.

The source is embedded once in the saved project. Each placed instance gets
its own skeleton, geometry, materials and animation mixer. Instances are
normalized to two metres high with a ground-level origin; Scene scale controls
change their size. Select **Imported animation** in Scene or Animate to choose
a clip, set speed/start/source offset, and loop or play once and hold. Absolute
clip-time evaluation supports forward and reverse scrubbing. Imported clips
are played as authored: this is not motion-capture retargeting or a bone editor
for arbitrary imported rigs. Static/bind-pose playback is also available.

Exports wait for imported resources to finish loading and report failures.
Removing an imported library source is blocked while any shot uses it.
Large GLBs can exceed browser-autosave quota; the status asks for a project
file backup rather than claiming the asset was saved automatically.

## Sets, precision editing and finishing

- **Sets & atmosphere** in Scene adds a forest clearing, city street or studio
  apartment without deleting existing objects. A set is a locked compound
  object. Unlock viewport transforms in its inspector or **Copy parts to
  Design** to make a new editable design. Saving the new design does not
  mutate the original set instance. Set framing asks before replacing
  existing camera animation.
- Background, ground colour, exposure and fog are saved per shot. Resetting
  the atmosphere preserves that shot's captions and fades.
- Scene objects have movie visibility and viewport-transform locks.
  Duplicating an object also copies its animation tracks independently.
- Animate supports rotation X/Y/Z and scale X/Y/Z in addition to the legacy
  uniform-scale multiplier. Axis scales are absolute local scales, then
  multiplied by a uniform-scale track if present. Cubic ease-in/out curves
  supplement linear, smooth and hold interpolation.
- **Precision editing** provides shot/movie playhead input, previous/next
  frame, frame snapping, composition guides, full base-transform keying and
  object-motion copy/paste. Copy/paste replaces destination tracks with
  confirmation, skips keys outside the destination shot, and keeps cameras
  separate from object animation. Clear motion preserves the base pose.
- Storyboard uses 12-shot pages and shot/name-note search. **Titles, captions
  & fades** gives each shot timed text, centered titles or bottom subtitles,
  size/colour and fades through black. Fades do not change shot durations;
  each is capped at half the shot. These are not overlapping dissolves.
- Import SRT in Storyboard using global movie timestamps. Cues crossing a
  cut are split across shots. Existing cues are kept. SRT export combines
  shot-relative subtitle cues into movie timestamps and excludes centered
  title cards. Use valid end-after-start timings; out-of-shot cues are not shown.
- Playback and video export share the same caption/fade drawing functions.
  Guides, grid and selection helpers are omitted from exported frames.
  Animate letterboxes the preview to the delivery aspect so its camera framing
  matches the output rather than stretching to the editor pane.

Sound clips now have independent media elements, even for repeated instances
of one source. Set source in-point, trimmed duration (zero means to source
end), fade-in/out, volume and stereo pan. Real-time movie recording includes
this mix; frame-accurate mode now renders a stereo PCM mix into Opus audio.

## Faces, dialogue and cinematic looks

In Scene or Animate, select a built-in 3D character and expand **Face, gaze &
dialogue**. Choose neutral, happy, sad, angry, surprised or focused expressions;
set horizontal/vertical gaze, blinking and manual mouth opening. Face controls
are independent per instance and do not change the character's body animation.
Timed dialogue gestures use shot-local times and synthetic mouth movement.

For audio-driven mouth movement, import dialogue in Sound, select its placed
clip in the actor's face panel, then click **Analyze dialogue for mouth
movement**. A compact loudness envelope is saved in the project and sampled
at absolute movie time, respecting that clip's start, source trim and gain.
This is amplitude animation, not phoneme recognition or accurate lip sync.
Changing the audio source requires analyzing it again; changing clip timing
does not. Analysis is limited to ten-minute sources.

Imported GLBs can opt into **Imported face overrides**. Recognized named
jaw/mouth, blink and emotion morphs are overlaid on their authored animation.
Overrides are off by default. Switching them off restores the authored morph
values; unsupported morph naming and rigs without morph targets are unchanged.

**Actor camera composition** supplies Close-up, Medium and Wide framing from
the actor's current position, rotation and bounds. Applying it asks before
replacing existing shot camera keys. It authors a base camera, not a moving
tracking constraint.

In Scene, expand **Cinematic lighting & grade** for portrait, moonlight, neon
and golden key/fill/rim arrangements. Colour presets and editable contrast,
saturation, warmth, vignette and grain use GPU postprocessing shared by preview
and export. Grain is deterministic by movie frame. Neutral grading bypasses
the postprocessor, and legacy files keep their original lighting by default.
Captions are composited after grading so their colours stay readable.

## 3D characters and animation

- Newly placed characters are volumetric, weighted `THREE.SkinnedMesh` avatars
  with a 19-bone `THREE.Skeleton`. Geometry is original procedural geometry,
  built from the existing character's body proportions and colours.
- The skeleton contains hips, spine, chest, neck, head, shoulders, upper arms,
  forearms, hands, upper/lower legs and feet. Each joint supports X/Y/Z rotation.
- Choose a character in **Selected object** to open **Actor performance**.
  Presets are None, Idle, Walk, Run, Wave and Celebrate. Set speed, strength,
  phase and start/end times independently for every instance.
- Expand **Joint posing & keyframes**, choose a joint and set its axes. Static
  overrides take precedence over presets; joint timeline keys take precedence
  over static overrides. Clear static overrides to return to preset motion.
- **Key this joint at playhead** captures all three axes. Select a timeline
  diamond to edit its numeric time/value and easing, or drag it in time.
  Scroll vertically to reach all joint tracks.
- Animation is evaluated directly from shot time. Backwards scrubbing does
  not depend on the previous frame and does not mutate shared character assets.
- Legacy characters remain billboards when an older project is opened. Use
  **Upgrade this actor to 3D** to convert one instance explicitly. A 3D actor's
  origin is at its feet; conversion adjusts the old billboard's height.

The generated avatars use stylised rigid segment skin weights. They do not
include production facial rigs, fingers, IK solvers, muscle deformation, motion
capture retargeting or realistic anatomy. The Character workspace remains a
2D design/colour preview; inspect and pose the actual 3D character in Scene or
Animate.

## Cinematography

Expand **Cinematography** in Animate:

- Dolly in, Pull back, Orbit subject and Crane reveal author editable camera
  keys across the shot duration. Track selected actor follows the selected
  object's start/end positions; it is not a live constraint following every
  intermediate key on a curved path.
- Applying a move asks before replacing existing camera keys.
- 24, 35, 50 and 85mm lens choices calculate vertical FOV using a 24mm
  full-frame sensor height. Lens selection also updates any existing FOV keys.
- Warm studio, Daylight stadium, Golden hour and Blue-hour floodlights are
  saved per shot. Lighting uses a shadow-casting key, hemisphere fill and rim
  light with ACES filmic tone mapping.
- Editor orbit damping does not override authored camera moves during movie
  playback or recording. Grid and selection guides are omitted from movies.

## Projects and export

The existing version-2 project schema is retained. New fields (`rigMode`,
`motion`, `joints`, shot `lighting`, project `exportAspect`) are additive.
Version-1 single-shot projects and existing version-2 movies still load.
Existing audio clips, drawing assets and shot sequencing are retained.

Use **Save project** to download a self-contained `.videocraft.json` project.
Opening a project stops existing playback and releases the old scene's GPU
resources. Browser autosave is best-effort; file saves are the portable backup,
especially for projects containing large audio files.

Both export modes render to **WebM**. Choose entire movie, current shot, or a
custom interval in movie seconds. Section timestamps start at zero in the
output file, even when rendering a later part of the movie. Choose a frame
width (1280, 1920 or 3840 pixels), then a shape:

- 16:9 widescreen
- 2.39:1 cinema
- 9:16 vertical
- 1:1 square

Frame height is calculated from that ratio and rounded to an even number.
Resolution labels describe width, not a fixed height. For example 1920-pixel
cinema output is 1920×804. Vertical output at a large width can be extremely
demanding; use a smaller width on limited hardware.

**Frame-accurate** mode evaluates each movie frame at its exact time and encodes
it with WebCodecs and a vendored WebM muxer. A slow GPU takes longer rather than
skipping animation frames. The offline mixer decodes each used audio source
once, mixes independent clips in small stereo blocks at 48 kHz, and encodes
128 kbps Opus alongside VP8 video. Trims, fades, volume, repeated sources,
stereo pan and section offsets are supported. A hard peak limiter prevents
sample overflow; this is not a mastering loudness normalizer. Decoded audio is
capped at 256 MB, so split very long sound sources into shorter files.
WebCodecs needs a supported secure browser and video/audio encoders.
Missing sources or unsupported audio encoders fail visibly rather than
silently discarding sound. Use real-time mode as a compatibility fallback.

**Real-time recording** uses MediaRecorder and includes the existing audio mix.
Frame delivery depends on the machine; a slow browser may record choppy
animation. Keep the tab visible; hiding it pauses the recording. Silent projects
do not create an unnecessary audio track.

4K needs suitable GPU/encoder support and was not performance-certified on
every device. Stop export saves a partial movie in either mode. Mutating
controls are locked during export, and the editor's frame size, camera and
controls are restored afterward. Memory-based output in either mode is limited
to five-minute sections. **Frame-accurate: stream directly to disk** uses a
save-file picker and positional, serialized chunk writes with backpressure,
instead of holding the entire compressed film in memory. Cancelling that
picker cancels rendering. Failed writes abort the file and restore the editor.
Browsers without a save-file picker must use the memory/section path.

Progress includes frame counts, observed rendering rate and an estimated
remaining time, not a promised render speed. Long timeline navigation uses
binary shot lookup in the precision seeker; keyframe sampling uses binary
search, and the timeline only mounts visible keyframe diamonds. Frame-accurate
export still evaluates every frame, which can take substantial time.

Native MP4/ProRes, path tracing, depth of field, physically accurate motion blur,
colour grading nodes, multilayer compositing, dissolves, FBX import, external mocap,
phoneme-accurate lip sync and distributed/render-farm processing are not implemented here.
You can make multi-shot stylised movies, but these are future work for a
professional feature-film pipeline. A one-hour data timeline and short
sections can be tested without certifying a complete hour-long render on
every browser, or claiming the artistic quality of a finished feature.

## Development and checks

See [film-production QA](QA-FILM-PRODUCTION.md) for the new upgrade's tested
flows, observed export behavior and explicit limits.

From the repository root:

```sh
npm run serve
# Open http://127.0.0.1:8000/videocraft/
npm run test:videocraft
npm test
```

`tests/motion.test.js` uses Node's built-in test runner and has no dependencies.
It checks skeleton names, finite motion, deterministic scrubbing, independent
instances, clip bounds, strengths, speed/phase, camera tracks and frame sizes.
Browser regression checks should also cover legacy load/upgrade, project
round-trip, joint key editing, shot playback, export teardown, and 375px layout.

The vendored `webm-muxer` 5.1.4 module is MIT-licensed; its license is alongside
the module in `vendor/`. A documented VideoCraft patch includes the final
video frame's display interval in the segment duration; memory and seekable
streaming tests cover this. Avatar geometry is batched by material so one body
part does not require a separate draw call in every rendering pass.
