# Plugin removal check 04: builds-page, main-build-status, merge-queue-view, fable-rebuilds

Report only. Nothing was deleted or changed. Checked at `e1e8d3231` (main, Nov 26 2026).

Method: read each `plugin.json`, `hooks.mjs`, `web/index.tsx`, `web/menu.ts`, `server/__init__.py` and CLI, then
searched the whole repo outside the plugin's own folder for its folder name, plugin id, view and action ids, capability
names, route prefix, setting keys, counters, data paths and env vars. History folders (`changes/`, `sessions/`,
`_claude/builds/shipped/`, `_claude/handoff/`, `_claude/memory/`, `_claude/THREADS.md`) only record the past and are
left out of the dependency lists. The mirrored framework copies under `apps/*/src/axf/` follow `framework/` and are
listed once.

## Verdicts

| Plugin | Verdict | What depends on it | What to move, and where |
| --- | --- | --- | --- |
| `builds-page` | **MOVE FIRST** | Home cards read its `progress` command by folder name: `framework/core/engines/card-rules.mjs:418` (Builds running, first candidate) and `:422` (Build progress, only candidate), drawn by `apps/console-web/src/views/HomeCards.tsx`. CI names it: `apps/console-web/src/lazyEngine.ts:55` (`KNOWN_BANNERS`; `apps/console-web/scripts/lazy-loader-check.mts:86` fails on a missing plugin). Help points at its view and action: `apps/console-web/src/assets/help/console.json:44,53,119,136,222,422,427,1159`. `apps/console-web/plugins/ref-links/refs.mjs:49` focuses `builds.open`. | Move the `progress` read (profile percent + the list of active builds; today `GET /progress` → `builds.mjs progress`, 4 lines over `framework/plan/builds-store-core.mjs`) into `build-orchestrator` as a `progress` command, then point both card candidates at it. That is a reference-engine change: regenerate `framework/spec/fixtures/card.json` and the app mirrors. Same PR: drop the `KNOWN_BANNERS` entry, the help entries, the voice inventory rows, and retarget `refs.mjs:49` if ref-links stays. |
| `main-build-status` | **SAFE** | Nothing kept reads it. One CI list names it: `apps/console-web/src/lazyEngine.ts:57` (`KNOWN_BANNERS`, same check as above). | Nothing to move. Delete the `KNOWN_BANNERS` entry in the removal PR or CI goes red. |
| `merge-queue-view` | **MOVE FIRST** | The Build orchestrator (kept) opens this plugin's view: `apps/console-web/plugins/build-orchestrator/web/index.tsx:94` (deep link `build-orchestrator/merge-queue`) and `:116` (action `build-orchestrator.merge-queue`) both call `rt.navigate('merge-queue')`. The orchestrator's queue table (slot `builds.merge-queue`, `index.tsx:240`) is drawn only inside this view. Screenshot scripts open it: `apps/console-web/scripts/status-table-shots.mjs:68`, `apps/console-web/scripts/auto-lander-shots.mjs:72,99,105`. CI runs its test: `.github/workflows/android.yml:217-218`. | Move the `merge-queue` view (view + Builds nav item + Builds app-menu item, about 15 lines) into `build-orchestrator`, rendering `<StatusTable mode="queue" />` directly instead of through the slot. The fallback grid, `queue.mjs`, `GET /queue` and `test.mjs` can go with the plugin: the rows come from `deploy/lander/lander-core.mjs:567` (`queueRows`), which stays and has its own tests. |
| `fable-rebuilds` | **SAFE** | Nothing kept reads it. It only adds itself to other screens (Plan features, Pending rows, Plugin Manager rows, the default context menu). One help entry points at it: `apps/console-web/src/assets/help/console.json:300`. | Nothing to move. Delete the help entry in the removal PR. |

## Evidence

### builds-page (`ai.amberx.axf.console.builds-page`)

What it is: view `builds` (Builds and Steps views), settings tab `builds-page`, a banner counter (`builds-progress`,
counter `builds.pct`, polled every 15 s), actions `builds.open` and `builds.view`, toolbars `builds` and `builds-steps`,
routes `/api/plugins/builds-page/{state,progress,ops,draft,apply,discard,propose,divide,rename-profile}`, CLI
`builds.mjs`. No `notify.json`, no MCP tools ("Never exposed on the console MCP", `server/__init__.py:7`).

Data: none of its own. `dataDir` `.axf-console/plugins/builds-page` holds nothing the code reads. It reads and writes the
one builds store through `framework/cli/builds-store.mjs` and `framework/plan/builds-store-core.mjs`, which stay
(`hooks.mjs`: "the builds store stays where it is"). No Postgres table of its own; nothing in `services/axf-data` or
`deploy/` names it.

Dependencies found:

