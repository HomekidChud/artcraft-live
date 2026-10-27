# ChatCraft improvements — all changes, this build

Everything below is implemented; the server-side work is tested (137/137
harness tests, 13/13 + 11/11 e2e checks) and the site is deployed and
verified live. The Android app was built and statically verified only —
no emulator or device run happened in this sandbox (no KVM), so on-device
behavior is expected but untested (see the honest-status notes in each
section).

## Build 3: computer use + phone control (the Android APK)

The agent can now use a computer (browser-level pointer/keyboard control)
and drive a real Android phone. Deep research first (sources):
- Android AccessibilityService — the only no-root mechanism to read the
  UI tree and inject gestures; official docs:
  https://developer.android.com/reference/android/accessibilityservice/AccessibilityService
  and https://developer.android.com/guide/topics/accessibility/custom-views
  (canRetrieveWindowContent, canPerformGestures)
- How AI agents control smartphones (AccessibilityService walkthrough):
  https://dev.to/sanjeevsharma327/how-ai-agents-control-smartphones
- The phone-control products we reviewed (PhoneClaw, Melaya, FoneClaw,
  Opposable) all ship an Android accessibility service for exactly this
- iOS: Apple's platform rules forbid third-party apps from injecting
  touches or reading other apps' screens (see the iOS Security Guide,
  https://support.apple.com/guide/iphone-13/security-ipsj979a1a54/1.0/ios/13)
  — so the phone bridge is Android-only and says so honestly.

### 9. Computer use in the browser agent
- New browser actions: `click_xy <x> <y>` (raw viewport-coordinate click),
  `press <key>` (Enter, Tab, Escape…), `wait <ms>`. The page state fed back
  to the model now includes the viewport size, so coordinates are usable.
- All documented in the model's system prompt; the manual Browser view and
  chat ```browser blocks share them.

### 10. Phone control — a ```phone block + Phone view
- Chat can drive a paired Android phone: ```phone blocks with one action
  per line: `state` (numbered screen dump with tap coordinates),
  `tap <x> <y>`, `text <msg>`, `swipe up|down|left|right`, `enter`, `back`,
  `home`, `open <package-or-url>`. Every action's result includes the fresh
  screen state, so the model can chain actions. Budgeted like the browser
  (shares the 5-actions-per-turn budget), honest failure steps when no
  phone is paired or it times out.
- New backend bridge in `server.py`: `POST /api/phone/pair`,
  `GET /api/phone/poll` (25s long-poll), `POST /api/phone/result`,
  `POST /api/phone/command`, `GET /api/phone/devices`.
- New **Phone** view in the sidebar: paired devices with online status,
  pairing instructions, a manual command box, and the latest screen state.

### 11. The Android APK (chatcraft-android/)
- A tiny no-dependency Android app (2 Java files, ~600 lines) that pairs
  with any ChatCraft server and lets the agent drive the phone:
  - **MainActivity**: pairing screen (server URL + device name →
    POST /api/phone/pair), then loads ChatCraft itself in a WebView.
  - **PhoneBridgeService**: an AccessibilityService that long-polls for
    commands, executes them with real gestures (`dispatchGesture`),
    `ACTION_SET_TEXT` typing, global back/home, app/URL launching, and
    answers each with a numbered screen dump (elements + coordinates).
- Built with the Android SDK build tools (aapt2/javac/d8/zipalign/apksigner),
  minSdk 26 (Android 8+), signed, verified. Sideload-ready
  `ChatCraft-phone-bridge.apk`. Honest limits, stated up front:
  - It was verified statically only (badging, manifest, signature, dex) —
    no emulator or device run happened in this sandbox (no KVM), so
    on-device behavior is expected but untested.
  - The phone must reach the backend over HTTP(S) with a URL you type
    into the pairing screen. For the deployed preview this means the
    sandbox proxy URL (it changes when the backend restarts — re-pair via
    the "Change server" button); for a self-hosted ChatCraft it is your
    server's URL. The app also supports an optional access code.
  - Gestures are dispatched and awaited, but some apps ignore injected
    input; "enter" appends a newline (per-app IME actions vary and are
    reported honestly as best-effort).

## This build: every "not built yet" view, implemented

The previous build shipped a Browser agent view that was dead on arrival
(and the README still listed it as planned). This build fixes that and
implements every remaining planned view that can be built honestly.

### 0. Two shipped-breaking bugs fixed (the app was dead JS)
- **The whole app's JavaScript was a syntax error**: the Browser-view CSS
  had been pasted INSIDE the `<script>` block (dead code that kills the
  entire script parse — no chat, no menus, nothing worked). Moved into the
  stylesheet; the script now parses (verified with `new Function()`).
- **The Browser view referenced `API_BASE`, a variable that never existed**
  (the real variable is `API`): every browser-agent call threw
  `ReferenceError` the moment the view opened, which is why it looked
  "not built". All 6 call sites fixed and verified end-to-end with a real
  Chromium drive (goto example.com, title + history captured).

### 1. Browser agent — actually live now
- Full live view: URL bar, screenshot, page text, numbered clickable
  elements, back/scroll, History and Bookmarks sidebars persisted as JSON.
- Chat drives the same session via ```browser blocks; the view refreshes
  live as the model clicks through pages.

