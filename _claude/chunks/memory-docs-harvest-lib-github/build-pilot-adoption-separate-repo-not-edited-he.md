<!-- memory-chunk@1 source=_claude/memory/docs/harvest/lib-github.md lines=94-108 tokens=233 -->
## Build Pilot adoption (separate repo; not edited here)

Build Pilot makes no GitHub calls of its own today (APK builds go through the console's `app-ci@1`), so nothing to
switch. When it needs GitHub, bake the module rather than writing a copy:

1. `scripts/bake-contracts.mjs` → add to `FILES` (with the axf-server entries from the axf-server report):
   ```js
   'framework/python/axf_server/github.py': 'server/axf_server/github.py',
   'framework/spec/fixtures/github.json': 'src/axf/spec/fixtures/github.json',
   ```
   then `node scripts/bake-contracts.mjs --from ../amberx-axf` after this branch is on main and commit the lock.
2. Use `from axf_server import github; gh = github.GitHubClient(lambda: os.environ.get("BP_GITHUB_TOKEN", ""), user_agent="build-pilot")`.
3. Add a replay of `src/axf/spec/fixtures/github.json` to `server/test_server.py` (copy the section-6 loops from
   `framework/python/axf_server/test.py`).
