# Fix the red CI on the blocked builds so they land

Build `fix-red-ci-blocked-builds-they-land` (split from `get-main-green-unblock-lander-land-axf`).

## Failures

Latest failed `Android framework + console` run per branch (workflow_dispatch on the branch head, Nov 16 2026).
"Behind" = commits behind `origin/main` at survey time.

| Branch | PR | Behind | Run | Failing job → step | Cause |
|---|---|---|---|---|---|
| owner-recognized-everywhere-veto | #601 | 3816 | 43874138667 | Web Dev Console → Theme swap | A |
| pass-approval-hook-deep-link-amberx-notification | #681 | 1205 | 43874179891 | Web Dev Console → Theme swap; Build engine sweep → check-builds-live (5 failed: heal/merge store cases) | A, D |
| land-project-duplicate-boilerplate | #684 | 2188 | none | no CI run on the head (broker-token push) | E |
| picker-dialog-plugin-replaces-all | #676 | 1456 | 43873979824 | Theme swap; sweep → plugins.mjs --check (`opens: "main"`, `builtWith.model` full id) | A, D |
| all-settings-interfaces-open-floating | #628 | 2368 | 43873953433 | Console re-bake/build + AmberX web build (`VetoHost.overlay` TS errors); sweep → check-profiles (`test-sandbox` profile) | C, B |
| themed-native-controls-plugin | #690 | 1455 | 43873915557 | Theme swap; plugins.mjs --check (`opens: "main"`); Gradle lib-hub HubAppearanceSourceTest | A, D |
| new-asset-type-animated-expanding-row | #630 | 2346 | 43875040996 | Console + AmberX build (`VetoHost.overlay`); check-profiles | C, B |
| quick-settings-pinned-collapsible-pane | #698 | 2363 | 43877166520 | Console + AmberX build (`VetoHost.overlay`); check-profiles | C, B |
| orchestrator-settings-collapsible-split | #636 | 2252 | 43875112759 | Console + AmberX build (`VetoHost.overlay`); check-profiles | C, B |
| context-menus-plugin-one-true-source | #659 | 1949 | 43875154149 | Console + AmberX build (`VetoHost.overlay`); check-profiles; Gradle kernel ConformanceTest (theme variables) | C, B, D |
| projects-own-everything-per-project | #605 | 3373 | 43875205676 | Theme swap; sweep → help-coverage (agent-slots help kind, framework 99.3%) | A, D |
| pending-tab-one-collapsed-row-per-2 | #706 | 541 | 43875242816 | amberx-droid re-bake/build + AmberX web build (`@console/api` unresolved from wake-listener) | F |
| shipped-features-open-button-views-each | #714 | 294 | 43875329007 | Theme swap; sweep → plugin pages (gate/GateView page head has no description) | A, D |
| fix-build-whose-session-finishes-phase-e | #685 | 2810 | 43878897172 | Theme swap; sweep → plugin lifecycle (build-orchestrator stale references) | A, D |
| group-chat-audio-hear-agents-talk-while | #671 | 1645 | 43878941982 | Console + AmberX build (`VetoHost.overlay`); glossary coverage; Gradle kernel ConformanceTest | C, D |
| ui-manager-floating-window-to-select-any | #634 | 2301 | 43895270530 | Console + AmberX build (`VetoHost.overlay`); check-profiles | C, B |
| console-look-becomes-default-axhub-skin | #717 | 545 | 43895280548 | amberx-droid + AmberX web build (`@console/api`); sweep → validate --framework (help target id) | F, D |
| vps-sends-shipped-features-every-merge | #709 | 53 | 43887601648 | amberx-droid + AmberX web build (`@console/api`); plugin lifecycle (ui-review stale refs to gate) | F, D |
| shipped-features-organized-sortable | #708 | 505 | none failed on the head | build-rules ci-checks step (generated CI check / help stub / manifest) | D |

### Causes

