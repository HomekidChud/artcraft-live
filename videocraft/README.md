# VideoCraft 3D movie studio

VideoCraft is a static, browser-based scene and movie editor. This upgrade is a
practical foundation for stylised 3D filmmaking, not a claim of feature parity
with a Hollywood production pipeline.

## Start with a complete movie

Click **3D race movie**, then **Play movie**. The editable example, **The Final
Straight**, has four 3D runners, five camera shots, a stadium, a close finish and
a winner's celebration over 26 seconds. Replacing an existing movie requires
confirmation. Save your current project first if you want to retain it.

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

Both export modes render all shots back-to-back to **WebM**. Choose a frame
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
skipping animation frames. This mode is **video-only**: if a movie has audio
clips, the editor asks you to use real-time recording rather than silently
discarding sound. WebCodecs needs a supported secure browser/encoder.

**Real-time recording** uses MediaRecorder and includes the existing audio mix.
Frame delivery depends on the machine; a slow browser may record choppy
animation. Keep the tab visible; hiding it pauses the recording. Silent projects
do not create an unnecessary audio track.

4K needs suitable GPU/encoder support and was not performance-certified on
every device. Stop export saves a partial movie in either mode. Mutating
controls are locked during export, and the editor's frame size, camera and
controls are restored afterward. Offline output currently keeps compressed
video in memory and warns for movies longer than five minutes; use shorter
sections for large productions rather than assuming feature-length output
will fit in browser memory.

MP4/ProRes, offline audio mixing, path tracing, depth of field, physically accurate motion blur,
colour grading nodes, compositing, transitions, GLTF/FBX import, external mocap,
dialogue/lip-sync and distributed/render-farm processing are not implemented here.
You can make multi-shot stylised movies, but these are future work for a
professional feature-film pipeline.

## Development and checks

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
the module in `vendor/`. Avatar geometry is batched by material so one body
part does not require a separate draw call in every rendering pass.
