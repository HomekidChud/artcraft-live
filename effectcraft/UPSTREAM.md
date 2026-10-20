# EffectCraft upstream source and recovery

## Source and release

- Official source repository: [storytold/effectcraft](https://github.com/storytold/effectcraft)
- Source tag used for this mirror: [`v0.11.1`](https://github.com/storytold/effectcraft/tree/v0.11.1), commit `2a01226894c6bc58ae4fadcc24a10198d693acaa`
- Official browser package: [`effectcraft-web-0.11.1.zip`](https://github.com/storytold/effectcraft/releases/download/v0.11.1/effectcraft-web-0.11.1.zip)
- Release-package SHA-256: `8675e595d876408ce23d868d8530f17466029650da727d742028484cbde8a207`

The core mirrored runtime files `effectcraft_web.js`, `effectcraft_web_bg.wasm`, `worker.js`, and `audio-worklet.js` were compared with the checksum-verified v0.11.1 package and are byte-for-byte identical. The app JS and WebAssembly were not changed or needlessly replaced. The local `sw.js` cache version has a `-local-recovery2` suffix so returning offline installs fetch the updated `index.html`; the app's entry page also contains local recovery UI. A source archive can be built from the tagged upstream checkout with `git archive`; web development builds use `cargo xtask web` and the upstream Rust 1.95 toolchain requirement.

## Startup recovery

The upstream [web hosting guide](https://github.com/storytold/effectcraft/blob/v0.11.1/packaging/web/README.md) documents renderer selection with `?webgl` (force WebGL2) and `?cpu` (CPU fallback, slower). The app normally chooses WebGPU when available and falls back to WebGL2. It requires `.wasm` to be served as `application/wasm`; it does not require COOP/COEP isolation headers.

The repository's `index.html` adds recovery links that appear only after a long load or a startup error. Technical stack details are collapsed unless opened. The assistant can also offer WebGL2 and CPU links when the user reports an EffectCraft loading problem.

### Automatic renderer fallback (local change)

Because a web build can run on browsers or machines with no usable GPU, the entry page now selects the renderer automatically before the application starts:

1. If the visitor set `?webgl` or `?cpu` explicitly, that choice is never overridden.
2. Otherwise the page probes for a WebGPU adapter (4-second timeout) and, if none, for a working WebGL2 context. When the browser has neither, the page rewrites its own URL to `?cpu` via `history.replaceState` before the app initializes, so the CPU path starts instead of the upstream "no renderer available" message.
3. If startup still fails, the page retries automatically once with `?webgl` and then once with `?cpu` (guarded by `sessionStorage` so a genuine failure cannot loop), and only then shows the manual recovery controls with the technical details.

The application JavaScript and WebAssembly are untouched; the module import is only awaited after the probe so the renderer flags are read after any URL rewrite.

## Verification

On 19 October 2026, the live GitHub Pages copy returned the WebAssembly asset with HTTP 200 and `Content-Type: application/wasm`. In the sandbox Chromium test, EffectCraft loaded successfully in about 2.9 seconds with WebGPU available and `crossOriginIsolated` false. This confirms that the current deployment loads in that test browser; it does not establish compatibility with every device or GPU. If it remains stuck on another device, use the recovery options and share the first console error.

Sources: [upstream README](https://github.com/storytold/effectcraft/blob/v0.11.1/README.md), [web hosting guide](https://github.com/storytold/effectcraft/blob/v0.11.1/packaging/web/README.md), [v0.11.1 release](https://github.com/storytold/effectcraft/releases/tag/v0.11.1).