- **A. Runner image (infra, all branches and main).** `ubuntu-latest` is rolling over to `ubuntu-26.04`; `npx playwright install --with-deps chromium` (Playwright 1.56.0) refuses it: "Playwright does not support chromium on ubuntu26.04-x64". The theme-swap step fails before any check runs. Runs that landed on a 24.04 runner passed the same step. Shared fix: pin the runners.
- **B. Stale branch vs main data (merge fixes it).** `check-profiles`: `_claude/builds/profiles/test-sandbox/` exists without a `framework/plan/profiles.json` entry: the branch head has old main data. Fixed by merging `origin/main`.
- **C. Half-synced framework (merge fixes it).** `VetoHost.overlay` / `overlayCommand` used by `approvals-banner` and `amberx-droid/src/native.ts` but missing from the branch's framework type: the branch carries a partial re-sync. Merging `origin/main` brings the matching type.
- **D. Per-branch.** Real issues in the branch's own work (plugin.json fields, help kinds/targets, page head copy, stale plugin references, builds-live heal cases, glossary, kernel conformance). Fixed on each branch after the merge.
- **E. No CI run.** Pushed with the broker token, which starts no workflow; needs a `workflow_dispatch` of android.yml.
- **F. Main itself (shared).** `apps/console-web/plugins/wake-listener/web/flow.ts` imports `@console/api`; the amberx-droid build (which compiles console plugins) has no such alias, so the AmberX web build fails. Main's last full run (43710482736) failed on the same two amberx-droid steps. Every branch inherits it on merge.

## Reproduced on main (s2)

Fresh worktree of `origin/main` (b9d8b5892), every `run:` step of the `engine` job and the console job's amberx-droid
step run locally with CI's env (`AXF_BUILD_PROFILE=all`, `AXF_DATA_DIR=off`).

**Main is not green.** These fail on main itself, so every branch inherits them when it merges main:

