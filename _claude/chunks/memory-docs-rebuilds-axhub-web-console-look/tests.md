<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/axhub-web-console-look.md lines=61-67 tokens=75 -->
## Tests

- `npx -y tsx framework/spec/check-hub.mts`: 85 → **338** checks.
- `npx -y tsx apps/axhub-web/test.mjs`: 52 / 52 (now against the library).
- `apps/axhub-web`: `tsc --noEmit` + `vite build` clean; `axf validate apps/axhub-web` valid (57 assets).
- `check-theme`, `check-controls` clean.
