# ArtCraft Chat

A small, fully local assistant shared by all 13 Craft apps. It combines two neural classifiers trained from random weights with curated workflow advice and fixed starter-file templates. It is not a pretrained foundation model, a generative LLM, or an autonomous editor agent.

## What works

- **Chat tab:** a standalone chat at `assistant/`, plus a 44px circular launcher in each editor. The panel starts compact, can expand or minimize, and retains the conversation and pending attachments while minimized. The selector automatically follows the editor where the panel was opened. Escape from the message field also minimizes the panel.
- **All Crafts:** getting-started guidance, export guidance, loading troubleshooting, and a starter artifact for each app.
- **Neural network:** NumPy implementation of token counts, L2-normalised inputs, a 40-unit tanh hidden layer, softmax output, cross-entropy, manual backpropagation and Adam. One network routes 13 Crafts and a second routes six supported request types. Browser inference is plain JavaScript with no external libraries.
- **Initial training:** `model.json` is the actual trained checkpoint, not a placeholder. It includes the seed, timestamp, epoch count and test results. The small curated regression checks are useful smoke tests, not independent evidence of conversational intelligence. Some examples were expanded after early checks failed; the reported checks are therefore development/regression checks, not an untouched benchmark.
- **Offline use:** once this assistant URL has been opened and its service worker installed successfully, its local scripts, catalog and model are cached. Reload once while connected. The chat can then reopen offline on the same origin, provided the browser has not evicted its cache. This does not download all editor WebAssembly bundles or make the entire suite offline.
- **Privacy:** messages and attached files stay in the open tab's memory. Reload and New chat clear them; minimizing does not. No chat collection, analytics, automatic uploads, self-training from users, remote model calls or API keys. Image recognition runs in your browser; images never leave your device.

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

These use deterministic templates selected by the request router. They are useful starting points, not custom neural-generated finished work. The brief labels the template where applicable; this implementation does not fully interpret arbitrary specifications.

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

## Run locally

From the repository root:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/assistant/`. Use a local server rather than opening `index.html` as a `file://` URL because ES modules and service workers need an HTTP origin. A local server works with the internet disconnected after the repository and dependencies are downloaded.

## Train from scratch

Python and NumPy are needed only for training, not browser inference. Initial dependency installation needs internet unless you already have the wheels:

```sh
python -m venv .venv
.venv/bin/pip install -r assistant/training/requirements.txt
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 .venv/bin/python assistant/training/train.py
npm test
```

Training uses the local `catalog.json`. A candidate must pass the curated regression checks for every Craft and intent label. Rejected candidates never replace the working checkpoint. Acceptance of these narrow checks does not establish safety or broad task competence; review changed answers and templates separately.

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

Only use data you have the rights and permission to use. Remove personal information; a trained network is not a privacy guarantee. Inspect every example and label. Do not scrape or add conversations automatically. Valid intent labels are `greeting`, `help`, `create`, `export`, `troubleshoot`, and `training`; Craft labels are the lowercase folder names. These examples improve routing only, not the factual knowledge or generative ability of the assistant.

## Remaining work

A fluent, general conversational model trained from scratch needs a much larger licensed corpus, tokenizer, language-model architecture, compute, evaluation and safety work. This repository does not provide that capability. Autonomous editing also needs verified per-editor command adapters, permission boundaries, previews and confirmation before modifying projects. Neither should be inferred from this routing prototype.

## Provenance

The craft summaries are derived from the documentation already bundled in this repository, with conservative workflow guidance. Each craft-specific help reply links to its bundled README on GitHub. Those READMEs may discuss native or newer upstream features that are absent from the mirrored web build. Existing upstream licenses and notices are retained; the overlay does not modify generated JavaScript or WebAssembly.