| Check | Error on main | Cause |
|---|---|---|
| Web Dev Console → amberx-droid re-bake + build; AmberX → Build the web app | `Rollup failed to resolve import "@console/api"` from `plugins/wake-listener/web/flow.ts` (amberx-droid has no `@console/api` alias) | F |
| Build engine sweep → Plugin pages follow the design language | `plugins/gate/web/GateView.tsx:36 page head has no one-sentence description` | G |
| Build engine sweep → Plugin lifecycle | `ui-review`: stale references in `plugins/gate/gate-store.mjs:91` and `plugins/gate/web/RulesTab.tsx:20` (the gate's rule id `ui-review`) | G |
| Web Dev Console → Theme swap | not reproducible locally; fails on any `ubuntu-26.04` runner (Playwright 1.56 has no chromium build for it) | A |

- **G. Gate plugin on main (shared).** The gate plugin landed with a page head without a description and names the
  `ui-review` plugin id in its rule list, which the lifecycle check reads as a stale reference.

Failures that only appear on this VPS, not in CI (ignored): `node:sqlite` missing (VPS Node 20, CI Node 22), saved
Claude account tests (local account store), check-agent-slots (run inside a dispatched build session), pip PEP 668, a
leftover `/tmp/sweep`.

Branch-only failures (cause D) appear only on the branch head: plugin.json `opens`/`builtWith.model`, help kinds and
targets, glossary, builds-live heal cases, kernel conformance. Causes B and C (check-profiles `test-sandbox`,
`VetoHost.overlay`) go away with the merge of main.

Overlap: `get-main-green-unblock-lander-land-axf` plans the same main fixes (s3–s7 on `fix/main-green`, not started at
s2 time). This build fixes A, F and G once on `fix/ci-common-cause` and notes it on that build so it is not done twice.

## Common-cause fix (s3)

Branch `fix/ci-common-cause` (37995d9b9), PR [#719](https://github.com/MossesX/AmberX-AXF/pull/719):

- **F**: `apps/amberx-droid/src/console/api.ts` (empty console token store; AmberX's server adds the token) + `@console/api`
  alias in `vite.config.ts` and path in `tsconfig.json`. amberx-droid re-bake + build passes locally.
- **G**: Gate page head gets its description; the gate's `ui-review` rule id lines carry `axf-not-plugin:ui-review`.
  `check-plugin-pages.mjs` and `plugin-lifecycle.mjs check gate|ui-review` pass.
- **A**: `android.yml` runners pinned to `ubuntu-24.04` (Playwright 1.56 has no chromium for 26.04).

Each blocked branch needs #719 (or main after it lands) merged in to go green; until #719 lands, branches merge
`origin/fix/ci-common-cause` along with `origin/main`.

- **H** (found at s11): `check-console-control` fails on main itself: claude-settings' TabGroup id is imported
  (`TAB_GROUP_ID` from `view-core.mjs`) and `control-inventory.mjs` only resolved same-file constants (tabGroups 1,
  baseline 0). Fixed once on `fix/ci-common-cause` (3639ff87c), PR [#726](https://github.com/MossesX/AmberX-AXF/pull/726);
  #719 has landed on main. Branches from s11 on merge `origin/fix/ci-common-cause` too.

- **I** (found at s22): `shared-assets check` fails on main itself (the build-rules ci-checks step runs it): the baked
  `help/framework.json` in console-web, axhub-web, amberx-droid and molly kept the old settings page-option text. Re-baked
  on `fix/ci-common-cause` (e4c87b2a5), same PR #726.

## Per branch (s4–s22)

Each branch: merge `origin/main` + `origin/fix/ci-common-cause`, take main's build/plan data (store, orchestrator, pending, plan, build queue: the branch copies were stale snapshots that would overwrite main's), drop the stale `test-sandbox` profile folder, regenerate the control inventory, fix the branch's own failures, run them locally.

| Branch | What was done | Head |
|---|---|---|
| owner-recognized-everywhere-veto | merged main clean; data reset to main; theme-swap (A) fixed by #719 | 489c24996 |
| land-project-duplicate-boilerplate | no CI run before (E); merged main clean; branch is a report + THREADS row only | 9cbebab7a |
| pass-approval-hook-deep-link-amberx-notification | merged main clean (builds-live cases pass after merge); help entry for the pass page's All passes button | 4b5465ae5 |
| picker-dialog-plugin-replaces-all | 9 source conflicts with main resolved (import unions, settings asset row Select + back(type), gen-fixtures both blocks, picker schema line); plugin.json opens false + builtWith.model opus | — |
| all-settings-interfaces-open-floating | Overlays.tsx import conflict (union); stale test-sandbox profile folder removed; VetoHost.overlay resolved by main | — |
| themed-native-controls-plugin | control@1 append-only clash with main's tokens.instances: tokens.controls moves to index 25 (26 targets), schema + fixture regenerated; skins.mjs keeps upgrade + skin-config; plugin.json opens false | — |
| new-asset-type-animated-expanding-row | WindowHost import conflict; workflow lines merged (check-dropdowns, check-expander-picker kept); skin-config schema regenerated for expander-picker; validate --framework, skin-coverage, fixtures, glossary, help pass | 73a622e5e |
| orchestrator-settings-collapsible-split | 4 conflicts with main's custom groups: both kept (server routes, test, actions, keywords, imports); stale test-sandbox removed; build-orchestrator test.py 52 pass | 0b9e5a794 |
| context-menus-plugin-one-true-source | merged main (data only); help for the zone menus button; check-context-menus, fixtures, profiles, plugins, help pass | 675568066 |
| projects-own-everything-per-project | merged main clean; help-kind + coverage failures already fixed on main; profiles, plugins, inventory, check-projects pass | c77e09ca4 |
| pending-tab-one-collapsed-row-per-2 | merged main clean; amberx @console/api fixed by #719 | b2dab4aac |
| quick-settings-pinned-collapsible-pane | re-merged main (151 behind): settings dialogs keep main's glass/wide + all-settings dialog inside the Quick settings frame; PORTING keeps both notes; duplicate SelectField import dropped; merged #726. check-profiles, quick-settings, settings-open, console-control, theme, controls, skin-coverage pass; console tsc clean after the CI re-bake | 65057fd05 |
| group-chat-audio-hear-agents-talk-while | merged main (1868 behind) + #726: AmberX `@console/api` shim keeps main's token store and the branch's readLocal/writeLocal; data from main; inventory regenerated. Glossary (check + test), console-control, profiles, theme, controls, toolbars, chrome-assets, notify-control pass; fixtures regenerate with no drift; console + AmberX tsc clean after the CI re-bake. Kernel ConformanceTest not run locally (no Gradle on the VPS): CI decides | 4480ba18b |
| ui-manager-floating-window-to-select-any | merged main (2524 behind) + #726: catalog status keeps cx.uimanager beside main's entries; stale test-sandbox profile dropped; data from main; descriptions for the ui-manager `catalog` / `overrides` commands (glossary ratchet 390 → 388); inventory regenerated. tracker, profiles, console-control, theme, controls, toolbars, chrome-assets, glossary, plugin-lifecycle, notify-control pass; console tsc clean after the CI re-bake | 4b1ce9b2b |
| console-look-becomes-default-axhub-skin | merged main (768 behind) + #726: help, glossary terms and catalog status merged by entry (main reformatted the help file); baked copies re-copied from the merged framework; data from main. Own failures: `action:skin.restoreBackup` is not a valid help id (dropped; its text is on the button's entry); the two default-look buttons get `data-help` (framework help coverage back to 100%); help copies synced. validate --framework, help-coverage, shared-assets, glossary, settings-open, controls, skin checks pass; console, axhub-web, AmberX tsc clean after the CI re-bake | 079101ec3 |
| vps-sends-shipped-features-every-merge | merged main (276 behind) + #726: gate page head takes main's description (same fix both sides; ui-review/gate lifecycle refs already fixed on main); data from main; inventory regenerated. plugin-lifecycle (gate, ui-review, push-banner, shipped-features, build-orchestrator), merge-watch, validate --framework, help, glossary, profiles, console-control, theme, controls, notify-control pass; push-banner 183, build-orchestrator 47, shipped-features 11 + server 26 (on Node 22: `node:sqlite`) pass; console tsc clean after the CI re-bake. AmberX untouched by the branch (its `@console/api` fix came with #719) | 8944c4892 |
| shipped-features-organized-sortable | merged main (728 behind) + #726 (cause I: baked help re-bake); data from main; inventory regenerated. Own failures: help for the column picker close, Export CSV and the Help link (console help coverage back to 100%); `_claude/THREADS.md` added to the plugin's mentions (marked row was flagged stale). Build-rules ci-checks 19/19, check-build-rules, plugin-lifecycle, validate --framework, help, glossary, profiles, console-control pass; shipped-features 13 + server 32 (Node 22) pass; console tsc clean after the CI re-bake | dcb8043ef |

## CI state and merge queue (s23, Nov 16 ~20:00 UTC)

Common cause **J** (found at s23): `check-token-registry` fails on main itself (Web Dev Console job, "Alerts + MCP client +
axf_server" step): the gate plugin's `tokens.uses` missed 14 tokens. Written with `token-registry.mjs manifest gate --write`
on `fix/ci-common-cause` (f1068e307), PR #726. That step's failure on picker-dialog, orchestrator-settings and
context-menus is this cause; they go green once #726 lands (or merge it).

Every PR was added to the merge queue (`land.mjs queue add`); a red or draft PR waits and joins by itself when green.
Heads below are the branch heads at s23 (several moved after their step: the auto-lander and other sessions push too).

| Branch | PR | Head | CI on the head | State |
|---|---|---|---|---|
| owner-recognized-everywhere-veto | #601 | d46ec0f78 | pull_request ✓ | **merged** |
| all-settings-interfaces-open-floating | #628 | be0b37347 | pull_request ✓ | **merged** |
| pass-approval-hook-deep-link-amberx-notification | #681 | 4b5465ae5 | pull_request ✓ | queued |
| land-project-duplicate-boilerplate | #684 | 9cbebab7a | pull_request ✓ | queued |
| quick-settings-pinned-collapsible-pane | #698 | 65057fd05 | pull_request ✓ | in queue (waiting) |
| pending-tab-one-collapsed-row-per-2 | #706 | b2dab4aac | pull_request ✓ | in queue (waiting) |
| fix-build-whose-session-finishes-phase-e | #685 | 29c80d280 | pull_request ✓ | in queue (testing) |
| shipped-features-open-button-views-each | #714 | f260176d2 | pull_request ✓ | queued |
| new-asset-type-animated-expanding-row | #630 | 73a622e5e | pull_request ✓ | draft: queued, joins when marked ready |
| projects-own-everything-per-project | #605 | c77e09ca4 | pull_request ✓ | draft: queued, joins when marked ready |
| group-chat-audio-hear-agents-talk-while | #671 | 4480ba18b | dispatch running | queued |
| ui-manager-floating-window-to-select-any | #634 | 4b1ce9b2b | dispatch running | draft: queued |
| console-look-becomes-default-axhub-skin | #717 | 079101ec3 | dispatch running | queued |
| vps-sends-shipped-features-every-merge | #709 | 856108dc1 | dispatch running | queued |
| shipped-features-organized-sortable | #708 | dcb8043ef | none: android.yml dispatched | queued |
| picker-dialog-plugin-replaces-all | #676 | 7249ce9b4 | dispatch ✗: token registry (J); check-agent-slots | draft: queued |
| orchestrator-settings-collapsible-split | #636 | 3c9ced4c4 | dispatch ✗: token registry (J) | queued |
| context-menus-plugin-one-true-source | #659 | fabf81cd6 | dispatch ✗: token registry (J); glossary ratchet | queued |
| themed-native-controls-plugin | #690 | 582a1cbc4 | pull_request ✗: light PR checks (ci-scope) | queued |

axf-data / Postgres branches not touched.

## Summary (s24)

- **Cause**: most branches were far behind main and failed on what main had already fixed (B, C, part of D), plus
  shared breakage on main itself: runner image and amberx `@console/api` and gate page head (A, F, G; #719, landed),
  then the console-control inventory (H), the baked shared help copy (I) and the gate plugin's token manifest (J), all
  three on PR #726. The rest (D) was per branch: merge conflicts with main, help / glossary ratchets, plugin manifests.
- **Fix per branch**: see the Per branch table (s4–s22).
- **Sweep on `fix/ci-common-cause`** (s24, CI emulation AXF_DATA_DIR=off): console-control, shared-assets,
  token-registry, help coverage, glossary, validate --framework, profiles, theme, controls, toolbars, chrome-assets, gate
  lifecycle, tracker and the build-rules ci-checks (19/19) all pass.
- **Not run locally**: Gradle kernel tests (no Gradle on the VPS); CI decides for group-chat-audio's ConformanceTest.
- **Still open**: themed-native-controls (light PR checks, ci-scope), context-menus (glossary ratchet), picker-dialog
  (check-agent-slots on CI). Each is queued and rejoins when green.
- **Overlap**: `get-main-green-unblock-lander-land-axf`'s #724 also re-bakes the shared help (I) and writes the gate
  token manifest (J), and both are generated outputs, so whichever lands first makes the other's copy a no-op. H (the
  control-inventory scanner) is only in #726.
- No UI added, so no API surface.
