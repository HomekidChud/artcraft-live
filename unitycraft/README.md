# UnityCraft

A browser reconstruction of the **Unity Hub** launcher and a **Unity Editor**-style 3D workspace — the UnityCraft take on "Unity in the browser".

- **Hub** — dark launcher with Projects / Installs / Learn / Community / Preferences, a New Project flow with templates and editor-version selection, project cards with version chips and favorites, and a splash screen with a spinning-progress ring.
- **Editor** — Three.js scene view with grid, gizmos and an axis widget; Hierarchy; Inspector (Transform / Mesh Renderer / Box Collider / Light / Camera); GameObject creation menu; script components (Spin, Bob) with **Play mode** that animates objects and restores scene state on Stop; play/pause/step; undo/redo; scene save/load (localStorage with in-memory fallback); console; Game view rendered from the scene's Main Camera.

## Provenance

This is a clean-room reconstruction — no Unity Technologies code, assets, or binaries are redistributed. The Hub logo/splash artwork and all UI code in this module are original.

| Area | Provenance | Notes |
|---|---|---|
| Hub window chrome, Inter typography, `#131313` background, frameless titlebar, min 1024×600 | **Source-assisted** — static analysis of `UnityHubSetup-x86_64.AppImage` (Unity Hub 3.22.3, Electron; ASAR SHA-256 `aae8a888…4e96cc6a`) | AppImage extracted via the AppImage runtime's extraction mode; never launched. Renderer `index.html`/CSS and main-process module inventory (3,297 files) analyzed with REA 6.5.0 |
| Hub routes `projects`, `installs`, `learn`, `new-project`, `templates`; feature channels (`projects/*`, `installs/*`, `templates/*`, `downloads/*`, `licenses/*`) | **Source-assisted** — same ASAR analysis | Feature names recovered from the renderer bundle; UI implementation is original |
| Editor workspace semantics | **Documentation-based** — Unity Manual | Scene view navigation incl. framing with F ([Scene view navigation](https://docs.unity3d.com/Manual/SceneViewNavigation.html)); Game view, Play/Pause/Step and "changes … are reset when you exit Play mode" ([Game view](https://docs.unity3d.com/Manual/GameView.html)) |
| 3D rendering | Three.js (MIT) | https://threejs.org |

## Behavior ledger

| Behavior | Target evidence | Status |
|---|---|---|
| Hub splash + dark launcher chrome | Hub 3.22.3 ASAR (source-assisted) | Reimplemented with original artwork (verified in browser QA) |
| Hub routes/views (Projects, Installs, Learn, Community, Preferences) | Renderer bundle route map (source-assisted) | Verified: each view renders |
| New-project flow → editor | Hub `new-project`/`templates` routes (source-assisted) | Verified: modal, template pick, editor opens |
| Play mode: scripts animate; state restored on exit | Unity Manual Game view (documentation-based) | Verified: rotation 0 → 2.49 rad during play, restored to 0 on stop |
| Play/Pause/Step | Unity Manual Game view (documentation-based) | Implemented; Play/Stop verified end-to-end, Pause/Step implemented on the same loop |
| Frame selected (F), orbit, zoom | Unity Manual Scene view navigation (documentation-based) | Implemented (orbit via drag, zoom via wheel, F frames selection) |
| Transform tools Q/W/E/R/T | Unity Editor tool shortcuts | Implemented (rect tool is select/no-gizmo only — partial) |
| Undo/redo incl. delete/create/duplicate | Design choice | Verified round-trip in browser QA |
| Save/load scene | Design choice (Unity persists scenes to assets) | Verified round-trip incl. colors and scripts |
| Camera helpers, light gizmos hidden in Game view | Unity Manual (documentation-based) | Verified in Game view |

Not implemented: physics/colliders (checkbox only), multi-scene, asset import, C# compilation (script components are built-in JS behaviors), parenting in the Hierarchy, Preferences.

Unity® is a trademark of Unity Technologies — this project is not affiliated with or endorsed by them. For the real editor, download it from https://unity.com/download.

## Run

Static site — serve the repo root (`python -m http.server`) or open via GitHub Pages, then launch the UnityCraft card. Requires an up-to-date desktop browser (WebGL + ES modules).
