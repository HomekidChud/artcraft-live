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
model and writes a brief the main model then follows — the chosen main
model still writes every answer. By default the advisor IS the model you
picked (empty advisor_model from the UI), so no unchosen model reads the
conversation. A different advisor stays pickable in Settings.

Two precise details:
- the cheap locator scanner is the advisor's cheaper SAME-FAMILY SIBLING
  (claude→haiku_4_5, gpt→gpt5_nano, gemini→gemini_3_flash, grok→grok_4_3);
  unknown/local/custom models scan THEMSELVES (never a silently
  configured default like Claude)
- so the honest claim is: only your chosen model and (for the cheap scan)
  its same-family sibling ever read the conversation

## Browser agent (driving a real browser)

The agent can now DRIVE a browser, not just read pages:

- In chat: ```browser blocks (one action per line — `goto <url>`,
  `click <n>`, `type <n> <text>`, `scroll <down|up|down_bottom>`, `back`).
  The model sees a fresh page snapshot after every action: URL, title,
  first 3KB of text, up to 40 numbered interactive elements, and a JPEG
  screenshot. Shares the 5-action browse budget per turn.
- Playwright runs in a dedicated worker thread (the HTTP server is
  single-threaded sync — the browser blocks must never block it). The
  browser page is one persistent session, so you can navigate in the
  UI and the model picks up from where you are.
- Live "Browser agent" view: URL bar (back / go / star), preview
  (screenshot + page text + numbered elements — click one to click it
  in the page), History and Bookmarks sidebars (persisted in
  `browser-history.json` / `browser-bookmarks.json` in the data dir).
  Chat-driven actions emit SSE `browser` events and the view refreshes
  live while you're in it.
- Agent actions run un-gated (no action whitelist) — treat the
  workspace sandbox as the security boundary; the browser shares the
  sandbox's network position. Works without Playwright too: the state
  API falls back to a plain urllib fetch of the current URL.

## Browsing: headless Chromium (read-only)

`fetch_page` renders pages in headless Chromium (Playwright, installed
system-wide: `pip install playwright && python3 -m playwright install
chromium`) so JS-rendered pages work — verified against a JS-only
fixture (content only exists after script execution). Scope: this is
READ-ONLY page reading (open, render, extract text) — no clicking,
typing, or interactive sessions. Any Chromium failure falls back to
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
- `chatcraft/test_harness.py` — 185 offline checks; run `python3 test_harness.py` after any change
- `chatcraft/run_chatcraft.py` — launcher: imports `server` unmodified, patches CATALOG to route anthropic-kind models to the platform Anthropic proxy and openai-kind models to the local Responses adapter (see "Running the backend with real models")
- `chatcraft/responses_adapter.py` — chat-completions -> Responses API shim on 127.0.0.1:8004 (never forwards `temperature`)
- `chatcraft/files/`, `chatcraft/data/` — runtime state (gitignored)

## Recent changes in this repo (2026-10-27, build 5)

1. **Advisor capability upgrade**: the system prompt now carries an
   explicit CAPABILITIES & LIMITS block (tools, per-turn budgets, the
   no-logins/no-outside-workspace/no-background-jobs rules, paused
   automations, "never fake it" honesty rules), and the advisor brief
   gained a CAPABILITY FIT clause — it knows the tool list and limits,
   and must flag requests outside them plus name the closest supported
   alternative. The advisor note is injected into the system prompt the
   main model actually sees (harness-verified).
2. **Harness fine-tuned**: 185 checks (was 172) — advisor capability
   tests, advisor-note injection end-to-end, and the build-4 shared
   features (skills/tasks/automations blocks, diffs, image validation,
   endpoint gating).

## Recent changes in this repo (2026-10-27, build 4)

1. **Skills for the AI + `/skill` slash commands**: skills are a shared
   store the user and the AI both manage. In chat, `/skill` lists,
   `/skill -create name | description | prompt` creates, `-delete`,
   `-show`, and `/skill <name> <request>` runs a skill (its prompt
   becomes that turn's system). The AI creates skills itself via
   ```skill blocks (name/description headers, `---`, prompt body) —
   schema-validated records, never executable code. The system prompt
   lists installed skills to the model each turn.
