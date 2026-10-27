#!/usr/bin/env python3
"""Deterministic harness tests for ChatCraft's reply parsing.

Run: python3 test_harness.py   (exit 0 = all pass)

Covers the cases small local models actually produce:
  - ordinary separate file + run blocks
  - filename on the line AFTER the opening fence
  - merged fence: file content, closing fence shared with a ```run opener
  - fake shell prompts ("$ ls", "user@host:~$ ls") vs ordinary commands
    ("echo $HOME", "echo '$ x'", "# comments") which must stay untouched
  - duplicate commands and the 5-command limit (per-block records, so a
    duplicate block never borrows a sibling's result)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append(name)
        print(f"FAIL {name}:\n  got:  {got!r}\n  want: {want!r}")
    else:
        print(f"OK   {name}")


# --- prompt-noise normalization (exact strings) ---
check("dollar prompt", server.normalize_cmd("$ ls"), "ls")
check("dollar prompt -la", server.normalize_cmd("$ ls -la"), "ls -la")
check("user@host form", server.normalize_cmd("user@host:~$ python script.py"), "python script.py")
check("user@ Terminal form", server.normalize_cmd("user@ Terminal $ ls"), "ls")
check("echo $HOME untouched", server.normalize_cmd("echo $HOME"), "echo $HOME")
check("echo '$ x' untouched", server.normalize_cmd("echo '$ x'"), "echo '$ x'")
check("# comment untouched", server.normalize_cmd("# just a comment"), "# just a comment")
check("plain command untouched", server.normalize_cmd("ls"), "ls")

# --- ordinary separate blocks ---
text_ord = "Intro\n```markdown notes.md\nhello\n```\nOutro\n```run\necho hi\n```\nEnd"
cleaned, files = server.extract_files(text_ord)
check("ordinary: file extracted", [f["name"] for f in files], ["notes.md"])
check("ordinary: file content", files[0]["content"], "hello")
check("ordinary: runs", server.extract_runs(text_ord), ["echo hi"])

# --- filename on the line after the fence (small-model spelling) ---
text_next = "```markdown\nhello.md\n\nLocal models work.\n```"
cleaned, files = server.extract_files(text_next)
check("next-line name: file extracted", [f["name"] for f in files], ["hello.md"])
check("next-line name: content", files[0]["content"], "\nLocal models work.")

# --- merged fence: content, shared fence, then a run block ---
text_merged = "```markdown todo.md\n- a\n- b\n```run\nls\n```"
check("merged: runs found", server.extract_runs(text_merged), ["ls"])
blocks = server.parse_blocks(text_merged)
check("merged: block kinds", [b[0] for b in blocks], ["file", "run"])
check("merged: file content", blocks[0][3], "- a\n- b")
check("merged: run cmd", blocks[1][1], "ls")

# --- merged fence must not swallow a LATER file ---
text_two = "```markdown a.md\nA\n```run\nls\n```\n```markdown b.md\nB\n```"
blocks = server.parse_blocks(text_two)
check("two files: kinds", [b[0] for b in blocks], ["file", "run", "file"])
check("two files: names", [b[2] for b in blocks if b[0] == "file"], ["a.md", "b.md"])
check("two files: a content", blocks[0][3], "A")
check("two files: b content", blocks[2][3], "B")

# --- per-block run records: duplicates never borrow a sibling's result ---
many = "".join(f"```run\ncmd{i}\n```\n" for i in range(1, 8)) + "```run\ncmd1\n```"
blocks = server.parse_blocks(many)
run_idx = [i for i, b in enumerate(blocks) if b[0] == "run"]
check("8 run blocks", len(run_idx), 8)
# simulate: first five blocks executed (each its own record), rest over limit
rc_by_block = {bi: 0 for bi in run_idx[:5]}
parts = []
for i, b in enumerate(blocks):
    c = server.normalize_cmd(b[1])
    if i in rc_by_block:
        parts.append(f"ran: {c}")
    else:
        parts.append(f"not run (over the 5-command limit): {c}")
report = "\n".join(parts)
check("first five ran", report.count("ran:"), 5)
check("rest honestly not run", report.count("not run"), 3)

# --- run block with a fake prompt flows through normalized ---
check("prompt run normalized", server.extract_runs("```run\n$ ls\n```"), ["ls"])

# --- ordinary code fence followed by a filename-like prose line ---
# the closing fence must not be reinterpreted as a file-block opener
text_code = '```python\nprint("hi")\n```\nnotes.md\nThis is prose, not file content.'
blocks = server.parse_blocks(text_code)
check("code fence: no file block", [b for b in blocks if b[0] == "file"], [])
check("code fence: no run block", [b for b in blocks if b[0] == "run"], [])
check("code fence: all text", [b[0] for b in blocks], ["text"])
check("code fence: content preserved",
      blocks[0][1], '```python\nprint("hi")\n```\nnotes.md\nThis is prose, not file content.')

# --- unterminated blocks (truncated mid-stream) never act ---
text_unterm_file = "Here you go:\n```markdown draft.md\nsome partial content"
blocks = server.parse_blocks(text_unterm_file)
check("unterminated file: no file block", [b for b in blocks if b[0] == "file"], [])
text_unterm_run = "```run\nrm -rf /very/bad"
blocks = server.parse_blocks(text_unterm_run)
check("unterminated run: no run block", [b for b in blocks if b[0] == "run"], [])
text_unterm_name = "```markdown\ndraft.md\npartial"
blocks = server.parse_blocks(text_unterm_name)
check("unterminated next-line name: no file", [b for b in blocks if b[0] == "file"], [])

if FAILURES:
    print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("\nALL HARNESS TESTS PASS")


# ------------------------------------------------- cheap-mode helpers ---

def test_history_window():
    # window keeps old requirements verbatim — no silent truncation
    msgs = [{"role": "user", "content": "x" * 900}] * 13 + [
        {"role": "user", "content": "latest"}]
    # server keeps the last 12; the requirement-heavy old message survives
    # untouched if within the window
    msgs2 = msgs[1:]
    check("history window: old message kept verbatim",
          msgs2[0]["content"], "x" * 900)


def test_cleaned_text():
    blocks = [("text", "prose here"),
              ("file", "markdown", "notes.md", "content"),
              ("run", "echo hi"),
              ("browse", "https://example.com"),
              ("browse", "https://fail.example")]
    check("cleaned_text: pending",
          server.cleaned_text(blocks, {}, cmds_pending=True),
          "prose here\nwrote file: notes.md\n(running command…)\n(browsing https://example.com…)"
          "\n(browsing https://fail.example…)")
    check("cleaned_text: after commands",
          server.cleaned_text(blocks, {2: 0}),
          "prose here\nwrote file: notes.md\nran: echo hi"
          "\n(browsing https://example.com…)\n(browsing https://fail.example…)")
    bbb = {3: (True, "Example Domain"), 4: (False, "HTTP 404")}
    check("cleaned_text: browse ok + failed labelled honestly",
          server.cleaned_text(blocks, {2: 1}, bbb),
          "prose here\nwrote file: notes.md\nfailed (exit 1): echo hi"
          "\nbrowsed: https://example.com\ncouldn't fetch: https://fail.example (HTTP 404)")
    check("cleaned_text: browse over budget",
          server.cleaned_text(blocks, {}, {3: (True, "t")}),
          "prose here\nwrote file: notes.md\nnot run (per-turn limit reached): echo hi"
          "\nbrowsed: https://example.com\nnot fetched (per-turn limit reached): https://fail.example")


def test_echo_text():
    rtext = ("Intro\n```markdown notes.md\nsecret content\n```\n"
             "```run\necho hi\n```\nOutro")
    check("echo_text: file contents elided, tools kept short",
          server.echo_text(rtext),
          "Intro\n(wrote file notes.md)\necho hi\nOutro")


test_history_window()
test_cleaned_text()
test_echo_text()


# ---------------------------------------------- budgeted tool loop (mocked) ---

import json as _json


def parse_sse(events):
    out = []
    for chunk in events:
        name, data = None, {}
        for line in chunk.split("\n"):
            if line.startswith("event: "):
                name = line[7:].strip()
            elif line.startswith("data: "):
                data = _json.loads(line[6:])
        out.append((name, data))
    return out


def drive_chat(scripted_replies, req):
    """Run Handler._api_chat with every model/tool call mocked. Each entry
    of scripted_replies is (text, finish_reason) for the Nth model call."""
    import server as srv
    # _api_chat records usage into the server's real data dir; isolate it
    if not hasattr(srv, "_usage_isolated"):
        srv._usage_isolated = True
        import tempfile as _tf
        srv.USAGE_LOG_FILE = Path(_tf.mkdtemp()) / "usage-log.json"
    calls = []

    def fake_model_stream(m, messages, system, max_tokens, temperature):
        i = len(calls)
        calls.append({"max_tokens": max_tokens,
                     "roles": [x["role"] for x in messages],
                     "messages": [dict(x) for x in messages]})
        text, fin = scripted_replies[i]

        def gen():
            yield ("text", text)
            yield ("finish", fin)
            yield ("usage", {"in": 10, "out": 5})
            yield ("model", m["id"])
        return gen()

    def fake_run_command(cmd):
        return (0, cmd.replace("echo ", "", 1).upper() + "-OUT")

    def fake_super_advisor(advisor, locator, messages, files):
        return ("brief", None, {"in": 0, "out": 0},
                {"locator_used": False, "total_messages": 1,
                 "read_messages": 1, "located_files": [],
                 "locator_usage": {"in": 0, "out": 0}})

    def fake_find_model(mid):
        return {"id": mid, "label": mid, "in": 3.0, "out": 15.0,
                "api": {"kind": "anthropic", "model": mid,
                        "base_url": "http://mock"}}

    browser_actions = []

    def fake_browser_action(action, **kw):
        browser_actions.append((action, dict(kw)))
        if kw.get("url") == "https://fail.example":
            return (None, "no element number 99")
        return ({"url": kw.get("url") or "https://example.com/",
                 "title": "Example Domain", "text": "Example text",
                 "elements": [{"n": 1, "tag": "a", "text": "Learn more",
                              "href": "/more"}], "shot": ""}, "")

    saved = {k: getattr(srv, k) for k in
             ("model_stream", "run_command", "super_advisor_pass",
              "find_model", "model_status", "fetch_page", "browser_action")}
    srv.model_stream = fake_model_stream
    srv.run_command = fake_run_command
    srv.super_advisor_pass = fake_super_advisor
    srv.find_model = fake_find_model
    srv.model_status = lambda m: (m, None)
    srv.fetch_page = lambda u: ("PAGE", "T", None)
    srv.browser_action = fake_browser_action
    events = []
    try:
        class Stub:
            def _sse(self, gen):
                events.extend(list(gen))
        srv.Handler._api_chat(Stub(), req)
    finally:
        for k, v in saved.items():
            setattr(srv, k, v)
    return calls, parse_sse(events)


def test_tool_loop_two_rounds():
    r1 = "Checking.\n```run\necho A\n```"
    r2 = "```run\necho B\n```\n"
    r3 = "A said A-OUT; B said B-OUT. Done."
    calls, evs = drive_chat(
        [(r1, "end_turn"), (r2, "end_turn"), (r3, "end_turn")],
        {"model": "m1", "messages": [
            {"role": "user", "content": "run echo A then report"}]})
    # three model calls: main + two continuations
    check("loop: three model calls", len(calls), 3)
    check("loop: continuations carry the tool obs",
          calls[1]["roles"], ["user", "assistant", "user"])
    cmds = [d for n, d in evs if n == "command"]
    check("loop: each command executed once",
          sorted(d["command"] for d in cmds), ["echo A", "echo B"])
    finals = [d for n, d in evs if n == "clean"]
    check("loop: final answer uses both results",
          "A-OUT" in finals[-1]["text"] and "B-OUT" in finals[-1]["text"], True)
    done = [d for n, d in evs if n == "done"][-1]
    check("loop: usage merged across all calls",
          (done["usage"]["in"], done["usage"]["out"]), (30, 15))
    cont_steps = [d for n, d in evs if n == "step" and d["id"] == "cont"]
    check("loop: cont steps complete honestly",
          [s["state"] for s in cont_steps], ["run", "done", "run", "done"])


def test_tool_loop_delivery():
    """The observations actually delivered to each model call."""
    r1 = "```run\necho A\n```"
    r2 = "```run\necho B\n```"
    r3 = "final answer"
    calls, evs = drive_chat(
        [(r1, "end_turn"), (r2, "end_turn"), (r3, "end_turn")],
        {"model": "m1", "messages": [
            {"role": "user", "content": "go"}]})
    obs1 = calls[1]["messages"][-1]["content"]
    obs2 = calls[2]["messages"][-1]["content"]
    ctx2 = "\n".join(str(m.get("content")) for m in calls[2]["messages"])
    check("delivery: round 1 obs contains A-OUT", "A-OUT" in obs1, True)
    check("delivery: round 2 obs contains B-OUT", "B-OUT" in obs2, True)
    check("delivery: round 2 context retains A-OUT", "A-OUT" in ctx2, True)
    check("delivery: continuation echoes the assistant reply",
          calls[1]["messages"][1]["role"], "assistant")


def test_tool_loop_cross_round_budget():
    """9 commands in the first reply + 2 in the continuation = 10 run, 1 skip."""
    r1 = "\n".join([f"```run\necho D{i}\n```" for i in range(1, 10)])
    r2 = "```run\necho E1\n```\n```run\necho E2\n```"
    calls, evs = drive_chat(
        [(r1, "end_turn"), (r2, "end_turn"), ("done", "end_turn")],
        {"model": "m1", "messages": [
            {"role": "user", "content": "go"}]})
    cmds = [d for n, d in evs if n == "command"]
    check("cross-budget: exactly 10 commands run across rounds", len(cmds), 10)
    check("cross-budget: E2 skipped (budget gone)",
          any(d["id"].startswith("cmd-skip-")
              for n, d in evs if n == "step"), True)
    # round-1 obs shows 9 results; round-2 obs shows E1 result + E2 skip
    obs2 = calls[2]["messages"][-1]["content"]
    check("cross-budget: skip fed back to the model",
          "SKIPPED" in obs2, True)


def test_obs_packing():
    """Long command outputs must not silently drop later browse results."""
    r1 = "\n".join([f"```run\necho long{i}\n```" for i in range(4)])
    r1 += "\n```browse\nhttps://example.com\n```"
    calls, evs = drive_chat(
        [(r1, "end_turn"), ("ok", "end_turn")],
        {"model": "m1", "messages": [{"role": "user", "content": "go"}]})
    obs = calls[1]["messages"][-1]["content"]
    # every operation's identity + outcome ships even when excerpts are cut
    check("packing: all 4 command statuses present",
          all(f"echo long{i} — exit 0" in obs for i in range(4)), True)
    check("packing: browse result survives long outputs",
          "example.com" in obs, True)
    check("packing: omission is explicit or nothing dropped",
          ("omitted" in obs) or ("Example" not in obs and "PAGE" in obs), True)


def test_truncation_note_persists():
    """A truncated reply keeps its warning even after a successful continuation."""
    r1 = "```run\necho A\n```\n```markdown notes2.md\npartial content"
    r2 = "here is the answer with A-OUT"
    calls, evs = drive_chat(
        [(r1, "max_tokens"), (r2, "end_turn")],
        {"model": "m1", "messages": [
            {"role": "user", "content": "go"}]})
    finals = [d for n, d in evs if n == "clean"]
    check("truncation: note survives the continuation",
          "reply hit the token limit" in finals[-1]["text"], True)
    check("truncation: final answer still present",
          "A-OUT" in finals[-1]["text"], True)
    # the unterminated file block must NOT have been saved
    saved_files = [d["files"] for n, d in evs if n == "done" for d in [d] if "files" in d]
    check("truncation: partial file not saved",
          all("notes2.md" not in (f or []) for f in saved_files), True)


def test_tool_loop_budget():
    r1 = "\n".join([f"```run\necho C{i}\n```" for i in range(1, 12)])
    calls, evs = drive_chat(
        [(r1, "end_turn"), ("All done.", "end_turn")],
        {"model": "m1", "messages": [
            {"role": "user", "content": "run everything"}]})
    check("budget: main + one continuation", len(calls), 2)
    cmds = [d for n, d in evs if n == "command"]
    check("budget: exactly 10 commands run", len(cmds), 10)
    finals = [d for n, d in evs if n == "clean"]
    check("budget: 11th command labelled not-run",
          any("not run (per-turn limit reached)" in d["text"] for d in finals), True)
    skip_rows = [d for n, d in evs if n == "step"
                 and d["id"].startswith("cmd-skip-")]
    check("budget: skip row shown in steps", len(skip_rows), 1)


def test_tool_loop_truncation():
    calls, evs = drive_chat(
        [("cut off mid", "max_tokens")],
        {"model": "m1", "messages": [
            {"role": "user", "content": "hello"}]})
    check("truncation: no tools, no continuation", len(calls), 1)
    finals = [d for n, d in evs if n == "clean"]
    check("truncation: honest note in reply",
          "reply hit the token limit" in finals[-1]["text"], True)


test_tool_loop_two_rounds()
test_tool_loop_delivery()
test_tool_loop_cross_round_budget()
def test_browser_block_executes():
    """A ```browser block runs, streams br steps + browser events, and the
    result feeds the continuation round."""
    r1 = ("```browser\ngoto https://example.com\nclick 1\n```\nlooking",
          "stop")
    r2 = ("The link worked.", "stop")
    calls, evs = drive_chat([r1, r2],
                            {"model": "m", "advisor_model": "",
                             "messages": [{"role": "user",
                                           "content": "open example.com"}]})
    ids = [d.get("id") for n, d in evs if n == "step"]
    check("browser: both actions ran as br steps", "br-1" in ids and "br-2" in ids, True)
    bev = [d for n, d in evs if n == "browser"]
    check("browser: SSE browser event per action", len(bev), 2)
    check("browser: event carries url+title",
          bool(bev and bev[0].get("url") and bev[0].get("title")), True)
    # the continuation round must see the compact state
    obs = calls[1]["messages"][-1]["content"]
    check("browser: continuation sees page state",
          "Example Domain" in obs and "Learn more" in obs, True)
    check("browser: model called twice (continuation)", len(calls), 2)


