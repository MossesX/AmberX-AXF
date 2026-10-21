"""Reusable runtime every Python assistant host needs (stdlib only; the console plugin, Build Pilot's server, …).

  providers   provider registry loader (framework/schemas/ai-providers.json + an app's own kinds), the three wire
              protocols (anthropic, openai-compatible, Claude Code CLI) + `register_protocol`, model lists, tests,
              embeddings, `collect`
  sessions    live-session@1 host side: `EventLog`, `reduce`, `Session`, `SessionHost` + `PlaceholderHost`,
              `LocalHost` (threads + saved logs), `SessionHosts` open registry, `LiveSessionsService`
  safety      bounded calculator + SSRF-safe `fetch` (host resolved once, address checked, connection pinned)
  cli_bridge  the MCP stdio server the Claude Code CLI starts for one turn (started by providers, never imported)

The pure rules live in `axf.contracts.assistant`; this package is the part that touches models, threads and files.
Hosts customise through the module-level hooks (providers.extra_kinds, providers.stored_secret_names,
providers.PRIVATE_DIRS, providers.USER_AGENT, LocalHost(label=…, note=…), axhub_placeholder(runs_on=…)) — never by
editing a copy. Self-test: `python3 framework/python/axf/assistant_host/test.py`.
"""
