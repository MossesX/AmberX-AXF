# Remove the old Molly app from the project (keep axf-molly)

Build `remove-old-molly-app-project-keep-axf` (Opus). Brett, Nov 16 2026: "Molly's dead. Kill it. Make sure all the
references to Molly are removed from the project. We can keep the axf-molly name."

Built together with the pending build `remove-molly-completely-delete-the-molly-add-on-bundle-from-agent-manager-the`
(Nov 13 2026: delete the molly add-on, `_offer_molly`, the molly-guide plugin and anything that pops Molly up). It touches
the same files, so it is done here and closed with this build's branch.

## Being removed

Inventory: `git grep -i molly` across apps/, framework/, deploy/, _claude/, .github/, help and glossary, excluding
`axf-molly`, `.axf-molly/` and `AXF_MOLLY*` worker names. 415 files hit; most are history (see "Kept as history").
Mark: **remove**, **move to console** (function kept, Molly name dropped), **keep (axf-molly)**.

### The Molly app and its deploy

| Where | What | Mark |
|---|---|---|
| `apps/molly/` (1007 files) | the app: shell, FrameDeck, plugins (xlayout, banners, toolbar-designer, navigation, expenses), baked `src/axf`, assets, Dockerfile, `deploy/install.sh` + `nginx.conf`, manifests, `_claude/` | remove |
| `.github/workflows/android.yml` | `molly` scope output, the "molly — re-bake and build" job; comments on check-xlayout / check-banner-strip | remove (comments reworded) |
| `framework/cli/ci-scope.mjs`, `framework/spec/check-ci-scope.mjs` | `molly` CI scope key and `apps/molly/` rule | remove |
| `framework/schemas/shared-assets.json` (+ baked copies) | `apps/molly` in the shared-asset app list | remove |
| `framework/assets/settings/chrome-*-molly` | per-app chrome settings copies (if any) | remove |
| `_claude/rules/RULES.md` | project manifest list (eleven → ten), "Molly" in the tab-group rule | remove |
| `framework/core/deploy-log.mjs`, `framework/schemas/deploy-log.json`, `feature-ledger.json` | `molly` deploy target (molly.amberxai.com) | remove |
| `apps/axhub-web/deploy/nginx.conf`, `apps/amberx-droid/server/main.py` | `frame-ancestors https://molly.amberxai.com` | remove |
| `apps/expenses/src/server/cors.ts` + routes + test | default CORS origin `https://molly.amberxai.com` | remove (env `EXPENSES_CORS_ORIGINS` stays) |
| `apps/expenses/CLAUDE.md`, `deploy/install.sh` | "Molly frames it", "same shape as apps/molly" | remove |
| DNS `molly.amberxai.com` A → 31.97.13.252 | the app's subdomain | remove (s10) |
| `framework/assets/xlayout/molly.json` | the xLayout asset only Molly loaded | remove |
| `framework/core/engines/xlayout.ts`, `chrome.ts`, `embed.ts`, `runtime.ts`, `react/bannerStrip.ts`, `Chrome.tsx`, `navstyle*.ts/.mjs`, `EmbedTakes.kt`, `asset-types.json` | doc comments "Molly as one app", default host id `molly` | remove (engines stay: generic multi-app host, named `host`) |
| `framework/spec/check-*.mts`, `gen-fixtures.mts`, fixtures `xlayout.json`, `chrome.json`, `chrome-settings.json` | `molly` used as the sample host / app id | remove (sample renamed, fixtures regenerated) |
| `framework/cli/animations.mjs`, `skins.mjs`, `plugin-lifecycle.mjs` | `molly` app alias / doc mention | remove |
| `apps/console-web/plugins/console-commands` (server, web, tests), `framework/core/engines/console-commands.mjs`, `framework/spec/CONTROL.md` | "a console inside Molly" wording and `molly` test host | remove (generic host wording) |
| `apps/console-web/plugins/glossary-index/catalog.mjs`, `demonstration-designer/registry.mjs` | `molly` in the UI registry app list | remove |
| `framework/spec/PORTING.md`, `APPEARANCE-SOURCE.md` | Molly lines in deferred gaps | remove / reword |
| `apps/console-web/plugins/build-orchestrator/pipeline.mjs` | `apps/molly/node_modules` in the cleanup list | remove |

### The Molly agent and the Molly guide

