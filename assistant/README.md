# ArtCraft Chat

A hybrid assistant shared by all 13 Craft apps. Offline, it combines two small neural classifiers trained from random weights with curated workflow advice and fixed starter-file templates. Optional Online AI connects to OpenAI for broader conversation and web research, and can call a small allowlist of local skills. It still cannot control an open editor or run terminal commands.

## What works

- **Chat tab:** a standalone chat at `assistant/`, plus a 44px circular launcher in each editor. The panel starts compact, can expand or minimize, and retains the conversation and pending attachments while minimized. The selector automatically follows the editor where the panel was opened. Escape from the message field also minimizes the panel.
- **Local memory:** off by default. Turn it on with the Memory control, then explicitly ask the assistant to “remember that …” or “remember my …”. It stores only those notes and the last Craft in this browser's `localStorage`, not chat transcripts, files or model weights. “What do you remember?”, “forget [phrase]” and “forget everything” manage the saved notes. The Memory panel also shows the saved-note count and has a clear-all control. It does not sync between browsers or devices.
- **Online AI and skills:** optional, off by default. Enter your own OpenAI API key in Online AI settings to use the Responses API, with optional provider web search and clickable citations. The model can call only local `get_craft_guidance` and `make_starter` tools; file checks remain local browser actions. This is not editor control or a general command runner.
- **Action trace:** each reply keeps its actual browser, network and skill calls under a compact “Show task steps” disclosure, collapsed by default. Expand it to inspect request routing, file checks, image recognition, web search, API requests and starter generation. These are not terminal shell commands; no arbitrary command execution is available.
- **All Crafts:** getting-started guidance, export guidance, loading troubleshooting, and a starter artifact for each app.
- **Neural network:** NumPy implementation of token counts, L2-normalised inputs, a 40-unit tanh hidden layer, softmax output, cross-entropy, manual backpropagation and Adam. One network routes 13 Crafts and a second routes seven request types, including small talk. Browser inference is plain JavaScript with no external libraries.
- **Training:** `model.json` is the actual trained checkpoint, not a placeholder. The current checkpoint uses 1,000 epochs, 641 Craft training examples and 252 request examples; it records the seed, timestamp and held-out routing checks. The 104/104 Craft and 57/57 request checks are curated development smoke tests, not independent evidence of conversational intelligence or broad generalisation.
- **Offline use:** once this assistant URL has been opened and its service worker installed successfully, its local scripts, catalog and model are cached. Reload once while connected. The chat can then reopen offline on the same origin, provided the browser has not evicted its cache. This does not download all editor WebAssembly bundles or make the entire suite offline.
- **Privacy:** chat text and the last 12 turns stay in tab memory and clear on reload or New chat; attachments are not sent to online chat. Optional local memory is disabled until enabled and saves only explicit notes and the last Craft. The app does not collect chats or use them to train its local router. When Online AI is enabled, the current message, selected Craft and recent text are sent to OpenAI; if a local guidance/starter skill is used, its result (curated guidance text or starter metadata) is also sent in a follow-up request. File contents, attachments, local memory and editor state are not sent. `store:false` is requested, but provider data policies apply. The API key is held in page memory only and is not persisted, but any script on this public page can access it. A server-side proxy is safer; if using BYOK, use a restricted, low-limit key and revoke it if exposed. API usage may cost extra. Local image recognition stays in-browser.

## Local file attachments

Use **Attach files** or drop files into the chat panel, then press **Send**. Sending files without a message is supported. Files remain in the chat, not in the editor's project. A pending file can be removed before sending; New chat clears all attachments and previews.