- **Home cards (the reason for MOVE FIRST).** `framework/core/engines/card-rules.mjs:416-423` (`CARD_SUGGESTIONS`):
  "Builds running" tries `builds-page/progress` first and falls back to `build-orchestrator/state`; "Build progress"
  has only the `builds-page/progress` candidate, so the suggestion disappears and any Home card already saved with that
  source stops loading. Saved cards live in console data, not in the repo, so their count could not be checked here.
- **CI: banner list.** `apps/console-web/src/lazyEngine.ts:55`; `lazy-loader-check.mts:86` asserts every name in
  `KNOWN_BANNERS` is an existing plugin. Not a marked line, so `uninstall.mjs --all` will not remove it.
- **Help.** `apps/console-web/src/assets/help/console.json` lines 44, 53, 119, 136, 222 (`view:builds`) and 422, 427,
  1159 (`action:builds.view`, `action:builds.view:steps`); source `_claude/builds/help-src/console.py:17,18,29,31,40,79,197`.
  The help ratchet (`framework/cli/help-coverage.mjs --check`, `.github/workflows/android.yml:187`) counts controls per
  scope; run it after removal.
- **Voice inventory.** `framework/spec/fixtures/page-toolbar-voice.json:164` and the `builds.steps` rows above it are
  generated from the plugin's toolbar assets: regenerate with `npx -y tsx framework/spec/check-page-toolbar-voice.mts --write`.
- **ref-links** (`apps/console-web/plugins/ref-links/refs.mjs:49`): every build reference focuses action `builds.open`.
  ref-links is on the removal list too; if it stays, point it at `build-orchestrator.open`.
- **Test data only, no change needed:** `framework/spec/toolbar-actions-cases.ts:36,68,76,77,111` (marked
  `axf-not-plugin:builds-page`), `framework/spec/check-toolbar-actions.mts:102`, `framework/spec/check-card.mjs:31,49,66,80,116`,
  `framework/spec/fixtures/toolbar-actions.json`, `framework/spec/fixtures/card.json:311-353`,
  `apps/console-web/plugins/demonstration-designer/test.mjs:88-91`, `apps/console-web/plugins/follow-amber/test.py:46,142,203,227`,
  `apps/console-web/plugins/phone-connect/test_server.py:417`, `apps/console-web/scripts/place-state-check.mts`
  (the string `view:builds` as a sample address).
- **Doc lines:** `_claude/builds/README.md:40` (marked, the uninstaller removes it), `framework/spec/BUILDS.md:6`,
  `framework/spec/fixtures/data-store-migration.json:47,111`, `framework/spec/token-manifest-baseline.json:6` (drop the entry).

What Brett loses that nothing else draws: the Steps view (draft until Apply, divide, harvest, split into N, Restore
default), renaming a build profile from the screen, and the banner percentage. The rules behind them stay in
`framework/plan/builds-store-core.mjs`; apply and discard stay on the CLI (`framework/cli/builds-store.mjs:1302`). The
Build orchestrator has no divide or harvest control (no match in its `web/` folder). That is a product choice, not a
code dependency, so it does not change the verdict.

### main-build-status (`ai.amberx.axf.console.main-build-status`)

What it is: a banner status widget (asset `status/main-build`, counters `build.main.known`, `build.main.running`,
`build.main.failing`), dialog `main-build-status.run`, actions `main-build-status.open`, `.github`, `.check`, settings
tab `main-build-status` (key `main-build-status.show`), routes `/api/plugins/main-build-status/{status,config}`. No
view, no `notify.json`, no MCP tools.

Data: `.axf-console/plugins/main-build-status/config.json` (the watched repos) only; env `AXF_MAIN_BUILD_STATUS_DIR`
is read only by its own server. No Postgres table. It uses the framework's `status` widget type and
`axf_server.github`, both of which stay.

Dependencies found:

- **CI: banner list.** `apps/console-web/src/lazyEngine.ts:57`, same check as builds-page. The only line that breaks.
- `apps/console-web/plugins/build-breaker/web/buildMenu.ts:29` lists action `main-build-status.open`; the menu filters
  to actions that exist (`buildMenu.ts:33-36`), so the entry drops out by itself. build-breaker is on the removal list.
- No code outside the plugin reads the `build.main.*` counters, the `status/main-build` asset or the routes.
- Doc lines: `apps/console-web/plugins/README.md:33`, `framework/spec/DESIGN-LANGUAGE.md:148`,
  `apps/console-web/plugins/github-app/README.md:22`, `framework/spec/token-manifest-baseline.json:9` (drop the entry).

What Brett loses: the CI dot for main on the banner. Nothing else shows the last main run.

### merge-queue-view (`ai.amberx.axf.console.merge-queue`)

