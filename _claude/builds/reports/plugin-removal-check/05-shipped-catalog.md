# Plugin removal check 05: shipped-features, whats-shipped, glossary-index, ref-links

Build `emergency-check-can-these-plugins-`, step s5. Report only: nothing was deleted or changed.
Checked on main at `e1e8d3231` (Nov 27 2026).

## Verdicts

| Plugin | Verdict | What depends on it (outside its folder) | What to move or do first |
| --- | --- | --- | --- |
| `shipped-features` | **MOVE FIRST** | 1. Plan Studio 2 opens a "Shipped feature" link through this plugin's action: `apps/console-web/plugins/plan-studio-2/web/api.ts:152` (`shipped-features.show:<ref>`), link type declared at `plan-studio-2/web/tree-core.mjs:9`. 2. Host service `shipped-features` runs this plugin's code on the VPS: `deploy/host-services/bin/axf-task:20` (`node apps/console-web/plugins/shipped-features/ledger/ledger.mjs sync`), `deploy/host-services/services/shipped-features.json:8-9`, `deploy/host-services/workers/shipped-features.mjs:28`, `deploy/host-services/sudoers.d/axf-host:28,37,48,61,79-81`, `deploy/install-host-services.sh:64`, tier list `framework/core/host-services.mjs:69` (+ `framework/schemas/host-service.json:113`, `host-service-mode.json:173`), `apps/console-web/plugins/host-services/plugin.json:272`. 3. Postgres mirror of its SQLite ledger (`ledger_*`, 12 tables): `services/axf-data/tables.py:921`, `framework/cli/data.mjs:25`, `apps/console-web/plugins/data-store/server/routes.py:141`, `data-store/plugin.json:142`. 4. Banner seed list: `apps/console-web/src/lazyEngine.ts:57` (checked by `apps/console-web/scripts/lazy-loader-check.mts:86`). 5. Build rule `shipped-features`: `_claude/builds/build-rules/seed.json:1036` (text names the plugin folder). 6. CI: `.github/workflows/android.yml:207-208` (marked). | Plan Studio 2: drop the `shipped` link type or point it at whatever replaces the ledger view. Host service: retire the `shipped-features` service (manifest, worker, `shipped-sync` task, sudoers lines, tier entries, the host-services list) in the same build; its other half, `shipped-landed`, is `framework/cli/shipped.mjs landed`, which the orchestrator tick already runs (`build-orchestrator/pipeline.mjs:114,2014`), so nothing is lost. Data: decide whether `ledger_*` in Postgres is kept as history or dropped, then remove the `ledger` mirror entries. Remove the name from `KNOWN_BANNERS`. Reword the build rule so it speaks of the shipped manifest only (the rule itself keeps working, see evidence). |
| `whats-shipped` | **SAFE** | Only the banner seed list `apps/console-web/src/lazyEngine.ts:57` and the same check (`lazy-loader-check.mts:86`; lines 37-43 use the name as a sample id). No import, route call, capability consumer, build hook or host service. | Remove the name from `KNOWN_BANNERS` in the removal build. Nothing to move. |
| `glossary-index` | **SAFE** (rule decision needed) | No code outside the folder imports it, calls its routes or uses `service:glossary@1`. What names it: build rule `glossary-catalog` (`_claude/builds/build-rules/seed.json:3723`, `_claude/rules/RULES.md:52`, fixer id in `framework/core/build-rules.mjs:40`, `framework/schemas/build-rules.json:42`, `framework/cli/build-rules-migrate.mjs:98`); CI `.github/workflows/android.yml:233-234` (`test.mts` + `catalog.mjs --check`, ratchet `coverage.json` inside the folder); `apps/console-web/plugins/gate/plugin.json:48` (gate lists a doc line in this plugin's `terms.json`); starter book entry `framework/assets/book/getting-started.json:18` (`plugin:glossary-index`). | Nothing to move. Retire the `glossary-catalog` rule in the same build (seed, the live rules store on the VPS, RULES.md line): it is Brett's Nov 7 standing rule and is injected into briefs, so removal reverses it and needs his say-so. Drop the `terms.json` mention from gate's manifest and the `plugin:glossary-index` item from the starter book. |
| `ref-links` | **SAFE** | Nothing. The link engine and control are framework (`framework/core/engines/refs.mjs`, `framework/react/components/RefText.tsx`), and the on/off setting `axf.refs.links` is owned by the framework (`RefText.tsx:61`). CI only: `.github/workflows/android.yml:231-232,441` (marked). | Nothing to move. |

## Evidence

### shipped-features

- Manifest: view `shipped-features`, settings tab, `buildHooks: ledger/hook.mjs` (build-hook@1 listener), dataDir `.axf-console/plugins/shipped-features`, env `AXF_SHIPPED_FEATURES_DIR`, 15 commands (ledger, summary, feature, sync, import, export, search, manifests, manifest, manifest-put, ship, link, backfill).
- The build-hook listener is found through the manifest; no framework code names it. Removing the plugin just removes the listener.
- **The "Shipped features manifest" rule does not need the plugin.** Rule `shipped-features` checks `fixer:shipped-features`; that fixer is `apps/console-web/plugins/gate/fixers/shipped-features.mjs` and only runs `framework/cli/shipped.mjs` and reads `framework/cli/shipped-files.mjs` (sidecars in `_claude/builds/shipped/<build>.json`). The builds store also reads the manifest ref itself (`framework/plan/builds-store-core.mjs:54,287`, `framework/plan/builds-merge-core.mjs:240`). All of that stays. Only the rule text still says the ledger lives in this plugin.
- Contracts `feature-ledger@1`, `deploy-log@1`, `shipped-manifest@1` are framework files (`framework/core/*.mjs`, schemas, `framework/spec/check-feature-ledger.mjs`, CI `android.yml:186`). They stay and still pass without the plugin; `feature-ledger@1` would then have no reader.
- What is lost with the plugin and has no other home: the ledger itself (features, edits, live dates), and the REST / MCP manifest tools (`search`, `manifests`, `manifest`, `ship`, `backfill`). The CLI `framework/cli/shipped.mjs show|list|ship|backfill` covers manifests.
- Live data on the VPS: `/opt/axf/.axf-console/plugins/shipped-features` is 202 MB (`ledger.sqlite`), mirrored to Postgres as `ledger_*` (`framework/spec/DATA-INVENTORY.md:145`, `framework/spec/DATA-STORE.md:368`).
- `axf-task shipped-sync` execs a file inside the plugin, so deleting the folder without retiring the host service leaves a systemd unit that fails every 120 s and a systems-check alarm.
- Tests and fixtures that use the name as sample data only (no change needed): `services/axf-data/test_pg.py`, `test_store.py`, `framework/spec/check-data-store*.mjs`, `check-builds-store-data.mjs:239-251`, `data-store/test.py:50,55`, `framework/spec/fixtures/*`, `apps/console-web/scripts/host-services-shots.mjs:39`.

### whats-shipped

- Manifest: banner widget (`banner:right`), dialog `whats-shipped.panel`, settings tab, dataDir `.axf-console/plugins/whats-shipped` (500 kB feed cache on the VPS), env `AXF_WHATS_SHIPPED_DIR`, auto commands only, no build hook.
- It declares `asset:status/shipped`, but the asset file is the framework's (`framework/assets/status/shipped.json`); it stays.
- Its server reads GitHub, git and the builds store directly; no other plugin calls it and it calls no other plugin.
- Planned tables `shipped_feed`, `shipped_pr_files` exist only as a plan line (`framework/spec/DATA-INVENTORY.md:151`); nothing was created.

### glossary-index

- Manifest: views `glossary-index`, `demo-designer`, `book-builder`, two dialogs, player tab, settings tab, `service:glossary@1`, `buildHooks: build-hooks.mjs` (rebuilds the catalog on every build event), dataDir `.axf-console/plugins/glossary-index` (2.6 MB: `catalog.json`, `changes.json`), env `AXF_GLOSSARY_DIR`, 19 commands.
- No consumer of `service:glossary@1`, the routes or the MCP tools `glossary_index_*` anywhere outside the folder.
- The `glossary-catalog` rule has no working fixer: its check `store:glossary-catalog` is not in `gate/build-rules-runner.mjs:41` and there is no `gate/fixers/glossary-catalog.mjs`. The rule is text in briefs plus the plugin's own build hook and CI check, so retiring it breaks nothing.
- The asset types `demonstration@1`, `book@1`, `clip@1`, `docs@1` and their rules (`framework/core/engines/demo-rules.mjs`, `framework/spec/check-demo.mts`) are framework and stay. This plugin is the only place that edits books and generates docs; the Demonstration Designer plugin (also on the removal list) covers demonstrations only. Removing both leaves those four asset types with no editor.
- Planned tables `glossary_terms`, `glossary_changes` are a plan line only (`framework/spec/DATA-INVENTORY.md:150`).

### ref-links

- Manifest: settings tab, `service:ref-links@1`, optional services only, dataDir declared but never created on the VPS, commands `targets`, `find`, `resolve`, `open` (MCP `ref_links_*`).
- All it adds to the framework control is a server-fed target list (`addRefSource('ref-links.server', …)` in its own `web/index.tsx`). Without it `RefText` still links what the running console registers; builds, PRs and UI Review targets from the server list go back to plain text.
- The only screens that draw `RefText` are `main-build-status` and `codebase-changes`, both on the removal list. No consumer of `service:ref-links@1`.

### Notes for the removal build

- `node framework/cli/plugin-lifecycle.mjs status <folder>` reports zero stale references for all four. It does not see the items above for `shipped-features` (host service, Plan Studio 2 action string, data-store mirror, banner seed) or the build rules store, so its clean result is not enough on its own.
- Lines marked `axf-plugin:<folder>` (CI steps, STATUS.md, THREADS.md, RULES.md, PORTING.md, plugins README) are removed by `uninstall.mjs --all`.
- `apps/*/src/axf/**` and `apps/phone-connect/app/src/main/assets/axf/**` are synced copies of framework files; they follow the framework after a sync and need no hand edits.
- No reference in axHub web, Molly, Walkthrough Studio, the Android apps or `services/` other than the `ledger` mirror in `services/axf-data`.
