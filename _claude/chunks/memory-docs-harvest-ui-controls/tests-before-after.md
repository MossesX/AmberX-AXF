<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=112-130 tokens=295 -->
## Tests before → after

| Check | Before | After |
| --- | --- | --- |
| `axf validate --framework` | 48 assets ok | 48 assets ok |
| `tracker --check`, `plugins --check`, `project validate --all` | ok | ok |
| `check-theme.mjs` | 206 files, 67 tokens | 206 files, 69 tokens (`--fx-switch-w/h` are private to `.fx-switch`, declared in axf.css) |
| `check-widgets.mts` | 93 | 93 |
| `check-library-params.mts` | — | 801 |
| `check-plugin-inventory.mts` | ok | ok |
| `gen-fixtures` then `git diff --quiet fixtures` | clean | clean except the new `library-params.json` |
| `tsc --noEmit` + `vite build` (console-web) | ok | ok |
| `theme-swap.mjs` | (CI) | 565 elements, 0 fixed colours ✓ |
| Python: test_alerts, test_app_ci 32, test_plugin_catalog 19, test_app_catalog 15, test_wall_users 56 | pass | pass |
| Plugin `test.py` (13 plugins, 766 checks) + session-checkin + project-wizard | pass | pass |
| `plugin-lifecycle check` plugin-switches / theme-manager / systems-check / ai-assistant | clean | clean |
| `axf validate` apps/console-web, console, voicevault, axhub-android | ok | ok |
| Kotlin `LibraryParamsTest`, `ConformanceTest` etc. | CI | CI (not compiled here) |
