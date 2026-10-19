# UnityCraft

A browser reconstruction of the **Unity Hub** launcher and a **Unity Editor**-style 3D workspace — the UnityCraft take on "Unity in the browser".

- **Hub** — dark launcher with Projects / Installs / Learn / Community / Preferences, a New Project flow with templates and editor-version selection, and the Hub's spinning-logo splash screen.
- **Editor** — Three.js scene view with grid and gizmos, Hierarchy, Inspector (Transform / Mesh Renderer / Box Collider / Light / Camera), GameObject creation menu, undo/redo, save/load scenes (localStorage), Console, and a real **Play mode** where attached scripts (Spin.cs, Bob.cs) animate objects and the scene state is restored on Stop — like Unity.

## Provenance

This is a clean-room reconstruction, not a port of Unity code. Evidence base:

| Area | Provenance | Notes |
|---|---|---|
| Hub window chrome, splash logo + CSS animation, Inter font, `#131313` background, frameless titlebar, min 1024×600 | **Source-assisted** — static analysis of `UnityHubSetup-x86_64.AppImage` (Unity Hub 3.22.3, Electron; ASAR SHA-256 `aae8a888…4e96cc6a`) | Extracted renderer `index.html`/CSS and main-process module inventory (3,297 files) via REA 6.5.0 |
| Hub routes `projects`, `installs`, `learn`, `new-project`, `templates`; feature channels (`projects/*`, `installs/*`, `templates/*`, `downloads/*`, `licenses/*`) | **Source-assisted** — same ASAR analysis | See the analysis evidence in this session's REA output |
| Editor layout, panels, toolbar, Play mode semantics, tool shortcuts (Q/W/E/R/T, F, Ctrl+P), scene state restore on exit Play | **Documentation-based** — Unity Manual | https://docs.unity3d.com/Manual/UsingTheEditor.html , https://docs.unity3d.com/Manual/Toolbar.html , https://docs.unity3d.com/Manual/GameView.html |
| 3D rendering | Three.js (MIT) | https://threejs.org |

No Unity Technologies code, assets, or binaries are redistributed here. Unity® is a trademark of Unity Technologies — this project is not affiliated with or endorsed by them. For the real editor, download it from https://unity.com/download.

## Run

Static site — serve the repo root (`python -m http.server`) or open via GitHub Pages, then launch the UnityCraft card. Requires an up-to-date desktop browser (WebGL + ES modules).