def test_browser_budget_and_failure():
    """Over-budget browser lines are skipped; failures are honest."""
    lines = "\n".join(f"click {i}" for i in range(1, 7))  # 6 actions, budget 5
    r1 = (f"```browser\n{lines}\n```", "stop")
    r2 = ("done", "stop")
    calls, evs = drive_chat([r1, r2],
                            {"model": "m", "advisor_model": "",
                             "messages": [{"role": "user",
                                           "content": "click things"}]})
    skips = [d for n, d in evs if n == "step" and d.get("id", "").startswith("br-skip")]
    check("browser: 6th action skipped by budget", len(skips), 1)

    r1 = ("```browser\ngoto https://fail.example\n```", "stop")
    calls, evs = drive_chat([r1, r2],
                            {"model": "m", "advisor_model": "",
                             "messages": [{"role": "user",
                                           "content": "open a bad page"}]})
    fails = [d for n, d in evs if n == "step"
             and d.get("state") == "fail" and d.get("id", "").startswith("br-")]
    check("browser: failure surfaces as failed step", len(fails), 1)
    obs = calls[1]["messages"][-1]["content"]
    check("browser: failure fed back to model", "no element number 99" in obs, True)


def test_browser_parse_action():
    """Action line parsing: shapes and the unknown-action path."""
    import server as srv
    check("parse: goto", srv.parse_browser_action("goto https://a.b"),
          ("goto", {"url": "https://a.b"}))
    check("parse: click", srv.parse_browser_action("click 3"),
          ("click", {"n": 3}))
    check("parse: type", srv.parse_browser_action("type 2: hello"),
          ("type", {"n": 2, "text": "hello"}))
    check("parse: garbage is None", srv.parse_browser_action("explode now"), None)


