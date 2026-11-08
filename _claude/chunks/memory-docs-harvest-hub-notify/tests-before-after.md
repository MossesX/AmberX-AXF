<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md tokens=202 -->
## Tests before → after
- AXHub unit tests: 3 (`HubAddressTest`) → 2 (`AlertsTest`) + lib-hub `HubConformanceTest` 7 (5 fixture tests replayed locally with kotlinc 2.0.21: OK) + lib-notifications `AlertNotificationsTest` 4 (3 replayed locally: OK). Android CI compiles the rest (written without a compiler).
- Web: lib-hub 0 → 183 checks (`check-hub.mts`, now in CI). Unchanged and passing: check-mcp 210, check-widgets 93, alerts, plugin inventory, project fixtures 16, server tests (alerts, app_catalog 15, app_ci 32, plugin_catalog 19, wall_users 56), every plugin test.py.
- validate --framework, tracker --check, plugins --check, project validate --all, check-theme (206 → 208 files), axhub-android + console-web validate, console tsc + vite build: all clean. Fixtures: only `hub-approvals.json` added.
