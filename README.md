# ArtCraft Live

Live, in-browser versions of the [ArtCraft](https://github.com/storytold) "Crafting Apps" — open-source creative and office applications written in pure Rust, compiled to WebAssembly.

Hosted on GitHub Pages, one path per app:

| App | What it is | Live URL |
|---|---|---|
| ArtCraft Launcher | Crafting Apps hub (versions, status, downloads) | [/launcher/](https://homekidchud.github.io/artcraft-live/launcher/) |
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
| UnityCraft | Unity Hub + Editor-style 3D workspace reconstruction | [/unitycraft/](https://homekidchud.github.io/artcraft-live/unitycraft/) |
| RobloxCraft | Roblox player reconstruction (launcher + playable world) | [/robloxcraft/](https://homekidchud.github.io/artcraft-live/robloxcraft/) |
| VideoCraft | Movie studio: draw, build 3D scenes, animate multi-shot films with camera moves, audio and video export | [/videocraft/](https://homekidchud.github.io/artcraft-live/videocraft/) |
| PlaneCraft | Plane project-management reconstruction (work items, cycles, modules, views, pages) | [/planecraft/](https://homekidchud.github.io/artcraft-live/planecraft/) |
| EditCraft | Full text editor with a Claude AI panel (rich text, Markdown, code, find & replace, snippets, sandboxes, agent teams) | [/editcraft/](https://homekidchud.github.io/artcraft-live/editcraft/) |
| AirplaneCraft | Owner-supplied flight simulator — workshop airframe builder and open-world flying (v17.2) | [/airplanecraft/](https://homekidchud.github.io/artcraft-live/airplanecraft/) |

Each app folder at the repository root comes from the official `*-web-<version>.zip` static bundle from that app's GitHub release. The generated application assets are preserved; the HTML entrypoints include the shared chat overlay described below. DeckCraft was updated to v0.8.0 on 2026-10-20 after re-testing the web bundle in the sandbox browser. All apps use relative URLs, so they work at these subpaths. (Note: [AniCraft](https://github.com/storytold/AniCraft) has no release yet, and support projects like `artcraft`, `craft-libs` and `craft-fonts` are libraries rather than apps, so they are not hosted here.)

EffectCraft's core runtime files were checked against the latest official [v0.11.1 release](https://github.com/storytold/effectcraft/releases/tag/v0.11.1) and match it byte-for-byte. Its [upstream source](https://github.com/storytold/effectcraft/tree/v0.11.1) and renderer details are documented in [`effectcraft/UPSTREAM.md`](effectcraft/UPSTREAM.md). EffectCraft's canvas needs a WebGPU or WebGL2 context (there is no CPU canvas path in v0.11.1); the app already falls back from WebGPU to WebGL2 on its own and composites on the CPU when only WebGL2 exists, so it runs in WebGL2-class browsers — including machines where WebGL2 is software-implemented — but a browser with neither context cannot run it at all. The local entry page adds an upfront capability probe: on a browser with neither WebGPU nor WebGL2 it skips the ~63 MB download and explains the requirement immediately (with a reload link) instead of failing after the download; a startup failure with a GPU present shows the error with a reload link. The probe also **exercises WebGPU with a real device and a tiny workload before the app starts**: on machines where WebGPU exists but fails right away (adapter/device errors, validation errors, or a device that reports loss during the startup check), it hides `navigator.gpu` so the app's own fallback starts it on WebGL2 instead of dying after startup. This catches failures that are present at startup; a GPU that dies later in a session is still handled by the app's own Save Project / Reload recovery, and `?webgl2` in the URL forces the WebGL2 path manually (it also covers the case where the startup check passes but the device is unstable mid-session). Its service-worker cache version is bumped so returning installs receive the entry-page change; the application JS and WebAssembly remain untouched.

FigCraft needs WebGPU or WebGL2 too (see its `HOSTING.md`), and on the same broken-WebGPU machines it used to hang forever on "Loading FigCraft…". Its entry page now runs the same pre-flight: it tests WebGPU with a real device and a tiny workload, hides `navigator.gpu` when the check fails so the app falls back to WebGL2, explains immediately on browsers with neither context (the ~22 MB wasm download is only requested once a usable context is confirmed), and supports the same manual `?webgl2` override. The generated application JavaScript and WebAssembly are untouched.

## Page inspector (Ctrl+Shift+I)

Every app in the suite ships a shared in-page inspector ([`inspector/inspector.js`](inspector/inspector.js)) — a DevTools-style panel with an **Elements** tab (lazily expandable DOM tree, click/hover picking with a box-model highlight, breadcrumbs, editable styles/attributes/text, matched rules, searchable computed properties), a **Console** tab (captured messages plus command evaluation) and a **Network** tab (fetch/XHR requests actually observed by the page, clearly labeled as such). Open it with **Ctrl+Shift+I** (best-effort — some browsers reserve that shortcut for their own DevTools; a floating button at the bottom-right of every app always works) or close it with **Escape**. It is honest about its limits: it is an in-page DOM inspector, so it cannot read the browser's network stack or cross-origin stylesheet rules (those are labeled, not faked), and objects drawn inside a `<canvas>` are not DOM — 3D scenes are inspected with the apps' own tools (RobloxCraft's services panel). Editable apps load it directly; generated craft bundles get it injected by the chat-widget script, which stays byte-preserved in its DOM contract.

## Local chat assistant

Open [`assistant/`](assistant/) or use **Chat with ArtCraft** in any editor. Offline, the assistant uses two small neural classifiers trained from scratch, curated Craft guidance and downloadable starter templates; it now handles ordinary small talk more naturally. Optional Online AI connects to **OpenAI or Claude (Anthropic)** — pick a provider in the connection dialog — for broader conversation, web search with citations (OpenAI), public page-text reading through the browser tool (Claude), and user-requested **agent teams** (say “use 4 agents…”; each agent is a separate paid call on your own key). It still cannot control editors or run terminal commands. Online mode requires the user's own API key; this static GitHub Pages site cannot keep that key secret, so a protected server-side proxy is safer. Attachments, local memory and editor contents are not sent, but the message, selected Craft, recent turns and results from local skills (such as guidance text or starter metadata) may be sent to the provider. The chat can be cached for offline use; reviewed-data retraining uses synthetic/approved examples, not conversation logs. See the [assistant setup and limitations](assistant/README.md).

The original generated application bundles are preserved. HTML entrypoints load the isolated chat overlay; EffectCraft's entrypoint probes for WebGPU/WebGL2 up front and gives browsers with neither a clear explanation instead of a failed download. The EffectCraft service-worker version is bumped only to refresh the changed entry page; application JavaScript, WebAssembly and upstream licenses are unchanged. EditCraft, like UnityCraft, RobloxCraft and PlaneCraft, is built directly in this repository (see [`editcraft/README.md`](editcraft/README.md)).

### Development environment

The repo includes a one-click [devcontainer](.devcontainer/devcontainer.json) for GitHub Codespaces and VS Code Dev Containers: Node 22, Python 3.12 and the assistant training dependencies are preinstalled, port 8000 is forwarded for `npm run serve`, and assistant tasks (serve, test, retrain) are predefined in `.vscode/tasks.json`. [.github/copilot-instructions.md](.github/copilot-instructions.md) documents the repository rules an AI agent must follow (never touch generated editor bundles, keep `catalog.json`/`model.json` in sync, preserve the assistant DOM contract).

## Reconstructions: UnityCraft, RobloxCraft and PlaneCraft

Unlike the mirrored Craft apps above, **UnityCraft**, **RobloxCraft** and **PlaneCraft** were built directly in this repository — browser reconstructions of the official Unity and Roblox desktop clients and the Plane project-management platform, produced by static analysis and documentation study (never executing proprietary clients). No proprietary code, assets, fonts, or trademarks from any target are bundled; all artwork is original and independently implemented.

- **UnityCraft** ([README](unitycraft/README.md)) — a Unity Hub-style project launcher plus a Unity Editor-style 3D workspace: scene view, hierarchy, inspector, play mode, and console. Built from analysis of the Unity Hub AppImage and the Unity Editor's assembly metadata.
- **RobloxCraft** ([README](robloxcraft/README.md)) — a Roblox player reconstruction: discovery launcher, topbar, chat with recovered official UI strings, People leaderboard, health bar, Esc menu, and two playable stand-in worlds with a blocky R6-style avatar. Built from the official Roblox Windows Player packages (MD5-verified against the official manifest).
- **PlaneCraft** ([README](planecraft/README.md)) — a Plane reconstruction: work items with List/Board/Calendar layouts, cycles, modules, saved views, pages and analytics in a local-first static app. Built from Plane's open-source documentation (Plane is AGPL-3.0; no Plane code is redistributed).

All three are labeled, self-contained static apps — they do not run real Unity projects, real Roblox experiences or a real Plane workspace. Each app's README carries the full provenance and behavior ledger.

## Credits

All applications are built by the [ArtCraft team / storytold](https://github.com/storytold) and dual-licensed under MIT or Apache-2.0. This repository only mirrors their prebuilt web bundles for easy browser access. Upstream sources: [vectorcraft](https://github.com/storytold/vectorcraft), [photocraft](https://github.com/storytold/photocraft), [pdfcraft](https://github.com/storytold/pdfcraft), [filmcraft](https://github.com/storytold/filmcraft), [lightcraft](https://github.com/storytold/lightcraft), [designcraft](https://github.com/storytold/designcraft), [effectcraft](https://github.com/storytold/effectcraft), [gridcraft](https://github.com/storytold/gridcraft), [wordcraft](https://github.com/storytold/wordcraft), [deckcraft](https://github.com/storytold/deckcraft), [cadcraft](https://github.com/storytold/cadcraft), [soundcraft](https://github.com/storytold/soundcraft), [figcraft](https://github.com/storytold/figcraft), [craft-launcher](https://github.com/storytold/craft-launcher).

## Updating

Re-download each app's `-web-<version>.zip` from its latest GitHub release and replace the matching app folder at the repository root (contents only, no versioned subfolder).
