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
import base64
import difflib
import hmac
import json
import queue
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
PROJECTS_FILE = DATA_DIR / "projects.json"
AGENTS_FILE = DATA_DIR / "agents.json"
SKILLS_FILE = DATA_DIR / "skills.json"
AUTOMATIONS_FILE = DATA_DIR / "automations.json"
USAGE_LOG_FILE = DATA_DIR / "usage-log.json"

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
    "You are ChatCraft, a concise personal-workspace assistant. Answer directly, "
    "short paragraphs, plain language.\n"
    "FILES: to write a file, emit its full content in a fenced block whose opening "
    "fence carries language + filename: ```markdown notes.md\\n...content...\\n``` "
    "— the platform saves it automatically; just confirm, never explain manual saving.\n"
    "SHELL: to run a command in the user's cloud workspace emit ```run\\n<command>\\n``` "
    "(max 10/turn, never destructive). The platform runs it and returns the output.\n"
    "BROWSE: to read a web page emit ```browse\\n<url>\\n``` — the platform fetches "
    "it and saves the readable text as browse-<site>.md.\n"
    "BROWSER: to drive a real browser (click links, fill forms), emit a "
    "```browser block with ONE ACTION PER LINE: goto <url>, click <n>, "
    "type <n>: <text>, scroll up|down, back, click_xy <x> <y> (viewport "
    "pixel coordinates), press <key> (Enter, Tab, Escape...), wait <ms>. "
    "Each action returns the page state with numbered elements (numbered "
    "from 1) and the viewport size — chain actions across lines using "
    "those numbers or coordinates.\n"
    "PHONE: if the user has paired an Android phone (the ChatCraft APK), "
    "you can drive it: emit a ```phone block with ONE ACTION PER LINE: "
    "state (read the screen: numbered elements with coordinates), "
    "tap <x> <y>, text <msg>, swipe up|down|left|right, enter, back, home, "
    "open <package-or-url>. Each action returns the new screen state. "
    "If no phone is paired, say so — never fake phone actions.\n"
    "When tool results come back, use them to finish the answer. Ordinary code "
    "snippets stay in plain fences with no filename or marker."
)

ADVISOR_SYSTEM = (
    "You are the Advisor: a strong reviewer that always runs before the main model. "
    "Given the selected parts of a conversation, produce a tight brief: "
    "(1) what the user really wants, (2) pitfalls or missing context to avoid, "
    "(3) how to make the answer high quality. Maximum 50 words — if the request "
    "is simple, one short line is enough. Plain text, no preamble."
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


def locator_for(advisor_id):
    """A cheap scanner from the SAME family as the advisor, so only the
    user's chosen model (or its cheaper same-family sibling) ever reads
    the conversation. Unknown/local/custom models scan themselves — never
    a silently-configured default like Claude."""
    a = str(advisor_id or "")
    fam = a.lower()
    if fam.startswith("claude"):
        return "claude_haiku_5_5"
    if fam.startswith("gpt"):
        return "gpt5_nano"
    if fam.startswith("gemini"):
        return "gemini_3_flash"
    if fam.startswith("grok"):
        return "grok_4_3"
    return a or LOCATOR_MODEL_ID  # the chosen model scans itself

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
    finish = None
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
                fr = choices[0].get("finish_reason")
                if fr:
                    finish = fr
            if ev.get("usage"):
                usage = {"in": ev["usage"].get("prompt_tokens", 0) or 0,
                         "out": ev["usage"].get("completion_tokens", 0) or 0}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"provider returned HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"provider unreachable: {str(e)[:200]}")
    if not got_text:
        raise RuntimeError("provider streamed no text (check the model name)")
    if finish:
        yield ("finish", finish)
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
    finish = None
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
                sr = (ev.get("delta") or {}).get("stop_reason")
                if sr:
                    finish = sr
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Anthropic returned HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"Anthropic unreachable: {str(e)[:200]}")
    if not got_text:
        raise RuntimeError("Anthropic streamed no text (check the model name)")
    if finish:
        yield ("finish", finish)
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
    finish = None
    for kind_, payload in gen:
        if kind_ == "text":
            yield ("text", payload)
        elif kind_ == "usage":
            usage = payload
        elif kind_ == "model":
            reported = payload
        elif kind_ == "finish":
            finish = payload
    if usage["in"] == 0 and usage["out"] == 0:
        # no usage reported: honest rough estimate so the cost line still shows
        usage = {"in": 0, "out": 0, "estimated": True}
    if finish:
        yield ("finish", finish)
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
    # Cheap-mode rule: for a short conversation where no workspace file is
    # actually relevant there is nothing to locate — the advisor just reads
    # everything (skipping the locator call saves its tokens + latency).
    # Files count as relevant only if one is named in the latest user
    # message, or the message refers to files/workspace generically.
    sel = {"messages": [], "files": []}
    indexed = [(i, m) for i, m in enumerate(messages) if m.get("content")]
    last_user_text = next((str(m.get("content")) for m in reversed(messages)
                            if m.get("role") == "user"), "")
    files_relevant = bool(available_files) and (
        any(p.name in last_user_text for p in available_files)
        or bool(re.search(r"\b(files?|workspace|documents?)\b",
                          last_user_text, re.I)))
    use_locator = bool(locator) and (len(indexed) > 3 or files_relevant)
    info["locator_used"] = use_locator
    if use_locator:
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
    elif indexed:
        # bypassed: short conversation, nothing to locate — read it all
        sel["messages"] = [i for i, _ in indexed]

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


def cleaned_text(blocks, rc_by_block, browse_by_block=None, cmds_pending=False):
    """The user-facing reply: model prose kept, tool blocks replaced by
    one-line status notes (the steps UI expands on them). browse_by_block
    maps block index -> (ok, detail) once browsing ran, so fetch failures
    and budget-skips are labelled honestly per block."""
    parts = []
    for i, b in enumerate(blocks):
        if b[0] == "text":
            parts.append(b[1])
        elif b[0] == "file":
            parts.append("wrote file: " + Path(b[2]).name)
        elif b[0] == "browser":
            blines = b[1].splitlines() or [""]
            parts.append("browser: " + blines[0][:60]
                         + ("…" if len(blines) > 1 else ""))
        elif b[0] == "phone":
            plines = b[1].splitlines() or [""]
            parts.append("phone: " + plines[0][:60]
                         + ("…" if len(plines) > 1 else ""))
        elif b[0] == "browse":
            u = (b[1].splitlines() or [""])[0][:80]
            if browse_by_block is None:
                parts.append("(browsing " + u + "…)")
            elif i in browse_by_block:
                ok, detail = browse_by_block[i]
                parts.append("browsed: " + u if ok
                             else f"couldn't fetch: {u} ({str(detail)[:40]})")
            else:
                parts.append("not fetched (per-turn limit reached): " + u)
        else:
            c = normalize_cmd(b[1])
            if not c:
                continue
            if cmds_pending:
                parts.append("(running command…)")
            elif i in rc_by_block:
                rc = rc_by_block[i]
                parts.append(f"ran: {c[:60]}" if rc == 0
                             else f"failed (exit {rc}): {c[:60]}")
            else:
                parts.append("skipped: commands disabled" if not ALLOW_CMDS
                             else f"not run (per-turn limit reached): {c[:60]}")
    return "\n".join(parts)


