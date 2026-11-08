<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md tokens=304 -->
## Tests

| Suite | Before | After |
| --- | --- | --- |
| `apps/console-web/plugins/ai-assistant/test.py` | 137 | 128 (fixture replays moved out: −14 assistant@1 rule checks, −4 live-session replays; +9 new: framework imports, hooks, `extra` end-to-end, host naming) |
| `apps/console-web/plugins/agent-manager/test.py` | 116 | 117 (+1 framework-import check; fixture replay kept, it's one line) |
| `framework/python/axf/contracts/test.py` (new, CI) | — | 9 (assistant@1 fixture incl. 14 chat contexts, agent-definition@1 fixture, extra rules) |
| `framework/python/axf/assistant_host/test.py` (new, CI) | — | 54 (live-session fixture + LocalHost run, providers against a fake server, CLI hooks, safety) |
| every other `plugins/*/test.py` | green | green (same numbers) |
| `server/test_*.py` (alerts, app_ci 32, plugin_catalog 19, app_catalog 15, wall_users 56) | green | green |
| `AssistantConformanceTest` (Kotlin) | 7 tests | 8 tests — compiled by CI only |
| `axf validate --framework`, `tracker --check`, `plugins --check`, `project validate --all`, `check-theme`, `plugin-lifecycle check ai-assistant|agent-manager`, `gen-fixtures` (only assistant.json changed), console `tsc` + `vite build` | ok | ok |
