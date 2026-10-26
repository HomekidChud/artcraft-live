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
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
# Command execution is the point of a harness, but it is YOUR machine:
# set CHATCRAFT_ALLOW_CMDS=0 to disable ```run blocks entirely.
ALLOW_CMDS = os.environ.get("CHATCRAFT_ALLOW_CMDS", "1") not in ("0", "false", "no")
CMD_TIMEOUT = int(os.environ.get("CHATCRAFT_CMD_TIMEOUT", "20"))

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
    {"id": "claude_haiku_4_5", "label": "Claude Haiku 4.5", "provider": "Anthropic",
     "tier": "fast", "in": 1.0, "out": 5.0,
     "api": {"kind": "anthropic", "model": "claude-haiku-4-5", "env": "ANTHROPIC_API_KEY"}},
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
     "api": {"kind": "openai", "model": "gemini-3-flash",
             "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
             "env": "GEMINI_API_KEY"}},
    {"id": "grok_4_3", "label": "Grok 4.3", "provider": "xAI",
     "tier": "balanced", "in": 2.0, "out": 10.0,
     "api": {"kind": "openai", "model": "grok-4.3",
             "base_url": "https://api.x.ai/v1", "env": "XAI_API_KEY"}},
]

DEFAULT_MODEL = "claude_sonnet_5_5"
DEFAULT_ADVISOR = "claude_haiku_4_5"

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
    "the output. Only use this when a command is genuinely useful; never use it for "
    "destructive operations. Ordinary code snippets stay in plain fences with no marker."
)

ADVISOR_SYSTEM = (
    "You are the Advisor: a fast, cheap reviewer that always runs before the main model. "
    "Given a conversation, produce a tight brief for it: (1) what the user really wants, "
    "(2) pitfalls or missing context to avoid, (3) how to make the answer high quality. "
    "Maximum 70 words. Plain text, no preamble."
)