def build_obs(cmd_log, browse_log, browser_log=None, phone_log=None, cap=9000):
    """Bounded packing of tool results for the continuation: every
    operation's identity and outcome ALWAYS ships (compact status lines);
    output excerpts fill the remaining budget; anything left out is
    explicitly marked with an omission note (never silently dropped)."""
    status = []
    for cmd, rc, out in cmd_log:
        c = str(cmd)[:100]
        status.append(f"$ {c} — exit {rc}" if rc is not None
                      else f"$ {c} — SKIPPED: {str(out)[:100]}")
    for url, title, body in browse_log:
        u = str(url)[:100]
        status.append(f"[{u} — {title}]" if title is not None
                      else f"[{u} — {str(body)[:100]}]")
    for line, ok, detail in (browser_log or []):
        status.append(f"browser {str(line).strip()[:80]} — "
                      + ("ok" if ok else f"FAILED: {str(detail)[:60]}"))
    for line, ok, detail in (phone_log or []):
        status.append(f"phone {str(line).strip()[:80]} — "
                      + ("ok" if ok else f"FAILED: {str(detail)[:60]}"))
    status_text = "\n".join(status)
    if len(status_text) > cap - 800:
        status_text = (status_text[:cap - 800]
                       + "\n…[status list truncated to fit]")
    details, omitted = [], 0
    budget = cap - len(status_text) - 600
    for cmd, rc, out in cmd_log:
        if rc is None:
            continue  # skips carry no output; their status line shipped
        details.append(f"$ {cmd}\n(exit {rc})\n{out.strip()[:1200]}")
    for url, title, body in browse_log:
        if title is None:
            continue  # failures shipped as status lines
        details.append(f"[browsed {url} — {title}]\n{body[:2500]}")
    for line, ok, detail in (browser_log or []):
        if ok:
            details.append(f"[browser {str(line).strip()[:60]} →\n{detail}]")
    for line, ok, detail in (phone_log or []):
        if ok:
            details.append(f"[phone {str(line).strip()[:60]} →\n{detail}]")
    packed, used = [], 0
    for d in details:
        if used + len(d) <= budget:
            packed.append(d)
            used += len(d)
        else:
            room = budget - used
            if room > 300:
                packed.append(d[:room] + "\n…[excerpt truncated to fit]")
                used = budget
            else:
                omitted += 1
    note = (f"\n\n[{omitted} operation(s) had output details omitted to fit "
            "the context — the compact status above is complete; ask to re-run "
            "a command or read the saved browse file for the full output]"
            if omitted else "")
    return status_text + "\n\n" + "\n\n".join(packed) + note


def echo_text(rtext):
    """Compact echo of a model reply for the continuation conversation:
    file contents elided (the model just wrote them), tool blocks short."""
    parts = []
    for b in parse_blocks(rtext):
        if b[0] == "text":
            parts.append(b[1])
        elif b[0] == "file":
            parts.append(f"(wrote file {b[2]})")
        else:
            parts.append(b[1][:150])
    return "\n".join(parts)[:6000]


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
        browser_open = re.match(r"^```browser[ \t]*$", ln, re.I)
        phone_open = re.match(r"^```phone[ \t]*$", ln, re.I)
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
        if browser_open or phone_open:
            j = i + 1
            acts = []
            while j < n and not lines[j].strip().startswith("```"):
                acts.append(lines[j])
                j += 1
            if j >= n:
                # unterminated: keep as text, never run partial actions
                cur.append(ln)
                i += 1
                continue
            flush()
            blocks.append(("phone" if phone_open else "browser",
                           "\n".join(acts).strip()))
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


# headless Chromium (Playwright) for JS-rendered pages; off => urllib only
BROWSER_ENABLED = os.environ.get("CHATCRAFT_BROWSER", "1") not in ("0", "false", "no")


def _page_text(raw):
    """Readable text from HTML: scripts/styles stripped, tags flattened."""
    import html as _html
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw,
                  flags=re.I | re.S)
    body = re.sub(r"<[^>]+>", " ", body)
    body = _html.unescape(re.sub(r"[ \t]+", " ", body))
    return re.sub(r"\n\s*\n+", "\n", body).strip()