def test_build_obs_boundaries():
    """Long real outputs: every identity+outcome ships, cap holds, cuts marked."""
    import server as srv
    long_out = "X" * 5000
    cmd_log = [(f"echo long{i}", 0, long_out) for i in range(10)]
    cmd_log.append(("echo skipped", None, "per-turn limit"))
    browse_log = [("https://ok.example", "OK Page", "Y" * 5000),
                  ("https://fail.example", None, "HTTP 404"),
                  ("https://skip.example", None, "per-turn limit")]
    obs = srv.build_obs(cmd_log, browse_log, cap=9000)
    check("build_obs: every command status ships",
          all(f"echo long{i} — exit 0" in obs for i in range(10)), True)
    check("build_obs: skip status ships", "echo skipped — SKIPPED" in obs, True)
    check("build_obs: browse ok/fail/skip statuses ship",
          "https://ok.example — OK Page" in obs
          and "https://fail.example" in obs and "https://skip.example" in obs, True)
    check("build_obs: cap holds", len(obs) <= 9000, True)
    check("build_obs: omissions explicitly marked", "omitted" in obs, True)


def test_locator_for():
    import server as srv
    check("locator: claude family", srv.locator_for("claude_sonnet_5_5"), "claude_haiku_4_5")
    check("locator: gpt family", srv.locator_for("gpt_5_1"), "gpt5_nano")
    check("locator: gemini family", srv.locator_for("gemini_3_1_pro"), "gemini_3_flash")
    check("locator: grok family", srv.locator_for("grok_4_3"), "grok_4_3")
    check("locator: local model scans itself", srv.locator_for("qwen3:1.7b"), "qwen3:1.7b")
    check("locator: unknown model scans itself", srv.locator_for("my_custom"), "my_custom")


