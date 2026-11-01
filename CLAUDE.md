# AmberX AXF

Cross-platform app framework where every UI piece (theme, layout, menu, toolbar, dialog, popup, button, slider, container, access policy) is a hot-swappable JSON asset in one shared format, `asset@1`. One framework, several ports: the **web port** (TypeScript reference engines + React) and the **Android port** (Kotlin/Compose, pure-Kotlin kernel). Apps built on it (starting with the Dev Console) define and extend the framework as they are built.

**Brett's rules (always loaded):**

@_claude/shared/rules/RULES.md
@_claude/rules/RULES.md

**Fix it yourself (Brett, Oct 30 2026):** when something is broken and the tools at hand can fix it (a dead key, a stuck or crashed build, a failed launch, CI red, a restarting container, missing config), fix it straight away as a veto call with a plain reason, then tell him what was fixed. Never ask whether to fix it; ask only when it needs his hands (a new token on github.com, paying, a device) or a real choice, and then put it in a banner item with the exact steps.

**Threads and builds (read on every load):** `_claude/THREADS.md` lists every thread, its state, branch, PR and queued items. Read it first, pick up from it, and update + commit it whenever a thread starts, changes, opens or merges a PR, or queues an item. All build work lives in the repo (branches, PRs, this log), never only in chat.

Everything else Claude should know is in `_claude/` (axhub-projects@1, see `_claude/README.md`): `rules/`, `instructions/`, `memory/` (decisions in `memory/decisions.md`, specs in `memory/docs/`) and `shared/` for all projects. It syncs with the hub's `/projects/amberx-axf/_claude/` (and `shared/` with `/projects/_shared/_claude/`); the `claude-sync start` SessionStart hook syncs and loads it. Edit it, run `claude-sync sync`, commit.

## Status

