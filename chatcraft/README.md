# ChatCraft

A personal AI workspace: multi-model chat with an always-on advisor pass, live
harness steps (read, advisor, write, files), per-message cost tracking, and a
Documents view with a real file manager. Mobile-first UI with a desktop layout.

## What's live

- Chat with 9 models (Claude, GPT, Gemini, Grok families) plus custom
  OpenAI/Anthropic-compatible endpoints.
- Advisor: a fast, cheap reviewer model that briefs every turn before the main
  model answers. Always on, server-side, with its own usage/cost line.
- Harness steps: every turn shows a live timeline — Read conversation, Advisor
  review, Writing reply, Wrote N files.
- Files: ask chat to create a file (e.g. "create notes.md with a to-do list")
  and it is saved server-side, shown as a file card in chat and listed in
  Documents (view, copy, delete).
- Work mode (Android app only): chat runs on the Computer's models. The web
  build does not include Work mode.

## Files

- `index.html` — the whole frontend (HTML + CSS + JS, single file, no build).
- `server.py` — FastAPI backend: model proxy, advisor pass, SSE chat stream,
  file store, custom-model CRUD.
- `wallpaper.jpg` — home background.

## Running the backend

```bash
pip install fastapi uvicorn anthropic openai
python server.py   # listens on :8000
```

Frontend expects the API on the same origin (or set `API` in `index.html`).

## Honest status

Not built yet: agents, automations, browser agent, canvas, video studio,
dashboards, projects, skills/plugins marketplace, sign-in. The UI marks these
as "Planned" rather than faking them. No demo or sample content anywhere.
