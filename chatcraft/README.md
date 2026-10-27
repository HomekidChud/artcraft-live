# ChatCraft

A personal AI workspace: multi-model chat with an always-on advisor pass, a
live harness timeline (reading files, advisor review, writing files, running
commands), per-message cost tracking, and a Files view with a real file
manager and viewer. Single-file frontend, zero-dependency Python backend.

## What's live

- Chat with catalog models (Claude, GPT, Gemini, Grok families), local
  Ollama models (auto-detected when Ollama is running), and custom
  OpenAI/Anthropic-compatible endpoints added from Settings. Catalog model
  IDs and prices are best-effort estimates — check them against your
  provider's docs and edit the `CATALOG` list in `server.py` if needed.
- Honest model status: every model in the menu shows whether it is actually
  usable — "needs ANTHROPIC_API_KEY", "local · free", or live pricing.
  Nothing pretends to be a model it isn't, and the cost line shows the
  provider-reported model name when it differs from the one requested.
- Advisor: a fast, cheap reviewer model that briefs every turn before the
  main model answers. Always on, server-side, with its own usage/cost line.
  If the advisor model is unavailable the UI says so and the turn continues.
- Harness steps: every turn shows a live timeline — Read conversation,
  Reading workspace files, Advisor review, Writing reply, Writing files,
  Running commands — with detail lines (file listings, command output).
- Files: ask chat to create a file (e.g. "create notes.md with a to-do
  list") and it is saved server-side, shown as a file card in chat and
  listed in Documents (view, copy, download, delete).
- Commands: the model can run shell commands in the workspace by emitting a
  fenced ```run block; output is streamed back into the chat.

## Files

- `index.html` — the whole frontend (HTML + CSS + JS, single file, no build).
- `server.py` — stdlib-only Python backend: model routing, advisor pass,
  SSE chat stream with live step events, file store, command runner,
  custom-model CRUD, Ollama auto-detection. Serves the UI too.
- `wallpaper.jpg` — home background.
- `files/` (created at runtime) — the workspace files chat writes.
- `data/` (created at runtime) — custom-model records; never commit keys.

## Running

```bash
python server.py        # http://localhost:8000 — UI and API, no installs
```

Open http://localhost:8000. That's it — no pip, no build step. The server
listens on 127.0.0.1 only; set `CHATCRAFT_HOST` to change that.

### Using local models (Ollama)

```bash
ollama serve            # or install + start the app
ollama pull llama3.2
```

ChatCraft probes http://localhost:11434 automatically and lists every
installed model in the model menus (green dot, "local · free", $0.00 per
message). Set `OLLAMA_URL` to point elsewhere. LM Studio, vLLM and any
OpenAI-compatible local server also work via Settings → Custom models
(no API key needed for local servers).

### Using hosted models

Set the matching environment variable before starting the server:

```bash
ANTHROPIC_API_KEY=... python server.py     # Claude models
OPENAI_API_KEY=...   python server.py      # GPT models
GEMINI_API_KEY=...   python server.py      # Gemini (OpenAI-compat endpoint)
XAI_API_KEY=...      python server.py      # Grok
```

Models whose key is missing are shown greyed out with "needs KEY" in the
menus, and picking one tells you why it won't answer.

### Custom endpoints

Settings → Custom models: add any OpenAI-compatible or Anthropic-compatible
endpoint (base URL + model name + optional key). It then appears in every
model menu.

## Configuration (env vars)

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHATCRAFT_HOST` / `CHATCRAFT_PORT` | `127.0.0.1` / `8000` | Bind address (loopback by default) |
| `CHATCRAFT_ALLOWED_ORIGINS` | _(empty)_ | Extra origins allowed to POST/DELETE, for deployments behind a reverse proxy that rewrites the Host header. Comma-separated, e.g. `https://sites.example.com` |
| `CHATCRAFT_ALLOW_NULL_ORIGIN` | `0` | Accept `Origin: null` (file:// pages, sandboxed preview iframes). Enable only when the server is reachable solely through an authenticated proxy |
| `CHATCRAFT_ALLOW_CMDS` | `1` | Set `0` to disable ```run command blocks entirely |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY` | — | Provider keys; models without their key show as unavailable |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama instance for local open-source models |

## Security notes

- The server binds to `127.0.0.1` by default (set `CHATCRAFT_HOST=0.0.0.0`
  only if you understand the API is unauthenticated). Keep it loopback.
- The server executes ```run commands from model replies with `cwd=files/`,
  a 20s timeout and output caps — but that is a working directory, NOT a
  sandbox: a shell command can read anything your user can. This is the
  point of a harness, but it is your machine and there is no auth on the
  API, so do not expose it to a network. Set `CHATCRAFT_ALLOW_CMDS=0` to
  disable command execution entirely, or `CHATCRAFT_CMD_TIMEOUT` to
  change the limit.
- Custom-model keys are stored in `data/custom_models.json` (gitignored).
- File list/read/delete endpoints are restricted to `files/` — path
  traversal is stripped server-side. Command execution is not restricted.

## Honest status

Live: chat, advisor pass, model harness (files/commands/browsing/browser,
computer-use pointer/keyboard actions), the Browser agent live view, the
Phone view + Android phone bridge (```phone blocks; see
`chatcraft-android/ChatCraft-phone-bridge.apk` — pair the app, enable its
accessibility service, and the agent can tap, type and read the phone's
screen; Android only, iOS forbids third-party apps from doing this),
Canvas, Agents, Skills, Automations, Projects, Dashboards, Documents
viewer, custom model endpoints (the plugin surface).

Not built yet: video studio (needs a video generation API — none available
on the platform proxy) and a plugin marketplace (custom endpoints are the
live integration today). Those views say so rather than faking it. No demo
or sample content anywhere.

## Deploying

The frontend expects the API on the same origin, and `server.py` serves it,
so any static host + this backend works as-is. Set `window.__API_BASE__` in
`index.html` to an absolute URL if you split them.