- **Limits:** up to three pending files at once, 10 MB per file, with readable text limited to 1 MB and UTF-8. Raster image previews are limited to 25 megapixels.
- **Text and code:** bounded plain-text previews and word/line/character counts. HTML and SVG source are displayed as text, never executed or inserted as page markup.
- **CSV and TSV:** data-row count, column count, header preview, inconsistent-field checks and quoted-field validation. Spreadsheet formulas are never evaluated.
- **JSON:** syntax validation, top-level type and item/key counts. This is not schema validation.
- **Raster images:** local PNG/JPEG/WebP/GIF preview, dimensions, and on-device recognition: an attached image is classified by a small CLIP vision model that runs in your browser. The assistant’s scripts and inference runtime (WASM) are served from this site; the first analysis downloads about 155 MB of model files, which the browser caches and may re-download if it evicts them. It recognises the kind of image (photo, logo, screenshot, scan, diagram…) and points to the matching Craft; it does not produce free-form descriptions, read text, or identify people.
- **Audio:** local playback controls, subject to browser codec support. No transcription or content analysis.
- **PDF, Office, video and native projects:** filename and size only. Their document contents are not parsed.

File inspection is deterministic for text and data files; attached images additionally get local neural recognition as described above. The assistant does not rewrite arbitrary documents, produce free-form image descriptions, or import files into the WebAssembly editor. Use that editor's own open/import control where supported. File operations do not upload anything or add it to the training corpus.

## Starter artifacts

These use deterministic templates selected by the request router. They are useful starting points, not custom neural-generated finished work. The brief labels the template where applicable; this implementation does not fully interpret arbitrary specifications. Relevant explicit memory can be included in Markdown, SVG metadata and DXF comments; other fixed formats do not automatically apply saved preferences.

| Craft | Starter | Scope |
|---|---|---|
| VectorCraft | SVG | Simple editable logo asset |
| PhotoCraft | Markdown | Photo editing checklist |
| FilmCraft | SRT | Two placeholder caption cues; timing must be edited |
| LightCraft | Markdown | RAW workflow checklist |
| PdfCraft | Markdown | Review checklist, not a PDF edit |
| DesignCraft | SVG | Starter cover graphic, not a native layout |
| EffectCraft | SVG | Title graphic asset, not an animated native composition |
| GridCraft | CSV | Small sample budget with literal totals, not formulas |
| WordCraft | Markdown | Report outline, not a finished document |
| DeckCraft | Markdown | Five-slide outline, not a PPTX |
| CADCraft | DXF | 100 by 60 drawing-unit rectangle; verify units before use |
| SoundCraft | WAV | One-second, low-level 440 Hz mono test tone, not music |
| FigCraft | SVG | Static mobile wireframe asset, not a prototype |

Import support differs across the bundled browser versions. Markdown checklists are meant to be read/copied; not every editor can import every starter. The browser apps are prebuilt upstream bundles and this assistant does not inspect, change or control their project state.

## What “perform a task” means here

The assistant can perform its supported operations: inspect permitted attachments locally, classify a request, read curated Craft guidance, search the public web when enabled, and prepare a fixed starter download. Each response has a collapsed “Show task steps” trace of the calls it ran. It does not open or edit the current Craft document, run operating-system shell commands, install software, or execute arbitrary code. The editor folders contain upstream prebuilt WebAssembly bundles rather than source-level automation adapters. Real editor automation would require supported APIs or command adapters from those upstream apps, a reviewed allowlist of actions, previews and confirmation before changes.

Offline, the assistant is not a general-purpose LLM: the local model improves Craft/request routing only, not factual knowledge or general reasoning. Online chat supplies broader language ability through the user's own provider account. This static GitHub Pages app cannot keep a provider key secret; the BYOK setting only holds it in the open page's memory and sends it directly to OpenAI. A protected server-side proxy is preferable for production. Opt-in local memory can personalize a few supported templates, but it does not change model weights.

## Run locally

From the repository root:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/assistant/`. Use a local server rather than opening `index.html` as a `file://` URL because ES modules and service workers need an HTTP origin. Offline guidance and templates work after the repository and dependencies are downloaded; optional Online AI requires internet access and the user's OpenAI API key.

## Develop in a codespace

The repository ships a ready-made cloud development environment, so you (or an AI coding agent) get a shell with everything preinstalled instead of a bare editor:

