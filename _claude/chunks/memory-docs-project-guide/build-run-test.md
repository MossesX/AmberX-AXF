<!-- memory-chunk@1 source=_claude/memory/docs/project-guide.md tokens=946 -->
## Build, run, test

Build engine (Node 22, no install needed):
```bash
node framework/cli/axf.mjs validate --framework     # framework assets
node framework/cli/axf.mjs validate apps/demo
node framework/cli/tracker.mjs --check              # tracker.json in sync
node framework/cli/tracker.mjs                      # regenerate it
node framework/cli/axf.mjs schemas                  # regenerate JSON Schemas
node framework/cli/persist.mjs                      # where shared data is read from (/projects or repo); push | pull
node framework/cli/project.mjs validate --all       # every project manifest (also: list, rules, init, schema)
node framework/cli/claude-project.mjs [dir] --dry-run --yes   # what claude-project would do in a folder
node framework/spec/check-project-fixtures.mjs      # JS validator vs reference fixtures
node framework/spec/check-build-steps.mjs           # small-steps rule: pending + build-queue cores (40 checks)
node framework/spec/check-builds-store.mjs          # builds@1 store: migration loses nothing, projections, reorder, rename, harvest, apply/discard
node framework/cli/builds-store.mjs [verify|history <id>|restore <id> <rev>]   # the one builds store
node framework/cli/build-origin.mjs get <id> | addendum <id> --said "…" | missing   # what Brett said that started a build
node framework/spec/check-build-priority.mjs        # priority tags: levels, backfill, waiting-on, agent queue order
node framework/cli/rebake.mjs [status|apply <app>]  # apps whose baked src/axf is behind the framework; re-bake one
node framework/cli/watch-live.mjs targets|list      # Watch live: apps this checkout touches / live previews (axf focus <app> [route] [selector])
node framework/cli/pending.mjs --steps | --check-steps        # pending builds with their steps; what still needs splitting
node framework/cli/build-queue.mjs --steps | --check-steps    # same for the build queue
claude-sync status                                  # Claude files + shared data sync with the hub
npx -y tsx framework/spec/gen-fixtures.mts          # after changing a reference engine
npx -y tsx framework/spec/check-widgets.mts         # banner + widget host engines vs fixtures, validators agree, runtime host API
```
Web apps:
```bash
cd apps/demo && npm ci && npm run build             # also: npm run dev / typecheck
cd apps/console-web && npm install && npm run dev   # :5173, proxies /api to :7090
cd apps/console-web/server && pip install -r requirements.txt && uvicorn main:app --port 7090 --reload
```
CI re-bakes the framework into the console before building it: `rm -rf src/axf && mkdir -p src/axf && for d in core react ui schemas libs; do cp -r ../../framework/$d src/axf/; done` (run in `apps/console-web`).

Android needs **JDK 17, the Android SDK (API 35) and Maven/Google repo access**. That usually isn't available here, so **GitHub Actions (`.github/workflows/android.yml`) is the compiler.** There is **no Gradle wrapper** in the repo; CI uses Gradle 8.14.3:
```bash
cd framework/android && gradle :axf-kernel:test                 # kernel + conformance tests
cd framework/android && gradle assembleDebug publishToMavenLocal
cd apps/console && gradle :app:assembleDebug                    # console APK
```
CI artifacts: `console-debug.apk`, `axf-maven-repo`, `console-web-dist`, `kernel-test-reports`. Build failures are posted to an open GitHub issue titled "CI build errors" (and to the PR for kernel test failures). Read that issue rather than downloading artifacts.

Deploy: pushing to `main` runs `deploy.yml`, which builds `apps/demo` and force-pushes `dist/` to the `site` branch. The VPS pulls that branch every 2 minutes. The console runs as a Docker image (`apps/console-web/server/Dockerfile`, repo root as build context) behind Coolify.
