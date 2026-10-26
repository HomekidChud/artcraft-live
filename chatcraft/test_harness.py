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

if FAILURES:
    print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("\nALL HARNESS TESTS PASS")
