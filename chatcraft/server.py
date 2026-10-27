#!/usr/bin/env python3
"""ChatCraft backend — standard library only, no pip installs.

A tiny agent harness behind the ChatCraft UI:

  1. reads the conversation and the workspace files
  2. runs an always-on advisor pass (a cheap reviewer model)
  3. streams the main model's reply token-by-token
  4. writes any files the reply contains (fenced blocks with a filename)
  5. runs any commands the reply contains (fenced ```run blocks)

Every one of those steps is streamed live to the browser as SSE `step`
events, so the UI can show what the harness is doing instead of dumping
text. Models are labelled honestly: platform models show whether their
API key is actually configured, local Ollama models are detected
automatically, and custom OpenAI/Anthropic-compatible endpoints can be
added from the Settings view.

Run:  python server.py   (serves the UI and API on http://localhost:8000)
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
FILES_DIR = BASE_DIR / "files"          # the workspace the harness writes to
DATA_DIR = BASE_DIR / "data"           # custom-model records (gitignored)
FILES_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
CUSTOM_FILE = DATA_DIR / "custom_models.json"

PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("CHATCRAFT_HOST", "127.0.0.1")  # loopback by default
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
# Command execution is the point of a harness, but it is YOUR machine:
# set CHATCRAFT_ALLOW_CMDS=0 to disable ```run blocks entirely.
ALLOW_CMDS = os.environ.get("CHATCRAFT_ALLOW_CMDS", "1") not in ("0", "false", "no")
# Extra origins allowed to POST/DELETE, for deployments behind a reverse proxy
# that rewrites the Host header (comma-separated, e.g.
# CHATCRAFT_ALLOWED_ORIGINS=https://sites.example.com).
ALLOWED_ORIGINS = {
    o.strip().rstrip("/")
    for o in os.environ.get("CHATCRAFT_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
}
# Accept `Origin: null` (opaque-origin pages: file:// or sandboxed preview
# iframes) for mutations. Off by default; enable only when the server is
# reachable solely through an authenticated proxy (e.g. a hosted preview),
# since a null origin cannot be verified.
ALLOW_NULL_ORIGIN = os.environ.get("CHATCRAFT_ALLOW_NULL_ORIGIN", "0") in (
    "1", "true", "yes")
CMD_TIMEOUT = int(os.environ.get("CHATCRAFT_CMD_TIMEOUT", "20"))
# When set, every /api/* request must carry this code in the X-Access-Code
# header. Empty (default) = no auth, e.g. a private loopback dev server.
ACCESS_CODE = os.environ.get("CHATCRAFT_ACCESS_CODE", "")

# ----------------------------------------------------------------- catalog ---
# Prices are rough public list prices, USD per million tokens (estimates).
# `api` says how to reach the provider; `env` is the API key variable that
# must be set for the model to actually be usable — the UI shows an honest
# "needs API key" state when it isn't.
CATALOG = [
    {"id": "claude_sonnet_5_5", "label": "Claude Sonnet 5.5", "provider": "Anthropic",
     "tier": "balanced", "in": 3.0, "out": 15.0,
     "api": {"kind": "anthropic", "model": "claude-sonnet-5-5", "env": "ANTHROPIC_API_KEY"}},
    {"id": "claude_opus_5_5", "label": "Claude Opus 5.5", "provider": "Anthropic",
     "tier": "quality", "in": 5.0, "out": 25.0,
     "api": {"kind": "anthropic", "model": "claude-opus-5-5", "env": "ANTHROPIC_API_KEY"}},
    {"id": "claude_haiku_5_5", "label": "Claude Haiku 5.5", "provider": "Anthropic",
     "tier": "fast", "in": 1.0, "out": 5.0,
     "api": {"kind": "anthropic", "model": "claude-haiku-5-5", "env": "ANTHROPIC_API_KEY"}},
    {"id": "gpt_5_1", "label": "GPT-5.1", "provider": "OpenAI",
     "tier": "balanced", "in": 1.25, "out": 10.0,
     "api": {"kind": "openai", "model": "gpt-5.1", "env": "OPENAI_API_KEY"}},
    {"id": "gpt5_mini", "label": "GPT-5 mini", "provider": "OpenAI",
     "tier": "fast", "in": 0.25, "out": 2.0,
     "api": {"kind": "openai", "model": "gpt-5-mini", "env": "OPENAI_API_KEY"}},
    {"id": "gpt5_nano", "label": "GPT-5 nano", "provider": "OpenAI",
     "tier": "cheapest", "in": 0.05, "out": 0.40,
     "api": {"kind": "openai", "model": "gpt-5-nano", "env": "OPENAI_API_KEY"}},
    {"id": "gemini_3_1_pro", "label": "Gemini 3.1 Pro", "provider": "Google",
     "tier": "quality", "in": 2.0, "out": 12.0,
     "api": {"kind": "openai", "model": "gemini-3.1-pro",
             "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
             "env": "GEMINI_API_KEY"}},
    {"id": "gemini_3_flash", "label": "Gemini 3 Flash", "provider": "Google",
     "tier": "fast", "in": 0.10, "out": 0.40,
     "api": {"kind": "openai", "model": "gemini-3-flash-preview",
             "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
             "env": "GEMINI_API_KEY"}},
    {"id": "grok_4_3", "label": "Grok 4.3", "provider": "xAI",
     "tier": "balanced", "in": 2.0, "out": 10.0,
     "api": {"kind": "openai", "model": "grok-4.3",
             "base_url": "https://api.x.ai/v1", "env": "XAI_API_KEY"}},
]

DEFAULT_MODEL = "claude_sonnet_5_5"
DEFAULT_ADVISOR = "claude_sonnet_5_5"

DEFAULT_SYSTEM = (
    "You are ChatCraft, a warm, concise personal-workspace assistant. "
    "Answer directly and helpfully. Use short paragraphs. Prefer plain language. "
    "FILE WRITING: when the user asks you to create, write or save a file, emit its full "
    "content as a fenced code block whose opening fence includes the language and filename, "
    "exactly like: ```markdown notes.md\\n...content...\\n```. The platform saves that file "
    "for the user automatically and shows it as a file card, so do NOT explain how to save "
    "or create the file manually - just confirm it was written. "
    "COMMANDS: when running a shell command would genuinely help (checking something, "
    "building, testing), emit it as a fenced block starting with ```run, like: "
    "```run\\npython script.py\\n```. The platform executes it in the workspace and shows "
    "the output. Use commands freely - you have a full shell in the user's cloud "
    "workspace (up to 10 commands per turn). "
    "BROWSING: to read a web page, emit a fenced block starting with ```browse "
    "containing just the URL, like: ```browse\\nhttps://example.com\\n```. The "
    "platform fetches the page, saves its readable text as browse-<site>.md in "
    "the workspace, and shows it as a file card. Use it whenever fresh web "
    "content would help. "
    "Only use run blocks when a command is genuinely useful; never use it for "
    "destructive operations. Ordinary code snippets stay in plain fences with no marker."
)

ADVISOR_SYSTEM = (
    "You are the Advisor: a strong reviewer that always runs before the main model. "
    "Given the selected parts of a conversation, produce a tight brief for it: "
    "(1) what the user really wants, (2) pitfalls or missing context to avoid, "
    "(3) how to make the answer high quality. Maximum 70 words. Plain text, "
    "no preamble."
)

LOCATOR_SYSTEM = (
    "You are the Advisor Locator: a fast, cheap scanner. You see an index of a "
    "conversation (message number, role, preview) and the workspace file list. "
    "Pick the MINIMAL set of parts a reviewer must read in full to brief the "
    "main model: the messages that carry the user's actual request or decisions, "
    "and files whose content matters. Reply with ONLY a JSON object, no prose "
    "or preamble: {\"messages\": [2, 4], \"files\": [\"notes.md\"]} "
    "Always include the latest user message."
)

LOCATOR_MODEL_ID = os.environ.get("CHATCRAFT_LOCATOR_MODEL", "claude_haiku_5_5")

# ```lang filename.ext ... ```   (also accepts ```lang:filename.ext)
# and the variant small local models often emit: ```lang\nfilename.ext\n...```
# The last two alternatives close on a \x00CMDn\x00 mark (a run block that
# was already extracted) — this is the "merged fence" case where a model
# writes ...content```run\ncmd``` with one shared fence.
FILE_BLOCK_RE = re.compile(
    r"```([\w+#-]*)[ \t]*:?[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*\n(.*?)```"
    r"|```([\w+#-]*)[ \t]*\n[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*\n(.*?)```"
    r"|```([\w+#-]*)[ \t]*:?[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*\n(.*?)(?=\x00CMD\d+\x00)"
    r"|```([\w+#-]*)[ \t]*\n[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*\n(.*?)(?=\x00CMD\d+\x00)",
    re.S)
# ```run\n command \n```
RUN_BLOCK_RE = re.compile(r"```run[ \t]*\n(.*?)```", re.S | re.I)
# placeholder left where a run block was, before file blocks are extracted
CMD_MARK_RE = re.compile(r"\x00CMD(\d+)\x00")
# narrowly-anchored fake shell prompts (never a mid-command "$"): a lone
# "$" prompt at line start, or the user@host ... $ form. "#" is deliberately
# NOT treated as a root prompt - that would rewrite shell comments.
PROMPT_NOISE_RE = re.compile(
    r"^\$[ \t]+"
    r"|^[\w.@-]+@[^\n$]*\$[ \t]+")


# ------------------------------------------------------------ model records ---

def load_custom_models():
    try:
        return json.loads(CUSTOM_FILE.read_text())
    except Exception:
        return []


def save_custom_models(models):
    try:
        CUSTOM_FILE.write_text(json.dumps(models, indent=2))
    except Exception:
        pass


def ollama_models():
    """Probe a local Ollama and return its installed models (honest: if it
    isn't running, nothing is listed)."""
    try:
        req = urllib.request.Request(OLLAMA_URL + "/api/tags")
        with urllib.request.urlopen(req, timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
        out = []
        for m in data.get("models", []):
            out.append({
                "id": "ollama:" + m["name"], "label": m["name"],
                "provider": "Ollama (local)", "tier": "local", "in": 0.0, "out": 0.0,
                "local": True,
                "api": {"kind": "openai", "model": m["name"],
                        "base_url": OLLAMA_URL + "/v1", "env": None},
                "_size": m.get("size", 0),
            })
        # largest first: when no hosted model is configured, the frontend
        # auto-picks the first usable model — prefer the most capable local one
        out.sort(key=lambda m: m["_size"], reverse=True)
        for m in out:
            del m["_size"]
        return out
    except Exception:
        return []


def model_configured(m):
    """A model is usable when its API key env var is set (custom endpoints and
    local models always count as configured — availability surfaces at call time)."""
    api = m.get("api") or {}
    env = api.get("env")
    if not env:
        return True
    return bool(os.environ.get(env))


def all_models():
    out = []
    for m in CATALOG:
        e = dict(m)
        e["configured"] = model_configured(m)
        if not e["configured"]:
            e["status"] = "needs " + m["api"]["env"]
        out.append(e)
    for m in ollama_models():
        e = dict(m)
        e["configured"] = True
        out.append(e)
    for m in load_custom_models():
        e = {k: v for k, v in m.items() if k != "api_key"}
        e.update({"custom": True, "configured": True})
        out.append(e)
    return out


def find_model(model_id):
    for m in CATALOG + ollama_models():
        if m["id"] == model_id:
            return m
    for m in load_custom_models():
        if m["id"] == model_id:
            return dict(m, custom=True)  # mark custom records for routing
    return None


def model_status(m):
    if m is None:
        return None, f"unknown model"
    if not model_configured(m):
        env = (m.get("api") or {}).get("env")
        return None, f"{m['label']} is not usable: set the {env} environment variable, or add a local/custom model"
    return m, None


# ------------------------------------------------------------- http helpers ---

def http_json(url, payload, headers=None, timeout=120):
    """POST JSON, return (status, parsed_body_or_text)."""
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return 0, str(e)[:300]


def http_sse(url, payload, headers=None, timeout=180):
    """POST JSON and yield SSE `data:` payloads as they arrive."""
    h = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("data:"):
                data = line[5:].strip()
                if data and data != "[DONE]":
                    try:
                        yield json.loads(data)
                    except json.JSONDecodeError:
                        pass


# ---------------------------------------------------------- provider streams ---

def stream_openai_compat(api, messages, system, max_tokens, temperature, api_key=""):
    """OpenAI-compatible chat completions (OpenAI, Gemini-compat, xAI, Ollama,
    LM Studio, vLLM...). Yields ('text', delta), ('usage', {...}) and
    ('model', provider-reported model name)."""
    base = api.get("base_url") or "https://api.openai.com/v1"
    body = {
        "model": api["model"], "messages": messages, "stream": True,
        "max_tokens": max_tokens, "stream_options": {"include_usage": True},
    }
    if system:
        body["messages"] = [{"role": "system", "content": system}] + messages
    if temperature is not None:
        body["temperature"] = temperature
    headers = {}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    usage = {"in": 0, "out": 0}
    got_text = False
    reported = None
    try:
        for ev in http_sse(base.rstrip("/") + "/chat/completions", body, headers):
            if ev.get("model"):
                reported = ev["model"]
            choices = ev.get("choices") or []
            if choices:
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    got_text = True
                    yield ("text", delta)
            if ev.get("usage"):
                usage = {"in": ev["usage"].get("prompt_tokens", 0) or 0,
                         "out": ev["usage"].get("completion_tokens", 0) or 0}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"provider returned HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"provider unreachable: {str(e)[:200]}")
    if not got_text:
        raise RuntimeError("provider streamed no text (check the model name)")
    yield ("usage", usage)
    if reported:
        yield ("model", reported)


def stream_anthropic(api, messages, system, max_tokens, temperature, api_key=""):
    """Anthropic Messages API (honours a custom base_url). Yields
    ('text', delta), ('usage', {...}) and ('model', reported name)."""
    base = (api.get("base_url") or "https://api.anthropic.com").rstrip("/")
    if base.endswith("/v1"):  # users often paste .../v1; we append /v1/... ourselves
        base = base[:-3]
    body = {"model": api["model"], "messages": messages,
            "max_tokens": max_tokens, "stream": True}
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    usage = {"in": 0, "out": 0}
    got_text = False
    reported = None
    try:
        for ev in http_sse(base + "/v1/messages", body, headers):
            etype = ev.get("type", "")
            if etype == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                got_text = True
                yield ("text", ev["delta"]["text"])
            elif etype == "message_start":
                msg = ev.get("message", {})
                usage["in"] = msg.get("usage", {}).get("input_tokens", 0)
                if msg.get("model"):
                    reported = msg["model"]
            elif etype == "message_delta":
                usage["out"] = ev.get("usage", {}).get("output_tokens", 0)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Anthropic returned HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"Anthropic unreachable: {str(e)[:200]}")
    if not got_text:
        raise RuntimeError("Anthropic streamed no text (check the model name)")
    yield ("usage", usage)
    if reported:
        yield ("model", reported)


def resolve_credentials(m):
    """Custom records carry api_key; catalog models read their env var."""
    return m.get("api_key", "") or os.environ.get((m.get("api") or {}).get("env") or "", "")


def model_stream(m, messages, system, max_tokens, temperature):
    """Route a model record to the right protocol. Yields ('text'|'usage'|'model', payload)."""
    api = dict(m.get("api") or {})
    api_key = resolve_credentials(m)
    if m.get("custom"):
        api = {"kind": "anthropic" if m.get("provider") == "anthropic-compat" else "openai",
               "model": m.get("model_name", ""), "base_url": m.get("base_url")}
    kind = api.get("kind", "openai")
    if kind == "anthropic":
        gen = stream_anthropic(api, messages, system, max_tokens, temperature, api_key)
    else:
        gen = stream_openai_compat(api, messages, system, max_tokens, temperature, api_key)
    usage = {"in": 0, "out": 0}
    reported = None
    for kind_, payload in gen:
        if kind_ == "text":
            yield ("text", payload)
        elif kind_ == "usage":
            usage = payload
        elif kind_ == "model":
            reported = payload
    if usage["in"] == 0 and usage["out"] == 0:
        # no usage reported: honest rough estimate so the cost line still shows
        usage = {"in": 0, "out": 0, "estimated": True}
    yield ("usage", usage)
    if reported:
        yield ("model", reported)


def _advisor_call(m, system, messages, max_tokens):
    """One-shot (non-streaming) call to a model's API.
    Returns (text, error, usage)."""
    api = dict(m.get("api") or {})
    api_key = resolve_credentials(m)
    if m.get("custom"):
        api = {"kind": "anthropic" if m.get("provider") == "anthropic-compat" else "openai",
               "model": m.get("model_name", ""), "base_url": m.get("base_url")}
    usage = {"in": 0, "out": 0}
    try:
        if api.get("kind") == "anthropic":
            base = (api.get("base_url") or "https://api.anthropic.com").rstrip("/")
            if base.endswith("/v1"):
                base = base[:-3]
            status, body = http_json(
                base + "/v1/messages",
                {"model": api["model"], "system": system, "messages": messages,
                 "max_tokens": max_tokens},
                headers={"x-api-key": api_key,
                         "anthropic-version": "2023-06-01"}, timeout=60)
            if status != 200:
                return "", f"HTTP {status}: {str(body)[:150]}", usage
            # gather text from every text block (thinking blocks carry none)
            text = "".join(b.get("text") or ""
                           for b in body.get("content") or []
                           if isinstance(b, dict)).strip()
            u = body.get("usage") or {}
            usage = {"in": u.get("input_tokens", 0) or 0, "out": u.get("output_tokens", 0) or 0}
            return text, "", usage
        base = (api.get("base_url") or "https://api.openai.com/v1").rstrip("/")
        status, body = http_json(
            base + "/chat/completions",
            {"model": api["model"], "messages": [{"role": "system", "content": system}] + messages,
             "max_tokens": max_tokens},
            headers={"Authorization": "Bearer " + api_key} if api_key else None, timeout=60)
        if status != 200:
            return "", f"HTTP {status}: {str(body)[:150]}", usage
        text = ((body.get("choices") or [{}])[0].get("message") or {}).get("content", "") or ""
        u = body.get("usage") or {}
        usage = {"in": u.get("prompt_tokens", 0) or 0, "out": u.get("completion_tokens", 0) or 0}
        return text, "", usage
    except Exception as e:
        return "", str(e)[:200], usage


def parse_locator_json(text):
    """Best-effort parse of the locator's selection."""
    import re as _re
    sel = {"messages": [], "files": []}
    try:
        m = _re.search(r"\{[^{}]*\}", text or "", _re.S)
        data = json.loads(m.group(0)) if m else {}
        if isinstance(data.get("messages"), list):
            sel["messages"] = [int(x) for x in data["messages"]
                              if isinstance(x, (int, float))]
        if isinstance(data.get("files"), list):
            sel["files"] = [str(x) for x in data["files"]]
    except Exception:
        pass
    return sel


def super_advisor_pass(advisor, locator, messages, available_files):
    """Two-stage advisor — big brain, minimal tokens.

    Stage 1 (cheap locator): sees only an index (role + 120-char preview per
    message, file names) and picks the minimal parts worth reading.
    Stage 2 (the advisor model): reads ONLY those messages/files in full and
    writes the brief.

    Returns (note, error, usage, info); usage is combined across stages and
    info carries the selection for honest step reporting.
    """
    info = {"total_messages": len(messages), "read_messages": 0,
            "located_files": [], "locator_usage": {"in": 0, "out": 0}}
    usage = {"in": 0, "out": 0}

    # ---- stage 1: locator scans a compact index, not the conversation ----
    sel = {"messages": [], "files": []}
    indexed = [(i, m) for i, m in enumerate(messages) if m.get("content")]
    if locator and len(indexed) > 1:
        index = [{"n": i, "role": m.get("role", "user"),
                  "preview": str(m["content"])[:120]} for i, m in indexed]
        files_idx = [f"{p.name} ({p.stat().st_size}B)" for p in available_files[:30]]
        text, lerr, lusage = _advisor_call(
            locator, LOCATOR_SYSTEM,
            [{"role": "user",
              "content": json.dumps({"conversation_index": index,
                                     "workspace_files": files_idx})}],
            150)
        info["locator_usage"] = lusage
        usage["in"] += lusage["in"]
        usage["out"] += lusage["out"]
        if not lerr and text:
            sel = parse_locator_json(text)

    # the latest user message is always read
    last_user = max((i for i, m in indexed if m.get("role") == "user"), default=None)
    if last_user is not None and last_user not in sel["messages"]:
        sel["messages"].append(last_user)

    # ---- stage 2: the advisor reads only the located parts ----
    selected = [messages[i] for i in sorted(set(sel["messages"]))
                if 0 <= i < len(messages) and messages[i].get("content")]
    if not selected:  # locator unavailable/failed: honest fallback
        selected = [m for m in messages if m.get("content")][-4:]
    info["read_messages"] = len(selected)

    file_parts = []
    by_name = {p.name: p for p in available_files}
    for fname in sel["files"][:3]:
        p = by_name.get(fname)
        if p is None:
            continue
        try:
            content = p.read_text(encoding="utf-8")[:8000]
            file_parts.append(f"[workspace file {p.name}]\n{content}")
            info["located_files"].append(p.name)
        except Exception:
            pass
    if file_parts:
        selected = selected + [{"role": "user",
                                "content": "(workspace files for reference)\n" +
                                            "\n\n".join(file_parts)}]

    # generous budget: thinking blocks can consume tokens before the brief
    note, aerr, ausage = _advisor_call(advisor, ADVISOR_SYSTEM, selected, 700)
    usage["in"] += ausage["in"]
    usage["out"] += ausage["out"]
    if not aerr and not note:
        aerr = "advisor returned an empty review"
    return note, aerr, usage, info


# ------------------------------------------------------------ file + command ---

def file_record(path: Path):
    st = path.stat()
    return {"name": path.name, "size": st.st_size,
            "modified": time.strftime("%H:%M", time.localtime(st.st_mtime))}


def parse_blocks(text):
    """Sequentially split a model reply into text / file / run blocks.

    A real line scanner (not overlapping regexes): every line belongs to at
    most one block, so a malformed merged fence (file content directly
    followed by a ```run opener sharing the file's closing fence) cannot
    swallow a later file. Handles the two spellings small local models use:
    ```lang filename.ext\n... and ```lang\nfilename.ext\n...
    """
    lines = text.split("\n")
    blocks = []
    cur = []

    def flush():
        if cur:
            blocks.append(("text", "\n".join(cur)))
            del cur[:]

    i, n = 0, len(lines)
    while i < n:
        ln = lines[i]
        run_open = re.match(r"^```run[ \t]*$", ln, re.I)
        browse_open = re.match(r"^```browse[ \t]*$", ln, re.I)
        file_open = re.match(
            r"^```([\w+#-]*)[ \t]*:?[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*$", ln)
        bare_open = re.match(r"^```([\w+#-]*)[ \t]*$", ln)
        fname_next = i + 1 < n and re.match(
            r"^[\w./-]+\.[\w+#-]+$", lines[i + 1].strip())
        if run_open:
            j = i + 1
            cmd = []
            while j < n and not lines[j].strip().startswith("```"):
                cmd.append(lines[j])
                j += 1
            if j >= n:
                # unterminated (e.g. truncated mid-stream): keep as text,
                # never execute a partial command
                cur.append(ln)
                i += 1
                continue
            flush()
            blocks.append(("run", "\n".join(cmd).strip()))
            i = j + 1
            continue
        if browse_open:
            j = i + 1
            url = []
            while j < n and not lines[j].strip().startswith("```"):
                url.append(lines[j])
                j += 1
            if j >= n:
                # unterminated: keep as text, never fetch a partial URL
                cur.append(ln)
                i += 1
                continue
            flush()
            blocks.append(("browse", "\n".join(url).strip()))
            i = j + 1
            continue
        if file_open:
            lang, name = file_open.group(1) or "", file_open.group(2)
            j = i + 1
            content = []
            while j < n and not lines[j].strip().startswith("```"):
                content.append(lines[j])
                j += 1
            if j >= n:
                # unterminated: keep as text, never write a partial file
                cur.append(ln)
                i += 1
                continue
            flush()
            blocks.append(("file", lang, name, "\n".join(content)))
            # merged fence: the closing line is itself a ```run opener -
            # close the file but reprocess that line as a run block
            i = j if (j < n and re.match(r"^```run", lines[j], re.I)) else j + 1
            continue
        if bare_open:
            if fname_next:
                lang = bare_open.group(1) or ""
                name = lines[i + 1].strip()
                j = i + 2
                content = []
                while j < n and not lines[j].strip().startswith("```"):
                    content.append(lines[j])
                    j += 1
                if j >= n:
                    # unterminated: keep as text
                    cur.append(ln)
                    i += 1
                    continue
                flush()
                blocks.append(("file", lang, name, "\n".join(content)))
                i = j if (j < n and re.match(r"^```run", lines[j], re.I)) else j + 1
                continue
            # ordinary code block: consume it through its closing fence as
            # inert text so a filename-like line after the closer is never
            # reinterpreted as a file block opener
            j = i + 1
            while j < n and not lines[j].strip().startswith("```"):
                j += 1
            end = j + 1 if j < n else n
            cur.extend(lines[i:end])
            i = end
            continue
        cur.append(ln)
        i += 1
    flush()
    return blocks


def extract_files(text):
    """Compatibility wrapper over parse_blocks: (cleaned text, files)."""
    parts, files = [], []
    for b in parse_blocks(text):
        if b[0] == "text":
            parts.append(b[1])
        elif b[0] == "file":
            files.append({"name": Path(b[2]).name, "lang": b[1] or "text",
                          "content": b[3].rstrip("\n")})
            parts.append("wrote file: " + Path(b[2]).name)
        elif b[0] == "browse":
            parts.append("(browsing " + b[1].splitlines()[0][:80] + "…)")
        else:
            parts.append("```run\n" + b[1] + "\n```")
    return "\n".join(parts), files


def normalize_cmd(cmd):
    """Strip narrowly-anchored fake shell prompts ("$ ls",
    "user@host:~$ ls") that small local models prepend. Only forms anchored
    at the line start are touched, so ordinary commands (echo $HOME,
    echo '$ x', # comments) are never rewritten."""
    cmd = cmd.strip()
    first, sep, rest = cmd.partition("\n")
    if PROMPT_NOISE_RE.match(first):
        stripped = PROMPT_NOISE_RE.sub("", first, count=1).lstrip()
        if stripped:
            cmd = stripped + (sep + rest if sep else "")
    return cmd.strip()


def extract_runs(text):
    return [normalize_cmd(b[1]) for b in parse_blocks(text)
            if b[0] == "run" and normalize_cmd(b[1])]


def extract_browses(text):
    """URLs from ```browse blocks: first line, scheme-normalized."""
    urls = []
    for b in parse_blocks(text):
        if b[0] != "browse":
            continue
        first = (b[1].splitlines() or [""])[0].strip()
        if not first:
            continue
        if not first.startswith(("http://", "https://")):
            first = "https://" + first
        if first not in urls:
            urls.append(first)
    return urls


def fetch_page(url):
    """Fetch a page and extract its readable text. Returns (text, title, err)."""
    import html as _html
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent":
                          "Mozilla/5.0 (compatible; ChatCraftBot/1.0)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(500_000).decode("utf-8", "replace")
        title = ""
        m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
        if m:
            title = re.sub(r"\s+", " ", _html.unescape(m.group(1))).strip()[:120]
        body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw,
                      flags=re.I | re.S)
        body = re.sub(r"<[^>]+>", " ", body)
        body = _html.unescape(re.sub(r"[ \t]+", " ", body))
        body = re.sub(r"\n\s*\n+", "\n", body).strip()
        return body[:8000], title, ""
    except Exception as e:
        return "", "", str(e)[:150]


