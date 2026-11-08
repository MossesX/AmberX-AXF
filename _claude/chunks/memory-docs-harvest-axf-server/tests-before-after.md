<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md lines=72-86 tokens=279 -->
## Tests before → after

| Test | Before | After |
| --- | --- | --- |
| `framework/python/axf_server/test.py` | — | 200 |
| `node framework/spec/check-axf-server.mjs` | — | 90 |
| `server/test_app_ci.py` | 32 | 35 (redirect test now on axf_server.http: token kept on api.github.com, dropped off it, plain http refused) |
| `server/test_alerts.py`, `test_app_catalog.py` (15), `test_plugin_catalog.py` (19) | pass | pass |
| `server/test_wall_users.py` (needs a built dist) | 56 (with a dist) | 56 |
| `framework/python/axf_libs/mcp/test.py` | 210 | 210 |
| plugin `test.py` ×13 (activity 57, agent-manager 116, ai-assistant 137, claude-badge 17, console-terminal 28, container-access 102, fable-rebuilds 12, feature-assist 29, mcp-client 24, plugin-manager 62, snapshot-manager 49, systems-check 79, theme-manager 34) | all pass | all pass, same counts |
| validate --framework, tracker --check, plugins --check, project validate --all, check-theme, check-plugin-catalog (27), project fixtures (16), gen-fixtures (no diff), console tsc + vite build | pass | pass |

No GUI changed (server-only), so no screenshots.
