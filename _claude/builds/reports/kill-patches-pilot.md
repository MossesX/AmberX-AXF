# kill-patches-pilot — Patches and Build Pilot retired (Nov 3 2026)

Brett (voice, Nov 3 2026): "Patches is dead. Delete it, all references. Build Pilot dead, same thing. Delete it. All
references." Urgent profile build `kill-patches-pilot`, Opus, branch `claude/kill-patches-pilot`.

## PRs

- AmberX-AXF: https://github.com/MossesX/AmberX-AXF/pull/258
- axHub: https://github.com/MossesX/axHub/pull/32

## Removed from AmberX-AXF

- **Apps:** `apps/patches` (Android), `apps/patches-web` (web + server), with their manifests (10 project manifests
  remain: root + 9 apps).
- **Console (`apps/console-web`):** the Patches banner strip (`src/bannerStrip.tsx`, its CSS and App wiring); the
  Build Pilot entries in the app menu, the `console.open:pilot` target and their help drafts; app-ci@1, which only
  served Pilot's Build APK (`server/app_ci.py`, `server/test_app_ci.py`, `/api/apps/apk*`, `.github/workflows/pilot-apk.yml`;
  `app_catalog.py` keeps its own size cap); the "List Build Pilot plugins too" switch is now "List other apps'
  plugins too" (axhub / amberx kinds).
- **Plugin catalog:** the `pilot` kind (`pilot-plugin@1`) in `framework/cli/plugin-catalog.mjs` and the Python port
  `axf_server.plugin_package`; fixture `spec/fixtures/plugin-package.json` regenerated; tests use the `axhub` kind.
- **Plugins:** Build-Pilot out of the push banner's and activity feed's default repos; Patches/Pilot tokens out of
  Vinny's App tokens command; handoff kit repo lists; Molly's description; build-manager no longer treats `pilot/…`
  branches as builds; Patches wording in voice-notes, todo-manager, alerts-bell, claude-badge, activity, ai-keys,
  plugin-manager, feature-matrix, plugins README.
- **Framework:** Patches/Pilot wording out of core, react, ui, libs, schemas, assets, cli, deploy, python, Kotlin
  comments; embed@1 stays as a generic host contract (no host today). Fixtures regenerated with neutral samples:
  `embed.json`, `embed-takes.json` (host `host`), `appearance.json` (`axhub-web`), `hub-approvals.json` (`notes` app),
  `github.json`, `wall-signature.json`. Baked `src/axf` copies in every app updated with their `axf.lock.json` hashes.
- **Checks + tooling:** check-theme/check-controls/check-conform no longer special-case Patches; Patches entries out of
  `conform-baseline.json`, watch-live targets, check-scale / check-design-package / check-watch-live app lists,
  rebuild-shots and the headless brief.
- **CI:** `pilot-apk.yml` deleted; `android.yml` no longer uploads `patches-debug.apk` or runs `test_app_ci.py`.
- **Catalog / plan / trackers:** feature `c.patches` out of catalog, status, plan (repo and hub copies); main and
  refactor trackers regenerated.
- **Walkthroughs:** AmberX narration (`walkthrough/stack.mjs`) and Walkthrough Studio seed chapters rewritten.
- **AXHub Android:** no longer checks for the Patches package (only AmberX keeps it quiet).
- **axHub web:** CSP `frame-ancestors` drops `patches.amberxai.com`; plugin install notes and Hub view text.
- **Docs:** `_claude/memory/docs/patches-banners*`, `rebuilds/patches-wrapper*`, `rebuilds/patches-web-settings-notify*`,
  the Patches Android screenshot folders under other rebuilds; Patches/Pilot lines in current docs.
- **Rules:** project RULES.md (manifests count, Android hold, embed rules, "Apps render whole in Patches" and "Patches
  paused" replaced by one "Patches and Build Pilot are retired" rule), shared RULES.md, CLAUDE.md (Related repos, new
  convention line). Applied to both the repo and the hub copies.
- **Memory:** decisions.md (new "Retired apps" entry; 11 older entries marked *[superseded Nov 3 2026]*), STATUS.md (new
  entry; 12 Patches/Pilot entries marked *[retired]*), THREADS.md (one row).
