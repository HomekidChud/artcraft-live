# ArtCraft Live

Live, in-browser versions of the [ArtCraft](https://github.com/storytold) "Crafting Apps" — open-source creative and office applications written in pure Rust, compiled to WebAssembly.

Hosted on GitHub Pages, one path per app:

| App | What it is | Live URL |
|---|---|---|
| VectorCraft | Vector illustration (Illustrator alternative) | [/vectorcraft/](https://homekidchud.github.io/artcraft-live/vectorcraft/) |
| PhotoCraft | Photo editor (Photoshop alternative) | [/photocraft/](https://homekidchud.github.io/artcraft-live/photocraft/) |
| FilmCraft | Nonlinear video editor | [/filmcraft/](https://homekidchud.github.io/artcraft-live/filmcraft/) |
| LightCraft | Non-destructive photo editor | [/lightcraft/](https://homekidchud.github.io/artcraft-live/lightcraft/) |
| PdfCraft | PDF reader and editor | [/pdfcraft/](https://homekidchud.github.io/artcraft-live/pdfcraft/) |
| DesignCraft | Page and layout design | [/designcraft/](https://homekidchud.github.io/artcraft-live/designcraft/) |
| EffectCraft | Motion graphics and compositing | [/effectcraft/](https://homekidchud.github.io/artcraft-live/effectcraft/) |
| GridCraft | Spreadsheet (Excel-style) | [/gridcraft/](https://homekidchud.github.io/artcraft-live/gridcraft/) |
| WordCraft | Word processor | [/wordcraft/](https://homekidchud.github.io/artcraft-live/wordcraft/) |
| DeckCraft | Presentations | [/deckcraft/](https://homekidchud.github.io/artcraft-live/deckcraft/) |
| CADCraft | CAD and drafting | [/cadcraft/](https://homekidchud.github.io/artcraft-live/cadcraft/) |
| SoundCraft | Audio production (Pro Tools style) | [/soundcraft/](https://homekidchud.github.io/artcraft-live/soundcraft/) |
| FigCraft | Interface design and prototyping | [/figcraft/](https://homekidchud.github.io/artcraft-live/figcraft/) |

Each app folder at the repository root comes from the official `*-web-<version>.zip` static bundle from that app's GitHub release. The generated application assets are preserved; the HTML entrypoints include the shared chat overlay described below. **DeckCraft is pinned to v0.7.0** because the v0.8.0 web bundle stalled on its loading screen in the test browser (2026-10-18), while v0.7.0 reached the editor. All apps use relative URLs, so they work at these subpaths. (Note: [AniCraft](https://github.com/storytold/AniCraft) has no release yet, and support projects like `artcraft`, `craft-libs` and `craft-fonts` are libraries rather than apps, so they are not hosted here.)

EffectCraft's core runtime files were checked against the latest official [v0.11.1 release](https://github.com/storytold/effectcraft/releases/tag/v0.11.1) and match it byte-for-byte. Its [upstream source](https://github.com/storytold/effectcraft/tree/v0.11.1) and renderer troubleshooting details are documented in [`effectcraft/UPSTREAM.md`](effectcraft/UPSTREAM.md). The local page offers WebGL2/CPU recovery if startup is slow or fails, and its service-worker cache version is bumped so returning installs receive that entry-page change; the application JS and WebAssembly remain untouched.

## Local chat assistant

Open [`assistant/`](assistant/) or use **Chat with ArtCraft** in any editor. The assistant uses two small neural classifiers trained from scratch, curated Craft guidance and downloadable starter templates. It now supports opt-in browser-local memory for explicit notes and shows the local actions run for each reply. It is not a general-purpose language model and cannot control the editors or run terminal commands. The chat can be cached for offline use; optional reviewed-data retraining runs on your own always-on host, not GitHub Pages. See the [assistant setup and limitations](assistant/README.md).

The original generated application bundles are preserved. HTML entrypoints load the isolated chat overlay; EffectCraft's entrypoint adds nonintrusive WebGL2/CPU recovery controls. The EffectCraft service-worker version is bumped only to refresh the changed entry page; application JavaScript, WebAssembly and upstream licenses are unchanged.

## Credits

All applications are built by the [ArtCraft team / storytold](https://github.com/storytold) and dual-licensed under MIT or Apache-2.0. This repository only mirrors their prebuilt web bundles for easy browser access. Upstream sources: [vectorcraft](https://github.com/storytold/vectorcraft), [photocraft](https://github.com/storytold/photocraft), [pdfcraft](https://github.com/storytold/pdfcraft), [filmcraft](https://github.com/storytold/filmcraft), [lightcraft](https://github.com/storytold/lightcraft), [designcraft](https://github.com/storytold/designcraft), [effectcraft](https://github.com/storytold/effectcraft), [gridcraft](https://github.com/storytold/gridcraft), [wordcraft](https://github.com/storytold/wordcraft), [deckcraft](https://github.com/storytold/deckcraft), [cadcraft](https://github.com/storytold/cadcraft), [soundcraft](https://github.com/storytold/soundcraft), [figcraft](https://github.com/storytold/figcraft).

## Updating

Re-download each app's `-web-<version>.zip` from its latest GitHub release and replace the matching app folder at the repository root (contents only, no versioned subfolder).
