# EffectCraft upstream source and recovery

## Source and release

- Official source repository: [storytold/effectcraft](https://github.com/storytold/effectcraft)
- Source tag used for this mirror: [`v0.11.1`](https://github.com/storytold/effectcraft/tree/v0.11.1), commit `2a01226894c6bc58ae4fadcc24a10198d693acaa`
- Official browser package: [`effectcraft-web-0.11.1.zip`](https://github.com/storytold/effectcraft/releases/download/v0.11.1/effectcraft-web-0.11.1.zip)
- Release-package SHA-256: `8675e595d876408ce23d868d8530f17466029650da727d742028484cbde8a207`

The core mirrored runtime files `effectcraft_web.js`, `effectcraft_web_bg.wasm`, `worker.js`, and `audio-worklet.js` were compared with the checksum-verified v0.11.1 package and are byte-for-byte identical. The app JS and WebAssembly were not changed or needlessly replaced. The local `sw.js` cache version has a `-local-recovery3` suffix so returning offline installs fetch the updated `index.html`; the app's entry page also contains local recovery UI. A source archive can be built from the tagged upstream checkout with `git archive`; web development builds use `cargo xtask web` and the upstream Rust 1.95 toolchain requirement.

## Startup recovery

The upstream [web hosting guide](https://github.com/storytold/effectcraft/blob/v0.11.1/packaging/web/README.md) documents renderer selection with `?webgl` and `?cpu` flags; source inspection of v0.11.1 and current `main` shows those flags are not actually read by the app — renderer selection is entirely the framework's WebGPU → WebGL2 fallback. The app requires `.wasm` to be served as `application/wasm`; it does not require COOP/COEP isolation headers.

The repository's `index.html` adds recovery UI that appears after a long load or a startup error: a reload link and collapsed technical details. See "GPU handling" below for the upfront capability probe.

### GPU handling (local change)

EffectCraft's canvas requires WebGPU or WebGL2 — v0.11.1 has **no CPU canvas path**. Investigation of the v0.11.1 and current `main` source shows the app never reads the `?webgl`/`?cpu` flags documented in the upstream hosting README (empirically, `?cpu` still starts on the `BrowserWebGpu` backend), and the app already falls back WebGPU → WebGL2 on its own, rendering on the CPU internally when only WebGL2 exists. So browsers without WebGPU but with WebGL2 (including machines where WebGL2 is software-implemented) already run the app, though the canvas still requires a WebGL2 or WebGPU context — a browser with neither cannot run it at all.

What the local entry page adds for the remaining case — a browser with neither WebGPU nor WebGL2, where upstream fails after the full download with a raw wgpu surface error:

1. Before downloading the ~63 MB application, the page probes for a WebGPU adapter (4-second timeout that resolves to null, so no promise is left unhandled) and, if none, for a working WebGL2 context.
2. If the browser has neither, the page skips the download and startup entirely and explains immediately that EffectCraft needs WebGL2 or WebGPU, with a reload link in case the detection is wrong. Because the `?webgl`/`?cpu` flags are no-ops, they are not treated as choices: a bookmark containing them gets the same upfront explanation instead of a doomed download.
3. If startup fails with a GPU present, the page shows the error with a reload link and collapsible technical details.

The application JavaScript and WebAssembly are untouched; the module import only happens after the probe.

## Verification

On 19 October 2026, the live GitHub Pages copy returned the WebAssembly asset with HTTP 200 and `Content-Type: application/wasm`. In the sandbox Chromium test, EffectCraft loaded successfully in about 2.9 seconds with WebGPU available and `crossOriginIsolated` false. This confirms that the current deployment loads in that test browser; it does not establish compatibility with every device or GPU. If it remains stuck on another device, use the recovery options and share the first console error.

Sources: [upstream README](https://github.com/storytold/effectcraft/blob/v0.11.1/README.md), [web hosting guide](https://github.com/storytold/effectcraft/blob/v0.11.1/packaging/web/README.md), [v0.11.1 release](https://github.com/storytold/effectcraft/releases/tag/v0.11.1).

On 20 October 2026, after deploying the capability probe, the live page was re-verified with capability overrides injected before any page script ran:

- No WebGPU and no WebGL2: the page skipped the ~63 MB download and showed the explanation with a reload link (no application load attempted).
- No WebGPU with WebGL2: the app started normally on the GL backend in about 2.9 seconds; the probe did not interfere.
- Full GPU: the app started normally in about 0.5 seconds (cached).
- Explicit `?cpu` with no GPU: the choice was respected (no override); the application attempted to start, failed with the wgpu surface error, and the recovery UI showed the error with a reload link.

Also verified that day: `?cpu` with a GPU present starts on the `BrowserWebGpu` backend — the documented `?webgl`/`?cpu` flags are not implemented in v0.11.1. These checks confirm the entry-page behavior in that test browser; they do not establish compatibility with every device or GPU.

