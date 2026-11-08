<!-- memory-chunk@1 source=_claude/memory/docs/harvest/lib-github.md tokens=397 -->
## Tests before → after

| Test | Before | After |
| --- | --- | --- |
| `framework/python/axf_server/test.py` | 200 | 363 (fixture replay + client guards + git env) |
| `node framework/spec/check-github.mjs` | — | 143 |
| `node framework/spec/check-axf-server.mjs` | 90 | 90 |
| `server/test_app_ci.py` | 35 | 39 (fake API now a transport; artifact + job-log redirects fetched without the token; bad repo; artifact URL off api.github.com refused; token not on git's argv, scoped header + no redirects in env; the old `_http` redirect test moved into the library tests) |
| `server/test_app_catalog.py` | 15 | 15 (bundle now arrives through GitHub's redirect, asserted token-free) |
| `server/test_alerts.py`, `test_plugin_catalog.py` (19) | pass | pass |
| `server/test_wall_users.py` | needs a built dist (fails without, as before) | same |
| plugin `test.py` ×13 | all pass | all pass, same counts (ai-assistant failed once on its timing-sensitive CLI check, passed on rerun; it also passes on the base commit — not touched here) |
| `project-wizard/test.mjs`, `session-checkin/test.mjs`, `check-plugin-catalog.mjs` (27) | pass | pass |
| `framework/python/axf_libs/mcp/test.py` | 210 | 210 |
| validate --framework, tracker --check, plugins --check, project validate --all, check-theme, project fixtures (16), gen-fixtures (no diff), plugin-lifecycle check ×all | pass | pass |
| `mypy --strict -p axf_server` | 9 pre-existing errors in test.py | same 9 (github.py clean; pyright clean) |

No GUI changed (server/CLI only), so no screenshots. No web code changed, so no tsc/vite run.