2. **Tasks (shared to-do list)**: new Tasks view + `/api/tasks` CRUD +
   ```task blocks the AI executes (`add <title>`, `done <n>`, `undo <n>`,
   `delete <n>`, `list`). Same store, same validation as the UI. The
   home "To-do" quick-pill now points at the Tasks view.
3. **AI-created automations**: ```automation blocks (name /
   interval_min headers, `---`, prompt) create automations in the
   shared store — always PAUSED on create, same as the UI flow.
4. **Tool permissions are enforced server-side**: the user-facing
   endpoints for shell (`/api/run`), browser (`/api/browser/action`)
   and phone (`/api/phone/command`) now 403 — those tools are
   restricted to the AI, which drives them through ```run /
   ```browser / ```phone blocks. The Browser view is a read-only live
   watch (preview, state, bookmarks/history still update); the Phone
   view keeps pairing + state but drops the manual command box.
   Automations and Tasks remain fully usable by BOTH user and AI.
5. **Real diffs on every file edit**: file writes from ```file blocks
   and files changed by ```run commands now ship a bounded unified
   diff (capped 400 lines / 16KB) that the chat renders inline as
   colored +/- lines. Shell-command changes are detected by hashing
   the workspace before/after each command batch.
6. **Images (see + analyze)**: the composer attaches up to 4 images
   (JPEG/PNG/WebP/GIF, 5MB each) as data URLs; they render in the
   user's message, survive the whole history in `msg.images`
   ({b64, media_type}), are validated server-side, and reach
   Anthropic (image blocks) and OpenAI-compatible models
   (image_url parts; the Responses adapter maps them to
   `input_image`). The user sees exactly what the model sees.

## Recent changes in this repo (2026-10-27, build 3)

1. **Computer use**: the browser agent gained `click_xy <x> <y>`,
   `press <key>` and `wait <ms>` actions, and every page state fed back to
   the model now carries the viewport size (so raw-coordinate clicking is
   usable). The manual Browser view and chat ```browser blocks share them.
