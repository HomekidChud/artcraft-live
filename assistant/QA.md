# Assistant verification inventory

## Compact chat and file attachments

The compact-chat revision adds a 44px launcher, a 360px compact panel, expand/restore, minimize/reopen and Escape from the message field. Check all controls on desktop and 375px mobile; verify that both the conversation and pending attachments survive minimizing and that the composer remains visible while the conversation scrolls.

File checks cover picker and drag/drop, file-only submission, text previews, CSV/TSV shape and quoting, valid/invalid JSON, raster image previews, audio controls and metadata-only PDF/native files. Verify empty, oversized, malformed UTF-8, fake image and excess-file rejection; removal, cancellation with New chat, reset cleanup, unsupported requests and offline attachment use. Verify filenames and document markup are shown as plain text and that file operations cause no upload requests.

## Scope

The changed surface is the new chat page plus one isolated chat script tag in each editor. Existing editor functionality, compiled JavaScript and WebAssembly are outside the change. The floating widget must not replace the editor canvas or touch project data.

## Automated checks

- Every Craft: neural Craft routing, start guidance, export guidance, loading checklist, starter artifact and correctly labelled widget injection.
- Browser/NumPy parity: each request-routing regression phrase must predict the same expected label in JavaScript.
- Context: auto Craft selection, follow-up memory, explicit name changes and selector precedence.
- Defensive handling: no Craft selected, unknown words, SVG escaping and CSV formula-injection avoidance.
- File structure: CSV totals, PCM WAV header/sample limits and closed DXF rectangle.
- Training: unapproved examples rejected; a failed candidate must preserve the working checkpoint.

## Browser checks

- Standalone chat at desktop and 375px: initial page, loaded model, all visible controls and readable disclosures.
- Real message submission, Enter submission, Shift+Enter newline, starter download and New chat reset.
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
