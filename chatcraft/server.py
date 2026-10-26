#!/usr/bin/env python3
"""Otto workspace backend.

Model chat with an always-on advisor pipeline, a tuning harness, and a
custom-models plugin (bring your own OpenAI-compatible or Anthropic-compatible
endpoint). Runs on port 8000 behind the preview proxy.
"""
import json
import os
import re
import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from anthropic import Anthropic
from openai import OpenAI

app = FastAPI(title="ChatCraft backend")

# ------------------------------------------------------------- generated files ---
# Files the chat writes (fenced code blocks with a filename) land here and are
# served back for the Files UI.
FILES_DIR = Path(__file__).parent / "files"
FILES_DIR.mkdir(exist_ok=True)

# ```lang filename.ext ... ```  (also accepts ```lang:filename.ext)
FILE_BLOCK_RE = re.compile(r"```([\w+#-]*)[ \t]*:?[ \t]*([\w./-]+\.[\w+#-]+)[ \t]*\n(.*?)```", re.S)


def extract_files(text: str):
    """Pull fenced code blocks that carry a filename. Returns (text, files):
    the code blocks are replaced by short 'wrote file' markers and the files
    are dicts with name/lang/content."""
    files = []

    def repl(m):
        lang, name, content = m.group(1), m.group(2), m.group(3)
        files.append({
            "name": Path(name).name,
            "lang": lang or "text",
            "content": content.rstrip("\n"),
        })
        return f"wrote file: {Path(name).name}"

    return FILE_BLOCK_RE.sub(repl, text), files


def save_file_record(f: dict) -> dict:
    """Persist one generated file and return its public record (no content)."""
    safe = Path(f["name"]).name
    path = FILES_DIR / safe
    path.write_text(f["content"], encoding="utf-8")
    return {
        "name": safe, "lang": f.get("lang") or "text",
        "size": path.stat().st_size,
        "modified": time.strftime("%H:%M", time.localtime(path.stat().st_mtime)),
    }

# ---------------------------------------------------------------- catalog ---
# Prices are rough public list prices, USD per million tokens (estimates only).
CATALOG = [
    {"id": "claude_sonnet_5_5", "label": "Claude Sonnet 5.5", "provider": "Anthropic", "tier": "balanced", "in": 3.0, "out": 15.0},
    {"id": "claude_opus_5_5", "label": "Claude Opus 5.5", "provider": "Anthropic", "tier": "quality", "in": 5.0, "out": 25.0},
    {"id": "claude_haiku_4_5", "label": "Claude Haiku 4.5", "provider": "Anthropic", "tier": "fast", "in": 1.0, "out": 5.0},
    {"id": "gpt_5_1", "label": "GPT-5.1", "provider": "OpenAI", "tier": "balanced", "in": 1.25, "out": 10.0},
    {"id": "gpt5_mini", "label": "GPT-5 mini", "provider": "OpenAI", "tier": "fast", "in": 0.25, "out": 2.0},
    {"id": "gpt5_nano", "label": "GPT-5 nano", "provider": "OpenAI", "tier": "cheapest", "in": 0.05, "out": 0.40},
    {"id": "gemini_3_1_pro", "label": "Gemini 3.1 Pro", "provider": "Google", "tier": "quality", "in": 2.0, "out": 12.0},
    {"id": "gemini_3_flash", "label": "Gemini 3 Flash", "provider": "Google", "tier": "fast", "in": 0.10, "out": 0.40},
    {"id": "grok_4_3", "label": "Grok 4.3", "provider": "xAI", "tier": "balanced", "in": 2.0, "out": 10.0},
]

CUSTOM_FILE = "/tmp/otto_custom_models.json"

DEFAULT_SYSTEM = (
    "You are Otto, a warm, concise personal-workspace assistant. "
    "Answer directly and helpfully. Use short paragraphs. Prefer plain language. "
    "FILE WRITING: when the user asks you to create, write or save a file, emit its full "
    "content as a fenced code block whose opening fence includes the language and filename, "
    "exactly like: ```markdown notes.md\n...content...\n```. The platform saves that file for "
    "the user automatically and shows it as a file card, so do NOT explain how to save or create "
    "the file manually - just confirm it was written. Only use this format when a file is "
    "genuinely wanted; ordinary code snippets stay in plain fences without a filename."
)

ADVISOR_SYSTEM = (
    "You are the Advisor: a fast, cheap reviewer that always runs before the main model. "
    "Given a conversation, produce a tight brief for it: (1) what the user really wants, "
    "(2) pitfalls or missing context to avoid, (3) how to make the answer high quality. "
    "Maximum 70 words. Plain text, no preamble."
)


