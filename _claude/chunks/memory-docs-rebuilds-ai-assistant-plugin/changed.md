<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md lines=47-63 tokens=369 -->
## Changed
- `providers.py`: catalog loaded from `framework/schemas/ai-providers.json` + `<dataDir>/providers.json` (open
  registry; `reload_catalog()`, `POST /providers/reload`); protocol dispatch through `PROTOCOLS` + `register_protocol`;
  per-kind `maxTokensField`, `noStreamUsage`, `embedModel` come from the registry instead of `if kind == …`.
- `sessions.py`: `SessionHost` base, `PlaceholderHost`, `SessionHosts` registry (`register/get/list/describe/resolve`),
  `LocalHost.on_interrupted` hook, session `owner`; `LiveSessionsService(hosts, local)` gains `register_host()`.
- `store.py`: `schema` field + `migrate()` runner (no steps today), `extra_provider_kinds()`, cached conversation
  index (`_scan`, mtime+size) so listing/search doesn't re-read unchanged files, `tag` filter, `all_tags()`,
  `user_usage_summary()`.
- `__init__.py`: rules delegated to `contract.py`; `_hosts()` merges an `axf.live-host@1` provider; `send_message`
  resolves the host (503 when none is available); `_keep_interrupted` saves streamed text on restart.
- Web: `api.ts` is a thin binding of `HttpAssistantClient` (types re-exported from `@console/axf/core`); `chat.tsx`
  uses `watchReply`/`applyStreamEvent` from the framework instead of its own copy; settings panel wording and
  the Live sessions panel show the contracts and hosts.
- Console bake: `apps/console-web/src/axf/core/{assistant.ts,index.ts}` and `src/axf/schemas/ai-providers.json`
  updated (CI re-bakes anyway).