# ```lang filename.ext ... ```   (also accepts ```lang:filename.ext)
FILE_BLOCK_RE = re.compile(r"```([\w+#-]*)[ \t]*:?[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*\n(.*?)```", re.S)
# ```run\n command \n```
RUN_BLOCK_RE = re.compile(r"```run[ \t]*\n(.*?)```", re.S | re.I)


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
            })
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
    LM Studio, vLLM...). Yields ('text', delta) and ('usage', {...})."""
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
    try:
        for ev in http_sse(base.rstrip("/") + "/chat/completions", body, headers):
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


def stream_anthropic(api, messages, system, max_tokens, temperature, api_key=""):
    """Anthropic Messages API. Yields ('text', delta) and ('usage', {...})."""
    key = api_key or os.environ.get(api["env"], "")
    body = {"model": api["model"], "messages": messages,
            "max_tokens": max_tokens, "stream": True}
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
    usage = {"in": 0, "out": 0}
    got_text = False
    try:
        for ev in http_sse("https://api.anthropic.com/v1/messages", body, headers):
            etype = ev.get("type", "")
            if etype == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                got_text = True
                yield ("text", ev["delta"]["text"])
            elif etype == "message_start":
                usage["in"] = ev.get("message", {}).get("usage", {}).get("input_tokens", 0)
            elif etype == "message_delta":
                usage["out"] = ev.get("usage", {}).get("output_tokens", 0)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Anthropic returned HTTP {e.code}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"Anthropic unreachable: {str(e)[:200]}")
    if not got_text:
        raise RuntimeError("Anthropic streamed no text (check the model name)")
    yield ("usage", usage)


def model_stream(m, messages, system, max_tokens, temperature):
    """Route a model record to the right protocol. Yields ('text'|'usage', payload)."""
    api = dict(m.get("api") or {})
    api_key = m.get("api_key", "")
    if m.get("custom"):
        api = {"kind": "anthropic" if m.get("provider") == "anthropic-compat" else "openai",
               "model": m.get("model_name", ""), "base_url": m.get("base_url")}
    kind = api.get("kind", "openai")
    if kind == "anthropic":
        gen = stream_anthropic(api, messages, system, max_tokens, temperature, api_key)
    else:
        gen = stream_openai_compat(api, messages, system, max_tokens, temperature, api_key)
    usage = {"in": 0, "out": 0}
    for kind_, payload in gen:
        if kind_ == "text":
            yield ("text", payload)
        elif kind_ == "usage":
            usage = payload
    if usage["in"] == 0 and usage["out"] == 0:
        # no usage reported: honest rough estimate so the cost line still shows
        usage = {"in": 0, "out": 0, "estimated": True}
    yield ("usage", usage)


def advisor_pass(m, messages):
    """One-shot (non-streaming) advisor call. Returns (note, error, usage)."""
    api = dict(m.get("api") or {})
    api_key = m.get("api_key", "")
    if m.get("custom"):
        api = {"kind": "anthropic" if m.get("provider") == "anthropic-compat" else "openai",
               "model": m.get("model_name", ""), "base_url": m.get("base_url")}
    trimmed = [x for x in messages if x.get("content")][-4:]
    usage = {"in": 0, "out": 0}
    try:
        if api.get("kind") == "anthropic":
            status, body = http_json(
                "https://api.anthropic.com/v1/messages",
                {"model": api["model"], "system": ADVISOR_SYSTEM, "messages": trimmed,
                 "max_tokens": 200},
                headers={"x-api-key": api_key or os.environ.get(api.get("env", ""), ""),
                         "anthropic-version": "2023-06-01"}, timeout=60)
            note = ""
            if status == 200 and body.get("content"):
                note = (body["content"][0].get("text") or "").strip()
                u = body.get("usage") or {}
                usage = {"in": u.get("input_tokens", 0) or 0, "out": u.get("output_tokens", 0) or 0}
            elif status != 200:
                return "", f"HTTP {status}: {str(body)[:150]}", usage
        else:
            base = (api.get("base_url") or "https://api.openai.com/v1").rstrip("/")
            status, body = http_json(
                base + "/chat/completions",
                {"model": api["model"], "messages": [{"role": "system", "content": ADVISOR_SYSTEM}] + trimmed,
                 "max_tokens": 200},
                headers={"Authorization": "Bearer " + api_key} if api_key else None, timeout=60)
            note = ""
            if status == 200:
                note = ((body.get("choices") or [{}])[0].get("message") or {}).get("content", "") or ""
                u = body.get("usage") or {}
                usage = {"in": u.get("prompt_tokens", 0) or 0, "out": u.get("completion_tokens", 0) or 0}
            else:
                return "", f"HTTP {status}: {str(body)[:150]}", usage
        if not note:
            return "", "advisor returned an empty review", usage
        return note, "", usage
    except Exception as e:
        return "", str(e)[:200], usage


# ------------------------------------------------------------ file + command ---

def file_record(path: Path):
    st = path.stat()
    return {"name": path.name, "size": st.st_size,
            "modified": time.strftime("%H:%M", time.localtime(st.st_mtime))}


def extract_files(text):
    files = []

    def repl(m):
        lang, name, content = m.group(1), m.group(2), m.group(3)
        files.append({"name": Path(name).name, "lang": lang or "text",
                      "content": content.rstrip("\n")})
        return f"wrote file: {Path(name).name}"

    return FILE_BLOCK_RE.sub(repl, text), files


def extract_runs(text):
    runs = []
    for m in RUN_BLOCK_RE.finditer(text):
        cmd = m.group(1).strip()
        if cmd:
            runs.append(cmd)
    return runs


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

                # 2. read the workspace files (real read: names + sizes into context)
                files_now = [p for p in FILES_DIR.iterdir() if p.is_file()]
                if files_now:
                    listing = ", ".join(f"{p.name} ({p.stat().st_size}B)" for p in files_now[:30])
                    yield step("workspace", "Reading workspace files", "done", listing)
                else:
                    yield step("workspace", "Workspace empty", "done")

                # 3. advisor pass — always on, runs live inside the stream
                advisor_usage, advisor_cost = {"in": 0, "out": 0}, 0.0
                advisor_note = ""
                if advisor:
                    yield step("advisor", f"Advisor review ({advisor['label']})", "run")
                    note, aerr, advisor_usage = advisor_pass(advisor, messages)
                    am = find_model(advisor_id) or {}
                    if am and not am.get("custom") and not am.get("local"):
                        advisor_cost = estimate_cost(am, advisor_usage["in"], advisor_usage["out"])
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
                if advisor_note:
                    system += (f"\n\nYour advisor reviewed this conversation and suggests: "
                               f"\"{advisor_note}\" Follow the advisor's guidance where it helps.")
                yield step("write", f"Writing reply ({model['label']})", "run")
                chunks, usage = [], {"in": 0, "out": 0}
                for kind, payload in model_stream(
                        model, messages, system,
                        int(req.get("max_tokens") or 1024),
                        float(req.get("temperature") or 0.7)):
                    if kind == "text" and payload:
                        chunks.append(payload)
                        yield ev("text", {"delta": payload})
                    elif kind == "usage":
                        usage = payload
                yield step("write", "Writing reply", "done")

                full_text = "".join(chunks)

                # 5. extract files + commands, then show the cleaned reply
                cleaned, files = extract_files(full_text)
                runs = extract_runs(full_text)
                if runs:
                    def _mark(m):
                        return f"ran: {m.group(1).strip()[:60]}"
                    cleaned = RUN_BLOCK_RE.sub(_mark, cleaned)
                saved = []
                if files:
                    for f in files:
                        yield step("files", f"Writing {f['name']}", "run")
                        safe = FILES_DIR / Path(f["name"]).name
                        safe.write_text(f["content"], encoding="utf-8")
                        saved.append({"name": safe.name, "lang": f.get("lang") or "text",
                                      "size": safe.stat().st_size})
                        yield step("files", f"Wrote {f['name']}", "done")
                    yield ev("files", {"files": saved, "cleaned_text": cleaned})

                # 6. run commands the reply contains
                for i, cmd in enumerate(runs[:5]):
                    if not ALLOW_CMDS:
                        yield step("cmd", "Commands disabled", "done",
                                   "set CHATCRAFT_ALLOW_CMDS=1 to enable")
                        break
                    yield step("cmd", f"Running: {cmd[:60]}", "run")
                    rc, out = run_command(cmd)
                    first = (out.strip().splitlines() or [""])[0][:120]
                    yield step("cmd", f"Ran: {cmd[:60]} (exit {rc})", "done", first)
                    yield ev("command", {"command": cmd, "returncode": rc, "output": out[:2000]})

                custom = bool(model.get("custom"))
                local = bool(model.get("local"))
                cost = 0.0 if (custom or local) else estimate_cost(
                    model, usage.get("in", 0), usage.get("out", 0))
                done = {
                    "usage": usage, "cost_usd": round(cost, 6),
                    "advisor_usage": advisor_usage,
                    "advisor_cost_usd": round(advisor_cost, 6),
                    "total_cost_usd": None if custom else round(cost + advisor_cost, 6),
                    "model": model["id"], "cost_known": not custom,
                    "files": [f["name"] for f in saved],
                }
                if local:
                    done.update({"cost_usd": 0.0, "total_cost_usd": 0.0,
                                 "cost_known": True, "local": True})
                yield ev("done", done)
            except Exception as e:
                yield ev("error", {"error": str(e)[:300]})

        self._sse(sse())


def estimate_cost(model, in_tokens, out_tokens):
    return (in_tokens / 1e6) * model.get("in", 1.0) + (out_tokens / 1e6) * model.get("out", 5.0)


if __name__ == "__main__":
    print(f"ChatCraft backend on http://localhost:{PORT}")
    print(f"  workspace: {FILES_DIR}")
    print(f"  commands:  {'enabled' if ALLOW_CMDS else 'DISABLED (CHATCRAFT_ALLOW_CMDS=0)'}")
    print(f"  ollama:    {OLLAMA_URL} (auto-detected if running)")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