def _fetch_chromium(url):
    """JS-rendered fetch via headless Chromium. Returns (html, title).
    Raises on ANY failure so the caller can fall back to plain urllib."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(
                user_agent="Mozilla/5.0 (compatible; ChatCraftBot/1.0)")
            page.goto(url, timeout=15000, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass  # some pages never go idle; DOM content is still fine
            return page.content()[:500_000], (page.title() or "")[:120]
        finally:
            browser.close()


def _is_private_host(host):
    """True for hostnames/IPs that must not be fetched server-side
    (loopback, private ranges, link-local, cloud metadata)."""
    import socket, ipaddress
    if host in ("localhost", "metadata.google.internal") or host.endswith(".local"):
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False  # unresolvable: let the fetch fail on its own
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_reserved or ip.is_multicast):
                return True
        except ValueError:
            continue
    return False


def fetch_page(url):
    """Fetch a page and extract its readable text: headless Chromium
    (JS-rendered) when Playwright is available, plain urllib otherwise.
    Returns (text, title, err)."""
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host and _is_private_host(host):
        return "", None, "refusing to fetch an internal/private address"
    import html as _html
    raw, title = "", ""
    if BROWSER_ENABLED:
        try:
            raw, title = _fetch_chromium(url)
        except Exception:
            raw, title = "", ""
    if not raw:
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent":
                              "Mozilla/5.0 (compatible; ChatCraftBot/1.0)"})
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read(500_000).decode("utf-8", "replace")
            m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
            title = (re.sub(r"\s+", " ", _html.unescape(m.group(1))).strip()[:120]
                    if m else "")
        except Exception as e:
            return "", "", str(e)[:150]
    return _page_text(raw)[:8000], title, ""


# ------------------------------------------------------------ browser agent ---
# The agent-driven browser: ONE shared headless-Chromium page. Playwright's
# sync API requires every call to happen in the thread that started it, so
# all page operations run on a dedicated worker via a queue.

BROWSER_ENABLED = os.environ.get("CHATCRAFT_BROWSER", "1") not in ("0", "false", "no")
_browser_q = queue.Queue()
_browser_thread = None
BROWSER_DATA = {"history": DATA_DIR / "browser-history.json",
                "bookmarks": DATA_DIR / "browser-bookmarks.json"}


def _load_json(path, default):
    """Read JSON, falling back to the default when missing/corrupt."""
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return default


def _browser_worker():
    import playwright.sync_api as pw_api
    with pw_api.sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent="Mozilla/5.0 (compatible; ChatCraftBot/1.0)")
        while True:
            job, rq = _browser_q.get()
            if job is None:
                break
            try:
                rq.put(("ok", job(page)))
            except Exception as e:
                rq.put(("err", str(e)[:200]))
            _browser_q.task_done()


def _browser_call(fn):
    """Run fn(page) on the browser thread. Returns (ok, value_or_error)."""
    global _browser_thread
    if not BROWSER_ENABLED:
        return (False, "browser disabled (CHATCRAFT_BROWSER=0)")
    if _browser_thread is None or not _browser_thread.is_alive():
        _browser_thread = threading.Thread(target=_browser_worker, daemon=True)
        _browser_thread.start()
    rq = queue.Queue(maxsize=1)
    _browser_q.put((fn, rq))
    try:
        return rq.get(timeout=60)
    except queue.Empty:
        return (False, "browser action timed out")


def _page_snapshot(page):
    """The state the UI and the model both consume after each action."""
    els = []
    try:
        nodes = page.query_selector_all("a, button, input, textarea, select")
    except Exception:
        nodes = []
    for n, el in enumerate(nodes[:40], start=1):
        try:
            txt = (el.inner_text() or el.get_attribute("value")
                   or el.get_attribute("placeholder") or "").strip()[:60]
            href = el.get_attribute("href") or ""
            if txt or href:
                els.append({"n": n, "tag": (el.evaluate("e => e.tagName.toLowerCase()")
                                           or "?"), "text": txt, "href": href})
        except Exception:
            continue
    try:
        shot = base64.b64encode(
            page.screenshot(type="jpeg", quality=70)).decode()
    except Exception:
        shot = ""
    try:
        content, title, url = page.content()[:500_000], (page.title() or ""), page.url
    except Exception:
        content, title, url = "", "", ""
    try:
        vp = page.viewport_size or {"width": 1280, "height": 720}
    except Exception:
        vp = {"width": 1280, "height": 720}
    return {"url": url, "title": title[:120],
            "viewport": {"w": vp.get("width", 1280), "h": vp.get("height", 720)},
            "text": _page_text(content)[:3000], "elements": els, "shot": shot}


def _browser_record(url, title):
    try:
        hist = _load_json(BROWSER_DATA["history"], [])
        hist = ([{"url": url, "title": (title or "")[:100], "at": time.time()}]
                + [h for h in hist if h.get("url") != url])[:50]
        BROWSER_DATA["history"].write_text(json.dumps(hist))
    except Exception:
        pass


def browser_action(action, **kw):
    """One browser action on the shared session. Returns (state, err)."""
    def op(page):
        if action == "goto":
            url = kw.get("url", "")
            if not url.startswith(("http://", "https://")):
                url = "https://" + url
            page.goto(url, timeout=20000, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            _browser_record(page.url, page.title())
        elif action == "click":
            els = page.query_selector_all("a, button, input, textarea, select")
            if not (1 <= kw["n"] <= len(els)):
                raise ValueError("no element number %d" % kw["n"])
            els[kw["n"] - 1].click(timeout=10000)
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
        elif action == "type":
            els = page.query_selector_all("a, button, input, textarea, select")
            if not (1 <= kw["n"] <= len(els)):
                raise ValueError("no element number %d" % kw["n"])
            els[kw["n"] - 1].fill(kw.get("text", ""))
        elif action == "scroll":
            page.mouse.wheel(0, kw.get("dy", 600))
        elif action == "click_xy":
            page.mouse.click(int(kw.get("x", 0)), int(kw.get("y", 0)))
            try:
                page.wait_for_load_state("networkidle", timeout=3000)
            except Exception:
                pass
        elif action == "press":
            page.keyboard.press(str(kw.get("key", "Enter")))
        elif action == "wait":
            page.wait_for_timeout(int(kw.get("ms", 500)))
        elif action == "back":
            page.go_back()
        try:
            _browser_record(page.url, page.title())
        except Exception:
            pass
        return _page_snapshot(page)
    tag, val = _browser_call(op)
    return (val, "") if tag == "ok" else (None, str(val)[:150])


def _save_json(path, data):
    """Write JSON, best-effort (state files must never crash the server)."""
    try:
        Path(path).write_text(json.dumps(data, indent=2))
    except Exception:
        pass


def browser_state():
    """Current snapshot, or (None, reason) when the session never started."""
    if not BROWSER_ENABLED:
        return None, "browser disabled"
    tag, val = _browser_call(lambda page: _page_snapshot(page))
    return (val, "") if tag == "ok" else (None, str(val)[:150])


def parse_browser_action(line):
    """One action line from a ```browser block:
    goto <url> | click <n> | type <n>: <text> | scroll up|down | back
    | click_xy <x> <y> | press <key> | wait <ms>"""
    line = line.strip()
    m = re.match(r"^goto\s+(\S+)$", line, re.I)
    if m:
        return ("goto", {"url": m.group(1)})
    m = re.match(r"^click\s+(\d+)$", line, re.I)
    if m:
        return ("click", {"n": int(m.group(1))})
    m = re.match(r"^type\s+(\d+)\s*:\s*(.*)$", line, re.I)
    if m:
        return ("type", {"n": int(m.group(1)), "text": m.group(2)})
    if re.match(r"^back$", line, re.I):
        return ("back", {})
    m = re.match(r"^scroll\s+(up|down)$", line, re.I)
    if m:
        return ("scroll", {"dy": -600 if m.group(1).lower() == "up" else 600})
    m = re.match(r"^click_xy\s+(\d+)\s+(\d+)$", line, re.I)
    if m:
        return ("click_xy", {"x": int(m.group(1)), "y": int(m.group(2))})
    m = re.match(r"^press\s+([\w+]+)$", line, re.I)
    if m:
        return ("press", {"key": m.group(1)})
    m = re.match(r"^wait\s+(\d+)$", line, re.I)
    if m:
        return ("wait", {"ms": min(5000, int(m.group(1)))})
    return None


def parse_phone_action(line):
    """One action line from a ```phone block:
    state | tap <x> <y> | text <msg> | swipe up|down|left|right
    | enter | back | home | open <package-or-url>"""
    line = line.strip()
    if re.match(r"^state$", line, re.I):
        return ("state", {})
    m = re.match(r"^tap\s+(\d+)\s+(\d+)$", line, re.I)
    if m:
        return ("tap", {"x": int(m.group(1)), "y": int(m.group(2))})
    m = re.match(r"^text\s+(.*)$", line, re.I)
    if m:
        return ("text", {"text": m.group(1)})
    m = re.match(r"^swipe\s+(up|down|left|right)$", line, re.I)
    if m:
        return ("swipe", {"dir": m.group(1).lower()})
    if re.match(r"^enter$", line, re.I):
        return ("enter", {})
    if re.match(r"^back$", line, re.I):
        return ("back", {})
    if re.match(r"^home$", line, re.I):
        return ("home", {})
    m = re.match(r"^open\s+(\S+)$", line, re.I)
    if m:
        return ("open", {"target": m.group(1)})
    return None


def _compact_browser_state(state):
    """Compact state summary the model reads after each browser action."""
    els = "; ".join(f"[{e['n']}] {e['tag']} '{e['text'][:40]}'"
                    + (f" -> {e['href'][:60]}" if e["href"] else "")
                    for e in state["elements"][:25])
    vp = state.get("viewport") or {}
    return (f"url={state['url']} title={state['title']!r} "
            f"viewport={vp.get('w')}x{vp.get('h')}\n"
            f"text: {state['text'][:1200]}\nelements: {els or 'none'}")


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


# ------------------------------------------------------------ phone bridge ---
# Remote phone control (Android APK pairs with this backend). The phone
# cannot accept inbound connections (mobile NAT), so the bridge is
# OUTBOUND-ONLY: the app long-polls /api/phone/poll for commands and posts
# results to /api/phone/result. The chat harness enqueues actions from
# ```phone blocks and waits for the device to report the new screen state.

import secrets as _secrets

PHONES = {}  # device_id -> {secret, name, last_seen, last_state, queue, waiters}
_PHONE_LOCK = threading.Lock()


def phone_pair(name):
    did = _secrets.token_hex(6)
    secret = _secrets.token_hex(16)
    with _PHONE_LOCK:
        PHONES[did] = {"secret": secret, "name": str(name or "phone")[:40],
                       "last_seen": time.time(), "last_state": None,
                       "queue": [], "waiters": {}}
    return {"device_id": did, "secret": secret}


def phone_auth(did, secret):
    with _PHONE_LOCK:
        d = PHONES.get(did)
    if not d or d["secret"] != str(secret or ""):
        return None
    return d


def phone_default_device():
    """The most recently seen phone (within 15 minutes), or None."""
    with _PHONE_LOCK:
        candidates = [(d["last_seen"], did) for did, d in PHONES.items()
                      if time.time() - d["last_seen"] < 900]
    if not candidates:
        return None
    return max(candidates)[1]


def phone_enqueue(did, action, params, wait=True):
    """Queue a command for the device. With wait=True the result slot is
    registered BEFORE the command becomes visible to the poller, so a
    fast result can never be missed. Commands expire after 45s: a phone
    that polls late will not run an action the caller already gave up on."""
    cmd = {"id": _secrets.token_hex(6), "action": action, "params": params,
           "expires": time.time() + 45}
    with _PHONE_LOCK:
        d = PHONES.get(did)
        if d is None:
            return None, "no such device"
        if wait:
            d["waiters"][cmd["id"]] = {"event": threading.Event(), "result": None}
        d["queue"].append(cmd)
    return cmd, ""


def phone_wait_result(did, cmd_id, timeout=30):
    """Block until the device reports this command's result. The waiter
    slot was registered at enqueue time, so a result that arrives before
    this call is still collected."""
    with _PHONE_LOCK:
        d = PHONES.get(did)
        if d is None:
            return {"ok": False, "detail": "device disappeared"}
        w = d["waiters"].get(cmd_id)
        if w is None:
            return {"ok": False, "detail": "command not tracked"}
    w["event"].wait(timeout)
    with _PHONE_LOCK:
        d = PHONES.get(did) or {}
        w2 = d.get("waiters", {}).pop(cmd_id, None)
        if w2 is None or w2["result"] is None:
            # timed out: expire the queued command so an offline phone
            # cannot execute it after we already reported failure
            d["queue"] = [c for c in d.get("queue", [])
                          if c.get("id") != cmd_id]
            return {"ok": False,
                    "detail": "no result in time — outcome unknown "
                              "(the device may still complete the command)"}
        return w2["result"]


def phone_devices():
    with _PHONE_LOCK:
        out = [{"device_id": did, "name": d["name"],
                "last_seen": d["last_seen"],
                "online": time.time() - d["last_seen"] < 90,
                "has_state": bool(d["last_state"]),
                "state": d["last_state"]}
               for did, d in PHONES.items()]
        latest = max(out, key=lambda r: r["last_seen"], default=None)
        return out, (latest or {}).get("state") or ""


# ------------------------------------------------------------ feature stores ---
# Projects / agents / skills / automations / usage: small JSON stores in
# data/ (gitignored runtime state), same pattern as custom models.

import uuid as _uuid


def _new_id():
    return _uuid.uuid4().hex[:10]


# ------- projects: group existing workspace files -------

def load_projects():
    return _load_json(PROJECTS_FILE, [])


def save_projects(p):
    _save_json(PROJECTS_FILE, p)


def project_record(p):
    files = [f for f in p.get("files", []) if (FILES_DIR / f).is_file()]
    return {"id": p["id"], "name": p["name"], "description": p.get("description", ""),
            "files": files, "created": p.get("created", 0)}


# ------- agents: named personas (model + system prompt) -------

def load_agents():
    return _load_json(AGENTS_FILE, [])


def save_agents(a):
    _save_json(AGENTS_FILE, a)


# ------- skills: reusable system-prompt presets -------

def load_skills():
    return _load_json(SKILLS_FILE, [])


def save_skills(s):
    _save_json(SKILLS_FILE, s)


# ------- automations: scheduled prompt runs -------

def load_automations():
    return _load_json(AUTOMATIONS_FILE, [])


def save_automations(a):
    _save_json(AUTOMATIONS_FILE, a)


# ------- usage log (dashboards) -------

def record_usage(entry):
    """Append one chat turn's usage. Bounded: keep the last 500 entries."""
    log = _load_json(USAGE_LOG_FILE, [])
    log.append(entry)
    _save_json(USAGE_LOG_FILE, log[-500:])