2. **Phone control (Android)**: chat can now drive a paired phone via
   ```phone blocks (`state`, `tap`, `text`, `swipe`, `enter`, `back`,
   `home`, `open`). New backend bridge in `server.py`
   (`/api/phone/pair|poll|result|command|devices` — 25s long-poll), a new
   **Phone** sidebar view (devices, pairing instructions, manual command
   box, latest screen state), and the same budget/honest-failure rules as
   the browser agent. Deep research confirmed an AccessibilityService is
   the only no-root way on Android; iOS is impossible for third-party
   apps — the UI says so instead of faking it.
3. **Android APK (`chatcraft-android/`)**: a 2-file no-dependency app.
   MainActivity pairs with a ChatCraft server (POST /api/phone/pair) and
   loads it in a WebView; PhoneBridgeService is the AccessibilityService
   that polls for commands, dispatches real gestures, types via
   ACTION_SET_TEXT, does global back/home, launches apps/URLs, and answers
   every command with a numbered screen dump. Output:
   `chatcraft-android/ChatCraft-phone-bridge.apk` (minSdk 26, signed).
   Build from source with the SDK tools:
   `aapt2 compile --dir res -o build/res.zip && aapt2 link -o
   build/app-unsigned.apk -I <android.jar> --manifest
   AndroidManifest.xml --java build/gen --auto-add-overlay build/res.zip
   && javac -encoding UTF-8 -source 8 -target 8 -bootclasspath <android.jar>
   -d build/classes build/gen/.../R.java src/.../*.java && d8 --lib
   <android.jar> --release --output build <classes> && zipalign + apksigner`.
   Verified statically (badging, manifest, signature); no emulator run in
   this sandbox (no KVM), so on-device behavior is untested here.
4. **Phone-bridge hardening** (post-review): command results are
   registered BEFORE the command becomes visible to the poller (a fast
   reply can no longer be lost), commands expire after 45s so a phone
   that polls late cannot run an action the caller already gave up on,
   gestures in the APK are awaited via their completion callbacks (not
   just "accepted"), text targets the FOCUSED editable, the APK's poller
   waits for pairing instead of exiting, and the APK gained a
   "Change server" re-pair button plus an optional access-code field
   (sent as X-Access-Code, same mechanism as the web UI).
5. Tests: 137/137 harness (27 new phone-bridge/computer-use checks incl.
   a full chat->phone round trip through the real poll/result endpoints),
   13/13 + 11/11 Playwright e2e. Android runtime still untested on a
   device (no KVM in the sandbox) — statically verified only.

## Recent changes in this repo (2026-10-27, build 2)

1. **Two shipped-breaking bugs fixed**: the Browser-view CSS was pasted
   INSIDE the `<script>` block (killed the whole app's JS parse), and the
   browser view called an `API_BASE` variable that never existed (the real
   one is `API`) — every browser-agent call threw ReferenceError on open.
   Both fixed; the script is verified to parse and the browser view was
   driven end-to-end with real Chromium.
2. **Every remaining "not built yet" view implemented** (except video,
   which needs a video-gen API): Canvas (editor + live iframe preview +
   save-to-Documents via new `POST /api/files/<name>`), Agents (hire a
   bot: model + persona, `data/agents.json`), Skills (reusable system
   prompts, `data/skills.json`), Automations (timer + scheduler thread,
   `data/automations.json`, created paused, 200-run cap, results saved to
   Documents), Projects (`data/projects.json`, sidebar now lists real
   projects), Dashboards (per-turn usage recorded to `data/usage-log.json`,
   bounded 500, charted client-side), Plugins (honest list of connected
   custom endpoints).
3. **Sidebar demo content removed**: the hardcoded fake projects
   ("ChatCraft UI kit", "Sourdough log") are gone — the Projects nav now
   renders real projects from the API.
4. Harness grew 90 → 110 tests: new feature stores, scheduler run with a
   stubbed model, live loopback HTTP smoke test of every new endpoint,
   path-traversal check on the file-write endpoint. The harness now also
   isolates the usage log so test runs can't pollute runtime state.

## Recent changes in this repo (2026-10-27, build 1)

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

## Sandbox-side files

`run_chatcraft.py` and `responses_adapter.py` now live IN THIS REPO
(`chatcraft/`). The runtime sandbox keeps copies in `chatcraft-sandbox/`;
after editing the repo, copy them over before restarting. The published
site's backend needs the user's own API keys (Settings > Custom models) —
the platform proxy credentials work only in the preview app.

## Known limitations

- The deployed preview's backend lives in the session sandbox: a new session
  must restart the servers (launcher + adapter + ollama) and redeploy.
- The proxy reports its own model names in cost captions (e.g. a request for
  `claude_sonnet_5_5` is reported as `claude_sonnet_3_5` by the provider).

## Build 6 — advisor review fixes + phone/models readiness

Advisor-review round (all items below are covered by `test_harness.py`,
`test_build6_fixes`):

1. **Continuation loop**: only NEW shared-store (task/skill/automation) results
   trigger a continuation round — stale ones can no longer re-trigger
   continuations forever. A reply with a `task` block + a plain continuation
   answer = exactly 2 model calls, one `done` event.
2. **Skills are additive**: `/skill` now sends `skill_prompt` as its own field;
   the platform instructions (tool syntax, budgets, limits) are never replaced.
3. **Starter skill library**: fresh installs auto-seed 5 skills
   (`browser-use`, `skill-creator`, `web-research`, `code-reviewer`,
   `concise`). User edits/deletions are never overwritten on re-seed.
4. **Automation toggle by id**: the model can enable/pause an existing
   automation with `id:` + `enabled:` headers (no prompt body needed) — so the
   user doesn't have to open Settings to turn one on.
5. **Honest capability wording**: the shell cwd is described as a working
   convention, not a security boundary; vision is conditional ("if the model
   cannot see images, say so").
6. **Diff expansion fixed**: clicking the inline diff no longer opens the file
   viewer underneath it (stopPropagation).
7. **Toast moved to the bottom** so it can never cover the header.
8. **Workspace snapshot is recursive** (subfolders included, posix-relative
   paths) and the workspace listing step no longer dies if the files dir is
   missing.
9. **Optional access key** for public deployments: set
   `CHATCRAFT_ACCESS_KEY=<key>` and `/api/chat` requires it (header
   `X-Access-Key` or `?key=`), compared in constant time. Origin checks are
   CORS, not authentication — use this on public sites.
10. **Images E2E**: a real PNG survives attach → message render →
    `collectHistory` → server sanitize → anthropic `image` block /
    openai `image_url` part → adapter `input_image`.

### Phone pairing + models on the public site

- Pair URL: `https://chatcraft.pplx.app/port/8000` (the APK falls back to it).
- Models: catalog models show "configured: false" on the public site because
  the platform proxy credentials cannot ship in published code (they would be
  public). Add your own key in Settings → Custom models (OpenAI-compatible or
  Anthropic-compatible base URL) and those models become fully usable,
  including from the paired phone.