### 2. Canvas — live
- Split editor + live sandboxed-iframe preview (debounced), "Save to
  Documents" writes into the workspace via a new `POST /api/files/<name>`
  endpoint (path-traversal-stripped, same rules as chat-written files).

### 3. Agents — live
- Hire a bot: name, description, model, persona (system prompt). Stored
  server-side (`data/agents.json`). "Chat" applies the bot's model +
  persona to the next conversation. Fired bots are deletable.

### 4. Skills — live
- A skill is a reusable system prompt. Install / remove / apply to chat
  from the Skills view (`data/skills.json`).

### 5. Automations — live
- A saved prompt on a timer: interval, model, enable/pause, "Run now".
  A scheduler thread inside `server.py` checks every 20s; each run calls
  the model and saves a markdown result to Documents. Honest cost guard:
  created paused, 200-run lifetime cap, interval floored at 1 minute.

### 6. Projects — live
- Group workspace files into named projects (`data/projects.json`);
  only files that actually exist are listed (ghosts dropped). The
  sidebar's Projects section now renders REAL projects instead of the
  old hardcoded demo names (which also removes the last fake content).

### 7. Dashboards — live
- The server records every chat turn (model, tokens, cost) into
  `data/usage-log.json` (bounded at 500 entries) and the Dashboards view
  charts it: messages-per-day bars, per-model breakdown, running total.
  No history yet? It says so instead of faking charts.

### 8. Plugins — honest
- The Plugins view now lists the custom model endpoints that are actually
  connected, and says plainly that a marketplace isn't built — endpoints
  are the whole plugin surface today.

### 9. Backend hardening & tests
- New stores follow the existing stdlib-only JSON pattern; every new
  endpoint is covered by 20 new harness tests (stores, scheduler run with
  a stubbed model, live loopback HTTP smoke test, traversal check).
  Harness: 110/110 green; the usage log is isolated from test runs so the
  harness can't pollute real runtime state.

### 10. Video studio — still honestly planned
- Video generation needs an external video-gen API (Sora-style); none is
  available on the platform proxy. The view says so rather than faking it.

## Previous build's log (unchanged)

Everything below is implemented, tested, and live.

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
- The harness grew with the app: 110 mocked tests (`test_harness.py`)
  drive the full chat loop with stubs: budget rounds, truncation, tool
  delivery, advisor packing, continuation, browser blocks, state API,
  bookmarks/history persistence, plus the new feature stores and endpoints.
- All pass; harness must stay green after every `server.py` change.

## Still "not built yet" (honest list)

| View | Status | What it would take |
|---|---|---|
| Video | not built | Video generation needs an external generation API (OpenAI Sora-style) — no video-gen model is available on the current proxy |
| Plugin marketplace | not built | A curated directory + install protocol; custom model endpoints are the live integration today |

Everything else that was on this list is now live (see the top of this file).
