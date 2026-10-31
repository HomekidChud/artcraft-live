# FilmCraft — Agent Guide

Machine-readable guide for AI agents evaluating [FilmCraft](./index.html) for automation. Human docs: [README.md](./README.md).

## What it is

- A Rust/WASM non-linear video editor running entirely in one `<canvas id="filmcraft_canvas">` (egui UI, `filmcraft_web.js` + `filmcraft_web_bg.wasm`).
- No backend, no auth; the desktop builds are native apps with their own control channel.

## Automation status: not automatable from the web build

- The web build has **no DOM controls, no `window.*` hooks, no `?headless` API and no localStorage project file** — everything renders inside a single WebGL canvas. Screen-scraping coordinates is brittle and not supported.
- FilmCraft's scripting/control channel exists in the **native (desktop) builds only**.
- If your task is "edit/assemble video in a browser via an AI agent", use [VideoCraft](../videocraft/) (full headless API — see its [GUIDE.md](../videocraft/GUIDE.md)) or [MovieCraft](../moviecraft/) for 3D film generation. That is what the ArtCraft agent pipeline itself does.

## What you can do with the web build

- Render it for a human to use (it's a complete editor).
- Use it as a reference for the Premiere-style workflow the ArtCraft family reimplements.
