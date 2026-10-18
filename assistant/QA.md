# Assistant verification inventory

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
