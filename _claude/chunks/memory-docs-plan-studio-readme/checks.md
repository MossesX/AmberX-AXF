<!-- memory-chunk@1 source=_claude/memory/docs/plan-studio/README.md lines=49-56 tokens=141 -->
## Checks

`python3 apps/console-web/plugins/plan-studio/test.py` (15 server checks, then `test.mjs`: 26 checks) · <!-- axf-plugin:plan-studio -->
`npx -y tsx apps/console-web/plugins/plan-studio/test.mjs` · console `tsc --noEmit` + `vite build` · AmberX `tsc`, <!-- axf-plugin:plan-studio -->
`test.mjs` (1990/1990), `vite build` (bundles plan-studio) and a typecheck of the plugin against AmberX's baked
framework · `check-theme`, `check-controls`, `check-plugin-pages`, `plugin-lifecycle check plan-studio`, `menu-reach`,
`plugins.mjs --check` (main profile).
