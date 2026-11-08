<!-- memory-chunk@1 source=_claude/memory/docs/project-guide.md lines=21-55 tokens=569 -->
## Stack & layout

TypeScript/React 18 + Vite (web), Node 22 (CLI/build engine, `.mjs`), Kotlin + Jetpack Compose (Android, JDK 17, AGP 8.7, API 35), Python 3.12 + FastAPI (console API + MCP).

```
framework/
  core/         web reference engines + runtime (TS, framework-agnostic)
  react/        AxfProvider, AppShell, controls, windows, studio views
  ui/axf.css    base stylesheet (reads only engine-compiled CSS vars)
  assets/       starter assets (asset@1), one folder per type
  schemas/      asset-types.json = single source of truth; json/ generated
  spec/         INTEROP.md, PORTING.md, fixtures/ (golden engine outputs)
  android/      Gradle build: axf-kernel, axf-platform-android, axf-ui,
                axf-assets, axf-nav, axf-data, axf-network, axf-devtools,
                axf-testing, lib-* (settings, logging real; admin,
                accounts, profile, billing placeholders; browser)
  cli/          axf.mjs (CLI), build-engine.mjs, tracker.mjs, engine-rpc.mjs
  catalog/      catalog.json, status.json, libraries.json (feature tracker)
  plan/         plan.json, build-queue.json (build order + completion)
  templates/    react-ts, next-ts, android-compose, web-fastapi-wall, android-module
  deploy/       axf-deploy.sh: shared VPS installer helpers (Coolify, axHub wall, auto-update) + test.sh
  boilerplates/ app starting points (boilerplate@1) + index.json
  library-templates/, libs/, python/   installable-library scaffolding
apps/
  demo/         web demo (untouched `axf init` output) -> axf.amberxai.com
  console-web/  web Dev Console (React/TS) + server/ (FastAPI, mcp_server.py)
  console/      Android showcase of the console (ai.amberx.axf.console)
  expenses/     Expense Tracker (Next.js, imported from MossesX/Expense with history) -> expenses.amberxai.com
deploy/         install.sh (demo), install-console.sh (sources framework/deploy/axf-deploy.sh), dryrun/ (before/after harness), panel/ (/panel UI)
_claude/        Claude files (rules/, instructions/, memory/, shared/), synced with /projects/amberx-axf/_claude
project.manifest.json   this repo's project manifest (apps/* have their own)
tracker.json    generated from catalog + status
.mcp.json       registers the axf MCP server (local stdio + console.amberxai.com)
```
