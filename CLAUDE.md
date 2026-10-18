# AmberX AXF

Cross-platform app framework where every UI piece (theme, layout, menu, toolbar, dialog, popup, button, slider, container, access policy) is a hot-swappable JSON asset in one shared format, `asset@1`. One framework, several ports: the **web port** (TypeScript reference engines + React) and the **Android port** (Kotlin/Compose, pure-Kotlin kernel). Apps built on it (starting with the Dev Console) define and extend the framework as they are built.

## Status (as of Oct 17 2026)

- **Built:** web reference engines (`framework/core`), React layer, 39 starter assets, build engine + CLI (`axf init/validate/new-asset/install/import-ui/serve/dev`), Android kernel + modules, Android console showcase, web Dev Console + Python API + MCP server (`/mcp`, 24 tools), CI, demo site deploy. Build-queue steps `x.assets` … `x.console.mcp` are done.
- **Just merged (PR #2, commit 2d7a1ac):** protocol-neutral **kernel interop contracts** in `axf-kernel/.../interop` — action/event descriptors, default-deny exposure (LOCAL/LINKED/REMOTE), remote callers, callable actions, protocol adapters, `surface@1`, wire error codes, `axf.jobs`/`axf.remote` placeholders. Spec: `framework/spec/INTEROP.md`. Written without Maven access; Android CI is what compiles and tests it.
- **Next:**
  - Port the same interop contracts to the web kernel `framework/core` (same names, codes, checks). Not done yet.
  - Planned modules: `lib-mcp` (MCP server + client), `lib-hub` (axHub connector), `axf-link` (`axf-link@1`, AXF ⇄ AXF), `lib-hub-admin` (console tab managing axHub). Implement `axf.jobs` and `axf.remote`.
  - Open build-queue steps (`framework/plan/build-queue.json`): `x.modules`, `x.deploy.console`, `x.state`, `x.uikits`, `x.libs.core`, `x.engine.uiport`, `x.engine.dev`, `x.session`, `x.python.port`, `x.plugins`, `x.work`, `x.showcase.packs`, `x.lib.*` (media, location, editor, ai, vps, github, notifications, sensors, files, charts), `x.console.repo`.
- **Console plugins (Oct 17 2026):** `apps/console-web/plugins/<folder>/` (plugin@1 manifest + `web/index.tsx` exporting an `AxfWebLibrary` + optional `server/__init__.py` router at `/api/plugins/<folder>/`). Server routes always need the console token and 404 when disabled; never exposed via the console MCP. Libraries can now contribute a nav section (`AxfWebLibrary.nav` → `runtime.setNavSection`). Template: `plugins/_template`; guide: `plugins/README.md`. First real plugin planned: the axHub admin tab (`lib-hub-admin`).
- **Settings library (Oct 17 2026):** `framework/libs/settings` (web, id `ai.amberx.axf.settings`): tabs Appearance, Account & security, Connections, Plugins, About; libraries/plugins contribute `settings` groups, `settingsPanels` and `settingsTabs` via `AxfWebLibrary`. Contract in `framework/core/settings.ts` mirrors Android `SettingsGroup`/`SettingSpec` (Android got the matching `tab` field). The console installs it as a built-in; its plugin manager is now Settings → Plugins.
- **Feature tracker:** `framework/catalog/status.json` has 187 built, 13 partial, 140 placeholder, 71 planned. `tracker.json` summarises coverage per area.
- **Hosting:** demo moving from `xaf.amberxai.com` to `axf.amberxai.com` (`deploy/install.sh` migrates the old setup). Dev Console planned live at `console.amberxai.com` (`deploy/install-console.sh`).

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
  templates/    react-ts, next-ts, android-compose, android-module
  boilerplates/ app starting points (boilerplate@1) + index.json
  library-templates/, libs/, python/   installable-library scaffolding
apps/
  demo/         web demo (untouched `axf init` output) -> axf.amberxai.com
  console-web/  web Dev Console (React/TS) + server/ (FastAPI, mcp_server.py)
  console/      Android showcase of the console (ai.amberx.axf.console)
deploy/         install.sh (demo), install-console.sh, panel/ (/panel UI)
tracker.json    generated from catalog + status
.mcp.json       registers the axf MCP server (local stdio + console.amberxai.com)
```

## Build, run, test

Build engine (Node 22, no install needed):
```bash
node framework/cli/axf.mjs validate --framework     # framework assets
node framework/cli/axf.mjs validate apps/demo
node framework/cli/tracker.mjs --check              # tracker.json in sync
node framework/cli/tracker.mjs                      # regenerate it
node framework/cli/axf.mjs schemas                  # regenerate JSON Schemas
npx -y tsx framework/spec/gen-fixtures.mts          # after changing a reference engine
```
Web apps:
```bash
cd apps/demo && npm ci && npm run build             # also: npm run dev / typecheck
cd apps/console-web && npm install && npm run dev   # :5173, proxies /api to :7090
cd apps/console-web/server && pip install -r requirements.txt && uvicorn main:app --port 7090 --reload
```
CI re-bakes the framework into the console before building it: `rm -rf src/axf && mkdir -p src/axf && for d in core react ui schemas; do cp -r ../../framework/$d src/axf/; done` (run in `apps/console-web`).

Android needs **JDK 17, the Android SDK (API 35) and Maven/Google repo access**. That usually isn't available here, so **GitHub Actions (`.github/workflows/android.yml`) is the compiler.** There is **no Gradle wrapper** in the repo; CI uses Gradle 8.14.3:
```bash
cd framework/android && gradle :axf-kernel:test                 # kernel + conformance tests
cd framework/android && gradle assembleDebug publishToMavenLocal
cd apps/console && gradle :app:assembleDebug                    # console APK
```
CI artifacts: `console-debug.apk`, `axf-maven-repo`, `console-web-dist`, `kernel-test-reports`. Build failures are posted to an open GitHub issue titled "CI build errors" (and to the PR for kernel test failures). Read that issue rather than downloading artifacts.

Deploy: pushing to `main` runs `deploy.yml`, which builds `apps/demo` and force-pushes `dist/` to the `site` branch. The VPS pulls that branch every 2 minutes. The console runs as a Docker image (`apps/console-web/server/Dockerfile`, repo root as build context) behind Coolify.

## Conventions & decisions

- **Everything visible is an asset** (`asset@1`). Engines compile assets into tokens/variables; UI reads only compiled tokens and never hardcodes colours or sizes. Hot-swap = `runtime.swap(type, id)`.
- `framework/schemas/asset-types.json` is the single source of truth for asset types. Per-port extensions live in files like `asset-types.android.json`.
- **Engine compatibility across ports is a hard constraint.** Kotlin kernel and TS `framework/core` are the same design, file for file. Fixtures in `framework/spec/fixtures` are the conformance contract. Change a reference engine, then regenerate fixtures.
- Android kernel is **pure Kotlin (no Android imports)**. Platform specifics go behind kernel seams. Packages are `ai.amberx.axf.*`, Maven coordinates are `ai.amberx.axf:<module>:<version>`.
- **Interop:** the kernel never knows a protocol. Protocols are modules contributing a `ProtocolAdapter`. Exposure is default-deny, and a remote caller can never exceed the local UAC role. Wire error codes never change meaning (see INTEROP.md).
- **React/TS port:** the first React/TS app built on it sets the conventions, so it must stay engine-compatible for Android porting.
- `axf init` **bakes** `core/ react/ ui/ schemas/` into an app's `src/axf/` and records hashes in `axf.lock.json`. Change the framework, not baked copies.
- Feature status lives in `framework/catalog/status.json`. Build order and completion live in `framework/plan/build-queue.json`, which the MCP tools `build_next` and `build_step` drive. Update both, then run `tracker.mjs`, whenever something lands.
- Model policy baked into the MCP server and build queue: Fable where needed, Opus otherwise, Sonnet only when Opus clearly isn't required.
- No secrets: `AXF_TOKEN` and `GITHUB_TOKEN` are environment variables only. `.mcp.json` references `${AXF_TOKEN}`.

## Related repos

- **`MossesX/axHub`**: standalone connector hub at `axhub.amberxai.com`. axHub never depends on AXF. AXF plugs in from its side via `lib-hub` (protocol defined by axHub: AXPP) and the `axhub-adapter-axf` plugin, which lives in **this** repo. axHub's step 3 proxies this console's `/mcp` as its first downstream service.
- **`MossesX/studiox`**: AmberX AI Studio (Next.js), an earlier, separate `@axf/core` line. It does not consume this repo.
- **`MossesX/amberx`**: earlier PyQt6 desktop AmberX framework (dormant). This repo's planned `python` port (`x.python.port`) is separate from it.


---

## Working with Brett (same in every MossesX repo)

- **Where he works:** mostly from his Android phone (Samsung Galaxy S26 Ultra), often through **Moshi** (mosh) into his Hostinger VPS, where Claude Code runs. Keep replies phone-readable: lead with the result, short paragraphs, no walls of text.
- **Model choice:** before any build task, recommend which model to use and why, then let him pick from the top three (Fable, Opus, Sonnet). Use Fable where it's warranted, Opus for most work, and Sonnet only when you're sure Opus isn't needed.
- **The repo is the shared memory.** Sessions on the phone (Moshi), desktop, web and claude.ai don't share chat history, so anything a future session needs must live in this repo. Commit and push often with clear messages, and update the **Status** section of this file whenever something meaningful changes.
- **No secrets in the repo:** no tokens, passwords, keys or IPs with credentials. Use environment variables or GitHub Actions secrets.
- **GitHub:** account `MossesX`. A new repo must exist on GitHub before a session can push to it.
- **Server:** a Hostinger VPS running **Coolify**. Coolify's Traefik proxy owns ports 80/443, so new web apps go behind it as Coolify apps (no separate nginx). His domain is `amberxai.com`.
- **axHub:** his connector hub on the VPS (repo `MossesX/axHub`). If the axHub MCP server is configured in this Claude Code install, use its `list_services`, `describe_service` and `call` tools to reach his other services instead of asking him for credentials.
