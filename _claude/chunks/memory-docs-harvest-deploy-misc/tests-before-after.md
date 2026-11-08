<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=105-123 tokens=321 -->
## Tests before → after

| Check | Before | After |
| --- | --- | --- |
| `axf validate --framework` | 48 assets valid | 49 assets valid |
| tracker / plugins / project validate --all / check-theme | ok / ok / 4 projects ok / 206 files | ok / ok / 4 projects ok / 213 files |
| check-project-fixtures, check-plugin-catalog | 16 / 27 | 16 / 27 |
| gen-fixtures | — | only `uac.json` + `hub-accounts` case |
| check-widgets / check-alerts / check-plugin-inventory | pass | pass (93 / pass / pass) |
| plugin-lifecycle check (mcp-client, systems-check, ai-assistant, agent-manager) | clean | clean |
| `framework/deploy/test.sh` | — | 39 checks |
| shellcheck `framework/deploy/*.sh` | — | clean (all severities) |
| shellcheck `deploy/install-console.sh` | 6 findings | same 6 (pre-existing, untouched lines) |
| install-console dry-run diff | — | docker/output/.axf-console identical in 11 scenarios |
| `check-addons.mts` | — | 3 add-ons valid; a bad one is caught (exit 1) |
| web-fastapi-wall: init + `npm run build` + server self-test + live uvicorn + sandboxed installer | — | ok, 29 checks, ok, ok |
| console `tsc --noEmit` + `vite build`; `test_wall_users.py` | ok; fails without dist (same at base) | ok; 56 checks with the built dist |
| framework libs typecheck | ok | ok |
