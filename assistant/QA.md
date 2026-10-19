# Assistant verification inventory

## Compact chat and file attachments

The compact-chat revision adds a 44px launcher, a 360px compact panel, expand/restore, minimize/reopen and Escape from the message field. Check all controls on desktop and 375px mobile; verify that both the conversation and pending attachments survive minimizing and that the composer remains visible while the conversation scrolls.

File checks cover picker and drag/drop, file-only submission, text previews, CSV/TSV shape and quoting, valid/invalid JSON, raster image previews, audio controls and metadata-only PDF/native files. Verify empty, oversized, malformed UTF-8, fake image and excess-file rejection; removal, cancellation with New chat, reset cleanup, unsupported requests and offline attachment use. Verify filenames and document markup are shown as plain text and that file operations cause no upload requests.

## Scope

Changed surfaces include the assistant page, router/model/training data, shared chat widget, and EffectCraft entry page/service worker. The generated JavaScript and WebAssembly for all editor applications remain untouched. The floating widget must not replace the editor canvas or touch project data.

## Automated checks

- Every Craft: neural Craft routing, start guidance, export guidance, concise loading recovery, starter artifact and correctly labelled widget injection.
- Browser/NumPy parity: each request-routing regression phrase must predict the same expected label in JavaScript.
- Context: auto Craft selection, follow-up memory, explicit name changes and selector precedence.
- Defensive handling: no Craft selected, unknown words, SVG escaping and CSV formula-injection avoidance.
- File structure: CSV totals, PCM WAV header/sample limits and closed DXF rectangle.
- Local memory: off-by-default consent, explicit save/recall/forget, local-storage failures, bounded entries, Craft-scoped relevance and personalized supported starters.
- Action traces: classifier, memory lookup, attachment checks and starter-generation function calls match the actions actually executed; no shell commands are claimed.
- Training: unapproved examples rejected; a failed candidate must preserve the working checkpoint.

## Browser checks

- Standalone chat at desktop and 375px: initial page, loaded model, all visible controls and readable disclosures.
- Real message submission, Enter submission, Shift+Enter newline, starter download and New chat reset.
- Enable local memory, save an explicit note, reload, verify the note and remembered Craft are reused, then recall and clear them. Confirm the browser contains no test note after QA.
- Verify task traces are collapsed by default, expand to exact local calls/outcomes, and do not claim terminal/editor commands.
- Craft selector changed and changed back; editor link destination.
- Documentation link activated from a reply; no unexpected script injection from a message.
- Widget opened, closed, reopened and expanded into a full tab; selected Craft follows its entrypoint.
- Offline: wait for installation, reload while online, disable network, reload the assistant and generate a starter.
- Off-happy-path: unsupported prompt and missing model show honest unsupported/error states.
- Desktop to mobile to desktop: no horizontal overflow, clipping or missing send/reset controls.

The tiny routing regression set does not assess arbitrary conversation, factual accuracy across the editors, native imports, project editing, safety-sensitive work or production training uptime. Tests must not be described as proving those capabilities.

## Observed results

Verified locally on 18 October 2026 using Chromium:

- Routing regression checks: 26/26 Craft cases and 12/12 request cases. These are curated development checks, not independent generalisation benchmarks.
- Node test suite: 29 tests, including all 13 Craft workflows and checkpoint/catalog matching.
- Python test suite: three tests, including a real temporary watch worker that trains, enters its idle state and rejects a duplicate worker.
- Browser: all 13 Craft starter buttons produced their expected download controls. The GridCraft CSV was downloaded and inspected: 100 bytes with a consistent total row.
- Browser: standalone desktop and 375px mobile rendering, Enter/Shift+Enter, New chat, selector changes, all three initial suggestions, unknown-request fallback and missing-model error state passed.
- Browser: documentation opened the intended bundled README. The Open editor control opened the actual local GridCraft WebAssembly editor. Its chat overlay retained the selected Craft, responded to a real message, closed, reopened with its conversation retained, and opened its standalone full-tab URL.
- Browser: after service-worker installation and an online reload, the assistant reloaded with the network disabled and produced the SoundCraft starter download control.
- Layout: no horizontal overflow was detected in the standalone desktop/mobile checks. Screenshots of the standalone and embedded flows were inspected for clipped controls, poor contrast and unreadable text. Editor mobile layout is upstream and is not redesigned by this change.
- No assistant JavaScript page errors were observed in the tested standalone flows.

The persistent worker was tested in a temporary local checkout and terminated afterward. No production always-on training service was enabled by these tests.

## Compact revision results