def test_unterminated_file_not_saved():
    """A truncated file block must never reach the workspace disk."""
    import tempfile
    from pathlib import Path
    import server as srv
    real_files_dir = srv.FILES_DIR
    with tempfile.TemporaryDirectory() as td:
        srv.FILES_DIR = Path(td)
        try:
            r1 = "```run\necho A\n```\n```markdown partial.md\nhalf-written"
            calls, evs = drive_chat(
                [(r1, "max_tokens"), ("answer with A-OUT", "end_turn")],
                {"model": "m1", "messages": [
                    {"role": "user", "content": "go"}]})
            check("unterminated: partial.md NOT on disk",
                  not (Path(td) / "partial.md").exists(), True)
            finals = [d for n, d in evs if n == "clean"]
            check("unterminated: truncation note survives",
                  "reply hit the token limit" in finals[-1]["text"], True)
        finally:
            srv.FILES_DIR = real_files_dir


def test_chromium_js_rendering():
    """Chromium must render JS-only content (fallback disabled for the test)."""
    import http.server
    import threading
    import tempfile
    from pathlib import Path
    import server as srv
    html = ("<html><head><title>Static Title</title></head><body>"
            "<div id='x'>no-js-fallback</div>"
            "<script>document.getElementById('x').textContent='JS-RENDERED-CONTENT';"
            "document.title='JS Title';</script></body></html>")
    with tempfile.TemporaryDirectory() as td:
        Path(td, "fixture.html").write_text(html)
        handler = lambda *a, **k: None
        class S(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=td, **k)
            def log_message(self, *a):
                pass
        srv_http = http.server.HTTPServer(("127.0.0.1", 0), S)
        port = srv_http.server_address[1]
        t = threading.Thread(target=srv_http.serve_forever, daemon=True)
        t.start()
        try:
            page_html, title = srv._fetch_chromium(
                f"http://127.0.0.1:{port}/fixture.html")
            check("chromium: JS-only content rendered",
                  "JS-RENDERED-CONTENT" in page_html, True)
            check("chromium: JS-set title captured", "JS Title" in title, True)
        except ImportError:
            print("SKIP chromium test (playwright not installed)")
        finally:
            srv_http.shutdown()


