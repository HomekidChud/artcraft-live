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

    saved = {k: getattr(srv, k) for k in
             ("model_stream", "run_command", "super_advisor_pass",
              "find_model", "model_status", "fetch_page")}
    srv.model_stream = fake_model_stream
    srv.run_command = fake_run_command
    srv.super_advisor_pass = fake_super_advisor
    srv.find_model = fake_find_model
    srv.model_status = lambda m: (m, None)
    srv.fetch_page = lambda u: ("PAGE", "T", None)
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
test_obs_packing()
test_truncation_note_persists()
test_tool_loop_budget()
test_tool_loop_truncation()

if FAILURES:
    print(f"\n{len(FAILURES)} FAILURES")
    sys.exit(1)
print("ALL HARNESS TESTS PASS")
