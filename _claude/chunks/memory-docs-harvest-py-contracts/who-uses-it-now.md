<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md lines=22-35 tokens=267 -->
## Who uses it now

- `apps/console-web/plugins/ai-assistant/server/__init__.py`: `from axf.assistant_host import providers, sessions`,
  `from axf.contracts import assistant as contract`; sets the host hooks once at import (`providers.extra_kinds =
  store.extra_provider_kinds`, `stored_secret_names` = the console credential store's keys, `PRIVATE_ROOTS` = the
  console root, `PRIVATE_DIRS = [".axf-console"]`, `HOST_LABEL = "the console server"`) and `reload_catalog()`;
  `LocalHost(... label="This console" ...)`, `axhub_placeholder("this console")`. `tools.py` and `store.py` import
  the framework modules directly.
- `apps/console-web/plugins/agent-manager/server/*`: `from axf.contracts import agents as contract` (8 modules),
  `toolkit.py` uses `axf.assistant_host.safety`.
- Both plugin packages put `<repo>/framework/python` on `sys.path` (same pattern as the mcp-client plugin); the Docker
  image also sets `PYTHONPATH=/axf/framework/python`.
- Build Pilot: adoption steps below (its baked copies still point at the old plugin paths until re-baked).