def run_command(cmd):
    """Run one command inside the workspace. Returns (returncode, output)."""
    try:
        p = subprocess.run(cmd, shell=True, cwd=str(FILES_DIR), capture_output=True,
                           text=True, timeout=CMD_TIMEOUT)
        out = (p.stdout or "") + (p.stderr or "")
        return p.returncode, out[:4000]
    except subprocess.TimeoutExpired:
        return -1, f"timed out after {CMD_TIMEOUT}s"
    except Exception as e:
        return -1, str(e)[:300]


# ------------------------------------------------------------------- server ---

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log(self, *a):  # quiet
        pass

    # -- helpers
    def _authorized(self):
        """True when the request carries the access code (if one is set)."""
        if not ACCESS_CODE:
            return True
        return (self.headers.get("X-Access-Code") or "") == ACCESS_CODE

    def do_OPTIONS(self):
        """CORS preflight for the GitHub Pages frontend (and any allowed origin)."""
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-Access-Code")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._send(403, {"error": "cross-origin request rejected"})

    def _send(self, code, body, ctype="application/json", extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _origin_ok(self):
        """Reject cross-origin mutations: browsers always send Origin on
        cross-site requests; same-origin/curl/tools send none or a matching one.
        Origins listed in CHATCRAFT_ALLOWED_ORIGINS are also accepted (reverse
        proxies that rewrite Host make the default Host check unusable)."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        if origin == "null":
            return ALLOW_NULL_ORIGIN
        if origin.rstrip("/") in ALLOWED_ORIGINS:
            return True
        host = self.headers.get("Host", "")
        try:
            return urllib.parse.urlparse(origin).netloc == host
        except Exception:
            return False

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def _sse(self, gen):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            for chunk in gen:
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    # -- static
    def do_GET(self):
        if self.path.startswith("/api/") and not self._authorized():
            return self._send(401, {"error": "access code required"})

        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            return self._send(200, (BASE_DIR / "index.html").read_bytes(),
                              "text/html; charset=utf-8")
        if path == "/wallpaper.jpg":
            return self._send(200, (BASE_DIR / "wallpaper.jpg").read_bytes(),
                              "image/jpeg", {"Cache-Control": "public, max-age=86400"})
        if path == "/api/health":
            return self._send(200, {"ok": True, "models": len(all_models()),
                                    "allow_commands": ALLOW_CMDS})
        if path == "/api/models":
            return self._send(200, {"models": all_models(), "default": DEFAULT_MODEL,
                                    "advisor_default": DEFAULT_ADVISOR})
        if path == "/api/files":
            files = [file_record(p) for p in sorted(
                FILES_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True)
                if p.is_file()]
            return self._send(200, {"files": files})
        if path.startswith("/api/files/"):
            name = Path(urllib.parse.unquote(path.split("/api/files/")[1])).name
            fp = FILES_DIR / name
            if not fp.is_file():
                return self._send(404, {"error": "no such file"})
            return self._send(200, {"name": name, "content": fp.read_text(encoding="utf-8"),
                                    "size": fp.stat().st_size})
        if path == "/api/custom-models":
            return self._send(200, {"models": [
                {k: v for k, v in m.items() if k != "api_key"} | {"custom": True}
                for m in load_custom_models()]})
        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/") and not self._authorized():
            return self._send(401, {"error": "access code required"})

        if not self._origin_ok():
            return self._send(403, {"error": "cross-origin request rejected"})
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/files/"):
            name = Path(urllib.parse.unquote(path.split("/api/files/")[1])).name
            fp = FILES_DIR / name
            if fp.is_file():
                fp.unlink()
            return self._send(200, {"ok": True})
        if path.startswith("/api/custom-models/"):
            mid = urllib.parse.unquote(path.split("/api/custom-models/")[1])
            save_custom_models([m for m in load_custom_models() if m["id"] != mid])
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.startswith("/api/") and not self._authorized():
            return self._send(401, {"error": "access code required"})

        if not self._origin_ok():
            return self._send(403, {"error": "cross-origin request rejected"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/custom-models":
            m = self._body()
            if not m.get("base_url") or not m.get("model_name"):
                return self._send(400, {"error": "base_url and model_name are required"})
            models = [x for x in load_custom_models() if x["id"] != m.get("id")]
            models.append({
                "id": m.get("id") or m["model_name"], "label": m.get("label") or m["model_name"],
                "provider": m.get("provider", "openai-compat"), "base_url": m["base_url"],
                "api_key": m.get("api_key", ""), "model_name": m["model_name"],
            })
            save_custom_models(models)
            return self._send(200, {"ok": True, "models": [
                {k: v for k, v in x.items() if k != "api_key"} | {"custom": True}
                for x in models]})
        if path == "/api/run":
            body = self._body()
            if not ALLOW_CMDS:
                return self._send(403, {"error": "command execution is disabled "
                                                 "(CHATCRAFT_ALLOW_CMDS=0)"})
            if not body.get("command"):
                return self._send(400, {"error": "command is required"})
            rc, out = run_command(body["command"])
            return self._send(200, {"returncode": rc, "output": out})
        if path == "/api/chat":
            return self._api_chat(self._body())
        return self._send(404, {"error": "not found"})

    # -- the harness
    def _api_chat(self, req):
        def sse():
            def ev(name, data):
                return f"event: {name}\ndata: {json.dumps(data)}\n\n"

            def step(id_, label, state, detail=None):
                d = {"id": id_, "label": label, "state": state}
                if detail is not None:
                    d["detail"] = detail
                return ev("step", d)

            messages = [m for m in (req.get("messages") or [])
                        if m.get("role") in ("user", "assistant") and m.get("content")][-12:]
            if not messages:
                yield ev("error", {"error": "no messages"})
                return

            model = find_model(req.get("model") or DEFAULT_MODEL)
            model, err = model_status(model)
            if err:
                yield ev("error", {"error": err + " — see Settings > Models to add Ollama or a custom endpoint"})
                return

            advisor_id = req.get("advisor_model") or DEFAULT_ADVISOR
            advisor = find_model(advisor_id)
            advisor, adv_err = model_status(advisor)

            try:
                # 1. read the conversation
                yield step("read", f"Read conversation ({len(messages)} messages)", "done")

                # 2. list the workspace files; bounded-read any file the user references
                files_now = [p for p in FILES_DIR.iterdir() if p.is_file()]
                if files_now:
                    listing = ", ".join(f"{p.name} ({p.stat().st_size}B)" for p in files_now[:30])
                    yield step("workspace", "Listing workspace files", "done", listing)
                else:
                    yield step("workspace", "Workspace empty", "done")
                last_user = next((m["content"] for m in reversed(messages)
                                  if m["role"] == "user"), "") or ""
                file_contents = {}
                for p in files_now:
                    if p.name in last_user and p.stat().st_size <= 8192:
                        sid = "read-" + p.name
                        yield step(sid, f"Reading {p.name}", "run")
                        try:
                            file_contents[p.name] = p.read_text(encoding="utf-8")[:8000]
                            yield step(sid, f"Read {p.name}", "done",
                                       f"{p.stat().st_size}B into context")
                        except Exception:
                            yield step(sid, f"Couldn't read {p.name}", "fail",
                                       "not readable as text")

                # 3. advisor pass — always on, runs live inside the stream
                advisor_usage, advisor_cost = {"in": 0, "out": 0}, 0.0
                advisor_note = ""
                if advisor:
                    locator = find_model(LOCATOR_MODEL_ID)
                    if locator:
                        yield step("advisor-locate", "Locating relevant parts", "run")
                    yield step("advisor", f"Advisor review ({advisor['label']})", "run")
                    note, aerr, advisor_usage, ainfo = super_advisor_pass(
                        advisor, locator, messages, files_now)
                    am = find_model(advisor_id) or {}
                    lm = find_model(LOCATOR_MODEL_ID) or {}
                    if lm and not lm.get("custom") and not lm.get("local"):
                        advisor_cost = estimate_cost(
                            lm, ainfo["locator_usage"]["in"], ainfo["locator_usage"]["out"])
                    if am and not am.get("custom") and not am.get("local"):
                        advisor_cost += estimate_cost(
                            am,
                            advisor_usage["in"] - ainfo["locator_usage"]["in"],
                            advisor_usage["out"] - ainfo["locator_usage"]["out"])
                    if locator:
                        loc_detail = (f"{ainfo['read_messages']}/{ainfo['total_messages']} messages"
                                      + (f", {len(ainfo['located_files'])} files"
                                         if ainfo["located_files"] else ""))
                        yield step("advisor-locate", "Located relevant parts", "done", loc_detail)
                    if aerr:
                        # honest failure surfaced in the UI; the turn continues
                        yield ev("advisor-error", {"error": aerr})
                        yield step("advisor", "Advisor unavailable", "done")
                    else:
                        advisor_note = note
                        yield step("advisor", "Advisor review", "done")
                        yield ev("advisor", {"note": note})
                else:
                    yield ev("advisor-error", {"error": adv_err or "advisor model unknown"})
                    yield step("advisor", "Advisor unavailable", "done")

                # 4. stream the main model's reply
                system = req.get("system_prompt") or DEFAULT_SYSTEM
                if files_now:
                    system += ("\n\nWORKSPACE: the user's workspace already contains: "
                               + ", ".join(p.name for p in files_now[:30]) + ".")
                for fname, fcontent in file_contents.items():
                    system += (f"\n\nFILE {fname} (current contents):\n{fcontent}")
                if advisor_note:
                    system += (f"\n\nYour advisor reviewed this conversation and suggests: "
                               f"\"{advisor_note}\" Follow the advisor's guidance where it helps.")
                yield step("write", f"Writing reply ({model['label']})", "run")
                chunks, usage, reported_model = [], {"in": 0, "out": 0}, None
                for kind, payload in model_stream(
                        model, messages, system,
                        int(req.get("max_tokens") or 1024),
                        float(req.get("temperature") or 0.7)):
                    if kind == "text" and payload:
                        chunks.append(payload)
                        yield ev("text", {"delta": payload})
                    elif kind == "usage":
                        usage = payload
                    elif kind == "model":
                        reported_model = payload
                yield step("write", "Writing reply", "done")

                full_text = "".join(chunks)

                # 5. extract files + commands, then show the cleaned reply.
                # parse_blocks scans line-by-line so malformed merged fences
                # can't swallow a later block; each block gets its OWN
                # execution record (index -> exit code), so duplicate command
                # strings can never borrow a sibling's result. The final
                # `clean` event reports ran/failed/not-run honestly AFTER
                # execution.
                blocks = parse_blocks(full_text)
                run_idx = [i for i, b in enumerate(blocks) if b[0] == "run"
                           and normalize_cmd(b[1])]
                cleaned, files = extract_files(full_text)
                saved = []
                if files:
                    import difflib
                    for f in files:
                        sid = "file-" + Path(f["name"]).name
                        safe = FILES_DIR / Path(f["name"]).name
                        existed = safe.exists()
                        old_lines = (safe.read_text(encoding="utf-8",
                                                    errors="replace").splitlines()
                                     if existed else [])
                        yield step(sid, f"Writing {f['name']}", "run")
                        safe.write_text(f["content"], encoding="utf-8")
                        new_lines = f["content"].splitlines()
                        adds = dels = 0
                        if existed:
                            for op, i1, i2, j1, j2 in difflib.SequenceMatcher(
                                    None, old_lines, new_lines,
                                    autojunk=False).get_opcodes():
                                if op == "insert":
                                    adds += j2 - j1
                                elif op == "delete":
                                    dels += i2 - i1
                                elif op == "replace":
                                    adds += j2 - j1
                                    dels += i2 - i1
                        rec = {"name": safe.name, "lang": f.get("lang") or "text",
                               "size": safe.stat().st_size}
                        if existed:
                            rec["adds"], rec["dels"] = adds, dels
                            label = f"Edited {safe.name} +{adds} -{dels}"
                        else:
                            label = f"Created {safe.name}"
                        saved.append(rec)
                        yield step(sid, label, "done")
                    pre = []
                    for b in blocks:
                        if b[0] == "text":
                            pre.append(b[1])
                        elif b[0] == "file":
                            pre.append("wrote file: " + Path(b[2]).name)
                        elif normalize_cmd(b[1]):
                            pre.append("(running command…)")
                    yield ev("files", {"files": saved, "cleaned_text": "\n".join(pre)})

                # 6. run commands the reply contains (max 5 per turn)
                rc_by_block = {}  # block index -> exit code, only blocks run
                for n_run, bi in enumerate(run_idx[:10]):
                    cmd = normalize_cmd(blocks[bi][1])
                    sid = f"cmd-{n_run + 1}"
                    if not ALLOW_CMDS:
                        yield step(sid, "Commands disabled", "skip",
                                   "set CHATCRAFT_ALLOW_CMDS=1 to enable")
                        continue
                    yield step(sid, f"Running: {cmd[:60]}", "run")
                    rc, out = run_command(cmd)
                    first = (out.strip().splitlines() or [""])[0][:120]
                    state = "done" if rc == 0 else "fail"
                    label = (f"Ran: {cmd[:60]} (exit {rc})" if rc == 0
                             else f"Failed: {cmd[:60]} (exit {rc})")
                    yield step(sid, label, state, first)
                    yield ev("command", {"command": cmd, "returncode": rc, "output": out[:2000]})
                    rc_by_block[bi] = rc
                if run_idx:
                    parts = []
                    for i, b in enumerate(blocks):
                        if b[0] == "text":
                            parts.append(b[1])
                        elif b[0] == "file":
                            parts.append("wrote file: " + Path(b[2]).name)
                        elif b[0] == "browse":
                            u = (b[1].splitlines() or [""])[0][:80]
                            parts.append("(browsing " + u + "…)")
                            continue
                        else:
                            c = normalize_cmd(b[1])
                            if not c:
                                continue
                            if i in rc_by_block:
                                rc = rc_by_block[i]
                                parts.append(f"ran: {c[:60]}" if rc == 0
                                             else f"failed (exit {rc}): {c[:60]}")
                            else:
                                parts.append("skipped: commands disabled" if not ALLOW_CMDS
                                             else f"not run (over the 10-command limit): {c[:60]}")
                    yield ev("clean", {"text": "\n".join(parts)})

                # 7. browse: fetch pages the reply references (max 5 per turn)
                browses = extract_browses(full_text)
                for n_br, url in enumerate(browses[:5]):
                    sid = f"browse-{n_br + 1}"
                    yield step(sid, f"Browsing {url[:70]}", "run")
                    text_body, title, berr = fetch_page(url)
                    if berr:
                        yield step(sid, f"Couldn\'t fetch {url[:60]}", "fail", berr)
                        continue
                    domain = urllib.parse.urlparse(url).netloc or "page"
                    safe_name = re.sub(r"[^\w.-]+", "-", domain)[:40] or "page"
                    fname = f"browse-{safe_name}.md"
                    content = (f"# {title or url}\n\nsource: {url}\n\n"
                              + text_body)
                    (FILES_DIR / fname).write_text(content, encoding="utf-8")
                    saved.append({"name": fname, "lang": "markdown",
                                  "size": len(content)})
                    yield ev("browse", {"url": url, "title": title,
                                         "chars": len(text_body), "file": fname})
                    yield step(sid, f"Browsed {domain[:40]}", "done",
                               f"saved {len(text_body)} chars to {fname}")
                if browses:
                    parts = []
                    for i, b in enumerate(blocks):
                        if b[0] == "text":
                            parts.append(b[1])
                        elif b[0] == "file":
                            parts.append("wrote file: " + Path(b[2]).name)
                        elif b[0] == "browse":
                            u = (b[1].splitlines() or [""])[0][:80]
                            parts.append("browsed: " + u)
                        else:
                            c = normalize_cmd(b[1])
                            if not c:
                                continue
                            if i in rc_by_block:
                                rc = rc_by_block[i]
                                parts.append(f"ran: {c[:60]}" if rc == 0
                                             else f"failed (exit {rc}): {c[:60]}")
                            else:
                                parts.append("skipped: commands disabled" if not ALLOW_CMDS
                                             else f"not run (over the 10-command limit): {c[:60]}")
                    yield ev("clean", {"text": "\n".join(parts)})

                custom = bool(model.get("custom"))
                local = bool(model.get("local"))
                cost = 0.0 if (custom or local) else estimate_cost(
                    model, usage.get("in", 0), usage.get("out", 0))
                total = None if custom else round(cost + advisor_cost, 6)
                done = {
                    "usage": usage, "cost_usd": round(cost, 6),
                    "advisor_usage": advisor_usage,
                    "advisor_cost_usd": round(advisor_cost, 6),
                    "total_cost_usd": total,
                    "model": model["id"], "cost_known": not custom,
                    "files": [f["name"] for f in saved],
                }
                if local:
                    # local model: main cost is $0, but a paid advisor still counts
                    done.update({"cost_usd": 0.0,
                                 "total_cost_usd": round(advisor_cost, 6),
                                 "cost_known": True, "local": True})
                if reported_model and reported_model != model["id"]:
                    done["reported_model"] = reported_model
                yield ev("done", done)
            except Exception as e:
                yield ev("error", {"error": str(e)[:300]})

        self._sse(sse())


def estimate_cost(model, in_tokens, out_tokens):
    return (in_tokens / 1e6) * model.get("in", 1.0) + (out_tokens / 1e6) * model.get("out", 5.0)


if __name__ == "__main__":
    print(f"ChatCraft backend on http://{HOST}:{PORT}")
    print(f"  workspace: {FILES_DIR}")
    print(f"  commands:  {'enabled' if ALLOW_CMDS else 'DISABLED (CHATCRAFT_ALLOW_CMDS=0)'}")
    print(f"  ollama:    {OLLAMA_URL} (auto-detected if running)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
