#!/usr/bin/env python3
"""ChatCraft launcher (recreated per NOTICE.md).

Imports server.py unmodified, then patches CATALOG so catalog models route
through the platform's LLM proxy:
  - anthropic-kind entries -> the Anthropic proxy (ANTHROPIC_BASE_URL)
  - openai-kind entries    -> the local responses_adapter on 127.0.0.1:8004
Every catalog id is also the proxy's model id (verified 2026-10-27 by probing
each id against both proxies). Extras are appended BEFORE routing so they
get the same base_url/key treatment as the stock entries.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402  (imported unmodified)

ANTHROPIC_PROXY = os.environ.get("ANTHROPIC_BASE_URL", "").rstrip("/") or \
    "https://agent-proxy.perplexity.ai/anthropic"
ADAPTER = "http://127.0.0.1:8004/v1"

EXTRAS = [
    {"id": "claude_sonnet_4_5", "label": "Claude Sonnet 4.5", "provider": "Anthropic",
     "tier": "balanced", "in": 3.0, "out": 15.0,
     "api": {"kind": "anthropic", "model": "claude_sonnet_4_5", "env": "ANTHROPIC_API_KEY"}},
    {"id": "claude_opus_4_5", "label": "Claude Opus 4.5", "provider": "Anthropic",
     "tier": "quality", "in": 5.0, "out": 25.0,
     "api": {"kind": "anthropic", "model": "claude_opus_4_5", "env": "ANTHROPIC_API_KEY"}},
    {"id": "claude_haiku_4_5", "label": "Claude Haiku 4.5", "provider": "Anthropic",
     "tier": "fast", "in": 0.8, "out": 4.0,
     "api": {"kind": "anthropic", "model": "claude_haiku_4_5", "env": "ANTHROPIC_API_KEY"}},
    {"id": "gpt_5_2", "label": "GPT-5.2", "provider": "OpenAI",
     "tier": "balanced", "in": 1.25, "out": 10.0,
     "api": {"kind": "openai", "model": "gpt_5_2", "env": "OPENAI_API_KEY"}},
    {"id": "gpt_5_2_pro", "label": "GPT-5.2 Pro", "provider": "OpenAI",
     "tier": "quality", "in": 5.0, "out": 20.0,
     "api": {"kind": "openai", "model": "gpt_5_2_pro", "env": "OPENAI_API_KEY"}},
    {"id": "gpt_5_4", "label": "GPT-5.4", "provider": "OpenAI",
     "tier": "balanced", "in": 1.5, "out": 12.0,
     "api": {"kind": "openai", "model": "gpt_5_4", "env": "OPENAI_API_KEY"}},
]


def patch_catalog():
    for extra in EXTRAS:
        if not any(x["id"] == extra["id"] for x in server.CATALOG):
            server.CATALOG.append(extra)
    for m in server.CATALOG:
        api = dict(m.get("api") or {})
        api["model"] = m["id"]  # catalog ids are exactly the proxy's ids
        if api.get("kind") == "anthropic":
            api["base_url"] = ANTHROPIC_PROXY
            api["env"] = "ANTHROPIC_API_KEY"
        else:
            api["kind"] = "openai"
            api["base_url"] = ADAPTER
            api["env"] = "OPENAI_API_KEY"
        m["api"] = api


if __name__ == "__main__":
    patch_catalog()
    print(f"ChatCraft backend on http://{server.HOST}:{server.PORT}")
    print(f"  anthropic proxy: {ANTHROPIC_PROXY}")
    print(f"  openai-family:   {ADAPTER} (responses adapter)")
    print(f"  ollama:          {server.OLLAMA_URL} (auto-detected if running)")
    server.start_scheduler()
    server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler).serve_forever()