# ------------------------------------------------------------ scheduler ---

def run_automation_once(a):
    """Run one automation: model call on its prompt, reply saved to a
    workspace file. Returns (ok, filename_or_error)."""
    model = find_model(a.get("model") or DEFAULT_MODEL)
    model, err = model_status(model)
    if err:
        return False, err
    system = ("You are a scheduled automation run. Produce a short, useful "
              "result for the prompt below. Write markdown.")
    chunks = []
    try:
        for kind, payload in model_stream(model, [{"role": "user",
                                                 "content": a["prompt"]}],
                                         system, 768, None):
            if kind == "text" and payload:
                chunks.append(payload)
    except Exception as e:
        return False, str(e)[:150]
    text = "".join(chunks).strip()
    if not text:
        return False, "model returned no text"
    ts = time.strftime("%Y%m%d-%H%M%S")
    safe = re.sub(r"[^\w.-]+", "-", a.get("name", "run"))[:30] or "run"
    fname = f"automation-{safe}-{ts}.md"
    (FILES_DIR / fname).write_text(
        f"# {a.get('name', 'run')} — {time.strftime('%Y-%m-%d %H:%M')}\n\n"
        f"prompt: {a['prompt']}\n\n---\n\n{text}", encoding="utf-8")
    return True, fname