What it is: view `merge-queue` (read-only), settings tab `merge-queue`, route `GET /api/plugins/merge-queue-view/queue`,
CLI `queue.mjs`, control target `panel:merge-queue`, capability `service:axf.merge-queue@2`. No state, no actions, no
`notify.json`, no MCP tools of its own.

Data: none. `queue.mjs:13-14` reads the builds store (`framework/cli/builds-store.mjs`) and shapes rows with
`queueRows` from `deploy/lander/lander-core.mjs:567`. Both stay; the lander uses `queueRows` itself
(`deploy/lander/run.mjs:857,915`) and tests it (`deploy/lander/test/lander-core.test.mjs:52,169,186,206`).

Dependencies found:

- **Build orchestrator (the reason for MOVE FIRST).** `build-orchestrator/web/index.tsx:94` and `:116` navigate to
  view `merge-queue`, which only this plugin registers; with the plugin gone both go nowhere. The orchestrator fills
  slot `builds.merge-queue` (`index.tsx:240`) and only this plugin's view renders that slot (`merge-queue-view/web/index.tsx:115,123`),
  so the orchestrator's queue table would have no screen. `build-orchestrator/plugin.json:25` lists
  `service:axf.merge-queue@2` as optional, so the orchestrator still loads.
- **Screenshot scripts.** `apps/console-web/scripts/status-table-shots.mjs:68` opens `view:merge-queue`;
  `apps/console-web/scripts/auto-lander-shots.mjs:72,99` fake the `/queue` route (marked lines) and `:105` opens the
  view. They keep working once the orchestrator owns the view; the two marked route lines go with the plugin.
- **CI.** `.github/workflows/android.yml:217-218` runs `merge-queue-view/test.mjs` (marked `axf-plugin:merge-queue-view`,
  the uninstaller removes both lines).
- `apps/console-web/plugins/build-breaker/web/buildMenu.ts:28` (`nav:merge-queue`, drops out by itself),
  `apps/console-web/plugins/glossary-index/terms.json:26` (`related: plugin:merge-queue-view`; change to the
  orchestrator), `apps/console-web/plugins/README.md:38`, `framework/catalog/status.json:2452` (a note).
- Not this plugin: `service:axf.merge-queue@1` (`gate/plugin.json:25`, `gate/gate-store.mjs:38`,
  `build-orchestrator/pipeline.mjs:1311`, `build-orchestrator/server/__init__.py:124-125,1040`,
  `build-orchestrator/watchdog/tables/merge-queue.mjs:12`) is the old push-banner lander capability, a different
  version with different providers. Removing this plugin does not touch it.

### fable-rebuilds (`ai.amberx.axf.console.fable-rebuilds`)

What it is: view `fable-rebuilds`, dialog `fable-rebuilds.report`, settings tab, actions `fable-rebuilds.open`,
`.park-plugin`, `.park-feature`, entries it adds to slots `plan.feature` and `pending.item`, to context-menu targets
`plugin-manager.row`, `axf-plan-feature`, `axf-pending-item` and to the default context menu, routes
`/api/plugins/fable-rebuilds/{items,report/<id>,park}`. No `notify.json`, no MCP tools.

Data: none of its own (`hooks.mjs`). It reads the pending list through `framework/cli/engine-rpc.mjs` and the reports
in `_claude/memory/docs/rebuilds/`; both belong to the framework and stay. Pending items it parked keep
`source: "fable-rebuilds"` as plain text. No Postgres table.

Dependencies found:

- Every hook is a contribution into a host that lives elsewhere (Plan, Pending builds, Plugin Manager). The hosts do
  not name this plugin; with it gone the chips and menu entries are simply absent.
- **Help.** `apps/console-web/src/assets/help/console.json:300` (`view:fable-rebuilds`), source
  `_claude/builds/help-src/console.py:54`: delete both.
- `apps/console-web/plugins/build-breaker/web/buildMenu.ts:26` (`fable-rebuilds.open`, drops out by itself).
- Doc lines: `framework/spec/DESIGN-LANGUAGE.md:148`, `framework/spec/token-manifest-baseline.json:8` (drop the entry).
- Not this plugin: build rule `no-fable-rebuilds` (`_claude/builds/build-rules/seed.json:1791`,
  `framework/cli/build-rules-migrate.mjs:89`) is a rule id. It says no parked Fable rebuilds since Oct 27 2026, which
  is the reason this screen has no new work.

## Not checked

- Home cards saved in console data that use `builds-page/progress` (data is not in the repo).
- Whether `help-coverage.mjs --check` and `check-token-registry.mjs` stay green after each removal: neither was run
  against a tree with the plugin removed, since this step changes nothing.
- The AmberX app repo itself. In this repo no app other than the console names any of the four folders; the
  builds-page manifest says AmberX reaches its routes through the console forward.