def load_custom_models() -> List[dict]:
    try:
        with open(CUSTOM_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def save_custom_models(models: List[dict]):
    try:
        with open(CUSTOM_FILE, "w") as f:
            json.dump(models, f, indent=2)
    except Exception:
        pass


def all_models(redact: bool = True) -> List[dict]:
    custom = [dict(m, custom=True) for m in load_custom_models()]
    if redact:
        for m in custom:
            m.pop("api_key", None)  # never expose stored keys
    return CATALOG + custom


def find_model(model_id: str) -> Optional[dict]:
    for m in all_models(redact=False):
        if m["id"] == model_id:
            return m
    return None


def anthropic_client():
    # The proxy rejects the SDK's newest anthropic-version header; pin a supported one.
    return Anthropic(default_headers={"anthropic-version": "2023-06-01"})


# ---------------------------------------------------------------- helpers ---

def estimate_cost(model: dict, in_tokens: int, out_tokens: int) -> float:
    return (in_tokens / 1e6) * model.get("in", 1.0) + (out_tokens / 1e6) * model.get("out", 5.0)


def trim_history(messages: List[dict], keep: int = 12) -> List[dict]:
    """Keep the system-relevant tail of the conversation to control cost."""
    msgs = [m for m in messages if m.get("role") in ("user", "assistant") and m.get("content")]
    return msgs[-keep:]


def call_anthropic_stream(model_id: str, messages, system, max_tokens, temperature):
    # NOTE: the platform's Anthropic SDK build does not accept temperature/top_p.
    client = anthropic_client()
    stream = client.messages.create(
        model=model_id, system=system, messages=messages,
        max_tokens=max_tokens, stream=True,
    )
    usage = {"in": 0, "out": 0}
    for ev in stream:
        etype = getattr(ev, "type", "")
        if etype == "message_start":
            usage["in"] = ev.message.usage.input_tokens
        elif etype == "content_block_delta" and getattr(ev.delta, "type", "") == "text_delta":
            yield ("text", ev.delta.text)
        elif etype == "message_delta":
            usage["out"] = ev.usage.output_tokens
    yield ("usage", usage)


def call_openai_stream(model_id: str, messages, system, max_tokens, temperature):
    # Through the platform proxy, reasoning-family models (gpt5_nano/mini, grok)
    # don't emit text deltas when streamed. To avoid double-billing (stream that
    # yields nothing, then a retry), non-Claude models use one non-streaming call.
    # Temperature is omitted: the proxy's reasoning models reject it with 500s.
    client = OpenAI()
    input_msgs = ([{"role": "system", "content": system}] if system else []) + messages
    resp = client.responses.create(
        model=model_id,
        input=input_msgs,
        max_output_tokens=max_tokens,
    )
    text = resp.output_text or ""
    if text:
        yield ("text", text)
    u = getattr(resp, "usage", None)
    usage = {"in": 0, "out": 0}
    if u:
        usage = {"in": getattr(u, "input_tokens", 0) or 0, "out": getattr(u, "output_tokens", 0) or 0}
    yield ("usage", usage)


def call_custom_stream(model: dict, messages, system, max_tokens, temperature):
    if model.get("provider") == "anthropic-compat":
        client = Anthropic(base_url=model["base_url"], api_key=model["api_key"], default_headers={"anthropic-version": "2023-06-01"})
        stream = client.messages.create(
            model=model["model_name"], system=system, messages=messages,
            max_tokens=max_tokens, temperature=temperature, stream=True,
        )
        usage = {"in": 0, "out": 0}
        for ev in stream:
            etype = getattr(ev, "type", "")
            if etype == "message_start":
                usage["in"] = ev.message.usage.input_tokens
            elif etype == "content_block_delta" and getattr(ev.delta, "type", "") == "text_delta":
                yield ("text", ev.delta.text)
            elif etype == "message_delta":
                usage["out"] = ev.usage.output_tokens
        yield ("usage", usage)
    else:  # openai-compat via chat completions
        client = OpenAI(base_url=model["base_url"], api_key=model["api_key"])
        stream = client.chat.completions.create(
            model=model["model_name"],
            messages=([{"role": "system", "content": system}] if system else []) + messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield ("text", chunk.choices[0].delta.content)
            if getattr(chunk, "usage", None):
                yield ("usage", {"in": chunk.usage.prompt_tokens, "out": chunk.usage.completion_tokens})


def model_stream(model: dict, messages, system, max_tokens, temperature):
    """Route a model to the right SDK and yield ("text"|"usage", payload)."""
    if model.get("custom"):
        return call_custom_stream(model, messages, system, max_tokens, temperature)
    if model["id"].startswith("claude"):
        return call_anthropic_stream(model["id"], messages, system, max_tokens, temperature)
    return call_openai_stream(model["id"], messages, system, max_tokens, temperature)


def _advisor_attempt(model_id: str, messages):
    """Single advisor attempt. Returns (note, error, usage, cost_usd).
    The cost covers THIS attempt only, priced against the model actually
    called (a paid-but-empty response still counts). An empty review is
    treated as a failure so it can never silently bypass review."""
    usage = {"in": 0, "out": 0}
    note, error = "", ""
    try:
        if model_id.startswith("claude"):
            client = anthropic_client()
            resp = client.messages.create(
                model=model_id, system=ADVISOR_SYSTEM,
                messages=trim_history(messages, 4), max_tokens=200,
            )
            if getattr(resp, "usage", None):
                usage["in"] = getattr(resp.usage, "input_tokens", 0) or 0
                usage["out"] = getattr(resp.usage, "output_tokens", 0) or 0
            note = resp.content[0].text.strip()
        else:
            client = OpenAI()
            input_msgs = [{"role": "system", "content": ADVISOR_SYSTEM}] + trim_history(messages, 4)
            resp = client.responses.create(model=model_id, input=input_msgs, max_output_tokens=200)
            u = getattr(resp, "usage", None)
            if u:
                usage["in"] = getattr(u, "input_tokens", 0) or 0
                usage["out"] = getattr(u, "output_tokens", 0) or 0
            note = (resp.output_text or "").strip()
    except Exception as e:
        error = str(e)[:200]
    m = find_model(model_id)
    cost = estimate_cost(m, usage["in"], usage["out"]) if m and not m.get("custom") else 0.0
    if not error and not note:
        error = "advisor returned an empty review"
    return note, error, usage, round(cost, 6)


def run_advisor(model_id: str, messages):
    """Returns (note, error, usage, total_cost_usd). Falls back to a platform
    model when the requested advisor is custom or unknown, and retries once
    with the default model when the primary attempt fails or comes back
    empty. Costs from every attempt (including paid failures) are kept."""
    model = find_model(model_id)
    if not model or model.get("custom"):
        model_id = "claude_haiku_4_5"
    note, error, usage, cost = _advisor_attempt(model_id, messages)
    total_cost = cost
    if error and model_id != "claude_haiku_4_5":
        note2, error2, usage2, cost2 = _advisor_attempt("claude_haiku_4_5", messages)
        total_cost += cost2
        if not error2:
            note, error, usage = note2, error2, usage2
    return note, error, usage, round(total_cost, 6)


# --------------------------------------------------------------- endpoints ---

class ChatRequest(BaseModel):
    messages: List[dict]
    model: str = "claude_sonnet_5_5"
    advisor_enabled: bool = True
    advisor_model: str = "claude_haiku_4_5"
    temperature: float = 0.7
    max_tokens: int = 1024
    system_prompt: str = ""


@app.get("/api/health")
def health():
    return {"ok": True, "models": len(all_models())}


@app.get("/api/models")
def models():
    return {"models": all_models(), "default": "claude_sonnet_5_5", "advisor_default": "claude_haiku_4_5"}


class CustomModel(BaseModel):
    id: str
    label: str
    provider: str = "openai-compat"  # or "anthropic-compat"
    base_url: str
    api_key: str = ""
    model_name: str = ""


@app.get("/api/custom-models")
def get_custom():
    models = [{k: v for k, v in x.items() if k != "api_key"} for x in load_custom_models()]
    return {"models": [dict(x, custom=True) for x in models]}


@app.post("/api/custom-models")
def add_custom(m: CustomModel):
    if not m.base_url or not m.model_name:
        return JSONResponse({"error": "base_url and model_name are required"}, status_code=400)
    models = load_custom_models()
    models = [x for x in models if x["id"] != m.id]
    record = {
        "id": m.id or m.model_name, "label": m.label or m.model_name,
        "provider": m.provider, "base_url": m.base_url, "api_key": m.api_key,
        "model_name": m.model_name, "in": 0.0, "out": 0.0,
    }
    models.append(record)
    save_custom_models(models)
    public = [{k: v for k, v in x.items() if k != "api_key"} for x in models]
    return {"ok": True, "models": [dict(x, custom=True) for x in public]}


@app.delete("/api/custom-models/{model_id}")
def delete_custom(model_id: str):
    models = [x for x in load_custom_models() if x["id"] != model_id]
    save_custom_models(models)
    public = [{k: v for k, v in x.items() if k != "api_key"} for x in models]
    return {"ok": True, "models": [dict(x, custom=True) for x in public]}


@app.get("/api/files")
def list_files():
    out = []
    for p in sorted(FILES_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if not p.is_file():
            continue
        out.append({
            "name": p.name,
            "size": p.stat().st_size,
            "modified": time.strftime("%H:%M", time.localtime(p.stat().st_mtime)),
        })
    return {"files": out}


@app.get("/api/files/{name}")
def get_file(name: str):
    safe = Path(name).name
    path = FILES_DIR / safe
    if not path.is_file():
        return JSONResponse({"error": "no such file"}, status_code=404)
    return {"name": safe, "content": path.read_text(encoding="utf-8"), "size": path.stat().st_size}


@app.delete("/api/files/{name}")
def delete_file(name: str):
    safe = Path(name).name
    path = FILES_DIR / safe
    if path.is_file():
        path.unlink()
    return {"ok": True}


@app.post("/api/chat")
def chat(req: ChatRequest):
    model = find_model(req.model)
    if not model:
        return JSONResponse({"error": f"unknown model {req.model}"}, status_code=400)

    messages = trim_history(req.messages)
    if not messages:
        return JSONResponse({"error": "no messages"}, status_code=400)

    def step(id_, label, state):
        return f"event: step\ndata: {json.dumps({'id': id_, 'label': label, 'state': state})}\n\n"

    def sse():
        advisor_usage = {"in": 0, "out": 0}
        advisor_cost = 0.0
        try:
            # 1. read the conversation
            yield step("read", f"Read conversation ({len(messages)} messages)", "done")
            # 2. advisor pass (always on; runs live inside the stream)
            yield step("advisor", "Advisor review", "run")
            advisor_note, advisor_error, advisor_usage, advisor_cost = run_advisor(
                req.advisor_model, messages)
            if advisor_error:
                yield f"event: advisor-error\ndata: {json.dumps({'error': advisor_error})}\n\n"
                yield f"event: error\ndata: {json.dumps({'error': 'advisor unavailable: ' + advisor_error + ' - this turn was aborted so no unreviewed reply is sent.'})}\n\n"
                return
            yield step("advisor", "Advisor review", "done")
            if advisor_note:
                yield f"event: advisor\ndata: {json.dumps({'note': advisor_note})}\n\n"

            # 3. write the reply
            system = req.system_prompt or DEFAULT_SYSTEM
            if advisor_note:
                system = (
                    f"{system}\n\nYour advisor reviewed this conversation and suggests: "
                    f"\"{advisor_note}\" Follow the advisor's guidance where it helps."
                )
            yield step("write", "Writing reply", "run")
            usage = {"in": 0, "out": 0}
            chunks = []
            for kind, payload in model_stream(model, messages, system, req.max_tokens, req.temperature):
                if kind == "text" and payload:
                    chunks.append(payload)
                    yield f"event: text\ndata: {json.dumps({'delta': payload})}\n\n"
                elif kind == "usage":
                    usage = payload
            yield step("write", "Writing reply", "done")

            # 4. save any files the reply wrote
            full_text = "".join(chunks)
            cleaned, files = extract_files(full_text)
            saved = []
            if files:
                yield step("files", f"Writing {len(files)} file{'s' if len(files) != 1 else ''}", "run")
                for f in files:
                    saved.append(save_file_record(f))
                yield f"event: files\ndata: {json.dumps({'files': saved, 'cleaned_text': cleaned})}\n\n"
                yield step("files", f"Wrote {len(saved)} file{'s' if len(saved) != 1 else ''}", "done")

            custom = bool(model.get("custom"))
            cost = 0.0 if custom else estimate_cost(model, usage.get("in", 0), usage.get("out", 0))
            done = {
                "usage": usage, "cost_usd": round(cost, 6),
                "advisor_usage": advisor_usage,
                "advisor_cost_usd": round(advisor_cost, 6),
                "total_cost_usd": None if custom else round(cost + advisor_cost, 6),
                "model": model["id"], "cost_known": not custom,
                "files": [f["name"] for f in saved],
            }
            yield f"event: done\ndata: {json.dumps(done)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)[:300]})}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
