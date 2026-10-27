#!/usr/bin/env python3
"""Chat-completions -> OpenAI Responses API adapter (recreated per NOTICE.md).

ChatCraft speaks OpenAI chat-completions; the platform's OpenAI proxy only
serves the Responses API (POST /responses). This shim listens on loopback,
translates both non-streaming and SSE-streaming calls, and forwards the
caller's Bearer token. Temperature is NEVER forwarded (reasoning models
return no text with a non-default temperature).
"""
import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_PORT = int(os.environ.get("ADAPTER_PORT", "8004"))
RESPONSES_BASE = os.environ.get("OPENAI_BASE_URL", "").rstrip("/") or \
    "https://agent-proxy.perplexity.ai/openai/v1"
FALLBACK_KEY = os.environ.get("OPENAI_API_KEY", "")


def _responses_payload(body):
    """Map a chat-completions body to a Responses API payload."""
    messages = body.get("messages") or []
    instructions = None
    input_msgs = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if isinstance(content, list):
            # multimodal: map each part to its Responses equivalent —
            # text -> input_text, image_url -> input_image (images must
            # survive, not be flattened to text)
            parts = []
            for p in content:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "image_url":
                    url = (p.get("image_url") or {}).get("url", "")
                    if url:
                        parts.append({"type": "input_image",
                                      "image_url": url})
                else:
                    t = p.get("text", "")
                    if t:
                        parts.append({"type": "input_text", "text": t})
            content = parts or ""
        if role == "system" and instructions is None:
            instructions = content
            continue
        input_msgs.append({"role": role, "content": content})
    # floor the budget: reasoning models burn tokens thinking before any
    # message text; a small max_tokens otherwise yields an empty reply
    budget = max(int(body.get("max_tokens") or 0), 1024)
    payload = {"model": body.get("model"), "input": input_msgs,
               "max_output_tokens": budget}
    if instructions:
        payload["instructions"] = instructions
    # NOTE: temperature intentionally dropped.
    return payload


def _extract_text(response):
    """Pull assistant text + usage out of a Responses API object."""
    text = ""
    for item in response.get("output") or []:
        if isinstance(item, dict) and item.get("type") == "message":
            for block in item.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "output_text":
                    text += block.get("text", "")
    u = response.get("usage") or {}
    usage = {"prompt_tokens": u.get("input_tokens", 0) or 0,
             "completion_tokens": u.get("output_tokens", 0) or 0}
    return text, usage


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _reply(self, code, obj):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth_headers(self):
        auth = self.headers.get("Authorization") or \
            ("Bearer " + FALLBACK_KEY if FALLBACK_KEY else "")
        return {"Authorization": auth} if auth else {}

    def do_POST(self):
        path = self.path.split("?")[0]
        if not (path.endswith("/chat/completions")):
            return self._reply(404, {"error": "adapter serves /chat/completions"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._reply(400, {"error": "bad JSON body"})
        payload = _responses_payload(body)
        headers = {"Content-Type": "application/json", **self._auth_headers()}

        if body.get("stream"):
            self._stream(payload, headers)
        else:
            self._once(payload, headers)

    def _once(self, payload, headers):
        req = urllib.request.Request(
            RESPONSES_BASE + "/responses",
            data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return self._reply(e.code, {"error": e.read().decode("utf-8", "replace")[:300]})
        except Exception as e:
            return self._reply(502, {"error": f"responses api unreachable: {str(e)[:200]}"})
        text, usage = _extract_text(resp)
        self._reply(200, {
            "id": resp.get("id", "resp"),
            "model": resp.get("model", payload["model"]),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}],
            "usage": usage,
        })

    def _stream(self, payload, headers):
        payload = dict(payload, stream=True)
        req = urllib.request.Request(
            RESPONSES_BASE + "/responses",
            data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        try:
            r = urllib.request.urlopen(req, timeout=180)
        except urllib.error.HTTPError as e:
            return self._reply(e.code, {"error": e.read().decode("utf-8", "replace")[:300]})
        except Exception as e:
            return self._reply(502, {"error": f"responses api unreachable: {str(e)[:200]}"})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def chunk(obj):
            return b"data: " + json.dumps(obj).encode("utf-8") + b"\n\n"

        model = payload["model"]
        try:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    ev = json.loads(data)
                except json.JSONDecodeError:
                    continue
                etype = ev.get("type", "")
                if etype == "response.output_text.delta":
                    self.wfile.write(chunk({
                        "model": model,
                        "choices": [{"index": 0,
                                     "delta": {"content": ev.get("delta", "")}}]}))
                    self.wfile.flush()
                elif etype == "response.failed":
                    err = (ev.get("response") or {}).get("error") or {}
                    self.wfile.write(chunk({"error": str(err)[:200]}))
                    self.wfile.flush()
                elif etype == "response.completed":
                    resp = ev.get("response") or {}
                    text, usage = _extract_text(resp)
                    # map upstream completion status honestly: an incomplete
                    # response (budget hit) must not look like a clean stop
                    fr = "length" if resp.get("status") == "incomplete" else "stop"
                    self.wfile.write(chunk({
                        "model": resp.get("model", model),
                        "choices": [{"index": 0, "delta": {},
                                     "finish_reason": fr}],
                        "usage": usage}))
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
        except Exception:
            pass  # client went away mid-stream
        finally:
            try:
                r.close()
            except Exception:
                pass


if __name__ == "__main__":
    print(f"responses adapter on 127.0.0.1:{LISTEN_PORT} -> {RESPONSES_BASE}/responses")
    ThreadingHTTPServer(("127.0.0.1", LISTEN_PORT), Handler).serve_forever()
