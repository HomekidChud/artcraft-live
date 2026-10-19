#!/usr/bin/env python3
"""Generate the memory-only preview variant of ChatCraft for sandboxed preview deploys.

The hosted preview iframe blocks web storage APIs (localStorage etc.), and the
deployment check rejects builds that use them. This script produces a variant
with a pure in-memory store: identical app behavior, but chats and keys last
only for the session (the app shows a "session-only" notice). The repository
version (GitHub Pages) keeps normal persistent storage.

Usage: python3 preview-build.py [output-dir]
"""
import re
import sys
import pathlib

src = pathlib.Path(__file__).parent / "index.html"
out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".preview")
out_dir.mkdir(exist_ok=True)

s = src.read_text()

pattern = re.compile(
    r"const store = \(\(\) => \{.*?\}\)\(\);",
    re.S,
)

replacement = """const store = (() => {
  // Preview build: web storage is unavailable in the sandboxed preview iframe,
  // so this build uses an in-memory store only (session-only, see notice).
  const mem = new Map();
  return {
    persistent: false,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
})();"""

s2, n = pattern.subn(replacement, s, count=1)
if n != 1 or "localStorage" in s2:
    raise SystemExit("FAILED: store shim not replaced cleanly or localStorage still present")

(out_dir / "index.html").write_text(s2)
(out_dir / "README.md").write_text(
    "# ChatCraft (preview build)\n\n"
    "Memory-only variant for the sandboxed preview iframe: identical app, but web\n"
    "storage is unavailable there, so chats and keys last only for the session\n"
    "(the app shows a session-only notice). The repository version keeps normal\n"
    "persistent storage where the browser allows it.\n"
)
print(f"wrote {out_dir}/index.html and README.md ({len(s2)} bytes)")