| Where | What | Mark |
|---|---|---|
| `apps/console-web/plugins/agent-manager/addons/molly/` | the Molly agent add-on bundle | remove |
| `agent-manager/server/__init__.py` `_offer_molly()` + `mollyOffered` setting | auto-install on start | remove (one-time uninstall of an installed copy) |
| `agent-manager/test.py`, `agent-voice` tests, `ui-review/test.py`, `whats-shipped/test.py`, `push-banner/land/land.test.mjs`, `demonstration-designer/server_test.py` | `molly` as sample agent / data | remove (renamed samples) |
| `apps/console-web/plugins/molly-guide/` (already titled "Gizmo guide") | walkthrough window, `/ask`, `/walkthroughs`, AmberX walkthrough re-record, `molly.*` hidden function aliases, `molly-guide.*` setting keys | move to console: renamed `gizmo-guide`, aliases retired, settings and data migrated once |
| `apps/console-web/src/control/inventory.json` | `molly.*` functions, `molly-guide` sub-tab, settings, plugin row | remove (retired; regenerated) |
| `apps/amberx-droid/server/main.py` + `test_server.py`, `src/plugins/ai/web/client.ts`, `commands/web/*`, `test.mjs`, `walkthrough/*` | `/api/ai/molly` routes, `AMBERX_MOLLY_PLUGIN`, `molly` command step, `checkMolly` | remove (renamed `gizmo`; a saved custom command with the old step still loads) |
| `apps/amberx-droid/deploy/install.sh` | "Molly: connected to the console's token" | remove (Gizmo wording) |
| `framework/libs/claude-session/core.ts` (+ check) | `replaces: 'Molly'`, "Ask Molly" → "Ask Gizmo" rename helper | remove |
| `agent-manager/addons/gizmo/addon.json`, `agent-swarm/agents/*` | "replaced agent Molly", molly-guide pointers | remove |
| `apps/console-web/src/assets/help/console.json`, `glossary-index` (README, demos.mjs, plugin.json, terms.json), `maintenance/docs/README.md`, `demonstration-designer`, `framework/core/engines/demo-rules.mjs`, `help-rules.mjs`, job-type assets | "Molly's guide", "Molly and friends" | remove (reworded to Gizmo guide / walkthrough guide) |
| `framework/spec/token-manifest-baseline.json` | `molly-guide` plugin id | remove (renamed) |
| `apps/console-web/plugins/build-breaker/data/asks.jsonl` | generated asks list with `plg-molly` | remove (row dropped) |
| `framework/catalog/catalog.json`, `status.json`, `tracker.json` | Molly features | remove (s14) |
| `_claude/memory/STATUS.md`, `docs/voice-command-center.md`, `CLAUDE.md`, `_claude/shared/rules/RULES.md`, `_claude/shared/memory/*` | current-state Molly lines | remove (s12) |

### Keep (axf-molly)

| Where | Why |
|---|---|
| `framework/core/gate-rules.mjs` (`OWNERS`, `STATE_SOURCES`), `framework/schemas/gate-rules.json`, `json/gate-rule*.schema.json`, `json/lander-state.schema.json`, `framework/spec/fixtures/gate-rules.json`, `check-gate-rules.mjs`, `GATE.md`, `PORTING.md` gate row | the `axf-molly` container owner name |
| `apps/console-web/plugins/gate/` (README, gate-store.mjs, lander.mjs, help.json, plugin.json, web/RulesTab.tsx), `framework/catalog/catalog.json` gate note | same |
| builds `axf-molly-container-orchestrator-gate` (store, THREADS) | the axf-molly container build |

Guard list (must not change in this build): `framework/core/gate-rules.mjs`, `framework/schemas/gate-rules.json`,
`framework/schemas/json/gate-rule.schema.json`, `framework/schemas/json/gate-rule-set.schema.json`,
`framework/schemas/json/lander-state.schema.json`, `framework/spec/fixtures/gate-rules.json`,
`framework/spec/check-gate-rules.mjs`, `framework/spec/GATE.md`, `apps/console-web/plugins/gate/**`, `.axf-molly/`
(not in the repo), and the `axf-molly` container definitions on the VPS.

### Kept as history (not edited)

`changes/**`, `sessions/archive/**`, `_claude/builds/journal/**`, `_claude/builds/shipped/**`, `_claude/THREADS.md`
rows, old build reports (`_claude/builds/reports/molly-*.md`), dated handoffs and session notes
(`_claude/memory/handoff-*`, `_claude/sessions/*`, `_claude/shared/notes/**`), and the build records in
`_claude/builds/store.json` / `orchestrator.json` / `origins.json` / `framework/plan/pending.json` (exports, changed only
through orchestrator.mjs / plans.mjs).

## Still useful (s2): what moves, and where

