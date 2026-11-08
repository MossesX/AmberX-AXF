<!-- memory-chunk@1 source=_claude/memory/docs/axhub-web.md lines=54-63 tokens=157 -->
## Tests

- `npx -y tsx apps/axhub-web/test.mjs` — 52 checks over the pure rules: what each status means, malformed projects,
  files, sizes and hashes dropped, links rebuilt, caps (100 apps, 5 builds), duplicates, sorting, sizes, relative
  times, approval expiry wording.
- `apps/axhub-web`: `tsc --noEmit` + `vite build` (CI re-bakes the framework into it first, as it does for the
  console).
- axHub: `packages/server/test/apps.test.ts` grew 5 cases (JSON 401, a named site reading it with credentials, another
  site refused, the permission still required, and the cookie-domain rules of `crossSiteOk`). 330 tests pass.
