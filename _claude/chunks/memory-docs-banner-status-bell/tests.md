<!-- memory-chunk@1 source=_claude/memory/docs/banner-status-bell.md tokens=154 -->
## Tests

| check | result |
| --- | --- |
| `python3 …/main-build-status/test.py` (fake GitHub on loopback + runtime replay) | 43 ok |
| `python3 …/alerts-bell/test.py` (runtime replay + toolbar) | 19 ok |
| console `npx tsc --noEmit` + `npx vite build` | ok |
| `node framework/cli/check-theme.mjs` | ok |
| `npx -y tsx framework/spec/check-widgets.mts` | 215 ok |
| `node framework/cli/plugins.mjs --check`, `tracker.mjs --check` | ok |
| `node framework/cli/axf.mjs validate apps/console-web` | valid (66 assets; baked-file warnings were there before) |
| `plugin-lifecycle.mjs check <folder>` (both) | clean |