Nothing outside `apps/molly/` imports its code; its assets (`src/assets/{app-menu,nav-menu,toolbar,xlayout}/molly.json`,
`settings/chrome-*-molly.json`) are Molly's own and no other app reads them. The framework engines Molly drove (xlayout@1,
chrome@1, embed@1 host messages, banner strip, nav-style@1) are generic and stay in `framework/` with a neutral host id.

The console's "Molly guide" is already the **Gizmo guide** in the UI and is live: AmberX's developer commands
(`/api/ai/molly` → the guide's `/ask`) and the AmberX walkthrough re-record go through it. Deleting it would break both,
so its function moves to a plugin without the Molly name:

| Item | From | To |
|---|---|---|
| Walkthrough window (walkthrough@1 player: Next / Previous / Repeat / Close, spoken steps, highlight) | `plugins/molly-guide/web` | `plugins/gizmo-guide/web` |
| Ask route, walkthrough list, AmberX walkthrough re-record (`/ask`, `/walkthroughs`, `/amberx-walkthrough/rerecord`) | `/api/plugins/molly-guide/*` | `/api/plugins/gizmo-guide/*` |
| Settings `molly-guide.speak` / `.runSteps` / `.autoOpen` | sub-tab `molly-guide` | `gizmo-guide.*`, sub-tab `gizmo-guide` (saved values copied once) |
| Data `walkthroughs.json` | `.axf-console/plugins/molly-guide/` | `.axf-console/plugins/gizmo-guide/` (moved once on start) |
| Actions `gizmo.ask` / `.replay` / `.next` / `.prev` / `.close` | registered by the guide | unchanged; hidden aliases `molly.*` retired |
| Help entries (help.json) | scope `plugin:molly-guide` | help topic `plugin:gizmo-guide` (console help, Help mode) |
| Agent-manager README lines on Molly | `agent-manager/README.md` | dropped; Gizmo is the add-on that does this |
| Molly add-on persona / skills (codebase, walkthroughs, builds, VPS, DNS) | `addons/molly/addon.json` | nothing to move: Gizmo's add-on carries the same skills and tools |
| Molly app's per-app chrome settings, nav / app menu / toolbar assets | `apps/molly/src/assets` | nothing to move: Molly-only |

## Moved (s3)

The guide now lives in `apps/console-web/plugins/gizmo-guide` (plugin `ai.amberx.axf.console.gizmo-guide`, "Gizmo guide").
Its help topic is `plugin:gizmo-guide` (`help.json`, Help mode), with a screen entry for the window itself.

- Deep link: the window registers `panel:gizmo-guide` (`data-axf-target` on both window states); the settings sub-tab is
  `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=gizmo-guide` (`settings.open:gizmo-guide`); the
  window opens with `function:gizmo.ask`.
- Saved data is not migrated: the old folder held only the last 20 walkthroughs, and the three switches default to the
  same safe values (speak on, move on, auto-open off). The old data folder `.axf-console/plugins/molly-guide` in the
  console container is unused from now on.

## API surfaces (s5–s6)

Removed together on every surface:

| Was | Now |
|---|---|
| Agent `molly` (agent-manager add-on; REST `/api/plugins/agent-manager/addons/molly/*`, MCP plugin commands, agent lists, voice) | gone; an installed copy is uninstalled once on start (`RETIRED_ADDONS`, open list) with its Safety entry and offered flag |
| Console functions `molly.ask` / `.replay` / `.next` / `.prev` (hidden aliases; console_show, Ctrl+K, `axf console`, voice) | retired; `gizmo.*` unchanged |
| REST `/api/plugins/molly-guide/*` (plugin-commands auto: MCP) | `/api/plugins/gizmo-guide/*` |
| AmberX REST `GET /api/ai/molly/status`, `POST /api/ai/molly`, env `AMBERX_MOLLY_PLUGIN` | `/api/ai/gizmo/status`, `/api/ai/gizmo`, env `AMBERX_GUIDE_PLUGIN` (default `gizmo-guide`) |
| AmberX command step `molly` (command builder "Task for Gizmo", developer chains and wizards), voice phrase "hey molly …" | step `gizmo`; phrase dropped ("hey gizmo …" stays) |

The axf CLI had no Molly subcommand. Tests updated: agent-manager (178), agent-voice (41 + 22), gizmo-guide (20),
AmberX server (172), AmberX web (2335).

## Ratchets (s9)

`chrome-baseline.json` (re-written: 18 files, 25 findings, unchanged), `conform-baseline.json` (286, unchanged) and the
help coverage never counted a Molly file (apps/molly was outside their scans), so no count moved. Help coverage stays
at 100% for console-web, axHub web and the framework; the new gizmo-guide help entry is within the 600-character rule.
Glossary coverage is rebuilt in s13.
