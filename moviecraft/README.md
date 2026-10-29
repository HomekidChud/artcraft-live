# VideoCraft 3D movie studio

VideoCraft is a static, browser-based scene and movie editor. This upgrade is a
practical foundation for stylised 3D filmmaking, not a claim of feature parity
with a Hollywood production pipeline.

Version 0.8 adds the **cinematic FX engine** (timeline-driven GPU particle
effects — fire, smoke, sparks, explosions and fountains — driven by the shot
timeline, so preview, playback and export repeat the same motion) and **GLB
model import** for detailed assets. Version 0.7 added the **Character Forge** (build custom
characters with your own bone rigs, not just preset avatars) and a **cutscene
system** (title cards, subtitles, fades, cinema bars, camera shake and shot
transitions), all baked into exported movies. Version 0.6 added the cinematic
look/effects pipeline, transform gizmos and a majorly more detailed character
body. Existing projects keep loading; all new fields are additive.

## Documentation

- **[docs.html](videocraft/docs.html)** — the full guide: quick start, every
  workspace, FX and GLB models, phone controls, shortcuts, export modes,
  section stitching with ffmpeg, and the honest limits of the tool.
- **[GUIDE.md](videocraft/GUIDE.md)** — a machine-readable guide for AI agents:
  stable UI selectors, the project JSON schema, key flows, and limits.

Version 0.9 adds a **phone UI** (slide-in panel sheets with a floating dock,
bottom-sheet timeline, touch-sized targets — desktop layouts unchanged),
**section export** (export long movies frame-accurately in stitchable chunks
via range start/end), a smoother frame-accurate export pipeline (backpressure
waits instead of mid-stream encoder flushes, which could stall exports on
slower machines), and the documentation pages above.

## Start with a complete movie

Click **3D race movie**, then **Play movie**. The editable example, **The Final
Straight**, has four 3D runners, five camera shots, a stadium, a close finish and
a winner's celebration over 26 seconds. Replacing an existing movie requires
confirmation. Save your current project first if you want to retain it.

## Production workspaces

The studio now has eleven labelled tabs. The navigation rail scrolls on shorter
screens, and the production pages stack for phones.

- **Planning**: movie title, production stage, genre, audience, logline,
  synopsis, script and a checklist with completion tracking.
- **Design**: an orbitable 3D workshop for combining boxes, spheres, cylinders,
  cones and toruses into models. Add/select/duplicate/remove parts; change
  transforms, colours, roughness and metalness; click a visible part in the
  preview or select it in the list. Frame the model with the dedicated button.
  Trophy, podium and tree templates remain fully editable.
- **Draw**: the existing drawing studio and drawing asset workflow.
- **Cast**: the existing Character workspace for designing the cast. Characters
  saved from the Forge appear here with a sketch preview and an **Edit in
  Forge** button.
- **Forge**: the Character Forge (see below).
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
limits and reject empty/oversized models. This workshop builds compound
primitive props and scenery, not arbitrary mesh sculpting or a GLTF/FBX
importer. Model assets are local to the project; model JSON files can transfer
them between projects.

## 3D characters and animation

- Newly placed characters are volumetric, weighted `THREE.SkinnedMesh` avatars
  with a 19-bone `THREE.Skeleton`. Geometry is original procedural geometry,
  built from the existing character's body proportions and colours.
- Version 0.6 bodies are far more detailed: capsule limbs, a shaped torso with
  waist and chest, a detailed head (skull, jaw, chin, ears, eyeballs with iris
  and pupil, eyelids, brows, nose and lips), five-fingered hands and shoes with
  soles. Skin uses a clear-coated `MeshPhysicalMaterial`; cloth uses sheen.
- Body controls add bulk, shoulder width, neck length, hand and foot size,
  ears, iris colour and nine hair styles (flat, side, spiky, bald, buzz, afro,
  mohawk, ponytail, long). Old projects fall back to sensible defaults.
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

The generated avatars use stylised segment skin weights. They do not include
production facial animation rigs, IK solvers, muscle deformation, motion
capture retargeting or realistic anatomy. The Character workspace remains a
2D design/colour preview; inspect and pose the actual 3D character in Scene or
Animate.

## Character Forge

The **Forge** workspace builds fully custom characters instead of choosing a
preset avatar:

- Start from a blank rig or a 19-bone humanoid template, then **add bones**
  with any parent (including none/root) and **add parts** — boxes, spheres,
  capsules, cylinders and cones with per-part colour, dimensions and offsets.
- Bones form an editable hierarchy (up to 64 bones, 200 parts, 24 direct
  children per bone). Parent cycles and orphaned bones are prevented or
  repaired on load.
- Selecting a bone shows a rotate gizmo preview; selecting a part shows a
  translate gizmo. Bone picker spheres and axis helpers make the rig visible.
- **Save to Cast** stores the character in the movie like any other; place it
  from Cast or Assets. Its bones appear as joint channels in **Animate** and
  can be keyed exactly like preset character joints.
- Characters whose bones use the standard joint IDs keep motion presets
  (idle/walk/run/wave/celebrate); custom bone names are posed by keys only.
- **Export/Import character JSON** moves custom characters between projects,
  and the Assets tab has an **Edit in Forge** button for round-trip editing.

The Forge uses rigid-part rigging: each bone rotates the parts attached to it.
It does not skin-weight arbitrary meshes, sculpt, import GLTF/FBX or retarget
mocap. The result is stylised and game-like, not photoreal.

