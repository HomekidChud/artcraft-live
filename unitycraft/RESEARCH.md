# UnityCraft engine upgrade — research notes

Research that informed the physics / shader / audio / particle / animator upgrade.
Every implemented feature below maps to a primary Unity source.

## Primary sources consulted

| Topic | Source | What it drove |
|---|---|---|
| Rigidbody semantics (mass, linear/angular drag, use gravity, is kinematic, collision detection, constraints) | [Unity Manual — Rigidbody](https://docs.unity3d.com/6000.0/Documentation/Manual/class-Rigidbody.html) | Rigidbody component fields; fixed-timestep simulation; freeze constraints |
| Physics materials (bounciness, static/dynamic friction, friction combine, bounce combine) | [Unity Script Reference — PhysicsMaterial](https://docs.unity.com/en-us/engine/6000.0/script-reference/unityengine/physicsmaterial) | Per-object bounciness/friction; averaged combine on contact (Unity's default) |
| Audio Source (volume, pitch, play on awake, loop, spatial blend) | [Unity Manual — Audio Source](https://docs.unity.com/en-us/engine/6000.3/manual/audio/reference/class-audio-source/source-reference) | AudioSource component fields; play-on-Play behavior |
| Particle System main module (duration, start lifetime, start speed, start size, start color, gravity modifier) + emission module (rate over time) | [Unity Manual — Particle System main module](https://docs.unity.com/en-us/engine/6000.0/manual/visual-effects/particle-systems/particle-system-modules/part-sys-main-module) · [emission module](https://docs.unity.com/en-us/engine/6000.0/manual/visual-effects/particle-systems/particle-system-modules/part-sys-emission-module) | Emitter parameters: rate, lifetime, speed, size, color, gravity, cone |
| Video: official Unity tutorial "Physics Objects (Rigidbodies)" | [YouTube — Unity official tutorial](https://www.youtube.com/watch?v=WTGcs10Sj34) | Workflow confirmation: add Rigidbody → gravity acts → colliders produce responses; triggers report overlaps without responding |

## Design decisions (with rationale)

- **Custom solver instead of a vendored physics library.** Semi-implicit Euler at a fixed 1/60 s step (accumulator pattern) over AABB box colliders + bounding-sphere colliders. Small scope, no CDN/dependency risk for a single-file app. Rotation dynamics are not simulated — objects keep their orientation (documented limitation).
- **Only settings that are actually simulated are exposed.** The Unity Rigidbody exposes interpolation and continuous collision detection; UnityCraft does not implement those, so they are not in the Inspector. Bounciness/friction are averaged on contact (Unity's default combine mode).
- **Triggers** produce `OnTriggerEnter` events (logged to the Console) and never push back; solid contacts log `OnCollisionEnter` once per pair per play session.
- **Sleeping.** Bodies at rest for ~40 fixed steps (speed < 0.06 m/s while grounded) stop integrating; any contact or a collider deletion wakes them.
- **Scripts are skipped on dynamic Rigidbodies** — physics owns their transform (mirrors Unity's "animating physics objects" warning). Kinematic bodies still animate.
- **Shaders** are a serializable config (`userData.mat`) driving seven presets: Standard (Lit PBR, matching the old Inspector controls), Unlit, Toon (ramp texture), Hologram and Water and Dissolve (custom GLSL `ShaderMaterial` animated by a simulation clock), Wireframe. The clock freezes on Pause — like Unity's play-mode pause — and runs in edit mode so effects are previewable. Custom shaders cast shadows but do not receive them (a `ShaderMaterial` limitation, noted in the README).
- **Audio** uses WebAudio-generated tones (no imported clips) and is created on the first user gesture (Play/Preview click), matching browser autoplay rules. `Play On Awake` fires on Play; Stop silences everything.
- **Animator** keeps three keyframe tracks (position/rotation/scale) with linear interpolation, loop/clamp, and speed; keyframes are captured from the object's current transform in the Inspector.
- **Scene format v2** wraps the object list with version + scene settings (sky, fog, ambient, gravity). Legacy v1 arrays still load.

## Round 3 — projects, script editor, parenting (sources)

- **Script assets + editing** — Unity Manual, [Creating scripts](https://docs.unity3d.com/Manual/CreatingAndUsingScripts.html): script assets created via Assets ▸ Create / Project window create menu; scripts derive from MonoBehaviour to build custom components. UnityCraft models scripts as project assets (name, source, params) with a built-in editor; PlayerController is a native behavior rather than editable source.
- **Parent/child transforms** — Unity Manual, [Transform component](https://docs.unity3d.com/Manual/class-Transform.html): children move/rotate/scale with their parent; child values are relative to the parent. UnityCraft implements parenting as logical nesting with world positions preserved, and applies the parent's world-transform delta matrix to descendants each frame (no local-space refactor, so gizmos/physics keep working on world transforms).
- **Worker isolation** — design choice: Unity compiles C# against the engine; a browser app cannot safely run user code on the main thread (an infinite loop would freeze the editor). UnityCraft runs scripts in a Web Worker on plain state snapshots (`obj.position/rotation/params`, `dt`, `t`, input) — execution isolation with a watchdog that terminates an unresponsive worker so the editor survives. This is not a security sandbox (worker code can still fetch and use storage); runtime errors disable the script until the next Play.
- **Per-project storage** — design choice: projects get stable IDs (`unitycraft-projects` registry) and per-project keys (`unitycraft-proj:<id>:scenes|scene|scripts|prefabs|preview`). Legacy shared keys (`unitycraft-scenes`, `unitycraft-scene`, `unitycraft-prefabs`) are migrated into the first project on first run.
- **Hub previews** — design choice: UnityCraft renders the actual scene through its Main Camera into an offscreen WebGLRenderTarget and stores the JPEG data URL as the project card thumbnail (grid, gizmos, helpers and the transform control hidden during capture). A project with no preview yet gets a boot-time render of its saved scene (or its default template if it has never been saved), so cards show real renders of the project's actual content from the first visit; the regular capture replaces the seed on open/save.
- **Migration safety** — design choice: legacy shared keys are migrated non-destructively (writes only into empty per-project slots, then the old keys are removed), so stale legacy data can never overwrite a newer per-project save.
