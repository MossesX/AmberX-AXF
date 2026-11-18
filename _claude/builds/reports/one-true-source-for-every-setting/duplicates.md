# Duplicates: every setting held or editable in more than one place

Build `one-true-source-for-every-setting`, s7. Collated from `audit-console.json`, `audit-builds.json` and
`audit-framework.json` (same folder). Brett: "All settings need one true fucking source." Every row below names the one
owner now written into `framework/schemas/settings-sources.json`; the fix step says where the copy is removed.

Live values are from the VPS on Nov 18 2026 (`settings-migrate.mjs --all --dry-run` with `AXF_ROOT=/opt/axf`).

## Build stores

| # | Setting | Held in | Owner picked | Why | Fix |
|---|---|---|---|---|---|
| 1 | Account takes builds (on/off) | `pipeline/accounts.json` `<name>.use` (Pipeline → Accounts toggle, `POST pipeline/account`, `pipeline.mjs account --use`) and `claude-accounts/workers.json` `workers` / `excluded` | **claude-accounts/workers** `excluded` (`accounts.<name>.use` = not in the list) | The job router enforces exclusions for every job, not only builds; the pipeline's flag was a second switch the router never saw. Live: 5 accounts, 4 agree; `hulu-api` (a stale API name) differs and the owner wins | s8 migrate, s9 remove the pipeline toggle + route + command |
| 2 | Sessions at once per account | `pipeline/accounts.json` `<name>.parallel` and `workers.json` `perAccount.<name>.building` | **claude-accounts/workers** `perAccount.<name>.building` | Same meaning ("jobs running at once on this account"); the router already applies `building`. Live: owner unset for all three, pipeline values (5, 8, 8) move over | s8 |
| 3 | Account may run Fable | `pipeline/accounts.json` `<name>.fable` only (override over the probe) | **claude-accounts/workers** `perAccount.<name>.fable` (new field, kept by `normConfig`) | The account's capabilities belong with the account, not with one consumer | s8 |
| 4 | Jobs running at once, default for every account | `pipeline/settings.json` `parallelPerAccount` (5), `workers.json` `limits.building` (5), `claude/settings.json` `builds.maxParallel` (1, Brett by voice Nov 6; only ever seeded `parallelPerAccount` when that was unset, so it has not been in force) | **claude-accounts/workers** `limits.building` | Enforced by the router; Claude accounts is the UI Brett edits limits in. Conflict flagged: owner 5 wins over the Claude field's 1 (which had no effect) | s10 migrate, s11 read-only lines in Pipeline settings and Claude settings |
| 5 | The console's own account takes jobs | `pipeline/settings.json` `useConsoleAccount` and `workers.json` `interactiveTakesJobs` (both true) | **claude-accounts/workers** `interactiveTakesJobs` | Same switch, router-enforced | s10 / s11 |
| 6 | Launch builds without asking | `claude/settings.json` `builds.launchWithoutAsking` (owner-only) and `pipeline/settings.json` `autoQueue` (false) | **claude-settings** `builds.launchWithoutAsking` | Brett's owner-only switch, read by every session; the pipeline already copied it in | s10 / s11 |
| 7 | Fable upgrades need approval | `claude/settings.json` `builds.fableUpgradeApproval` (false) and `_claude/builds/store.json` `rules.approveModelSwitch` (true, read by nobody but the UI type) | **claude-settings** `builds.fableUpgradeApproval` | `framework/core/model-switch.mjs` reads the Claude setting; the orchestrator rule is dead | s10 remove the rule, s11 the Rules card shows a read-only line |
| 8 | Merge queue on | `push-banner/config.json` `mergeQueue` (true) and `gate/lander.json` `mergeQueue` (true, preferred by `gate lander.mjs mode()`) | **push-banner/config** `mergeQueue` | The lander service reads push-banner's config; the gate record was a cache that could disagree | s10 |
| 9 | Landing waits for UI Review | `push-banner/config.json` `landWaitUi` and the gate rule `ui-review.enabled` in `gate/rules.json` (mirrored by `gate-store mirrorRules`) | **push-banner/config** `landWaitUi`; the gate rule is the control that writes it | One writer path already (gate → push-banner config); the rule set keeps `enabled` as the UI's state of that same write | kept as is: one value, the gate writes the owner (documented) |
| 10 | Builds at once (VPS cap) | `agent-slots/build-limit.json` `maxBuilds` (8), `agent-slots/settings.json` `maxAgents` (8) | distinct settings: slice cap vs agent cap, both enforced by agent-slots | Different limits (systemd slice vs agent processes) | none; registered under `builds.limit.**` and `agents.**` |
| 11 | Auto-land | `push-banner/config.json` `autoLand` (the retired cron lander, off) and `auto-lander/control.json` `settings.enabled` (the auto-lander service) | distinct: the cron lander's flag is a mode flag the gate flips with the merge queue | Two mechanisms, two switches | none; noted |
| 12 | Auto-lander policy | `auto-lander/control.json` `settings.*` and `auto-lander/state.json` `policy` | **auto-lander/control** `settings` | `state.policy` is the lander's own projection, rewritten each tick by the same writer | none needed (projection, not a second owner); readers go to `lander.**` |