Lives in `_claude/memory/STATUS.md` (about 237K characters; not loaded automatically). Don't read it whole: Grep it for the feature you're working on and read only those lines. Per-feature docs are in `_claude/memory/docs/`.

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
deploy/         install.sh (demo), install-console.sh (sources framework/deploy/axf-deploy.sh), dryrun/ (before/after harness), panel/ (/panel UI)
_claude/        Claude files (rules/, instructions/, memory/, shared/), synced with /projects/amberx-axf/_claude
project.manifest.json   this repo's project manifest (apps/* have their own)
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
node framework/cli/persist.mjs                      # where shared data is read from (/projects or repo); push | pull
node framework/cli/project.mjs validate --all       # every project manifest (also: list, rules, init, schema)
node framework/cli/claude-project.mjs [dir] --dry-run --yes   # what claude-project would do in a folder
node framework/spec/check-project-fixtures.mjs      # JS validator vs reference fixtures
node framework/spec/check-build-steps.mjs           # small-steps rule: pending + build-queue cores (40 checks)
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
- **Plugin and library UIs conform to the theme engines** (tokens only, framework layout primitives, `axf-<lib>` / `axp-<plugin>` naming, never define `--fx-*`); a plugin wanting its own look ships its own assets through the engines (scoping not built yet). The future plugin designer depends on this. Spec: `framework/spec/THEMING.md`. CI checks: `node framework/cli/check-theme.mjs` (static) and `apps/console-web/scripts/theme-swap.mjs` (switches every colour and style theme in the built console and fails on any colour or transparency that doesn't follow).
- **Transparency is themed too:** style themes carry `opacityDisabled/Muted/Hover/Tint/Scrim/Glass` (→ `--fx-opacity-*`, same defaults on both ports). Translucent colours are `color-mix(in srgb, var(--fx-x) calc(var(--fx-opacity-…) * 100%), transparent)`, never a fixed percentage. `apps/demo` still has an older baked framework and needs a re-bake to get them.
- **Console sizes are tokens (Oct 17 2026):** `console.css` and the console views use `--fx-space`, `--fx-font-size`, `--fx-radius-*` and `--fx-border-w` (exact at the default soft-studio theme, so it looks pixel-identical there); the console is held to every theme rule. Shapes stay fixed: pill radii (999px), bar/chart heights, icon sizes.
- **Build options are `--switches` on every build driver** (CLI, engine-rpc, serve, console API/UI, MCP), defined only in `framework/schemas/build-options.json`; each sets an asset token, and new builds default every option off.
- **Every project has a validated manifest** (`project.manifest.json`); nothing is loaded or compiled without one. Rules live in `framework/schemas/project-rules.json` (Dev Console → Standards).
- `framework/schemas/asset-types.json` is the single source of truth for asset types. Per-port extensions live in files like `asset-types.android.json`.
- **Engine compatibility across ports is a hard constraint.** Kotlin kernel and TS `framework/core` are the same design, file for file. Fixtures in `framework/spec/fixtures` are the conformance contract. Change a reference engine, then regenerate fixtures.
- Android kernel is **pure Kotlin (no Android imports)**. Platform specifics go behind kernel seams. Packages are `ai.amberx.axf.*`, Maven coordinates are `ai.amberx.axf:<module>:<version>`.
- **Interop:** the kernel never knows a protocol. Protocols are modules contributing a `ProtocolAdapter`. Exposure is default-deny, and a remote caller can never exceed the local UAC role. Wire error codes never change meaning (see INTEROP.md).
- **React/TS port:** the first React/TS app built on it sets the conventions, so it must stay engine-compatible for Android porting.
- `axf init` **bakes** `core/ react/ ui/ schemas/` into an app's `src/axf/` and records hashes in `axf.lock.json`. Change the framework, not baked copies.
- Feature status lives in `framework/catalog/status.json`. Build order and completion live in `framework/plan/build-queue.json`, which the MCP tools `build_next` and `build_step` drive. Update both, then run `tracker.mjs`, whenever something lands.
- Model policy: per step in the Build orchestrator (Fable for contracts/engines/migrations/cross-app GUI behaviour, Opus otherwise); approval only at a model switch.
- No secrets: `AXF_TOKEN` and `GITHUB_TOKEN` are environment variables only. `.mcp.json` references `${AXF_TOKEN}`.

## Related repos

- **`MossesX/axHub`**: standalone connector hub at `axhub.amberxai.com`. axHub's server core never depends on AXF; its UI may be built on AXF (axHub decision #93, Oct 23 2026), as static files the hub only hosts. AXF plugs in from its side via `lib-hub` (protocol defined by axHub: AXPP) and the `axhub-adapter-axf` plugin, which lives in **this** repo. axHub's step 3 proxies this console's `/mcp` as its first downstream service.
- **`MossesX/Build-Pilot`**: Build Pilot, the plugin-driven app designer (web first, Android later) built on AXF. Its plugins (`pilot-plugin@1`) serve one stack, several, or all (`*`); it builds through this repo's engine via the Dev Console. Android is the first stack.
- **`MossesX/studiox`**: AmberX AI Studio (Next.js), an earlier, separate `@axf/core` line. It does not consume this repo.
- **`MossesX/amberx`**: earlier PyQt6 desktop AmberX framework (dormant). This repo's planned `python` port (`x.python.port`) is separate from it.


---

## Working with Brett (same in every MossesX repo)

- **Where he works:** mostly from his Android phone (Samsung Galaxy S26 Ultra), often through **Moshi** (mosh) into his Hostinger VPS, where Claude Code runs. Keep replies phone-readable: lead with the result, short paragraphs, no walls of text.
- **Model choice (Oct 27 2026):** no per-build model question any more. The Build orchestrator (`_claude/builds/orchestrator.json`) pins each step to Fable or Opus; ask Brett (card) only at a model switch between phases. One session, no sub-agents. You can't switch models yourself: at a switch, hand him the next phase's brief (`orchestrator.mjs brief <id>`). Rule in `_claude/shared/rules/RULES.md`.
- **`_claude/` + the repo are the shared memory.** Sessions on the phone (Moshi), desktop, web and claude.ai don't share chat history, so anything a future session needs must live in `_claude/` (synced with the hub's `/projects`) or in this repo. Commit and push often with clear messages, and update `_claude/memory/STATUS.md` whenever something meaningful changes.
- **No secrets in the repo:** no tokens, passwords, keys or IPs with credentials. Use environment variables or GitHub Actions secrets.
- **GitHub:** account `MossesX`. A new repo must exist on GitHub before a session can push to it.
- **Server:** a Hostinger VPS running **Coolify**. Coolify's Traefik proxy owns ports 80/443, so new web apps go behind it as Coolify apps (no separate nginx). His domain is `amberxai.com`.
- **axHub:** his connector hub on the VPS (repo `MossesX/axHub`). If the axHub MCP server is configured in this Claude Code install, use its `list_services`, `describe_service` and `call` tools to reach his other services instead of asking him for credentials.

## Persona

@_claude/persona.md