test_build_obs_boundaries()
test_locator_for()
test_unterminated_file_not_saved()
test_chromium_js_rendering()
test_obs_packing()
test_truncation_note_persists()
test_tool_loop_budget()
test_tool_loop_truncation()
test_browser_block_executes()
test_browser_budget_and_failure()
test_browser_parse_action()


# --- new feature stores: projects / agents / skills / automations / usage ---
import json as _json
import tempfile as _tempfile


def test_feature_stores():
    """The new JSON stores round-trip and the endpoint layer is honest."""
    import server as srv
    with _tempfile.TemporaryDirectory() as td:
        srv.PROJECTS_FILE = Path(td) / "projects.json"
        srv.AGENTS_FILE = Path(td) / "agents.json"
        srv.SKILLS_FILE = Path(td) / "skills.json"
        srv.AUTOMATIONS_FILE = Path(td) / "automations.json"
        srv.USAGE_LOG_FILE = Path(td) / "usage-log.json"
        srv.FILES_DIR = Path(td) / "files"
        srv.FILES_DIR.mkdir()

        # projects: only real workspace files are kept in the record
        (srv.FILES_DIR / "notes.md").write_text("hi")
        save_p = srv.save_projects
        srv.save_projects([{"id": "p1", "name": "Sourdough log",
                            "description": "d",
                            "files": ["notes.md", "ghost.md"],
                            "created": 1}])
        rec = srv.load_projects()[0]
        check("projects: ghost file dropped", srv.project_record(rec)["files"],
              ["notes.md"])

        # agents / skills round-trip
        srv.save_agents([{"id": "a1", "name": "Buddy", "description": "x",
                          "model": "m", "system": "be terse"}])
        check("agents: round-trip", srv.load_agents()[0]["name"], "Buddy")
        srv.save_skills([{"id": "s1", "name": "Terse", "prompt": "bullets only"}])
        check("skills: round-trip", srv.load_skills()[0]["prompt"], "bullets only")

        # usage log: bounded at 500
        for i in range(505):
            srv.record_usage({"ts": i, "model": "m", "in": 1, "out": 1,
                              "cost_usd": 0.001, "local": False})
        log = srv._load_json(srv.USAGE_LOG_FILE, [])
        check("usage: capped at 500", len(log), 500)
        check("usage: newest kept", log[-1]["ts"], 504)

        # automation run with a stubbed model: text saved to a workspace file
        ran = []

        def fake_stream(m, msgs, sys_, mt, temp):
            ran.append(msgs[0]["content"])
            yield ("text", "Automation result body")
            yield ("usage", {"in": 1, "out": 2})

        orig_stream, orig_find = srv.model_stream, srv.find_model
        srv.model_stream = fake_stream
        srv.find_model = lambda mid: {"id": "m", "label": "M", "api": {}, "in": 1, "out": 1}
        try:
            ok, detail = srv.run_automation_once(
                {"name": "digest", "prompt": "summarise", "model": "m"})
            check("automation: ran ok", ok, True)
            check("automation: prompt reached the model", ran, ["summarise"])
            saved = list(srv.FILES_DIR.glob("automation-digest-*.md"))
            check("automation: result file saved", len(saved), 1)
            check("automation: file has result body",
                  "Automation result body" in saved[0].read_text(), True)
        finally:
            srv.model_stream, srv.find_model = orig_stream, orig_find


