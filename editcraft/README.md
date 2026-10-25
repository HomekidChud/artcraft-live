# EditCraft

A full browser text editor with an integrated Claude (Anthropic) AI panel — built directly in this repository, like UnityCraft, RobloxCraft and PlaneCraft. No server, no account, no build step: one static page.

## What is included

### The editor
- **Three modes per document** — rich text (contenteditable with a formatting toolbar), Markdown (source plus live preview) and plain code (monospace with a line-number gutter).
- **Rich text tools** — bold, italic, underline, strikethrough, H1–H3, paragraph, quote, bulleted and numbered lists, alignment, links, horizontal rule, code blocks, undo/redo, clear formatting.
- **Find & replace** — with match count, match-case toggle, single replace and replace-all in all three modes (text-node walker in rich text).
- **Documents and sandboxes** — multiple documents in a sidebar list, rename inline, delete, import `.txt`/`.md`/`.html` files, export the current document as HTML, Markdown or plain text. **Sandboxes** are separate scratch documents with their own Claude conversation.
- **Snippets** — meeting notes, to-do checklist, email signature, code block, contents, date stamp; inserted at the cursor.
- **Live stats** — words, characters, sentences, paragraphs, reading time; autosaved to this browser's localStorage (nothing leaves the page).
- **Themes and print** — dark and light themes, print stylesheet, keyboard shortcuts (Ctrl+F find, Ctrl+S save, Tab indents in code mode).

### The AI (Claude)
- **Bring your own Anthropic API key** — optional, off by default, held in this tab's memory only and never written to storage. Calls go directly from your browser to the Anthropic Messages API with the `anthropic-dangerous-direct-browser-access` header. Every request costs money on your key.
- **Quick actions on your selection or document** — explain, rewrite, fix grammar, summarize, expand, continue writing. Results offer "Insert at cursor" and "Replace selection" buttons — Claude never edits the document itself.
- **Chat with document context** — the open document's text is included as context (truncated) when you chat.
- **Agent teams** — say "use 4 agents to …" in the chat and EditCraft spawns exactly four parallel Claude agents (planner, researcher, writer, reviewer, …) plus a synthesis call. Each agent is a separate paid API call. The user-chosen count is honored from 1 up to 8; larger requests are rejected with an explanation instead of silently capped.
- **Browser tool** — fetch a public page's text into the panel and ask Claude about it, or preview the URL in a sandboxed frame. This is a client-side text fetch, not a controllable browser: many sites block browser fetches (CORS), and that failure is reported honestly. No clicking, scrolling, logging in or form filling.

## Honesty ledger

| Claim | Status |
|---|---|
| Full offline editor | True — all editing tools work with no network and no key |
| Claude AI | Real, but only with your own API key; costs money per call |
| Agent teams | Real parallel Anthropic API calls (not simulated workers); capped at 8, count is honored exactly |
| Browser tool | Text fetch + sandboxed preview iframe only; cross-origin pages that block fetches fail with an honest message |
| Sandboxes add credits | **False** — sandboxes are separate scratch documents and conversations on the same key with the same limits; they do not create quota |
| AI edits your document | False by design — AI output is applied by you via Insert/Replace buttons |
| Data leaves the page | Only when you connect a key: then messages, document context and fetched page text go to Anthropic. Never any key-less telemetry |

## Privacy and provenance

- Everything is stored in this browser's localStorage (`editcraft.docs.v1`); clearing browser data deletes it. The AI key and conversations are in-memory only and vanish on reload.
- The page loads the shared [inspector](../inspector/inspector.js) and the shared [chat widget](../assistant/widget.js) (`data-craft="editcraft"`), like every other app in this suite.
- The AI client is the shared [`assistant/claude.js`](../assistant/claude.js) module, which is covered by the repository's Node test suite (`assistant/tests/claude.test.js`).
- Original artwork and code; no third-party editor code is bundled. Model identifiers (`claude-sonnet-5-5` etc.) follow Anthropic's public API naming.

## Run

Static site — serve the repository root (`python -m http.server 8000`) or use GitHub Pages, then open the EditCraft card. Requires an up-to-date desktop browser (ES modules). For the AI panel you need your own Anthropic API key.