## Console server + plugins

| # | Setting | Held in | Owner picked | Why | Fix |
|---|---|---|---|---|---|
| 13 | Follow Amber | `claude/settings.json` `followAmber.enabled` (true; the registry says "one setting, read by both"), `follow-amber/state.json` `on` (true), browser `follow-amber.on` | **claude-settings** `followAmber.enabled` | Every session reads Claude settings; the console's plugin kept its own file and a browser copy | s12: the plugin reads / writes through `settings_source.py`, browser key becomes in-memory |
| 14 | Wake listener: understand with Claude, timeout | `wake-listener/settings.json` `values.useClaude` / `claudeTimeoutSec` and browser `axf.voice.useClaude` / `axf.voice.claudeTimeoutSec` (the generated controls save both) | **wake-listener/settings** | Server-side setting the listener process reads | s12: the controls write the server, no localStorage copy |
| 15 | Claude handoff installer look | hub `settings/claude-handoff-look.json` (by design) and browser `claude-handoff.look` (LOCAL_KEY cache) | **claude-handoff/look** (hub) | The plugin's own contract names the hub document | s12: cache in memory only |
| 16 | `claudeOnFail` / `claudeShell` | `systems-check/settings.json` and `push-banner/config.json`, same names | two different settings (Claude fixes a failed check vs Claude fixes red CI) | Same name, different trigger | none; both registered under their plugin prefix |
| 17 | Plugin enabled | `.axf-console/state.json` `plugins.<id>.enabled` (server) only | **server/state** | one store | none |

## Framework + axHub side

| # | Setting | Held in | Owner picked | Why | Fix |
|---|---|---|---|---|---|
| 18 | Per-app SettingsRegistry values (fontScale 80, alerts-bell.show/side, plugin-manager.view, axf.dev.defaultModel, axf.appearance.spacing …) | browser `axf:ai.amberx.axf.console:settings` and hub `settings/apps/axf-console.json` (hub-settings@1, last written Oct 31 2026; `apps/axhub-web.json` Nov 5) | **browser registry** (device / app settings) for those keys; `look.<app>` for spacing | Nothing has written the hub snapshots since; they disagree with the live registry (fontScale 80 vs 115 between apps is fine, but the console doc is three weeks stale) | s14: strip the duplicated keys from the snapshots |
| 19 | App look: slots, spacing, hidden | hub `settings/looks/<app>.json` (app-look@1 `own` / `default`) and hub `settings/appearance.json` (appearance@1 `slots` / `spacing` / `hidden` / `palette`) | **appearance/app-look** for web apps; the shared document's legacy fields stay because Android's `AppearanceEngine` / `HubAppearanceSource` read only `appearance.json` | APPEARANCE-SOURCE.md made each app's look its own document; the Kotlin twin never followed | s14: record the Kotlin twin as the deferred gap in PORTING.md; the shared fields are registered as `appearance.slots.**` etc. with that note, not stripped |
| 20 | Applied look in the browser (`axf.appearance.spacing`, `axf.skin.look`, `axf.lock.hubskin.overridden`) | browser registry, written by the runtime when a hub document arrives | **appearance/app-look** (hub); the browser keys are the runtime's applied copy | By design (APPEARANCE-SOURCE.md): the document is the saved setting, the key is how the UI reads it | none; registered under `look.*.**` with the note. The applied copy is the framework's cache and refreshes on focus |
| 21 | AmberX (Android) settings | hub `settings/apps/amberx-droid.json` (hub-settings@1, written by the app Nov 10) | **hub-settings/amberx-droid** | The app's live store through lib-hub HubSettings, not a copy | none; registered as `amberx.**` |
| 22 | Chrome settings, tap-to-confirm | SettingsRegistry keys applied from the composed skin and `own.settings` of the look document | the look document (`look.*.**`) | no second store found | none |

## Not duplicates, registered once

Every plugin's own `settings.json` / `config.json` (`<plugin>.**` → `plugins/<plugin>/<file>`), the pipeline's remaining
settings (`pipeline.**`), the recovery watchdog (`watchdog.**`), orchestrator rules (`orchestrator.rules.**`), agent
slots (`agents.**`, `builds.limit.**`), the auto-lander (`lander.**`), the gate's view settings (`gate.**`), the merge
queue (`merge-queue.**`), the alerts hub (`alerts.**`), Claude settings (`claude.**`), Claude accounts (`accounts.**`),
hub-wide appearance (`appearance.**`), app looks (`look.*.**`), the framework and console registries (`browser.axf.**`,
`console.**`).

## Owner rules used

1. The store whose process enforces the value owns it (router → workers.json, lander → push-banner config, agent-slots → its files).
2. When nothing enforces it, the store every reader already resolves (Claude settings for owner-only switches read by every session).
3. A browser registry owns only device / app settings nothing server-side needs.
4. A runtime projection written by the owner itself (auto-lander `state.policy`, the applied look keys) is not a second owner.