- **GitHub Codespaces / VS Code Dev Containers:** `.devcontainer/devcontainer.json` provides Node 22, Python 3.12 and the training dependencies (`postCreateCommand` installs `assistant/training/requirements.txt`), forwards port 8000 for the site and sets the thread-pinning environment variables the trainer expects. Open the repo in a codespace and run `npm run serve`, `npm test` or the training command below. Predefined tasks live in `.vscode/tasks.json` (“Serve ArtCraft Live”, “Test assistant”, “Retrain assistant model”).
- **AI coding agents:** repository conventions an agent must follow (what it may and may not change, the checkpoint rules, the assistant DOM contract) are documented in `.github/copilot-instructions.md`, which GitHub Copilot coding agents read automatically.

## Train from scratch

Python and NumPy are needed only for training, not browser inference. Initial dependency installation needs internet unless you already have the wheels:

```sh
python -m venv .venv
.venv/bin/pip install -r assistant/training/requirements.txt
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 .venv/bin/python assistant/training/train.py
npm test
```

Training uses the local `catalog.json` (default: 1,000 full-dataset epochs; override with `--epochs N`). The current checkpoint was trained from 641 Craft and 252 request examples. A candidate must pass every held-out check for every Craft and intent label; rejected candidates never replace the working checkpoint. Acceptance of these narrow checks does not establish safety or broad task competence; review changed answers and templates separately.

## Always-on worker

GitHub Pages only serves the files in this repository. The Python worker must run on your own always-on Linux PC, server or other persistent host. No paid infrastructure is provisioned here, no 24/7 service is currently activated for you, and nothing keeps training after this sandbox ends.

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 .venv/bin/python \
  assistant/training/train.py --watch --interval 3600
```

The worker checks for approved-data changes hourly and sleeps if nothing changed. Repeating the same tiny corpus continuously is not useful improvement. It trains a candidate when the input changes, checks every regression label and atomically replaces `assistant/model.json` only after a pass. It holds a process lock to prevent duplicate watch workers. It does not deploy models or push commits.

For a user-level systemd service, the supplied unit assumes a checkout at `~/artcraft-live`:

```sh
mkdir -p ~/.config/systemd/user
cp assistant/training/artcraft-trainer.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now artcraft-trainer
systemctl --user status artcraft-trainer
journalctl --user -u artcraft-trainer -f
```

For operation after logout, a system administrator may need to enable user lingering. Adapt paths before installing. Keep this service in a private local checkout because reviewed training examples may contain sensitive material. To stop: `systemctl --user disable --now artcraft-trainer`. The trainer needs no network connection after dependencies are installed; these settings do not constitute a network sandbox.

To update the public site with an accepted model, review it locally, run the tests, then explicitly publish the changed `assistant/model.json`. Merely training on a private host does not update GitHub Pages.

## Add reviewed training data

Create the ignored file `assistant/training/local-approved.jsonl`, one reviewed example per line:

```json
{"head":"intent","text":"make a reusable blank template","label":"create","approved":true}
{"head":"craft","text":"I am arranging spreadsheet cells","label":"gridcraft","approved":true}
```

Only use data you have the rights and permission to use. Remove personal information; a trained network is not a privacy guarantee. Inspect every example and label. Do not scrape or add conversations automatically. Valid intent labels are `greeting`, `smalltalk`, `help`, `create`, `export`, `troubleshoot`, and `training`; Craft labels are the lowercase folder names. These examples improve offline routing only, not factual knowledge or general reasoning.

## Remaining work

A fluent, general conversational model trained from scratch needs a much larger licensed corpus, tokenizer, language-model architecture, compute, evaluation and safety work. This repository does not provide that capability. Autonomous editing also needs verified per-editor command adapters, permission boundaries, previews and confirmation before modifying projects. Neither should be inferred from this routing prototype.

## Provenance

The craft summaries are derived from the documentation already bundled in this repository, with conservative workflow guidance. Each craft-specific help reply links to its bundled README on GitHub. Those READMEs may discuss native or newer upstream features that are absent from the mirrored web build. Existing upstream licenses and notices are retained; assistant changes do not modify generated JavaScript or WebAssembly. EffectCraft's official source tag and web-build provenance are recorded in [`../effectcraft/UPSTREAM.md`](../effectcraft/UPSTREAM.md).
