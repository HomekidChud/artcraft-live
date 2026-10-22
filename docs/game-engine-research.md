# Game engine deep research — how real engines work, and Flight World's roadmap

The 17.10 brief asked for a 1:1 understanding of how game engines work so
the sim can be "upgraded massively". This is the research digest with
citations, mapped to concrete upgrades for Flight World (Three.js + Rapier
single-file client). Note: there is no Unity project in this repo — "Unity"
in the brief is read as engine research, not a migration target; Flight
World stays on Three.js + Rapier.

## Unity — data-oriented architecture

- Unity's DOTS (Data-Oriented Technology Stack) applies data-oriented design:
  entities are IDs, components are plain data laid out in chunks, systems
  are functions that query and transform them — enabling heavy jobs/threads
  and Burst compilation ([Unity DOTS](https://unity.com/dots),
  [Entities manual](https://docs.unity3d.com/Packages/com.unity.entities@0.17/manual/gp_overview.html)).
- Unity's rendering moved from the Built-in Render Pipeline to scriptable
  render pipelines (SRP) and a hybrid DOTS SRP; the engine team described
  the evolution from BiRP → SRP → DOTS SRP in their rendering architecture
  talk ([Unity rendering engine architecture, REAC 2021](https://enginearchitecture.org/downloads/reac2021_unity_rendering_engine_architecture.pdf)).
  The Hybrid Renderer bridges ECS entities to existing rendering
  ([Hybrid Renderer docs](https://docs.unity3d.com/Packages/com.unity.rendering.hybrid@0.4/manual/index.html)).

**Flight World takeaway:** the damage-cell "atoms" system is already a
mini-ECS (cells as data, systems as passes). Formalizing it (typed arrays of
cells, deterministic update passes) is the cheap upgrade path for
crash/damage performance on big airliners.

## Unreal — module + streaming architecture

- UE5's defining tech: Nanite virtualized geometry, Lumen dynamic GI,
  Virtual Shadow Maps ([overview](https://andrewaltimit.github.io/Documentation/docs/technology/unreal.html));
  the engine is organized into modules with explicit dependencies, and the
  full C++ source is inspectable ([Unreal Source Explained](https://donaldwuid.github.io/unreal_source_explained/main/rendering.html),
  [Epic API reference](https://dev.epicgames.com/documentation/zh-cn/unreal-engine/API)).

**Takeaway:** Flight World's terrain chunk streaming is the same idea
(load geometry in a radius, dispose beyond it) — keep pushing chunk
efficiency (frustum + distance culling, GPU displacement) rather than
rewriting.

## Godot — scene tree and server split

- Godot's architecture: a scene tree of nodes; scenes are collections of
  nodes that become active when they enter the tree; servers (rendering,
  physics, audio) sit behind the scene system so high-performance code can
  bypass nodes ([Godot architecture overview](https://docs.godotengine.org/en/latest/engine_details/architecture/godot_architecture_diagram.html),
  [Using SceneTree](https://docs.godotengine.org/en/stable/tutorials/scripting/scene_tree.html)).

**Takeaway:** Flight World's `workshopBuildRoot` / part hierarchy is a scene
tree; the Rapier physics world and the render scene are separate servers.
Keep the split clean — physics state, render state, and game state should
not share mutable objects.

## Rapier — determinism

- Rapier is a Rust 2D/3D physics engine for real-time apps
  ([rapier.rs](https://rapier.rs/)); it is locally deterministic — the same
  simulation with the same initial conditions gives the same result on the
  same platform/build ([Determinism guide](https://rapier.rs/docs/user_guides/rust/determinism/)).

**Takeaway:** Flight World's crash replay / regression tests can rely on
Rapier determinism: seed the RNG, run fixed timesteps, and assert the same
damage outcome. Worth adding to the QA harness (see TODO.md).

## Roadmap for "massive upgrade" (in dependency order)

1. **Deterministic QA harness** — fixed-timestep headless runs with Rapier
   determinism; regression asserts on flight state + damage cells.
2. **Damage cells as typed data** (Unity ECS lesson) — move cell state to
   typed arrays, pass-based updates; unlocks 10x cell counts.
3. **Rendering pipeline hygiene** (Unity SRP lesson) — one render pass
   config: shadows, tone mapping, fog; then instanced part rendering for
   big builds.
4. **Streaming improvements** (Unreal lesson) — terrain LOD rings, GPU-side
   displacement, tighter culling.
5. **Server-authoritative cloud presets** — already merged (server/ with
   validation, rate limiting, CORS).