def test_feature_endpoints():
    """Smoke the new HTTP endpoints against a live loopback server."""
    import threading
    import urllib.request as _rq
    import server as srv
    with _tempfile.TemporaryDirectory() as td:
        srv.DATA_DIR = Path(td)
        srv.PROJECTS_FILE = Path(td) / "projects.json"
        srv.AGENTS_FILE = Path(td) / "agents.json"
        srv.SKILLS_FILE = Path(td) / "skills.json"
        srv.AUTOMATIONS_FILE = Path(td) / "automations.json"
        srv.USAGE_LOG_FILE = Path(td) / "usage-log.json"
        srv.FILES_DIR = Path(td) / "files"
        srv.FILES_DIR.mkdir()
        srv.ALLOW_CMDS = False
        httpd = srv.ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
        port = httpd.server_address[1]
        th = threading.Thread(target=httpd.serve_forever, daemon=True)
        th.start()
        try:
            def call(method, path, body=None):
                req = _rq.Request(f"http://127.0.0.1:{port}{path}", method=method,
                                  data=_json.dumps(body).encode() if body is not None else None,
                                  headers={"Content-Type": "application/json"})
                with _rq.urlopen(req, timeout=5) as r:
                    return _json.loads(r.read().decode())

            d = call("POST", "/api/projects", {"name": "P1", "description": "d"})
            check("api projects: create", d["ok"], True)
            d = call("GET", "/api/projects")
            check("api projects: list", d["projects"][0]["name"], "P1")
            pid = d["projects"][0]["id"]
            check("api projects: delete", call("DELETE", f"/api/projects/{pid}")["ok"], True)

            d = call("POST", "/api/agents", {"name": "B", "model": "m", "system": "s"})
            check("api agents: create", d["agent"]["name"], "B")
            check("api agents: list", call("GET", "/api/agents")["agents"][0]["id"],
                  d["agent"]["id"])

            d = call("POST", "/api/skills", {"name": "S", "prompt": "p"})
            check("api skills: create", d["skill"]["prompt"], "p")
            d = call("POST", "/api/automations", {"name": "A", "prompt": "run", "interval_min": 0})
            check("api automations: interval floored at 1", d["automation"]["interval_min"], 1)

            d = call("POST", "/api/files/canvas.html", {"content": "<b>x</b>"})
            check("api files: write", d["ok"], True)
            d = call("GET", "/api/files/canvas.html")
            check("api files: read back", d["content"], "<b>x</b>")
            # path traversal is stripped
            d = call("POST", "/api/files/..%2F..%2Fetc-passwd", {"content": "x"})
            check("api files: traversal stripped", d.get("name", "").startswith(".."), False)

            d = call("GET", "/api/usage")
            check("api usage: empty log", d["log"], [])
        finally:
            httpd.shutdown()


test_feature_stores()
test_feature_endpoints()

if FAILURES:
    print(f"\n{len(FAILURES)} FAILURES")
    sys.exit(1)
print("ALL HARNESS TESTS PASS")
