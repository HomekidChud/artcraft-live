# NOTICE — ChatCraft setup & deploy guide (for future sessions)

This file documents how to run, model-enable, and deploy ChatCraft from this
repo on Perplexity Computer, so a future session doesn't have to rediscover it.

## The advisor (two-stage, big brain / minimal tokens)

The advisor now works in two stages (`super_advisor_pass` in `server.py`):

1. **Locator** (cheap model, `claude_haiku_5_5` by default, override with
   `CHATCRAFT_LOCATOR_MODEL`): sees only an index — message number, role,
   120-char preview, file names — and replies with a JSON selection of the
   minimal parts worth reading.
2. **Advisor** (the configured advisor model, default now the big
   `claude_sonnet_5_5`): reads ONLY the selected messages/files and writes
   the brief. If the locator fails, it honestly falls back to the last 4
   messages.

The step timeline shows both stages ("Located relevant parts · 2/5 messages,
1 files"). Advisor usage/cost is the sum of both stages. Two gotchas:

- The proxy's Claude models emit `thinking` blocks on longer inputs — the
  non-streaming advisor call concatenates text from all `text` blocks and
  uses a generous `max_tokens` (700) so thinking can't starve the brief.
- The locator always includes the latest user message even if it forgets it.

## The agent: shell + browsing (computer-use style)

ChatCraft is now a full agent in its cloud workspace:

- **Shell**: `CHATCRAFT_ALLOW_CMDS=1` — the model's ```run blocks execute
  for real in the workspace (up to 10 commands per turn, 20s timeout each,
  output capped at 4KB). The UI shows each as a compact step with exit code
  and first output line.
- **Browsing**: ```browse blocks (first line = URL) are fetched server-side
  (`fetch_page`): scripts/styles stripped, readable text (first 8KB) saved as
  `browse-<site>.md` in the workspace and shown as a file card. Up to 5 per
  turn. `DEFAULT_SYSTEM` documents both tools to the model.
- The workspace (`chatcraft/files/`) is the agent's persistent cloud space —
  files, command cwd, and browse results all live there.

## Advisor follows your model (privacy default)

The advisor is a separate always-on reviewer that runs BEFORE the main
model — by default it is now the model YOU picked (empty advisor_model
from the UI), so no model the user didn't choose reads the conversation.
A different advisor can still be picked in Settings. The cheap locator
scanner follows the same family as the advisor (claude → haiku,
gpt → nano, gemini → flash, grok → grok) for the same reason.

## Browsing: headless Chromium

`fetch_page` now renders pages in headless Chromium (Playwright,
installed system-wide: `pip install playwright && python3 -m playwright
install chromium`) so JS-rendered pages work. Any failure falls back to
plain urllib; `CHATCRAFT_BROWSER=0` disables Chromium entirely. NOTE:
playwright is an OPTIONAL dependency — the server stays stdlib-only and
falls back gracefully without it.

## Cheapness policy (keep it cheap)

The harness is tuned for minimal tokens per COMPLETED task:

- **Locator bypass**: short chats (<=3 messages) skip the locator call
  entirely unless a workspace file is actually relevant (named in the
  latest user message, or the message refers to files/workspace) — the
  advisor just reads everything.
- **Terse system prompt**: ~half the tokens of the old one; advisor brief
  capped at 50 words (one line for simple requests).
- **History**: the model and advisor see the last 12 messages in full, no
  truncation — silently cutting older messages would lose requirements.
  Messages older than twelve are simply unavailable to the model and the
  advisor (the window is the whole context; there is no retrieval path).
- **Tool feedback loop** (step 8 of `/api/chat`): execute -> observe ->
  resume, budgeted. After commands/browses run, their outputs (and fetch
  failures) are fed back to the model in a continuation so it finishes the
  task in the same turn. Max 2 continuation calls per turn; command
  budgets are shared across the whole turn (10 commands / 5 browses
  total, unique step ids); if the budget runs out the user sees an honest
  "[continuation budget reached]" note.
- **Truncation honesty**: finish reasons are captured from both protocols;
  a reply or continuation that hits the token limit gets an explicit
  "[hit the token limit — possibly truncated]" note instead of silently
  passing as complete.
- **Skips are observations too**: over-budget commands/browses and disabled
  commands are logged, shown as skip step rows, and fed back to the model.
- **Prompt caching**: cache savings NOT verified — the platform proxy
  returned no cache fields in usage when `cache_control` was sent.
  Currently disabled; re-verify against the proxy before relying on it.
- Cost display per message includes locator + advisor + main +
  continuation usage, honestly merged. Dollar figures are ESTIMATES from
  the configured per-model rates, not verified billing. Measured
  (identical prompt, 2026-10-27): a shell+browse task costs ~$0.012
  total (estimated) and completes in one turn; a trivial "hi" costs
  ~$0.003 (estimated).
- **Tool-result packing** (`build_obs`): every operation's identity and
  outcome always ships to the continuation as compact status lines;
  output excerpts fill the remaining context budget; anything left out is
  explicitly marked with an omission note, never silently dropped.

## Repo layout

- `chatcraft/index.html` — the whole frontend (single file, no build step)
- `chatcraft/server.py` — the backend (stdlib-only Python, serves UI + API on :8000)
- `chatcraft/test_harness.py` — 30 offline tests; run `python3 test_harness.py` after any change
- `chatcraft/files/`, `chatcraft/data/` — runtime state (gitignored)

## Recent changes in this repo (2026-10-27)

1. **Minimal steps UI** — the per-reply step timeline is now one compact
   collapsed line ("Working · …" while streaming, "N steps completed" /
   "N steps · X skipped" / "N steps · X failed" when done) that expands to
   simple rows. The advisor's prose box is gone; the advisor pass is just a
   step row. Network errors and premature stream ends finalize the spinner
   honestly (`finalizeSteps`).
2. **File-edit diff labels** — when chat rewrites an existing file, steps and
   file events carry real line counts computed with `difflib.SequenceMatcher`
   ("Edited notes.md +13 -45"; pure reorders render as delete+insert like git).

## Running the backend with real models

The platform's LLM proxy credentials come from the `start_server` tool with
`api_credentials=["llm-api:website"]`. That injects:

- `ANTHROPIC_BASE_URL=https://agent-proxy.perplexity.ai/anthropic`
- `OPENAI_BASE_URL=https://agent-proxy.perplexity.ai/openai/v1`
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `PPLX_LLM_API_ADDRESS`

Claude models can point at the Anthropic proxy directly. **The OpenAI-family
(GPT, Gemini, Grok) cannot**: the proxy only serves the Responses API
(`POST /responses`), while ChatCraft speaks chat-completions. Route those
through a small local adapter (see "Sandbox-side files" below) that translates
chat-completions → Responses, and **do not forward `temperature`** — the
reasoning models (gpt5_mini/gpt5_nano) silently return no text with a
non-default temperature.

Model names the proxy accepts (probed 2026-10-27): `claude_sonnet_5_5`,
`claude_opus_5_5`, `claude_sonnet_4_5`, `claude_opus_4_5`, `claude_haiku_4_5`,
`gpt_5_1`, `gpt5_mini`, `gpt5_nano`, `gemini_3_1_pro`, `gemini_3_flash`,
`grok_4_3`. Everything else 403s ("model not allowed").

A launcher (`run_chatcraft.py`, kept outside the repo — see below) imports
`server` unmodified, then patches `CATALOG`: routes anthropic-kind entries to
the Anthropic proxy, openai-kind entries to the local adapter, renames models
to the proxy's naming, adds the two extra Claude 4.5 entries, and sets
`server.DEFAULT_ADVISOR`. Nothing in `server.py` itself needs to know about
the proxy.

## Local models (Ollama)

ChatCraft auto-detects Ollama at `127.0.0.1:11434` — zero code changes. In the
sandbox (2 cores / 7 GB RAM, no GPU, no `zstd` in apt):

1. Download `ollama-linux-amd64.tar.zst` from the GitHub release, decompress
   with `pip install zstandard` + `tarfile`, install `bin/ollama` **and all of
   `lib/ollama/`** (the llama-server runners — missing them = "llama-server
   binary not found").
2. `start_server` with `ollama serve` on port 11434.
3. Pull CPU-sized models only: `qwen3:1.7b`, `llama3.2:1b`, `gemma3:1b`,
   `smollm2:360m` (~4 GB total). Bigger models are unusably slow on 2 cores.

## Deploying (Perplexity Computer `deploy_website`)

1. Make a deploy folder with `index.html` + `wallpaper.jpg` only (never ship
   `server.py`/`files`/`data`).
2. In the deploy copy set `<script>window.__API_BASE__ = "__PORT_8000__";</script>`
   — the placeholder is rewritten at upload to proxy to sandbox port 8000.
3. Keep the backend running via `start_server` (it must stay up; the deployed
   site proxies to it — backend lifetime = session sandbox lifetime).
4. Backend env: `CHATCRAFT_HOST=0.0.0.0`, `CHATCRAFT_ALLOW_CMDS=0` (model-emitted
   shell commands disabled; UI shows them as skipped), and for the preview's
   CORS check: `CHATCRAFT_ALLOWED_ORIGINS=null,https://sites.pplx.app,https://www.perplexity.ai`
   plus `CHATCRAFT_ALLOW_NULL_ORIGIN=1` (the preview iframe is opaque-origin;
   the proxy rewrites the Host header, so the default origin check 403s).
5. `deploy_website(project_path=<deploy folder>, site_name="ChatCraft")`.

## Sandbox-side files (not in this repo, recreate as needed)

- `chatcraft-sandbox/run_chatcraft.py` — launcher described above
- `chatcraft-sandbox/responses_adapter.py` — chat-completions → Responses API
  translation shim on 127.0.0.1:8004
- `chatcraft-sandbox/mock_sandbox.py` — mock LLM server (unused now; was the
  keyless test sandbox)

## Known limitations

- The deployed preview's backend lives in the session sandbox: a new session
  must restart the servers (launcher + adapter + ollama) and redeploy.
- The proxy reports its own model names in cost captions (e.g. a request for
  `claude_sonnet_5_5` is reported as `claude_sonnet_3_5` by the provider).
