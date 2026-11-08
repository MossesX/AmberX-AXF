<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md tokens=83 -->
## Tests

| | before | after |
|---|---|---|
| `check-app-menu.mts` | — | 113 |
| `check-widgets.mts` | 215 | 215 |
| `gen-fixtures.mts` | 21 fixtures | 22 (one new, 21 unchanged) |
| `check-theme.mjs` | ok | ok (208 files) |
| `axf validate --framework` + every app | ok | ok |
| console `tsc --noEmit` + `vite build` | ok | ok |