- **Builds store:** archived with note "Retired Nov 3 2026": build-pilot-contract, build-pilot-agents,
  console-android-native-tabs, patches-wrapper, patches-plugins, patches-plugins-fable, patches-settings-banner-hide,
  patches-settings-banner-hide-fable, patches-app-plugins-grid, patches-app-plugins-pilot-axhub,
  patches-banners-console-only. Notes added on the already-archived Patches/Pilot builds, tools-plugin,
  console-android-app-tabs, asset-templates, settings-asset-fable; axhub-agent-host s12 (Pilot backend) skipped. None
  shows on the Pending list.

Left as history on purpose: the builds journal and store history, changes/ and sessions/ logs, build-breaker's asks
log, dated reports in `_claude/builds/reports/` and `_claude/memory/docs/rebuilds|harvest/`, the generated handoff kit
(`_claude/handoff/`), session notes, and plan exports (`framework/plan/**/pending.json`, `build-queue.json`).

## Removed from the VPS

| What | Before | Now |
|---|---|---|
| Container `patches-web` (`patches-web:latest`, `patches.amberxai.com`) | running | stopped, removed, image removed |
| Container `build-pilot` (`build-pilot:latest`, `pilot.amberxai.com`) | running 11 days | stopped, removed, image removed |
| Traefik routes | container labels | gone with the containers (both domains answer 503) |
| Cron | `/etc/cron.d/patches-web`, `build-pilot`, `build-pilot-token` | removed |
| Scripts | `/usr/local/bin/patches-web-update`, `build-pilot-update`, `build-pilot-token` | removed |
| Folders | `/opt/patches-web`, `/opt/build-pilot` | removed |
| Coolify | no application or service for either (checked in Coolify's DB) | nothing to remove |

**Archive:** `/root/archive/retired-2026-11-03/` (root only, 0600): `patches-web-opt.tar.gz` and
`build-pilot-opt.tar.gz` (whole `/opt` folders: data, env, repo), `*-image.tar.gz` (`docker save`, restore with
`docker load`), `*.container.json` + `*.image.json` (full run config and labels), `cron-and-scripts.tar.gz`,
`hub-projects-patches.tar.gz` (`/projects/patches` + `/projects/patches-web`), `hub-data-before/` (plan, status,
libraries before the hub edits). The Dev Console kept running throughout.

## Still open (need Brett or a veto call)

1. **Archive MossesX/Build-Pilot** — not done: the token on the VPS can't change repo settings (403) and the GitHub
   App isn't set up. One tap: github.com/MossesX/Build-Pilot → Settings → Danger Zone → **Archive this repository**.
   Archive, not delete: deleting is irreversible; he can delete it in one click later.
2. **axHub projects `/projects/patches` and `/projects/patches-web`** — snapshotted, not deleted: this headless session
   has no axHub MCP access, and hub deletes must go through axHub as a veto call (`axhub.memory_*`) so versions stay
   recoverable. `shared/memory/projects.md` never listed them. No build-pilot project existed.
3. **DNS** `patches` and `pilot` A records on amberxai.com — still there (Hostinger connector not authorized here).
4. **Live axHub env** `AXHUB_EMBED_FRAME_ANCESTORS` still names `https://patches.amberxai.com` — harmless (nothing
   serves it); drop it on the next hub redeploy.

## Checks

check-theme ✓, check-controls ✓, check-conform ✓, plugins.mjs --check ✓, validate --framework ✓ (479 assets),
project validate --all ✓, shared-assets ✓, help coverage 100%, check-embed 422 ✓, check-appearance 107 ✓, check-hub 341 ✓,
check-github 143 ✓, check-axf-server 90 ✓, axf_server self-test 397 ✓, check-plugin-catalog 55 ✓, check-web-client 616 ✓,
check-watch-live 67 ✓, check-design-package 1158 ✓, check-scale 485 ✓, builds-store verify ✓, check-build-steps 44 ✓,
console server tests ✓ (plugin_catalog 39, app_catalog 15, alerts, previews, build_profiles), every touched plugin's
test + lifecycle check ✓, AmberX test 2184 ✓, axHub web test 232 ✓; `tsc --noEmit` + `vite build` pass for console-web,
axhub-web, amberx-droid, walkthrough-studio and demo (node:22). axHub repo: embed + web tests 41 ✓.
Failing before and after this change (not caused by it): `test_wall_users.py`, context-menu-designer's `test.mts` (Node
20 on the host), build-orchestrator `test.mjs` (another build's `agent-cap` steps are over 30 min).
Kotlin (EmbedConformanceTest, AppearanceConformanceTest, ApprovalWatch) compiles in CI only.