- JavaScript regression suite: 42 tests passed. Python trainer suite: three tests passed; no training changes or checkpoint updates are part of this revision.
- In the real local GridCraft editor, the launcher measured 44 × 44 pixels. The compact panel measured 360 × 560 pixels at desktop, and fit within a 375px viewport. Expand/restore, minimize/reopen, Escape from the iframe message field and the full-tab link were exercised.
- Pending files and submitted file-check messages survived minimize/reopen. New chat removed pending files and safely cancelled an intentionally delayed, in-flight file read. A rejected model stayed disabled even after New chat.
- File picker and drag/drop flows were exercised. CSV shape, JSON validity, image dimensions/preview and audio playback were checked through the UI. PDF content remained unparsed and was clearly labelled as metadata-only.
- Empty files, text over 1 MB, binary files over 10 MB, fake image content and a fourth pending attachment were rejected with visible feedback. Removing an attachment and submitting files without a text message both worked.
- A script-containing HTML attachment was displayed in a plain-text preview and did not execute. Observed file-operation requests contained no upload/non-GET requests.
- After service-worker installation and online refresh, the chat reopened offline and inspected a newly attached CSV with the network disabled.
- Desktop/mobile screenshots were inspected, including the initial compact state, pending files, submitted file checks and expanded mobile state. The iframe composer stayed within its viewport in the tested 375px mobile flow; no horizontal overflow was detected.


## Memory and action-trace revision results

Verified locally on 19 October 2026:

- JavaScript suite: 52 tests passed, including opt-in storage, explicit remember/recall/forget, bounds, topic relevance, and memory-aware starter generation. Python training suite: three tests passed; the trained checkpoint was not changed.
- Browser: enabled memory, saved an explicit note, reloaded, used the remembered Craft and relevant brand preference in a downloadable SVG starter, recalled the note, and cleared all test memory.
- Historical behavior at that revision: starter actions were expanded by default, with function calls and outcomes. The current compact revision instead keeps “Show task steps” collapsed until opened.
- Browser console: no output/errors observed during these flows. No test note remained in the browser after cleanup.

## Expanded training, quieter UI, and EffectCraft recovery

Verified locally on 19 October 2026:

- Historical checkpoint before the small-talk/online revision: 1,000 epochs per classifier; 420 Craft training examples and 135 request examples. It was replaced by the newer 511/188-example checkpoint documented below. The 52/26 held-out checks were curated smoke tests, not generalisation evidence.
- JavaScript: 53 tests passed, including each Craft's held-out phrases and EffectCraft renderer fallback routing. Python: three trainer tests passed, including the temporary 1,000-epoch watch worker and checkpoint-rejection behavior. `node --check` and `git diff --check` passed.
- Desktop assistant screenshot inspected at 1280×1100; a real 375×812 Chromium screenshot was inspected with no horizontal overflow. The assistant has two starter prompts, a compact Craft/memory row, and one persistent composer.
- In the actual EffectCraft editor, the embedded chat iframe measured 358×513. After a troubleshooting response, its document remained 358×513; the composer, attach row, footer, collapsed “Show task steps” trace, and both renderer links stayed inside the panel.
- EffectCraft default, `?webgl`, and `?cpu` URLs loaded the editor. The upstream `render.backend` status reported `active: cpu` on the CPU fallback URL. This sandbox has no usable GPU compositor, so the test does not establish performance or behavior on the user's device.
- At that earlier revision, the local caches were `artcraft-assistant-v8` and `effectcraft-5d08653e92558abf-local-recovery1`; the assistant cache is now v10 and includes the online client and skill registry. The EffectCraft application JS/WASM still match upstream v0.11.1; only its service-worker version and HTML entrypoint were locally customized.


## Expanded small talk, online AI, and skills (19 October 2026)

- Refreshed the reviewed local dataset and trained a new 1,000-epoch checkpoint: 511 Craft training examples and 188 intent examples; all 78 held-out Craft and 43 held-out intent phrases passed. These remain curated routing checks, not a general intelligence benchmark. Chat transcripts were not used.
- JavaScript suite: 63 tests passed, including seven intent labels, small-talk responses, online request boundaries, optional web search/citations, malformed skill-call rejection, failed-fetch trace accuracy, Craft guidance and starter-file calls, and key validation. Python trainer suite: three tests passed. JavaScript syntax, JSON parsing, and `git diff --check` passed.
- Browser: “how are you” returned a friendly answer rather than training/router details. Online settings disclosed the API-key and data-transfer boundaries before connection. Mock-only Responses requests verified `store:false`, optional web search/citations, and live expanded task steps that collapse after completion. A mocked Craft guidance call showed its result going into a follow-up request; the trace showed this, kept the key hidden, and did not claim a response before one was received. Disconnect cleared the page connection and conversation.
- Mobile screenshot inspected at 375 × 812: Craft, memory, online controls, suggestions, composer, attach row and details remained visible without horizontal overflow. An unauthenticated CORS `OPTIONS` preflight to the Responses endpoint returned HTTP 200 with the expected ArtCraft-origin CORS headers; no authenticated/live OpenAI API request was made. Real use still depends on the user's own key, model access and quota.
