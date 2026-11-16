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
