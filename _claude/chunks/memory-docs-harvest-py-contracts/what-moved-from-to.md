<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md tokens=472 -->
## What moved (from → to)

| Item | From | To | Notes |
| --- | --- | --- | --- |
| assistant@1 Python port (pure rules + SSE) | `apps/console-web/plugins/ai-assistant/server/contract.py` | `framework/python/axf/contracts/assistant.py` | + `normalize_chat_context`, `context_extra`, `CHAT_CONTEXT_KEYS/LIMITS`, `check_fixture` |
| agent-definition@1 Python port | `apps/console-web/plugins/agent-manager/server/contract.py` | `framework/python/axf/contracts/agents.py` | unchanged except the docstring |
| live-session@1 host side (log, reducer, `LocalHost`, `SessionHosts`, placeholder, service) | `plugins/ai-assistant/server/sessions.py` | `framework/python/axf/assistant_host/sessions.py` | `LocalHost(label=, note=, restart_reason=)`, `axhub_placeholder(runs_on=)` instead of console wording |
| provider adapters + registry loader (3 protocols, `register_protocol`, model lists, tests, embeddings, Claude Code CLI + bridge) | `plugins/ai-assistant/server/providers.py` | `framework/python/axf/assistant_host/providers.py` | console imports (`store`, `credentials`, `console_context`) replaced by host hooks (below); `AXF_PROVIDERS_FILE` override for baked schemas |
| MCP stdio bridge the CLI runs | `plugins/ai-assistant/server/cli_bridge.py` | `framework/python/axf/assistant_host/cli_bridge.py` | started by `providers._Bridge` with its own path |
| safety helpers (bounded calculator, SSRF-safe fetch) | `plugins/ai-assistant/server/safety.py` **and** `plugins/agent-manager/server/safety.py` (identical) | `framework/python/axf/assistant_host/safety.py` | one copy; `USER_AGENT` settable |

Deleted: the six plugin files above (git renames) plus the agent-manager's duplicate `safety.py`.
Not moved (console-specific, stays in the plugins): `store.py`, `tools.py`, both `__init__.py` routers, the agent
manager's engine/memory/toolkit/training/containers/addons/library/llm.
