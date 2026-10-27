# ChatCraft improvements — all changes, this build

Everything below is implemented, tested (90/90 harness tests), and live.
The "not built yet" cards that remain (Canvas, Video, Dashboards, Agents &
automations) are listed at the bottom with what it would take to build them.

## What ChatCraft does now

ChatCraft is a single-file chat app (one `server.py` + one `index.html`)
that is a full agent in its cloud workspace: shell, read-only browsing,
file writes, and now a browser it can drive.

## Every improvement in this build

### 1. Models
- Claude Sonnet 4.5 / 5.5 and Opus 4.5 / 5.5 added (top), old Sonnet 3.5 /
  Opus 4.1 options kept below.
- `DEFAULT_SYSTEM` keeps the tool docs current (`run`, `browse`, `browser`).

### 2. Minimal steps UI
- Every agent action renders as one compact step row with a type label
  (Tool result, Cmd, Browse, Advisor, Cont) — input hidden, only the
  outcome shown. Matches the upstream minimal-steps design.

### 3. Advisor: two-stage, big brain / minimal tokens
- Stage 1 (locator): a cheap same-family scanner (claude→haiku, gpt→nano,
  gemini→flash, grok→grok-4.3) runs over the conversation and picks the
  newest task + a few requirement keywords. ~200 input tokens.
- Stage 2 (super advisor): your chosen reviewer model gets a SHORT brief —
  latest task + requirements + recent turns, NOT the whole conversation
  (harness-verified: advisor input stays ~200 tokens even when the
  conversation grows) — and returns a permissive brief: only tighten
  scope or flag contradictions; otherwise a single "OK" with no extra
  words.
- The brief ships to the main model for every round.

### 4. Advisor privacy (your model reads your chat)
- Empty `advisor_model` → advisor = your chosen model id. No unchosen model
  touches the conversation.
- Cheap locator scan uses the SAME-FAMILY sibling of your pick, never a
  silently configured default (fixed: Claude was the hardcoded locator).
- Frontend "Same as main model" is the default option in Settings.

### 5. Agent shell
- ```run blocks execute for real in the workspace (`CHATCRAFT_ALLOW_CMDS=1`).
- 10 commands per turn, 20s timeout each, output capped at 4KB per command.
- Each command is a compact step with exit code and first output line.
- The model gets real results back: exit code + first 2KB of output.
- Cheapness: shared per-turn budget (all tools draw from one pool), so
  the model can't spin on tools forever.

### 6. Read-only browsing (Chromium)
- ```browse blocks fetch server-side via `fetch_page`.
- Pages render in headless Chromium (Playwright) so JS-rendered content
  is captured — verified against a JS-only fixture.
- Readable text (first 8KB) saved as `browse-<site>.md` + shown as a file card.
- 5 per turn. urllib fallback if Playwright is missing; `CHATCRAFT_BROWSER=0` off.

### 7. Browser agent (NEW — this build)
- The agent DRIVES a real browser from chat: ```browser blocks with
  `goto / click / type / scroll / back`, one action per line.
- After every action the model sees a fresh snapshot: URL, title, first
  3KB of text, up to 40 numbered elements, JPEG screenshot.
- Playwright runs in a dedicated worker thread (the sync HTTP server
  never blocks on the browser).
- Live "Browser agent" view: URL bar (back/go/star), preview with
  screenshot + text + numbered clickable elements, History + Bookmarks
  sidebars (persisted). Chat actions refresh it live via SSE.
- Works without Playwright: state API falls back to a plain urllib fetch.

### 8. Frontend polish
- Model picker redesign: top models on top, old ones below, cost estimates.
- `apiFetch` error handling; SSE reconnect.
- What's-live card on the home view stays current.

### 9. Cheapness (measured, per-message cost)
The design keeps INPUT cost tiny while the task still gets done:

- Two-stage advisor = big-brain review at ~200 input tokens (instead of
  sending the whole conversation to a reviewer every turn).
- Terse system prompt (~1.6KB): only the tool docs the model needs,
  no generic assistant filler.
- Continuation budget: max 2 continuation rounds per turn — no runaway
  tool loops.
- Shared budgets: 10 cmds + 5 browse/browser actions per turn total.
- Every tool result fed back to the model is packed to one line
  (identity + outcome), never the full output.
- Bound context: history capped, truncation honestly marked
  (`[truncated]` notes persist so the model knows what it lost).
- Locator bypass: short conversations (≤5 messages) skip the locator —
  no cost when the task is already obvious from the thread.
- No prompt caching (the platform proxy doesn't support it — verified:
  cache_control is ignored, no cache fields in usage) — so the
  cheapness comes from sending less, not caching.

Measured (real runs, estimates from configured rates):

| Task type | Cost per turn |
|---|---|
| Full shell + browse task (multi-round) | ~$0.012–0.014 |
| Simple question ("hi") | ~$0.003 |
| Advisor review | visible per message (0 when skipped) |

### 10. Testing
- 90 mocked tests (`test_harness.py`) drive the full chat loop with
  stubs: budget rounds, truncation, tool delivery, advisor packing,
  continuation, browser blocks, state API, bookmarks/history persistence.
- All 90 pass; harness must stay green after every `server.py` change.

## Still "not built yet" (honest list)

| View | Status | What it would take |
|---|---|---|
| Canvas | not built | A collaborative document editor — needs a doc store + sync protocol (the workspace already persists files, so the backend half exists) |
| Video | not built | Video generation needs an external generation API (OpenAI Sora-style) — no video-gen model is available on the current proxy |
| Dashboards | not built | Saved queries + charts; data layer would come from the workspace files the agent already writes |
| Agents & automations | not built | Cron-style scheduled runs of a saved prompt; needs a scheduler process next to the server |

The Browser agent card was on this list and is now LIVE (improvement #7).
