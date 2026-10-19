# Instructions for AI coding agents

This repository is a static GitHub Pages site. It mirrors prebuilt WebAssembly
bundles of the ArtCraft "Craft" apps (one folder per app) and adds a shared
chat assistant in `assistant/`.

## Environment

A devcontainer (`.devcontainer/`) provides your shell: Node 22, Python 3.12
and NumPy. Everything below runs in that shell.

## Commands

- Serve the site locally: `python -m http.server 8000 --bind 127.0.0.1`
  (or `npm run serve`), then open `http://127.0.0.1:8000/assistant/`.
  ES modules and service workers need an HTTP origin; `file://` will not work.
- JavaScript tests: `npm test`
- Python trainer tests: `python -m unittest discover -s assistant/tests -p 'test_*.py'`
- Retrain the router: `OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python assistant/training/train.py`

## Hard rules

1. **Never modify generated editor bundles.** Each Craft folder
   (`vectorcraft/`, `photocraft/`, …) is a byte-preserved upstream release.
   Do not edit its JavaScript, WebAssembly or assets. Entry `index.html`
   files carry the chat widget script tag and `data-craft` attribute; treat
   them as generated and keep both intact (tests count them).
2. **`assistant/catalog.json` and `assistant/model.json` change together.**
   `model.json` records the catalog's SHA-256 and the test suite enforces the
   match. After editing training data, always retrain with the default 1,000
   epochs in the same commit. A candidate that fails any per-label regression
   check is rejected automatically and never replaces the checkpoint.
3. **Training data is reviewed-only.** Add examples to `catalog.json` (or the
   ignored `assistant/training/local-approved.jsonl` with `"approved": true`).
   Never scrape chats or add conversation logs automatically. Valid intent
   labels: `greeting`, `smalltalk`, `help`, `create`, `export`,
   `troubleshoot`, `training`. Craft labels are the lowercase folder names.
4. **Keep the assistant honest.** The assistant cannot run terminal commands
   or control editors, and its copy, action traces and docs must keep saying
   so. Do not add claims of shell access, editor control or general LLM
   ability to offline mode.
5. **Preserve the DOM contract.** `assistant/app.js` drives the page by id
   and class. Renaming or removing these breaks the chat: `composer`,
   `message`, `send`, `attach`, `file-input`, `attachments`,
   `attachment-status`, `craft`, `memory-toggle`, `memory-clear`,
   `memory-info`, `online-toggle`, `online-dialog`, `online-form`,
   `online-model`, `online-key`, `online-search`, `online-consent`,
   `online-connect`, `online-disconnect`, `online-close`, `reset`, `status`,
   `messages`, `welcome`, `metrics`, `offline-status`, `connection-label`,
   `open-craft`, and the classes `context-bar`, `message`, `speaker`,
   `body`, `action-trace`, `download`, `note`, `file-card`, `file-name`,
   `attachment-chip`, `recovery-link(s)`, `source-list`,
   `suggestions [data-prompt]` (with `span.prompt-label` followed by a text
   node), plus `body.embedded` for the in-editor overlay.
6. **Bump the service-worker cache name** in `assistant/sw.js` whenever
   assistant entry files (`index.html`, `style.css`, scripts) change, so
   returning visitors pick up the new page.
7. **Accessibility is required.** Keep focus-visible styles, aria labels,
   keyboard flows (Enter sends, Shift+Enter newline, Escape minimizes the
   embedded panel) and `prefers-reduced-motion` support. Verify standalone
   and `?embed=1` layouts at desktop and 375px widths.

## Definition of done for assistant changes

- `npm test` passes (includes browser-inference regression checks and
  checkpoint/catalog hash matching).
- `python -m unittest discover -s assistant/tests -p 'test_*.py'` passes.
- If training data changed: the trainer reports `accepted: true` and
  `assistant/README.md` example/check counts are updated to match the
  trainer output.