## Cutscenes and transitions

Expand **Cutscene & transitions** in Animate. Every shot owns a list of events
plus a transition into it. Event state is a pure function of shot-local time,
so scrubbing, replaying backwards and frame-accurate export all agree:

- **Title card** and **subtitle/dialogue** with text, speaker name and colour.
- **Fade in** and **fade out** with configurable colour and length.
- **Cinema bars** (letterbox) for anamorphic framing.
- **Camera shake** with strength, eased in and out; it only runs during movie
  playback and recording, never while editing or scrubbing.
- **Transitions**: hard cut or fade from black, with an editable fade length.

Titles, subtitles, fades and bars render in a screen-space overlay on the same
canvas the exporter captures, so they are baked into exported movies in both
export modes.

## Cinematic look and effects

Expand **Look & effects** in Animate. The render pipeline is an
`EffectComposer` chain (render, depth of field, bloom, grade, output) applied to
the same canvas the exporter captures, so every effect is baked into exported
movies in both export modes:

- **Colour grades**: neutral, cinematic, blockbuster, golden, noir and neon,
  combining lift, gain, contrast, saturation and warmth.
- **Bloom**, **vignette**, **film grain** (animated) and **chromatic
  aberration** (grows toward the frame edge, like a real lens).
- **Depth of field** with focus distance and aperture controls.
- **Ambient reflections**: a PMREM room environment map lights materials with
  physically plausible reflections (toggleable for performance).

The whole look can be switched off with one toggle. The project `look` field is
additive; old projects load with the cinematic default.

## Cinematic FX (particle effects)

Add fire, smoke, sparks, explosions or fountains from the Scene list. Effects
are real scene objects — transform, scale, keyframe, duplicate and delete them
like anything else. Each effect is evaluated from the shot timeline (a
particle is a pure function of seed and time — there is no simulation state),
so scrubbing, playing and exporting are all repeatable: the same timeline
position always produces the same motion.

- **Intensity** scales the particle count, **particle size** and **speed** tune
  the look, and **start (s)** delays the effect into the shot.
- **Explosion** is one-shot: it triggers at its start time, burns once and
  disappears — set the start on the timeline you want the blast.
- Fire and sparks use additive blending; smoke uses soft alpha so it reads as
  volumetric against any backdrop.
- Effects participate in the existing grade/bloom/DoF pipeline, so a fire
  inside a depth-of-field shot defocuses exactly like the rest of the scene.

## GLB model import

Click **+ import GLB model** in the Scene list to load a static glTF binary
(.glb) model — for example props and scenery exported from a DCC tool or
downloaded from a model library. Models are:

- Normalised on import — fitted to about 3 units tall, centred and grounded —
  so they behave like the built-in objects.
- Parsed once per asset and instanced per object; geometry and textures are
  shared with the asset cache, and per-object materials are cloned so opacity
  and edits never leak between instances.
- Embedded in the project file as a data URL (kept under 40 MB per model), so
  projects stay fully self-contained and portable.
- Awaited before both export modes start, so a freshly-opened project never
  captures a frame with a model still parsing.

Known limits: static models only. Rigged/skinned GLBs are unsupported —
skeleton animation is not retargeted to the timeline, and such models may not
import correctly. If a referenced model fails to load, exports are aborted
with an error rather than rendering frames without it.

## Transform gizmos

Selecting an object in Scene or Animate now shows a full transform gizmo
(move/rotate/scale handles) instead of ground-plane dragging only:

- Keyboard shortcuts: **G** move, **R** rotate, **S** scale, **Q** select-only.
- **Snap** toggles 0.25 m / 15° / 0.1 increments; **World/Local** switches the
  gizmo space; **Helpers** shows the key/rim light direction gizmos.
- Dragging a handle writes position, rotation and scale back into the project
  data and timeline, and gizmos hide during movie playback and recording.

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
`motion`, `joints`, shot `lighting`, project `exportAspect`, forge characters
with `kind: 'forge'` in `characters`, and shot `events`/`transition`/
`transitionDur`) are additive.
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

MP4/ProRes, offline audio mixing, path tracing, physically accurate motion blur,
compositing, transition libraries beyond the included cut/fade, GLTF/FBX
import, external mocap, dialogue/lip-sync and
distributed/render-farm processing are not implemented here. Depth of field and
colour grading exist (see above) but are stylised real-time effects, not a
physically based render pipeline. You can make multi-shot stylised movies, but
these are future work for a professional feature-film pipeline.

## Development and checks

From the repository root:

```sh
npm run serve
# Open http://127.0.0.1:8000/videocraft/
npm run test:videocraft
npm test
```

`tests/motion.test.js`, `tests/charcraft.test.js` and `tests/cutscene.test.js`
use Node's built-in test runner and have no dependencies. They check skeleton
names, finite motion, deterministic scrubbing, independent instances, clip
bounds, strengths, speed/phase, camera tracks and frame sizes; character
validation (limits, cycles, parents, colours) and the forge data model; and
cutscene event evaluation (fades, titles, bars, shake, transitions).
Browser regression checks should also cover legacy load/upgrade, project
round-trip, joint key editing, shot playback, export teardown, forge
round-trip (save/place/key joints) and 375px layout.

The vendored `webm-muxer` 5.1.4 module is MIT-licensed; its license is alongside
the module in `vendor/`. Avatar geometry is batched by material so one body
part does not require a separate draw call in every rendering pass.
