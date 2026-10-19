# UnityCraft

A browser reconstruction of the **Unity Hub** launcher and a **Unity Editor**-style 3D workspace — the UnityCraft take on "Unity in the browser".

- **Hub** — dark launcher with Projects / Installs / Learn / Community / Preferences, a New Project flow with templates and editor-version selection, project cards with version chips and favorites, and a splash screen with a spinning-progress ring.
- **Editor** — Three.js scene view with grid, gizmos and an axis widget; Hierarchy; Inspector (Transform / Mesh Renderer / Box Collider / Light / Camera); GameObject creation menu; script components (Spin, Bob) with **Play mode** that animates objects and restores scene state on Stop; play/pause/step; undo/redo; scene save/load (localStorage with in-memory fallback); console; Game view rendered from the scene's Main Camera.

## Provenance

This is a clean-room reconstruction — no Unity Technologies code, assets, or binaries are redistributed. The Hub logo/splash artwork and all UI code in this module are original. **"1:1" is the design goal, not a claim**: every behavior below is labeled with how it is supported (source-assisted, binary-evidence-assisted, or documentation-based), and the real Editor's runtime behavior was never execution-verified against this reconstruction.

| Area | Provenance | Notes |
|---|---|---|
| Hub window chrome, Inter typography, `#131313` background, frameless titlebar, min 1024×600 | **Source-assisted** — static analysis of `UnityHubSetup-x86_64.AppImage` (Unity Hub 3.22.3, Electron; ASAR SHA-256 `aae8a888…4e96cc6a`) | AppImage extracted via the AppImage runtime's extraction mode; never launched. Renderer `index.html`/CSS and main-process module inventory (3,297 files) analyzed with REA 6.5.0 |
| Hub routes `projects`, `installs`, `learn`, `new-project`, `templates`; feature channels (`projects/*`, `installs/*`, `templates/*`, `downloads/*`, `licenses/*`) | **Source-assisted** — same ASAR analysis | Feature names recovered from the renderer bundle; UI implementation is original |
| Editor workspace semantics | **Documentation-based** — Unity Manual | Scene view navigation incl. framing with F ([Scene view navigation](https://docs.unity3d.com/Manual/SceneViewNavigation.html)); Game view, Play/Pause/Step and "changes … are reset when you exit Play mode" ([Game view](https://docs.unity3d.com/Manual/GameView.html)); Hierarchy shortcuts ([Hierarchy](https://docs.unity3d.com/6000.0/Documentation/Manual/Hierarchy.html)); new scene named "Untitled" ([Creating scenes](https://docs.unity3d.com/Manual/CreatingScenes.html)) |
| Editor menu structure, item sets, shortcuts | **Binary-evidence-assisted** — static analysis of `UnityEditor.dll` from the official Unity 6000.0.64f1 Linux build (4.47 GB download, MD5 verified against Unity's manifest; SHA-256 of the DLL `c8dc708cea0582381bc13962e04769fb4edf1ecfd1a7b350cd93b4076ad2d689`) | Strings recovered include `GameObject/Move To View`, `GameObject/Align With View`, `GameObject/Create Empty Child`, `Window/Layouts...`, `Component/Add...`, and shortcut IDs for Edit/Copy\|Cut\|Delete\|Duplicate. Strings are leads for menu paths, not proof of runtime behavior — no Unity code or binaries are redistributed |
| Editor dark theme colors | Unity Foundations color palette | Toolbar button `#383838`, window tab `#353535`, inspector titlebar `#3E3E3E`, default control `#282828`, highlight `#2C5D87` ([Unity Foundations](https://www.foundations.unity.com/fundamentals/color-palette)) |
| Editor console typeface | Unity 6 build | Unity 6 ships Roboto Mono; this clone approximates it with the Roboto Mono web font (OFL) |
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
| Menu bar: File (8) / Edit (6) / Assets (3) / GameObject (12) / Component (2) / Window (4) / Help (3) with Unity shortcut labels | UnityEditor.dll strings + Unity Manual | Implemented subset — the recovered strings show these paths exist in Unity; they do not establish Unity's complete item sets. Verified: each menu opens with the implemented item set |
| Create Empty (Ctrl+Shift+N) | Unity Manual (Hierarchy) | Verified: object appears in Hierarchy and Scene; new object at scene pivot until first view interaction, then view pivot |
| Create Empty Parent (Ctrl+Shift+G) | Unity Manual (Hierarchy) | Partial: creates an empty GameObject at the selected object's position, but does not actually parent objects (Hierarchy parenting is unimplemented) — real Unity parents the selection under the new object |
| GameObject ▶ Move To View / Align With View | UnityEditor.dll strings | Implemented: moves/aligns selected object to the view pivot |
| Full play-mode state restore: position, color, name, attached script, object set all revert on Stop | Unity Manual (Game view: "changes are reset when you exit Play mode") | Verified: mutated name/color/position/script plus a created object and a deleted object all restored; Pause frozen (two equal readings) |
| Cast/receive shadows, camera near-clip persist through save/reload | Design choice (standard Unity properties) | Verified round-trip via both the Inspector UI and the model: castShadow off + near 0.42 restored after page reload (localhost, working localStorage). Scope note: in the deployed preview the iframe blocks localStorage, so the in-memory fallback keeps scenes only for the session — save/load across reloads is not available there |
| New scene titled "Untitled" | Unity Manual (Creating scenes) | Implemented |

Not implemented: physics/colliders (checkbox only), multi-scene, asset import, C# compilation (script components are built-in JS behaviors), Hierarchy parenting (so Create Empty Parent is partial), Preferences. The real Editor's runtime behavior was not execution-verified (static analysis only) — parity with Unity documentation is the working standard.

Unity® is a trademark of Unity Technologies — this project is not affiliated with or endorsed by them. For the real editor, download it from https://unity.com/download.

## Run

Static site — serve the repo root (`python -m http.server`) or open via GitHub Pages, then launch the UnityCraft card. Requires an up-to-date desktop browser (WebGL + ES modules).
