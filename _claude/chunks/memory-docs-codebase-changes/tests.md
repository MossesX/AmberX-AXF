<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md lines=85-92 tokens=209 -->
## Tests

`python3 apps/console-web/plugins/codebase-changes/test.py` (140: validation incl. build stats, Python = Node validators, routes, close everywhere, <!-- axf-plugin:codebase-changes -->
pagination + filters, hub-tree modes, the service, and the real console app in a child process for the token and 404)
and `node apps/console-web/plugins/codebase-changes/test.mjs` (100: rules, build stats, prices + transcript usage, classifier, CLI, hook incl. live progress/subagents/transcript cost, axHub backend against a fake hub, queue + flush, <!-- axf-plugin:codebase-changes -->
console-API backend against a fake console, hooks install/remove). Console `tsc` + `vite build`, `check-theme.mjs`,
`plugins.mjs --check`, `tracker.mjs --check`, `plugin-lifecycle.mjs check codebase-changes` (+ `--after-uninstall` on a scratch copy).