def _automation_loop():
    """Scheduler thread: every 20s, run any automation whose interval has
    elapsed. Bounded: an automation stops after 200 runs (cost guard)."""
    while True:
        time.sleep(20)
        try:
            autos = load_automations()
            changed = False
            for a in autos:
                if not a.get("enabled"):
                    continue
                if a.get("runs", 0) >= 200:
                    continue
                interval = max(60, int(a.get("interval_min") or 60))
                if time.time() - a.get("last_run", 0) < interval * 60:
                    continue
                ok, detail = run_automation_once(a)
                a["last_run"] = time.time()
                a["runs"] = a.get("runs", 0) + 1
                a["last_result"] = ("ok: " if ok else "failed: ") + str(detail)[:120]
                changed = True
            if changed:
                save_automations(autos)
        except Exception:
            pass


_scheduler_started = False


def start_scheduler():
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    threading.Thread(target=_automation_loop, daemon=True).start()


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
        return hmac.compare_digest(
            (self.headers.get("X-Access-Code") or "").encode("utf-8"),
            ACCESS_CODE.encode("utf-8"))

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
        if path == "/api/browser/state":
            state, err = browser_state()
            return self._send(200, {"state": state, "err": err})
        if path == "/api/browser/history":
            return self._send(200, {"history": _load_json(
                BROWSER_DATA["history"], [])})
        if path == "/api/browser/bookmarks":
            return self._send(200, {"bookmarks": _load_json(
                BROWSER_DATA["bookmarks"], [])})
        if path == "/api/custom-models":
            return self._send(200, {"models": [
                {k: v for k, v in m.items() if k != "api_key"} | {"custom": True}
                for m in load_custom_models()]})
        # ---- feature stores ----
        if path == "/api/projects":
            return self._send(200, {"projects": [project_record(p)
                                                 for p in load_projects()]})
        if path == "/api/agents":
            return self._send(200, {"agents": load_agents()})
        if path == "/api/skills":
            return self._send(200, {"skills": load_skills()})
        if path == "/api/automations":
            return self._send(200, {"automations": load_automations()})
        if path == "/api/usage":
            log = _load_json(USAGE_LOG_FILE, [])
            return self._send(200, {"log": log})
        # ---- phone bridge ----
        if path == "/api/phone/devices":
            devs, latest = phone_devices()
            return self._send(200, {"devices": devs, "latest_state": latest})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if path == "/api/phone/poll":
            did = (q.get("device_id") or [""])[0]
            d = phone_auth(did, (q.get("secret") or [""])[0])
            if d is None:
                return self._send(403, {"error": "bad device credentials"})
            # long-poll: hand over queued, unexpired commands, up to 25s
            deadline = time.time() + 25
            while time.time() < deadline:
                with _PHONE_LOCK:
                    now = time.time()
                    live = [c for c in d["queue"] if c.get("expires", 0) > now]
                    d["queue"] = live
                    cmds = live[:]
                    d["queue"] = []
                    if cmds:
                        d["last_seen"] = time.time()
                if cmds:
                    return self._send(200, {"commands": cmds})
                time.sleep(1)
            return self._send(200, {"commands": []})
        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/") and not self._authorized():
            return self._send(401, {"error": "access code required"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/browser/bookmarks":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            url = (q.get("url") or [""])[0]
            if not url:
                return self._send(400, {"error": "url required"})
            bms = [x for x in _load_json(BROWSER_DATA["bookmarks"], [])
                   if x.get("url") != url]
            BROWSER_DATA["bookmarks"].write_text(json.dumps(bms))
            return self._send(200, {"ok": True, "bookmarks": bms})

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
        # ---- feature stores ----
        if path.startswith("/api/projects/"):
            pid = urllib.parse.unquote(path.split("/api/projects/")[1])
            save_projects([p for p in load_projects() if p["id"] != pid])
            return self._send(200, {"ok": True})
        if path.startswith("/api/agents/"):
            aid = urllib.parse.unquote(path.split("/api/agents/")[1])
            save_agents([a for a in load_agents() if a["id"] != aid])
            return self._send(200, {"ok": True})
        if path.startswith("/api/skills/"):
            sid = urllib.parse.unquote(path.split("/api/skills/")[1])
            save_skills([s for s in load_skills() if s["id"] != sid])
            return self._send(200, {"ok": True})
        if path.startswith("/api/automations/"):
            aid = urllib.parse.unquote(path.split("/api/automations/")[1])
            save_automations([a for a in load_automations() if a["id"] != aid])
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.startswith("/api/") and not self._authorized():
            return self._send(401, {"error": "access code required"})

        if not self._origin_ok():
            return self._send(403, {"error": "cross-origin request rejected"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/browser/action":
            b = self._body()
            if b.get("action") not in ("goto", "click", "type", "scroll", "back",
                                       "click_xy", "press", "wait"):
                return self._send(400, {"error": "unknown browser action"})
            state, err = browser_action(
                b["action"], url=b.get("url", ""), n=int(b.get("n", 0)),
                text=b.get("text", ""), dy=int(b.get("dy", 600)),
                x=int(b.get("x", 0)), y=int(b.get("y", 0)),
                key=b.get("key", ""), ms=int(b.get("ms", 500)))
            return self._send(200, {"state": state, "err": err})
        if path == "/api/browser/bookmarks":
            b = self._body()
            if not b.get("url"):
                return self._send(400, {"error": "url required"})
            bms = [x for x in _load_json(BROWSER_DATA["bookmarks"], [])
                   if x.get("url") != b["url"]]
            bms.insert(0, {"url": b["url"], "title": (b.get("title") or "")[:100],
                          "at": time.time()})
            BROWSER_DATA["bookmarks"].write_text(json.dumps(bms[:200]))
            return self._send(200, {"ok": True, "bookmarks": bms})
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
        # ---- feature stores ----
        if path == "/api/projects":
            b = self._body()
            if not b.get("name"):
                return self._send(400, {"error": "name required"})
            projects = [p for p in load_projects() if p["id"] != b.get("id")]
            p = {"id": b.get("id") or _new_id(), "name": str(b["name"])[:80],
                 "description": str(b.get("description") or "")[:300],
                 "files": [str(f) for f in b.get("files", [])
                           if (FILES_DIR / str(f)).is_file()],
                 "created": b.get("created") or time.time()}
            projects.append(p)
            save_projects(projects)
            return self._send(200, {"ok": True, "project": project_record(p)})
        if path == "/api/agents":
            b = self._body()
            if not b.get("name"):
                return self._send(400, {"error": "name required"})
            agents = [a for a in load_agents() if a["id"] != b.get("id")]
            a = {"id": b.get("id") or _new_id(), "name": str(b["name"])[:60],
                 "description": str(b.get("description") or "")[:300],
                 "model": b.get("model") or "", "system": str(b.get("system") or "")[:2000],
                 "created": b.get("created") or time.time()}
            agents.append(a)
            save_agents(agents)
            return self._send(200, {"ok": True, "agent": a})
        if path == "/api/skills":
            b = self._body()
            if not b.get("name") or not b.get("prompt"):
                return self._send(400, {"error": "name and prompt required"})
            skills = [s for s in load_skills() if s["id"] != b.get("id")]
            s = {"id": b.get("id") or _new_id(), "name": str(b["name"])[:60],
                 "prompt": str(b["prompt"])[:2000],
                 "created": b.get("created") or time.time()}
            skills.append(s)
            save_skills(skills)
            return self._send(200, {"ok": True, "skill": s})
        if path == "/api/automations":
            b = self._body()
            if not b.get("name") or not b.get("prompt"):
                return self._send(400, {"error": "name and prompt required"})
            autos = [a for a in load_automations() if a["id"] != b.get("id")]
            iv = b.get("interval_min")
            a = {"id": b.get("id") or _new_id(), "name": str(b["name"])[:60],
                 "prompt": str(b["prompt"])[:500],
                 "interval_min": max(1, int(iv)) if iv is not None else 60,
                 "model": b.get("model") or "",
                 "enabled": bool(b.get("enabled")),
                 "runs": 0, "last_run": 0, "last_result": "",
                 "created": b.get("created") or time.time()}
            autos.append(a)
            save_automations(autos)
            return self._send(200, {"ok": True, "automation": a})
        if path.startswith("/api/automations/") and path.endswith("/run"):
            aid = urllib.parse.unquote(path.split("/api/automations/")[1][:-4])
            a = next((x for x in load_automations() if x["id"] == aid), None)
            if a is None:
                return self._send(404, {"error": "no such automation"})
            ok, detail = run_automation_once(a)
            autos = load_automations()
            for x in autos:
                if x["id"] == aid:
                    x["last_run"] = time.time()
                    x["runs"] = x.get("runs", 0) + 1
                    x["last_result"] = ("ok: " if ok else "failed: ") + str(detail)[:120]
            save_automations(autos)
            return self._send(200, {"ok": ok, "result": str(detail)[:300]})
        if path == "/api/phone/pair":
            b = self._body()
            return self._send(200, phone_pair(b.get("name")))
        if path == "/api/phone/result":
            b = self._body()
            d = phone_auth(b.get("device_id", ""), b.get("secret", ""))
            if d is None:
                return self._send(403, {"error": "bad device credentials"})
            with _PHONE_LOCK:
                d["last_seen"] = time.time()
                if b.get("state"):
                    d["last_state"] = b["state"]
                w = d["waiters"].get(b.get("cmd_id"))
                if w is not None:
                    w["result"] = {"ok": bool(b.get("ok")),
                                    "detail": str(b.get("detail") or "")[:300],
                                    "state": b.get("state")}
                    w["event"].set()
            return self._send(200, {"ok": True})
        if path == "/api/phone/command":
            b = self._body()
            did = b.get("device_id") or phone_default_device()
            if not did:
                return self._send(404, {"error": "no phone paired — install the "
                                                 "ChatCraft APK and pair it first"})
            cmd, err = phone_enqueue(did, b.get("action", ""),
                                     b.get("params") or {}, wait=False)
            if err:
                return self._send(404, {"error": err})
            return self._send(200, {"ok": True, "command": cmd,
                                    "device": did})
        if path.startswith("/api/files/"):
            # write a file into the workspace (canvas saves; same rules as chat)
            name = Path(urllib.parse.unquote(path.split("/api/files/")[1])).name
            b = self._body()
            if not name or "content" not in b:
                return self._send(400, {"error": "content required"})
            (FILES_DIR / name).write_text(str(b["content"]), encoding="utf-8")
            return self._send(200, {"ok": True, "name": name,
                                    "size": (FILES_DIR / name).stat().st_size})
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

            # history bound: last 12 messages, full content (no truncation —
            # silently cutting older messages would lose requirements)
            messages = [m for m in (req.get("messages") or [])
                        if m.get("role") in ("user", "assistant")
                        and m.get("content")][-12:]
            if not messages:
                yield ev("error", {"error": "no messages"})
                return

            model = find_model(req.get("model") or DEFAULT_MODEL)
            model, err = model_status(model)
            if err:
                yield ev("error", {"error": err + " — see Settings > Models to add Ollama or a custom endpoint"})
                return

            # The advisor defaults to the user's CHOSEN model — no model the
            # user didn't pick reads the conversation. A different advisor
            # can still be chosen explicitly in Settings.
            advisor_id = req.get("advisor_model") or model["id"]
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
                    locator = find_model(locator_for(advisor_id))
                    yield step("advisor", f"Advisor review ({advisor['label']})", "run")
                    note, aerr, advisor_usage, ainfo = super_advisor_pass(
                        advisor, locator, messages, files_now)
                    am = find_model(advisor_id) or {}
                    lm = find_model(locator_for(advisor_id)) or {}
                    if lm and not lm.get("custom") and not lm.get("local"):
                        advisor_cost = estimate_cost(
                            lm, ainfo["locator_usage"]["in"], ainfo["locator_usage"]["out"])
                    if am and not am.get("custom") and not am.get("local"):
                        advisor_cost += estimate_cost(
                            am,
                            advisor_usage["in"] - ainfo["locator_usage"]["in"],
                            advisor_usage["out"] - ainfo["locator_usage"]["out"])
                    if ainfo.get("locator_used"):
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
                finish = None
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
                    elif kind == "finish":
                        finish = payload
                yield step("write", "Writing reply", "done")

                full_text = "".join(chunks)

                skip_seq = [0]  # turn-wide, unique skip step ids

                def execute_reply_tools(rtext, cmd_budget=10,
                                       browse_budget=5, id_base=0):
                    """Run every file/command/browse block in a model reply
                    and stream the steps live. Budgets are SHARED across the
                    whole turn (first reply + continuations), step ids are
                    unique, and the logs include failures so they can be fed
                    back to the model. parse_blocks scans line-by-line so
                    malformed merged fences can't swallow a later block; each
                    block gets its OWN execution record (index -> exit code),
                    so duplicate commands can never borrow a sibling's result.
                    Returns (rc_by_block, browse_by_block, cmd_log,
                    browse_log, saved, cmds_used, browses_used).
                    """
                    blocks = parse_blocks(rtext)
                    run_idx = [i for i, b in enumerate(blocks) if b[0] == "run"
                               and normalize_cmd(b[1])]
                    cleaned, files = extract_files(rtext)
                    saved = []
                    if files:
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
                        yield ev("files", {"files": saved,
                                           "cleaned_text": cleaned_text(
                                               blocks, {}, cmds_pending=True)})
                    rc_by_block, cmd_log = {}, []
                    run_slice = run_idx[:max(0, cmd_budget)]
                    for n_run, bi in enumerate(run_slice):
                        cmd = normalize_cmd(blocks[bi][1])
                        sid = f"cmd-{id_base + n_run + 1}"
                        if not ALLOW_CMDS:
                            yield step(sid, "Commands disabled", "skip",
                                       "set CHATCRAFT_ALLOW_CMDS=1 to enable")
                            cmd_log.append((cmd, None, "skipped: commands disabled"))
                            continue
                        yield step(sid, f"Running: {cmd[:60]}", "run")
                        rc, out = run_command(cmd)
                        first = (out.strip().splitlines() or [""])[0][:120]
                        state = "done" if rc == 0 else "fail"
                        label = (f"Ran: {cmd[:60]} (exit {rc})" if rc == 0
                                 else f"Failed: {cmd[:60]} (exit {rc})")
                        yield step(sid, label, state, first)
                        yield ev("command", {"command": cmd, "returncode": rc,
                                             "output": out[:2000]})
                        rc_by_block[bi] = rc
                        cmd_log.append((cmd, rc, out))
                    for k, bi in enumerate(run_idx[len(run_slice):]):
                        cmd = normalize_cmd(blocks[bi][1])
                        cmd_log.append((cmd, None,
                                       "skipped: per-turn command limit reached"))
                        skip_seq[0] += 1
                        yield step(f"cmd-skip-{skip_seq[0]}",
                                  f"Skipped: {cmd[:50]} (per-turn limit)", "skip")
                    if run_idx:
                        yield ev("clean", {"text": cleaned_text(blocks, rc_by_block)})
                    browse_log, browse_by_block = [], {}
                    browse_blocks = [(i, b) for i, b in enumerate(blocks)
                                     if b[0] == "browse"]
                    browse_slice = browse_blocks[:max(0, browse_budget)]
                    for n_br, (bi, b) in enumerate(browse_slice):
                        url = (b[1].splitlines() or [""])[0].strip()
                        if not url:
                            continue
                        if not url.startswith(("http://", "https://")):
                            url = "https://" + url
                        sid = f"browse-{id_base + n_br + 1}"
                        yield step(sid, f"Browsing {url[:70]}", "run")
                        text_body, title, berr = fetch_page(url)
                        if berr:
                            yield step(sid, f"Couldn't fetch {url[:60]}", "fail", berr)
                            browse_by_block[bi] = (False, berr)
                            browse_log.append((url, None, berr))
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
                        browse_by_block[bi] = (True, title)
                        browse_log.append((url, title, text_body))
                    for bi, b in browse_blocks[len(browse_slice):]:
                        url = (b[1].splitlines() or [""])[0].strip()
                        if url:
                            browse_log.append((url, None,
                                                "skipped: per-turn browse limit reached"))
                            skip_seq[0] += 1
                            yield step(f"browse-skip-{skip_seq[0]}",
                                       f"Skipped: {url[:55]} (per-turn limit)", "skip")
                    if browse_blocks:
                        yield ev("clean", {"text": cleaned_text(
                            blocks, rc_by_block, browse_by_block)})
                    # the fetches above consumed the shared budget too —
                    # browser/phone actions only get what is LEFT
                    browse_budget -= len(browse_slice)
                    # browser: drive the shared Chromium session (shares the
                    # browse budget: 5 actions per turn, one action per line)
                    browser_log = []
                    actions_used = 0
                    browser_blocks = [(i, b) for i, b in enumerate(blocks)
                                      if b[0] == "browser"]
                    for bi, b in browser_blocks:
                        act_lines = [l for l in b[1].splitlines() if l.strip()]
                        block_budget = browse_budget
                        for line in act_lines[:max(0, browse_budget)]:
                            browse_budget -= 1
                            actions_used += 1
                            act = parse_browser_action(line)
                            if act is None:
                                browser_log.append((line, None, "unknown action"))
                                continue
                            skip_seq[0] += 1
                            sid = f"br-{skip_seq[0]}"
                            yield step(sid, f"Browser: {line.strip()[:60]}", "run")
                            state, err = browser_action(act[0], **act[1])
                            if err:
                                yield step(sid, f"Browser failed: {line.strip()[:45]}",
                                          "fail", err)
                                browser_log.append((line, None, err))
                                continue
                            yield step(sid, f"Browser: {line.strip()[:60]}", "done",
                                       state["title"][:60])
                            browser_log.append(
                                (line, True, _compact_browser_state(state)))
                            yield ev("browser", {"action": line.strip()[:80],
                                                 "url": state["url"],
                                                 "title": state["title"]})
                        for line in act_lines[max(0, block_budget):]:
                            browser_log.append((line, None,
                                               "skipped: per-turn browser budget"))
                            skip_seq[0] += 1
                            yield step(f"br-skip-{skip_seq[0]}",
                                      f"Skipped: {line.strip()[:45]} (limit)", "skip")
                    # phone: drive the paired Android phone (the ChatCraft
                    # APK). One action per line, budgeted like the browser.
                    phone_log = []
                    phone_blocks = [(i, b) for i, b in enumerate(blocks)
                                    if b[0] == "phone"]
                    did = phone_default_device()
                    for bi, b in phone_blocks:
                        act_lines = [l for l in b[1].splitlines() if l.strip()]
                        block_budget = browse_budget
                        for line in act_lines[:max(0, browse_budget)]:
                            browse_budget -= 1
                            actions_used += 1
                            act = parse_phone_action(line)
                            if act is None:
                                phone_log.append((line, None, "unknown action"))
                                continue
                            skip_seq[0] += 1
                            sid = f"ph-{skip_seq[0]}"
                            yield step(sid, f"Phone: {line.strip()[:60]}", "run")
                            if not did:
                                yield step(sid, "No phone paired", "fail",
                                           "install the ChatCraft APK and pair it")
                                phone_log.append((line, None, "no phone paired"))
                                continue
                            cmd, err = phone_enqueue(did, act[0], act[1])
                            if err:
                                yield step(sid, f"Phone failed: {line.strip()[:45]}",
                                          "fail", err)
                                phone_log.append((line, None, err))
                                continue
                            res = phone_wait_result(did, cmd["id"], 30)
                            if not res.get("ok") and \
                                    "did not respond" in str(res.get("detail", "")):
                                yield step(sid, "Phone timeout", "fail",
                                           f"{cmd['action']} timed out after 30s")
                                phone_log.append((line, None,
                                                  "no result within 30s — outcome "
                                                  "UNKNOWN (the phone may still "
                                                  "complete it; is the app in the "
                                                  "background?)"))
                                continue
                            ok, detail, pstate = (res["ok"], res["detail"],
                                                  res.get("state") or "")
                            status = "ok" if ok else f"FAILED: {detail[:60]}"
                            yield step(sid, f"Phone: {line.strip()[:60]}",
                                       "done" if ok else "fail", detail[:60])
                            summary = (f"{status}\n{str(pstate)[:1500]}"
                                       if pstate else status)
                            phone_log.append((line, ok, summary))
                            yield ev("phone", {"action": line.strip()[:80],
                                              "ok": ok, "detail": detail[:200]})
                        for line in act_lines[max(0, block_budget):]:
                            phone_log.append((line, None,
                                              "skipped: per-turn phone budget"))
                            skip_seq[0] += 1
                            yield step(f"ph-skip-{skip_seq[0]}",
                                      f"Skipped: {line.strip()[:45]} (limit)", "skip")
                    return (rc_by_block, browse_by_block, cmd_log, browse_log,
                            browser_log, phone_log, saved, len(run_slice),
                            len(browse_slice) + actions_used)

                # 5-7. execute the reply's tool blocks (budgets shared per turn)
                (rc_by_block, browse_by_block, cmd_log, browse_log,
                 browser_log, phone_log, saved, uc, ub) = \
                    yield from execute_reply_tools(full_text)
                cmd_left, browse_left, id_base = 10 - uc, 5 - ub, uc + ub

                # 8. tool feedback loop: execute -> observe -> resume, budgeted.
                #    Each round feeds the command outputs / page text (and any
                #    fetch failures) back to the model so it can finish the
                #    task in the same turn. Bounded: max 2 continuation calls,
                #    shared 10-command / 5-browse budgets, and if the budget
                #    runs out the user sees an honest note instead of silence.
                CONT_MAX = 2
                last_clean = cleaned_text(parse_blocks(full_text),
                                         rc_by_block, browse_by_block)
                truncation_notes = []
                if finish in ("max_tokens", "length"):
                    # the reply itself was cut off by the token limit; the
                    # note persists across the whole turn (a continuation
                    # answering later must not silently clear it)
                    truncation_notes.append(
                        "[reply hit the token limit — possibly truncated; "
                        "raise the reply budget to finish it]")
                cont_msgs = messages + [
                    {"role": "assistant", "content": echo_text(full_text)}]
                rounds = 0
                while (cmd_log or browse_log or browser_log or phone_log) \
                        and rounds < CONT_MAX:
                    obs_text = build_obs(cmd_log, browse_log, browser_log,
                                         phone_log)
                    obs_text = ("TOOL RESULTS from the run/browse blocks in your "
                                "reply — the platform ran them for you (skips and "
                                "failures included). Use these results NOW to "
                                "give the user the final, complete answer. Do "
                                "not re-announce commands that already ran; if "
                                "something failed or never ran and it matters, "
                                "you may emit one new run block.\n\n" + obs_text)
                    cont_msgs.append({"role": "user", "content": obs_text})
                    rounds += 1
                    yield step("cont", f"Using tool results ({rounds}/{CONT_MAX})", "run")
                    cont_chunks, cont_usage, cont_finish = [], {"in": 0, "out": 0}, None
                    for kind, payload in model_stream(
                            model, cont_msgs, system, 768,
                            float(req.get("temperature") or 0.7)):
                        if kind == "text" and payload:
                            cont_chunks.append(payload)
                            yield ev("text", {"delta": payload})
                        elif kind == "usage":
                            cont_usage = payload
                        elif kind == "model" and not reported_model:
                            reported_model = payload
                        elif kind == "finish":
                            cont_finish = payload
                    usage["in"] += cont_usage.get("in", 0)
                    usage["out"] += cont_usage.get("out", 0)
                    cont_text = "".join(cont_chunks)
                    if not cont_text.strip():
                        yield step("cont", "Used tool results", "fail",
                                   "continuation returned no text")
                        cmd_log, browse_log, browser_log, phone_log = [], [], [], []
                        break
                    yield step("cont", "Used tool results", "done")
                    cont_msgs.append({"role": "assistant", "content": cont_text[:6000]})
                    # only NEW tool results feed the next round
                    (crc, cbb, ccl, cbl, cbrl, cphl, saved2,
                     uc2, ub2) = yield from execute_reply_tools(
                        cont_text, cmd_budget=cmd_left,
                        browse_budget=browse_left, id_base=id_base)
                    cmd_left -= uc2
                    browse_left -= ub2
                    id_base += uc2 + ub2
                    saved = saved + saved2
                    last_clean = cleaned_text(parse_blocks(cont_text), crc, cbb)
                    if cont_finish in ("max_tokens", "length"):
                        truncation_notes.append(
                            "[continuation hit the token limit — "
                            "possibly truncated]")
                    yield ev("clean", {"text": last_clean})
                    cmd_log, browse_log, browser_log, phone_log = ccl, cbl, cbrl, cphl
                pending_notes = list(truncation_notes)
                if cmd_log or browse_log or browser_log or phone_log:
                    pending_notes.append(
                        "[continuation budget reached — the latest tool "
                        "results above were not summarized]")
                if pending_notes:
                    # one honest final display: last clean + every note that
                    # must survive the turn (truncation, budget stop)
                    yield ev("clean", {"text": last_clean + "\n\n" +
                                       "\n".join(pending_notes)})

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
                record_usage({"ts": time.time(), "model": model["id"],
                              "in": usage.get("in", 0), "out": usage.get("out", 0),
                              "cost_usd": (None if custom else round(cost, 6)),
                              "local": local})
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
    start_scheduler()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
